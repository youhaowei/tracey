import type { LogEntry } from "./types"

const LEVEL_NAMES: Record<number, string> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
}

export class LogRingBuffer {
  private buffer: LogEntry[] = []
  private readonly maxEntries: number

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries
  }

  push(entry: LogEntry) {
    this.buffer.push(entry)
    if (this.buffer.length > this.maxEntries) {
      this.buffer.shift()
    }
  }

  getEntries(): ReadonlyArray<LogEntry> {
    return this.buffer
  }

  getEntriesByLevel(level: string): LogEntry[] {
    const numLevel = Object.entries(LEVEL_NAMES).find(([, name]) => name === level)?.[0]
    if (!numLevel) return []
    return this.buffer.filter((e) => e.level === Number(numLevel))
  }

  count() {
    return this.buffer.length
  }

  clear() {
    this.buffer = []
  }
}

let instance: LogRingBuffer | null = null

export function getRingBuffer(): LogRingBuffer | null {
  return instance
}

export function initRingBuffer(maxEntries: number): LogRingBuffer {
  instance = new LogRingBuffer(maxEntries)
  return instance
}

export function getRecentLogs(): ReadonlyArray<LogEntry> {
  return instance?.getEntries() ?? []
}
