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
 *   pnpm exec tsx scripts/ops/change-email.ts --db aws-access-bridge --account alice@example.com --to new@example.com
 *   pnpm exec tsx scripts/ops/change-email.ts --db aws-access-bridge --id usr_ab12... --to new@example.com --dry-run
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
import { isSet, parseFlags, valueOf, type ParsedFlags } from '../lib/cli-args';
import {
  accountSelector,
  changeEmailStatements,
  isTakenByAnotherAccount,
  otherHolderCheck,
  sqlEmail,
  sqlToken,
  takeoverCheck,
  verifyStatement,
  type AccountRow,
  type RegistryHolder,
} from './change-email-plan';

const USAGE = `Usage:
  pnpm exec tsx scripts/ops/change-email.ts --db <name> (--account <email> | --id <usr_id>) --to <new-email> [--remote] [--dry-run]

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

function die(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

/**
 * The resolved run configuration, after flag validation.
 */
interface RunOptions {
  db: string;
  config: string;
  persistTo?: string;
  remote: boolean;
  dryRun: boolean;
}

interface QueryResult {
  results?: Array<Record<string, unknown>>;
}

/**
 * Runs one SQL statement (or `;`-joined batch) through `wrangler d1 execute`.
 */
function d1(options: RunOptions, sql: string): QueryResult {
  const commandArgs = [
    'exec',
    'wrangler',
    'd1',
    'execute',
    options.db,
    '--command',
    sql,
    '--config',
    options.config,
    '--json',
    ...(options.remote ? ['--remote'] : ['--local', ...(options.persistTo ? ['--persist-to', options.persistTo] : [])]),
  ];
  // eslint-disable-next-line sonarjs/no-os-command-from-path
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
      return (parsed[0] as QueryResult | undefined) ?? {};
    }
  } catch {
    die(`could not parse wrangler output: ${stdout.slice(0, 400)}`);
  }
  return {};
}

/**
 * Reads the first row of a result set, or `undefined` when there is none.
 */
function firstRow<T>(result: QueryResult): T | undefined {
  return (result.results ?? [])[0] as T | undefined;
}

/**
 * Reads the flags, exiting with usage on a bad or incomplete set.
 *
 * A non-zero exit distinguishes "you asked for help" (0) from "the invocation
 * was wrong" (2), so a wrapper can tell the two apart.
 */
function readOptions(argv: readonly string[]): RunOptions & { to: string; selector: { sql: string; label: string } } {
  let flags: ParsedFlags;
  try {
    flags = parseFlags(argv, {
      value: ['db', 'account', 'id', 'to', 'config', 'persist-to'],
      boolean: ['remote', 'dry-run', 'help'],
      alias: { h: 'help' },
    });
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }

  const help = isSet(flags, 'help');
  const db = valueOf(flags, 'db');
  const to = valueOf(flags, 'to');
  const account = valueOf(flags, 'account');
  const id = valueOf(flags, 'id');

  // Either --account or --id must identify the account, alongside --to and --db.
  const missingSelector = !account && !id;
  if (help || missingSelector || !to || !db) {
    process.stdout.write(USAGE);
    process.exit(help ? 0 : 2);
  }

  const persistTo = valueOf(flags, 'persist-to');
  return {
    db,
    to,
    config: valueOf(flags, 'config') ?? './wrangler.jsonc',
    ...(persistTo && { persistTo }),
    remote: isSet(flags, 'remote'),
    dryRun: isSet(flags, 'dry-run'),
    selector: accountSelector({ ...(account && { account }), ...(id && { id }) }),
  };
}

/**
 * Loads the account row, exiting when it is absent or pre-migration.
 */
function loadAccount(options: RunOptions, selector: { sql: string; label: string }): AccountRow {
  const found = d1(options, `SELECT id, user_email AS anchor, current_email FROM user_metadata WHERE ${selector.sql} LIMIT 1`);
  const row = firstRow<AccountRow>(found);
  if (!row) {
    die(
      `no account matched ${selector.label}. Check the current sign-in address, or pass --id; ` +
        'migration 0032 must be applied for --id to work.',
    );
  }
  if (!row.id) {
    die(
      `account ${row.anchor} has no user_id. Either migrations/0032_user_identity.sql has not been applied, ` +
        'or this is one of the mixed-case accounts 0032 deliberately left unresolved ' +
        '(user_metadata.current_email IS NULL) — resolve those before changing an address.',
    );
  }
  return row;
}

/**
 * Refuses when `to` already authenticates as a different account.
 *
 * Both checks compare case-insensitively: the registry key and the unique index
 * on `current_email` are both case-sensitive, so an exact-match check alone
 * would let two accounts differ only by case and both authenticate.
 */
function assertNoTakeover(options: RunOptions, target: string, accountId: string, to: string): RegistryHolder | undefined {
  const registryHolder = firstRow<RegistryHolder>(d1(options, takeoverCheck(target)));
  if (isTakenByAnotherAccount(registryHolder, accountId)) {
    die(
      `${to} is already a live login for account ${registryHolder?.user_id} (current_email ${registryHolder?.current_email ?? '?'}). ` +
        'Re-pointing it would hand that account to this user. Resolve the conflict first.',
    );
  }

  const currentHolder = firstRow<{ id: string; current_email: string }>(
    d1(options, otherHolderCheck(target, sqlToken(accountId, 'account id'))),
  );
  if (currentHolder) {
    die(
      `${to} is the current sign-in address of account ${currentHolder.id}. ` +
        'Re-pointing it would hand that account to this user. Resolve the conflict first.',
    );
  }

  return registryHolder;
}

function main(): void {
  const { selector, to, ...options } = readOptions(process.argv.slice(2));

  let target: string;
  try {
    target = sqlEmail(to);
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }

  const account_ = loadAccount(options, selector);
  const accountId = sqlToken(account_.id as string, 'account id');
  const registryHolder = assertNoTakeover(options, target, account_.id as string, to);

  const current = account_.current_email ?? account_.anchor;
  const now = Math.floor(Date.now() / 1000);
  const statements = changeEmailStatements(target, accountId, now);
  const persistence = options.persistTo ? ` (persist-to ${options.persistTo})` : '';
  const location = `${options.remote ? 'REMOTE' : 'local'} database '${options.db}'`;

  process.stdout.write(
    [
      `account   ${account_.id}`,
      `anchor    ${account_.anchor}  (frozen — never updated)`,
      `from      ${current}`,
      `to        ${to.toLowerCase()}`,
      `target    ${location}${persistence}`,
      registryHolder
        ? `note      ${to} already existed for this account (is_verified ${registryHolder.is_verified}); it will be re-claimed`
        : '',
      '',
      'statements (applied in this order, as one batch):',
      ...statements.map((statement, index) => `  ${index + 1}. ${statement}`),
      '',
    ]
      .filter((line) => line !== '')
      .join('\n'),
  );

  if (options.dryRun) {
    process.stdout.write('dry run — nothing was changed.\n');
    return;
  }

  d1(options, statements.join(' '));

  const row = firstRow<{ anchor: string; current_email: string; registry: string }>(d1(options, verifyStatement(accountId)));
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
