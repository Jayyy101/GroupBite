# Native Apple Maps search preview

Development-only iOS proof of concept, separate from existing forms and maps.
No new npm dependency, API key, EAS service, backend deployment or migration is
required. Expo SDK 54 discovers the local module under
`modules/groupbite-mapkit-search` automatically. **Expo Go cannot load this bridge:**
build a local native Debug app once. Existing Expo Go functionality remains intact;
the search screen explains the missing bridge instead of crashing.

## Smallest iOS Simulator setup

1. Use the existing Xcode installation with an installed iOS Simulator runtime.
   Keep the real Geoapify autocomplete test mode disabled. Stop the existing Metro
   server, then run from the repository:

   ```sh
   npx expo run:ios --device
   ```

   Select an **iOS Simulator**, not a physical device. If Expo asks for a bundle
   identifier, choose a local development identifier such as
   `com.groupbite.mapkitpoc`; no distribution signing or paid cloud build is needed
   for this simulator test. Expo generates ignored `ios/` files, installs the
   existing project's CocoaPods dependencies and builds the local Swift module.
   The first build may need dependency downloads/CocoaPods setup. Do not use
   `prebuild --clean` or manually edit generated native files.
2. If Metro must be restarted later, use `npm start`, then open the **locally built
   GroupBite app** in Simulator rather than Expo Go. The usual public Supabase app
   configuration is reused for the authenticated comparison read; no provider or
   service-role secrets are needed. A native change requires rerunning the local
   build command; JavaScript changes use normal Metro reload.
3. Sign in as Taylor, then open **My Places → View My Places on Map → Try Apple
   Maps Search**. Opening the screen makes a read-only personal-location RPC; it
   does not automatically search Apple. No saved pin is substituted if this
   account cannot read the existing Chipotle row.
4. Tap **Search Chipotle in Apple Maps**. This populates the text and explicitly
   runs `MKLocalSearch` for that name/address after 400 ms; it does not treat the
   text as a suggestion. Choose a returned restaurant with the matching Fremont
   address. All returned locations remain selectable; the preview never guesses
   the first match. No results/error remains visible without automatic retry.
5. Selection opens a larger comparison map with the search controls removed.
   Compare **blue Apple** against **red saved Geoapify** markers, checking the pin
   tip/POI icon and exact address. The displayed separation is approximate, not an
   accuracy verdict. Both markers automatically fit with padding after map/layout
   readiness. Pan/zoom, tap callouts, and scroll the details for both names,
   addresses and coordinates. **Return to search** restores the results without
   issuing another search. **Looks correct (preview only)** acknowledges the
   preview in memory; nothing is saved or attached.
6. Type **Chipotle Fremont** in **Businesses**, then **2760 Mowry Avenue, Fremont**
   in **Addresses**. Input waits 400 ms after editing; fewer than three characters
   makes no request. Apple autocomplete suggestions are selectable and resolve
   with a separate `MKLocalSearch` before you choose a specific location. If
   autocomplete has no suggestions, tap **Search places** (or the keyboard Search
   key) for an explicit natural-language search. This is a new user action, not an
   automatic fallback/retry. Loading, completed empty results and errors are
   distinct. Repeated native input events and double taps do not duplicate work.
7. Edit quickly, background/return, navigate Back, and sign out/switch accounts:
   pending work must cancel and obsolete results/private pins must disappear.
   Returning starts a fresh authorized comparison read, with no automatic Apple
   search. With networking unavailable, show a safe error and require explicit
   user action to try again. Existing personal/group saves remain unchanged.

## Boundaries and verification

- `MKLocalSearchCompleter` includes point-of-interest and query suggestions for
  business mode, or addresses for address mode, with a Fremont region hint and
  five displayed suggestions. Configuration precedes delegate assignment, and an
  empty callback while `isSearching` is true cannot finish/cancel the request.
  The prior bridge accepted every first callback and excluded business query
  suggestions. These were implementation gaps; no live callback trace established
  which gap or Apple response caused the reported empty Simulator result.
- Only cached native completion objects can be resolved as suggestions. Explicit
  text search is a separate `MKLocalSearch.Request.naturalLanguageQuery` operation.
  Both paths validate and return up to five locations for selection. Apple's
  `placemarkNotFound` is an empty result; other errors are sanitized and surfaced.
  The region is a hint, not a hard geographic boundary.
- Search text is sent to Apple only after user edits/the explicit Chipotle action.
  There is no GPS/device-location permission, Geoapify request, Supabase write,
  retry loop, receipt signing, persistent search cache or query/result logging.
- Native operations use an 8-second cancellation timer; the adapter has a
  10-second fallback covering an unresponsive bridge. Late responses are ignored.
  Existing production Geoapify deadlines and quotas are untouched.
- The route and adapter require iOS development mode. Expo autolinking marks the
  module `debugOnly`, and its native search functions independently reject calls
  without Swift `DEBUG`. Release builds cannot enable this preview by changing a
  JavaScript feature flag.
- Coordinates are explicitly `apple-maps-preview` and transient. They are **not
  verified persistence evidence** and cannot replace a Geoapify signed receipt.
  Saving/correcting Apple coordinates needs a separately reviewed backend design.

Offline checks: `node tests/apple-map-search.cjs`, the existing app suites,
`node tests/apple-map-search-native.cjs` (actual Swift search engine compiled and
executed with Foundation-only fakes; it does not link or run MapKit),
`tsc --noEmit`, targeted ESLint, Swift syntax and CocoaPods specification parsing,
local Expo autolinking discovery, and type-checking the MapKit search engine
against the installed iOS Simulator SDK with a stubbed Expo Promise. This is not
a full Expo bridge build. Native runtime, full CocoaPods/app
compilation, Apple search relevance and pin accuracy still need the Simulator
steps above; mocked results do not establish Apple's actual Chipotle coordinate.

**Rebuild required for the search fixes:** rerun `npx expo run:ios --device` and
select the Simulator. Metro reload alone cannot add the native `search` method
or update the completer callback logic. An older bridge now fails availability
checks rather than enabling an unsupported Search action. No prebuild cleanup,
new dependencies, backend deployment, migrations or saved-coordinate edits are
needed.

Official references: [Expo local modules/autolinking](https://docs.expo.dev/modules/autolinking/),
[Expo custom native code](https://docs.expo.dev/workflow/customizing/),
[Apple search requests](https://developer.apple.com/documentation/mapkit/mklocalsearch/request),
[Apple autocomplete](https://developer.apple.com/documentation/mapkit/mklocalsearchcompleter).

## Milestone 16A — transient Apple Place ID round-trip

Search and completion-resolution results still use their temporary `requestId:index`
IDs for selection. In the updated Debug binary on iOS 18 or later, a result may
also include `placeId`, taken directly from `MKMapItem.identifier.rawValue`. The
adapter preserves this optional opaque reference without changing its case or
format. Missing/null IDs from older binaries normalize to an absent field; search
and comparison continue to work. No Place ID is invented from coordinates,
names, addresses, URLs or completion handles.

The selected preview displays the Place ID and offers **Look up Apple Place ID
again**. This explicit action creates an `MKMapItemRequest(mapItemIdentifier:)`
after the native failable identifier initializer accepts the reference. A
successful lookup updates only the in-memory Apple preview and its blue marker;
the authorized red saved Geoapify pin is unchanged. Lookup can return a different
current identifier or no identifier. The search candidates remain intact when
returning to search. There is no search fallback, automatic lookup or retry.

The lookup button is disabled for results without IDs, iOS versions before 18,
and older binaries lacking the new methods. Existing `isAvailable`/search gating
is unchanged. The new capability and lookup entrypoints retain Swift `DEBUG`
guards, JS development/iOS guards, and the existing `debugOnly` autolinking
configuration. No deployment-target increase, dependency, API key, Supabase
change, database migration or saved-data change is needed.

Lookup uses the existing eight-second native and ten-second adapter deadlines.
Cancellation, reset, replacement work, background, blur, unmount, sign-out and
account changes discard pending results. Returning to search cancels a pending
lookup too. Native lookup ownership uses an opaque operation token so a late
callback cannot settle replacement work even if a request ID is reused. The
native session stores a cancellation closure instead of an iOS-18-only request
type, preserving compatibility with the pod's iOS 15.1 deployment target.

A not-found/nil result or unusable preview geometry produces a visible empty
lookup status while keeping the previous search preview. Transport failures and
timeouts show sanitized errors instead; they do not establish that a place is
permanently gone. Neither outcome changes a saved resolution status. All Apple
search/lookup text, IDs and results stay in memory and are discarded with the
preview. There are no logs, location permissions, attachment receipts or writes.
This milestone does not add lookup across app restarts or persistent bookmarks.

### Rebuild and Simulator acceptance

1. Run `npx expo run:ios --device` and choose an **iOS 18 or later Simulator**.
   Launch the newly built GroupBite Debug app, not Expo Go. Metro reload alone
   cannot install the new native methods. Do not run `prebuild --clean`.
2. Sign in, open **My Places → View My Places on Map → Try Apple Maps Search**,
   then explicitly search Chipotle or another business. Select the matching
   location and check that its temporary result selection still works.
3. When Apple supplies an ID, tap **Look up Apple Place ID again**. Check the
   returned Apple details/blue pin and the success status. The saved red pin must
   remain unchanged. Test the autocomplete → resolve → select path as well.
4. For a result without an ID, verify that preview/comparison work and lookup is
   disabled. On an older iOS runtime/binary, search must still work with the
   capability explanation. ID coverage is a live Apple response property; an
   address search is not guaranteed to return an ID.
5. While lookup is pending, return to search, background, navigate away, and
   sign out/switch accounts. Obsolete results must not restore private UI. Check
   double taps and network failure; retry requires another explicit action.

Focused checks: `node tests/apple-map-search.cjs` covers both search paths, optional
IDs, older binaries/OS capability responses, opaque-reference/result validation,
round-trip UI, empty/error states, double taps, deadlines and privacy lifecycle.
`node tests/apple-map-search-native.cjs` compiles the actual Swift engine in Debug
mode with Foundation-only fakes; it covers identifier lookup, safe outcomes,
reset/cancellation/timeout, replacement work and late callbacks. These tests make
no provider requests and cannot establish live Apple ID coverage or relevance.
TypeScript, targeted ESLint, Swift syntax parsing, and actual iOS SDK engine
type-checks in Debug/Release should also pass. An engine SDK check uses a stub
Expo Promise; it is not a full Expo bridge/app build or native runtime test.

Implementation validation: 21 Apple adapter/screen checks, 14 Swift engine
checks, 11 personal-map checks, 23 personal-place checks, 11 authentication/
navigation checks and 6 stabilization checks passed. TypeScript, targeted ESLint,
Swift syntax, podspec Ruby syntax and diff whitespace checks passed. Debug and
Release engine type-checks passed against the installed iOS 18.2 Simulator SDK
with an iOS 15.1 target and a stub Expo Promise. Full app compilation and live
Simulator acceptance remain to be performed after rebuilding.

Apple references: [Place ID lifetime, aliases and storage guidance](https://developer.apple.com/documentation/mapkit/identifying-unique-locations-with-place-ids?changes=_1_9),
[native search and identifier lookup sample](https://developer.apple.com/documentation/mapkit/interacting-with-nearby-points-of-interest).
