# Milestone 18 — Actual hosted backup verification

> Historical phase report: statements about pending deployment, approval, counts
> and simulator steps below describe this report's original checkpoint.
> Current state: migrations 15–17 and REST verification passed; the owner confirmed
> the separately approved In-N-Out location repair preserved its visit, and
> Special Noodle's saved coordinates produced a second verified personal pin.
> See the [current completion review](milestone-18-completion.md). Do not repeat
> migrations or repair from this historical report.

**Application-scope backup verified; migrations 15/16 passed local rehearsal.**
Hosted deployment was subsequently approved and completed; see the
[deployment report](milestone-18-hosted-deployment.md). No hosted access or writes,
dependency installation, staging, commit or push occurred during this verification.

## Durable snapshot

- Source: /Users/jayma/Desktop/Stuff/GroupBite Backups/milestone-18-manual/hosted-application-snapshot.csv
- Captured: **2026-10-17 23:09:42.002026 UTC**
- Size: **325,017 bytes**
- SHA-256: 81686e0dd907df76b53d8d31d4b74a220e119840f59177060da42970b75b9d83
- Format: one CSV row containing the complete groupbite-m18-logical-v1 JSON.
- Directory permissions: **0700**; source and verification files: **0600**.
- Private manifest, checksum index, exact migration copies, replay source and
  verification results are in the durable sibling directory
  verification-20261017T231636Z/. No private rows, IDs, coordinates or function
  source contents are reproduced in this report or committed to Git.

The original file's checksum was verified before and after restoration/rehearsal.
All 14 captured application tables had RLS filtering inactive. The export contains
every application account, plus three Auth dependency IDs only. All 14 stored
migration versions, names and SQL token payloads match local migrations 1–14.
The snapshot predates migrations 15/16.

| Table | Rows |
| --- | ---: |
| profiles | 3 |
| groups | 2 |
| group_memberships | 3 |
| group_invites | 7 |
| join_requests | 6 |
| restaurants | 9 |
| group_restaurants | 10 |
| visits | 15 |
| visit_save_requests | 14 |
| personal_places | 6 |
| personal_place_locations | 1 |
| group_restaurant_locations | 0 |
| visit_save_location_bindings | 5 |
| geoapify_request_admissions | 14 |
| **Application rows** | **95** |

The six personal cards cover all three accounts. There are no exact identity or
Apple-reference duplicate keys, near-overflow personal revisions, or existing
m18: personal request IDs in this snapshot.

## Restoration and migration evidence

An owned disposable PostgreSQL **17.11** cluster used only a private Unix socket,
with TCP disabled and inherited environment cleared. No app secrets, hosted
connections, synthetic test accounts or fixtures were used. The local Auth table
contained only the three captured dependency keys; this does not recreate Auth
accounts, sessions or credentials.

Before restoring records, the reconstructed application catalog matched all
captured table definitions, **96 columns, 82 constraints, 33 indexes, 15 policies,
31 functions and five table triggers**, including owners and captured effective
permissions for anon, authenticated, service_role and PUBLIC. Schema USAGE/CREATE
and applicable captured default grants were restored locally. Matching the
export's schema search path resolved equivalent PostGIS qualification differences.
The captured public ensure_rls event hook was replayed during the rehearsal.

All 95 real application records and 14 migration-history rows restored with FKs
and checks active. The deferred group owner/membership relationship validated at
transaction completion. IDs, owners, revisions, timestamps, source latitude/
longitude, receipts and bindings were preserved. Generated geography was
recomputed rather than inserted into a generated column.

**Migration 15** preserved all original records and backfilled exactly **four**
legacy personal visits with original IDs, owners, values and timestamps.
Two empty cards received no invented visits; two existing undated memories stayed
undated. The new recovery ledger remained empty.

**Migration 16** preserved every original record and all pre-existing function
bodies/owners/EXECUTE grants, old RLS policies, indexes, constraints, table triggers
and unrelated table/column permissions. The restored dataset remained unchanged
through both migrations, including its generated geography value.

All three actual account identities saw exactly their own backfilled personal
history. The expected personal direct-write cutover and private receipt ledger
permissions were enforced. No save RPC or additional visit was needed for this
verification. Earlier automated SQL/concurrency evidence remains separate;
the old full regression suites were not repeated.

The disposable database was stopped and its owned runtime directory removed.

## Exactness limits and deployment decision

Hosted PostGIS is **3.3.7**; the existing local tooling supplies **3.5.6**. One
generated personal_place_locations.location value differs in binary form after
recomputation. Its latitude/longitude columns and every other original stored
value are exact. The measured geometry difference is approximately
**2.021 × 10⁻¹³ degrees**; the geography distance function reports zero meters.
This was explicitly bounded and recorded, not treated as byte-identical recovery.
The untouched CSV retains the exact source geography representation.

Thus this is a verified **logical application restore**, with a documented
generated-value precision caveat. Bit-identical geography regeneration requires
version-matched PostGIS tooling and separate installation approval if unavailable.
No PostGIS upgrade or spatial rewrite is part of migrations 15/16.

This scope excludes Auth secrets/sessions/identities, Storage objects and Vault/
platform configuration. Six managed PostgREST/GraphQL/extension event hooks were
retained as metadata rather than replayed in an application-only PostgreSQL
cluster. Their complete managed service environment was not reproduced. This is
not a whole-project disaster-recovery image.

**Ready for separate approval of the application migrations**, with these limits
disclosed. Before actual deployment, confirm the project still has exactly 1–14
applied, recheck both reviewed hashes, and recapture/verify the backup if writes
occurred since this snapshot. Pause old personal writes; apply **15 then 16**;
perform read-only validation; activate the compatible app before resuming writes.
Old binaries' direct personal writes intentionally fail after migration 15.
Do not use a destructive down migration after real history writes begin.

Reviewed file hashes:

- 20261017001500_personal_visit_history.sql:
  8a5b249f039fb4619f0754aaf477e16a958b97a782c37ec7667d26dbed67c41e
- 20261017001600_unified_add_destinations.sql:
  75272321fe61d56e4a18e2bcb68bbfaabf6699f62b92f19361b80efb3e13703c

At the end of this backup-verification phase, the next approval was to authorize
only those two hosted migrations and their compatible
client cutover, including the chosen migration access method. The previously
rejected linked CLI query was not retried; any workflow requiring temporary hosted
login-role creation needs explicit authorization or an alternative approved access
method. Cleanup, seeding, Auth changes and unrelated deployment remain excluded.
