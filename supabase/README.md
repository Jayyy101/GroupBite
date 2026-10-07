# Milestone 8 setup

1. Keep the real `.env` local. `.env.example` lists the two required variables with blank values. Use the project's **publishable** key, never a secret or service-role key.
2. In the Supabase project dashboard, open **SQL Editor → New query**. Paste the complete contents of `migrations/20261004000100_backend_foundation.sql` and click **Run** once. This versioned migration is a transaction; it creates only profiles, groups, memberships, and their supporting policies/functions/trigger. If you already applied it, do not run it again.
3. Under **Authentication → Sign In / Providers → Email**, enable email/password sign-in and allow new registrations. Keep **Confirm email** enabled if you want verification. The form tells users to verify and then sign in; it also works when confirmation is disabled and Supabase returns an immediate session.
4. Under **Authentication → URL Configuration**, set **Site URL** to a reachable page for the confirmation email's redirect. Verification happens through the emailed link; users then return to GroupBite and sign in. This milestone does not consume link tokens or require a mobile auth callback. For local web testing, use your Expo web URL as Site URL. For device testing, use a reachable confirmation landing page.
5. For email delivery beyond Supabase's restricted built-in test recipients/rate limits, configure **Authentication → SMTP Settings** with your email provider. Use the dashboard to check the password policy; Supabase remains authoritative if it requires more than the form's six-character minimum.
6. Restart Expo after changing environment variables. Run `npm start`, then open Groups from Home.

The signup trigger reads `display_name` from signup metadata and creates a profile in the same transaction as the Auth user. Existing users are backfilled; missing names default to `GroupBite User`.

RLS allows users to read/update only their own profile, read only their own membership rows, and read groups only through current membership. Only `display_name` can be updated directly. Anonymous users have no access. Direct group/membership writes are denied; `create_group(group_name)` derives the owner from `auth.uid()` and atomically inserts the group and membership. A deferred foreign key requires every group's owner to be a member. Ownership changes and group/membership deletion are not exposed yet.

Local Places still use the original AsyncStorage `savedPlaces` key. Auth persistence uses Supabase's separate storage key on native and browser storage on web. Sign-out does not delete local Places.

Manual checks after applying the migration:

- Sign up with a display name. Confirm your email if enabled, then sign in. Verify your profile in Table Editor.
- Create a group. Verify one group and its owner membership were created. Blank names should fail.
- Restart the app; your session and groups should persist. Sign out; local Places should remain.
- Sign in with a second account. The first account's groups must be invisible, including requests made directly through the client.
- Confirm direct group/membership inserts, owner changes, and deletes are denied. Own profile display-name updates should succeed; updates to other profiles should fail.
- Use `tests/foundation.sql` in SQL Editor for transactional schema/RLS checks. It uses two existing test accounts, rolls all changes back, and requires two users to have signed up first.

Implementation references: [React Native auth](https://supabase.com/docs/guides/auth/quickstarts/react-native), [profile triggers](https://supabase.com/docs/guides/auth/managing-user-data), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Milestone 9: private invites and approval

Milestone 8 must already be applied. In **SQL Editor → New query**, paste the complete contents of `migrations/20261004000200_private_group_invites.sql` and **Run once**. Do not rerun or modify Milestone 8's migration. The new migration adds only invites, join requests, and supporting RPCs/policies/indexes. It enables `pgcrypto` in the `extensions` schema; if your project has it installed in another schema, the migration stops with an explicit message rather than moving it silently. No new environment variables or auth dashboard settings are required.

From Groups, tap an owned group, then **Generate / Reset Invite Code**. The code is returned only on generation, is selectable for copying, and is kept only in screen memory. Leaving the screen clears it. Codes use 32 cryptographically random bytes, are stored only as SHA-256 hashes, and expire after seven days. Resetting or revoking blocks new requests using the previous code; already-pending requests remain available for the Owner to decide.

A signed-in person pastes the code into **Join a private group → Request Access**. This creates a pending request and does not grant group access. The requester sees only their request status/date; group names and contents remain private until approval. Denied users may submit a new request with an active code. Current members cannot request again.

Owners see pending requester display names on Group Details through an Owner-only RPC. **Approve** creates membership and records the decision in one transaction; **Deny** records the decision without membership. Repeating the same decision is safe; changing a completed decision is rejected. All mutation RPCs lock the group before child rows. Database grants deny direct invite/request/membership writes. Existing profile visibility and group RLS are preserved.

The Groups and Group Details screens reload when focused and also have Refresh controls. After another account approves a request, refresh Groups or leave and return; the group should appear with the Member role. This milestone does not add realtime subscriptions or deep links.

After applying the migration, test with an Owner and two other accounts:

- Generate a code, submit it from a second account, and confirm a duplicate pending submission is rejected and the private group is still invisible.
- Approve as Owner, then refresh the requester account. Confirm exactly one membership and an approved request.
- Request with a third account, deny, then request again using the still-valid code.
- Reset or revoke the code and confirm the old code cannot create another request. The requester must not have Owner controls after becoming a Member.
- Run `tests/private_group_invites.sql` in SQL Editor for RLS/RPC checks with three signed-up test accounts. Its fixtures, temporary helpers, and codes roll back. Do not paste usable codes or credentials into source files or logs.

Crypto reference: [PostgreSQL pgcrypto](https://www.postgresql.org/docs/current/pgcrypto.html).

### Milestone 9 polish: current members

After the invite migration is applied, run `migrations/20261004000300_group_member_roster.sql` once in **SQL Editor → New query**. Do not modify or rerun the applied migrations. It adds only `get_group_members(target_group_id)`, a member-only RPC returning user IDs, display names, and an Owner flag. It exposes no emails and does not change profile or membership RLS.

Both Owners and Members see **Current members** on Group Details. **Refresh Group**, returning to the screen, and approving a request reload the roster. On Groups, approved requests disappear once the matching group is visible through membership; pending and denied requests remain visible.

Run `tests/group_member_roster.sql` after applying the new migration with three signed-up test accounts. It checks Owner/Member access, pending and unrelated user denial, limited return fields, and unchanged direct profile/membership privacy. All test fixtures roll back.

## Milestone 10: shared restaurants, private group visits

With migrations 1–3 already applied, open **SQL Editor → New query**, paste the complete `migrations/20261004000400_restaurants_and_visits.sql`, and **Run once**. Do not rerun or modify earlier migrations. No dashboard settings, environment variables, or app dependencies change.

The migration adds global `restaurants`, private `group_restaurants` (unique group/location), and private `visits`. It also adds a locked-down `visit_save_requests` receipt table for retries. Receipts hold only the caller's request ID, a normalized payload hash, and the resulting restaurant ID; clients cannot read or write them. Every new table has RLS enabled. Direct client writes are denied, including writes by group Owners to shared facts.

`save_restaurant_visit(...)` checks the caller's membership in **every** selected group before writing anything. It locks groups in sorted order and creates all facts, entries, visits, and the receipt in one transaction. Exact, case-sensitive **trimmed name + address** matches reuse global facts without overwriting cuisine. Different addresses are different locations; fuzzy matching is not used. A group's existing entry is reused, but each new submission creates a separate Visit. Different groups get independent Visit IDs and contents.

The form keeps a non-secret retry ID in screen memory and reuses it when retrying unchanged details. The database scopes IDs to `auth.uid()`, serializes competing retries, and rejects a reused ID with a different payload. Opening a new form creates a new submission and allows legitimate repeated visits. Retry identity does not survive closing/restarting the app.

`get_group_restaurants(...)` checks current membership and calculates `avg(rating)`, rated visit count, and total visit count for that group only. Unrated visits do not affect the average. `get_group_restaurant_visits(...)` checks membership and exposes only that entry's visits and their creator display names. Global facts are readable by authenticated users; private entries/visits require current membership. Profiles and membership policies are unchanged. All RPCs use `SECURITY DEFINER`, empty `search_path`, explicit caller checks, and schema-qualified objects.

App flow: **Groups → Add Restaurant / Visit**, or open a group to start with that group selected. Enter required name/address, optional cuisine/date (`YYYY-MM-DD`)/rating/would-go-again/notes, then select one or more groups. After saving, a single-group save returns to that group; a multi-group save returns to Groups. Tap a saved restaurant for its group-specific summary and visits. **Add Another Visit** pre-fills read-only shared facts and starts a new memory. Screens remain scrollable and refresh on focus or through Refresh controls. Local Places remain separate and unchanged.

Validation:

- Run `tests/restaurants_and_visits.sql` with three signed-up test accounts after applying the migration. It checks membership/RLS, creator identity, exact reuse, separate locations and memories, retry safety, ratings, and whole-transaction rollback (including a simulated failure after the first group's visit). Its fixtures roll back. Earlier SQL suites should still pass.
- Check with two accounts: save the same name/address into the same group independently. There should be one restaurant card and two visits. Save into two groups and verify independent counts/notes; a pending requester must see neither group's private visits.
- For a true overlapping-writer test, use an isolated local PostgreSQL database and two connections: start a transaction as one authenticated member, call the save RPC, and hold the transaction open. From a second member's transaction, call it for the same group/location with a different request ID. The second call should wait. Commit the first, then the second; assert one GroupRestaurant and two Visits. Repeat with the same user/request ID/payload and assert only one Visit per selected group. Also test the same location across different groups to exercise the global unique constraint. Do not run fixture/concurrency setup against production data.

Implementation references: [PostgreSQL ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html), [Supabase database functions](https://supabase.com/docs/guides/database/functions).

## Milestone 11: Visit management

With migrations 1–4 already applied, apply only `migrations/20261006000500_visit_management.sql` once through **SQL Editor → New query** when ready to deploy this milestone. Development validation does not apply anything to hosted Supabase. Do not edit or rerun the applied migrations. No dependencies, environment variables, or dashboard settings change. Refresh the app after applying migration 5.

Current Members can edit/delete their own Visits; current Owners can edit/delete any Visit in their group. `update_group_visit(...)` and `delete_group_visit(...)` require matching group, GroupRestaurant, and Visit IDs. They derive the caller from `auth.uid()`, lock the group before its entry and Visit, and check current membership and creator/Owner permissions after waiting for the group lock. Both use `SECURITY DEFINER`, an empty `search_path`, schema-qualified tables, explicit checks, and authenticated-only execution. Direct table writes remain denied and existing nonrecursive RLS is unchanged.

Edits change only `visited_on`, `rating`, `would_go_again`, `notes`, and `updated_at`. Creator, `created_at`, group/location links, and all global Restaurant facts stay unchanged. Optional fields can be cleared. Deletion removes only the scoped Visit and removes its GroupRestaurant in the same transaction if no Visits remain. The boolean return tells the app whether that group entry was removed. Global Restaurants and retry receipts are retained, even when no group entries remain.

The group lock matches the existing save RPC: an addition that commits first is seen by cleanup; a deletion that commits first allows a new submission to recreate the entry. A retry of a completed save still returns its original Restaurant and does not recreate deleted Visits. Multi-group saves retain their sorted group locking and existing idempotency behavior. Concurrent stale edits/deletes receive the same access-denied/not-found error after rechecking the scoped rows.

Restaurant Details shows **Edit Visit** and **Delete Visit** only when the member-only read RPC returns `can_manage`. This flag controls presentation; each mutation independently checks authority. Edit opens an inline form using the existing styling. Delete opens a confirmation explaining final-Visit cleanup; **Cancel** makes no changes. Mutation buttons and navigation controls are disabled while saving/deleting. Successful changes reload the restaurant summary and Visits; deleting the final Visit returns to Group Details, which refreshes on focus. Failed requests retain the form/confirmation with an error and allow retry or cancellation followed by **Refresh Restaurant**. A new focus reload also checks access again.

Validation:

- `tests/visit_management.sql` checks Member/Owner permissions and flags, unrelated Owners, pending/former members, an Owner without current membership, mismatched scope IDs, anonymous calls, denied direct writes, optional-field validation/clearing, immutable facts/attribution, group ratings, nonfinal/final cleanup, global retention, save retries after deletion, and failures during update and final-entry cleanup. It requires three test accounts and rolls all fixtures back. Earlier SQL suites also remain applicable.
- `tests/visit_management_concurrency.mjs` exports SQL integration tests for a disposable local PostgreSQL harness. It requires synthetic users, migrations 1–5, three independent `pg` clients (`admin`, `a`, `b`), and an explicit local-validation marker; it commits fixtures and must never run against hosted data. The existing hardened local validator was reused through a separate temporary Milestone 11 runner with eleven explicit SHA-256-pinned input snapshots. It clears inherited configuration, starts the installed native PostgreSQL binaries on loopback with synthetic authentication, runs all five SQL suites and the existing three save races, then invokes these nine management races. Every race verifies an actual lock wait through `pg_stat_activity`. The runner stops PostgreSQL and removes its unique runtime database before reporting success. It does not read `.env`, connect to Supabase, install dependencies, or use package exit hooks.

Manual app checks after applying migration 5:

- As a Member, verify controls on your own Visits and no controls on another creator's. As Owner, verify controls on both. A nonmember must have no access.
- Edit all four fields, clear optional answers, cancel an edit, and submit an invalid date. Verify creator/shared facts stay unchanged and summaries refresh after a successful edit.
- Cancel deletion, then confirm a nonfinal deletion. Confirm final-Visit deletion returns to the group and removes only that group's restaurant card. Check another group at the same location remains intact.
- Simulate a lost connection during edit/delete. Check the error, cancel, and refresh to determine whether the server completed the request before retrying. Verify a fresh Visit can be added after final cleanup.
- Smoke-test existing group invites, multi-group saves/retries, authentication, and local Places. Local AsyncStorage Places and the deferred safe-area behavior are unchanged.

## Milestone 12: group membership lifecycle

After migrations 1–5, apply only `migrations/20261006000600_group_membership_lifecycle.sql` once when deploying the backend, if it has not already been applied. Do not rerun or edit applied migrations. Development checks run only against disposable local PostgreSQL; no hosted migration is applied by the validator. There are no dependency, environment, or dashboard changes in this milestone. Group deletion and any recovery period remain deferred.

Every `group_memberships` row now has a unique, required `membership_id` generated on admission. Migration 6 backfills existing rows without changing their group/user keys or join dates. Existing group creation and approval RPCs generate IDs through the column default. The existing Owner-membership foreign key and all RLS policies remain intact. Leaving/removal deletes only the membership row; profiles, historical Visits, creator attribution, GroupRestaurants, join requests, invites, and save receipts remain unchanged.

Backend API:

- `leave_group(target_group_id, expected_membership_id)`: current non-Owner Members leave their own membership. Owners, including sole Owners, must transfer ownership first. Read your current ID through the existing self-only `group_memberships` SELECT policy.
- `get_group_membership_targets(target_group_id)`: current Owner-only read of other current members' `user_id`, `membership_id`, and `display_name`. This supplies the IDs needed for removal/transfer. `get_group_members` keeps its existing return shape and behavior.
- `remove_group_member(target_group_id, target_user_id, expected_membership_id)`: current Owner removes another current member whose admission ID still matches. Owner/self removal is rejected.
- `transfer_group_ownership(target_group_id, target_user_id, expected_membership_id)`: current Owner transfers to another current member whose admission ID still matches. Both memberships, IDs, and join dates remain unchanged; the previous Owner stays a Member. Active invite records are revoked atomically, not deleted. Pending requests retain their original metadata and can be decided by the new Owner even though their original invite code is now revoked.

Incarnation IDs are concurrency checks, not credentials. Every mutation derives the caller from `auth.uid()`, locks the group first (matching invites, approvals, saves, and Visit management), then rechecks current authority and the relevant membership. Comparisons use null-safe predicates. New RPCs use `SECURITY DEFINER`, empty `search_path`, schema-qualified tables, and authenticated-only execution; direct writes remain denied. Transfer cannot create membership, leave cannot orphan a group, and failed transactions roll all changes back.

Members who leave or are removed can submit a fresh request with a valid invite and rejoin after approval. The new row receives a new ID, so delayed leave/removal/transfer requests referencing the previous admission are rejected. Old approved-request retries do not recreate membership. Rejoining with the same account restores creator permissions on its historical Visits, without granting ownership. Save receipts retain their existing behavior; a former member cannot use a receipt to bypass current membership checks.

Errors distinguish access denial (`42501`) from an ineligible action or changed admission (`22023`). Mutations do not promise a success response on a duplicate retry: an already absent membership or changed Owner is rejected. After an ambiguous network result, reload membership/ownership and resolve the operation before submitting a new action with fresh IDs. Reusing the original expected ID cannot remove a later rejoin.

Fresh database requests after a departure commits lose access to that group's private content, including the user's own Visits. Other groups and global Restaurant reads remain unaffected. Requesters retain their existing self-only join-request visibility. Previously delivered screen data cannot be recalled by PostgreSQL.

### Mobile controls

Group Details provides **Leave Group** for Members and **Remove Member** / **Transfer Ownership** on other current members for Owners. Each opens a cancellable confirmation; buttons are disabled during submission. Owners see a disabled Leave control and instructions to transfer first. The previous Owner remains a Member and can leave normally after the refreshed transfer result. There is no group deletion control.

Own admission IDs come from the existing self-only membership SELECT API; removal/transfer targets come from the Owner-only target RPC. A confirmation retains the exact ID selected. Any mutation error closes the confirmation and reloads access/roster, including ambiguous network results and stale admission IDs. A refreshed ID is never substituted into an automatic retry. Successful transfer clears the usable invite code and reloads roles, roster, invites, and pending requests; returning to Groups reloads the list.

Group and Restaurant Details recheck access/ownership on focus, foreground, and every 15 seconds while active. Private screen data and forms clear on blur/background, lost membership, or failed access verification. Role changes reload Visit permissions and Owner controls. An access-denied Visit mutation also clears its cached content and rechecks access. Groups and Add Visit refresh membership-visible groups on focus/foreground and every 15 seconds, clearing old choices/list data on load failures. Save retry IDs and entered Visit fields retain their existing screen-memory behavior. Remote changes are reflected on the next check (up to 15 seconds while online); server-side access revocation is immediate, without realtime subscriptions. Previously approved requests without current membership are labelled as historical approvals and explain how to rejoin.

Manual mobile checks with an Owner and two Members:

- Cancel each confirmation and verify no changes. Leave as a Member; confirm navigation to Groups, removal from the list, and loss of group/Visit access while historical Visits remain visible to the remaining members.
- Remove a Member as Owner. Leave the removed account on Group Details, Restaurant Details, and Add Visit in separate runs; verify cached private content/group choices clear on the next check or foreground refresh. Other groups remain visible.
- Transfer to an existing Member. Verify the previous Owner becomes a Member, loses invite/approval/removal/transfer controls, retains their own Visit controls, and can leave. The new Owner gets Owner/Visit controls, sees the roster and retained pending requests, and must generate a new invite code.
- Leave/remove and approve a fresh rejoin with the same account. Verify historical creator attribution and own-Visit permissions return. To exercise stale target IDs, open a removal/transfer confirmation before that account leaves and rejoins; confirming must fail, reload, and require a new confirmation without removing the new membership.
- Test slow/offline requests, double taps, cancellation, manual refresh, background/foreground, and navigating away during a request. Resolve an ambiguous result using refreshed state before confirming again. Smoke-test existing invites, multi-group Visit saves/retries, Visit editing/deletion, auth, and local Places.

Validation and manual backend checks:

- Run all six SQL suites in an isolated test database. `tests/group_membership_lifecycle.sql` uses three accounts and rolls back its fixtures. It covers Owner/Member/nonmember/anonymous authorization, RLS/grants, incarnation defaults/uniqueness, Owner invariants, leave/remove/rejoin history and permissions, stale IDs, transfer invite revocation and pending preservation, old approval replay, and injected rollback failures.
- `tests/group_membership_lifecycle_concurrency.mjs` exports integration tests for three independent `pg` clients, synthetic users, and an explicit disposable-local marker. It commits fixtures and must never run against hosted data. It tests real lock waits among departures, transfers, approvals, invite requests, Visit writes, rejoining, and multi-group saves. The temporary hardened native validator runs these alongside all prior SQL and concurrency tests, verifies migration backfill on populated pre-migration data, and cleans up its runtime database.
- Once migration 6 is deployed manually, use authenticated test clients to leave/remove a Member, verify all private reads and Visit writes fail, then approve a fresh request and verify attribution and creator permissions return. Reuse the old membership ID and confirm it fails without affecting the rejoin.
- Transfer ownership and verify the previous Owner remains a Member, loses Owner-only RPC access, and can leave. Confirm old invite codes fail and the new Owner can approve pending requests. Confirm a sole Owner cannot leave and direct group deletion remains denied.
