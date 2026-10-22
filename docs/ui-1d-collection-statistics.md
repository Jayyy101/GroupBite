# Collection statistics

Home calls `useHomeDashboard({ includeCollections: true })`, exposing `placesSaved`,
`yourVisits`, `citiesExplored` and `groupsJoined`. The old internal personal
`counts.places` / `counts.visits` retain their original semantics and are not used
as collective headlines. See the [Phase E contract](phase-e-home-dashboard.md).

Every metric has `status`, `value`, `knownCount`, `unresolvedRecords`, and `reason`.
Only ready supplies an exact `value`, including true zero. Loading/incomplete/error
always have null value. City coverage may display `knownCount` explicitly as
**identified**, alongside the number of destination entries needing city facts;
it is not a complete city total. Identity/history gaps display a dash. A historical
record count or linked-event count is never substituted for unique occasions.
Read/access/limit failures never masquerade as zero or keep previous totals.

Places reuse Phase D's `groupMapRestaurants` and address key. Exact opaque Apple
IDs require complete matching current name/address and compatible known coordinates
(within 100m); different branches, conflicting IDs or points stay separate. Complete
ID-less name/address copies may match without bridging conflicting IDs. Additional
raw/verified locality/premise/postcode conflicts and possible rename/co-location
ambiguity make an exact Dashboard total unavailable. No actual records, visits or
permissions are merged. Unsupported/incomplete physical identity remains unknown.

Cities use only current Migration 18 structured Apple components with city, region
and country code. NFC/case/whitespace and a small explicit region alias map apply;
no fuzzy city matching, device location or reverse-geocoding is attempted. Country
and region remain in the key. Missing/sentinel components, conflicting current
Apple/resolved-provider localities and stale snapshots remain unresolved. Apple
facts are selected metadata, not server-verified provider results. The conservative
fallback recognizes explicit US/Canada postal formats only in current **resolved
Geoapify standardized addresses**. Raw manual display strings alone never supply a
city. A recognized raw address can veto contradictory metadata. Unsupported city
aliases/formats remain incomplete rather than guessed.

Narrow RLS-protected projections read personal places, current memberships, group
entries, referenced restaurant facts, verified metadata and current personal/group
MapKit snapshots. Verified points take precedence for the same source, matching
Phase D; coordinates never establish identity alone. No histories, notes, provider
IDs, external geography service or device archive are read for these metrics.
Your Visits uses the aggregate-only migration-19 RPC, scoped to the initiating
account's recorded accessible occasions. Missing RPC affects only that metric.

Inventory uses 200-row keyset pages with exact first-page counts, at most 2,000
saved entries, 1,000 memberships, 80 inventory requests and a 20-second whole-load
deadline. Metadata is fully paged too. Account-pinned tokens, authorization/HTTP
deadlines and before/after **all** membership-incarnation comparisons fail closed.
The final combined Home result rechecks access. Polling checks only membership/
group metadata every 15 seconds while focused/active, never histories or inventory;
overlapping checks are suppressed. A failed check hides collective values and group
content until Refresh. Focus, foreground, account and refresh boundaries immediately
hide old data, cancel/discard old work and serialize replacement batches. No
persistent/global cache. Separate reads are not an atomic database snapshot;
ordinary edits can race refresh and access changes are detected at these boundaries.

Run `node tests/collection-statistics.cjs` and Home suites. Offline HTTP/lifecycle
checks do not prove native behavior, hosted RLS or provider geographic accuracy.
