# Authentication and tabs

All main routes live under `app/(app)/_layout.tsx`, which waits for the existing
Supabase Auth session before mounting its navigator. Signed-out access redirects
to `/auth`; a known internal deep link is resumed after password sign-in. The
authenticated navigator and the in-memory legacy archive grant are keyed by
account ID, so sign-out/account replacement removes private screens and drafts.
Token refresh for the same account does not reset navigation.

`(app)` and `(tabs)` are URL-free route groups. Existing paths such as
`/my-places`, `/add-visit`, `/group/:id`, and `/personal-place/:id` still work.
Home, My Places, Add, Groups and Account are JavaScript Expo Router tabs.
Existing forms/details sit above the tabs in the authenticated stack, preserving
their Back and save/dismiss behavior. Add launches the existing personal or group
form; it does not introduce a unified save operation.

Account displays the session email and uses the existing local-scope Supabase
sign-out. Session persistence, password authentication, providers, and project
email settings are unchanged. No OTP/MFA or additional verification is added.

The original `savedPlaces` AsyncStorage records are unchanged and are never
assigned to an account automatically. Account has an explicit archive entry.
Every legacy list/detail/edit URL requires acknowledgement before reading device
records. This acknowledgement lasts only for the current signed-in session and
resets on sign-out/account replacement/restart. It prevents accidental exposure;
it cannot prove ownership of records that never had account IDs.

## iOS Simulator checks

1. Start Metro with `npm start`. Open the existing locally built **GroupBite** app
   in your booted Simulator and reload JavaScript (`Cmd+R`). The navigation changes
   need **no native rebuild**. Expo Go can test auth/tabs too, but cannot load the
   existing custom MapKit search module.
2. If already signed in, tap **Account → Sign Out**. Expect Sign In immediately,
   with no tabs or prior private content. Relaunch while signed out; confirm the
   same result. Sign In/Sign Up uses the existing account/password behavior.
3. Sign in with an existing test account. Expect Home and exactly **Home, My
   Places, Add, Groups, Account**. Verify Account shows the correct email.
4. Quit GroupBite from the Simulator app switcher and reopen it. Expect the brief
   session-restoration state followed by Home, with no password/code prompt for a
   valid persisted session. Do not clear app storage or uninstall the app.
5. Open My Places and an existing personal detail; check Back. From Add, test
   **Only me** and **Add a group visit**. Cancel each form. With disposable test
   memories, verify personal saves return to details and group saves return to
   the selected group (or Groups for multiple groups). Check existing membership
   and group-detail controls.
6. Test a deep link in a second terminal, substituting a group ID accessible to
   the test account:

   ```sh
   xcrun simctl openurl booted 'groupbite://group/REPLACE_WITH_GROUP_UUID'
   ```

   Check it while signed in, then sign out and repeat. While signed out, expect
   Sign In with no group content; after signing in, expect that group. Also test
   the preselected group form:

   ```sh
   xcrun simctl openurl booted 'groupbite://add-visit?groupId=REPLACE_WITH_GROUP_UUID'
   ```

7. In Account, open **Review device-only archive**. Expect the ownership notice
   before any record names. Acknowledge only on your own test device; verify old
   records remain. Sign out and sign into another test account: Home/My Places
   must not expose old cloud data, and the archive must show its notice again.
8. Background and return; change tabs and reopen a detail. Verify private reads
   refresh normally and drafts/account-specific content never transfer between
   accounts. Do not enable the separately gated real Geoapify test mode.

## Offline checks

`npm run test:auth-navigation` checks the auth gate, return paths, account resets,
password flow, sign-out errors, legacy guards, Supabase refresh/restoration races,
actual Expo route discovery/path parsing, and installed tab/stack reducers.
Existing `tests/*.cjs` suites cover personal CRUD/drafts, form navigation, maps,
autocomplete and Geoapify adapters. All use synthetic sessions and mocked
transport/storage. They do not establish native Simulator UI behavior or hosted
authentication settings.
