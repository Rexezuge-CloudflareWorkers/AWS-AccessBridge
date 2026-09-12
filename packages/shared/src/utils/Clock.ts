interface Clock {
  now(): number;
}

class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

class FixedClock implements Clock {
  private readonly fixedTime: number;

  constructor(fixedTime: number) {
    this.fixedTime = fixedTime;
  }

  now(): number {
    return this.fixedTime;
  }
}

export type { Clock };
export { SystemClock, FixedClock };
