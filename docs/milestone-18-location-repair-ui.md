# Milestone 18 — temporary personal location repair UI

> Historical phase report: statements about pending deployment, approval, counts
> and simulator steps below describe this report's original checkpoint.
> Current state: migrations 15–17 and REST verification passed; the owner confirmed
> the separately approved In-N-Out location repair preserved its visit, and
> Special Noodle's saved coordinates produced a second verified personal pin.
> See the [current completion review](milestone-18-completion.md). Do not repeat
> migrations or repair from this historical report.

Implemented locally only. No hosted repair has been executed. Migration 17 is
already deployed; do not rerun it. Attaching the In-N-Out location still requires
separate approval and a fresh, explicit Apple Maps selection in the simulator.

The authorized personal restaurant detail screen mounts the isolated
`DevPersonalLocationRepair` panel only in development builds with the native iOS
MapKit module available. The action appears only after owner-scoped reads confirm
that neither a verified location nor a native point maps this card. Apple Place
ID presence does not decide eligibility. A failed check never offers repair.

## Simulator review now — no hosted write

1. Reload the existing compatible iOS development app from your usual Expo
   session. No native module or dependency changes are required.
2. Sign in as the existing In-N-Out card's owner. Open **My Places**, then the
   existing **In-N-Out Burger — 50 Ranch Dr, Milpitas, CA 95035**. Confirm its
   existing single visit; do not use Add or Add Another Visit.
3. Tap **Add missing map location**. In the embedded search list, search Apple
   Maps for `In-N-Out Burger 50 Ranch Dr Milpitas CA 95035` and explicitly select
   the matching full-address result.
4. Review **Existing My Places restaurant** and **Selected Apple Maps result**
   together. Apple address formatting can differ; they must identify the exact
   same restaurant. Stop if the result is ambiguous or wrong.
5. **Do not tap Attach location only yet.** This button performs the hosted
   location-only RPC and requires separate approval. To finish this local review,
   tap **Cancel location repair**. Selection/search/cancel perform no hosted
   writes. Do not use invented coordinates or test fixtures for the real repair.

## After separate attachment approval

Repeat the fresh selection/review above, then tap **Attach location only** once.
The initiating owner's JWT is explicitly pinned. Only the original card ID,
original revision, exact stored address and native latitude/longitude are sent
to `set_personal_mapkit_location`. The selected result does not rename the card,
rewrite its address, fill its Apple Place ID, increment its revision, or create a
restaurant, visit or save receipt. Migration 17 enforces owner/card/revision/
address checks under lock and never overwrites an existing location.

Before dispatch and after every response (including errors), the helper reads
and compares every original restaurant field and the complete paged visit
history. Confirmation also requires the exact selected point to appear through
the private map reader. A changed baseline stops repair. Duplicate taps and
pending submissions cannot dispatch another request. A timeout does not prove
rollback: the UI offers only **Check saved location**, never automatic retry.
Dispatched attempts are retained by owner/card in memory across route disposal,
backgrounding and account switches; checking never resends a write. A full app
reload loses this in-memory attempt, but still checks saved locations before
repair and cannot overwrite a late first resolution. No private repair draft,
coordinates or bearer token is written to device storage or logs.

On confirmed success, verify the original card still has the same single visit,
rating, notes and history. Open **My Places Map**, refresh, and check the original
restaurant's pin. Reload the app and repeat the card/map check. On uncertainty or
any changed card/history/different point, stop for review and use read-only checks.

## Disable or remove

Before friends testing, set `DEV_PERSONAL_LOCATION_REPAIR_ENABLED` to `false` in
`lib/personal-location-repair.ts`. Both UI and client repair dispatch honor this
switch; release builds are independently excluded. Removal is confined to the
personal-detail import/mount/repair lock wiring, this component/helper, and its
focused tests. No backend change is required to disable the temporary UI.

## Local validation

`node tests/personal-location-repair.cjs` exercises the actual screen, MapKit
adapter and authenticated client through offline native/HTTP fixtures. Coverage
includes development gating, location eligibility, explicit selection/cancel,
field/history preservation, exact RPC payload, stale cards and visits, owner/
account/lifecycle changes, duplicate taps, concurrency rejection, lost responses,
request deadlines, uncertainty across remounts, readback failures, pagination,
competing first resolution and private map readback. Test coordinates are
synthetic and never used for hosted repair. Run the existing regression scripts,
TypeScript, lint and whitespace checks alongside it.

Local results: all 285 existing automated checks and 18 new repair checks passed.
The navigation and UI usability suites passed again after the detail-screen
keyboard adjustment. TypeScript, lint (no warnings), tracked/new-file whitespace
checks and the empty staging-area check passed. The hosted attachment and actual
simulator pin persistence remain pending separate approval and acceptance.
