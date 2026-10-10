# Temporary Milestone 15 hosted probe

Function name: `geoapify-suggest-probe`. It imports the unchanged production
handler directly, never its production entry point. Nothing in production imports
this directory, reads its allowlist, or recognizes its fault modes.

No deployment or hosted test has been performed by this implementation.

## Network boundary

Each invocation has its own restricted Fetch adapter. Native Fetch can receive
only these exact HTTPS endpoints on the configured 20-character
`https://<project-ref>.supabase.co` origin:

- `GET /auth/v1/user`
- `POST /rest/v1/rpc/reserve_geoapify_request`
- `POST /rest/v1/rpc/confirm_geoapify_request`

Queries, fragments, URL credentials, redirects, other paths/origins/methods, and
Request objects are rejected. Headers/options are rebuilt before forwarding.
Only the configured disposable account, verified by real Auth, can reserve.
Confirmation must use that account and the exact reservation ID/expiry.

The exact Geoapify autocomplete URL is intercepted in memory and returns
`{"results":[]}`. Its only permitted query fields are `text`, `filter`, `lang`,
`limit`, and `format`, with the production fixed values. Authentication must be
the sole `x-api-key` header containing the public synthetic provider value; URL
keys, extra headers, duplicate parameters, and other key values are rejected.
It NEVER reaches native Fetch, has no network fallback, and can
be reached only once after real matching confirmation within the original
800 ms budget. All other destinations fail closed. Provider and signing values
are public synthetic fixtures used only to satisfy the existing handler's config
validation; empty suggestions generate no selection receipts. Real Geoapify and
selection-signing secrets are never read. No new dependency or migration is needed.

The adapter reads complete bounded Auth/RPC JSON before returning a reconstructed
response to the handler, retaining transaction headers. This observation and all
fault delays remain inside the handler's existing deadlines. No timers, limits,
refunds, retries, app payloads or production configuration are changed.

## Setup and later manual test

After review and separate deployment authorization:

1. Confirm hosted migrations 9–10 and use a disposable signed-in user with a
   profile. Set **only** the nonsecret environment value `GEOAPIFY_PROBE_USER_ID`
   to its UUID using the approved project workflow. Missing/invalid setup fails
   before any network work. Supabase's existing server-only `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are required at runtime;
   never paste them into source, chat, shell arguments or logs. Do not provision,
   change or use a real Geoapify/signing key for this probe.
2. Verify `verify_jwt=true` for **this** function. Deploy only the named probe to
   the explicitly approved project; do not bulk-deploy functions or use
   `--no-verify-jwt`:

   ```sh
   supabase functions deploy geoapify-suggest-probe --project-ref <approved-project-ref>
   ```

3. Invoke `/functions/v1/geoapify-suggest-probe` from a private terminal, without
   browser `Origin`, using the project client key in `apikey`, a current user JWT
   in `Authorization: Bearer <JWT>`, `Content-Type: application/json`, and exactly
   `{"action":"suggest","query":"100 Market"}`. Enter credentials through hidden
   prompts or your approved client; disable request/session recording. Never put
   tokens in command history. No automatic retry, even after a timeout.
4. Run the normal case once and once warm, then the fault cases below sequentially.
   Leave at least three seconds between quota-consuming calls. Every successful
   reservation really consumes the existing quota, including abandoned tests.
   Never truncate/refund the hosted ledger. Independently query the returned
   `probe.admissionId` to verify the committed row belongs to the test user.
5. Remove the temporary probe and its nonsecret allowlist value after testing
   through an approved workflow. Production activation is a separate decision.

The response retains the production status/body and adds `probe` counters,
verified-stage booleans, the test admission ID, `mockDispatchElapsedMs` (null if no
mock start), and `quotaElapsedMs` (measured through handler completion). Both use
the handler's original reservation start, observed through its clock dependency
without altering clock values; they exclude input, Auth and cold-start overhead.
Boundary enforcement uses the unchanged production timer and final dispatch guard. There is no
console logging. No raw credentials, queries, timestamps, provider URLs or Auth
records appear in telemetry. The private admission ID supports manual SQL checks.
Gateway-rejected requests may have no probe telemetry because code never ran.

Optional `X-GroupBite-Probe-Mode` is accepted only by this isolated function:

| Mode/case | Required result |
| --- | --- |
| `normal` (default), cold and warm | HTTP 200, empty suggestions, Auth verified, one reservation, one confirmation, actual confirmation true, one local mock start, `mockDispatchElapsedMs` <800 ms; matching committed row. |
| Missing/malformed/forged/expired token or another account | Gateway/handler rejection, no reservation or mock start. An API key alone is not a user identity. |
| `confirmation-false` | Real confirmation is read, then JSON false is substituted; HTTP 503 `quota_unavailable`, zero mock starts. |
| `confirmation-error` | Real confirmation is read, then HTTP 503 is substituted; same fail-closed result. |
| `confirmation-stall` | Real confirmation is read, then partial JSON is delivered without completion; shared deadline fails closed, zero mock starts. |
| `shared-deadline` | Reservation response held until at least 400 ms from reservation start; confirmation held until 850 ms. Shared 800 ms deadline aborts first; zero mock starts. |
| Genuine quota denial | HTTP 429 with bounded `Retry-After`, no confirmation or mock start. |

Fault controls can only deny/delay, never invent an admission or successful
confirmation. `confirmationVerified` describes the actual RPC result before any
fault substitution, not permission to dispatch. If real RPC latency prevents a
fault case from reaching confirmation, it safely fails but does not prove that
specific injection ran: require `confirmationRequests=1` and a verified real
confirmation for the fault-case evidence. Investigate latency; never extend the
800 ms budget. Client round-trip time cannot measure the quota budget.

Any real provider traffic, dispatch without matching confirmation, duplicate
dispatch, or dispatch at/after the budget is a failure. Hosted Auth/gateway and
latency remain unverified until these manual tests pass. The local adapter
allowlist is an application network boundary; this implementation does not claim
to configure a project-wide firewall.

## Local validation

These commands read no secrets and contact no hosted service. The native tests
map a synthetic Supabase origin to a loopback fixture; Deno allows only loopback
networking, with no environment permission. No provider hostname can be fetched.

```sh
node supabase/tests/geoapify_probe.cjs
node supabase/tests/geoapify_suggest.cjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js supabase/functions/geoapify-suggest-probe supabase/tests/geoapify_probe.cjs supabase/tests/geoapify_probe_runtime.ts

env -i PATH=/usr/bin:/bin DENO_DIR=/private/tmp/groupbite-m15-probe-deno \
  /private/tmp/groupbite-m15-runtime-tools/deno check --no-config \
  supabase/functions/geoapify-suggest-probe/index.ts supabase/tests/geoapify_probe_runtime.ts
env -i PATH=/usr/bin:/bin DENO_DIR=/private/tmp/groupbite-m15-probe-deno \
  /private/tmp/groupbite-m15-runtime-tools/deno test --no-config --cached-only \
  --allow-net=127.0.0.1 supabase/tests/geoapify_probe_runtime.ts
```

Local tests cover destination/method/redirect restrictions, credential scoping,
allowlisted identity, false/missing/failed confirmation, cancellation and late
completion, quota denial, fault modes, concurrent state isolation, the 799/800 ms
boundary, real HTTP body stalls, and production import/flag isolation. Local Auth
and RPC fixtures are synthetic; they do not establish hosted JWT verification.
