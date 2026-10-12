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
  business mode with a Fremont hint, or addresses using a world region, with
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

## Milestone 16B — ordinary-address experiment

The existing **Addresses** mode already provides autocomplete, explicit **Search
places**, separate candidate selection, optional Place ID display/lookup and safe
empty/error states. Reuse it; there is no new screen, geocoder API, native method,
dependency, automatic reopening or persistence. To repeat an address after an
app restart, manually enter the same full address and search again. This tests
fresh resolution without relying on an ID or cached completion.

Two native adjustments support ordinary addresses: address autocomplete,
completion resolution and text search use an explicit world region instead of
the Fremont business hint; and address results with nil/blank names use the
returned formatted address as their display label. Valid coordinates and a
nonempty returned address are still required. Business behavior retains its
Fremont hint and existing name validation. Optional Place IDs come only from
Apple; using an address as a label does not invent a business or an identifier.
The existing 3–200-character query bound, five-result limit, DEBUG/iOS guards,
eight/ten-second deadlines, cancellation and privacy cleanup remain unchanged.

### Simulator acceptance

1. Rebuild with `npx expo run:ios --device`, choosing an **iOS 18+ Simulator** to
   inspect Place IDs. Launch the rebuilt GroupBite Debug app, not Expo Go; Metro
   reload alone cannot update native search-region/serialization behavior.
2. Sign in and open **My Places → View My Places on Map → Try Apple Maps Search**.
   Choose **Addresses**. Use a known ordinary street address without a business
   listing, within 200 characters, including city, postal code and country. Use
   public/non-sensitive test addresses; no private-address logs or screenshots.
3. Test one Fremont address and at least one outside Fremont, such as an ordinary
   street address in New York or another country. Wait for autocomplete. Select
   a suggestion and then a candidate, or explicitly tap **Search places** if
   autocomplete is empty. Verify the street/city and blue pin. A result is not
   proof of building-level accuracy, and a business listing is not required.
4. Inspect **Apple Place ID**. If present, use **Look up Apple Place ID again**;
   if absent, lookup must be disabled while address preview still works. Neither
   ID presence nor absence is guaranteed for all addresses. Multiple returned
   locations must remain selectable; never treat the first match as confirmed.
5. Keep the original test input outside the app. Terminate GroupBite fully from
   the Simulator app switcher (backgrounding alone is not an app restart), then
   launch it again. Reopen the preview, choose **Addresses**, manually enter the
   identical input and explicitly search. The old query/results must not return
   automatically. Compare the street/city and pin with the first run; exact
   result order, coordinate or Place ID equality is not a requirement.
6. Try an incomplete/ambiguous address and a nonexistent address. Apple may
   return alternatives rather than an empty response; show what it actually
   returns. Test offline failure/timeouts, quick edits, backgrounding, navigating
   Back and switching accounts. Stale results must disappear, and failed search
   must not retry automatically or invoke Geoapify.
7. Recheck **Businesses → Search Chipotle in Apple Maps**. The existing authorized
   saved red pin remains unchanged. No ordinary-address test saves anything.

Offline additions cover world-vs-Fremont request regions, unnamed address results,
optional identifiers, malformed geometry, explicit selection of ambiguous
outside-Fremont results, distinct failure outcomes and manual re-entry in fresh
native sessions/JS runtimes. These synthetic tests do not restart a native app or
call Apple.

Manual tests on the **iPhone 16 Pro Simulator (iOS 18.3)** confirmed successful
address searches outside Fremont, ordinary street-address autocomplete and map
pins, and some address results without an Apple Place ID. The SJSU address
returned the same coordinates after restarting the app and manually searching
again. Repeated address lookup is verified for these tested examples; this does
not guarantee coverage, IDs or identical coordinates for every address.
Automatic persistent reopening is not yet implemented.

Implementation checks passed: 24 Apple adapter/screen checks, 18 Swift engine
checks, 11 personal-map checks, 23 personal-place checks and 11 authentication/
navigation checks. TypeScript, targeted ESLint, Swift syntax and diff whitespace
checks passed. Debug/Release engine type-checks passed against the actual iOS
18.2 Simulator SDK with an iOS 15.1 target and a stub Expo Promise. This is not
a full Expo app build or a live native restart/search test.

Reference: [Apple autocomplete region defaults](https://developer.apple.com/documentation/mapkit/mklocalsearchcompleter/region?changes=lat_4_2).
