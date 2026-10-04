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
