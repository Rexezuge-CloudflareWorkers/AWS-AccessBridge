class TimestampUtil {
  public static getCurrentUnixTimestampInMilliseconds(): number {
    return Date.now();
  }

  public static getCurrentUnixTimestampInSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }

  public static addMinutes(timestamp: number, minutes: number): number {
    return timestamp + minutes * 60;
  }

  public static addDays(timestamp: number, days: number): number {
    return timestamp + days * 60 * 60 * 24;
  }

  public static subtractMinutes(timestamp: number, minutes: number): number {
    return timestamp - minutes * 60;
  }

  public static subtractDays(timestamp: number, days: number): number {
    return timestamp - days * 60 * 60 * 24;
  }

  public static convertIsoToUnixTimestampInSeconds(isoString: string): number {
    return Math.floor(new Date(isoString).getTime() / 1000);
  }
}

export { TimestampUtil };
