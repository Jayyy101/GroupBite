# Milestone 18 — Apple Maps location persistence correction

> Historical phase report: statements about pending deployment, approval, counts
> and simulator steps below describe this report's original checkpoint.
> Current state: migrations 15–17 and REST verification passed; the owner confirmed
> the separately approved In-N-Out location repair preserved its visit, and
> Special Noodle's saved coordinates produced a second verified personal pin.
> See the [current completion review](milestone-18-completion.md). Do not repeat
> migrations or repair from this historical report.

**Hosted status update:** Migration 17 and its REST verification have passed.
The compatible app can restart for simulator testing; do not reapply migration 17.
See the [current deployment report](milestone-18-migration-17-deployment.md) and
[restart steps](milestone-18-rest-verification.md).
The preparation/backup notes below retain their original phase context.

The owner subsequently confirmed the hosted In-N-Out card has exactly one visit
and no saved location/Apple ID, with no matching duplicates or ownership issues.
See the [migration 17 predeployment handoff](milestone-18-migration-17-predeployment.md)
for the fresh 16-table backup export and the pending location-only repair plan.
The [actual backup/restoration and migration-17 rehearsal](milestone-18-migration-17-backup-verification.md)
have now passed; hosted deployment and repair remain unapproved.

Local only. No hosted query completed, data changed, migration deployed,
dependencies installed, or files staged/committed/pushed in this investigation.
Migrations 15 and 16 remain byte-for-byte unchanged. Migration 17 below is
**pending separate deployment approval**; deploy its backend before reloading
this JavaScript bundle for native personal saves/map acceptance testing.

## Root cause and evidence

The code path lost location data at two consecutive boundaries:

| Stage | Finding and correction |
| --- | --- |
| MapKit/native adapter | Already returns precise coordinates independently of optional `MKMapItem.identifier` (iOS 18+). Request/index handles are temporary and cannot substitute for a provider ID. No native changes needed. |
| Restaurant selection | `RestaurantSearch` copied facts/optional ID but discarded both coordinates. It now retains an in-memory native point bound to the selected name/address. |
| Unified form | Editing any fact, including cuisine, cleared the Apple ID. Only name/address edits now invalidate the ID and selected point. Cuisine/visit/destination edits retain them. |
| Frozen save | The old ten-argument RPC payload had no coordinates. Personal native selections now use a distinct atomic point-aware RPC; group, manual and recent-identity paths keep their existing APIs and identity rules. |
| Database | Migration 15 saved the card, visit and recovery receipt but never inserted a location. Saving an Apple ID alone therefore could not create a map pin. |
| Personal map | `get_saved_locations` correctly requires a matching resolved location snapshot. A card without one was unresolved and correctly omitted. The reader now also reads private user-selected points, validates ownership/geometry and prefers an existing verified pin for the same card. Empty-map text and geometry checks are retained. |

This establishes the missing-coordinate persistence/linkage defect without a
hosted write. The reported Apple ID is a **separate** question: MapKit may omit
it; prior cuisine edits could clear it; and reusing an existing personal card
intentionally does not fill its creation-only NULL ID. We cannot identify which
occurred for the actual In-N-Out card from the local code alone. An ID is never
required to persist real selected coordinates or display its pin.

The existing authorized Keychain credential lookup timed out; no hosted request
was sent and no alternate credential method was attempted. To inspect the card,
open the confirmed project `goperhgeqyqzepbtwtaz` in Supabase SQL Editor, paste
[`m18_location_diagnostic.sql`](../supabase/dev/m18_location_diagnostic.sql), and
run its single SELECT. Share only its aggregate `location_diagnostic` JSON.
It returns migration versions, matching-card/owner/visit counts, Apple-ID and
resolved-location counts, revision range and duplicate-identity flags. It does
not return IDs, emails, notes, coordinates, tokens or connection strings.
Multiple matching cards/owners require the owner to identify the intended card
privately before any separately approved repair; do not guess or merge them.

## Scoped database correction

[`20261018001700_personal_mapkit_locations.sql`](../supabase/migrations/20261018001700_personal_mapkit_locations.sql)
is additive on migrations 1–16:

- `personal_mapkit_locations` stores an exact user-selected point, parent/owner
  composite FK and address snapshot, separately from backend-verified Geoapify
  locations. Owner-only SELECT/RLS; no direct client/service-role writes.
  It requires no provider ID and invents no building-level accuracy or receipt.
- `save_personal_visit_with_mapkit_point` delegates to the unchanged personal
  save RPC. Card, visit, original receipt, point and immutable coordinate hash
  proof commit together. Errors roll everything back. The original receipt
  fingerprint and new coordinate proof reject changed-payload retries. Old
  request IDs cannot be retroactively upgraded into native-point saves.
- Own-account locking retains exact idempotency under concurrent requests.
  Existing destination identity, Apple creation-only semantics, IDs, revisions,
  memberships and group APIs/grants remain unchanged. The first resolved point
  wins; saving another visit does not move it. Receipt replay cannot resurrect
  a deleted card or reattach a point invalidated by an address edit.
- `set_personal_mapkit_location` is a location-only repair API, checking the
  authenticated owner, explicit parent ID, original revision and exact current
  address under lock. It adds no card, visit or save receipt, changes no identity
  or parent revision, and refuses to replace existing resolution. Address edits
  invalidate selected points; deletion cascades them without erasing save proof.
- `get_personal_mapkit_locations` is bounded and derives the owner from auth.
  Map reads combine it with the existing verified-location RPC under the same
  total deadline/account/privacy lifecycle. No persistent coordinate cache.

Frozen points live only in current memory and the explicit personal RPC body.
Recovery journals still contain request/destination markers only. Response loss
is uncertain and reconciles by the existing read-only receipt; it never replays
the save. A missing new RPC gives a visible backend-update error, with no fallback
that silently saves the visit while dropping coordinates. Release/native/debug
safeguards are unchanged; group save payloads contain no point coordinates.

## Existing In-N-Out repair

**Do not use Save Visit / Add Another Visit to repair it:** that intentionally
creates another visit even when it reuses the restaurant card.

The existing `geoapify-attach-personal` Edge flow is location-only and can safely
attach to an existing card using its ID, current revision and a fresh signed
Geoapify selection receipt bound to the owner and exact address. Its configured
allowed-account restriction and hosted availability were not freshly verified.
A native MapKit result is not such a receipt; no restrictions were relaxed.

Migration 17 additionally prepares the native location-only RPC above. After
separate deployment/repair approval, select the exact existing owner/card,
capture its revision/address and visits, obtain a fresh MapKit selection for
50 Ranch Dr, Milpitas, verify the displayed restaurant/address, and explicitly
attach its actual coordinates to that existing ID. Do not guess coordinates,
fill the Apple ID, resave a visit or merge cards. Compare card ID/owner/revision,
all original fields, visit IDs/counts/content and unrelated destinations before
and after; only the private location row should be new. There is no new repair
button in this focused patch; a repair must use the reviewed authenticated RPC
or the existing signed Geoapify flow. No hosted repair was attempted.

## Verification

The disposable PostgreSQL 17.11/PostGIS 3.5.6 runner (`--mapkit-locations`) applies
the additive migration over populated migrations 1–16. It compares **every
existing row and all existing function definitions/ACLs**, checks owner-only
reads, missing JWT/anonymous/foreign denial, invalid geometry/pagination,
optional/present IDs, exact and changed retries, forced point/proof failure
rollback, deletion/address invalidation and repair with unchanged card/history.
Five new real lock-wait races cover same request, changed coordinates, intentional
repeat visits, concurrent address edits and concurrent repairs. Existing M18
history/save/group/identity/privacy and concurrency suites run too; group Apple,
membership lifecycle, catalog privacy and unified Add SQL suites run again after
migration 17. These passed using existing isolated tooling; no installations or
hosted connections. The temporary database stops and its owned files are removed.

Client coverage exercises actual native adapter → search card → Add provider/form
→ HTTP RPC → private map reader/iOS marker, with both present and absent Apple IDs.
It also checks fact invalidation, cuisine retention, destination/note separation,
immutable points, invalid coordinates, missing backend, response loss, account
replacement, native pagination, verified-point preference and lifecycle cleanup.
Native/HTTP boundaries are offline; hosted or fresh simulator acceptance is not
claimed. The final full client/native run passed **285 named checks**, including
19 new persistence/map cases and all 31 Milestone 17 safety cases. TypeScript,
uncached offline Expo lint, tracked and untracked whitespace checks passed.
The client log is `/private/tmp/groupbite-m18-location-client-tests.log`.

```sh
/opt/homebrew/opt/node@24/bin/node supabase/tests/validate_group_apple_place_ids.mjs \
  --postgres-bin /private/tmp/groupbite-m18-tooling/Postgres.app/Contents/Versions/17/bin \
  --pg-module /private/tmp/groupbite-m18-tooling/node_modules/pg/lib/index.js --mapkit-locations
```

## Simulator retest after separate backend deployment approval

1. Deploy only migration 17 through the separately approved process, verify
   hosted history/schema and snapshot preservation, then restart Metro with
   `npm start -- --dev-client --clear` and reload the existing compatible iOS
   debug build. No native rebuild is needed. Until then, native personal saves
   and the point-aware map explicitly report the pending backend update.
2. Through Add, search a restaurant in Apple Maps, select its full-address card,
   leave name/address unchanged, optionally change cuisine, select My Places
   and save **once as an intentional visit**. Verify its detail/history and map
   pin/callout, then reload and Refresh Map. If Apple supplies no ID, the no-ID
   detail message is valid and the pin must still appear.
3. Verify a known ID-bearing result retains its ID. Change a selected name or
   address before another intentional save: stale original coordinates/ID must
   not follow it. Manual/unresolved cards must not gain invented points.
4. After the existing In-N-Out card's separately approved location-only repair,
   open that original card and compare its unchanged history; Refresh Map must
   show its actual Ranch Dr selection. Do not add a visit for this check.
5. Browse group destinations and Saved summary Back/Done/tab reset; verify
   private/group note separation and that other accounts cannot see the personal
   pin/history. An uncertain save must use Check Saved Results, never resubmit.

Remaining approval: review/deploy migration 17 separately after a current read-only
preflight and verified backup, and approve any scoped repair of the existing card.
The old pre-migration-15 manual export is historical: a fresh backup must include
current personal visits and destination receipts, with native points/coordinate
proofs included in any post-migration-17 backup. Do not reuse the historical export
as a current complete snapshot.
