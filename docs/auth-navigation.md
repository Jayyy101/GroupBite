> Milestone 18 supersedes the historical separate-creation and frozen group
> replay behavior described below. Existing group visit management and tab safety
> remain; see the [current completion report](milestone-18-completion.md) and
> [creation/recovery contract](milestone-18-unified-add.md). The frozen Add Visit
> replay paragraph below describes the former flow, not unified Add recovery.

# Authentication and tabs

All main routes live under `app/(app)/_layout.tsx`, which waits for the existing
Supabase Auth session before mounting its navigator. Signed-out access redirects
to `/auth`; a known internal deep link is resumed after password sign-in. The
authenticated navigator and the in-memory legacy archive grant are keyed by
account ID, so sign-out/account replacement removes private screens and drafts.
Token refresh for the same account does not reset navigation.

`(app)` and `(tabs)` are URL-free route groups. Existing paths such as
`/my-places`, `/add-visit`, `/group/:id`, and `/personal-place/:id` still work.
Home, My Places, Add, Groups and Account remain the same styled JavaScript
Expo Router tabs. My Places, Add, Groups and Account each contain a native Stack:

```text
(app)/
  (tabs)/
    index.tsx                         Home
    add/_layout.tsx                   Add Stack; clean root /add
      index.tsx                       landing, Saved and previous recovery
      personal-place/[id].tsx          result-origin personal detail
      group/[id]/restaurant/[entryId].tsx  result-origin group detail
    (my-places)/_layout.tsx            initialRouteName: my-places
      my-places.tsx
      personal-place/[id].tsx
    (groups)/_layout.tsx               initialRouteName: groups
      groups.tsx
      group/[id].tsx
      group/[id]/restaurant/[entryId].tsx
    (account)/_layout.tsx              initialRouteName: account
      account.tsx
      saved-places.tsx
      place/[id].tsx
  personal-place-form.tsx             facts editor; create links redirect to Add
  personal-visit-form.tsx             personal visit edit/delete
  add-visit.tsx                       unified destination form
  add-place.tsx                       archive editor; no id redirects to Add Visit
  dev-map.tsx
  dev-apple-search.tsx
```

All designated details, visit histories and archive browsing retain the tabs.
`popToTopOnBlur` resets a section when leaving it; Expo Router's native-stack
`tabPress` listener pops an already-selected tab to its root. Tabs stay visible
above the keyboard for inline entry, with iOS keyboard avoidance around Tabs. Stack `initialRouteName` anchors external
links, and `withAnchor: true` anchors programmatic detail/save entry. Route groups
add no URL segments or collisions. Native Back/swipe-back operates inside each
section. This follows Expo's [stacks inside tabs pattern](https://docs.expo.dev/router/basics/common-navigation-patterns/)
and React Navigation's [tab reset behavior](https://reactnavigation.org/docs/bottom-tab-navigator/).

Full-screen personal, visit and archive forms remain in the parent Stack, hiding
tabs. Unchanged forms close immediately; dirty Back/Cancel and native removals
require **Stay / Discard**. A shared `useLeaveGuard` also registers the focused
inline Create/Join or Visit editor with the tab layout: tab presses are prevented
before blur, including reselect. Approved presses replay native stack/tab actions.
Local Create/Join exits use the same guard. Discard clears input without issuing
a mutation. Active Create/Join, personal/archive saves and inline Visit mutations
block leaving; account replacement/sign-out always disposes their guards.

The former Add Visit flow retained its explicit **Stay and Keep Submission / Leave
Anyway** warning during pending/uncertain saves, now also covering a frozen
submission paused before dispatch. Deliberate abandonment suppresses late results;
exact retry keeps the original account, RPC, request ID, groups, fields and Apple
ID. Dirty unsent visits use ordinary Stay/Discard. An initial definitive rollback
unlocks correction, while a rejection after uncertainty never releases the original
submission. The save deadline and RPC contracts are unchanged.

Inline Visit update/delete transport uncertainty locks further mutations.
**Check Saved Visit** uses account-pinned reads to confirm the intended
fields or deletion (including removal of a final-visit entry); it never replays a
mutation. A mismatching/unavailable result stays locked for another read. Back,
Cancel and tab changes offer **Stay / Leave Anyway**, explaining that leaving does
not undo the change and saved visits must be reviewed before another intentional
edit or deletion. Active submissions still block leaving. Deliberate abandonment
invalidates retained callbacks and never retries a mutation. Existing
permissions, membership invalidation and delete confirmation still apply. Personal
uncertainty retains its existing receipt/revision reconciliation and explicit
review exits, with a leave warning before discarding the form.

The restaurant route owns the inline editor controller above the access-gated
cards. Temporary inactivity, access polling failures and detail refreshes hide
private fields without clearing drafts, pending operations or reconciliation
state. Foregrounding verifies membership and reloads the scoped entry/visits
before exposing fields or enabling mutations. Account, group, entry, membership
identity and ownership changes dispose the old editor and invalidate its
callbacks. A successful save across a lifecycle change requires explicit
read-only review; it never navigates automatically on return. If access cannot
be verified, the generic leave warning remains reachable without exposing the
draft. Confirmed membership loss clears the old draft; a new membership cannot
inherit it. Already dispatched writes can still finish on the server.

Personal Edit retains its account/record-scoped draft above the temporary
visibility gate too. Returning re-reads the owner-scoped record before displaying
fields. The original revision remains attached to the draft: a newer server
revision blocks saving and offers the existing Cancel and Refresh exit, rather
than silently rebasing or replacing typed fields. Pending/uncertain edits remain
locked after hiding; no PATCH is replayed. Missing records/read failures keep
fields hidden, with explicit Refresh/Back recovery. Sign-out, account replacement,
record changes and route disposal clear the draft.

Create Group uses an account-scoped in-memory attempt lock above the route tree.
A lost/malformed response or deadline keeps creation locked across inactivity,
tab changes and route remounts. **Review Groups After Creation** performs reads;
even an empty successful result cannot prove that the request failed. After a
successful review, **Start a Separate Group** requires a second explicit warning
acknowledgement before allowing a fresh intentional create. That acknowledgement
does not send a request. A definite server rejection permits correction normally.
Join requests and Owner/Member permissions retain their existing contracts.

These protections are client-side only. There is no server idempotency key for
Create Group, no name-uniqueness proof, and no persistent attempt journal. Reload,
process termination or ending/replacing the signed-in session loses the lock;
review existing groups before creating again. Explicitly acknowledging a separate
creation can still produce a duplicate if the earlier request later commits.
Inline Visit requests/reconciliation and Group creation preflights/requests have
20-second response deadlines. A deadline bounds the client wait, not the server
transaction; uncertain writes remain locked, ignore late results and never retry.

Milestone 18 replaces separate creation flows with the restaurant-first Add
landing and one parent-stack visit form. Every destination starts unchecked.
Single-destination success dismisses the form into the exact saved entry, with
its tab root anchor. Multiple/partial results dismiss into the Add tab's recovery
summary, so the completed form is absent from Back history. The account-owned
coordinator and minimal persistent journal keep destination outcomes reviewable;
uncertain mutations are reconciled read-only. Personal facts and individual visit
editors preserve original revisions, draft hiding and leave guards. See
[Milestone 18](milestone-18-unified-add.md) for current save/recovery and schema
cutover behavior. Native Apple debug gates and the saved map are unchanged.

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
5. Browse a personal detail, group detail, restaurant/history and Account archive
   detail. Tabs must remain visible with the existing icons/colors. Switch to each
   tab, and reselect a tab while on its detail: expect that section's root. Reopen
   details and verify both Back and iOS swipe-back.
6. From Add, open each full-screen form (including archive Edit). Tabs must hide.
   Back out unchanged; then change a field and test Back and swipe-back with
   **Stay**, followed by **Discard**. On Groups, type Create/Join input with the
   keyboard open; test another tab, Groups reselect and a group card. Stay retains
   both inputs; Discard clears them. Edit a Visit inline and repeat with Cancel,
   Back, another tab and reselect. Discard must issue no save/delete.
7. User-run mutation checks require separately authorized disposable test data:
   save personal create/edit, single-group Add Visit/Add Another Visit, and a
   multi-group visit. Expect personal detail, the correct group's entry history,
   and Groups root respectively. Back/swipe must never reopen a completed form.
   Check existing edit/delete permissions and final-visit delete confirmation.
   Exercise failed/pending/paused/uncertain results with controlled offline
   transport: entered fields and exact group submission stay intact; retries
   never duplicate visits. Inline uncertainty offers read-only Check Saved Visit.
8. Test a deep link in a second terminal, substituting a group ID accessible to
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

9. In Account, open **Review device-only archive**. Expect the ownership notice
   before any record names. Acknowledge only on your own test device; verify old
   records remain. Sign out and sign into another test account: Home/My Places
   must not expose old cloud data, and the archive must show its notice again.
10. Background and return; change tabs and reopen a detail. Verify private reads
   refresh normally and drafts/account-specific content never transfer between
   accounts. Do not enable the separately gated real Geoapify test mode.

## Milestone 17 UI polish review

The five tab roots use `ScreenScaffold`: a cream surface with a protected top safe
area and a separate scrolling viewport. My Places' shared personal-access fallback
also uses that protected viewport. The tab bar continues to own the bottom inset.

The compact Back/title refinement applies only to group detail and restaurant
detail on iOS, including loading/error/fallback states. Native Stack headers remain
hidden. The scaffold's `edgeToEdge` opt-in keeps a full-height cream ScrollView,
with no outer top inset or fixed navigation row. Back's visible circle is 40 points
with a 20-point chevron inside a separate 44-by-44 Pressable. Its VoiceOver label,
busy state, callback, neutral border, orange icon and pressed feedback are preserved.

The title is the first scrolling content on its own full-width line below Back,
using 26-point bold text with natural wrapping and no font-size cap or truncation.
There is no horizontal Back spacer or title-dependent Back positioning. Back stays
at `insets.top + 4`. Initial scrollable content padding clears the measured Back
target height plus a compact 8-point gap; the title has 16 points below it. Long
names and larger accessibility text grow naturally, pushing body content down.
The title scrolls away while Back remains stationary. Automatic inset adjustment,
bottom/tab spacing and `scrollTo({ y: 0 })` behavior remain unchanged.

Experiment A's eight-point gradient is removed entirely. A noninteractive,
accessibility-hidden cream cap covers exactly the actual top safe-area inset,
with no added height, blur, divider or fade. No cap is drawn at a zero top inset.
This deliberately keeps the clock/Dynamic Island readable: content still disappears
at the system-safe-area edge, but there is no artificial transition below it or
large protected navigation band. Scrolling content can pass behind Back and beside
it. Other screens and platforms retain Astra's existing polish and viewport design.

Milestone 17 header/scrolling experiments are complete. This final title cleanup
leaves the existing status-bar treatment and scrolling behavior intact. The source
snapshot before this cleanup is at `/tmp/groupbite-title-cleanup-before`. Preserve
all other uncommitted work; no dependency, save logic or navigation infrastructure
is changed.

Primary buttons using shared backend styles, plus Home's primary action, use
the existing darker orange for white-label contrast. Card-only spacing overrides
leave general paragraphs unchanged. Group, restaurant and personal-place cards
have decorative disclosure chevrons beside their wrapping titles; metadata still
uses the full width. Groups Create/Join and Account Sign Out use secondary styling,
and Home reuses the shared secondary-button appearance.

First review the trial on the existing iPhone 16 Pro running iOS 18.3. Pro Max and
smaller-device checks follow only after reviewing screenshots from this device:

- Check Back's unchanged 40-point circle/44-point target and safe-area position.
  The 26-point title must use its own full-width line below Back, with an 8-point
  gap after the target. Check long/short names and all loading/deep-link fallbacks.
- Slowly scroll titles, orange buttons and cards behind Back. The title must scroll
  away; only Back remains stationary. Body content must use the full width with
  no permanent title gutter or large blank region. There must be no fade/blur band.
  Judge the minimal cream cap edge at the actual status safe area.
- Fast-scroll and bounce at both ends. Back stays fixed, clock/Dynamic Island
  remain readable, indicators clear the header and final controls clear the tabs.
- Check all five roots, with the Groups keyboard open, for natural heading spacing,
  reachable controls and no duplicated top/bottom inset. Rotate to check side insets.
- Enable larger accessibility text and VoiceOver. Check unrestricted title
  wrapping, full-width titles, no body overlap, and one Back target announced
  as "Back, button". Check disabled state, title heading role and reading order.
- Repeat Back/swipe (including cancelled swipes), deep-link fallback and tab
  switch/reselect. Edit a Visit inline and verify Stay/Discard with Back, swipe
  and tab changes. Exercise active/paused/uncertain saves through the offline
  suites; do not submit production data for a visual review.

Automated layout assertions verify component structure and properties, not native
clipping, font metrics, actual Dynamic Type wrapping, touch delivery or VoiceOver
output. Review full-width title wrapping and compact spacing in the simulator;
the existing cream safe-area cap and scrolling treatment are unchanged.

## Offline checks

`npm run test:auth-navigation` checks the auth gate, return paths, account resets,
password flow, sign-out errors, legacy guards, Supabase refresh/restoration races,
actual Expo route discovery/path parsing, and installed tab/stack reducers.
`npm run test:navigation` additionally exercises nested route/save history, the
installed native-stack reselect listener, tab press confirmation, paused sends,
and read-only inline reconciliation. It also checks both detail-screen Back controls,
safe-area layout in portrait/landscape and fallback states, tab-root viewports,
decorative card navigation, and membership/visit busy-state disabling. Its native
event delivery is modeled.
`tests/milestone-17-safety.cjs` drives the actual restaurant route through hidden,
pending, uncertain, access-failure, membership/ownership and account transitions.
It also covers Personal Edit verification/revision preservation, account-scoped
Group creation locks, warned exits, request deadlines and stale callbacks.
Existing `tests/*.cjs` suites cover personal CRUD/drafts, form navigation, maps,
autocomplete and Geoapify adapters. All use synthetic sessions and mocked
transport/storage. They do not establish native Simulator UI behavior or hosted
authentication settings.

## Current unified Add completion and recovery

Confirmed results clear only after every destination is confirmed and local
journal removal succeeds. Done and later Add-tab selection return to clean Add.
Result links push details inside Add's own stack; Back returns to Saved. Normal
My Places/Groups browsing retains its own parent. The five tabs and existing
unsaved/uncertain guards remain.

Uncertain writes are never replayed automatically. **Start a separate Add**
requires explicit confirmation and archives account-scoped recovery markers
before resetting, giving new saves independent request IDs. Previous save
recovery offers read-only receipt checks. Storage failure requires a second
explicit temporary-recovery acknowledgement; it cannot bypass the journal-write
requirement for new mutations. Leaving a recovery screen alone clears nothing.
See the [recovery completion contract](milestone-18-recovery-completion.md).
