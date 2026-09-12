interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

class ConsoleLogger implements Logger {
  debug(message: string): void {
    console.debug(message);
  }

  info(message: string): void {
    console.info(message);
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    console.error(message, ...args);
  }
}

class NullLogger implements Logger {
  debug(): void {}

  info(): void {}

  warn(): void {}

  error(): void {}
}

export type { Logger };
export { ConsoleLogger, NullLogger };
