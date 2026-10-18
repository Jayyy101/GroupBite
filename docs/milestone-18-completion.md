# Milestone 18 — completion and final commit review

Current as of October 18, 2026. This is the authoritative completion status;
implementation, backup and deployment reports retain their historical phase
context. This final review changed documentation only. No hosted access, data
writes, migrations, cleanup, seeding, dependency installation, staging, commit or
push occurred during this review.

## Decision

Milestone 18 is ready for **review of the proposed commit**. No remaining
functional commit blocker was identified by this review and the available test
evidence. This is not release approval or a claim that every fault case has been
tested manually on a device. Friends testing has the separate gates below.

The base is Milestone 17, `9bfd597445a6b1bdf5f3e3dad40df2c6d33d3ecd` on `main`.
The approved five-tab structure and Milestones 16D/17 safeguards remain. App
dependency manifests and migrations 1–14 are unchanged.

## Completed functionality

- Restaurant-first unified Add uses native Apple MapKit search, recent choices
  or manual entry. Search results are selectable full-address list cards, without
  oversized inline maps. All destinations start unchecked, including recent
  choices and group entry points. Explicit visit fields are independent of
  restaurant selection; private notes never enter group payloads.
- My Places has owner-private visit history, revision-checked edit/delete,
  restaurant facts editing, and average/rated/total visit summaries. Deleting a
  last personal visit retains its restaurant card. Empty legacy cards get no
  invented visits. Personal mutations use RPCs rather than retired direct writes.
- Personal and each group save resolve identity inside the authorized destination.
  Independent destination transactions support partial success. A group visit,
  legacy binding/receipt and required reconciliation receipt commit atomically.
  Request fingerprints, membership incarnations, locks and account-pinned calls
  preserve idempotency and concurrency protections.
- Saved links open the correct personal/group detail inside Add's own stack.
  Back returns to Saved; normal browsing returns to its own parent. Done and
  later Add selection reset completed saves only after all results are confirmed
  and local journal removal succeeds. Pending/uncertain state is preserved.
  Recent display deduplication does not merge underlying database records.
- Selected personal MapKit coordinates persist independently of an optional
  Apple Place ID, in an owner-private location store separate from verified
  Geoapify data. Save, visit, receipt and point proof are atomic. No coordinates
  or provider IDs are invented. Changing the saved address invalidates its point.
- Unresolved/failed/unreadable recovery offers explicitly confirmed **Start a
  separate Add**. Old account-scoped request markers are archived before reset;
  **Previous save recovery** retains read-only reconciliation and available entry
  links. New workflows use independent request identities. Unknown writes are
  never automatically replayed and database receipts are never changed.
- A storage-preservation failure requires a second explicit temporary-recovery
  acknowledgement. Users are warned that restart/sign-out may lose that access
  and that the old recovery screen may return. New writes still require safe
  recovery evidence and journal storage. Corrupt evidence is quarantined where
  possible; unreadable request IDs cannot be promised in-app recovery.

## Deployed backend and compatibility

The prior authorized hosted verification established migrations **1–17 applied**
on GroupBite `goperhgeqyqzepbtwtaz`. No fresh hosted inspection was made for this
commit review. The three local migration files retain the deployed checksums:

| Migration | SHA-256 |
| --- | --- |
| `20261017001500_personal_visit_history.sql` | `8a5b249f039fb4619f0754aaf477e16a958b97a782c37ec7667d26dbed67c41e` |
| `20261017001600_unified_add_destinations.sql` | `75272321fe61d56e4a18e2bcb68bbfaabf6699f62b92f19361b80efb3e13703c` |
| `20261018001700_personal_mapkit_locations.sql` | `deeef1c0e92e26ad3b5316002e868f9e1716e25a6e184c7df619c94512d9bbec` |

Deployments preserved capture-time rows, IDs, ownership, revisions, relationships,
permissions and existing group functionality. Migration 15 backfilled four real
legacy memories while leaving two empty cards without visits. Migration 17
preserved all **126 pre-existing application rows**, including seven personal
visits and seven destination receipts. These are historical preservation counts,
not current totals after subsequent simulator saves.

Owner-only location reads, denied anonymous RPC access, RLS and function execution
grants were verified in the deployment phase. The REST diagnostic's HTTP **401 /
42501** was the expected anonymous permission denial, not a schema-cache failure.
The compatible development app has subsequently restarted successfully. Do not
reapply migrations, restore old personal direct-write clients, or rerun historical
repair/deployment instructions.

Evidence: [15/16 deployment](milestone-18-hosted-deployment.md),
[17 deployment](milestone-18-migration-17-deployment.md),
[REST diagnostic](milestone-18-rest-verification.md).

## Acceptance ledger

**Owner-confirmed simulator results:** saving to My Places, Date Nights and
Friends; personal and group visit history; accurate Apple Maps restaurant search;
existing In-N-Out location-only repair with the original single visit preserved;
In-N-Out's map pin; Special Noodle saved through unified Add and automatically
mapped; both map pins visible. Latest acceptance additionally confirmed Special
Noodle opens Add, all three destinations start unchecked, and Back returns to
clean Add without saving.

**Automated, not a claim of native fault acceptance:** account replacement,
permissions/privacy isolation, destination identity, partial/uncertain saves,
receipt reconciliation, recovery storage failure/corruption, restarts, repeated
taps, navigation guards and location repair safety. Client fixtures execute the
actual controller/components with synthetic HTTP/storage/native boundaries.
Historical SQL/RLS/concurrency and restored-snapshot rehearsals provide separate
real-database evidence.

**Still useful on the simulator/device:** Saved destination links and Back/edge
swipe from a multi-destination result; Done then Add-tab root reset; dirty form
Back/tab protections; large text, keyboard dismissal and bottom-button visibility;
account switching/backgrounding; explicitly confirmed separate Add and archived
read-only recovery if an unresolved save already exists. Do not manufacture
hosted faults, corrupt app storage or create/delete test records just to expose
these controls. Response loss after commit and membership replacement should use
an isolated fault-testing setup. Native release/TestFlight behavior remains a
separate acceptance task. No new pass is inferred for these scenarios.

## Final local validation

All 22 `tests/*.cjs` entry points exited successfully, producing **324 named PASS
checks**; `router-fixture.cjs` is a support module with no named checks. The total
includes 21 focused recovery completion cases and all 31 Milestone 17 safety
checks. The Swift search-engine suite is included in this client/native loop.

Commands/results:

- Execute each sorted `tests/*.cjs` with the existing Node 24.18.0: **324 PASS**.
- `./node_modules/.bin/tsc --noEmit --incremental false`: **pass**.
- `npm run lint -- --no-cache`: **pass**, no warnings in its app scope.
- `./node_modules/.bin/eslint . --no-cache`: **0 errors, 3 warnings**. Two are
  unused `button`/`textOf` imports in `tests/personal-mapkit-persistence.cjs:4`;
  one is a generated, ignored `.expo/types/router.d.ts` disable directive. These
  are non-blocking; no implementation edits were made to silence them.
- Tracked diff whitespace and every untracked text file: **pass**.
- JavaScript syntax checks for changed/new Supabase runners: **pass**.

The early **230** count came from consolidating checks around retired separate
creation forms; it was not a failed invocation of the 300-check Milestone 17
suite. Follow-ups expanded 230 to 244 and then 324 as navigation, usability,
location persistence/repair and recovery coverage were added. Counts measure
named cases, not a coverage percentage; they exclude separately reported SQL,
concurrency, Edge Function and native provider-probe results. Expensive database
rehearsals were not repeated during this documentation review. See
[historical validation](milestone-18-unified-add.md#historical-phase-b-validation)
and the [recovery contract](milestone-18-recovery-completion.md).

## Security, artifacts and backup limits

The full tracked/untracked nonignored file inventory was reviewed, including the
intentional old Add-route deletion, operator SQL templates and fixture/test
sources. A heuristic content scan found no private key, JWT, Supabase secret or
personal token, AWS access key, GitHub token, or password-bearing PostgreSQL URL.
This is a scoped pattern review, not a guarantee that every conceivable secret
format is detected. Existing binary assets are tracked app images; no new binary,
private snapshot, generated output or temporary runner is in the candidate set.

`.env`, `.expo/`, `node_modules/`, generated native folders and Supabase CLI
metadata are ignored and excluded. Environment files were not printed. Backup
CSVs, private manifests and restoration/deployment evidence remain outside Git in
restricted durable storage under `GroupBite Backups` on the owner's Desktop.
Reports contain checksums/counts and operator paths, not private exported rows or
credentials. Only the explicit manifest below should be staged after approval;
ignored files must not be force-added.

The pre-15/16 and pre-17 application snapshots were restored and rehearsed in
isolated local PostgreSQL databases during their approved phases. They are
historical application logical backups, not a complete Auth/Storage/cluster
backup or PITR. They do not cover later simulator visits or migration-17 point/
proof records. Any future cleanup or data operation needs a fresh, separately
approved consistent snapshot of all **18 application tables**, relevant schema,
permissions and dependencies, plus a verified restoration plan. Existing cleanup
and fixture scripts remain unexecuted; repeated Chick-fil-A names alone do not
justify cleanup or identity merges. Historical SQL export scripts must be checked
against the current table scope before reuse.

## Friends-testing gates and deferred polish

These do not block committing the explicitly documented development scope:

1. **Disable temporary location repair before friends testing.**
   `DEV_PERSONAL_LOCATION_REPAIR_ENABLED` in `lib/personal-location-repair.ts`
   remains `true`. Both its component and helper independently require `__DEV__`;
   the UI also requires native iOS MapKit and an owner-scoped missing-location
   check. Set the flag false (or remove the component/mount) in a separate small
   approved implementation pass. Development mode alone is insufficient when
   friends use a debug build. No new repair is authorized by this report.
2. Hide developer search/provider diagnostics, saved-ID lookup probes and
   fictional autocomplete choices from the friends-facing workflow. Review
   `dev-map`, `dev-apple-search`, personal/group picker/lookup controls,
   `components/personal-place-fields.tsx` and existing Geoapify opt-in controls.
   Preserve intended restaurant search and map behavior; diagnostic controls and
   normal map viewing need separate treatment. Existing JS development/iOS and
   Swift `DEBUG` safeguards are still in place. Geoapify remains opt-in/gated;
   do not relax those restrictions as part of documentation or commit preparation.
3. Choose the friends build/distribution scope. Current release/non-iOS/Expo Go
   builds retain manual/recent fallback and explain native search availability;
   this implementation does not enable public-release MapKit. Validate the
   chosen build explicitly before distribution.
4. Complete the high-value native acceptance cases above. The previously noted
   hosted `rls_auto_enable()` / `ensure_rls` provenance/documentation question
   remains a separate operational follow-up, not evidence of a newly found RLS
   failure. No unverified release/privacy claim is made here.

Deferred UI improvements: floating Back control overlap while scrolling, more
consistent detail/tab transitions, multiline fact-edit addresses, keyboard and
safe-area checks on large text/small screens, and clearer optional-field/context
copy. These are polish items unless acceptance shows an actual blocked action or
lost-state bug. They need no database migration and are not implemented in this
pass. The recommended next small implementation step is disabling the temporary
repair flag before friends testing, followed by one focused Back/scroll-layout
pass rather than a feature expansion.

## Proposed commit

```text
feat: complete Milestone 18 unified Add and personal visit history

Add destination-scoped saves with atomic receipts and safe recovery exits.
Persist personal MapKit locations and preserve existing visits and privacy.
Include migrations 15–17, navigation fixes, regression tests and phase reports.
```

No staging or commit has occurred. The next approval is to stage **only this
reviewed manifest** and create the proposed commit. Pushing, hosted operations,
cleanup, fixtures and release distribution remain outside that approval.

## Complete file manifest

This is the complete candidate worktree relative to the Milestone 17 base,
including the historical reports and development SQL/test sources needed to
review and reproduce the milestone. `M` = tracked modification; `A` = currently
untracked new file; `D` = intentional deletion. The deleted `add.tsx` is replaced
by the `add/` stack. Do not omit the deletion or the new stack/result wrappers.

**85 paths: 36 modified, 48 new, 1 deleted.**

| Status | File |
| --- | --- |
| M | `README.md` |
| M | `app/(app)/(tabs)/(groups)/group/[id].tsx` |
| M | `app/(app)/(tabs)/(groups)/group/[id]/restaurant/[entryId].tsx` |
| M | `app/(app)/(tabs)/(groups)/groups.tsx` |
| M | `app/(app)/(tabs)/(my-places)/my-places.tsx` |
| M | `app/(app)/(tabs)/(my-places)/personal-place/[id].tsx` |
| M | `app/(app)/(tabs)/_layout.tsx` |
| D | `app/(app)/(tabs)/add.tsx` |
| A | `app/(app)/(tabs)/add/_layout.tsx` |
| A | `app/(app)/(tabs)/add/group/[id]/restaurant/[entryId].tsx` |
| A | `app/(app)/(tabs)/add/index.tsx` |
| A | `app/(app)/(tabs)/add/personal-place/[id].tsx` |
| M | `app/(app)/_layout.tsx` |
| M | `app/(app)/add-visit.tsx` |
| M | `app/(app)/personal-place-form.tsx` |
| A | `app/(app)/personal-visit-form.tsx` |
| A | `components/add-results.tsx` |
| A | `components/dev-personal-location-repair.tsx` |
| M | `components/personal-apple-place-lookup.tsx` |
| M | `components/personal-place-fields.tsx` |
| A | `components/restaurant-search.tsx` |
| M | `components/screen-scaffold.tsx` |
| A | `components/unified-add-form.tsx` |
| A | `components/visit-fields.tsx` |
| M | `docs/auth-navigation.md` |
| A | `docs/milestone-18-backup-verification.md` |
| A | `docs/milestone-18-completion.md` |
| A | `docs/milestone-18-hosted-deployment.md` |
| A | `docs/milestone-18-hosted-preflight.md` |
| A | `docs/milestone-18-location-repair-ui.md` |
| A | `docs/milestone-18-mapkit-persistence.md` |
| A | `docs/milestone-18-migration-17-backup-verification.md` |
| A | `docs/milestone-18-migration-17-deployment.md` |
| A | `docs/milestone-18-migration-17-predeployment.md` |
| A | `docs/milestone-18-recovery-completion.md` |
| A | `docs/milestone-18-rest-verification.md` |
| A | `docs/milestone-18-unified-add.md` |
| M | `lib/auth-navigation.ts` |
| A | `lib/personal-location-repair.ts` |
| M | `lib/personal-map.ts` |
| M | `lib/personal-places.ts` |
| A | `lib/personal-visits.ts` |
| A | `lib/recent-restaurants.ts` |
| A | `lib/restaurant-navigation.ts` |
| M | `lib/restaurant-ui.ts` |
| A | `lib/unified-add.ts` |
| A | `providers/unified-add.tsx` |
| M | `styles/backend.ts` |
| M | `supabase/README.md` |
| A | `supabase/dev/m18_backup.sql` |
| A | `supabase/dev/m18_cleanup.sql` |
| A | `supabase/dev/m18_fixtures.sql` |
| A | `supabase/dev/m18_inventory.sql` |
| A | `supabase/dev/m18_location_diagnostic.sql` |
| A | `supabase/dev/m18_logical_backup.sql` |
| A | `supabase/dev/m18_pre17_logical_backup.sql` |
| A | `supabase/dev/m18_preflight.sql` |
| A | `supabase/migrations/20261017001500_personal_visit_history.sql` |
| A | `supabase/migrations/20261017001600_unified_add_destinations.sql` |
| A | `supabase/migrations/20261018001700_personal_mapkit_locations.sql` |
| A | `supabase/tests/personal_mapkit_locations.sql` |
| A | `supabase/tests/personal_mapkit_locations_concurrency.mjs` |
| A | `supabase/tests/unified_add.sql` |
| A | `supabase/tests/unified_add_concurrency.mjs` |
| M | `supabase/tests/validate_group_apple_place_ids.mjs` |
| M | `tests/address-autocomplete.cjs` |
| M | `tests/apple-map-search.cjs` |
| M | `tests/auth-navigation.cjs` |
| M | `tests/geoapify-dev-test.cjs` |
| M | `tests/geoapify-form-wiring.cjs` |
| M | `tests/group-apple-place-ids.cjs` |
| A | `tests/m18-ui-usability.cjs` |
| M | `tests/milestone-17-safety.cjs` |
| M | `tests/navigation.cjs` |
| M | `tests/personal-apple-place-lookup.cjs` |
| M | `tests/personal-apple-place-picker.cjs` |
| M | `tests/personal-create-draft.cjs` |
| A | `tests/personal-location-repair.cjs` |
| M | `tests/personal-map.cjs` |
| A | `tests/personal-mapkit-persistence.cjs` |
| M | `tests/personal-places.cjs` |
| M | `tests/stabilization.cjs` |
| A | `tests/unified-add-recovery.cjs` |
| A | `tests/unified-add.cjs` |
| M | `types/database.ts` |
