# Milestone 15: prepared native address autocomplete

Real requests remain disabled. `lib/address-search.ts` contains the reviewed code
gate `GEOAPIFY_AUTOCOMPLETE_ENABLED = false`; neither configuration nor a form prop
can enable networking. Add Visit and Personal Places now use `useAddressSearch`,
which still selects `mode="mock"` while this gate is false:
development builds show fictional fixtures, release builds keep manual entry.
No production function, quota, Taylor-only restriction, migration or permission
changes are part of this work.

The hook mounts inside each existing account-keyed form and creates one adapter
only when the separately approved gate is enabled on iOS or Android. Web retains
mock/manual mode. It reuses `supabasePublicConfig` (the app's existing public URL
and publishable key) and reads the current Auth-provider session through a ref.
Loading, Auth errors, account mismatch and unmounted callbacks return no session.
Token refresh updates the getter without reconstructing the adapter. Rerenders
and create-form focus/background cycles retain the adapter's rate-limit cooldown;
the component still cancels pending work and discards transient selection state
through the existing form lifecycle. No autocomplete adapter is constructed with
the checked-in gate disabled. No new environment variables are needed.

## Typed suggestion adapter

`createGeoapifyAddressSearch` in `lib/geoapify-address-search.ts` creates a stable
`AddressSearch` function. It accepts the public HTTPS hosted Supabase project URL,
an `sb_publishable_` client key, and a synchronous `getSession()` getter over the
**current** Auth-provider session. The getter must return the current session or
null without making requests; do not close over a stale session/token. The adapter
does not import app configuration or read environment variables. Only the public
client key and user's JWT enter the native app; provider, signing and service-role
secrets must never enter it.

After the disabled gate, input/config/session validation precedes a single POST
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

## UI and saved-location boundary

The component retains explicit-edit-only lookup, the three-character threshold,
400 ms debounce, cancellation, generation-based stale-result protection, manual
entry and hidden coordinates. Real mode is prepared through `mode="geoapify"`
and the authenticated adapter, but is currently blocked by the code gate. It
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

## Before enabling real requests

1. Review this code gate change separately. Keep the production Taylor-only guard
   intact and conduct the first UI test using Taylor's verified account.
2. Review the native wiring in `hooks/use-address-search.ts` and the two forms.
   Keep web in mock/manual mode: browser Origin/CORS remains rejected by the
   production function. Confirm the existing public app URL and publishable key
   are configured; never put Geoapify, signing or service-role keys in the app.
3. Flip the shared code gate only after approval. Run the local regressions below;
   then verify one controlled native request, attribution/link behavior, manual
   fallback, cancellation, account lifecycle, quota-denial UX and no retries.
   Cancelling typing can still consume committed quota. Do not relax limits or
   Taylor's restriction to make a UI request succeed.
4. Confirm production header/body tracing redaction. Provider keys are in
   `x-api-key`, address queries remain in provider URLs, Supabase headers contain
   credentials, and suggestions/receipts carry address/user data. Local tests do
   not establish hosted tracing safety or native-device Fetch behavior.

Keep the Free plan, existing caps and manual saves. Reverting the shared code gate
to false disables future client requests but cannot cancel already dispatched
work; provider/server shutdown remains a separate approved operation.

## Offline validation

Tests simulate the future enabled code only inside an isolated VM, with synthetic
sessions and mocked HTTP. The checked-in gate stays false. No secret files,
hosted services or provider credits are used.

```sh
node tests/geoapify-address-search.cjs
node tests/geoapify-form-wiring.cjs
node tests/address-autocomplete.cjs
node tests/personal-create-draft.cjs
node tests/personal-places.cjs
node tests/navigation.cjs
node node_modules/typescript/bin/tsc --noEmit
```
