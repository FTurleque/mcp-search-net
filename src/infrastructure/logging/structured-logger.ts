export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

const priorities: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
};

export class StructuredLogger {
  public constructor(private readonly minimumLevel: LogLevel) {}

  public debug(message: string, data: Readonly<Record<string, unknown>> = {}): void {
    this.write('debug', message, data);
  }

  public info(message: string, data: Readonly<Record<string, unknown>> = {}): void {
    this.write('info', message, data);
  }

  public warning(message: string, data: Readonly<Record<string, unknown>> = {}): void {
    this.write('warning', message, data);
  }

  public error(message: string, data: Readonly<Record<string, unknown>> = {}): void {
    this.write('error', message, data);
  }

  private write(level: LogLevel, message: string, data: Readonly<Record<string, unknown>>): void {
    if (priorities[level] < priorities[this.minimumLevel]) return;
    const record = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...sanitize(data),
    };
    process.stderr.write(`${JSON.stringify(record)}\n`);
  }
}

function sanitize(data: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
      if (/token|secret|password|authorization/i.test(key)) return [key, '[redacted]'];
      if (value instanceof Error) {
        return [key, { name: value.name, message: value.message }];
      }
      return [key, value];
    }),
  );
}
