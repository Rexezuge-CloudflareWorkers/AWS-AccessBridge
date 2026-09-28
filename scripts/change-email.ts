#!/usr/bin/env tsx
/**
 * Ops: change a user's sign-in address.
 *
 * Applies the same claim -> move -> revoke sequence
 * `UserIdentityService.setPrimaryEmail` performs, in that order. Claiming first
 * is what keeps the user logged in throughout: there is only a brief window
 * where both addresses authenticate. Revoking first would open a window where
 * neither does.
 *
 * `user_metadata.user_email` is never touched. It is the frozen anchor that
 * `assumable_roles`, `user_favorite_accounts` and `user_access_tokens` cascade
 * from (the last with `ON DELETE CASCADE`), and D1 will not let those references
 * be repointed. AWS grants, favourites, team memberships, tokens and attribution
 * all key on the account id and are unaffected.
 *
 * Refuses — rather than half-applying — when the new address is already a live
 * login for a different account, or differs only by case from one. The case
 * check matters: the registry key and the unique index on `current_email` are
 * both case-sensitive, so without it two accounts could differ only by case and
 * both authenticate.
 *
 * Usage:
 *   pnpm exec tsx scripts/change-email.ts --db aws-access-bridge --account alice@example.com --to new@example.com
 *   pnpm exec tsx scripts/change-email.ts --db aws-access-bridge --id usr_ab12... --to new@example.com --dry-run
 *
 * Flags:
 *   --db <name>       required; D1 database name or binding
 *   --account <value> the current sign-in address (or frozen anchor)
 *   --id <usr_id>     the stable account id (alternative to --account)
 *   --to <email>      the new sign-in address
 *   --config <path>   wrangler config (default ./wrangler.jsonc)
 *   --persist-to <d>  local persistence dir (only with --local; must match
 *                     where the database was migrated)
 *   --remote          run against the remote database (default: local)
 *   --dry-run         print the plan and the SQL, change nothing
 */
import { spawnSync } from 'node:child_process';

interface Args {
  db?: string;
  account?: string;
  id?: string;
  to?: string;
  config: string;
  persistTo?: string;
  remote: boolean;
  dryRun: boolean;
  help: boolean;
}

const USAGE = `Usage:
  pnpm exec tsx scripts/change-email.ts --db <name> (--account <email> | --id <usr_id>) --to <new-email> [--remote] [--dry-run]

Flags:
  --db <name>       D1 database name or binding (required)
  --account <value> the current sign-in address, or the frozen anchor
  --id <usr_id>     the stable account id
  --to <email>      the new sign-in address
  --config <path>   wrangler config (default ./wrangler.jsonc)
  --persist-to <d>  local persistence dir (only with --local; must match where
                    the database was migrated, or you will hit a different DB)
  --remote          run against the remote database (default: local)
  --dry-run         print the plan and SQL without changing anything
`;

function parseArgs(argv: string[]): Args {
  const out: Args = { config: './wrangler.jsonc', remote: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      i += 1;
      return value;
    };
    if (arg === '--db') out.db = next();
    else if (arg === '--account') out.account = next();
    else if (arg === '--id') out.id = next();
    else if (arg === '--to') out.to = next();
    else if (arg === '--config') out.config = next();
    else if (arg === '--persist-to') out.persistTo = next();
    else if (arg === '--remote') out.remote = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function die(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

/**
 * Single-quote a value for SQLite.
 *
 * The pattern allowlist is the safety property here: this script interpolates
 * into SQL, so anything that is not a plain address or a plain id token is
 * refused rather than escaped-and-hoped. A bogus id simply matches no account.
 */
function sqlEmail(value: string): string {
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/.test(value)) {
    die(`refusing to interpolate ${JSON.stringify(value)}: not a plain email address`);
  }
  return `'${value.toLowerCase()}'`;
}

function sqlToken(value: string, label: string): string {
  if (!/^[A-Za-z0-9_.@-]+$/.test(value)) {
    die(`refusing to interpolate ${JSON.stringify(value)}: not a plain ${label}`);
  }
  return `'${value}'`;
}

interface QueryResult {
  results?: Array<Record<string, unknown>>;
}

function d1(args: Args, sql: string): QueryResult {
  const commandArgs = [
    'exec',
    'wrangler',
    'd1',
    'execute',
    args.db as string,
    '--command',
    sql,
    '--config',
    args.config,
    '--json',
    ...(args.remote ? ['--remote'] : ['--local', ...(args.persistTo ? ['--persist-to', args.persistTo] : [])]),
  ];
  const result = spawnSync('pnpm', commandArgs, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    die(`wrangler d1 execute failed:\n${(result.stderr || result.stdout || '').trim()}`);
  }
  // wrangler --json emits one JSON array per statement; a single statement is
  // the common case here.
  const stdout = (result.stdout || '').trim();
  const start = stdout.indexOf('[');
  const end = stdout.lastIndexOf(']');
  if (start === -1 || end === -1) die(`unexpected wrangler output: ${stdout.slice(0, 400)}`);
  try {
    const parsed = JSON.parse(stdout.slice(start, end + 1)) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) {
      const first = parsed[0] as QueryResult | undefined;
      return first ?? {};
    }
  } catch {
    die(`could not parse wrangler output: ${stdout.slice(0, 400)}`);
  }
  return {};
}

interface AccountRow {
  id: string | null;
  anchor: string;
  current_email: string | null;
}

function main(): void {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }
  if (args.help || (!args.account && !args.id) || !args.to || !args.db) {
    process.stdout.write(USAGE);
    process.exit(args.help ? 0 : 2);
  }

  const target = sqlEmail(args.to);
  const selector = args.id
    ? { sql: `id = ${sqlToken(args.id, 'account id')}`, label: `id ${args.id}` }
    : { sql: `lower(COALESCE(current_email, user_email)) = lower(${sqlEmail(args.account as string)})`, label: `account ${args.account}` };

  const found = d1(args, `SELECT id, user_email AS anchor, current_email FROM user_metadata WHERE ${selector.sql} LIMIT 1`);
  const account = (found.results ?? [])[0] as AccountRow | undefined;
  if (!account) {
    die(
      `no account matched ${selector.label}. Check the current sign-in address, or pass --id; ` +
        'migration 0032 must be applied for --id to work.',
    );
  }
  if (!account.id) {
    die(
      `account ${account.anchor} has no user_id. Either migrations/0032_user_identity.sql has not been applied, ` +
        'or this is one of the mixed-case accounts 0032 deliberately left unresolved ' +
        '(user_metadata.current_email IS NULL) — resolve those before changing an address.',
    );
  }
  const accountId = sqlToken(account.id, 'account id');

  // Takeover guard, case-insensitively: the registry key and the unique index
  // on current_email are both case-sensitive, so an exact-match check alone
  // would let two accounts differ only by case.
  const holders = d1(
    args,
    `SELECT ue.user_id, ue.is_verified, um.current_email
     FROM user_emails ue LEFT JOIN user_metadata um ON um.id = ue.user_id
     WHERE lower(ue.email) = lower(${target}) LIMIT 1`,
  );
  const registryHolder = (holders.results ?? [])[0] as { user_id: string; is_verified: number; current_email: string | null } | undefined;
  if (registryHolder && registryHolder.is_verified === 1 && registryHolder.user_id !== account.id) {
    die(
      `${args.to} is already a live login for account ${registryHolder.user_id} (current_email ${registryHolder.current_email ?? '?'}). ` +
        'Re-pointing it would hand that account to this user. Resolve the conflict first.',
    );
  }

  const otherCurrent = d1(
    args,
    `SELECT id, current_email FROM user_metadata
     WHERE lower(current_email) = lower(${target}) AND id != ${accountId} LIMIT 1`,
  );
  const currentHolder = (otherCurrent.results ?? [])[0] as { id: string; current_email: string } | undefined;
  if (currentHolder) {
    die(
      `${args.to} is the current sign-in address of account ${currentHolder.id}. ` +
        'Re-pointing it would hand that account to this user. Resolve the conflict first.',
    );
  }

  const current = account.current_email ?? account.anchor;
  const now = Math.floor(Date.now() / 1000);
  const statements = [
    `INSERT INTO user_emails (email, user_id, is_verified, created_at) VALUES (${target}, ${accountId}, 1, ${now}) ON CONFLICT(email) DO UPDATE SET user_id = excluded.user_id, is_verified = excluded.is_verified;`,
    `UPDATE user_metadata SET current_email = ${target} WHERE id = ${accountId};`,
    `UPDATE user_emails SET is_verified = 0 WHERE user_id = ${accountId} AND email != ${target};`,
  ];

  process.stdout.write(
    [
      `account   ${account.id}`,
      `anchor    ${account.anchor}  (frozen — never updated)`,
      `from      ${current}`,
      `to        ${args.to.toLowerCase()}`,
      `target    ${args.remote ? 'REMOTE' : 'local'} database '${args.db}'${args.persistTo ? ` (persist-to ${args.persistTo})` : ''}`,
      registryHolder
        ? `note      ${args.to} already existed for this account (is_verified ${registryHolder.is_verified}); it will be re-claimed`
        : '',
      '',
      'statements (applied in this order, as one batch):',
      ...statements.map((s, i) => `  ${i + 1}. ${s}`),
      '',
    ]
      .filter((line) => line !== '')
      .join('\n'),
  );

  if (args.dryRun) {
    process.stdout.write('dry run — nothing was changed.\n');
    return;
  }

  d1(args, statements.join(' '));

  const after = d1(
    args,
    `SELECT user_email AS anchor, current_email,
            (SELECT group_concat(email || ':' || is_verified, ' ') FROM user_emails WHERE user_id = user_metadata.id) AS registry
     FROM user_metadata WHERE id = ${accountId}`,
  );
  const row = (after.results ?? [])[0] as { anchor: string; current_email: string; registry: string } | undefined;
  process.stdout.write(
    [
      '',
      'applied. verify:',
      `  anchor        ${row?.anchor ?? '?'}`,
      `  current_email ${row?.current_email ?? '?'}`,
      `  registry      ${row?.registry ?? '?'}`,
      '',
      'not touched (they key on the account id and keep working):',
      '  assumable_roles, user_favorite_accounts, team_members,',
      '  user_access_tokens, audit_logs, spend_alerts, and teams.',
      '',
      'the user must sign in with the NEW address from now on; the old one',
      'stops authenticating as soon as Access propagates the change.',
      '',
    ].join('\n'),
  );
}

main();
