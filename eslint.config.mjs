import reactHooks from 'eslint-plugin-react-hooks';
import { defineRepoLintConfig } from '@rexezuge/tooling/eslint';

/**
 * The family's converged lint configuration.
 *
 * This file used to be 347 lines of hand-written layer rules, and it was the
 * source the kit's factory was distilled from — so keeping a copy of it here
 * meant the two drifted the moment either side changed. What is left is what is
 * genuinely this repository's: which layers it has, and the two boundaries the
 * canonical table does not name.
 */
export default [
  ...defineRepoLintConfig({
    scope: '@aws-access-bridge',

    /**
     * Only the five layers the canonical table describes in this shape.
     *
     * The default set carries entries for `apps/api`, `apps/background` and
     * `apps/web` as well. They are excluded deliberately, and this is the whole
     * reason: `apps/api` appears **four** times in the canonical table, and a
     * boundary rule resolves to one entry per directory rather than accumulating
     * across them. Naming `apps/api` here would therefore install only its last
     * row — which bans a Git service package this repository does not have —
     * and drop the DAO boundary and the `provider-clients` ban on the floor.
     *
     * The two boundaries `apps/api` needs are supplied by `extraLayers` below,
     * merged into a single entry for the same reason.
     *
     * `apps/web` is excluded for a different reason: the canonical entry bans the
     * whole namespace, and thirteen files under `apps/web/src` import
     * `@aws-access-bridge/shared` for their types and pure helpers.
     *
     * So the layer table this repository actually enforces is the five package
     * layers below plus `extraLayers`, and that is stated here rather than left to
     * be discovered by an import that stopped being flagged.
     */
    projectDirs: [
      'packages/shared',
      'packages/backend-runtime',
      'packages/backend-data',
      'packages/provider-clients',
      'packages/backend-services',
    ],

    tsconfigRootDir: import.meta.dirname,

    /**
     * Un-ignore `scripts/**`, which the factory ignores.
     *
     * The kit's set is a superset of this repository's, so nothing is *lost* by
     * adopting it — except this. The factory treats `scripts/**` as build-time
     * tooling that need not typecheck strictly, which is a reasonable default for
     * a kit and the wrong one here: `scripts/migrations/verify-migrations.ts` is
     * written in TypeScript *specifically so the script is covered by the repo's
     * lint and typecheck rules*, and it is the gate that decides whether a
     * migration may be edited at all. Silently dropping it from lint would leave a
     * load-bearing script unchecked by everything except `tsc`.
     *
     * A negated pattern is the only way back: a global ignore cannot be undone by
     * a later config object, so the entry has to be added to the same list.
     */
    extraIgnores: ['!scripts/**'],

    /**
     * The two `apps/api` boundaries, as one entry.
     *
     * `apps/api` must not reach the provider clients or `aws4fetch` directly, and
     * route classes must not import DAOs at all — type-only imports included,
     * except that a filter or model may be typed against a DAO shape.
     *
     * They are one entry because two entries for one directory would install only
     * the second, and because `allowTypeImports` is a property of a **group**, not
     * of a layer: allowing it for the DAO while denying it for `provider-clients`
     * is exactly what per-group options express and what merging the layers would
     * have lost.
     *
     * The DAO ban is scoped to `@aws-access-bridge/backend-data/dao` rather than
     * the whole `backend-data` package, which is what the canonical entry uses:
     * `HMACHandler` imports `backend-data/crypto/hmac` and `route-helpers`
     * imports `backend-data/utils/D1SessionUtil`, both outside `endpoints/` and
     * both legitimately — neither is a DAO.
     */
    extraLayers: [
      {
        dir: 'apps/api',
        ban: ['aws4fetch', '@aws-access-bridge/provider-clients', '@aws-access-bridge/backend-data/dao'],
        allowTypeImports: true,
        message:
          'apps/api must not import aws4fetch, provider-clients or a DAO directly — add a method to the owning backend-services domain service and call it through the request scope. Type-only imports are allowed.',
      },
    ],
  }),

  /**
   * The kit deliberately leaves `react-hooks` to the consumer.
   *
   * It is the one plugin whose rules are about a *framework* rather than about
   * code quality, and shipping a preset for it in a package that has to work for
   * a non-React repo would mean either a peer dependency every consumer must
   * satisfy or a config entry that throws when the plugin is absent. The factory
   * names the omission in its own header; these four lines are the answer.
   */
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs['recommended-latest'].rules,
  },
];