# Milestone 18 — Current backup and migration 17 verification

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

**The fresh application backup is verified, and migration 17 passed against its
isolated local restoration. Ready for separate hosted deployment approval, with
the logical recovery limits below. No hosted deployment or repair occurred.**

## Source and completeness

- Original file: `/Users/jayma/Desktop/Stuff/GroupBite Backups/milestone-18-pre17/hosted-pre17-snapshot.csv`
- Captured: **2026-10-18 05:31:41.490024 UTC** (October 17, 10:31 p.m. Pacific).
- Size: **429,047 bytes**.
- SHA-256: `a31ceec66c2e8f32d2246ae1092b8ab012a051bf1f7445390d45f3197c161ed4`.
- Source file **0600**; backup/verification directories **0700**; archive files
  **0600**. Original CSV remained unchanged throughout verification.
- One complete CSV row contains the `groupbite-m18-logical-v2` JSON for confirmed
  GroupBite project `goperhgeqyqzepbtwtaz`. All 16 application tables are present,
  matching the application catalog; none report active RLS filtering.
- Independent captured table counts match the actual arrays. Embedded PostgreSQL
  SHA-256 data/history fingerprints match. All 16 migration versions and stored
  SQL token payloads match the local migrations. Migration 17 remains pending.
- All three profiles/Auth dependency keys and all accounts' records are included,
  with no actor/date/restaurant filter. The new simulator personal/group visits
  and private destination recovery receipts are present.

| Table | Rows |
| --- | ---: |
| profiles | 3 |
| groups | 2 |
| group_memberships | 3 |
| group_invites | 7 |
| join_requests | 6 |
| restaurants | 11 |
| group_restaurants | 12 |
| visits | 19 |
| visit_save_requests | 18 |
| personal_places | 7 |
| personal_visits | 7 |
| personal_place_locations | 1 |
| group_restaurant_locations | 0 |
| visit_save_location_bindings | 9 |
| geoapify_request_admissions | 14 |
| add_destination_requests | 7 |
| **Application rows** | **126** |

## Actual restoration

An owned disposable PostgreSQL **17.11** / PostGIS **3.5.6** cluster used only a
private Unix socket with TCP disabled and the inherited environment cleared.
Existing installed tooling and the isolated `pg` dependency were reused. No
hosted connection, credentials, dependency installation, synthetic accounts or
seeded visits were needed. The local Auth table contained only the three captured
FK keys, not recreated authentication accounts/sessions/services.

Before loading records, the reconstructed application schema matched all captured
**16 tables, 115 columns, 96 constraints, 39 indexes, 16 policies, 42 functions and
eight table triggers**, including owners and effective app permissions. Captured
application table/column/function ACLs, grantors, grant options and MAINTAIN grants
matched semantically, including default PUBLIC function privileges represented by
a NULL ACL. Applicable default grants and app schema USAGE/CREATE were restored.
The captured public `ensure_rls` event hook was replayed locally.

All **126 actual application rows** and **16 migration-history records** restored
with FK/check constraints active. The circular group owner/membership relationship
validated at commit. Only application maintenance triggers were temporarily
suspended during the local import and restored to their captured states, preventing
personal visit loading from rewriting parent projections or revisions. No foreign
key/check constraints were disabled. IDs, owners, revisions, timestamps, source
coordinates, visit history and save/recovery receipts were preserved.

For each of the three real account identities, read-only transactions verified
exactly its own personal cards/history, saved-location scope, authorized group
entries/history and actor-scoped receipt visibility. These are local restored-copy
checks, not newly executed hosted runtime tests.

## Migration 17 rehearsal

The exact reviewed `20261018001700_personal_mapkit_locations.sql` was applied only
to the restored local database, with the captured RLS event hook enabled.

Reviewed SHA-256:
`deeef1c0e92e26ad3b5316002e868f9e1716e25a6e184c7df619c94512d9bbec`

After migration:

- Every one of the 126 existing rows remained exact relative to the restored
  baseline, including all cards, visits, owners, revisions, projections, receipts,
  bindings and relationships. The original 16 migration-history rows were unchanged.
- All original application table/column/function grants and grantors, default
  grants, functions, policies, constraints, indexes and table triggers remained
  unchanged. Existing group functionality/read results were preserved.
- Two new tables started empty, with RLS and no inherited direct-write or MAINTAIN
  grants. Only the selected-point table grants authenticated owner-scoped SELECT;
  the coordinate-proof ledger has no client/service-role table access.
- Three new public RPCs are authenticated-only. Both internal helpers are
  uncallable by PUBLIC, anon, authenticated and service_role. Search paths and
  security-definer attributes match the design.
- All three accounts' existing personal/group/receipt reads matched their exact
  pre-migration results. New map reads returned no invented locations. Private
  ledgers remained inaccessible.
- Resulting application catalog: **18 tables, 124 columns, 105 constraints,
  41 indexes, 17 policies, 47 functions and ten table triggers**.

No save or location-repair RPC was invoked on the restored records. The earlier
atomic rollback/idempotency/recovery and five new concurrency tests remain separate
contract evidence; they were not unnecessarily repeated in this backup phase.
The bare migration file does not register its own history row. A later approved
hosted deployment must register version `20261018001700` and its reviewed SQL
atomically with the schema changes; the local rehearsal preserved history 1–16.

## In-N-Out preservation and repair boundary

The actual snapshot independently confirms exactly **one** Ranch Dr In-N-Out
personal restaurant card and **one** visit, with no saved location or Apple ID.
The same original card/owner/revision and visit ID/history remained unchanged
through restoration and migration 17. No repair was performed, even locally.

The [location-only repair plan](milestone-18-migration-17-predeployment.md#planned-in-n-out-location-only-repair--not-executed)
remains prepared for separate authorization: re-read the original owner/card and
revision/address, obtain a fresh verified-by-the-user MapKit selection, then call
only `set_personal_mapkit_location` in the owner's normal authenticated session.
It adds a missing private point without changing the restaurant, visit, Apple ID
or history. Do not resave a visit, guess coordinates, merge cards or bypass an
authorization/staleness rejection. Verify exact before/after card/history values.

## Recovery limits and durable evidence

Hosted PostGIS is **3.3.7**; local PostGIS is **3.5.6**. One existing generated
geography value differs in binary representation after regeneration. Its source
latitude/longitude and every other original stored value are exact. The measured
geometry difference is **2.0209913960411387 × 10⁻¹³ degrees** and geography distance
reports **zero metres**. The original CSV retains the exact hosted representation.
Migration 17 does not rewrite spatial columns or upgrade PostGIS. This is a
verified logical application restoration with a measured generated-value caveat,
not a claim of bit-identical whole-project recovery.

Auth credentials/sessions/identities, Storage objects, Vault secrets and platform
configuration are excluded. Six managed PostgREST/GraphQL/extension event hooks
are retained as metadata rather than reproduced with their managed services.
The public RLS event hook and application grants/RLS were exercised locally.

Private manifest, extracted snapshot, original migration copies, capture/catalog
SQL, repeatable restore/rehearsal source, results and **SHA256SUMS** are stored in:

`/Users/jayma/Desktop/Stuff/GroupBite Backups/milestone-18-pre17/verification-20261018T053900Z/`

All **30** archived/source checksum entries were verified. The original CSV hash
was checked before and after rehearsal and again during archival. The disposable
database was stopped and its owned runtime files removed. Private data did not
enter Git or this report. Repository whitespace checks passed; no app code changed
and no client regression suite was repeated in this phase.

## Next authorization

**Ready for separate controlled deployment approval of migration 17 only** on
`goperhgeqyqzepbtwtaz`, followed by its compatible app cutover. Before deployment,
pause all writers, recheck hosted history/schema and the snapshot's relevant data;
recapture and verify if they changed. Apply the backend before reloading the
point-aware app, preserving all pending/uncertain recovery markers.

No hosted migration, repair, cleanup, deletion, seeding, authentication/permission
change, dependency installation, staging, commit or push occurred. The In-N-Out
location-only repair requires its own explicit scoped approval.
