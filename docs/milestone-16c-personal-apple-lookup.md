# Milestone 16C — Step 4 saved personal Apple lookup

The existing personal detail screen offers **Look up saved Apple Place ID** only
after its owner-scoped read succeeds, within the existing development boundary.
Nothing runs automatically. A tap calls the existing native identifier lookup
and displays the current Apple result on the existing Apple map preview, separate
from saved user-entered facts. Results and replacement/alias IDs stay transient;
no Supabase/storage writes, navigation data, logs, address searches or new RPCs
are added. Existing Geoapify flows are unchanged.

The stored ID has no originating search mode. Lookup uses address serialization
so an unnamed Apple map item can still display its returned address. This only
controls result formatting; the native request uses the ID, not an address query.
An empty result, invalid ID, offline failure or timeout leaves stored data
unchanged. Retrying requires another tap. Missing IDs and missing/older native
modules or unsupported iOS show an explanation instead. Release builds do not
expose the feature. The native/adapter eight/ten-second deadlines remain intact.

Leaving, backgrounding (including batched inactive/active events), changing
accounts/records, refreshing details or starting deletion discard results and
cancel pending work. Returning or cancelling deletion never retries lookup.
Migration 13 remains unchanged. Step 5 activates ID saving only under `__DEV__`
after owner-confirmed hosted deployment/security verification and explicit approval.

## Testing and simulator acceptance

`node tests/personal-apple-place-lookup.cjs` exercises the actual owner-scoped
detail screen, adapter and map props using synthetic saved rows/native responses.
It verifies explicit lookup, privacy, unsupported/missing/invalid IDs, failures,
deadlines, explicit retries, double taps, refresh and lifecycle cancellation.
These tests do not call Apple or demonstrate native persistence across restart.

With the existing Milestone 16B Debug binary, Metro reload is sufficient; no
native code changed. A missing/old bridge needs `npx expo run:ios --device` and
an iOS 18+ simulator, such as the tested iPhone 16 Pro on iOS 18.3. Expo Go cannot
provide the bridge.

Migration 13 deployment is now owner-confirmed. Existing rows have no Apple ID
unless separately saved with one; Step 5 permits explicit ID selection in the
development form. No hosted test records or database changes were made by the
implementation work during Step 5.

Once such a fixture exists, reopen its details after a full app restart: no
lookup should occur until tapping the button. Check the Apple pin/details while
saved facts remain unchanged. Test offline operation, timeout, explicit retry,
refresh, Back, background, account/record changes and deletion confirmation while
lookup is pending. Check iOS before 18 and older binaries retain usable details.

Owner-confirmed simulator acceptance passed: picker selection and Apple ID saving,
full app restart followed by successful native ID lookup, preserved personal
memories, and automatic stale-ID clearing after an address edit. Migration 13
deployment and verification are also confirmed. These tested examples do not
guarantee Apple ID coverage or future resolvability. Additional manual offline,
timeout/retry, refresh/navigation/background, account-isolation, deletion and
older iOS/binary scenarios remain pending unless separately verified; synthetic
regression tests cover their logic independently.
