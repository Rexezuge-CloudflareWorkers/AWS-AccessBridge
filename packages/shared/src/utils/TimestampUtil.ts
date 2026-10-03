import { SYSTEM_CLOCK, type Clock } from './Clock';

class TimestampUtil {
  /**
   * @param clock Inject a `FixedClock` to pin "now" in a test; production leaves
   * it defaulted.
   */
  public static getCurrentUnixTimestampInMilliseconds(clock: Clock = SYSTEM_CLOCK): number {
    return clock.now();
  }

  /**
   * @param clock Inject a `FixedClock` to pin "now" in a test; production leaves
   * it defaulted.
   */
  public static getCurrentUnixTimestampInSeconds(clock: Clock = SYSTEM_CLOCK): number {
    return Math.floor(clock.now() / 1000);
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