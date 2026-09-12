class EmailUtil {
  /**
   * Extracts the part of an email address before the '@' symbol.
   *
   * @param email - The full email address string.
   * @returns The username part before '@'; throws an error if invalid.
   */
  public static extractUsername(email: string): string {
    // Basic validation: check if email is non-empty string and contains '@'
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new Error('Invalid email address.');
    }

    const atIndex = email.indexOf('@');

    // '@' cannot be the first character (local part must exist)
    if (atIndex === 0) {
      throw new Error('Email address missing local part before "@".');
    }

    // Return substring before '@'
    return email.slice(0, Math.max(0, atIndex));
  }

  /**
   * Extracts the domain part of an email address (after the '@' symbol).
   *
   * @param email - The full email address string.
   * @returns The domain part after '@'; throws an error if invalid.
   */
  public static extractDomain(email: string): string {
    // Basic validation: check if email is a non-empty string containing '@'
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new Error('Invalid email address.');
    }

    const atIndex = email.indexOf('@');

    // '@' cannot be the last character (domain part must exist)
    if (atIndex === email.length - 1) {
      throw new Error('Email address missing domain part after "@".');
    }

    // Return substring after '@'
    return email.slice(Math.max(0, atIndex + 1));
  }
}

export { EmailUtil };
