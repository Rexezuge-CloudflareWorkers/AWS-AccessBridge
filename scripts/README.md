# scripts/

Repo tooling, grouped by who runs it. Every script is TypeScript and is covered
by `pnpm run lint` and `pnpm run typecheck:scripts`.

| Directory      | Runs from             | Purpose                                                               |
| -------------- | --------------------- | --------------------------------------------------------------------- |
| `lib/`         | imported              | Reusable helpers. No side effects on import.                          |
| `build/`       | `pnpm install`        | Keeps a fresh clone typecheckable before the first build.             |
| `deploy/`      | `deploy-worker` job   | Materialize `wrangler.jsonc` and provision its resources and secrets. |
| `backup/`      | `backup-d1.yml`       | One entrypoint per workflow step.                                     |
| `ops/`         | a human at a terminal | Destructive or data-touching operations.                              |
| `i18n/`        | a human, or CI        | Web locale validation (also in `checks` and the `locales` CI job).      |
| `migrations/`  | a human, or CI        | The migration checksum lock. See `../docs/agents/runtime/AGENTS.md`.   |

## Entrypoint vs module convention

Followed across the sibling repos (`Mail-Meow`, `Durable-DAV`,
`Durable-DAV-Router`), so `scripts/**` needs no ESLint rule overrides:

- An **entrypoint** starts with `#!`, runs at top level, and exports nothing.
  `unicorn/no-exports-in-scripts` fires only on files whose first line is `#!`,
  so keeping exports out of entrypoints is what lets these files be linted at
  all.
- A **module** has no `#!` and exports freely. Testable guards and shared
  helpers live here, and are imported by both the entrypoint and `test/scripts/`.

`prepare-wrangler-config.ts` is the clearest example: it is five lines of
ordered calls into `lib/wrangler-config/`.

## lib/

| Module                         | Contents                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `wrangler-config/types.ts`     | `wrangler.jsonc` paths, placeholder ids (`DEFAULT_UUID`, `DEFAULT_HEX_ID`), config interfaces.        |
| `wrangler-config/cli.ts`       | `runWrangler`, `parseJsonArray`.                                                                      |
| `wrangler-config/patches.ts`   | Read/rewrite `wrangler.jsonc`, `WRANGLER_JSONC` / `WRANGLER_PATCH_JSON` / `WRANGLER_VARS_PATCH_JSON`. |
| `wrangler-config/resources.ts` | Create missing D1 / KV / Secrets Store resources and patch their ids in.                              |
| `wrangler-table.ts`            | Parses the `cli-table3` output `wrangler secrets-store` prints.                                       |
| `github-actions.ts`            | `setOutput`, `logError`, `fail`. No `@actions/*` dependency, so scripts stay runnable locally.        |
| `cli-args.ts`                  | Flag parsing for `ops/` and `migrations/` scripts.                                                   |

`DEFAULT_UUID` is the single definition of the placeholder D1 id. `deploy/`
writes a real id over it and `backup/` refuses to export while it is still
present, so the empty-database guard cannot drift from what provisioning emits.

## Running one locally

CI entrypoints are runnable from a local shell with the same flags Actions uses:

```bash
pnpm exec tsx scripts/backup/evaluate-destination-config.ts
pnpm exec tsx scripts/deploy/prepare-wrangler-config.ts
pnpm run validate:locales
pnpm run validate:migrations
```

After adding a migration, `pnpm run migrations:lock` records it. It is add-only for
incremental migrations and refreshes the squashed baseline, so it will not adopt
the new digest of one that has already been applied.

`validate:migrations` and `validate:locales` both run from `pnpm run checks` and
from their own CI jobs, so the local gate and CI agree. Both are `tsx`, not
`node`: each entrypoint imports a sibling module with an extensionless relative
path, which Node's ESM resolver will not resolve.

There is no committed `wrangler.jsonc`. `scripts/deploy/prepare-wrangler-config.ts`
creates it, and both `deploy/` and `backup/` expect it to exist.

## Adding a script

1. Put pure logic in a module next to the entrypoint, or in `lib/` if more than
   one script needs it.
2. Give the entrypoint a `#!` and no exports.
3. Cover the module with a test in `test/scripts/` (or `test/backup/` for the
   backup workflow).
4. Export nothing that only the entrypoint needs. If a test needs it, that is a
   signal the logic belongs in the module.
