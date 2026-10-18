# Milestone 18 hosted preflight — Migrations 15/16 deployed

> Historical phase report: statements about pending deployment, approval, counts
> and simulator steps below describe this report's original checkpoint.
> Current state: migrations 15–17 and REST verification passed; the owner confirmed
> the separately approved In-N-Out location repair preserved its visit, and
> Special Noodle's saved coordinates produced a second verified personal pin.
> See the [current completion review](milestone-18-completion.md). Do not repeat
> migrations or repair from this historical report.

**Latest result:** migrations `20261017001500` and `20261017001600` were
subsequently approved and applied, in that order, to GroupBite
`goperhgeqyqzepbtwtaz`. Each schema change and its exact migration-history SQL
were committed together. Fresh predeployment comparison matched all original
rows, migration history, schema and permissions against the verified backup.
Postdeployment checks preserved all 95 original application rows and produced
exactly four legacy personal visits, leaving two empty cards without visits.
See the [hosted deployment report](milestone-18-hosted-deployment.md).

The remaining access/preflight notes below are historical. The rejected linked
CLI query was never retried, and no temporary hosted login role was created.

## Subsequent backup approval and access attempt

The owner subsequently reported completing dashboard blocks A/B/C and approved
a read-only logical backup plus local restoration. A fresh dedicated read-only
API probe succeeded as `supabase_read_only_user`, with `read_only=on`, unfiltered
personal-place access, exactly 14 applied migrations (latest `20261013001400`)
and six personal cards. The subsequent normal Keychain retrieval for the actual
backup capture timed out before any backup request was sent. No actual hosted
backup was created and no actual-backup restoration/migration rehearsal ran.
The rejected linked CLI command was not retried. No credentials were exposed.

[m18_logical_backup.sql](../supabase/dev/m18_logical_backup.sql) is the prepared
SQL Editor handoff: one read-only SELECT and one MVCC snapshot containing all 14
application tables across all accounts, schema/permission metadata, migration
history, extension versions and only the Auth user IDs required by profile FKs.
This includes complete contributor/receipt dependency coverage; the older scoped
export alone omits required parents and schema/history. It excludes Auth secrets,
sessions, identities, Storage objects and Vault/platform configuration. It is an
application-scope logical JSON snapshot, not a whole-project `pg_dump` archive.

Next manual step: run that SELECT in the authorized GroupBite SQL Editor, export
the entire one-row result as CSV, and save it outside Git at
`/Users/jayma/Desktop/Stuff/GroupBite Backups/milestone-18-manual/hosted-application-snapshot.csv`.
Use mode 0700 for the backup directories and 0600 for the file. Share only the
local path, not its contents. That lets the agent record hashes/counts and resume
the already-approved isolated restoration and migration rehearsal. No further
backup-verification approval is needed; hosted deployment remains separate.

The earlier preflight notes below retain their original observation context.

Observed 2026-10-17. **Deployment is not yet cleared.** Project metadata was
confirmed, but fresh hosted database history, catalogs and data could not be read
through the permitted access path. No hosted database statement, migration,
record change, seed, authentication change, staging, commit or push was performed.

## Confirmed project and access

- Local link, a Management API project-identity read and the existing CLI project
  listing agree on **GroupBite / `goperhgeqyqzepbtwtaz`**, organization
  `kraggruupetmvveiusfe`, region `us-west-1`, status `ACTIVE_HEALTHY`.
- The CLI backup listing returned `backups: null`, `physical_backup_data: {}`,
  `pitr_enabled: false`, `walg_enabled: true`. No usable physical backup or restore
  point was verified. WAL-G enablement alone is not evidence of a recoverable copy.
- Existing CLI metadata access works. Direct retrieval of its existing macOS
  Keychain credential for the dedicated read-only API timed out; no credential was
  saved, printed, replaced or obtained through another store.
- Automatic approval review rejected the proposed linked CLI query fallback
  because linked DB commands may initialize temporary database login roles. That
  command did not run and was not retried through another execution method.
- Current hosted migration history is **unverified**. The earlier owner-confirmed
  milestone had migrations 1–14 deployed; that historical statement does not
  establish today's database state. No cached catalog/data is presented as fresh.

The dedicated API is documented at
[Supabase read-only query](https://supabase.com/docs/reference/api/v1-read-only-query).
It must use a normally authorized session and retain its permission restrictions.
Do not use linked DB query/dump/push/dry-run commands during this read-only phase.

## Prepared compatibility checks

[m18_preflight.sql](../supabase/dev/m18_preflight.sql) contains SELECTs for an
owner-authorized SQL Editor or dedicated read-only API session. It was executed
successfully against a disposable synthetic migration-14 schema, **not hosted**.
The queries cover:

- All applied migration versions and names; compare with local migrations 1–14.
  Only `20261017001500` and `20261017001600` should be pending. Current function
  bodies and schema metadata establish deployed behavior; stored migration SQL
  can be requested separately if a discrepancy requires it.
- Server/extensions/isolation, current role and active RLS filtering; counts are
  meaningful only when the authorized inspection covers the complete target data.
- Tables, columns, constraints, indexes, policies, functions, triggers, effective
  grants, default grants, name collisions and current target locks.
- Exact duplicate cards, duplicate Apple references and conflicting addresses;
  actual legacy memory/backfill counts, NULL dates, false values, invalid fields,
  missing owners, near-overflow revisions and existing `m18:` request prefixes.
- Event-trigger definitions and owners. The earlier hosted `ensure_rls` /
  `public.rls_auto_enable()` customization needs fresh review: migration 15 creates
  two tables, unlike migration 14's ALTER TABLE path. Do not disable that platform
  trigger or assume its current body/provenance is harmless.

Until these results are available, there is no fresh conclusion about hosted data
compatibility, permission drift, unrelated functionality or migration lock impact.
Locally, both migrations preserve existing rows and pre-existing function bodies
and EXECUTE grants; personal direct-write revocation is an intentional exception
to permission preservation. The previous local verification report remains valid.

Reviewed file hashes (unchanged in this phase):

```text
20261017001500_personal_visit_history.sql
8a5b249f039fb4619f0754aaf477e16a958b97a782c37ec7667d26dbed67c41e
20261017001600_unified_add_destinations.sql
75272321fe61d56e4a18e2bcb68bbfaabf6699f62b92f19361b80efb3e13703c
```

## Scoped backup and restoration

No hosted data backup was captured. Before deployment, inventory the actual scopes
and capture a private, durable, hashed backup; `/private/tmp` evidence is temporary
and is not a durable hosted backup. A whole-project restore is not required merely
because PITR is unavailable, but the logical backup must be verified and complete
for the affected scope.

Migration 15 backfills **every** existing personal card with recorded memory.
Therefore the minimum deployment data scope is **every owner with a personal
card**, their complete personal cards and verified-location rows. Include history
and destination receipts if present; unexpected existing new tables first require
investigation. Do not restrict this migration backup to Jay alone. Group rows are
not changed by either migration. If group scopes are included, capture every
contributor's relevant legacy receipts/bindings and verify all external dependency
IDs; the current actor-scoped export is not a standalone whole-group recovery copy.

[m18_backup.sql](../supabase/dev/m18_backup.sql) accepts explicit account/group UUID
arrays. It now uses **one REPEATABLE READ READ ONLY snapshot**, records scope/time/
isolation metadata and orders exported rows deterministically. Keep the export,
its SHA-256 manifest, public schema/ACLs, migration history, extension versions and
compatibility results together outside Git with private filesystem permissions.
Verify all parent profile/Auth/group IDs still exist; this export deliberately
does not contain Auth credentials, users, sessions or authentication configuration.

With an already-authorized read-only PostgreSQL service/connection available,
the following are the required backup actions. `groupbite-approved-readonly` and
the UUID arrays are operator-supplied verified inputs, **not configured here**:

```sh
umask 077
export PATH=/private/tmp/groupbite-m18-tooling/Postgres.app/Contents/Versions/17/bin:$PATH
mkdir -p "$GROUPBITE_BACKUP_DIR"
PGOPTIONS='-c default_transaction_read_only=on' \
  pg_dump --dbname=service=groupbite-approved-readonly --schema-only \
  --schema=public --schema=supabase_migrations --format=custom \
  --file="$GROUPBITE_BACKUP_DIR/schema.dump"
psql 'service=groupbite-approved-readonly' -X -A -t -q -v ON_ERROR_STOP=1 \
  -c "SET groupbite.m18.backup_accounts = '$GROUPBITE_BACKUP_ACCOUNTS'; SET groupbite.m18.backup_groups = '$GROUPBITE_BACKUP_GROUPS';" \
  -f supabase/dev/m18_backup.sql > "$GROUPBITE_BACKUP_DIR/scoped-data.txt"
shasum -a 256 "$GROUPBITE_BACKUP_DIR/schema.dump" \
  "$GROUPBITE_BACKUP_DIR/scoped-data.txt" > "$GROUPBITE_BACKUP_DIR/SHA256SUMS"
pg_restore --list "$GROUPBITE_BACKUP_DIR/schema.dump" \
  > "$GROUPBITE_BACKUP_DIR/schema-contents.txt"
```

Do not invent a password or initialize a login role to run these commands. If
direct read-only DB access is unavailable, an authorized read-only API export can
capture equivalent data/catalog evidence; do not claim that a catalog JSON file
is a complete `pg_dump` archive. Review any platform-owned schema objects before
restoring them. Supabase's broader guidance is
[Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

Restoration procedure, requiring separate approval for any hosted repair:

1. Pause writers; verify project/schema stage, backup hashes and dependency IDs.
   Rehearse the **actual** captured backup in an isolated local database first.
2. Do not drop/rebuild the hosted schema or replay all old migrations. A failed
   migration transaction rolls back its own work. If 15 committed but 16 failed,
   finish/fix 16 before enabling the app; do not destructively reverse 15.
3. For a reviewed missing-row repair, open one transaction and lock affected
   personal tables. Restore parent cards, then visits (if applicable), then
   location metadata. Insert only captured non-generated columns: PostGIS
   `location` is generated from coordinates and must not be inserted explicitly.
4. After migration 15, temporarily disable **only**
   `personal_visits.refresh_personal_place_memory` inside that same repair
   transaction, restoring its enabled state before commit. Otherwise restoring
   history changes parent revisions/timestamps. Keep FKs, checks and all other
   triggers active. This is a future approved recovery operation, not a preflight
   action or a change to authentication settings.
5. Existing matching rows can be retained; any conflicting ID, changed row or
   identity collision must abort for review. Do not overwrite later user changes,
   purge receipts, resurrect tombstones automatically or use a blanket upsert.
6. Compare captured IDs/counts and canonical full-row hashes, all personal
   revisions/timestamps/history/location values, receipt IDs and unrelated-table
   snapshots. Commit only when every scoped comparison matches. Once real M18
   writes exist, prefer a forward fix; restoration must reconcile newer history.

The existing backup script was exercised before and after 15/16 on synthetic data
in a disposable local PostgreSQL 17.11 / PostGIS 3.5.6 database. Both recovery runs
restored exact parent/visit IDs, values, revisions, timestamps and location rows;
every unrelated table and immutable receipt remained unchanged. Generated-column
insertion and history-projection requirements above came from that rehearsal.
This proves the procedure on synthetic fixtures, **not restoration of hosted data**.

Rehearsal source, synthetic backups and successful logs are private temporary
artifacts under `/private/tmp/groupbite-m18-preflight-kpdtwqlt/`. Rerun locally:

```sh
/opt/homebrew/opt/node@24/bin/node \
  /private/tmp/groupbite-m18-preflight-kpdtwqlt/restore-rehearsal.mjs \
  --postgres-bin /private/tmp/groupbite-m18-tooling/Postgres.app/Contents/Versions/17/bin \
  --pg-module /private/tmp/groupbite-m18-tooling/node_modules/pg/lib/index.js
```

## Deployment order — not authorized or executed

1. Complete the blocked hosted SELECTs, resolve any drift/event-trigger/data
   issues, capture and verify the actual backup, and approve a writer-pause window.
2. Keep the M18 client inactive. Pause old clients' personal writes and require
   testers to update/reload to the compatible app before resuming. Migration 15
   intentionally revokes the old direct personal INSERT/UPDATE/DELETE paths;
   mixed active old/new binaries cannot retain the old write behavior safely.
3. Recheck the hashes and fresh history; apply **15, then 16** using the approved
   migration workflow, registering both versions. Both must finish before the new
   Add/history flow is enabled. Existing group RPC signatures are retained.
4. Perform read-only post-deployment checks of history, exact preserved old rows,
   expected legacy backfill, grants/RLS/helper restrictions, old functions and new
   atomic receipt RPC definitions. Then activate the compatible app and resume
   writers. Any hosted functional test writes need their own explicit approval.

Only after separate deployment approval and fresh history confirms exactly those
two pending files, the current CLI's deployment command is:

```sh
env DO_NOT_TRACK=1 SUPABASE_TELEMETRY_DISABLED=1 \
  supabase db push --linked --project-ref goperhgeqyqzepbtwtaz --skip-vault
```

Do **not** use the earlier nonsecret preflight password placeholder for deployment,
or add `--include-all`, `--include-roles` or `--include-seed`. The deployment workflow
may create/update a temporary CLI DB login role; its separate write approval must
explicitly cover that, or the owner must choose an authorized migration channel
that does not require it. `--dry-run` is not a safe read-only substitute here.
No cleanup, fixture population, function deployment or Auth change is included.

**Next action:** enable normal access for the dedicated read-only API, or have the
owner execute/export the prepared SELECTs through the authorized SQL Editor.
Complete the real backup/export/restore checks before asking for deployment.

SQL Editor handoff: run labeled blocks A, B and C individually. Share all version/
name rows from A, the complete `compatibility` JSON from B and the complete
`catalog` JSON from C. JSON-cell copies or CSV exports are suitable; no application
row exports are needed. Review function-source/default-expression literals for
any unexpectedly hardcoded credentials and redact those values before sharing.
An SQL Editor session can report `read_only: off`; the reviewed SELECT statements
themselves remain read-only. If access is denied, share the error and retain the
existing role/permission configuration. Backup execution remains separately gated.
