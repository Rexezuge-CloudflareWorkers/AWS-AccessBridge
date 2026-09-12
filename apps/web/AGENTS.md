# AWS-AccessBridge — Web SPA

Scope: `apps/web/**`. Parent index: `../../AGENTS.md`.

Vite React SPA served at `/user` (Worker assets + Pages). Entry `src/main.tsx` → `src/SpaApp.tsx` (auth gate via `useAuth`, pathname routing, `SpaNavbar` with `LanguageSelector`). `src/lib/api.ts` holds `apiFetch`/`apiCall` plus the generic `readJson<T>` helper (use it instead of `(await res.json()) as T` — the latter trips `no-unnecessary-type-assertion`) and the `ApiError`/`throwForResponse`/`isUnauthorized` plumbing; `src/lib/locale.ts` (`applyLanguage`, `persistLanguage`, `syncHtmlLang`) and `src/lib/format.ts` (locale-aware dates/numbers) back i18n. `src/lib/constants.ts` holds UI constants. Components under `src/components/`: feature tabs (`AccountList`, `CostDashboard`, `ResourceInventory`, `AuditLogsTab`, `TeamsTab`, `AdminPage`, `OnboardingWizard`, `AccessKeyModal`) + `ui/` primitives + `Unauthorized`.

`public/favicon.svg` is the bridge-mark favicon (referenced from `index.html`); `public/_routes.json` scopes Pages routing to `/api/*`, `/user/*`, `/docs*`, `/openapi.*`.

Data fetching lives in `src/services/` (`authService`, `accountService`, `costService`, `resourceService` — module-scope fetchers returning typed data, throwing `ApiError`). Mount effects must follow the `useCurrentUser` shape — a single promise chain with `setState` only inside `.then`/`.catch` (never call a component-scope fetcher or set state synchronously in the effect body); event-handler fire-and-forget calls take an explicit `void` prefix.

## Frontend Internationalization

SPA UI strings live in `src/locales/<tag>/translation.json` (12 locales: `en`, `de`, `fr`, `es`, `it`, `nl`, `pt`, `pl`, `ja`, `zh-CN`, `zh-TW`, `ko`) consumed via `useTranslation()` (`t('ns.key', 'English Default')` — always pass the English default so missing keys still render). Rules for new UI text:

- Add the key + English default to `en/translation.json` first, then mirror it into the other 11 locale files (same key order). Validate with `scripts/validate_locales.py` (JSON-valid, key parity incl. no extra keys, `{{placeholder}}` parity, no empty values).
- Lazy loading: `src/i18n.ts` code-splits per-locale chunks (`loadLanguage`, `import.meta.glob`); never statically import a non-English locale (only `en` is static; breaks code-splitting — see Vite `INEFFECTIVE_DYNAMIC_IMPORT` warning).
- Detection precedence: backend `preferredLanguage` (`GET /user/me`) > `localStorage('aws-access-bridge-lng')` > `navigator.language` > `en`. `SpaApp` applies it and keeps `<html lang>` in sync.
- Dates/numbers: `lib/format.ts` helpers take optional `lng` (pass `i18n.resolvedLanguage`); ad-hoc `toLocale*()` must pass an explicit locale, never rely on the ambient default.
- Backend user text uses `getBackendStrings(locale)` from `@aws-access-bridge/shared/i18n` — add keys to `BackendStrings.ts` + `locales/en.ts`, then mirror into the 11 backend locale files. API error `Message` strings stay English (stable `Type` codes); translate display-side only.

## Web UI Text Conventions

**English-source** user-visible text in `apps/web/` must use **Title Case**. Applies to: button labels, headings, card titles, section headers, form labels, placeholders, empty-state messages, toasts, confirm dialogs, `aria-label`, `<option>` text. Translations use each language's natural casing (Title Case is English-only).

**Never hardcode ALL CAPS in JSX.** Use CSS (`uppercase` Tailwind / `text-transform: uppercase`) instead.

**Exceptions** (no Title Case): `<code>` content, technical URI placeholders, dynamic API response content.
