# Milestone 18 — recovery completion fix

Local implementation only. No hosted records, receipts, migrations, accounts or
permissions were changed. This fixes the unreachable recovery exit identified in
the completion audit; it does not change ordinary save/navigation behavior.

## User flow

Unresolved results and recovery read/write errors now offer **Start a separate
Add**. The user reviews the warning, then chooses **Confirm separate Add** or
**Keep reviewing this save**. An uncertain earlier save may already have succeeded
or may finish later; a separate intentional save can add another visit. Confirmed
saves stay saved. Merely leaving results still retains active recovery as before.

Confirmation first preserves old request markers in an account-specific local
archive, then removes the old active journal and resets to the clean Add root.
The new workflow starts with a fresh restaurant selection, unchecked destinations
and independent request IDs. Nothing is automatically submitted. Previous save
recovery on Add provides destination statuses, read-only receipt checks and links
to currently available saved entries. Archived attempts expose no retry action
and retain no frozen visit payload. Group labels come from current authorized
reads, not persistent group-name copies.

## Storage and interruption safety

- The active v1 journal remains compatible. Prior recovery uses the separate
  account-specific `groupbite:add-recovery-history:v1:<account>` key.
- Archive-before-remove and new-journal writes use the existing serialized
  per-account storage queue, including after timeouts/provider replacement. A
  late old operation cannot remove a newer journal. A failed prior storage write
  does not prevent reading the last good journal when the account returns.
- Normal archived markers contain only batch/request IDs, destination kind/group
  IDs and known statuses. They contain no names, notes, tokens, Apple IDs,
  coordinates or mutation payloads. Corrupt/unreadable original journal bytes are
  quarantined privately without printing or sending them. Usable request IDs are
  salvaged where possible; completely unreadable IDs cannot be reconciled in-app.
- A crash between archive and removal can retain both copies. Recovery remains
  conservative and never reconstructs or replays an old mutation. Database
  receipts are never removed or rewritten.
- If preservation fails, the active journal stays untouched. A second explicit
  **Start with temporary recovery** warning can open a fresh workflow, retaining
  known evidence only in this account's current in-memory coordinator. Restart or
  sign-out may lose that access and may bring back the old active recovery screen.
  A permanent storage failure cannot support safe new saves: old evidence must be
  preserved and the new journal recorded before any new mutation is dispatched.
  Storage recovery triggers no automatic save; the user must explicitly save.
- Archived receipt checks never downgrade confirmed successes. They persist
  newly confirmed statuses when storage works. Failure to store a check's latest
  status is reported, with original durable evidence retained. Reads cannot prove
  rollback merely because a receipt is absent.
- Account changes dispose the old screen/controller; request headers remain
  pinned to the initiating account. Double taps, old confirmation snapshots and
  old form callbacks cannot reset a newer workflow. Active operations retain the
  existing navigation guards; leaving an unconfirmed prompt changes no evidence.

## Simulator review

Do not create test failures by corrupting storage, clearing app data, changing
memberships or interrupting hosted writes during this local review. Fault cases
are covered by offline native/HTTP/storage fixtures.

1. Reload the compatible development app; no native rebuild is required.
2. If Add currently has unresolved/error results, tap **Start a separate Add**.
   Read the warning and choose **Keep reviewing this save** first. Confirm the
   same results remain and nothing is submitted.
3. Reopen the warning and choose **Confirm separate Add**. Expect the clean Add
   landing and **Previous save recovery**. If there is no existing recovery,
   there is no need to create hosted test data solely to expose this control.
4. Expand **Previous save recovery** and use **Check previous save N**. This only
   reads hosted receipts. Confirm existing successes remain saved, absent receipts
   remain uncertain, and currently available entry links open the correct detail.
5. Reload and return to Add. Durable previous markers remain accessible; no old
   submission is automatically resent. Switching accounts must hide the other
   account's recovery. Return to the original account to review its own markers.
6. Select a restaurant for a new workflow, confirm destinations start unchecked,
   then Back/Discard without pressing Save. Any intentional new hosted save is a
   separate simulator action, not part of this local implementation verification.

If storage genuinely fails, read the second warning before choosing temporary
recovery. The temporary banner must remain visible. Do not interpret a fresh Add
screen as proof that recovery was stored or that the earlier save failed.

## Automated verification

The focused offline suite is `node tests/unified-add-recovery.cjs`. It exercises
actual coordinator/TSX code with synthetic storage and HTTP boundaries, covering
explicit confirmation, definite/uncertain outcomes, no replay, new identities,
known successes, corrupt/unreadable journals, salvage, persistent and temporary
recovery, partial local moves, storage deadlines/late writes, original quarantine
preservation, navigation, account changes, stale callbacks and receipt privacy.
Existing client/navigation/Milestone 17 regression suites remain applicable.

Final validation: **324 client/native checks passed**, comprising the existing
303 plus 21 new recovery-completion checks. TypeScript, uncached Expo lint,
explicit changed-file/test lint and tracked/new-file whitespace checks passed.
The staging area remains empty; migrations 15–17 and dependency files are
unchanged. No hosted database rehearsal or simulator acceptance is claimed by
this local verification run.

## Current acceptance evidence

The owner confirmed Special Noodle opens unified Add with all three destinations
unchecked, and Back returns to clean Add without saving. This verifies ordinary
selection/exit behavior; it does not establish native storage-failure or lost-save
response acceptance. Those fault cases have automated coverage. See the
[current completion review](milestone-18-completion.md) for the remaining matrix.
