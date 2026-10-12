# Personal saved-place map (development iOS)

Open **My Places → View My Places on Map** in an iOS development build. The
existing `/dev-map` route now displays authorized, resolved personal locations
instead of the Ferry Building sample. Release builds still redirect this route
home; Android/web retain the iOS-only fallback. This does not enable autocomplete
or attach coordinates, and group maps remain outside this stage.

The typed client calls only Migration 8's `get_saved_locations` RPC with
`scope: personal` and no group target. That RPC enforces the JWT's `auth.uid()`
ownership server-side. Authorization is pinned to the initiating account; session
changes prevent publishing its results. Pagination includes unresolved rows and
validates each returned scope, ID and resolved coordinate before rendering. There
is no persistent map cache or automatic retry. A load has a 10-second cancellation
timer; failures clear pins and offer explicit Refresh Map.

`PersonalAccess` unmounts map data on navigation blur, background, sign-out or
account change. Foreground/reopening mounts a fresh read. Manual/unresolved places
stay available in the unchanged My Places list and are not mapped. Name/address
appear in native marker callouts. Existing MapKit pan/zoom remains enabled, and
the initial viewport fits the loaded pins. Current-location display is disabled:
no device location permission or coordinate lookup is requested. Apple map tiles
and Supabase reads still require connectivity; a tile problem is separate from
the saved-location RPC's error state.

## Manual iOS Simulator check

1. Keep real-autocomplete test mode disabled. From the repository, run `npm start`
   and press `i` to open the existing iOS Simulator app. No backend deployment or
   database change is needed for this UI integration.
2. Sign in as Taylor through the existing app flow. Open My Places, then
   **View My Places on Map**. Expect loading followed by Chipotle's real pin near
   Mowry Avenue in Fremont. Manual places without verified coordinates have no pin.
3. Tap Chipotle: verify its saved name/address. Pan and zoom; use **Refresh Map**.
   No device-location prompt, autocomplete search, or save operation should occur.
4. Tap **Back**: the original personal list, detail/edit navigation and group
   navigation must remain intact. Do not edit any saved place for this check.
5. Background/foreground the app while on the map: markers must be cleared while
   inactive and loaded afresh on return. Return to Home → Groups → Sign Out,
   then sign in as Alex and reopen the map: Taylor's Chipotle must not appear.
   An account without resolved places should see the empty-state message.
6. To test a read failure, disconnect networking **before opening or refreshing**
   the map. Expect a safe error, zero stale pins, and no automatic retry. Restore
   networking and explicitly tap Refresh Map. Tile loading itself may be cached.

Offline verification uses `node tests/personal-map.cjs` with the installed
Supabase client and mocked Fetch/MapKit. Native callout appearance, MapKit viewport
behavior and the production RPC's availability still require the manual check.
