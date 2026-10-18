# Milestone 18 — Hosted deployment verification

> Historical phase report: statements about pending deployment, approval, counts
> and simulator steps below describe this report's original checkpoint.
> Current state: migrations 15–17 and REST verification passed; the owner confirmed
> the separately approved In-N-Out location repair preserved its visit, and
> Special Noodle's saved coordinates produced a second verified personal pin.
> See the [current completion review](milestone-18-completion.md). Do not repeat
> migrations or repair from this historical report.

Migrations **15 then 16 are deployed and registered** on GroupBite
`goperhgeqyqzepbtwtaz`. Hosted verification completed on **October 17, 2026,
7:41 p.m. Pacific** (`2026-10-18T02:41:41Z`). The compatible Milestone 18 app can
now restart for iPhone simulator acceptance testing.

## Safety and actual deployment state

The interrupted attempt had timed out retrieving the normal CLI Keychain login
before sending any hosted request. On resumption, fresh authorized read-only
inspection independently confirmed history ended at migration 14 and neither new
table existed. No migration was assumed pending or blindly retried.

All three test accounts, Expo and the simulator remained paused. The backup's
325,017 bytes and SHA-256 were rechecked:

`81686e0dd907df76b53d8d31d4b74a220e119840f59177060da42970b75b9d83`

Immediately before deployment, all 95 application rows across 14 tables, three
Auth dependency keys, stored migration SQL/history, extension versions, schema,
RLS, owners, privileges, defaults and event hooks matched the verified snapshot.
Display-only qualification of PostGIS objects and extension event-hook function
names was normalized; their underlying definitions did not change.

The existing authorized Management API SQL endpoint applied only the two reviewed
files. Each migration's body and history insert committed in one transaction.
The history stores the exact original SQL file as one element of its statements
array, with the original version and name. Locks and SHA-256 checks of application
data, Auth dependency keys and migration history guarded against changes between
inspection and execution. The exact wrappers were first verified on an isolated
restore. No temporary hosted login role or linked CLI database command was used.

| Version | Name | Result |
| --- | --- | --- |
| 20261017001500 | personal_visit_history | Applied and verified |
| 20261017001600 | unified_add_destinations | Applied and verified |

## Hosted verification

After each migration, a fresh read-only snapshot confirmed:

- All **95 original rows** retain exact IDs, ownership, revisions, timestamps and
  values, including the original hosted geography representation.
- All **six personal cards** remain intact. Exactly **four legacy visits** contain
  the original memory fields, owner, parent ID and timestamps, with revision 1.
  The **two empty cards** have no visits; undated memories remain undated.
- Three profiles/accounts, two groups, three memberships, nine restaurants,
  ten group restaurant cards and fifteen group visits are preserved. Old save
  receipts, bindings, invites, requests and all other captured rows are unchanged.
- Original migration history is unchanged; both new version/name/SQL payloads
  are recorded correctly. The new destination receipt ledger is empty.
- The full resulting catalog matches the verified rehearsal: **16 tables,
  115 columns, 96 constraints, 39 indexes, 16 policies, 42 functions and
  eight table triggers**, including owners and effective grants.
- New tables enforce RLS; personal history SELECT is owner-scoped and the receipt
  ledger has no client/service-role table grants. No inherited MAINTAIN grants
  remain. Seven new RPCs are authenticated-only; internal helpers are uncallable.
- Old group RPC definitions, owners, EXECUTE grants, RLS, relationships and stored
  history are unchanged. Personal direct writes are intentionally revoked;
  the compatible app uses the new RPCs.

An additional hosted read-only smoke check under the three account identities
could not start because normal Keychain retrieval timed out. **No smoke-test SQL
was sent**, and no alternate credential path or retry was attempted. Per-account
runtime privacy/group behavior passed on the isolated restored copy; hosted
catalog/permissions match that copy. Hosted runtime reads and save flows remain
part of simulator acceptance rather than being claimed as completed UI tests.

No hosted cleanup, deletion, seeding, authentication/credential changes, PostGIS
upgrade, dependency installation, staging, commit or push occurred. Only the two
migrations and their transactional history records changed the hosted database.
The approved direct-write revocation is the intentional permission cutover.

Private snapshots, exact transaction SQL, runner and aggregate deployment report
are stored outside Git in:

`/Users/jayma/Desktop/Stuff/GroupBite Backups/milestone-18-manual/deployment-20261018T024139Z/`

The directory is 0700; its files are 0600 and covered by SHA256SUMS. The original
backup checksum was reverified after deployment. The prior
[backup/restoration report](milestone-18-backup-verification.md) still documents
the application-only recovery scope and local PostGIS regeneration caveat.

## Compatible app restart

Local configuration targets the confirmed project and uses a publishable key.
TypeScript and all 19 targeted Milestone 18 save/recovery checks passed in the
deployment preparation; no application implementation changed during deployment.
All earlier regression/concurrency results remain as recorded in the
[implementation report](milestone-18-unified-add.md).

From this checkout, restart Metro with current JavaScript:

```sh
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm start -- --dev-client --clear
```

Open the existing compatible iOS debug development build in the simulator and
load that server. Expo Go cannot supply the native Apple Maps search module.
Resume each test account only with the current Milestone 18 app bundle; stale
bundles still using personal direct writes will fail. The simulator acceptance
checklist remains in the implementation report. No further migration approval is
needed for versions 15/16. Cleanup, fixture seeding or unrelated hosted changes
still require separate explicit approval.
