import { pino } from "pino";

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { app: "nodewatch" },
  redact: {
    paths: ["*.privateKey", "*.password", "*.token", "*.secret", "*.routingKey", "req.headers.cookie", "req.headers.authorization"],
    censor: "[redacted]",
  },
});
export type Logger = typeof log;
