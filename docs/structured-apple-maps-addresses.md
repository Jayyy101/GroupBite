# Structured Apple Maps addresses

Completed on October 21, 2026, based on `main` at `144eccf7`. Migration 18 is
deployed, the updated iOS development build passed the agreed manual acceptance
tests, and focused hosted read-only verification passed. Existing uncommitted
Home Dashboard work and its shared database declarations remain separate.
No Cities Explored work is included.

## Capture and storage

The native search, completion resolution and Place ID lookup share one result
adapter. It now exports `CNPostalAddress` street, city, state/region, postal code,
country name and ISO country code independently of the formatted display address,
using native placemark fields when postal components are unavailable. Native
locality supplies city; neighborhoods/subLocality are never substituted for city.
No formatted-address parsing, reverse geocoding, GPS access or new permission is
introduced. Missing fields remain null; older native binaries may omit components.
Street line breaks become spaces without splitting the street into other fields.

Migration `20261021001800_structured_mapkit_locations.sql` adds nullable
`structured_address` JSONB to `personal_mapkit_locations` and adds the matching
`group_mapkit_locations` table keyed by the exact group entry. The JSON object
contains only `street`, `city`, `region`, `postal_code`, `country`, `country_code`.
Each MapKit row includes coordinates and an exact saved-address snapshot. The
table itself identifies the Apple selection source. These are client-supplied
native selections; they do not gain Geoapify's server-verified status.

Keeping the metadata with the selected point avoids new parent-card fields or
extra personal revision updates. Existing records have null components, new tables
start empty, and existing migrations/RPC bodies/grants/RLS policies remain intact.
Personal table reads retain owner RLS; group table reads require current membership.
No direct client/service-role writes or receipt-table access are granted.

## Saves, permissions and edits

New personal/group wrappers reuse the existing destination RPCs and immutable
receipts. Coordinates, components, visit and all applicable proofs commit in one
transaction. A sibling immutable request hash covers the complete selected
location. Exact retries return the old result; changed payloads or receipts from
another API cannot attach metadata to an earlier save. Replays never recreate
metadata after an address change or deletion. Recovery still stores only request
markers and reconciles by reading existing receipts, with no automatic replay.

The first selected point and known components are retained. The same point may
gain missing components; conflicting points or known components reject the whole
destination with a visible message to choose the saved restaurant. Members can
create new group cards with Apple data. Enrichment of existing group cards remains
Owner-only; a Member can reuse an identical stored snapshot when adding a visit.
An attempted unauthorized enrichment fails explicitly without creating a visit.
Apple Place ID creation/fill rules are unchanged.

Manual entries remain valid without coordinates/components, and manual visits do
not erase existing metadata. Native name/address edits clear the transient selected
snapshot and Apple ID; cuisine-only edits retain them. Persisted address edits clear
all corresponding MapKit metadata, Apple identity and existing verified locations
through the new group trigger and unchanged existing invalidation triggers. Shared
historical Restaurant rows invalidate all affected group entries. Persisted
name/cuisine-only changes retain locations.

Recent choices and source revalidation retain current MapKit snapshots; conflicting
recent snapshots remain separate choices. Raw location selections stay out of
route parameters, logs and recovery journals. The development-only location repair
uses a compatible new wrapper and verifies selected components during readback,
without changing card facts, Apple IDs, visits or revisions. Its rollout gate is
unchanged. Separate Geoapify metadata and map-pin precedence are preserved even
when both sources exist.

## Automated validation

Local validation passed: TypeScript, uncached lint, whitespace checks; navigation,
auth and personal suites; Milestone 17 safety, unified Add/recovery, native search,
personal/group Apple identity, personal drafts, location persistence/repair,
autocomplete/search ordering, Add usability, and the unchanged Home Dashboard/UI/
collection-statistics suites. This includes 21 offline Swift-engine checks, 10
structured-location client scenarios and 19 repair scenarios. The complete
disposable SQL/PostGIS run passed, including existing preservation/regression
suites and seven new overlapping-transaction scenarios. Final review verified the
pre-existing Dashboard files by hash and preserved its database declarations.

Offline coverage uses production native-engine/TS/TSX/coordinator code with fake
provider, storage and HTTP boundaries. The disposable PostgreSQL/PostGIS runner
adds `--structured-mapkit` to the existing explicit local-tooling arguments; it
creates a fresh temporary cluster with a private Unix socket and removes only its
own fixture directory. It verifies preservation, SQL/RLS contracts, rollback,
legacy API compatibility, and real overlapping transactions. It does not read app
configuration or contact hosted Supabase.

## Hosted deployment

Migration 18 was applied once after explicit approval and an immediate check of
the hosted project, exact deployed migrations 1–17 baseline and reviewed SQL
checksum. The existing 18-table application backup, schema and migration history
passed integrity checks, disposable restoration and transaction rollback-guard
verification before deployment. Equivalent qualified/unqualified PostGIS
definitions were compared only after proving their actual object bindings.

The guarded transaction applied only
`20261021001800_structured_mapkit_locations.sql` and registered its source in
migration history atomically. Read-only post-deployment checks matched the
rehearsed schema, RLS, table permissions and RPC grants, and preserved all 35
pre-deployment application rows. Migrations 1–17 were not replayed; no reset,
backfill or application test write was part of deployment.

The first API probe returned 404 before the notified PostgREST schema-cache
reload finished. Narrow log inspection supported a transient reload timing race;
both new read RPCs subsequently resolved and correctly denied anonymous execution
with HTTP 401 / SQLSTATE 42501. No corrective refresh or permission change was
needed. The original failed probe body was not retained, so its exact error code
is unavailable.

## iOS acceptance

The Debug app was rebuilt and installed in place on the existing iPhone 16 Pro
simulator running iOS 18.3, with the updated native adapter. The build completed
with zero errors. Existing sign-in, groups, app storage and other installed apps
were retained; Home, My Places, Groups and Add passed read-only smoke checks.

The user performed restaurant saves and address edits through the app. Focused
hosted read-only checks confirmed these results without exposing note text:

| Scenario | Verified result |
| --- | --- |
| Apple Maps selection saved to My Places and an owned group | All six structured fields, formatted addresses, coordinates and Apple Place IDs persisted with correct destination associations; one entry and visit per destination, with separate private/group notes. |
| Only the saved personal address changed | Personal Apple identity and the entire MapKit row were cleared; the group address, Apple ID, coordinates and components matched the original immutable save proofs. Both original visits remained intact. |
| Restaurant entered manually | Correct address, one visit, rating 3 and would-go-again No; no Apple ID, MapKit coordinates or structured Apple metadata. |
| Apple result selected, then its address changed before saving | Edited address, one visit, rating 4 and would-go-again Yes; no stale Apple ID, coordinates or components and no saved entry at the original selected address. |

The final check found no duplicate entries/visits or unintended group/shared
restaurant records for the two personal-only fallback saves. Earlier Apple Maps
test records and visits still matched their original save receipts, including the
intentional personal address invalidation. QA records were left in place.

The agreed Structured Apple Maps acceptance scope is complete, with no known
functional blocker. Group saved-address invalidation has no current group
card-facts editor; that trigger, Member/Owner enrichment rules, concurrency and
uncertain-save recovery retain the automated/disposable database coverage above.
This does not claim additional live response-loss or account-switch acceptance.

Expo Go does not contain the bridge; release/native/Geoapify gates remain
unchanged. Future native bridge changes require another development build.
A missing new backend RPC fails explicitly without retrying a metadata-dropping
legacy save. Any further hosted writes, repairs, backfills or QA cleanup require
their own authorization; historical deployment steps are not permission to rerun
the migration or reset data.
