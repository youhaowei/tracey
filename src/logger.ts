import pino from "pino"

function createLogger() {
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

// Singleton — survives HMR via globalThis
const g = globalThis as Record<string, unknown>
export const logger = (g.__tracey_logger__ ??= createLogger()) as pino.Logger
