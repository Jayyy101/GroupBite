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
