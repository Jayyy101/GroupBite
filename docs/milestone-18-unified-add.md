# Milestone 18 — Unified Add and personal visit history

Local implementation based on `9bfd597445a6b1bdf5f3e3dad40df2c6d33d3ecd` (Milestone 17).
**Migrations 15–17 are deployed and their schema, permissions and preserved data
have been verified on GroupBite `goperhgeqyqzepbtwtaz`.** See the
[15/16 deployment report](milestone-18-hosted-deployment.md) and
[17 deployment report](milestone-18-migration-17-deployment.md). No cleanup,
seeding, production credential changes, staging, commits or pushes occurred.
Approved PostgreSQL/PostGIS and temporary `pg` tooling were restored only under
`/private/tmp`; app dependency files and migrations 1–14 are unchanged. The
updated save/history/location UI uses migrations 15–17 and does not fall back to old
non-history writes when an RPC is missing.

See the [current completion report and complete commit manifest](milestone-18-completion.md)
for the latest acceptance evidence and **324-check** final validation. The
navigation/UI follow-up and Phase B validation sections below retain their
original, narrower test counts and at-the-time acceptance limits.

## Product behavior

Add is restaurant-first: native Apple business search, recent saved identities,
or manual entry. My Places and group-level Add links lead to this landing screen;
Add Another Visit starts with a destination-scoped saved identity. Every
My Places/group checkbox starts unchecked, including group entry points. Search
and recent selection never import visit fields or select destinations.

The date defaults to the device's local today and can be cleared. Rating and
would-go-again also clear by tapping the selected choice again. These three
values are copied independently into every selected destination. Private notes
are included only in personal payloads; group notes only in group payloads.
Editing/deleting one visit does not update another destination.

Single-destination success opens the exact personal card or group **entry ID**.
Multiple destinations and partial results dismiss the form into a per-destination
summary on Add. Each confirmed entry can be opened; Done clears the recovery
journal only when every destination is confirmed, then returns to the fresh
landing. Leaving unresolved results requires a warning acknowledgement and
retains every recovery marker. Completed forms are removed from Back history.
Foreground transitions never trigger hidden result navigation.

## Simulator navigation correction

The owner confirmed saves to My Places, Date Nights and Friends work in the
simulator. The following local follow-up corrects navigation without changing
RPCs, migrations, database records or destination identity rules:

- Add now owns a native stack with its existing landing screen at `/add`.
  Result links push the shared personal/group detail views inside this stack,
  preserving the five visible tabs. Button Back and native Back return to the
  Saved summary, including when another group was browsed previously.
- Normal My Places/Groups browsing still uses its own detail routes and parents.
  Personal facts/visit editors preserve the result-origin return path, and shared
  group visit editors retain the existing unsaved/uncertain protections.
- Done and Add-tab selection clear completed recovery only when every destination
  is confirmed and storage removal succeeds. Pending, uncertain and partially
  reconciled attempts stay recoverable. Stale callbacks/account changes cannot
  navigate after a late clear. Single-destination automatic detail opening remains.
- The recent RPC returns a row per saved destination. Display deduplication now
  combines identical name/address/cuisine/provider-identity choices in its fetched
  page. A combined choice has no arbitrary destination entry reference; the
  existing save RPC resolves each destination. Distinct addresses, cuisine facts
  and opaque provider IDs remain separate. No database rows are merged or deleted.

Validation: **125 targeted checks passed**, including 14 added cases: 21 save,
11 M18 navigation, 19 nested navigation/leave safety, 8 search/recent, 9 draft,
15 personal, 11 auth/navigation and all 31 Milestone 17 safety checks. These use
actual TSX/controller code and installed Expo/React Navigation routing/reducers,
with offline native/HTTP boundaries. TypeScript, uncached `expo lint` and
whitespace checks passed. No simulator acceptance is claimed for this follow-up.

Restart Metro with `npm start -- --dev-client --clear` and load the existing debug
development build. If restored results are uncertain, first use Check Saved
Results. Then retest each destination link and Back/edge swipe; Done and a later
Add-tab press must show the clean landing. In a separate completed save, leave
without Done and reselect Add. Browse details through My Places and Groups to
check normal parents, verify an unsaved edit still offers Stay/Discard, and check
that one shared recent choice represents the matching destination cards.

## UI usability follow-up

The simulator confirmed accurate MapKit locations but exposed oversized inline
maps and confusing selection/scrolling. Each Add search candidate previously
mounted a `DevMapKitPreview` whose `flex: 1`/minimum height belongs to a map
viewport. Add now renders ordinary selectable cards with complete names and
addresses, in the page's single scroll view. Suggestions and resolved results
have distinct headings. Keyboard taps select a result; dragging dismisses the
keyboard. There are no maps, nested result scrollers or absolute result layouts
in Add. The MapKit adapter/native engine, precise candidate coordinates, opaque
Place IDs, development safeguards and independent map screens are unchanged.
At that UI-only checkpoint coordinates remained transient. The subsequent
[location persistence correction](milestone-18-mapkit-persistence.md) retains
selected personal coordinates through deployed migration 17; identity
rules and group payloads remain unchanged.

Destination checkboxes now have a pale orange fill, contrasting orange border,
checkmark and accessible checked state. Labels can wrap. Personal details show
`My Places · Private`; group details show the verified group name, hidden again
when membership/access is lost. Both normal and Saved-result routes reuse them.

My Places cards now use the Groups summary format: average of non-NULL history
ratings, rated visit count and total real visit count. Legacy/undated/unrated
visits are counted; empty cards stay at zero. Owner-pinned bulk reads select only
history IDs, parent IDs and ratings, page beyond REST row caps, and never request
visit notes or group history. Read failures show an error rather than invented
zero counts. No schema/RPC/migration change is required.

The Add form and personal editors replace hard-coded top spacing with the shared
safe-area/edge-to-edge scaffold, explicit full-screen bottom inset and keyboard
insets. Personal details use the same compact scrolling title/Back treatment as
group details. Existing group/landing defaults and the five-tab layout are kept.

Validation: **183 targeted checks passed**: the prior 125 navigation/save/privacy/
safety checks, eight new usability checks, 24 Apple search checks, 11 personal-map
checks, six group Apple checks and nine saved personal Apple lookup checks.
TypeScript, uncached Expo lint and whitespace checks passed. Tests use offline
native/HTTP boundaries; a fresh visual simulator acceptance pass is still needed.
No hosted access, migration/data changes, dependency installation, staging,
commits or pushes occurred in this follow-up.

Retest on iPhone 16 Pro with the current development bundle: search/resolve and
scroll full-address choices through Recently Saved; select a restaurant and
toggle My Places/Date Nights/Friends; focus the notes/keyboard and reach Save and
Back. Layout can be tested without saving by using Back/Discard. Browse existing
cards to compare averages/counts with history and verify collection labels and
return paths. Check portrait, landscape and larger text, plus the existing
separate My Places map. No native rebuild is required for these JavaScript changes.

## Data and security contract

- `20261017001500_personal_visit_history.sql` retains `personal_places` as private
  restaurant entries and adds owner-scoped `personal_visits`, independent revisions,
  a composite parent/owner FK, RLS, and personal save/facts-edit/visit-edit/delete RPCs.
- Backfill preserves every original card and copies only actual recorded memory
  values into an `origin='legacy'` record. It never turns `created_at` into a visit
  date or invents a visit for an all-null memory. Existing duplicate cards remain;
  no deletion, merge, or identity rewrite is performed.
- The old visit columns become a private latest-memory projection for existing
  readers, including the saved-location RPC. Updating a visit increments the card
  revision too, preventing stale whole-card deletion. Deleting the last personal
  visit retains the card. Whole-card deletion explicitly cascades its history and
  location metadata. Restaurant address edits retain existing Apple/coordinate
  invalidation behavior.
- Legacy personal INSERT/UPDATE/DELETE grants, including explicit column grants,
  are revoked. The new client uses owner-derived RPCs. Older app binaries require
  updating and fail closed after cutover. No direct history writes are granted.
- `add_destination_requests` is a private immutable ledger keyed by actor/request.
  It stores a fingerprint and historical destination/entry/visit IDs, not notes.
  Entry/visit/group deletion never removes or retargets these IDs. No client or
  service-role table access is granted; authenticated result RPCs derive the actor.
- `20261017001600_unified_add_destinations.sql` adds a group adapter, scoped receipt
  reader and bounded recent-identity reader. It retains old RPCs and fingerprints.
  Group saves acquire the existing group-first lock, verify the membership
  incarnation, resolve facts inside that group, call the existing Apple-aware RPC,
  identify the exact inserted visit under the group lock, and insert the new
  receipt **inside the same transaction**. Receipt/binding failure rolls back all
  associated mutations; there is no separate client-side receipt write.
- Identity resolution uses an authorized existing card reference, an unambiguous
  Apple reference with consistent address, or exact trimmed name/address. Matching
  never crosses destinations. Conflicting IDs/addresses and ambiguous duplicate
  cards fail rather than silently merge. Canonical reuse does not edit facts.
  Existing group IDs retain first-ID/owner-only NULL-fill semantics. An adapter
  verifies that the legacy RPC's binding targets the resolved card.
- Own receipts prove historical commit after deletion or membership revocation.
  Current membership controls navigable group IDs and current content. Recent
  identities contain no notes, ratings, coordinates or implicit selections.

## Save and recovery contract

`lib/unified-add.ts` owns one frozen request per destination. The account-keyed
provider retains attempts across foreground/route remounts and disposes callbacks
on account replacement. Mutation headers pin the initiating account; group RPCs
revalidate the membership admission under lock. Destinations save independently,
so one failure never undoes another destination's success.

Before any mutation, all request/destination markers are written to the existing
AsyncStorage dependency under an account-specific recovery key. Markers contain
no visit text, names, tokens, Apple data or frozen mutation payloads. Storage
failure/timeout sends nothing. Storage writes/clears are serialized per account,
including provider replacement, so a late write cannot erase newer recovery.

Pending means known not dispatched in the current in-memory submission. Confirmed
failed means an initial actual server rejection with a recognized rollback code.
Only these states offer safe sends/retries using their frozen payload. Dispatched
timeouts, malformed success and transport failure are uncertain. Uncertain
mutations are **never replayed** by this UI; Check Saved Results only reads the
private receipt. An absent receipt never proves failure. Confirmed successes
are not resent or downgraded after a failed result read.

Reload/process loss restores markers as uncertain and offers read-only recovery;
it never reconstructs a mutation payload. Sign-out hides recovery and another
account cannot inherit it. Returning to the same account can review its markers.
Finishing unresolved recovery is explicitly warned: it does not undo saves and a
later intentional new save could add another visit. Active operations block
ordinary navigation; deliberately leaving an unresolved screen retains recovery
in Add. Private form UI hides during inactivity and access verification.

The recovery completion fix additionally provides **Start a separate Add** with
explicit confirmation. It archives old markers before resetting Add and retains
read-only checks under **Previous save recovery**. A second storage-failure
acknowledgement permits temporary in-memory recovery, with an explicit warning;
new mutations still require safe evidence/journal storage. No old mutation is
replayed and no database receipt is changed. See the
[recovery completion contract and simulator steps](milestone-18-recovery-completion.md).

## Apple development build

TypeScript `__DEV__`/iOS checks and Swift `DEBUG` restrictions are unchanged.
`RestaurantSearch` uses the existing completion, resolution, explicit text search,
validation, timeout and cancellation adapter. Resolution retains MapKit's cached
suggestion handle; resetting that cache before resolving would make suggestions
unusable. Selecting a result confirms its displayed name/address and optional
opaque Apple ID. Name/address edits clear the ID and selected point; cuisine edits
retain them. Selected personal points now use a separate user-selected location
store in deployed migration 17, without being treated as backend-verified Geoapify
metadata. See the [location correction](milestone-18-mapkit-persistence.md) before
testing this JavaScript bundle against hosted Supabase.

The existing compatible iOS debug development build should require only a JS
reload. Expo Go, non-iOS and release builds retain recent/manual entry and explain
native search availability. No new native dependency or Swift change was made.
The sandbox blocks CoreSimulatorService, but the approved local verification
ran outside that restriction. On the booted **iPhone 16 Pro / iOS 18.3** simulator,
an isolated DEBUG probe compiled the exact production `MapKitSearchSession`
against real MapKit: completion returned four suggestions, cached suggestion
resolution returned three candidates, and explicit restaurant search returned two.
The probe did not launch GroupBite, read app configuration or call Supabase.
That probe verified the native provider path. Subsequent owner simulator tests
verified GroupBite search, coordinate persistence, the repaired In-N-Out pin and
Special Noodle's automatically saved pin. After-commit response-loss and the
remaining device acceptance matrix are still separate manual checks.

## Historical Phase B validation

Verification result (2026-10-17): **244 named client/native checks passed**, including
all 31 Milestone 17 safety checks. Node 24.18.0 was already installed and used;
the shell's older default Node lacks the WebSocket API required by the installed
Supabase client. TypeScript, uncached lint, tracked/new-file whitespace and runner
syntax checks passed. No new lint warnings were reported in this run.

The first Phase B report's **230** was the actual `PASS` count, not a failed or
partial invocation of the client loop. Re-running the exact Milestone 17 HEAD in
an isolated `/private/tmp` archive reproduced **300 passing checks**. Retiring the
two separate creation forms removed numerous assertions about their direct
personal INSERT/PATCH, picker placement, Geoapify wiring and old post-save routes.
Those cases were consolidated into unified save/draft/search tests. The audit
also found retained screen/search behaviors needing explicit coverage; this phase
added 14 checks, bringing 230 to 244. Counts refer to named cases, including cases
with several assertions/scenario variants; they are not a coverage percentage.

| Client suite/category | Milestone 17 | Verified Milestone 18 |
| --- | ---: | ---: |
| Address autocomplete | 31 | 21 |
| Swift engine / native adapter | 18 / 24 | 18 / 24 |
| Auth navigation | 11 | 11 |
| Geoapify client / dev mode / form wiring | 15 / 14 / 25 | 15 / 12 / 14 |
| Group Apple entry/form integration | 24 | 6 |
| Milestone 17 safety | 31 | 31 |
| Navigation (retained + unified) | 22 | 20 |
| Saved personal Apple lookup | 9 | 9 |
| Picker / restaurant search | 14 | 6 |
| Creation draft | 15 | 9 |
| Personal map | 11 | 11 |
| Personal service/screens/history | 30 | 15 |
| Stabilization | 6 | 3 |
| Unified destination save/recovery | 0 | 19 |
| **Total** | **300** | **244** |

Two implementation issues found by the added regressions were fixed:

- A retained whole-card delete callback could send again after a lost response.
  Deletion now consumes the exact current confirmation synchronously; cancellation,
  refresh and unmount invalidate it. A stale revision still requires a fresh prompt.
- Repeated landing-screen selection taps could push duplicate visit forms.
  A synchronous selection guard permits one navigation until the screen returns.

Run client regressions with the existing Node 24 first on PATH:

```sh
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
for test in tests/*.cjs; do node "$test" || exit; done
npx tsc --noEmit
npm run lint -- --no-cache
git diff --check
```

Database verification used **PostgreSQL 17.11 / PostGIS 3.5.6**, restored from the
[official portable Postgres.app release](https://github.com/PostgresApp/PostgresApp/releases/tag/v2.9.6),
and `pg@8.16.3` isolated under `/private/tmp/groupbite-m18-tooling`. No Homebrew,
app package, production credential or existing database was changed. Runners
clear inherited configuration, create synthetic accounts in owned disposable
clusters, and clean up their own servers/data directories. The M18 runner exposes
only a private Unix socket, with TCP disabled; the older full regression runner
uses isolated loopback/SCRAM. The sandbox denies PostgreSQL shared memory, so these
approved local runs required execution outside that restriction.

The M18 runner passed migration/RLS/permissions/history/identity/recovery checks,
**22 concurrency scenarios plus one independent-commit scenario** (including
verified database lock waits and nonblocking independent-scope writes).
It applies migrations 15/16 over populated data and proves every old row and all
pre-existing function definitions/identities/EXECUTE grants unchanged. Both
legacy duplicates and empty/undated/false memories are covered. Existing group
Apple, membership lifecycle and catalog privacy suites run again on the final
schema, together with their 13 existing concurrency cases. The remaining nine
M18 concurrency cases cover same/distinct request IDs, concurrent identity reuse,
revocation, cross-destination request collisions, compatible personal/group locks,
stale whole-card deletion and source edits. Independent committed destinations
survive a later rejection with notes and receipts isolated.

SQL also tests personal facts/visit revisions, creation-only Apple references,
Geoapify location invalidation, latest-memory map projection and last-visit/card
deletion, no authenticated/anonymous direct-write or receipt access, helper/service
role restrictions, anonymous/missing JWT denial, foreign-owner isolation, bounded
recent reads, immutable receipts, revoked membership privacy and retries after
deletion. A forced receipt insertion failure after the nested group save proves
Restaurant/card/Visit/legacy receipt/binding rollback together; personal receipt
failure rolls back its card/history too. New RPCs reject parameterized NUL input
and unsupported transaction isolation.

```sh
node supabase/tests/validate_group_apple_place_ids.mjs \
  --postgres-bin /private/tmp/groupbite-m18-tooling/Postgres.app/Contents/Versions/17/bin \
  --pg-module /private/tmp/groupbite-m18-tooling/node_modules/pg/lib/index.js --milestone18
```

The existing full legacy database validator also runs separately at its intended
migration-9 schema (its direct personal-write/global-catalog expectations predate
the deliberate later cutovers). Its nine SQL suites and 85 overlapping-writer
cases are regression evidence for that schema, not a claim those old writes
remain available after migration 15. Current RPC replacements are tested above.
The three existing offline Geoapify suites passed **96 checks** (26 personal
attachment, 22 isolated probe, 48 Edge handler), separately from the 244 app checks. The existing Migration 11 attachment and Migration 13 personal Apple
validators also passed, including their historical preservation checks, 27 real SQL
attachment assertions and five attachment races (plus eight personal races in the
Migration 13 run). Full Deno/PostgREST runtime tests are not part of that count and were not
rerun: their extra runtime binaries are absent; no Edge code changed here.

Local evidence is in `/private/tmp/groupbite-m18-regressions-verified.log`,
`groupbite-m18-baseline-tests.log`, `groupbite-m18-database.log`,
`groupbite-m18-legacy-database.log`, `groupbite-m18-geo-offline.log`,
`groupbite-m18-personal-attachment-database.log`,
`groupbite-m18-personal-apple-database.log`, `groupbite-m18-lint.log` and
`groupbite-m18-mapkit.log` (all under `/private/tmp`).
The isolated MapKit probe source/executable is under
`/private/tmp/groupbite-m18-mapkit/`; the engine source was copied without changes.
All changes remain unstaged on `main`; HEAD remains
`9bfd597445a6b1bdf5f3e3dad40df2c6d33d3ecd`. Native module, original group save
helper, migrations 1–14 and app dependency files are byte-for-byte unchanged.

## Prepared inventory, backup, cleanup and fixtures

Cleanup and fixture population remain **unexecuted and separately gated**.
Read-only SQL Editor preflight/diagnostics and logical exports were used during
the approved deployment phases; see their historical reports. The older psql
inventory/scoped-backup helpers remain operator templates; their conditionals
are not directly pasteable into SQL Editor. Historical exports target their
capture-time schema, not a fresh post-17 snapshot. Any future cleanup needs a
new verified backup including both migration-17 location/proof tables.

- `m18_inventory.sql`: read-only account/card/visit/membership counts, exact row
  IDs/hashes, duplicate identities, receipt counts and FK dependencies. It does
  not infer disposability. Account scope and capture-time counts were subsequently
  verified for deployment; this review does not query current hosted counts.
  The confirmed project ref is `goperhgeqyqzepbtwtaz`.
- `m18_backup.sql`: read-only export of explicit account/group scopes, including
  private history, location metadata and receipts/bindings. Supply
  `groupbite.m18.backup_accounts` and `groupbite.m18.backup_groups` as UUID arrays
  in an explicitly selected authorized session. Keep output privately outside
  Git, hash it, and verify restoration in a disposable local database. It never
  exports `auth.users` or credentials. Preserve a separate schema backup too.
- `m18_cleanup.sql`: defaults to rollback; requires explicit operation marker
  `m18-cleanup-v1` and a reviewed JSON manifest. **No row allowlist is supplied.**
  The manifest specifies environment, backup verification, account/group UUIDs,
  personal and group-visit `{id,row_hash}` lists, and approved empty-entry IDs.
  It checks hashes under compatible locks, deletes only those scoped records,
  and removes approved group entries only when no visits remain. Catalog rows,
  all receipts/bindings and essential relationships remain. A separate approval
  is required before applying it (`apply=true` in psql).
- `m18_fixtures.sql`: requires `m18-fixtures-v1`, Jay's UUID verified against
  `machaojie0611@gmail.com`, and two distinct approved existing groups. It creates
  four clearly marked restaurant cards/five personal visits and three visits in
  each group, using deterministic actor/request IDs. No users, groups, memberships,
  ownership or the other accounts are populated. Optional real Apple IDs require
  native verification; a second-location ID also requires its verified address.
  Default unresolved fixture locations make no provider-verification claim.
  Repeating the same fixture generation does not overwrite edits or resurrect
  deleted records. A changed membership/payload requires deliberate review and a
  separately versioned fixture generation, not receipt deletion.

Cleanup A covers only explicitly approved personal cards/history/locations.
Cleanup B additionally covers explicitly approved group visits and empty entries;
it must account for all contributors. Group structure, ownership, memberships,
profiles/Auth, invites/requests and shared catalog facts remain. Receipts must not
be purged to make seeding repeatable. Recovery of approved deletions requires the
scoped backup, dependency-aware restoration in a transaction and count/hash checks;
prove that restoration locally before cleanup approval. No inverse migration or
live-data rollback script is assumed safe.

## Deployment complete; remaining acceptance and future approvals

Migrations 15–17 and the standalone REST permission check are complete. The
owner subsequently verified the separately approved In-N-Out location-only
repair with its original visit preserved and both personal map pins. Do not
repeat deployment or repair from these historical instructions. The current
acceptance ledger and friends-testing gates are in the
[completion report](milestone-18-completion.md).

The checklist below is an acceptance matrix, not a claim that every item has
passed on-device. In particular, native response-loss/account/membership fault
scenarios and release-build behavior remain unverified manually.


The actual hosted application backup was restored and verified locally before
hosted deployment. Both migrations then passed against the restored records.
See the [backup verification report](milestone-18-backup-verification.md) for
scope, checksum and the local PostGIS generated-geography precision caveat.

The owner subsequently approved deployment of exactly migrations `20261017001500`
and `20261017001600`. They are now registered on the confirmed GroupBite project,
with all original rows preserved and four legacy personal visits backfilled.
See the [deployment report](milestone-18-hosted-deployment.md) for hosted evidence
and compatible app restart instructions. Old personal direct writes are retired;
load the current Milestone 18 JavaScript before any account resumes testing.

After real history writes begin, recovery should use a forward fix or reviewed
backup restoration, not a destructive down migration. Cleanup and fixture
population each require their own operation/scoped approval.

Manual iPhone checklist in a separately authorized test environment:

1. Open the compatible debug build; search a restaurant, resolve a suggestion,
   check the full result address and select it. Confirm all destinations are unchecked.
   Verify recent selection and manual entry, including two locations with one name.
2. Save to My Places, repeat with a different date/rating and blank optionals;
   verify one card/two independent visits. Edit/delete one visit, then verify the
   other and group visits remain unchanged.
3. Save to My Places plus two groups with distinct private/group notes. Check each
   destination, summary links, Done, Back history and tab-root behavior.
4. Exercise response loss after commit, initial permission denial, membership
   replacement, backgrounding, reload and account switching. Check receipts only
   for uncertain destinations; confirmed saves must never be repeated. Verify the
   warned abandonment path and no late navigation.
5. As the other accounts, verify private history is inaccessible and existing
   Owner/Member group edit/delete/Apple NULL-fill rules remain. Confirm Expo Go,
   non-iOS and release builds retain the native safeguards and manual fallback.

## Complete commit manifest

The authoritative manifest, including all untracked files and the intentional
replacement of `app/(app)/(tabs)/add.tsx`, is in the
[final commit review](milestone-18-completion.md#complete-file-manifest).
