# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.

## Milestone 15: address autocomplete UI, mock phase

Personal Place create/edit and the editable Add Restaurant / Visit form share
`components/address-autocomplete.tsx`. Development builds use only deterministic
fictional addresses from `lib/mock-address-search.ts`. Type **Demo** or **Market**
to see up to five suggestions after three characters and a 400 ms debounce.
Release builds retain manual address entry and never call the mock search.

Choosing a suggestion fills its sample formatted address and retains its sample
coordinates only in that form's memory. Editing the address clears the selection.
Mock coordinates are never persisted or attached. Save payloads, RPCs, validation,
ratings, notes, selected groups and navigation are unchanged. Existing shared
Restaurant details remain locked. Loading or focusing an existing address never
searches automatically; a text edit is required. There is no provider, Edge
Function, key, location permission, dependency or migration change in this phase.

Pending timers/requests are cancelled on newer edits, blur/Done, disabling,
inactivity, resets and unmount; late responses are ignored even if abort is ignored.
Account changes reset both forms. Personal Place creation keeps its account-scoped
text, ratings and save-attempt state above the foreground access gate; its visible
UI, autocomplete selection/coordinates and pending searches unmount on
blur/background. Personal edits keep their existing draft-clearing behavior.
Add Visit keeps its existing text draft while clearing autocomplete selection/work;
Refresh Groups also clears autocomplete state.

Create drafts exist only in memory and clear on confirmed save, explicit Back or
Review My Places, sign-out or account change. Pending/uncertain saves retain their
original request identity across foreground remounts and cannot submit again.
If a save finishes after leaving the foreground, its typed draft clears, navigation
waits for **Check Saved Result** or **Review My Places**, and no request is replayed.
Checking is read-only; a missing or deleted result never unlocks automatic retries.
A full JavaScript reload, process termination or removal of the form route still
loses the draft and its attempt state. No draft storage or dependencies were added.

Offline checks (no `.env`, external network or hosted backend):

```sh
node tests/address-autocomplete.cjs
node tests/personal-create-draft.cjs
node tests/personal-places.cjs
node tests/navigation.cjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
```

Manual iPhone simulator checks using the existing configured development app:

1. Start the normal development app with `npm run ios`, or press `i` in the
   existing Expo terminal. Sign in using your test account.
2. Home → **My Places** → **Add Personal Place**. Enter a restaurant name.
   In Address, enter `De`: no list. Enter `Demo`, wait about half a second:
   five clearly marked mock suggestions. Tap the first once with the keyboard
   open; the full address fills, the list closes and the keyboard dismisses.
3. Change rating/notes: the mock selection remains. Edit the address: the selected
   indicator disappears. Enter an arbitrary address with no match and verify
   manual saving and the usual detail/Back navigation still work.
4. Edit an existing Personal Place. Its loaded address must not open suggestions,
   including on focus. Type a new query to enable them. Cancel or save as usual.
5. Home → **Add Restaurant / Visit**. Repeat selection/editing, choose one then
   multiple groups, and verify ratings/notes and the usual save destinations.
   **Refresh Groups** should preserve draft text/groups/notes, clear the mock
   selection and close suggestions without initiating another lookup.
6. Open a group's existing Restaurant Details → **Add Another Visit**. Shared name,
   address and cuisine must stay locked, with no mock suggestions or helper copy.
7. Type quickly, erase below three characters, tap another field, and use keyboard
   **Done**. Old results must disappear; Done/blur must close the list. Confirm a
   suggestion needs only one tap and that keyboard insets permit scrolling to
   the list and Save. Check VoiceOver address hints and suggestion button labels.
8. In **Add Personal Place**, fill name, address, cuisine, visit date, rating,
   would-go-again and notes. Use Simulator **Device → Home** (`Cmd+Shift+H`), wait
   five seconds and reopen **Expo Go** from its Home Screen icon without closing
   it or reloading. All entered fields should remain. Repeat with a selected mock
   address: its text remains but the selection indicator/list must clear. Repeat
   by backgrounding immediately after typing `Demo`: no suggestions should appear
   on return until another edit. Visit text also remains; Personal edit drafts reset.
9. For a pending-save check, use a slow test connection, tap **Save Personal Place**
   once, background and return. If still pending, inputs/Back/Save stay disabled.
   If confirmed while away, fields clear and **Check Saved Result** opens the saved
   place without another insert. An uncertain save remains blocked; checking is
   read-only and a missing result does not permit replay. Ordinary foreground saves
   still open details and Back returns to My Places as before.
10. Use form **Back**, reopen Add Personal Place: empty fields. Sign out or switch
    accounts with a draft, then reopen: no prior fields, selection or save lock.
    A deliberate Expo reload also empties an unsaved draft; persistence is deferred.

Saving a mock address saves its fictional text through the normal save flow;
there is no coordinate attachment. Use disposable test entries for these checks.
