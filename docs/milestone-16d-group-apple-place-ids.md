# Milestone 16D: group Apple Place IDs

Implementation based on `82afb041` (16C), on `main`. **Migration 14 is deployed and core simulator acceptance has passed**, as reported by the owner on 2026-10-15. This documentation update and final review use local files/tests only; they do not independently query hosted state. Swift, dependencies, migrations 1–13, RLS policies, direct table-write grants and personal-place contracts remain unchanged. Do not reapply historical migrations or run synthetic fixture suites against hosted data.

## Owner-confirmed hosted simulator results (2026-10-15)

Environment: hosted Supabase, **iPhone 16 Pro simulator, iOS 18.3**, development build. These are manually verified results supplied by the owner, distinct from the offline automated coverage below.

- Migration 14 deployed; migration versions **1–14 synchronized**; **all 11 post-deployment checks true**.
- **Date Nights / Jay Owner / Chipotle Mowry:** Apple ID saved and persisted; **2 Visits, 4.5 average**.
- **Friends / Jay Member / Chipotle Mowry:** initially no ID; **2 Visits, 3.5 average**; the member's attempted ID attachment was ignored.
- One multi-group save created **Chipotle Auto Mall** in both groups, with **1 Visit each** and successful independent saved-ID lookup in each group.
- **Friends / Alex Owner / Chipotle Mowry:** added **Visit 3 to the existing entry** and filled its empty Apple ID; **3 Visits, 4.0 average**, saved-ID lookup successful.
- On the actual simulator, a **synthetic pre-request save loss** displayed uncertainty, locked the submission and showed **Retry Same Visit Save**. Both custom Back and native swipe displayed abandonment confirmation. **Stay and Keep Submission** preserved the form; **Leave Anyway** exited. The test save request was blocked before network transmission and the network guard was restored. This verifies the warning UI/lifecycle; it does **not** demonstrate a server commit, receipt replay or duplicate prevention after a committed lost response.

## Remaining limitations and separate work

- **No manual after-commit response-loss test** has been performed. Exact frozen retries and duplicate prevention after simulated commits are covered by offline client tests and the earlier disposable SQL/concurrency tests, not this simulator fault test.
- **No release-binary test** has been performed. Development gates have offline coverage; a release build still requires manual acceptance. The recipes below also contain broader privacy/lifecycle/address-change scenarios that are not claimed as manually passed by these core results.
- Frozen retry identity lives only in the current form. Deliberate abandonment, account replacement, reload/crash or process termination loses it; external termination cannot show a navigation warning. Inspect visits in every destination before any new intentional submission, since reopening generates a new request ID and can create another Visit if the earlier save committed. Stay and retry the same frozen form when its outcome is uncertain.
- Hosted **`rls_auto_enable()` / `ensure_rls` provenance verification and documentation remain a separate pending task**. The owner-reported deployment checks do not close that task.
- The top-level and Supabase README deployment summaries still describe the earlier pre-deployment state. This update is scoped to this guide; those summaries need a separate documentation correction.

## Changed files

- `supabase/migrations/20261013001400_group_apple_place_ids.sql`
- `app/(app)/add-visit.tsx`
- `app/(app)/group/[id]/restaurant/[entryId].tsx`
- `lib/group-visit-save.ts`
- `lib/restaurant-ui.ts`
- `types/database.ts`
- `components/group-apple-place-lookup.tsx`
- `components/personal-apple-place-picker.tsx`
- `components/personal-apple-place-lookup.tsx`
- `supabase/tests/group_apple_place_ids.sql`
- `supabase/tests/group_apple_place_ids_concurrency.mjs`
- `supabase/tests/validate_group_apple_place_ids.mjs`
- `tests/group-apple-place-ids.cjs`
- `tests/personal-places.cjs` (navigation-removal/Modal test boundary only)
- `docs/milestone-16d-group-apple-place-ids.md`
- `README.md`
- `supabase/README.md`

## Database contract

`20261013001400_group_apple_place_ids.sql` adds nullable `group_restaurants.apple_place_id`, with the identical validated opaque-ID constraint from Migration 13: 1–300 Unicode code points, no leading/trailing JavaScript whitespace or control characters, exact case/content retained. PostgreSQL rejects NUL independently. No uniqueness or Apple deduplication index is added. IDs never live on `restaurants` or `visits`.

`save_restaurant_visit_with_apple_place_id` is a distinct authenticated-only, security-definer RPC with an empty search path. Its first nine arguments are the old save fields, followed by optional `restaurant_apple_place_id`; it returns `restaurant_id` and `bindings_recorded`. It requires READ COMMITTED, locks selected groups in sorted order, checks **all** current memberships, and then applies these rules separately per destination:

| Exact normalized name/address entry | ID supplied | Result |
| --- | --- | --- |
| New | Any current member/owner | Create that group's entry with the ID and Visit 1 |
| Existing, NULL ID | Current owner | Fill its ID and add the next Visit |
| Existing, NULL ID | Ordinary member | Leave ID NULL and add the next Visit |
| Existing, non-NULL ID | Any member/owner | Keep original ID and add the next Visit |
| Any | No ID | Preserve ID and save with the historical behavior |

Supplying an ID never grants metadata-editing authority and never prevents an otherwise permitted visit. IDs are optional untrusted references, not verified location facts. Apple data never replaces user text. Exact, case-sensitive trimmed name/address remains authoritative. A repeated visit produces another Visit on the same card; matching Apple IDs on different exact names/addresses do not merge cards. New facts remain group-scoped under Migration 12; historically shared Restaurant rows remain supported.

ID-bearing receipts include `apple_place_id` in the SHA-256 JSON fingerprint, including when permission rules ignore that ID. Changing, adding or dropping the ID with the same request ID is rejected. NULL-ID calls delegate to the **unchanged** location-binding wrapper and keep the exact historical fingerprint. Replaying legacy receipts cannot infer bindings; replaying Apple receipts never changes entries, reattaches invalidated IDs, or creates new visits. New Apple saves record each group's actual entry identity for Geoapify compatibility. All visits, IDs, new facts, bindings and receipt changes commit or roll back together.

Before touching entries, Apple saves acquire sorted `FOR SHARE` locks on **all** Restaurant facts already referenced by the destination groups. This also covers a concurrent address edit that makes previously nonmatching facts match. Different groups sharing a historical Restaurant can save concurrently. Address writers lock the Restaurant before the existing invalidation trigger updates entries, so they cannot interleave an address change with an Apple ID attachment. A privileged actual address change clears every affected group ID and stale Geoapify location in the same transaction; a name edit or unchanged address preserves both. The trigger retains personal-place behavior and its existing identity/ACL. This introduces broader read locks during ID-bearing saves in large groups; no new background workload is added.

`get_group_restaurant_apple_place_id(target_group_id, target_group_restaurant_id)` checks current membership and returns only the precisely scoped entry and its optional ID. A mismatched/deleted entry returns no row; a nonmember gets a generic access error. Anonymous/PUBLIC/service-role execution and direct client metadata writes remain denied. The deployment build type does not weaken SQL permissions.

## Client behavior and lifecycle

Group Add Visit reuses the personal Apple picker, native search and map preview in development, including Add Another Visit with its read-only existing facts. Candidate preview alone does not select an ID. An explicit candidate tap emits only the adapter-validated optional ID. User name/address and selected destinations changing, blur, background, access/ownership changes, refresh or account replacement discard live search data and selection. Apple name/address/coordinates stay inside the disposable picker and lookup; they do not enter storage, navigation, global facts, visits or save fields.

Before the first asynchronous operation, the form freezes account, sorted/deduplicated group IDs, every normalized field, optional Apple ID, RPC choice and request ID. The outgoing save uses that account's explicit Authorization header and disables automatic transport retry. A 20-second response deadline aborts the transport and treats the outcome as uncertain, even if the server committed or the transport ignores cancellation. Sending discards live picker selection while preserving the frozen submission. Double taps are suppressed. A transport error/timeout/lost response locks the fields and group choices and exposes **Retry Same Visit Save**, which reuses that entire submission despite picker/lifecycle/access resets. Only an actual HTTP error response from the RPC can mark a rejection definitive. Confirmed PostgreSQL rollbacks include SQLSTATE **40P01** (deadlock), **40001** (serialization failure) and **57014** (server-side statement cancellation). Local aborts, the 20-second deadline, thrown transport errors and missing/lost responses cannot supply that proof, even if their exceptions contain a PostgreSQL-looking code. A definitive database rejection of the initial attempt allows correction and a fresh intentional request ID; a rejection after an uncertain attempt retains the lock because a prior attempt may already have committed. There is no automatic fallback from an Apple save to a legacy RPC. A missing Migration 14 RPC is a definitive failure; normal saves remain available after clearing/reselecting the draft as appropriate.

Leaving Add Visit while a save is in flight or uncertain is guarded through React Navigation's `usePreventRemove` plus the custom Back handler. The native-stack integration prevents supported iOS gesture dismissal and routes the cancelled dismissal through the same removal guard. Back, swipe, pop, replace and reset attempts present **Leave this save?** with two choices: **Stay and Keep Submission** closes the confirmation and preserves the entire frozen save; **Leave Anyway** warns that the visit may already be saved and reopening cannot safely retry it, disables the guard, and executes the deliberate removal. The confirmation does not initiate an automatic retry. Modal dismissal/Android Back stays on the form. Repeated attempts keep one confirmation and its original pending action. Late save responses cannot race deliberate abandonment into a different destination. Confirmed success or an initial confirmed rollback clears an open warning and permits ordinary navigation.

The guard is scoped to the form's account. Necessary account replacement/sign-out unmounts the keyed form and its Modal, releases its guard, and invalidates old confirmation callbacks; it does not require an abandonment confirmation. A success received in background is retained as completed. **Continue to Groups** navigates to the frozen destinations without saving again. Old-account callbacks cannot send under a new account, update replacement screens or navigate after unmount.

Retry identity is held in the existing form's memory. It survives blur/background/refresh, not closing the form, account replacement or process restart. If an uncertain form is abandoned, inspect that group's visits before starting a new intentional submission; do not treat a newly opened form as a retry. Operating-system termination, force quit, JavaScript reload/crash and other external unmounts cannot be intercepted by the navigation confirmation. No durable retry journal is added: after such an interruption, inspect the selected groups' visits before submitting again. Durable recovery across restarts is outside this milestone and no private drafts are written to device storage.

Authorized group details reuse the saved-ID lookup/map UI. **Look up saved Apple Place ID** is explicit: it reads the ID from the scoped RPC with a pinned account, invokes native identifier lookup, and rechecks the scoped ID and membership before displaying any result. A changed/cleared ID, changed entry, deletion/recreation, failed access check or account change discards the result. Group access polling removes completed transient results on access loss (up to the existing 15-second poll interval). Blur/background/refresh/route changes cancel pending work and clear completed previews. No lookup runs on mount/refocus/foreground automatically. No-ID, unsupported iOS, missing native modules, empty results, timeout and offline responses retain saved facts. iOS 18+ and an updated debug binary are needed for ID lookup; release builds expose no Apple picker/lookup and the save helper also strips unexpected IDs in release mode.

Deferred: replacing/removing IDs, standalone linking without a Visit, Apple deduplication, unified Add Place and the main saved-restaurants map.

## Local automated validation

The runner builds its own disposable PostgreSQL cluster with a private Unix socket, no TCP listener, cleared environment and synthetic users. It applies migrations 1–13, seeds historical receipts/Geoapify/personal/group data, snapshots data and catalog metadata, then applies 14 only inside that disposable database. Input files are hashed and checked unchanged. A sandbox that blocks PostgreSQL shared memory may require approval for this local test process.

```sh
node supabase/tests/validate_group_apple_place_ids.mjs \
  --postgres-bin /private/tmp/groupbite-m15-tooling/Postgres.app/Contents/Versions/17/bin \
  --pg-module /private/tmp/groupbite-m10-validation/node_modules/pg/lib/index.js
node tests/group-apple-place-ids.cjs
node tests/stabilization.cjs
node tests/personal-apple-place-picker.cjs
node tests/personal-apple-place-lookup.cjs
node tests/geoapify-form-wiring.cjs
node tests/apple-map-search.cjs
node tests/apple-map-search-native.cjs
node tests/navigation.cjs
node tests/auth-navigation.cjs
npx tsc --noEmit
npm run lint
git diff --check
git status --short
```

Use explicit paths to already installed local PostgreSQL and `pg` tooling on other machines. No runner downloads anything, reads `.env`, connects to the hosted project or calls Apple/Geoapify. New coverage includes preservation, privacy, exact legacy/Apple fingerprints, ID permissions, atomic rollback after the second group's write, Unicode/NUL validation, isolation guard, scoped lookup, Visit management, final deletion/recreation, actual address invalidation and Geoapify coexistence. Nine new real concurrency cases cover exact retries, duplicate-card prevention, first ID preservation, shared address edits in both orders, independent shared-row saves, edits into a match, competing owner fills, revocation and demotion. Four existing catalog concurrency cases plus lifecycle/catalog/personal Apple SQL regressions run after 14. Historical suites expecting pre-Migration-12 global reuse are not applicable to the current schema; focused current-schema Visit and Geoapify checks cover those interactions.

The client suite runs actual TSX screens, Supabase client and Apple adapter/map props with synthetic HTTP/native boundaries. It covers Back/swipe/removal confirmation, stay/exact retry, deliberate abandonment/reentry, in-flight and late responses, account-change/sign-out bypass, genuine-versus-local rollback provenance, initial correction/fresh request identity, conservative retries after earlier uncertainty, selection/no selection, existing entries, complete payloads, unknown outcomes before/after commit, multi-group exact retry after lifecycle resets, completed background saves, rejection classification, account switches, stale callbacks, group/entry privacy, pre/post lookup reauthorization, invalidation, cancellation, timeouts and development gates.

## Repeatable simulator acceptance recipes (disposable local data)

These are repeatable scratch-data recipes, not a checklist of manually passed results. The owner-confirmed hosted results above are the manual acceptance record. For further fault/concurrency/fixture testing use a **disposable local Supabase project** with migrations 1–14 and local test auth accounts. Point Expo's local environment at its local API/publishable key before running the app; do not perform these write-based steps with the repo's hosted `.env`. No further hosted writes or deployment are authorized by this guide update. Use a compatible iOS 18+ simulator and the existing local debug development build (`npm run ios` if rebuilding is needed, then `npm start -- --dev-client`). No Swift changes are required. Native Apple responses and opaque IDs can change; record the ID chosen from the native result rather than assuming a fixed test ID. Automated native tests use synthetic data.

1. Create local accounts **Owner O**, **Member M**, and **Outsider X**. As O create **16D Dinner A**; as M create **16D Dinner B**. Use each group's invite/approval flow so O and M are members of both. O owns A, M owns B. X belongs to neither.
2. As M open A → **Add Restaurant / Visit**. Enter name **16D User Cafe**, address **2760 Mowry Avenue, Fremont, CA 94538**, cuisine **Mexican**, visit date **2026-10-13**, rating **4**, would go again **Yes**, notes **16D Visit 1 user memory**. Choose A only. Open **Choose Apple Maps place (optional)** and search **Chipotle Mexican Grill, 2760 Mowry Avenue, Fremont, CA** in Businesses. Resolve a suggestion, verify its map, then explicitly tap its candidate card. Confirm **Apple Place ID selected**. User text must remain exactly as typed. Save: A has one card and one Visit; its entry has the selected ID. Apple names/addresses/coordinates must not be stored.
3. From A's card choose **Add Another Visit**. Facts are read-only. Enter notes **16D Visit 2 user memory**, optionally select a different Apple candidate, save. A still has one card, now two Visits; its original ID remains. Repeat without opening Apple: one card/three Visits, ID still unchanged. A repeated ID on a newly typed **16D Different Cafe** with the same address must create a separate card.
4. As M save **16D Manual Cafe**, address **100 Fixture Road, Fremont, CA**, notes **16D Manual Visit 1**, to **both A and B** with no picker selection. Each group gets one independent card/Visit and NULL ID. Reopen the same exact name/address form, select an Apple candidate and save notes **16D Multi Visit 2** to both groups. As an ordinary member of A, M leaves A's ID NULL; as B's owner, M fills B's ID. Both cards now have two Visits. Cuisine must not be overwritten and groups must not inherit each other's IDs.
5. As O add a real Visit to A's **16D Manual Cafe**, select a candidate and save notes **16D Owner fill Visit 3**. A's NULL ID is filled; B is unchanged. A subsequent owner Visit supplying another ID must keep A's first ID. No standalone link/replace/remove controls should exist.
6. Open A's **16D User Cafe** detail. No Apple request/marker should appear on opening. Tap **Look up saved Apple Place ID**. Confirm the saved ID was looked up, while saved user name/address and memories remain intact. Leave the screen, background the simulator or switch account while lookup is pending/completed: the preview must disappear, late responses must not restore it, and returning requires another explicit tap. As X, deep-link to the same group/entry route: no facts or lookup should be visible. A route using B's group ID with A's entry ID must also show no lookup.
7. Keep M on A's detail and start a lookup; remove M from A as O in another local client. Reauthorization must discard the pending native result. A completed preview must clear at the next access poll (within 15 seconds) or immediately on **Refresh Restaurant**. Switching O → X during a save preflight must issue no mutation under X; a late O response must not navigate X's screen.
8. In the simulator's React Native DevTools console, install the local-only fault snippet below and set its mode to **after** to lose the save response after the local server commits. Submit a selected-ID visit, notes **16D uncertain visit**, to both authorized groups. Wait for the transport error/deadline. Fields/groups must lock and **Retry Same Visit Save** appear. Background/foreground, blur/refocus and **Refresh Groups** must clear Apple preview without changing the frozen submission. Before retrying, tap **Back** and choose **Stay and Keep Submission**. Confirm the warning, unchanged fields/request identity, and no added request from the confirmation. On a compatible native-stack iOS simulator, attempt a full left-edge swipe-back; it must cancel dismissal and show the same confirmation. Choose Stay. Repeat with a navigation removal (pop/replace/reset) if exercising the navigator in DevTools. The fault fires once; retry: inspect requests to confirm identical account, endpoint, groups, fields, ID and request ID, and exactly one new Visit per group. Set its mode to **before** and repeat with a fresh intentional visit to drop the outgoing request before commit: the retry must produce exactly one Visit per group. Do not reopen the form for this retry check. In a separate after-commit fault case choose **Leave Anyway**, return to the group and inspect its visits: the original Visit should already exist. Reopen Add Visit and confirm no automatic retry; a new deliberate save has a new request ID. Also attempt Back during an in-flight response: Stay must preserve the outstanding submission; Leave Anyway must prevent a late response from navigating again. Open the confirmation and then perform a necessary account replacement/sign-out: the old confirmation must disappear and its callbacks must have no effect. A success returned while backgrounded must offer **Continue to Groups**, which issues no additional save.
9. Address invalidation is backend-only. In the **local scratch** SQL editor, find the precise entry/facts by group/name. Verify IDs before the update, update the underlying restaurant address to **200 Changed Fixture Road**, then refresh details: the saved ID must be NULL and old Geoapify metadata removed. A name edit or `SET address = address` must retain the ID. For a historical shared-row fixture, deliberately point B's matching test entry at A's Restaurant UUID using local admin SQL before editing; both IDs must clear, Visits/receipts must remain and a historical exact retry must not restore IDs. Never perform this fixture relinking on hosted data.
10. In a release/Android/unavailable-module test build, save a normal visit with the same user values: no Apple behavior is needed. A release build has no picker/lookup and sends the historical save RPC. Personal-place picker/lookup, Visit edits/deletes, membership/ownership management and ordinary name/address matching must continue working.

Exact one-shot local save fault injection for step 8 (DevTools console; this snippet refuses to forward save RPCs to hosted origins and stores only synthetic request bodies in transient memory):

```js
globalThis.__gb16dOriginalFetch ??= globalThis.fetch.bind(globalThis);
globalThis.__gb16dFault = "after"; // "before" for the no-commit variant
globalThis.__gb16dBodies = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const isSave = (init?.method ?? input.method ?? "GET") === "POST"
    && /^\/rest\/v1\/rpc\/save_restaurant_visit(?:_with_apple_place_id)?$/.test(url.pathname);
  if (!isSave) return globalThis.__gb16dOriginalFetch(input, init);
  if (!["http://127.0.0.1:54321", "http://localhost:54321"].includes(url.origin)) {
    throw new Error("16D fault acceptance requires the local scratch API on port 54321");
  }
  globalThis.__gb16dBodies.push(init.body);
  const fault = globalThis.__gb16dFault;
  globalThis.__gb16dFault = null;
  if (fault === "before") throw new TypeError("Synthetic request loss before commit");
  const result = await globalThis.__gb16dOriginalFetch(input, init);
  if (fault === "after" && result.ok) throw new TypeError("Synthetic response loss after commit");
  return result;
};
```

Submit and retry from the same form, then evaluate `__gb16dBodies[0] === __gb16dBodies[1]` (must be `true`). Inspect local Visits to confirm one addition per selected group. For the next variant reset `__gb16dBodies = []` and `__gb16dFault = "before"` before a new intentional form. Restore `globalThis.fetch = globalThis.__gb16dOriginalFetch` and delete these three `__gb16d*` properties afterwards. The automated client suite also tests a 20-second stall with ignored cancellation; a plain offline toggle alone cannot prove the after-commit variant.

For the rollback acceptance variant, return a genuine local-server/PostgREST error body with code `40P01`, `40001` or `57014` (the automated suite injects these HTTP responses without changing SQL). On an initial rejection, verify the form permits changing notes to **16D corrected rollback visit** and a new Save generates a fresh request ID. Repeat with a committed lost response first, then the rollback response on retry: fields must stay frozen, Back/swipe must still offer the warning, and a subsequent retry must reuse the original request ID. Throwing a local abort or reaching the local deadline must retain the uncertain-save path rather than unlock the form. Never make hosted database changes to provoke these errors.

Example local-only address check (the group/name fixtures must be unique in your scratch database):

```sql
select g.name as group_name, gr.id as entry_id, gr.restaurant_id, gr.apple_place_id, r.address
from public.group_restaurants gr
join public.groups g on g.id=gr.group_id
join public.restaurants r on r.id=gr.restaurant_id
where g.name in ('16D Dinner A','16D Dinner B') and r.name='16D User Cafe';

update public.restaurants r set address='200 Changed Fixture Road'
where r.id in (
  select gr.restaurant_id from public.group_restaurants gr join public.groups g on g.id=gr.group_id
  where g.name='16D Dinner A' and gr.restaurant_id=r.id and r.name='16D User Cafe'
);
```

Original local verification: **124 named offline checks** passed across the eight client/native suites listed above, including **16 new group Apple checks**. The disposable database runner passed its preservation/catalog comparison, focused SQL, NUL/isolation checks, **9 new + 4 existing actual concurrency cases**, and three current-schema SQL regression suites. TypeScript, ESLint and `git diff --check` passed. Git confirmed `main` at `82afb041363966e604927b21720aba552cb93b12`, an empty staging index, and migrations 1–13 byte-for-byte identical to HEAD. The database runner shut down its server and removed its owned fixture directory.

## Independent-audit corrections (H1/M1)

The initial independent read-only audit blocked the draft on unguarded uncertain-save navigation and incomplete rollback classification. This correction changes only these files relative to that audited local draft:

- `app/(app)/add-visit.tsx`: account-scoped removal guard, warning Modal, stay/deliberate-leave actions, late-result suppression after abandonment, and clear confirmed-rollback feedback.
- `lib/group-visit-save.ts`: HTTP-response provenance for definitive errors plus PostgreSQL `40P01`, `40001`, `57014`; local/transport exceptions remain uncertain.
- `tests/group-apple-place-ids.cjs`: eight new named regression checks, covering Back/fallback/iOS-pop/replace/reset, stay/exact retry, in-flight saves, abandonment/reentry, account changes/sign-out, initial rollback/fresh attempts, earlier uncertainty/later rejection, local aborts and late rollback responses after timeout.
- `tests/personal-places.cjs`: minimal Modal/navigation-guard test boundary used by the actual TSX screen tests.
- `supabase/tests/group_apple_place_ids.sql`: explicit **exactly one matching restaurant card in each destination group** for legacy retry, multi-group retry and repeated owner/member saves.
- `supabase/tests/group_apple_place_ids_concurrency.mjs`: exact per-destination card-count assertions in the existing real race cases.
- This review guide: corrected lifecycle/rollback contracts, acceptance steps and process-termination limitations.

Migrations **1–14 are byte-for-byte unchanged from the correction start**. The pre-deployment correction run did not apply Migration 14; its subsequent deployment is owner-confirmed above. There is no SQL-contract change or newly demonstrated migration defect. No production files outside the Add Visit screen/save helper were changed for these corrections.

Correction validation passed: **78 named focused checks** across updated group Apple (24), navigation (12), stabilization (6), authentication/navigation (11), and Geoapify form wiring (25). The disposable SQL runner passed its strengthened exact-card assertions, preservation comparison, **9 new + 4 existing actual concurrency cases**, NUL/isolation checks and three current-schema SQL regressions. TypeScript, ESLint, tracked/new-file whitespace checks, migration hash checks and the empty staging-index check passed. The temporary PostgreSQL server was stopped and its fixture directory removed. These are historical correction-run results, not a fresh database run for this documentation update. Native swipe/Modal rendering and the pre-request fault path have since passed the owner-confirmed simulator checks above. These fixes address H1/M1 locally; an independent re-audit is separate from automated checks. Manual after-commit response loss, release-binary acceptance and the separate hosted RLS provenance task remain open.


## Final local review (2026-10-15)

Only this guide was edited during this review. No hosted requests, migration deployment, staging, commits or pushes were performed.

- **143 named offline checks passed** in nine focused suites: group Apple (24), navigation (12), stabilization (6), authentication/navigation (11), personal Apple picker (14), saved personal Apple lookup (9), Geoapify form wiring (25), Apple search client (24), and Swift engine with fake MapKit (18). These test boundaries use synthetic HTTP/native responses and do not verify hosted or live Apple behavior.
- **TypeScript** (`npx --no-install tsc --noEmit`), **ESLint** (`npm run lint`), syntax checks for the changed client harness/tests and SQL runner/concurrency JavaScript, and tracked/untracked whitespace checks passed. The changed-file credential-pattern scan found no matches.
- Reviewed all **17 changed/untracked files** for scope and security. No unrelated implementation changes or new security regressions were identified. Save account pinning/frozen retries, scoped lookup reauthorization, development gates, SQL permissions, per-group exact matching, transactional receipts and address invalidation remain consistent with the approved contract. This local review does not establish hosted schema provenance.
- **SQL/concurrency suites were not rerun in this final review.** The earlier disposable-run results above remain historical: the temporary PostgreSQL installation is missing `share/postgresql/postgres.bki`, and its separate temporary `pg` module is gone. Restoring complete local-only tooling is required for another database run; no hosted fallback or tool download was attempted.
- Migrations **1–13 match HEAD byte-for-byte**. Migration 14 is unchanged from the independently reviewed file; SHA-256: `389641b84c8da214d5e50f2a98501595c35a394e8823461437f24c1492c9a3ea`.
- Git remains on **`main` at `82afb041363966e604927b21720aba552cb93b12`**, with **9 modified tracked files, 8 untracked files, and an empty staging index**. The complete file list is above. The two stale README deployment summaries and remaining manual/provenance work are recorded under limitations; no other blocker was found in this local review.
