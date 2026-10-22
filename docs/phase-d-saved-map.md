# Phase D — Polished Saved Map V1

Phase D adds the dedicated Saved Map to the structured-address baseline `f99c715`.
It preserves the existing five tabs, Add/save/recovery contracts and permissions.
There are no schema, Storage, hosted-data or dependency changes. The existing
**iOS development-build gate remains**; enabling release/TestFlight access is a
separate rollout decision.

## Experience and navigation

My Places exposes **View Saved Map**; Home exposes a **Saved Map** shortcut. The
screen lives in the My Places native stack and uses Apple MapKit through the
existing `react-native-maps` default iOS provider with `mutedStandard`. No provider
changes, custom tiles, paid services or new assets are involved.

Initial framing fits saved restaurants, not GPS. All Saved, My Places and current
group filters are local. Show All, zoom and pin/card selection intentionally move
the camera; ordinary map browsing stays free. There is no provider search or
geocoding while panning. Overlapping distinct venues remain reachable in the list.

Rounded utensil markers have distinct selected states and native hit targets.
The cream panel follows handle drags, reveals content during upward dragging,
and springs between collapsed, compact and expanded stops. The handle owns panel
gestures; the restaurant list owns scrolling. Tap controls and accessible adjustment
actions provide alternatives. Controls and the five tabs remain unobstructed;
panel changes preserve selection, filter and camera without changing map padding.

Unselected panels distinguish collection-wide mapped/unmapped totals from mapped
restaurants in the current viewport. Off-area and unmapped entries stay browsable;
invalid/missing coordinates never produce invented pins. Selected cards prioritize
name, address and authorized collection links. The existing location RPC supplies
each group's visit count/average rating and the personal latest rating. These stay
destination-specific; histories/notes are not loaded and counts are not combined.

Map-local personal/group wrappers reuse existing details and access checks.
Custom Back/native stack removal returns to the map; personal editors carry the
map origin through existing return helpers. Add destinations remain unchanged.
Home entry uses only the fixed `fromHome=1` origin, so map Back returns to Home.
Camera region, filter and selection survive detail return where practical; they
are screen memory, not persistent state. Route/account disposal and tab-root reset
can discard them. Heading/pitch are not retained across native map remounts.

## Read, privacy and identity contracts

`lib/saved-map-data.ts` performs account-pinned, deadline/abort-protected reads of
memberships/groups, personal places, group entries/referenced facts, native point
tables and the existing `get_saved_locations(all)` RPC. Existing RLS/RPC permissions
remain authoritative. No histories, notes, legacy device archive or persistent
cache enters the map model. Exact counts/keyset pages detect incomplete reads,
including shorter server page caps. Limits are 2,000 source entries, 1,000 groups,
80 requests and a 20-second whole-load deadline.

Membership incarnation/name snapshots must match before and after loading.
`useSavedMap` revalidates on focus, foreground and manual refresh, without polling.
Blur, background, account change, read failure or membership inconsistency removes
visible data and rejects late results. This is boundary-based revalidation, not
instantaneous revocation detection while continuously focused. Separate database
snapshots mean concurrent saves can require refresh.

Unique pins are presentation-only: no database entries or histories are merged.
Exact opaque Apple Place IDs take priority with corroborating current name/address
and compatible coordinates. ID-less fallback needs a complete normalized address
and name, preserving units, branch numbers, directions and postal codes. Structured
native facts must agree with a recognized saved address. Raw fallback recognizes
explicit US/Canada formats; unsupported/incomplete raw addresses remain separate
unless structured evidence suffices.

Different known IDs never merge, and an ID-less record cannot bridge conflicting
IDs. Conflicting facts or points separated by more than 100 metres split candidates.
Proximity alone never establishes identity. Representative coordinates are
deterministic, favor verified locations, and are never averaged or visually offset.
Native points require the exact current address snapshot. Filters regroup only
eligible sources and cannot borrow another collection's coordinate. Cards can link
to other currently authorized, unambiguously matched collections.

## Current location and native configuration

The existing Swift/Expo module adds a button-only Core Location request with When
In Use authorization and the matching Expo usage description. It handles denial,
disabled services, duplicate requests, cancellation, invalid/stale results and a
15-second timeout. GPS is never persisted/uploaded or reused as a restaurant point.
The permission prompt's inactive transition retains its answer until foreground
reads revalidate; background/unmount invalidates it. User location rendering starts
only after an explicit successful request. DEBUG/iOS/native and Geoapify gates remain.

## Appearance and deferred full dark mode

V1 deliberately stays **light under both system appearances**. Expo/native launch
configuration, the root native override, cream React Navigation theme/stack surface,
dark status-bar text and the explicit light `mutedStandard` map agree. Navigation
fonts are retained. Web avoids an unsupported native appearance setter. Panel/header
text scales up to 1.4×; restaurant content keeps full system scaling and scrolling.

Native Muted Standard + Dark was previewed successfully through existing MapKit
capabilities. That comparison is not app-wide dark-mode support. A future theme
milestone must introduce a shared semantic palette across Home, details, forms,
inputs/dialogs and tabs, then validate contrast and dynamic appearance transitions.
No partial dark restyle is included in Phase D.

## Commit boundary and validation

The Phase D commit includes only the Home shortcut import/insertion on the committed
Home screen. The unfinished Dashboard replacement stays in the worktree, alongside
its read models, declarations, documentation and tests. Its database read-type and
navigation-test changes are excluded. Saved Map has no dependency on those modules.
The staged snapshot is checked independently, including its original Home/navigation
assertions and database types. An actual Home-route regression verifies the shortcut.

Final checks use the exported Git index with installed dependency versions and
Expo route declarations generated from that snapshot, without `.env`, Dashboard
files or local cached route declarations:

- TypeScript (`--noEmit --incremental false`), uncached lint and staged whitespace.
- Navigation/auth/personal, M17 safety, Unified Add recovery and M18 UI regressions.
- Saved Map (23 checks), appearance (5), personal map and structured MapKit persistence.
- Offline Swift MapKit search and location-controller suites.

Earlier full-worktree checks also passed the three unfinished Dashboard suites;
these are integration evidence, not dependencies of the isolated Phase D commit.
Read-only authenticated validation found 15 source entries, six mapped venues in
four cities, four mapped venues per collection filter and three unmapped records.

The existing iPhone 16 Pro / iOS 18.3 development app was rebuilt in place for
location support and light native launch configuration, retaining session/data.
The latest build had zero errors and two dependency warnings. Home, map, selected
panel and Friends detail were visually inspected under both system appearances.
Appearance changes preserved camera, selected pin and panel state. User hands-on
acceptance confirmed smooth panel gestures, pin selection/automatic zoom, filters,
detail/Back restoration, current location, zoom controls, custom pins and Home entry.
Screenshots remain local review artifacts outside Git at
`/private/tmp/groupbite-map-polish/` and `/private/tmp/groupbite-appearance/`.

Offline tests do not establish hosted revocation races or real-device permission
edge cases. Physical-device/VoiceOver, smaller-screen and approximate-location/
services-off acceptance remain useful follow-up checks. No hosted writes, migration,
simulator-data reset or push accompanies finalization.
