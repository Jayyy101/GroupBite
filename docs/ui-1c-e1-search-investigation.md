# UI 1C-E1 — persistent first-search investigation

## Current outcome — October 20, 2026

The first-search failure was traced to an unchanged TextInput event cancelling
the pending lookup during keyboard dismissal. UI 1C-E2 added an early-return guard
so unchanged input leaves the active request and results intact. The user confirmed
the first-tap fix on the iPhone 16 Pro simulator. The connected autocomplete dropdown
was subsequently implemented, refined and approved through simulator testing.

Temporary Swift tracing was removed before commit by restoring the native module
to its pre-UI-1C committed version; development-only, default-off JavaScript
diagnostics and their regression tests remain. An installed build containing the
old native tracing needs an iOS rebuild to remove it.

The E1/E2 sections below are historical snapshots retained for reference. Their
pending statuses and native tracing instructions describe those investigation
stages, rather than the current implementation.

## E2 follow-up — confirmed cancellation and focused fix

The user confirmed the on-device sequence: Search dispatch, keyboard hide,
`ui:input-change` with `changed:false`, pending input-change cancellation, then
`adapter:search:finish:cancelled`. A second tap succeeded with five results.

RestaurantSearch now returns before cancellation or state changes for an unchanged
input value. Genuine changes retain their existing cancellation path. The focused
regression simulates keyboard hide and unchanged input during the first lookup,
then verifies five results, one request, unchanged generation and no native reset
or cancellation; it also verifies unchanged events preserve displayed results.
A separate regression verifies actual edits still cancel and reject late replies.
No further native/adapter change or suggestion dropdown is part of E2.
E2 validation passed all 170 relevant offline checks, TypeScript, lint and whitespace
checks. The confirmed-sequence regression failed before the guard and passed after it.

The E1 sections below retain the original investigation record and diagnostics
instructions. The E2 fix still needs the ordinary simulator confirmation.

## E1 investigation status at capture

Status: awaiting an instrumented iPhone 16 Pro reproduction. No additional
production search fix or dropdown implementation has been made. UI 1C-A/B/C/D
remain uncommitted and preserved.

## Findings and limits

- Add owns no search result state: RestaurantSearch owns its input, debounce,
  requests, suggestions, results and errors. Add owns recent choices and recovery;
  recovery can replace the entire search component, which is now observable.
- Typing schedules completion after 400 ms. Search cancels that timer/current
  request, resets the shared native session and starts an independent full lookup.
  Suggestion selection preserves cached native completion handles before resolving.
- Every accepted full reply sets either candidates or a completed-empty message;
  current failures set an error. Stale or cancelled replies intentionally do not.
  The native deadline is 8 seconds; the adapter deadline is 10 seconds.
- Native complete/search/reset calls run on Expo's main queue and share one native
  session. A reset from another mounted search consumer or lifecycle event can
  affect that session. This is an investigation path, not an established cause.
- The page already uses handled keyboard taps. The harness invokes onPress
  directly; Keyboard.dismiss only increments a counter. It does not emulate
  UIKit focus/text events, responder arbitration, keyboard layout animations,
  Expo bridge ordering, actual MapKit, or cold provider behavior. The Swift suite
  compiles the real session against Foundation-only doubles, without those layers.
- Cold and subsequent requests both succeed with deterministic replies. Injecting
  a same-value onChangeText event during full Search cancels the lookup and clears
  feedback. No evidence yet establishes that UIKit emits this event in the reported
  sequence. That behavior has deliberately not been changed.
- This sandbox could not connect to CoreSimulatorService. No actual simulator
  reproduction, native rebuild, or live provider request was performed here.

## Enable and inspect diagnostics

JavaScript tracing is opt-in and development-only. It records event names,
sequence/time, numeric request/scope/generation identifiers, counts, booleans and
layout measurements. Native tracing uses DEBUG-only NSLog. Neither records query
text, restaurant facts, coordinates, Apple Place IDs, accounts, tokens or raw errors.

1. From the repository, start Metro in a terminal, without editing `.env`:

   ```sh
   EXPO_PUBLIC_GROUPBITE_SEARCH_DIAGNOSTICS=1 npm start -- --dev-client --clear
   ```

2. Rebuild the development client once to include the native trace statements.
   In another terminal, select the iPhone 16 Pro simulator:

   ```sh
   npx expo run:ios --device --no-bundler
   ```

   JavaScript reload alone cannot install the new Swift instrumentation. Open
   this project in the development client connected to the Metro terminal above.

3. Inspect `[GroupBiteSearch]` JavaScript messages in React Native DevTools Console
   (press `j` in Metro), filtering on `GroupBiteSearch`. Metro may also forward them.
   In a separate terminal, inspect actual native session events:

   ```sh
   xcrun simctl spawn booted log stream --style compact --level debug --predicate 'eventMessage CONTAINS "[GroupBiteSearch/native]"'
   ```

   The Xcode debug console is an alternative for native NSLog output. The
   adapter's numeric `request` matches native `request`; the UI's `scope` identifies
   its mounted search component and `generation` identifies replacements.

4. Cold-launch the app, retaining all storage and account state:

   ```sh
   xcrun simctl terminate booted com.anonymous.GroupBite
   xcrun simctl launch booted com.anonymous.GroupBite
   ```

   This restarts the app process; it does not clear system/provider caches.
   Open the project in the development client if its launcher appears. Use an
   existing clean Add landing; do not clear or abandon recovery for this test.

5. Type `McDonalds`, wait for suggestions, then tap Search exactly once with the
   keyboard visible. Do not select a suggestion, tap again or change the text for
   at least 12 seconds. Note whether loading, candidates, empty feedback or an error
   appears. Scroll the page to check for feedback outside the initial viewport.
6. Clear the input and repeat `McDonalds` in the same process. Then clear and try
   `Chipotle`. Cold-launch again with `Chipotle` first, followed by `McDonalds`.
   This separates a cold-start effect from a query-specific result difference.
7. Repeat a cold run with the keyboard dismissed before the single Search tap.
   Note whether suggestions were settled or still loading, and whether this run
   differs from the keyboard-visible run. Keep each run's UI and native logs together.

Tracing may affect timing. Compare with the known uninstrumented reproduction.
Restart Metro without the environment flag to disable JavaScript diagnostics;
native metadata remains DEBUG-only until the temporary instrumentation is removed.

## Read the first failing boundary

| Trace evidence | Meaning / next investigation |
| --- | --- |
| No `ui:button-press` | The Search handler did not run. Compare press-in, focus/blur, disabled state and native touch behavior. |
| `ui:blocked:lifecycle` or `ui:blocked:duplicate` | A guard prevented dispatch; inspect the preceding lifecycle/request events. |
| `adapter:search:dispatch`, no native `search-enter` | First verify the rebuilt binary. Then inspect bridge delivery, rather than assuming MapKit returned no results. |
| Native `search-start` then reset/cancel/discard for that request | A session replacement/cancellation interrupted it. Correlate UI scope/generation and reset-dispatch events. |
| `ui:input-change` with `changed:false`, then pending input-change cancellation | Confirms the injected same-value cancellation case occurred on-device. Only then propose ignoring unchanged input events. |
| Native reply count greater than deliver count | Native location validation filtered results. No locations are invented to fill missing facts. |
| Native deliver, adapter native-reply, then current UI error | Inspect validation/error classification; adapter success precedes result validation. |
| `ui:discard:result` or UI error with `current:false`/`aborted:true` | A response was superseded; use generation and cancellation events to identify why. |
| `ui:accept:search`, then `ui:state` with candidates greater than zero | Results reached committed UI state. Inspect results-layout/root-layout, scrolling and keyboard geometry if cards remain unseen. |
| Accepted count zero / native search-error / timeout | Distinguishes completed-empty, provider failure and stalled lookup. `ui:state.error` and error-layout show feedback rendering. |
| Search unmount plus changed `landing:state` | Inspect route/recovery replacement; a provider or landing transition hid the search surface. |

The smallest proposed next step is to capture this boundary on-device. There is
not yet enough evidence for another search behavior fix. A corrective patch should
target only the first demonstrated failing boundary, with a reproducing test.

## Compact suggestion dropdown feasibility — not implemented

Feasible as a presentation change. Keep completion and full-search request paths
separate. Place suggestions immediately below the input, retain native completion
handles, and resolve a tapped suggestion into explicit full-address candidates;
do not silently select the first match. Full results remain larger vertical cards.

Prefer a compact in-flow list in the existing vertical page initially: it retains
handled taps and avoids overlay clipping, stacking and modal focus changes. If a
bounded overlay is required, measure its anchor against keyboard/safe areas and
verify nested gestures and VoiceOver focus order. Keep name/address announcements,
comfortable targets, loading/empty/error announcements, manual entry, explicit
Search and cancellation semantics. Actual keyboard and accessibility acceptance
must be checked on-device after the reliability investigation.

## Validation performed

All 187 offline checks passed:

| Command / suite | Checks |
| --- | ---: |
| `npm run test:navigation` | 38 |
| `npm run test:auth-navigation` | 12 |
| `npm run test:personal` | 15 |
| `node tests/m18-ui-usability.cjs` | 11 |
| `require('./tests/unified-add.cjs').run('search')` | 8 |
| `node tests/apple-map-search.cjs` | 24 |
| `node tests/personal-mapkit-persistence.cjs` | 11 |
| `node tests/personal-location-repair.cjs` | 18 |
| `node tests/unified-add-recovery.cjs` | 21 |
| `node tests/restaurant-search-ordering.cjs` | 7 |
| `node tests/apple-map-search-native.cjs` | 18 |
| `node tests/search-diagnostics.cjs` | 4 |

TypeScript (`tsc --noEmit --incremental false`), lint (`npm run lint -- --no-cache`)
and `git diff --check` passed. Diagnostics tests cover development/release gating,
metadata privacy, cold/subsequent dispatch observation, injected same-value
cancellation and post-bridge validation failure. The Swift test uses doubles;
it does not establish an Expo/iOS build or real MapKit acceptance.
