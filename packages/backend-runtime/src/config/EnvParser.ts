class EnvParser {
  public static positiveInt(env: unknown, key: string, defaultValue: string): number {
    const value = this.readString(env, key);
    const parsed = Number(value ?? defaultValue);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : Number(defaultValue);
  }

  public static string(env: unknown, key: string, defaultValue: string): string {
    return this.readString(env, key) ?? defaultValue;
  }

  public static boolean(env: unknown, key: string, defaultValue: string): boolean {
    return (this.readString(env, key) ?? defaultValue) === 'true';
  }

  private static readString(env: unknown, key: string): string | undefined {
    // `env` is typed `unknown` because a caller may hold anything; a nullish one
    // is a legitimate "no configuration" and must read as an absent var rather
    // than throwing a TypeError out of a settings lookup.
    return (env as Record<string, string | undefined> | null | undefined)?.[key];
  }
}

export { EnvParser };
