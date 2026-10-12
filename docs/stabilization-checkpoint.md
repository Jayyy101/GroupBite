# Stabilization and checkpoint audit — 2026-10-11

## Result and scope

The owner manually confirmed the five tabs, session email, Sign In/Sign Out,
session persistence across Simulator restarts, account switching, personal-place
isolation, Owner/Member Visit UI and archive acknowledgement reset between accounts.
The owner also confirmed Migration 12 is deployed and production privacy checks
passed. The stabilization work adds a forward-only
restaurant privacy correction, fixes account-switch mutation races, and reconciles
source documentation. No hosted calls, database updates, deployments, secrets
changes, commits, pushes, or staging were performed. Existing work is preserved.

Migration 12 replaces the authenticated-global restaurant read policy with
current group-member access. It also removes global name/address uniqueness and
limits save-time exact reuse to each selected authorized group. Restricting SELECT
alone was insufficient: the prior save RPC could return a hidden group's UUID
and inherit its first-writer cuisine. Multi-group saves still create independent
Visits; the return UUID is the first sorted group's restaurant ID, retained for
retry compatibility. Exact location bindings/readers now identify each group's
actual restaurant. Existing shared records, IDs, facts, Visits, coordinates,
receipts, memberships, and Owner/Member edit/delete powers are unchanged. Existing
previously shared rows remain available to their legitimate group members.

Group save/create/join, membership/invite/approval, and Visit management mutations
now pin authorization to the initiating account and reject disposed handlers.
Double taps on save/create/join share an in-flight lock. Late group-save and
create/join completions cannot update a replacement account or navigate its UI.
Background group-save completion does not navigate invisibly. The auth gate,
protected route groups, internal-only deep-link return paths, same-account token
refresh, and session-scoped legacy archive guard remain intact. No OTP/MFA,
provider, email-verification, or session-storage change was introduced.

## Deployment reconciliation

| Item | Evidence/status | Checkpoint action |
| --- | --- | --- |
| `geoapify-suggest` | Owner reports already deployed; exact deployed source revision unknown | Retain source/tests/diagnostics; do not redeploy |
| `geoapify-attach-personal` | Owner reports deployed and redeployed after the coordinate-tolerance fix; exact deployed source revision unknown | Retain source/tests; do not redeploy |
| Migration 11, `20261010001100_personal_geoapify_attachment.sql` | Owner confirms SQL Editor application and verified service-role-only RPC permissions; CLI history unverified | Include unchanged source in checkpoint; do not apply/reapply |
| Migrations 1–10 | Historical source retained unchanged; hosted history not inspected this pass | Do not replay historical setup instructions |
| Migration 12, `20261011001200_restaurant_catalog_privacy.sql` | Owner confirms deployment and passing production privacy checks; CLI history unverified | Include source in checkpoint; do not apply/reapply |
| Temporary `geoapify-suggest-probe` | Retained test/probe source; hosted existence/removal unknown | No deployment, removal, or other hosted action |

A future separately approved reconciliation should record migration history
(including manually applied SQL) before any CLI migration operations, and
Geoapify deployed source revisions. Owner-confirmed application does not establish
CLI ledger parity or that hosted function source equals this working tree. Existing
README deployment checklists are historical and must not be replayed. No exact
remote state, secrets, JWT settings, diagnostics state, or tracing state was inferred.

## Working-tree audit

- Tracked route deletions are intentional moves into `(app)` and `(tabs)`; their
  replacement files below must be added together. URL-free route groups preserve
  existing deep links. Root auth layout, tabs, Account and archive guard are useful
  current product code, not temporary files.
- Keep Apple Maps search/compare experiments, Swift bridge, fixtures and docs.
  Routes/adapters/native module remain development-only (`debugOnly` plus Swift
  `DEBUG` guards); Fremont/Chipotle comparison constants are deliberate experiments.
  No native source changed during this stabilization pass.
- Keep Geoapify code and its probe/tests. The checked-in production autocomplete
  gate remains false; the existing opt-in iOS development mode still requires
  explicit search, account restriction and a three-attempt local cap. Server
  diagnostics require the exact server flag. The final review found neither
  diagnostic nor native test opt-in flags in local `.env` files or the current
  shell environment. Running Metro and hosted settings were not inspected;
  no secrets values or settings were changed.
- `app.json`'s `com.anonymous.GroupBite` bundle identifier and `package.json`'s
  `expo run:ios`/`expo run:android` scripts belong to the existing native prototype.
  Keep them. Dependency maps and the lockfile are unchanged; no dependencies added.
- Generated `ios/`, `android/`, `.expo/`, `expo-env.d.ts`, `node_modules/`, build
  output, `.DS_Store`, and `.env` remain ignored. No tracked ignored files were
  found. The generated Expo router declaration produces the existing lint warning.
- Disposable validation/tool directories under `/private/tmp` are not repo files
  and are not commit candidates. Do not import credentials or live test scripts
  from them. The owned database directories created by this pass were torn down.
- Scanning pending source found no private-key blocks, Supabase secret keys, or
  literal Geoapify production keys. This is a focused source scan, not a claim
  about ignored environment files or hosted configuration.
- No unexplained source/dependency changes or generated files were found among
  the pending commit candidates. Preserve all prior work; no Geoapify retirement.

## Validation

Final results: 273 JavaScript checks, 21 native Deno runtime checks, and 8 Swift
engine checks passed. TypeScript and diff whitespace checks passed. ESLint has
zero errors and one existing generated Expo declaration warning. The catalog
harness passed nine historical SQL suites, three compatible post-correction
suites, the new privacy suite, 82 historical concurrency cases and four new
privacy cases. Migration 11's separate harness passed preservation checks,
27 attachment SQL checks and five lock-wait races. Both database fixtures were
stopped and removed. These results do not verify hosted deployment state.

All client/Edge checks use synthetic
sessions and mocked transport. Deno HTTP tests bind only to 127.0.0.1 with external
network/env access denied. SQL tests use new owned databases on private Unix
sockets; no app environment, existing database, or production service is used.

The new `validate_restaurant_catalog_privacy.mjs` runs historical SQL/concurrency
contracts before Migration 12, then verifies row preservation, unchanged unrelated
RPC definitions/grants, direct/RPC/save-oracle privacy, current/pending/former
membership, Owner/Member permissions, retries, multi-group bindings, confirmation
RPC behavior and four new concurrent cases. Historical tests that explicitly
require global Restaurant reuse remain historical tests; they do not describe
Migration 12's corrected contract. Migration 11/Geoapify attachment checks run
separately in their own clean disposable database.

Local commands (explicit previously installed tooling; no downloads):

```sh
node tests/stabilization.cjs
npm run test:auth-navigation
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js . --no-cache
node supabase/tests/validate_restaurant_catalog_privacy.mjs --postgres-bin /private/tmp/groupbite-m15-tooling/Postgres.app/Contents/Versions/17/bin --pg-module /private/tmp/groupbite-m10-validation/node_modules/pg/lib/index.js
node supabase/tests/validate_personal_geoapify_attachment.mjs --postgres-bin /private/tmp/groupbite-m15-tooling/Postgres.app/Contents/Versions/17/bin --pg-module /private/tmp/groupbite-m10-validation/node_modules/pg/lib/index.js
/private/tmp/groupbite-m15-runtime-tools/deno test --no-config --cached-only --allow-net=127.0.0.1 supabase/tests/geoapify_suggest_runtime.ts supabase/tests/geoapify_probe_runtime.ts supabase/tests/geoapify_personal_attachment_runtime.ts
node tests/apple-map-search-native.cjs
```

PostgreSQL and loopback HTTP need local sandbox permissions on this machine.
The permission exception authorizes these isolated tests, not hosted operations.

## Remaining checks and blockers

The owner-confirmed Simulator and production privacy checks above passed and
need not be repeated for this checkpoint. Outstanding manual cases not explicitly
confirmed: signed-out deep links with query parameters, sign-out/account switching
while a save is in flight, and group create/join/invite/approval/leave flows.
These have offline regression coverage; record live results separately if needed.
Use the current locally built Simulator app with
`npm start` and reload JavaScript; this stabilization needs no native rebuild.
Previously confirmed basic tabs/email/login/persistence checks need not be repeated
unless a related regression appears.

No known local code or Git-checkpoint blocker remains. Migration 12's production
privacy verification is owner-confirmed. Exact deployed function source and CLI
migration-history parity remain operational unknowns, not justification to reapply
or redeploy anything. Before wider distribution, manually confirm temporary
`GEOAPIFY_DIAGNOSTICS_ENABLED` is absent or not exactly `true`, the native Geoapify
test opt-in is off, and hosted payload/header tracing is disabled. Local source
keeps production autocomplete disabled and diagnostics opt-in; hosted settings
were not accessed. Retain useful diagnostics source/tests in this checkpoint.

Final checkpoint review: the complete working tree matches all 93 manifest paths,
with no staged paths, generated candidates, tracked ignored files, dependency or
lockfile changes, or secret-pattern matches in commit candidates. Migrations 1–10
and legacy storage code are unchanged. Only existing documentation was refreshed
after the owner's confirmations; passing code/SQL suites were not rerun. Final
whitespace checks cover both tracked diffs and every added manifest file.

Future MVP work (not checkpoint blockers): unified personal/group saving,
provider-backed durable persistence decisions, production Apple search/maps,
account deletion/recovery, author-vs-owner product policy, offline sync and photos.
Do not change these designs or retire provider code in this stabilization commit.

## Cleanup and commit plan

1. Review the diff and record the remaining manual cases separately. Keep all useful source,
   tests, documentation and migrations. Keep generated/secret/tool files ignored.
2. Preserve deployed migrations 11–12. Do not apply any SQL or deploy any function
   as part of committing. Reconcile SQL Editor history before future CLI migration
   operations; record deployed source revisions when separately checked.
3. Stage the exact pending paths below, including old route removals and their
   replacements together; inspect `git diff --cached --check` and the staged diff.
4. Create one checkpoint only after review/manual testing. Suggested subject:
   `Stabilize private catalog, authenticated tabs, and map prototypes`.
   No staging or commit has been performed by this pass.

Exact pending paths recommended for the next commit follow. Historical migrations
1–10 and existing unchanged Geoapify/probe tests remain in Git automatically.

### Modified tracked files

```text
README.md
app.json
app/_layout.tsx
app/auth.tsx
components/address-autocomplete.tsx
components/dev-apple-map.ios.tsx
components/dev-apple-map.tsx
components/visit-management.tsx
docs/milestone-15-autocomplete.md
hooks/use-address-search.ts
lib/address-search.ts
lib/geoapify-address-search.ts
package.json
providers/auth.tsx
supabase/README.md
supabase/functions/geoapify-suggest/README.md
supabase/functions/geoapify-suggest/handler.ts
supabase/functions/geoapify-suggest/http.ts
supabase/functions/geoapify-suggest/index.ts
supabase/functions/geoapify-suggest/receipts.ts
supabase/tests/geoapify_suggest.cjs
supabase/tests/validate_geoapify_runtime.mjs
tests/address-autocomplete.cjs
tests/geoapify-address-search.cjs
tests/personal-places.cjs
types/database.ts
```

### Added source, tests, documentation and migrations

```text
app/(app)/(tabs)/_layout.tsx
app/(app)/(tabs)/account.tsx
app/(app)/(tabs)/add.tsx
app/(app)/(tabs)/groups.tsx
app/(app)/(tabs)/index.tsx
app/(app)/(tabs)/my-places.tsx
app/(app)/_layout.tsx
app/(app)/add-place.tsx
app/(app)/add-visit.tsx
app/(app)/dev-apple-search.tsx
app/(app)/dev-map.tsx
app/(app)/group/[id].tsx
app/(app)/group/[id]/restaurant/[entryId].tsx
app/(app)/personal-place-form.tsx
app/(app)/personal-place/[id].tsx
app/(app)/place/[id].tsx
app/(app)/saved-places.tsx
components/dev-mapkit-preview.ios.tsx
components/dev-mapkit-preview.tsx
components/legacy-access.tsx
docs/auth-navigation.md
docs/milestone-15-apple-search.md
docs/milestone-15-personal-map.md
docs/stabilization-checkpoint.md
lib/account-session.ts
lib/apple-map-search.ts
lib/auth-navigation.ts
lib/geoapify-dev-test.ts
lib/personal-map.ts
modules/groupbite-mapkit-search/expo-module.config.json
modules/groupbite-mapkit-search/index.ts
modules/groupbite-mapkit-search/ios/GroupBiteMapKitSearch.podspec
modules/groupbite-mapkit-search/ios/GroupBiteMapKitSearchModule.swift
modules/groupbite-mapkit-search/package.json
providers/legacy-archive.tsx
supabase/functions/geoapify-attach-personal/README.md
supabase/functions/geoapify-attach-personal/handler.ts
supabase/functions/geoapify-attach-personal/index.ts
supabase/functions/geoapify-suggest/diagnostics.ts
supabase/migrations/20261010001100_personal_geoapify_attachment.sql
supabase/migrations/20261011001200_restaurant_catalog_privacy.sql
supabase/tests/geoapify_personal_attachment.cjs
supabase/tests/geoapify_personal_attachment_runtime.ts
supabase/tests/personal_geoapify_attachment.mjs
supabase/tests/restaurant_catalog_privacy.sql
supabase/tests/restaurant_catalog_privacy_concurrency.mjs
supabase/tests/validate_personal_geoapify_attachment.mjs
supabase/tests/validate_restaurant_catalog_privacy.mjs
tests/apple-map-search-native.cjs
tests/apple-map-search.cjs
tests/auth-navigation.cjs
tests/fixtures/apple-mapkit-fakes.swift
tests/geoapify-dev-test.cjs
tests/personal-map.cjs
tests/stabilization.cjs
```

### Old tracked route paths to remove as moves

```text
app/add-place.tsx
app/add-visit.tsx
app/dev-map.tsx
app/group/[id].tsx
app/group/[id]/restaurant/[entryId].tsx
app/groups.tsx
app/index.tsx
app/my-places.tsx
app/personal-place-form.tsx
app/personal-place/[id].tsx
app/place/[id].tsx
app/saved-places.tsx
```
