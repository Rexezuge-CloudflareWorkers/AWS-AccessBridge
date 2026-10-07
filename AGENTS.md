# AWS-AccessBridge — Index

**AWS-AccessBridge** is a self-hosted AWS multi-account access portal on Cloudflare Workers: a
Hono + Chanfana API, a cron Durable Object, and a Vite React SPA in one pnpm workspace. Engineers
sign in with Cloudflare Zero Trust, see which AWS roles they may assume across connected accounts,
assume them (multi-hop), mint temporary Console URLs, and watch spend and inventory. IAM
credentials live encrypted in D1; the cron pre-assumes hot chains into KV so the interactive path
never waits on a cold assume-role.

This file is an index and the commit policy. Everything else has a home, and each home has a
reader: the split is by **who needs the answer**, not by directory.

## Guides

### Cross-cutting

| Area                                                               | Guide                                                            |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Working in this repository: workspace, layers, commands, gates, CI | [`docs/agents/repo/AGENTS.md`](docs/agents/repo/AGENTS.md)       |
| Bindings, secrets, env vars, migrations, backups                   | [`docs/agents/runtime/AGENTS.md`](docs/agents/runtime/AGENTS.md) |
| The suite, the thresholds, the doubles, the emulator tier          | [`docs/agents/testing/AGENTS.md`](docs/agents/testing/AGENTS.md) |

### By area

| Area                                            | Guide                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| API worker: auth, routes, the error envelope    | [`apps/api/AGENTS.md`](apps/api/AGENTS.md)                                   |
| Background worker: cron phases, task visibility | [`apps/background/AGENTS.md`](apps/background/AGENTS.md)                     |
| Operator SPA: i18n, UI text conventions         | [`apps/web/AGENTS.md`](apps/web/AGENTS.md)                                   |
| D1, the DAOs, KV, encryption, write discipline  | [`packages/backend-data/AGENTS.md`](packages/backend-data/AGENTS.md)         |
| Services, the composition root, the DI contract | [`packages/backend-services/AGENTS.md`](packages/backend-services/AGENTS.md) |

### By feature

| Area                                                        | Guide                                                                                                    |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Assume-role flows: browser, programmatic, federate          | [`docs/agents/features/assume-role/AGENTS.md`](docs/agents/features/assume-role/AGENTS.md)               |
| Credential chains: encrypted storage, hops, KV cache        | [`docs/agents/features/credential-chains/AGENTS.md`](docs/agents/features/credential-chains/AGENTS.md)   |
| Cost Explorer collection and spend alerts                   | [`docs/agents/features/cost-analytics/AGENTS.md`](docs/agents/features/cost-analytics/AGENTS.md)         |
| Resource inventory: regions, pagination, pruning            | [`docs/agents/features/resource-inventory/AGENTS.md`](docs/agents/features/resource-inventory/AGENTS.md) |
| Team workspaces                                             | [`docs/agents/features/teams/AGENTS.md`](docs/agents/features/teams/AGENTS.md)                           |
| User identity: account key, frozen anchor, address registry | [`docs/agents/features/identity/AGENTS.md`](docs/agents/features/identity/AGENTS.md)                     |

### Also

| Area                                              | Guide                                                      |
| ------------------------------------------------- | ---------------------------------------------------------- |
| Deploying, onboarding, IAM setup, troubleshooting | [`README.md`](README.md)                                   |
| The nightly D1 backup and how to restore it       | [`docs/db-backup-recovery.md`](docs/db-backup-recovery.md) |
| `scripts/**` layout and the entrypoint convention | [`scripts/README.md`](scripts/README.md)                   |

## The invariants

The rules this repository learned the hard way, each written once in the guide whose reader needs
it. A guide that grows a rule nobody can act on is a rule nobody reads — so where a rule spans two
areas, the guide that owns the _code_ keeps it and the other links.

Two shapes recur among them. **A claim nothing measures is not an invariant**: a comment, a
default, a typed constant beside the code it bounds, and a double that shares the code's
assumptions have each carried a defect through a green suite here. And **an empty answer is not an
answer** — every place this code once turned "we were denied" or "the request failed" into `[]`,
`null`, or `0`, a caller downstream read it as "there is nothing here" and deleted real data.

## Keeping these current

Update the guide whose reader needs the change, in the same change — never this index. Routes →
`apps/api`. Cron tasks → `apps/background`. UI, locales, text conventions → `apps/web`. DAOs, KV,
encryption → `packages/backend-data`. Services and the composition root → `packages/backend-services`.
Env vars and bindings → `docs/agents/runtime`. Tests and thresholds → `docs/agents/testing`.
Commands, layers, gates → `docs/agents/repo`. A top-level feature gets a
`docs/agents/features/*/AGENTS.md`. `shared`, `backend-errors`, `backend-runtime` and
`provider-clients` have no scoped guide; document their use in the closest consumer's guide.

## Commit Policy

Always commit changes after completing work unless explicitly told not to.

## Git Commit Messages

Format: `<TYPE>[optional scope]: <description>`

- Type in UPPERCASE: `FIX`, `FEAT`, `DOCS`, `STYLE`, `REFACTOR`, `TEST`, `BUILD`, `CHORE`, `CI`, `PERF`.
- Scope in lowercase: `FEAT(runtime): Add Scheduled Job State`.
- Description: Title Case words — `DOCS: Latest Agents Context Reflection`.
- When committing from `main`, first create a branch: `type/description` or `type/scope/description` in kebab-case (e.g. `feat/bootstrap/bootstrap-jqanywhere-v0.1-framework`).
- Always include a Markdown body separated from the subject by a blank line.
- Breaking changes: `!` after type/scope, or `BREAKING CHANGE: <description>` footer.
- AI-assisted commits must include attribution footers: `Assisted-by: OpenCode` and `Model-ID: <providerID/modelID>` with the full ID (e.g. `opencode/muse-spark-1.3-contributor-free`).

```text
<TYPE>[optional scope]: <description>

[Markdown body]

[optional footers]
Assisted-by: OpenCode
Model-ID: <providerID/modelID>
```
