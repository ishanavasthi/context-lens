const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(minLevel: Level, base: Record<string, unknown> = {}): Logger {
  const minIndex = LEVELS.indexOf(minLevel);

  function log(level: Level, msg: string, fields?: Record<string, unknown>): void {
    if (LEVELS.indexOf(level) < minIndex) return;
    const line = JSON.stringify({
      level,
      time: new Date().toISOString(),
      msg,
      ...base,
      ...fields,
    });
    console.log(line);
  }

  return {
    debug: (msg, fields) => log('debug', msg, fields),
    info: (msg, fields) => log('info', msg, fields),
    warn: (msg, fields) => log('warn', msg, fields),
    error: (msg, fields) => log('error', msg, fields),
  };
}
