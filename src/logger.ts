import pino from "pino"
import { Writable } from "node:stream"

const MAX_LOG_ENTRIES = 200

/** Ring buffer that holds recent log entries for programmatic access */
class LogBuffer {
  private entries: string[] = []

  push(entry: string) {
    this.entries.push(entry)
    if (this.entries.length > MAX_LOG_ENTRIES) {
      this.entries.shift()
    }
  }

  recent(count = 50) {
    return this.entries.slice(-count)
  }

  clear() {
    this.entries = []
  }
}

function createLogger() {
  const isDev = process.env.NODE_ENV !== "production"
  const level = process.env.LOG_LEVEL ?? (isDev ? "debug" : "info")

  // Create log buffer (dev only)
  const buffer = isDev ? new LogBuffer() : null

  if (isDev && buffer) {
    // Tee: write to both pino-pretty (stdout) and the ring buffer
    const prettyStream = pino.transport({
      target: "pino-pretty",
      options: {
        colorize: true,
        ignore: "pid,hostname",
        translateTime: "HH:MM:ss.l",
      },
    })

    const teeStream = new Writable({
      write(chunk, _encoding, callback) {
        const line = chunk.toString().trim()
        if (line) buffer.push(line)
        prettyStream.write(chunk, callback)
      },
    })

    const instance = pino({ level }, teeStream)
    ;(instance as unknown as Record<string, unknown>).__logBuffer = buffer
    return instance
  }

  return pino({ level })
}

// Singleton — survives HMR via globalThis
const g = globalThis as Record<string, unknown>
export const logger = (g.__tracey_logger__ ??= createLogger()) as pino.Logger

/** Get recent log entries (dev only). Returns empty array in production. */
export function getRecentLogs(count = 50): string[] {
  const buffer = (logger as unknown as Record<string, unknown>).__logBuffer as LogBuffer | undefined
  return buffer?.recent(count) ?? []
}

/** Clear the log buffer (dev only). */
export function clearLogs() {
  const buffer = (logger as unknown as Record<string, unknown>).__logBuffer as LogBuffer | undefined
  buffer?.clear()
}
