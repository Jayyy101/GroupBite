# Milestone 8 setup

Milestone 15 now includes a **local-only** authenticated Geoapify suggestion
function. Its [contract, server secrets, validation and later deployment steps](functions/geoapify-suggest/README.md)
are documented separately. The mobile UI still uses mock suggestions; saves,
date fields, coordinate attachment and migrations 1–9 are unchanged. Additive
Migration 10 introduces only service-role committed-admission confirmation.

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

## Milestone 14: personal saved Places

After migrations 1–6, apply only `migrations/20261007000700_personal_saved_places.sql` once when explicitly authorized to deploy the backend. Do not modify or rerun earlier migrations. The app expects migration 7 before its release. Development validation uses a disposable local PostgreSQL database and synthetic users; it does not read `.env` or access hosted Supabase. No dependency, environment-variable, or dashboard-setting changes are needed.

`personal_places` stores private copies of restaurant facts and one editable memory per save. Name/address are required; cuisine/date/rating/would-go-again/notes are optional. A personal save never inserts into the shared `restaurants` catalog, `group_restaurants`, `visits`, or group retry receipts. Intentional repeat saves at the same location have independent IDs and contents. There is no automatic deduplication by restaurant name/address and no personal Visit history model in this milestone.

Owner-only SELECT/INSERT/UPDATE/DELETE policies use `auth.uid()` without membership joins. Explicit column grants prevent clients from supplying/changing ownership, IDs, creation/update timestamps, revision, or retry identity. Ownership defaults to the signed-in user; the trigger trims strings, normalizes blank optional text to null, and advances `revision`/`updated_at` on updates. Each client read filters by account. Each write uses the initiating account's Authorization token, so an account switch cannot submit the old draft under the new account. Edits/deletes filter by the loaded revision; zero affected rows require refreshed state and a new user action. Group Owners have no special personal permissions. Leaving/removal/transfer/rejoining never changes personal records. If a profile is deleted successfully, its personal Places cascade; this milestone adds no account-deletion UI or changes to existing group deletion constraints.

Home now offers **My Places** alongside existing navigation. **My Places → Add Personal Place** works for a signed-in user with zero groups. Details provides **Edit Personal Place** and a cancellable **Delete Personal Place** confirmation. Personal fields follow existing restaurant/Visit limits, date validation, nullable choices, accessibility conventions, and shared styles; the group Visit form and its save RPC remain unchanged. Signed-out personal screens offer the existing Sign In / Sign Up screen; its existing post-login destination remains Groups, from which users can return Home and open My Places.

Account data, drafts and confirmations unmount on sign-out/account switch/blur/background. Returning to a personal screen loads fresh account-scoped data. Previously issued requests may finish for their original account, but late results cannot populate or navigate an inactive screen. New private memories are not persisted in AsyncStorage. There is no offline queue, realtime subscription, or periodic group-style membership polling.

Creation retains an account-scoped `client_request_id` in screen memory; the unique `(owner_user_id, client_request_id)` prevents concurrent duplicate requests while their row exists. A duplicate or uncertain response is reconciled through an owner-only read, never an upsert. A saved result may already have been edited; opening it must not overwrite newer content. An uncertain missing result disables mutation and offers **Check Saved Result** (read-only) / **Review My Places**. A missing read does not prove the original request failed; it may still finish. There are deliberately no durable receipts/tombstones after deletion, and no automatic retry recreates a missing result. Leaving/restarting the form discards its retry identity; a deliberate new form submission is a new memory and can duplicate a late original save. Uncertain edits require cancellation and refreshed details; uncertain deletes close confirmation and reload details before another confirmation. Mutation double taps are guarded synchronously.

Legacy `savedPlaces`, `types/place.ts`, `utils/storage.ts`, `/saved-places`, `/place/[id]`, and the ID-based `/add-place` editor are retained. Existing device-local records are neither uploaded nor assigned to an account, moved, cleared, or deleted automatically. Their edit/delete flows remain local and available while signed out. `/add-place` without an ID still redirects to the existing group form. Device-local Places remain visible to anyone using that installation, as before; My Places is the private account-based model. Only explanatory Home/list copy changes to describe both destinations accurately.

Validation:

- `npm run test:personal` runs offline tests of actual TypeScript screen/helper modules and the installed Supabase HTTP builder with an injected fetch mock. It exercises no real network or application environment. The small hook renderer verifies routing, private screen lifecycle, late responses, uncertain write reconciliation, revision conflicts, nullable validation, immutable payloads, double taps, and legacy preservation; it is not a native rendering/simulator test.
- `npm run test:navigation` drives actual screen handlers through the installed React Navigation stack reducer. It checks personal create/edit/reconciliation, group single/multi-group saves, failures/cancellation, direct-entry fallbacks, detail Back, and legacy edits. Successful saves remove completed forms; **Create / Join a Group** also dismisses the abandoned Visit form so it cannot remain beneath Groups. These are offline stack checks, not native gesture or browser-history tests.
- Run all seven transactional SQL suites in isolated local PostgreSQL. `tests/personal_saved_places.sql` requires three synthetic accounts (the third with no groups) and rolls fixtures back. It verifies owner-only CRUD, anonymous/missing-identity denial, ownership/immutable-column protection, known-ID attacks, Group Owner denial, independent accounts/saves, server validation, optional clearing, revision conflicts, membership lifecycle independence, account cascade, and unchanged shared tables/receipts.
- `tests/personal_saved_places_concurrency.mjs` exports `runPersonalPlacesConcurrency` for three independent `pg` clients and an explicit `personal-places` disposable-local marker. It commits synthetic fixtures and must never run against hosted data. Eight cases exercise overlapping retry insertion, stale edits/deletes in both orders, repeated deletion, rollback, and account-scoped request IDs. Seven cases verify a real PostgreSQL lock wait; independent accounts do not need to block each other.
- The temporary hardened native validator snapshots and SHA-256-pins seventeen explicit migration/test inputs, uses clean environments and installed PostgreSQL binaries on loopback, applies migration 7 over historical data, runs all seven SQL suites and the 45 existing/new save/Visit/membership/personal concurrency cases, and removes its runtime database after shutdown. Migration 6 populated-data backfill remains tested. TypeScript, lint, and the existing Milestone 12/13 offline UI regressions are additional checks.

Manual device/web checks after separately authorized backend deployment:

- Sign in with no group memberships; save a personal Place, restart, and verify the same account on a second device sees it. Sign out and use another account; verify the first account's Places and notes are unavailable, including direct personal-detail links. Confirm group Owners cannot view members' personal Places.
- Create intentional duplicates, edit restaurant facts and all optional fields, clear answers, preserve **No** versus unanswered, cancel deletion, then delete only one personal memory. Verify My Places reloads after returning from edits/deletes and foregrounding after another device changes a record.
- Exercise slow/offline saves, double taps, missing saved results, and a response arriving after switching accounts/backgrounding. Confirm **Check Saved Result** only reads; a stale edit/delete requires refreshed state and another user action. Do not assume a missing result means the original save failed.
- Verify drafts/confirmations disappear on blur/background, deep-link Back fallbacks work, and long forms scroll with the keyboard on iOS/Android/web. Sign-in currently retains the existing Groups destination; return Home for My Places.
- Smoke-test existing single/multi-group saves/retries, Visit editing/deletion, membership controls, auth, and legacy device-local list/edit/delete. Verify legacy storage bytes survive personal saving and auth changes.

## Milestone 15 Phase 2: Saved Map / Nearby groundwork

Migration 8 (`migrations/20261009000800_saved_locations.sql`) has been deployed and hosted verification passed, as reported by the project owner. It follows migrations 1–7, without modifying or rerunning those migrations. No app screens, existing RPC signatures, table columns, RLS policies, or grants change. No external API, geocoding job, location permission, secret, or paid service is introduced.

The migration enables PostGIS in `extensions`. If PostGIS already exists in another schema, it aborts transactionally instead of moving it. Before deployment, an operator must check that schema and extension availability; do not silently relocate an existing extension used by other applications.

### Geographic storage and privacy

`group_restaurant_locations` stores one nullable resolution record per saved group entry, keyed by `group_restaurants.id` with `ON DELETE CASCADE`; `personal_place_locations` stores one per private Personal Place. Both have paired nullable latitude/longitude, a generated WGS84 geography point, a GiST spatial index, an address snapshot, standardized address, provider/result ID, accuracy, status, and resolution timestamp. Resolved records require complete metadata and building/address-level accuracy. Failed/ambiguous/unresolved records cannot carry coordinates. Finite coordinate bounds are enforced; a real `(0,0)` is valid and is never used as a missing-value sentinel.

The globally readable `restaurants` catalog is deliberately unchanged: adding geographic columns there would expose unrelated locations via existing authenticated `SELECT *` reads. Group location RLS requires current membership in the group of that exact GroupRestaurant entry. Reusing the same globally readable Restaurant ID in another group never grants access to the first group's coordinates, standardized address, status, or provider metadata. Resolution is independent per entry; there is no cross-group copy or fallback. Personal location RLS requires ownership of the referenced Personal Place. Direct geographic writes are denied to clients, including Group Owners, and to `service_role`; the trusted writer uses only the scoped attachment functions below.

Existing records are not backfilled, deleted, or standardized. A missing location row represents unresolved/null coordinates. Address edits invalidate location metadata in the same transaction; a privileged shared Restaurant address correction clears all referencing entries' location rows. Personal Places retain their original trimming, timestamp and revision trigger. Standardized addresses are metadata and do not replace the exact name/address Restaurant reuse key.

### Saved-location read contract

`get_saved_locations(scope, target_group_id, center_latitude, center_longitude, radius_meters, page_size, page_offset)` is authenticated-only and derives identity from `auth.uid()`. Its `SECURITY DEFINER` query explicitly scopes both branches to the caller; it does not enumerate the global Restaurant catalog.

- `scope`: `all` (default), `personal`, or `group`. Only `group` accepts/requires `target_group_id`, which must have current membership. Owners get no membership bypass.
- The center is optional but must supply both coordinates. A radius requires a center and is an inclusive, straight-line/geodesic distance in meters, bounded to 0–100,000. GPS and manually chosen centers use the same contract. The center is not persisted.
- Without a radius, unresolved records remain listed with null coordinates/distance. With a radius, they are excluded. Known coordinates with a center but no radius receive a distance without restricting results.
- Pages default to 200 rows, cap at 1,000, and allow offsets from 0–100,000. Ordering is distance (when a center exists), then kind/record ID. Offset pagination is deterministic for an unchanged dataset, not a cross-request snapshot under concurrent edits.
- A personal row has `saved_kind='personal'`, its Personal Place ID, `personal_rating`, and null group fields/aggregates. A group row has `saved_kind='group'`, its GroupRestaurant ID, Restaurant ID, group ID/name, and that entry's `group_average_rating`, rated count, and total Visit count. There are no notes, user identities, unrelated group summaries, or combined personal/group ratings.
- The same Restaurant in two accessible groups returns two rows with distinct navigation targets, scoped ratings, and independent coordinates/status. A future UI may combine matching resolved points with a group chooser, but must not deduplicate solely by Restaurant ID or substitute one group's location for another unresolved entry. Personal records are never merged into global Restaurants.

### Future trusted coordinate attachment

`attach_verified_restaurant_location(acting_user_id, target_group_id, target_restaurant_id, target_group_restaurant_id, expected_address, verified_latitude, verified_longitude, provider_name, provider_result_id, formatted_address, accuracy)` is callable only by `service_role`. It locks the group, rechecks current membership, then locks the Restaurant and exact saved entry in the existing compatible order. The entry must match the supplied group and Restaurant IDs, and the address snapshot must match exactly. It fills that entry's absent/unresolved location and returns `true`; an already-resolved entry returns `false` without being overwritten. Other groups resolve independently, even when the Restaurant ID matches. It works when a new unchanged `save_restaurant_visit` call reuses an existing Restaurant ID. It does not modify facts, Visits, receipts, or addresses. Final-Visit deletion cascades that entry's location metadata while retaining the global Restaurant and save receipts. A new save creates a new entry ID, initially unresolved. Delayed attachment calls with the old entry ID fail; the trusted backend must target the new entry using a freshly verified result. For a save selecting multiple groups, the backend may attach that verified result independently to each selected, authorized entry, never by copying another group's stored resolution.

`attach_verified_personal_place_location(acting_user_id, target_personal_place_id, expected_revision, expected_address, verified_latitude, verified_longitude, provider_name, provider_result_id, formatted_address, accuracy)` is also backend-only. It locks the owner's Place, checks revision/address, and fills unresolved metadata. A successful attachment increments the existing revision, so stale edits/deletes cannot race past enrichment. Retries must refresh the revision; resolved locations are not overwritten. Deleting the Personal Place cascades its metadata.

**SQL does not verify an external provider response.** The future autocomplete backend must authenticate the user, derive `acting_user_id` from the verified session, verify the selected provider result and address/coordinate association, then call the attachment function. Never grant these functions to `authenticated`, trust client-supplied coordinates/provider labels, or send a service-role secret to the app. Provider integration, save-first attachment orchestration, failed-resolution recording RPCs, and corrections to already-resolved entry locations remain later work. Existing saves remain usable if enrichment fails; do not automatically replay a save to retry enrichment.

### Disposable local validation

`tests/validate_saved_locations.mjs` requires explicitly supplied PostgreSQL/PostGIS binaries and an installed `pg` module. It clears inherited configuration, snapshots/hashes explicit SQL/test inputs, initializes a unique database directory under `/private/tmp`, binds only to loopback on a random high port, and uses synthetic authentication/accounts. It never reads app configuration or `.env`, connects to a supplied database URL, or touches an existing database. It verifies the PostGIS schema guard, applies migration 8 over populated historical data, and compares all historical rows and old function definitions/ACLs, policies and table/column grants before and after. Both new location tables must remain empty after migration.

Example using the approved temporary tooling (paths are local validation tooling, not app dependencies):

```sh
node supabase/tests/validate_saved_locations.mjs \
  --postgres-bin /private/tmp/groupbite-m15-tooling/Postgres.app/Contents/Versions/17/bin \
  --pg-module /private/tmp/groupbite-m10-validation/node_modules/pg/lib/index.js
```

The runner executes all eight transactional SQL suites, the three original save/retry/global-reuse races, and the existing Visit/membership/personal concurrency suites. `tests/saved_locations.sql` covers the cross-group Restaurant reuse attack through direct RLS and all/group/radius queries, independently resolved coordinates/provenance and ratings, membership departure/removal, ownership transfer/re-admission, trusted entry/group/Restaurant checks, unknown/failed coordinates, radius boundaries, input validation, final/nonfinal Visit deletion, receipt retries, deletion/recreation, stale attachments, and all-entry address invalidation. `tests/saved_locations_concurrency.mjs` adds seventeen actual lock-wait cases for independent group and competing same-entry resolutions, attachment versus departure/removal, final-Visit deletion/recreation, shared address invalidation in both orders, personal edit/delete/revision races, and rollback. Cleanup stops only the server created by the runner and removes only its unique runtime directory, including on failure. Downloaded binaries remain in the tooling directory for reruns; no system service or shell initialization is installed.

## Milestone 15 Phase 3: local autocomplete backend groundwork

Migration 9 (`migrations/20261009000900_address_autocomplete_groundwork.sql`) is local and **not deployed**. Apply it once after migrations 1–8 only after separately authorized deployment. It adds two private tables and three RPCs; all existing save signatures, receipts, Restaurant reuse, location attachment functions, policies, grants and app screens remain unchanged. PostgreSQL adds internal foreign-key triggers to the original receipt table for the new bindings. No old receipts or addresses are backfilled, and no provider call, API key, dependency, Edge Function or UI is introduced.

### Exact group-entry bindings

`save_restaurant_visit_with_location_bindings` accepts the same nine parameter names/defaults as `save_restaurant_visit` and returns one row `{ restaurant_id, bindings_recorded }`. It is authenticated-only and derives the actor from `auth.uid()`. It locks the distinct selected groups in sorted order, checks current membership in every group, then checks whether the caller's original receipt exists in a separate statement. It calls the unchanged save RPC, preserving its input normalization, payload fingerprint, permissions, all-or-nothing multi-group save and idempotency behavior.

For a genuinely new receipt, the same transaction inserts one `visit_save_location_bindings` row per selected group with the exact `group_restaurants.id`. A binding failure rolls the whole save back. For an existing receipt, the wrapper never inserts or infers bindings, including when a legacy save committed while it waited for a group lock. The original API remains available to current screens; their receipts intentionally remain unbound. A concurrent mismatched request fails through the existing payload check, including when the selected groups do not overlap.

Bindings are keyed by `(user_id, request_id, group_id)` and contain only the historical entry UUID. They reference the original `(user_id, request_id)` receipt with cascade on privileged receipt deletion. There is deliberately no FK to groups or entries: deleting a final Visit or group must preserve the historical identity without blocking deletion. No client or service-role direct table access is granted, no client RLS policies exist, and a trigger rejects updates even by a privileged writer. The wrapper only inserts; there is no upsert, rebinding, or public cleanup endpoint. Existing privileged receipt purging can cascade bindings; ordinary saves retain receipts as before.

`bindings_recorded` means immutable historical bindings exist; it does **not** mean every entry still exists, every membership remains active, or coordinates are attached. A legacy receipt returns `false`; do not retry it under a new ID to obtain targets, since that would create another Visit.

`get_visit_save_location_targets(client_request_id)` is authenticated-only. It returns `{ group_id, restaurant_id, group_restaurant_id, address }` only for the caller's bindings that still match the original receipt's Restaurant, exact current entry, and current membership. The address is the current Restaurant address, not a verification token or stored provider result. It accepts no actor/group/entry override. It returns no row for a legacy receipt, foreign request, deleted group/entry, or revoked membership. One deleted/revoked group leaves the other targets available. Deletion/recreation never retargets an old receipt to the replacement entry. Rejoining can restore access only to an original entry that still exists.

Both tables have RLS enabled and no table grants to `anon`, `authenticated` or `service_role`. The three security-definer RPCs have empty search paths and explicit execute grants. The binding reader is a scoped snapshot, not a lock or authorization lease: migration 8's attachment RPC must recheck membership, exact identity and expected address at write time.

### Durable provider admission

`reserve_geoapify_request(acting_user_id)` is service-role-only and returns one row:

- Admission: `{ admitted: true, admission_id, permit_expires_at, reason: 'admitted', retry_after_seconds: 0 }`.
- Denial: `{ admitted: false, admission_id: null, permit_expires_at: null, reason, retry_after_seconds }`. Reasons are `global_daily_limit`, `user_daily_limit`, or `global_rate_limit`.

The future Edge Function must verify the user's token and derive `acting_user_id` from that identity. The RPC checks that a profile exists, but does not itself authenticate a service-supplied actor. Clients cannot select limits, timestamps, refund events, or invoke the limiter. An unknown/deleted actor is denied. Reservations have no profile FK so account deletion cannot refund global usage.

Every admission is a private timestamped ledger event. A dedicated transaction advisory lock `(714015, 9)` serializes admission, with wall clock captured **after** the lock and fresh count statements. Fixed limits are 1,000 global and 100 per user over a rolling 24 hours, conservatively extended by the one-second dispatch grace. Events count while `permit_expires_at > checked_at - interval '24 hours'`; the exact cutoff is expired. This uses elapsed hours, not a calendar-day reset. Cleanup removes only expired events during admission calls. A bounded ledger is sufficient at this scale; no scheduled task, queue or external rate-limit service is needed.

The rate gate permits at most three admissions over a rolling two seconds. Each permit expires one second after admission. Accounting for that grace prevents delayed starts from turning three admissions per second into a six-request burst. With timely dispatch, at most three HTTP starts fit in any rolling second. Database admission cannot guarantee arrival spacing at the provider across network delays; future integration must also stop/back off on provider throttling. Limits apply project-wide to every provider request routed through this ledger, including autocomplete, selected-result verification and explicit retries.

Both the wrapper and limiter require **READ COMMITTED** and reject REPEATABLE READ/SERIALIZABLE with SQLSTATE `25001`; their post-lock checks depend on fresh statement snapshots. The limiter holds a transaction-scoped lock only through database commit. Do not combine it with save/attachment transactions or hold it during HTTP.

### Required future Edge Function contract

1. Authenticate the user; use their JWT for the save wrapper and binding reader. Preserve the save request ID and original payload for retries. Keep service-role credentials and the provider key exclusively on the backend.
2. Obtain a committed admission response before **each** outbound HTTP attempt, including result verification and any retry. Do not send if admission is denied, uncertain, expired, or has insufficient time left for a conservatively checked dispatch. Account for response delay and clock uncertainty. Disable unmetered automatic HTTP retries. Each permitted attempt can consume provider credits even if it fails.
3. Never refund reservations, including abandoned, failed, or timed-out calls. A transaction rollback creates no durable admission: therefore HTTP must never start before a successful committed RPC response. The database does not consume a permit a second time or dispatch HTTP; the trusted Edge implementation must use each returned permit at most once and abandon an uncertain result.
4. Save first, then verify the selected provider result server-side at building/address precision. Use the caller's scoped binding reader to determine attachment targets. Do not trust client coordinates or caller-supplied group/entry/Restaurant IDs. Compare the verified selection/address with the saved/current address before passing `expected_address`; edited addresses require a fresh selection/verification.
5. Attach independently to each returned exact entry through migration 8's service-only RPC. Keep saves if verification/attachment fails. Retry enrichment by rereading the original bindings and obtaining new provider admission if another HTTP request is needed; never replay a new save merely to retry coordinates. A deleted/recreated entry is unavailable to the old request. An already-resolved entry is not overwritten. Personal Places continue using the existing owner/revision/address attachment contract without group bindings.

The save plus bindings are atomic; external provider requests and per-entry attachments are separate transactions. Partial attachment success is expected and must be surfaced/reconciled without undoing memories. A successful SQL admission alone does not enforce provider account billing settings, requests made outside this integration, or credits per endpoint. Configure the future free account without paid enrollment/automatic upgrades, keep the key private, and ensure every attempted request is metered. No external billing configuration is performed by this migration.

### Local validation

```sh
node supabase/tests/validate_address_autocomplete_groundwork.mjs \
  --postgres-bin /private/tmp/groupbite-m15-tooling/Postgres.app/Contents/Versions/17/bin \
  --pg-module /private/tmp/groupbite-m10-validation/node_modules/pg/lib/index.js
```

This separate validator preserves the phase-2 runner unchanged. It uses the same isolated loopback/SCRAM tooling, synthetic accounts and runtime cleanup, with no `.env`, hosted connection, installed dependency or existing database. It applies migration 9 over populated migration 8 location metadata and snapshots old rows, columns, function definitions/ACLs, RLS/policies/grants, constraints, triggers and indexes. Only the two additive receipt FK triggers are permitted; new tables must start empty. It SHA-256-pins every migration/test input.

All nine SQL suites and 85 overlapping-writer cases run: the 62 existing save/Visit/membership/personal/location cases plus 23 new binding/admission cases with verified database lock waits. New tests cover legacy receipts (including pre-migration data), actor-scoped request collisions, forged access, immutable targets, multi-group retries and partial failures, final-Visit deletion/recreation, owner/membership checks, both orderings of legacy/wrapped saves and membership/deletion races, disjoint-group receipt contention, rollback, exact rolling predicates and live cutoff/grace behavior, global/user last slots, burst admission, wall clock after lock waits, deleted-account usage retention, and rejection of stale-snapshot isolation. Existing offline personal/navigation, TypeScript and lint checks remain separate.

Local tooling currently provides PostgreSQL 17.11 / PostGIS 3.5.6; the hosted PostGIS version reported by the owner is 3.3.7. Migration 9 introduces no PostGIS-specific SQL. Supabase JWT/PostgREST behavior, Edge authentication/permit dispatch, provider verification and live provider limits still require their later integration tests. Migration 9 has not been deployed or checked against hosted Supabase.

## Milestone 15: controlled local function runtime verification

The owner reported a hosted reservation probe with HTTP 200, no
`Preference-Applied` header, and an independently verified committed row. The
function now confirms every affirmative reservation in a second read-only
PostgREST transaction using `confirm_geoapify_request`. Additive Migration 10
(`migrations/20261010001000_geoapify_admission_confirmation.sql`) adds only this
service-role RPC; its boolean result requires an exact ID/user/expiry match and
an unexpired committed row. Existing table grants and migrations 1–9 are unchanged.
No hosted migration or function deployment was performed by this work.

Both RPCs and their complete bodies share the original 800 ms deadline. Missing
or uncertain confirmation fails closed, including when the reservation response
acknowledges a commit. There are no automatic retries, refunds, cached permits or
changes to quota limits. Default PostgREST `commit` is supported without enabling
transaction overrides. Each explicit new client invocation needs fresh admission.

The [runtime runner](tests/validate_geoapify_runtime.mjs) uses a disposable
Unix-socket PostgreSQL database, loopback PostgREST 13.0.7, mocked Auth and mocked
Geoapify. Twenty native Deno tests cover both commit configurations, rollback,
missing/stalled confirmation, the shared deadline, concurrent admission and
retained usage after failure/retry. All nine existing SQL suites and 23 Migration 9
lock-wait cases pass. New database tests prove uncommitted invisibility, committed
visibility, identity/expiry matching, expired/rolled-back denial, service-only
execution and unchanged table permissions. The runner also compares existing
function definitions/ACLs, table ACLs/RLS and policies across Migration 10.

Deno checking, strict TypeScript, the 29 offline function checks and existing
save/privacy/navigation regressions pass. Lint has no errors; the generated
`.expo/types/router.d.ts` retains an unused-disable warning. No real provider
requests or credentials are used.

See the [function README](functions/geoapify-suggest/README.md) for local commands
and manual activation steps. Apply only Migration 10 through an approved workflow
before using the updated function. Hosted readback permissions, actual Edge
Runtime/Auth/gateway behavior and cold/warm latency within 800 ms still require
verification with Geoapify disabled. Extra readback latency may safely abandon
charged reservations; never extend the permit or weaken the quota guard to
compensate.
