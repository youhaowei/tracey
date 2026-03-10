import pino from "pino"
import { Writable } from "stream"
import type { TraceyConfig, LogEntry } from "./types"
import { initRingBuffer } from "./ring-buffer"

// Regex patterns for string-level redaction (API keys, tokens in string values)
const REDACT_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /sk-ant-[a-zA-Z0-9-]+/g,
  /Bearer [a-zA-Z0-9._-]+/gi,
  /ghp_[a-zA-Z0-9]{36}/g,
  /gho_[a-zA-Z0-9]{36}/g,
  /github_pat_[a-zA-Z0-9_]{22,}/g,
]

function redactString(value: string): string {
  return REDACT_PATTERNS.reduce(
    (result, pattern) => result.replace(pattern, "[REDACTED]"),
    value,
  )
}

export function redactDeep(obj: unknown): unknown {
  if (typeof obj === "string") return redactString(obj)
  if (Array.isArray(obj)) return obj.map(redactDeep)
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      const lk = key.toLowerCase()
      if (
        lk.includes("password") ||
        lk.includes("secret") ||
        lk.includes("token") ||
        lk.includes("api_key") ||
        lk.includes("apikey") ||
        lk === "authorization"
      ) {
        result[key] = "[REDACTED]"
      } else {
        result[key] = redactDeep(value)
      }
    }
    return result
  }
  return obj
}

function createDefaultLogger() {
  const isDev = process.env.NODE_ENV !== "production"
  const level = process.env.LOG_LEVEL ?? (isDev ? "debug" : "info")

  return pino({
    level,
    ...(isDev && {
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          ignore: "pid,hostname",
          translateTime: "HH:MM:ss.l",
        },
      },
    }),
  })
}

function createConfiguredLogger(config: TraceyConfig) {
  const isDev = process.env.NODE_ENV !== "production"
  const level = config.level ?? process.env.LOG_LEVEL ?? (isDev ? "debug" : "info")
  const shouldRedact = config.redact !== false

  const streams: pino.StreamEntry[] = []

  // Stdout stream (pretty in dev, JSON in prod)
  if (isDev) {
    streams.push({
      level: level as pino.Level,
      stream: pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          ignore: "pid,hostname",
          translateTime: "HH:MM:ss.l",
        },
      }),
    })
  } else {
    streams.push({ level: level as pino.Level, stream: process.stdout })
  }

  // File transport
  if (config.file) {
    const { mkdirSync, createWriteStream } = require("fs") as typeof import("fs")
    const { join } = require("path") as typeof import("path")

    mkdirSync(config.file.dir, { recursive: true })

    const prefix = config.file.prefix ?? "app"
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const filepath = join(config.file.dir, `${prefix}-${timestamp}.log`)

    const fileStream = createWriteStream(filepath, { flags: "a", mode: 0o600 })
    streams.push({ level: level as pino.Level, stream: fileStream })
  }

  // Ring buffer stream
  if (config.ringBuffer !== false) {
    const ringBuffer = initRingBuffer(
      typeof config.ringBuffer === "number" ? config.ringBuffer : 1000,
    )
    const ringStream = new Writable({
      write(chunk: Buffer, _encoding: string, callback: () => void) {
        try {
          const entry = JSON.parse(chunk.toString())
          if (shouldRedact) {
            ringBuffer.push(redactDeep(entry) as LogEntry)
          } else {
            ringBuffer.push(entry)
          }
        } catch {
          // Skip unparseable lines
        }
        callback()
      },
    })
    streams.push({ level: level as pino.Level, stream: ringStream })
  }

  // Crash handlers
  if (config.crashHandlers !== false && config.file) {
    process.on("beforeExit", () => {
      pinoLogger.flush()
    })
  }

  const pinoLogger = pino(
    {
      level,
      formatters: {
        log: shouldRedact ? (obj) => redactDeep(obj) as Record<string, unknown> : undefined,
      },
    },
    pino.multistream(streams),
  )

  return pinoLogger
}

// Mutable reference behind globalThis — survives HMR
const g = globalThis as Record<string, unknown>
if (!g.__tracey_logger__) {
  g.__tracey_logger__ = createDefaultLogger()
}

function current(): pino.Logger {
  return g.__tracey_logger__ as pino.Logger
}

/**
 * Logger singleton. Always delegates to the current underlying pino instance,
 * so calling initTracey() reconfigures all existing references.
 */
export const logger: pino.Logger = new Proxy({} as pino.Logger, {
  get(_target, prop) {
    const real = current()
    const value = Reflect.get(real, prop, real)
    if (typeof value === "function") {
      return value.bind(real)
    }
    return value
  },
})

export function initTracey(config: TraceyConfig) {
  g.__tracey_logger__ = createConfiguredLogger(config)
}

export function createLogger(name: string) {
  return current().child({ component: name })
}
