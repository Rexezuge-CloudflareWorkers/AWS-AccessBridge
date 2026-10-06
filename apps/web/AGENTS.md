# AWS-AccessBridge — Web SPA

Scope: `apps/web/**`. Parent index: [`../../AGENTS.md`](../../AGENTS.md). Workspace and layer rules: [`../../docs/agents/repo/AGENTS.md`](../../docs/agents/repo/AGENTS.md).

Vite React SPA served at `/user/` — the canonical entry, protected by Cloudflare Access, so
top-level navigation there triggers the Zero Trust login. Pages live under `/user/app/*`. Entry
`src/main.tsx` → `src/SpaApp.tsx`: auth gate via `useAuth`, language state via `hooks/useSpaLanguage`,
routing via `hooks/useRouter`, and a `SpaNavbar` with a controlled `LanguageSelector` and the toast
banner.

## One request path

`src/lib/api.ts` holds `apiRequest<T>`, the **only** request helper, and the `ApiError` /
`throwForResponse` / `isUnauthorized` plumbing. The old `apiFetch` / `apiCall` compat layer is gone
after every admin tab bypassed it in production — which is also how 9 of its 17 functions ended up
with no caller and two contract mismatches hid inside it.

Two things to reach for instead of hand-rolling:

- `readJson<T>(response)` rather than `(await res.json()) as T` — the latter trips
  `no-unnecessary-type-assertion`.
- A service in `src/services/`, never `fetch` inside a component or a hook.

`apiRequest<T>` raises `ApiError` (not `SyntaxError`) for a non-JSON 2xx body, so `isUnauthorized`
and the `Unauthorized` screen still work.

## Pure logic belongs in `lib/`, not in a component

| File                  | Holds                                                                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/routes.ts`       | `routeForPathname` / `pathForView` / `isAdminPath` — the pathname↔view mapping, pure so it is testable without a DOM. `hooks/useRouter` owns only the `location` read and the popstate listener |
| `lib/presentation.ts` | `pageNumbers`, `resourceStateColor`, `httpStatusColor`                                                                                                                                          |
| `lib/requestGuard.ts` | `createRequestGuard` — the framework-free ordering rule behind `hooks/useRequestGuard.ts`                                                                                                       |
| `lib/authOutcome.ts`  | `classifyAuthFailure` — 401 → `expired-session`, everything else → `load-failed`                                                                                                                |
| `lib/format.ts`       | locale-aware dates and numbers; `formatAmount` renders a symbol-less "mixed currency" figure when the currency is `null`                                                                        |
| `lib/shellExport.ts`  | `formatShellExport`, the canonical home of the shell snippet (both rendered and copied text)                                                                                                    |
| `lib/constants.ts`    | `ZERO_TRUST_AUTHENTICATION_PATH`, `DEFAULT_TEAM_ID`                                                                                                                                             |

Keep new pure logic there rather than as a module-private function inside a component — a private
function inside a `.tsx` reads as covered when it is not, and the logic is untestable without a DOM.

Dates and numbers must pass an explicit locale (`i18n.resolvedLanguage`); never rely on the ambient
default.

## Overlapping requests must be guarded

Hooks and components that can issue overlapping requests **must** use
`hooks/useRequestGuard.ts` (`begin()` / `isCurrent()` / `invalidate()`), never a hand-rolled counter.
A slower earlier request must not render after a newer one — search boxes and pagination both trigger
the overlap — and the check belongs before _every_ `setState`, including the loading flag.
`AccountList` and `AuditLogsTab` were the two places that had no guard, which is why the rule now
lives in one tested factory rather than in each caller.

Mount effects follow the `useCurrentUser` shape: a single promise chain with `setState` only inside
`.then` / `.catch`, never a component-scope fetcher or a synchronous `setState` in the effect body.
Event-handler fire-and-forget calls take an explicit `void` prefix.

## Toast state is shared, and its timer is ref-held

`hooks/useToast.ts` owns `message` / `showMessage` / `dismiss`, passed down as `showMessage`.
`ShowMessage` is the exported prop type — take it rather than re-spelling
`(type: 'success' | 'error', text: string) => void`, which was copy-pasted into every feature tab's
props. The dismissal timer lives in a ref, so a new toast replaces the old one's timer instead of
being dismissed early by it, and unmounting does not leave a timer calling `setState` on a component
that is gone.

Domain hooks `useTeams` / `useResources` / `useRouter` / `useAccountMutations` /
`useOnboardingWizard` / `useSpaLanguage` own fetching and state per vertical slice.

## A failure is not an empty answer

**`loadSummary` in `resourceService` throws; it does not resolve `null`.** It used to
`return res.ok ? readJson(...) : null`, which made a 500 indistinguishable from an account with no
resources — the inventory rendered its empty state and the failure was never surfaced. `useResources`
already has a `summaryError` path for exactly this, and a service that swallows errors into `null`
makes it unreachable.

`Unauthorized` takes a `reason` so a _failed profile load_ gets a reload button instead of a login
prompt, since re-authenticating cannot fix a 500. Same reasoning in `lib/authOutcome.ts`.

## All admin mutations go through `adminService`

The seven `components/admin/*Tab.tsx` files used to call the removed `apiFetch` directly. Now every
mutation is an `adminService` function, which is what makes the contract visible in one place: two
mismatches were hiding there — `cleanupOrphaned` typed `{deleted}` against the route's per-table
`deletedCounts` + `failures`, and `enableDataCollection` sent a singular `collectionType` where the
route requires `collectionTypes`.

## Components

`src/components/`: feature tabs — `AccountList` (+ extracted `AccountRoleRow`,
`HideRoleConfirmDialog`), `CostDashboard`, `ResourceInventory` (+ `ResourceRow`,
`ResourceSummaryCards`), `AuditLogsTab`, `TeamsTab` (handlers only; its three sections are
`teams/TeamListSection`, `teams/TeamMembersSection`, `teams/TeamAccountsSection`) — plus
`AdminPage` (shell) with `admin/` one-file-per-tab (`Credentials`, `Access`, `Accounts`,
`RoleConfig`, `SpendAlerts`, `DataCollection`, `MaintenanceTab`), the `OnboardingWizard` shell with
`onboarding/` per-step components and `WizardProgress`, `SpaNavbar`, `LanguageSelector`,
`AccessKeyModal`, `ui/` primitives, and `Unauthorized`.

### `useOnboardingWizard` is deliberately over the god-file warn limit

It is the one file above 300 lines, at 318, and the `check:god-files` warning is intentional: its
length is 25 state slices for six steps whose cross-field invalidation _is_ the design (editing a
credential clears `credentialValidated`; editing the intermediate ARN clears `chainConfigured`).
Splitting it per step would fragment a coherent state machine — trading a warning for worse structure.

What _was_ duplication has been extracted and tested: the two batch loops live in
`hooks/onboardingBatches.ts` (`settleAll`, which counts failures rather than aborting and stays
sequential because the operations are AWS-backed writes), the repeated "reset validation on edit"
setters are one factory, and the five per-action spinner booleans are one `busyAction` flag. Prefer
new pure or batch logic in `hooks/` over growing this file.

## The favicon is generated

`public/favicon.svg` is the bridge-mark icon and the **single source of truth** for it. The
`favicon-inline` Vite plugin rewrites the `<link rel="icon">` placeholder in `index.html` into a
`data:` URI at build time, so the Worker never serves it. Do not paste a data URI into `index.html` —
it is generated, and a missing `public/favicon.svg` or a missing placeholder fails the build rather
than shipping a broken icon.

`public/_routes.json` scopes Pages routing to `/`, `/user`, `/user/*`, `/api/*`, `/docs*`,
`/openapi.*`, excluding `/assets/*`.

## Frontend Internationalization

SPA UI strings live in `src/locales/<tag>/translation.json` — **12 locales**: `en`, `de`, `fr`, `es`,
`it`, `nl`, `pt`, `pl`, `ja`, `zh-CN`, `zh-TW`, `ko` — consumed via `useTranslation()`.
Always pass the English default: `t('ns.key', 'English Default')`, so a missing key still renders.

- **Adding a key**: add it with its English default to `en/translation.json` first, then mirror it
  into the other 11 bundles in the same key order. Validate with `pnpm run validate:locales`
  (`scripts/i18n/validate_locales.ts`, rules in `scripts/i18n/locale-checks.ts`, unit-tested in
  `test/scripts/locale-checks.test.ts`; both `pnpm run checks` and the `locales` CI job run it). It
  checks JSON validity, key parity with no extras, `{{placeholder}}` parity, and no empty or
  non-string values **in `en` as well as the others** — `en` is the fallback for every missing key,
  so an empty value there is indistinguishable from a missing one and is what a user actually sees.
  It also cross-checks the declared tag lists against the directories in both directions:
  `SUPPORTED_LANGUAGES` (`src/i18n.ts`) and `SUPPORTED_LOCALES` (`shared/utils/LocaleUtil.ts`) must
  agree with each other and with the `locales/<tag>/` directories. A tag declared with no directory
  makes `loadLanguage` throw; a directory no tag names can never be loaded. The tag lists are parsed
  from source text rather than imported, because `src/i18n.ts` calls `import.meta.glob` and only
  exists after Vite's transform. Key **order** is deliberately not checked.
- **Lazy loading**: `src/i18n.ts` code-splits per-locale chunks (`loadLanguage`, `import.meta.glob`;
  `normalizeLanguage` delegates to shared `LocaleUtil`). Never statically import a non-English
  locale — only `en` is static, and importing the rest breaks code-splitting (Vite's
  `INEFFECTIVE_DYNAMIC_IMPORT` warning).
- **Detection precedence**: backend `preferredLanguage` (`GET /user/me`) >
  `localStorage('aws-access-bridge-lng')` > `navigator.language` > `en`.
  `hooks/useSpaLanguage` owns it — explicit `language` / `languageStatus` / `languagePending`, a
  `languageChanged` listener, `<html lang>` sync, a backend-authoritative save
  (`load → PUT → localStorage → setUser`), and an `unknown` error state that disables the controlled
  `LanguageSelector`.
- **There is no backend locale bundle.** `shared/src/i18n/` and its twelve empty `strings: {}`
  tables were removed: no `src` file called `getBackendStrings`, every table was empty, and all
  twelve declared `locale: 'en'` — so `getBackendStrings('de').locale` returned `'en'` while a test
  asserted that wrong answer as correct. `validate:locales` covers the web catalogs only, so a
  passing check says nothing about server-side text. If backend translation is ever added, start from
  `LocaleUtil` / `SUPPORTED_LOCALES` and add a validator in the same change; do not reintroduce
  unvalidated tables.
- API error `Message` strings stay English, with stable `Type` codes. Translate display-side only.

## Web UI Text Conventions

**English-source** user-visible text in `apps/web/` must use **Title Case**: button labels, headings,
card titles, section headers, form labels, placeholders, empty-state messages, toasts, confirm
dialogs, `aria-label`, `<option>` text. Translations use each language's natural casing — Title Case
is English-only.

**Never hardcode ALL CAPS in JSX.** Use CSS (a Tailwind `uppercase` / `text-transform: uppercase`)
instead.

**Exceptions** (no Title Case): `<code>` content, technical URI placeholders, dynamic API response
content.
