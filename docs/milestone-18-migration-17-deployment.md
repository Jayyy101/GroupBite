# Milestone 18 — Migration 17 hosted deployment

> Historical phase report: statements about pending deployment, approval, counts
> and simulator steps below describe this report's original checkpoint.
> Current state: migrations 15–17 and REST verification passed; the owner confirmed
> the separately approved In-N-Out location repair preserved its visit, and
> Special Noodle's saved coordinates produced a second verified personal pin.
> See the [current completion review](milestone-18-completion.md). Do not repeat
> migrations or repair from this historical report.

**Migration 17 is deployed and verified on GroupBite `goperhgeqyqzepbtwtaz`.
The standalone REST check now passes: HTTP 401 / `42501`, the expected anonymous
permission denial. The compatible app can safely restart for simulator testing.
Do not reapply migration 17.** See the [REST result and restart steps](milestone-18-rest-verification.md).

## Deployment and preservation

The owner confirmed `m17-read-only-smoke-passed` from the exact authorized SQL
Editor script. That satisfies the previously blocked account-role read check;
the failed API account-role request was not repeated. All three test accounts
remained paused. One normal existing Keychain lookup succeeded, with the token
kept only in process memory and never printed or stored.

The confirmed project identity/health and fresh read-only snapshots matched the
verified backup. Immediately before deployment, at **2026-10-18 06:14:47.258217
UTC**, hosted state still had migrations 1–16 and exactly the original 126
application rows, schema, permissions, migration history and Auth dependency keys.

Pinned source checksums remained unchanged:

- Backup, 429,047 bytes:
  `a31ceec66c2e8f32d2246ae1092b8ab012a051bf1f7445390d45f3197c161ed4`
- Migration `20261018001700_personal_mapkit_locations.sql`:
  `deeef1c0e92e26ad3b5316002e868f9e1716e25a6e184c7df619c94512d9bbec`
- Reviewed guarded deployment transaction:
  `d7496e649ea85cb14867300eb4e9e11da7760adf39a53b7ea972a28f98316ae4`

Only that reviewed migration-17 transaction was submitted, once, using the
existing authorized Management API. It locked all original application tables
and migration history, rechecked data/schema/permission fingerprints, applied the
reviewed migration, inserted its exact version/name/original SQL in history, and
checked the expected postconditions **before committing**. Local rehearsal had
proved both deliberate precondition and postcondition failure roll back all DDL
and history together. No temporary login role or linked CLI command was used.

## Hosted database verification passed

The postdeployment snapshot at **2026-10-18 06:14:49.568643 UTC** confirmed:

- Migration **`20261018001700` / `personal_mapkit_locations`** is registered with
  the exact original SQL text. Original migration history 1–16 is unchanged.
- All **126 original application rows** are exact, including IDs, owners,
  revisions, timestamps, restaurant cards, group history, locations, bindings,
  **seven personal visits** and **seven destination receipts**. Hosted spatial
  values were not recomputed or changed; the local PostGIS precision caveat did
  not affect hosted preservation.
- Existing functions, table/column/function ACLs, grants, policies/RLS, defaults,
  extension/event-hook metadata and relationships match the verified snapshot.
  Existing account/group privacy definitions are unchanged from the owner-verified
  read-only baseline. No new hosted account-role API call is claimed.
- `personal_mapkit_locations` and `personal_mapkit_save_requests` exist and are
  both empty. Their RLS and grants match the reviewed rehearsal. Owner-scoped
  SELECT exists only for selected points; the coordinate-proof ledger has no
  client/service-role table access. Neither table inherited MAINTAIN privileges.
- The three new authenticated RPCs and two private helpers match their exact
  reviewed definitions, owners, search paths and execution permissions. No save
  or repair RPC was invoked for verification.
- Final checked application catalog: **18 tables, 124 columns, 105 constraints,
  41 indexes, 17 policies, 47 functions and ten table triggers**.

The original Ranch Dr In-N-Out card and its **same one visit** remain unchanged,
with no Apple ID or new location. Its repair remains separately gated.

## Historical stop point — subsequently resolved

After database verification, a read-only anonymous PostgREST call to
`get_personal_mapkit_locations` did not produce the probe's expected HTTP
401/403 with SQLSTATE `42501`. The runner stopped immediately, as required,
without retrying the probe, reapplying migration 17 or attempting rollback.

The probe did not retain the unexpected HTTP status/error body, so its cause is
**not established**. Do not infer either a privacy leak or a schema-cache problem.
The independently checked database RLS/grants are correct and both point tables
are empty. The probe used the full configured publishable key and confirmed
project URL; no key or token was printed. No application data mutation was
possible through that stable, SELECT-only map reader.

The saved state at that historical stop point was:

- `applied: true`
- `request_in_flight: false`
- `migration_submission_count: 1`
- Database history/schema/preservation verification: passed.
- Additional REST/client-access verification: unresolved; no retry.
- `safe_to_restart_compatible_app: false`

The owner then authorized a standalone read-only diagnostic. It returned HTTP
401 / `42501` and the expected function permission-denied message, matching the
verified signature and authenticated-only EXECUTE grant. This resolved the
restart blocker without any backend change. The earlier response remains unknown
because it was not retained. See the [completed REST verification](milestone-18-rest-verification.md);
no deployment retry was performed or is needed.

## Durable evidence and boundaries

Private pre/post snapshots, reports, exact reviewed SQL, local transaction proof,
read-only scripts and SHA256SUMS are archived in:

`/Users/jayma/Desktop/Stuff/GroupBite Backups/milestone-18-pre17/deployment-20261018T061658Z/`

Directories are 0700 and files 0600. The original verified backup is unchanged.
No private row data or account IDs were copied into the repository. See the
[backup report](milestone-18-migration-17-backup-verification.md) for recovery scope.

No In-N-Out repair, unrelated migration, existing-record modification, cleanup,
deletion, seeding, authentication-setting or permission change outside migration
17, dependency installation, staging, commit or push occurred.
