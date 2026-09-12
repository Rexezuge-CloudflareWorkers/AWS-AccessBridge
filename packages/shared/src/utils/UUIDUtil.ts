class UUIDUtil {
  public static getRandomUUID(): string {
    return crypto.randomUUID();
  }

  public static getRandomUUIDNoDash(): string {
    return crypto.randomUUID().replaceAll('-', '');
  }
}

export { UUIDUtil };
