import { describe, expect, it } from 'vitest';
import { changeEmailStatements, isTakenByAnotherAccount, sqlEmail, sqlToken } from '../../scripts/ops/change-email-plan';

describe('sqlEmail', () => {
  it('lowercases and quotes a plain address', () => {
    expect(sqlEmail('Alice@Example.com')).toBe("'alice@example.com'");
  });

  it('refuses anything that is not a plain address', () => {
    // These are interpolated into SQL, so an injection attempt must fail loudly
    // at parse time rather than be escaped and hoped for.
    expect(() => sqlEmail("a@b.com'; DROP TABLE user_emails; --")).toThrow('not a plain email address');
    expect(() => sqlEmail('no-at-sign')).toThrow('not a plain email address');
    expect(() => sqlEmail('')).toThrow('not a plain email address');
  });
});

describe('sqlToken', () => {
  it('quotes a plain id token without lowering it', () => {
    expect(sqlToken('usr_ab12-CD34', 'account id')).toBe("'usr_ab12-CD34'");
  });

  it('refuses tokens carrying SQL metacharacters', () => {
    expect(() => sqlToken("usr_1' OR '1'='1", 'account id')).toThrow('not a plain account id');
  });
});

describe('changeEmailStatements', () => {
  const statements = changeEmailStatements("'new@example.com'", "'usr_1'", 1_700_000_000);

  it('claims the new address before moving and revoking', () => {
    // Claiming first is what keeps the user logged in throughout: there is only
    // a brief window where both addresses authenticate. Revoking first would
    // open a window where neither does.
    expect(statements[0]).toContain('INSERT INTO user_emails');
    expect(statements[1]).toContain('UPDATE user_metadata SET current_email');
    expect(statements[2]).toContain('UPDATE user_emails SET is_verified = 0');
  });

  it('never updates the frozen anchor', () => {
    // user_metadata.user_email is the anchor assumable_roles,
    // user_favorite_accounts and user_access_tokens cascade from.
    expect(statements.join(' ')).not.toMatch(/SET user_email/);
  });

  it('revokes every other address for the account', () => {
    expect(statements[2]).toContain('email !=');
  });
});

describe('isTakenByAnotherAccount', () => {
  it('is false when the address is unverified or absent', () => {
    expect(isTakenByAnotherAccount(undefined, 'usr_1')).toBe(false);
    expect(isTakenByAnotherAccount({ user_id: 'usr_2', is_verified: 0, current_email: 'x@y.com' }, 'usr_1')).toBe(false);
  });

  it('is false when the holder is this same account', () => {
    expect(isTakenByAnotherAccount({ user_id: 'usr_1', is_verified: 1, current_email: 'x@y.com' }, 'usr_1')).toBe(false);
  });

  it('is true when another account holds it as a live login', () => {
    expect(isTakenByAnotherAccount({ user_id: 'usr_2', is_verified: 1, current_email: 'x@y.com' }, 'usr_1')).toBe(true);
  });
});
