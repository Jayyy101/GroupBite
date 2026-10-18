# Milestone 18 — Migration 17 predeployment preparation

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

**The fresh hosted application backup is verified and migration 17 passed against
its isolated local restoration. Ready for separate deployment approval; do not
deploy or repair hosted data yet.** See the
[completed verification report](milestone-18-migration-17-backup-verification.md).

The owner supplied a fresh read-only diagnostic: migrations 1–16 applied; exactly
one Ranch Dr In-N-Out personal card and one visit; no Apple ID or saved/resolved
location; no matching duplicates or ownership problems. These are owner-reported
hosted results. No additional hosted query completed during this preparation.

## Migration review

Reviewed file: `20261018001700_personal_mapkit_locations.sql`

SHA-256: `deeef1c0e92e26ad3b5316002e868f9e1716e25a6e184c7df619c94512d9bbec`

- One transaction creates two new tables, five new functions and two triggers.
  No existing function is replaced; there is no backfill, initial data mutation,
  cleanup, identity rewrite or permission change to existing application tables.
  The new address-change trigger affects only future selected-location metadata.
  Its DELETE statement is inside the trigger function; defining the function
  does not delete any current record. Existing cards, visits, projections,
  receipts and verified Geoapify rows are untouched when the migration runs.
- It depends on migration 15's parent/owner unique key, `personal_visits`, existing
  personal save RPC, private destination ledger and immutable-receipt helper,
  plus the existing profile/location tables and `extensions.digest`. Apply after
  the confirmed migration-16 schema. New names must still be absent, and hosted
  default grants / the `ensure_rls` event hook must match the captured snapshot.
- Both new tables enable RLS. Authenticated callers can SELECT only their own
  selected points. There are no direct client/service-role write grants or direct
  coordinate-proof ledger reads; REVOKE ALL also removes inherited MAINTAIN.
  Three public RPCs are authenticated-only. The validator/trigger helper has no
  public/anon/authenticated/service-role EXECUTE grant. Definer functions use an
  empty search path and explicit auth-derived ownership.
- Composite parent/owner FK and address snapshot prevent foreign/stale linkage.
  Coordinates require finite valid bounds and are independent of Apple ID. No
  fake provider identity, signed receipt or building accuracy is invented.
- The point-aware save delegates to the unchanged personal save RPC under the
  same owner lock. Card, visit, original receipt, point and immutable coordinate
  proof commit atomically. Changed-payload retries reject; exact retries create
  no visit, move no existing point and resurrect no deleted/invalidated target.
  Existing request IDs cannot be upgraded silently to coordinate-aware saves.
  An uncertain client response still uses read-only receipt recovery, never
  automatic mutation replay. Group save behavior/grants remain unchanged.
- Prior disposable tests passed preservation, permissions/RLS, failure rollback,
  recovery/idempotency, repair and five new lock-wait races. Those are local
  contract evidence. The fresh actual snapshot has now also passed restoration
  and migration-17 rehearsal; see the completed verification report above.

## Authorized access and fresh export

One normal existing CLI Keychain lookup timed out before any hosted request was
sent. There was no linked CLI database command, temporary role, alternate
credential path, authentication/permission change or retry. The owner then used
the authorized dashboard session to export the fresh CSV; verification used only
that supplied local file and no hosted connection.

The new [`m18_pre17_logical_backup.sql`](../supabase/dev/m18_pre17_logical_backup.sql)
is a single WITH/SELECT statement. All application data, counts, migration history
and catalog metadata share one MVCC statement snapshot. It does not call save or
repair RPCs, execute exported function source, change settings, or issue DDL/DML.
It was executed successfully in an **enforced READ ONLY transaction** on a
disposable local restoration of the historical backup advanced to schema 16.
That query check proves syntax, read-only execution, complete table coverage,
count consistency and ACL metadata; it does not capture today's hosted records.
No synthetic accounts or visits were seeded for this check.

It exports all 16 application tables for **all accounts**, including all current
test visits rather than a restaurant/date/actor filter:

| Data | Tables |
| --- | --- |
| Accounts/groups/access dependencies | profiles, groups, group_memberships, group_invites, join_requests |
| Group history and identities | restaurants, group_restaurants, visits |
| Personal history | personal_places, personal_visits |
| Existing locations | personal_place_locations, group_restaurant_locations |
| Save/recovery proofs | visit_save_requests, visit_save_location_bindings, add_destination_requests |
| Provider admission dependencies | geoapify_request_admissions |

It also captures migration history and stored statements; table/column/constraint/
index/policy/function/trigger definitions; owners and effective app permissions;
raw table/column/function ACL evidence; schema/default grants; extension versions;
event-hook definitions; direct row counts and SHA-256 JSON fingerprints. RLS
filtering flags must be false for every exported table. Auth dependency UUIDs
only are included. This preserves original IDs, ownership, revisions, timestamps,
history and relationships without exporting Auth credentials/sessions/identities,
Storage objects, Vault secrets or platform configuration. It is an application
logical recovery snapshot, **not a whole-project disaster-recovery archive**.

### Manual export reference — completed

1. Open [the confirmed GroupBite SQL Editor](https://supabase.com/dashboard/project/goperhgeqyqzepbtwtaz/sql/new).
   Confirm project reference `goperhgeqyqzepbtwtaz` and use your existing
   authorized dashboard role. Do not change roles or grants if access is denied.
2. Paste the **entire** `supabase/dev/m18_pre17_logical_backup.sql` query into a
   new query. Run it once. Expect exactly one result row with a `backup` column.
   If an error occurs, retain it and stop; do not replace missing sections with
   empty arrays. No migration SQL is part of this export.
3. Export/download the **complete result as CSV**, not a screenshot, truncated
   preview, clipboard excerpt or Excel-resaved copy. Save it as:

   `/Users/jayma/Desktop/Stuff/GroupBite Backups/milestone-18-pre17/hosted-pre17-snapshot.csv`

   The destination directory is already prepared with owner-only mode **0700**.
   It is outside Git. Keep the original historical backup unchanged.
4. Restrict the downloaded file to owner-only access:

   ```sh
   chmod 600 '/Users/jayma/Desktop/Stuff/GroupBite Backups/milestone-18-pre17/hosted-pre17-snapshot.csv'
   ```

5. Share **only the local file path**, not its contents, IDs, private notes,
   tokens or connection information. No new approval is needed to finish the
   already-authorized local checksum, restoration and rehearsal after it arrives.

The supplied fresh CSV is verified: **429,047 bytes**, captured
**2026-10-18 05:31:41.490024 UTC**, SHA-256
`a31ceec66c2e8f32d2246ae1092b8ab012a051bf1f7445390d45f3197c161ed4`.
Its 16 tables contain **126 actual application rows**, including all three
accounts, seven personal visits and seven destination receipts. The original
file is 0600 and its directory 0700. The previous historical backup was preserved.

## Verification and restoration procedure — completed locally

1. Preserve the original CSV; check ownership/mode, compute file bytes/SHA-256,
   record capture time, parse the one-row `backup` JSON and retain a private
   manifest/checksum index beside it. Validate format `groupbite-m18-logical-v2`,
   all exact migration versions 1–16 and their statements, complete catalog/data
   table coverage, no active RLS filtering, direct row counts versus array counts,
   data/history fingerprints, all account/Auth dependency keys and relationships.
   Reject unexpected tables, schema drift, missing rows or truncation.
2. Restore **that exact fresh snapshot**, not reconstructed test data, into an
   owned disposable local PostgreSQL cluster with TCP disabled, a private Unix
   socket, cleared inherited environment and no hosted connections. Use installed
   PostgreSQL/PostGIS and the existing isolated `pg` dependency; install nothing.
3. Reconstruct schema 1–16 and captured app grants/RLS/event hook locally;
   compare catalog definitions and permissions before loading data. Restore Auth
   FK keys only, without recreating authentication accounts. Load in FK dependency
   order with checks active and the deferred group owner/membership relationship
   checked at commit. Suspend application data-maintenance triggers **locally
   during restoration only**, restoring their captured states afterward, so
   loading real personal visits cannot rewrite parent projections/revisions.
   Do not disable FK/check constraints or seed extra accounts/visits.
4. Compare every restored original row/ID/owner/revision/timestamp/relationship,
   migration-history record and schema/permission object. Generated geography
   must be recomputed, and any difference from hosted PostGIS must be measured
   and disclosed. Prior tooling was hosted PostGIS 3.3.7 vs local 3.5.6; the prior
   bounded generated-value roundoff is not a waiver for other differences.
   Platform-managed hooks/full Auth services are not reproduced; retain metadata.
5. Record complete baselines; apply migration 17 **locally only**, with the
   captured RLS event hook active. Compare all existing rows, function bodies/
   grants, table/column grants, constraints, indexes, policies and existing
   triggers. The two new tables must start empty. Check each actual account's
   owner-only reads, new grants/RLS and existing group reads without saving a
   visit. Recheck the original CSV hash. Retain private results/migration copies
   durably and stop/remove only the disposable local database/files it owns.

No destructive down migration is proposed. Any actual hosted recovery would be
separately approved: pause writers, compare current state, prepare a dependency-
aware forward restoration with collision/staleness checks, rehearse it against a
local copy of the incident state, then approve that exact recovery. Do not reset
the project or blindly overwrite valid writes made after the captured snapshot.

## Planned In-N-Out location-only repair — not executed

After separate migration deployment **and** scoped repair approvals:

1. Identify the unique original card/owner privately from the fresh snapshot;
   re-read its current ID, revision, exact address, full card/visit values and
   receipts. Confirm one card and one unchanged visit, no existing resolution and
   no duplicate. A post-capture difference requires review before proceeding.
2. In the owner's ordinary authenticated session, obtain a fresh explicit native
   MapKit selection for In-N-Out at **50 Ranch Dr, Milpitas, CA 95035** and verify
   its displayed name/address. Use the actual returned coordinates; do not guess
   them, convert a temporary search handle to a provider ID, or fill the Apple ID.
3. Call only `set_personal_mapkit_location` with:

   ```text
   target_personal_place_id = original existing card ID
   expected_revision       = freshly read original revision
   expected_address        = exact current stored card address
   selected_latitude       = fresh selected MapKit latitude
   selected_longitude      = fresh selected MapKit longitude
   ```

   Auth derives the owner; it is not a supplied actor parameter. Do not invoke
   `save_personal_visit*`, Add Another Visit, direct INSERT/UPDATE, or a service-
   role bypass. There is no repair button in the current app. A later repair
   needs the reviewed one-off owner-session invocation, or the existing Geoapify
   location-only flow with its own fresh signed receipt/account authorization.
4. The RPC locks/rechecks owner, parent, exact revision/address. Success inserts
   only the private point; an existing resolved point returns false without
   overwriting. Stale/denied/error/uncertain outcomes stop for read-only inspection,
   with no blind retry. First-resolution-wins prevents moving an existing point.
5. Verify the original card, owner, revision, Apple ID, **same one visit with
   unchanged ID/history**, all receipts and unrelated data remain exact. Only one
   matching native location row should be new; the personal map must show it.

## Readiness and remaining gate

Migration 17 is reviewed, its earlier local safety tests passed, and the actual
fresh snapshot has now been restored and rehearsed successfully. **Ready for
separate deployment approval**, with the generated PostGIS roundoff and
application-only recovery scope disclosed in the
[verification report](milestone-18-migration-17-backup-verification.md). No hosted
migration/repair/cleanup/seeding, credential or permission change, dependency
installation, staging, commit or push occurred.

After successful verification, separately approve only migration 17 and the
compatible app cutover. Any hosted location-only repair needs its own explicit
scoped authorization. Keep old native personal-write bundles paused during that
cutover, apply the backend before reloading the point-aware app, and retain all
pending/uncertain save recovery markers. Recheck hosted history/data immediately
before deployment and update the snapshot if relevant writes changed it.
