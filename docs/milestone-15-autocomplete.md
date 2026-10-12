# Milestone 15: prepared native address autocomplete

Real requests remain OFF by default. `lib/address-search.ts` keeps the production
gate `GEOAPIFY_AUTOCOMPLETE_ENABLED = false`. A separate explicitly enabled iOS
development test is restricted to Taylor's configured Auth UUID; it never enables
release builds. With no opt-in, Add Visit and Personal Places select `mode="mock"`:
development builds show fictional fixtures, release builds keep manual entry.
No production function, quota, Taylor-only restriction, migration or permission
changes are part of this work.

The hook mounts inside each existing account-keyed form and creates one adapter
only for the opt-in iOS test (or a future reviewed development code gate).
Android/web retain mock/manual mode for this test. It reuses `supabasePublicConfig` (the app's existing public URL
and publishable key) and reads the current Auth-provider session through a ref.
Loading, Auth errors, account mismatch and unmounted callbacks return no session.
Token refresh updates the getter without reconstructing the adapter. Rerenders
and create-form focus/background cycles retain the adapter's rate-limit cooldown;
the component still cancels pending work and discards transient selection state
through the existing form lifecycle. No autocomplete adapter is constructed with
both the code gate and development opt-in disabled. The two test settings below
are public opt-in configuration, never backend credentials.

## Typed suggestion adapter

`createGeoapifyAddressSearch` in `lib/geoapify-address-search.ts` creates a stable
`AddressSearch` function. It accepts the public HTTPS hosted Supabase project URL,
an `sb_publishable_` client key, and a synchronous `getSession()` getter over the
**current** Auth-provider session. The getter must return the current session or
null without making requests; do not close over a stale session/token. The adapter
does not import Supabase app configuration; its development guard reads only the
two public test settings through `lib/geoapify-dev-test.ts`. Only the public
client key and user's JWT enter the native app; provider, signing and service-role
secrets must never enter it.

After the development/build gate, input/config/session validation precedes a single POST
to `/functions/v1/geoapify-suggest`, with `apikey`, the session bearer JWT and
exactly `{action:"suggest",query}`. No direct provider, Auth-refresh, quota,
attachment, persistence or retry request is made. Auth-server verification,
Taylor's allowlist and committed quota confirmation remain exclusively server-side.
Client token checks are format/expiry checks, not proof of authentication.

The caller's AbortSignal and a 15-second client deadline cover Fetch and complete
body processing. This client deadline never replaces or extends the server's
800 ms admission/confirmation-to-dispatch budget. RN `text()` is used for
compatibility with native Fetch implementations without readable streaming bodies;
Content-Length is checked first, and buffered JSON is limited to 64 KiB of UTF-8.
Cancellation/timeouts ignore late results even if Fetch ignores abort. They cannot
refund a reservation or prove that provider work did not already occur. Never
automatically retry an ambiguous failure.

The adapter checks account/token identity both after headers and after the body,
discarding results on sign-out, account switch or token change. A token refresh
may conservatively discard a result; it never replays the request. Each stable
adapter remembers bounded `Retry-After` guidance (seconds or HTTP date) from 429
and provider-throttle 503 responses. During that cooldown, edits make no requests;
there is no timer-triggered retry. Use one stable adapter for a form/session,
sharing it where appropriate so rerenders do not reset cooldown state. Preserve
the current account-keyed form remounts and lifecycle cancellation.

Successful responses must match the production contract, including fixed safe
attribution links and zero to five US/building suggestions with valid coordinates,
opaque selection receipts and future expiry. Unknown fields are discarded. Address,
coordinates, receipt and expiry are preserved exactly in transient selection state.
The client checks syntax/expiry but does **not** verify signatures or treat a
receipt as authorization. Errors expose only safe messages; raw HTTP error bodies,
exceptions, JWTs, address queries and receipts are neither logged nor reflected.

## Temporary server diagnostics (disabled by default)

The production entry point enables these diagnostics only when the server setting
`GEOAPIFY_DIAGNOSTICS_ENABLED` is exactly `true`. Missing values, `false`, different
case and whitespace keep them off. Neither request fields/headers nor the public
native test flags enable diagnostics. Events begin only after real Supabase Auth
verification and the existing Taylor-only allowlist check. Unauthorized users
emit no diagnostic events. This does not authorize anyone else to make requests.

Each event contains only the fixed `geoapify_suggest_v1` tag, a newly generated
random invocation UUID, fixed event/phase names, bounded elapsed milliseconds,
and (for failures) one fixed outcome: `deadline`, `parent_cancelled`,
`handled_error` or `unexpected_error`. The UUID is unrelated to users,
reservations or client identifiers and is not added to response headers/bodies.
No request/response objects, exception text, keys, tokens, addresses, URLs,
headers, bodies, coordinates or receipts enter the logger. Logger/ID failures
are ignored without fallback logging. There is no log-delivery wait, retry,
additional network destination or new deadline. Logging time still counts
against the original dispatch budget; the last permit check remains immediately
before the sole provider attempt.

After a separately approved deployment, investigate **one** controlled request:

1. Keep the server allowlist, production feature gate, quotas and all deadlines
   unchanged. Explicitly enable only the server diagnostic setting for the test
   window. This requires deploying the updated function first; this change has
   not deployed it or read/set any hosted setting.
2. Use the existing explicitly enabled iOS development mode as Taylor. Enter a
   non-sensitive public building address, press **Search address once** once,
   then keep the field/form/app active until completion. Do not edit, blur,
   background, reload or retry the request. Record only its time, HTTP status,
   latency and known safe error code; do not enable full HTTP/payload tracing.
3. Find `geoapify_suggest_v1` events in the corresponding deployed function's
   runtime logs. Group by their generated invocation UUID and correlate platform
   execution/deployment identifiers and timestamps with the gateway/shutdown
   event. Do not copy credentials or request/response payloads from other logs.
4. Disable the server setting immediately afterwards (`false` or remove only
   this setting), and turn off the native development test opt-in. An ambiguous
   failure still consumes its reservation and may consume a provider credit;
   never automatically retry or refund it.

Interpret the last phase together with the terminal event:

| Evidence | Meaning |
| --- | --- |
| `confirmation_complete` | The separate committed-row readback returned true. |
| `provider_headers_wait` | The handler entered the provider fetch phase; the final permit guard can still reject dispatch. This event alone does not prove traffic reached Geoapify. |
| `provider_headers_received` | Fetch returned provider response headers. No headers or their values are logged. |
| `provider_body_read` then failure | Body reading/JSON decoding failed or was interrupted. |
| `provider_body_complete` | Bounded body reading and JSON decoding completed; suggestion validation is still pending. |
| Failure outcome `deadline` | The provider's original five-second timer fired first. The failure's phase separates waiting for headers from reading the body. |
| Failure outcome `parent_cancelled` | The handler observed request cancellation. This does not identify which client/network/platform component initiated it. |
| `response_processing` then failure | Suggestion validation, receipt signing or response construction failed; only a bounded category is logged. |
| `response_ready` | The successful response was constructed immediately before handler return. This does not prove gateway/client delivery. |
| Terminal `failure` event | The handler constructed its existing safe error response. A gateway error with different content can still replace it. |
| No terminal event plus correlated runtime/gateway error | Possible runtime interruption or lost response/log delivery; missing logs alone cannot prove the cause. |

Only a reviewed, correlated invocation can support a diagnosis. These events
cannot control Supabase's independent gateway/outbound tracing or guarantee log
delivery during termination. The provider key remains in its header, but the
provider URL necessarily contains the address query; existing hosted tracing
risks remain. Remove the temporary diagnostic setting and instrumentation once
the investigation is complete; do not change the allowlist or quotas with it.

## UI and saved-location boundary

The component retains explicit-edit-only lookup, the three-character threshold,
400 ms debounce, cancellation, generation-based stale-result protection, manual
entry and hidden coordinates. Opt-in development mode adds **Search address once**:
typing alone never searches, and an explicit press arms the same 400 ms debounce.
The button blocks repeat presses for the current search until another address edit.
Real mode uses `mode="geoapify"` and the authenticated adapter. It
shows sign-in/access/rate-limit/failure guidance without disabling address entry.
Every edit clears selection metadata. An expired result cannot be selected.
Geoapify and OpenStreetMap attribution links are visible for real results,
including empty responses and selected addresses during saving. URLs are fixed;
the app never opens arbitrary provider-returned links.

Existing personal and Visit saves continue sending their original fields and
request IDs; only the selected address string enters those payloads. Receipts and
coordinates remain in disposable UI state, not drafts, storage or save RPCs. Save
completion still does not mean a saved location is resolved.

Migration 8's attachment functions are service-only and check membership/ownership,
entry identity, address and personal revision. Migration 9 binds original group
save entry IDs. The production receipt verifier has no public attachment action.
A future separately approved server endpoint must authenticate again, verify the
receipt/account/address/time and provider result, meter any further provider call,
and perform the existing SQL authorization checks. Never grant mobile attachment
permissions or write returned coordinates directly. None of this persistence flow
is implemented or inferred by the prepared autocomplete adapter.

## Controlled iOS development test

This implementation has made no hosted calls. Leave the production gate false,
the Free plan, quotas and server-side `GEOAPIFY_ALLOWED_USER_ID` unchanged. No
server deployment or migration is needed. The client allowlist is a convenience
guard; only the existing Auth-verified server allowlist proves Taylor is allowed.
Changing the public test UUID cannot authorize another user at the server.

`EXPO_PUBLIC_GEOAPIFY_DEV_TEST` must be exactly `true` and
`EXPO_PUBLIC_GEOAPIFY_DEV_USER_ID` must be Taylor's UUID. Missing/invalid settings
fail closed to mocks/manual entry. No real UUID is embedded in source. These
values enter the public bundle; never substitute an API key, JWT, signing or
service-role secret. Use Taylor's independently known Auth/profile UUID, matching
the approved server account, not a name/email or caller-supplied JWT claim.

All adapters share a limit of **three dispatched client attempts per JavaScript
run**, across both forms, backgrounding, remounts, sign-out and token refresh.
Errors, timeouts and cancellation after dispatch spend an attempt permanently
for that run. Local validation/cancelled debounce/Retry-After rejections do not.
There is no automatic retry, cap reset API or request triggered by typing/focus.
This cap counts Edge requests, not confirmed Geoapify credits. A JS reload,
process restart or Fast Refresh may reset it; server quotas remain authoritative.
Do not reload simply to replay a failed or ambiguous request.

Manual steps for the owner, when ready to make the first real request:

1. Confirm the previously deployed server restriction remains Taylor-only and
   the existing public Supabase URL/publishable key point to the intended project.
   Verify hosted tracing/export redaction before testing: headers contain keys
   and JWTs, provider URLs contain address queries, and responses/receipts contain
   address/user data. Keep network debugging/session recording off; never print
   credentials or response receipts. These platform settings remain unverified
   by local tests. Choose a public building address, not a private home address.
2. Stop the current Expo/Metro process. Start a fresh iOS development session:

   ```sh
   EXPO_PUBLIC_GEOAPIFY_DEV_TEST=true \
   EXPO_PUBLIC_GEOAPIFY_DEV_USER_ID='REPLACE_WITH_TAYLOR_AUTH_UUID' \
   npm run ios -- --clear
   ```

   Replace only the nonsecret UUID placeholder. The usual ignored local public
   Supabase config can remain; do not add any new backend/provider secrets.
3. Sign in as Taylor. Open My Places → Add Personal Place (or editable Add Visit).
   The **Development Geoapify test** notice and **Search address once** button
   must appear. If they do not, stop and check config/account; do not change the
   code gate or server permissions. Existing shared Restaurant addresses stay locked.
4. Paste one complete public US building address, wait, and check no suggestions
   appear until you press **Search address once**. Press once, wait for completion.
   Pass: up to five validated address suggestions or an honest empty result,
   Geoapify/OpenStreetMap attribution, editable manual fallback, and no repeat
   search after selection, focus/background or other field edits. Choose a result;
   editing its text clears the transient selection. Do not automatically retry a
   failure; record only the safe error code/message and stop.
5. Only after reviewing the first result, deliberately test the other form using
   one additional button press if needed. Existing saves send only their original
   fields/address text. Saving coordinates/receipts and map pins is not implemented.
   Independently verify the expected quota reservation through the existing
   approved owner workflow; a client result alone does not establish persistence.
   Any automatic repeats, wrong-account real success, unexpected quota use,
   credential logging or release-mode real lookup is a failure: stop testing.
6. Disable the mode: stop Metro and restart with the explicit off setting:

   ```sh
   EXPO_PUBLIC_GEOAPIFY_DEV_TEST=false npm run ios -- --clear
   ```

   Verify the real-test notice/button is gone and default mocks are back. Release
   builds remain manual even if the public settings were accidentally present.
   Disabling future client requests cannot cancel already dispatched work.

Production activation or verified attachment is a separate approved change.

## Offline validation

Tests simulate opt-in settings and future code gates only inside isolated VMs,
with synthetic sessions and mocked HTTP. The checked-in gate stays false. No secret files,
hosted services or provider credits are used.

```sh
node tests/geoapify-address-search.cjs
node tests/geoapify-dev-test.cjs
node tests/geoapify-form-wiring.cjs
node tests/address-autocomplete.cjs
node tests/personal-create-draft.cjs
node tests/personal-places.cjs
node tests/navigation.cjs
node node_modules/typescript/bin/tsc --noEmit
```
