# Milestone 16C — Step 3 personal Apple picker

The creation form offers an optional, development-only Apple Maps picker. It
uses the existing native search/autocomplete adapter and Apple map preview.
Search is separate from the user-entered restaurant name/address: Apple names,
addresses and coordinates never populate persistent fields. Each resolved
candidate appears with its corresponding Apple map/pin. Showing a map does not
select an ID: only an explicit candidate tap keeps the adapter-validated optional
Place ID in the form's in-memory selection. Missing IDs allow normal saving.

Step 5: Migration 13 deployment/security verification is owner-confirmed, and
development saving is explicitly approved. `APPLE_PLACE_ID_SAVING_ENABLED` in
`app/(app)/personal-place-form.tsx` is now **`__DEV__`**. Only an explicitly selected,
validated ID accompanies independently entered fields; absent IDs are omitted.
Release restrictions, edit mode and Geoapify behavior are unchanged. Step 4 adds
on-demand ID reopening; Apple-returned details remain transient.

Changing the entered address remounts the picker and clears the selection.
Changing the Apple query/mode, closing the picker, backgrounding, leaving the
screen, changing accounts and signing out discard transient results. Saving
cancels search work; failed/uncertain saves retain the existing recovery behavior.
Native and adapter deadlines remain eight and ten seconds. Older iOS/binaries can
search without IDs; missing modules and other platforms allow normal saving.

## Local simulator testing

Use the existing GroupBite Debug build with the Milestone 16B native bridge.
This step changes only JavaScript/TypeScript, so Metro reload is sufficient for
that build. If the bridge is missing or older, run `npx expo run:ios --device`
and choose the iPhone 16 Pro (iOS 18.3) simulator. Expo Go cannot supply the
bridge. No native source, dependency or deployment target changed in this step.

1. Sign in and open Add Personal Place. Enter your own public test name/address,
   then open **Choose Apple Maps place (optional)**. Opening alone must not search.
2. Type a separate Apple search. Test autocomplete selection and explicit
   **Search Apple places**, including **Addresses** outside Fremont. Multiple
   candidates require an explicit choice. Check that its Apple pin and displayed
   details agree and that the entered name/address remain unchanged.
3. Test a result with an ID and one without. An explicitly selected ID can now
   accompany a development save; no ID still allows normal saving. Change the
   entered address: the picker must reset. Close,
   background, navigate away and switch accounts during search: old results must
   not return. Try empty results, offline failures and timeouts.
4. Recheck edit mode: it has no Apple picker. Saving/uncertain-save tests should
   use an isolated local backend or the offline tests below; do not create hosted
   test records as part of this milestone's verification.

Focused offline checks: `node tests/personal-apple-place-picker.cjs`,
`npm run test:personal`, `node tests/personal-create-draft.cjs`, and
`node tests/apple-map-search.cjs`. These exercise the actual form/helpers/adapter
with synthetic native and HTTP responses. They do not establish live Apple
coverage, ID availability or simulator behavior.

Owner-confirmed simulator acceptance passed: explicit picker selection, Apple
Place ID saving, full app restart, successful native ID reopening, preserved
personal memories, and automatic stale-ID clearing after an address edit.
Migration 13 deployment and verification are also owner-confirmed. These results
apply to the tested examples, not all Apple locations or future ID resolvability.
Additional simulator failure/cancellation scenarios and older iOS/binary behavior
remain pending unless separately verified; offline regression coverage is distinct
from manual simulator acceptance.
