import { describe, expect, it, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrations';

/**
 * Account-level pagination against real D1, with a fully hidden account.
 *
 * `GET /user/assumables` pages over distinct accounts. The paging subquery's
 * hidden filter once hardcoded the outer alias, which made it a correlated
 * reference to the outer row — always true for a row the outer `WHERE` had
 * already kept — so a fully hidden account still consumed a `LIMIT` slot. The
 * page then rendered one account fewer than `totalAccounts` reported, and since
 * the count drives the page space, the account that fell past the window could
 * not be reached on any page: only raising `limit` widened the window enough to
 * show it. These tests pin the count and the pages to the same account set.
 */
describe('Assumables pagination with a fully hidden account', () => {
  const USER_EMAIL = 'test@example.com';
  // acct01's only role is hidden; it sorts first, inside page 1's window.
  const HIDDEN_ACCOUNT = '111111111101';
  const VISIBLE_ACCOUNTS = Array.from({ length: 10 }, (_, index) => `1111111111${String(index + 2).padStart(2, '0')}`);

  function accountId(n: number): string {
    return `1111111111${String(n).padStart(2, '0')}`;
  }

  beforeAll(async () => {
    await applyMigrations(env.AccessBridgeDB);
    const me: Response = await SELF.fetch('http://localhost/user/me', { method: 'GET' });
    expect(me.status).toBe(200);
    const user = await env.AccessBridgeDB.prepare('SELECT id FROM user_metadata WHERE user_email = ?')
      .bind(USER_EMAIL)
      .first<{ id: string }>();
    expect(user?.id).toBeTruthy();

    for (let n = 1; n <= 11; n++) {
      await env.AccessBridgeDB.prepare('INSERT INTO aws_accounts (aws_account_id, aws_account_nickname) VALUES (?, ?)')
        .bind(accountId(n), `acct${String(n).padStart(2, '0')}`)
        .run();
      await env.AccessBridgeDB.prepare(
        'INSERT INTO assumable_roles (user_email, user_id, aws_account_id, role_name, hidden) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(USER_EMAIL, user?.id, accountId(n), 'Role1', n === 1 ? 1 : 0)
        .run();
    }
  });

  interface AssumablesBody {
    totalAccounts: number;
    [accountId: string]: unknown;
  }

  function accountIdsOf(body: AssumablesBody): string[] {
    return Object.keys(body).filter((key) => key !== 'totalAccounts');
  }

  it('renders every visible account when the page limit equals the visible count', async () => {
    const response: Response = await SELF.fetch('http://localhost/user/assumables?limit=10&offset=0', { method: 'GET' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as AssumablesBody;
    expect(body.totalAccounts).toBe(10);
    expect(accountIdsOf(body).toSorted()).toEqual([...VISIBLE_ACCOUNTS].toSorted());
  });

  it('renders the same account set when the page limit exceeds the visible count', async () => {
    const response: Response = await SELF.fetch('http://localhost/user/assumables?limit=20&offset=0', { method: 'GET' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as AssumablesBody;
    expect(body.totalAccounts).toBe(10);
    expect(accountIdsOf(body).toSorted()).toEqual([...VISIBLE_ACCOUNTS].toSorted());
  });

  it('pages every account once, hidden included, when showHidden=true', async () => {
    const pages: Array<AssumablesBody> = [];
    for (const offset of [0, 10]) {
      const response: Response = await SELF.fetch(`http://localhost/user/assumables?showHidden=true&limit=10&offset=${offset}`, {
        method: 'GET',
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as AssumablesBody;
      expect(body.totalAccounts).toBe(11);
      pages.push(body);
    }

    const rendered = new Map<string, unknown>();
    for (const page of pages) {
      for (const id of accountIdsOf(page)) {
        rendered.set(id, page[id]);
      }
    }
    expect(rendered.size).toBe(11);
    expect(rendered.get(HIDDEN_ACCOUNT)).toEqual({
      roles: [],
      hiddenRoles: ['Role1'],
      nickname: 'acct01',
      favorite: false,
    });
  });
});
