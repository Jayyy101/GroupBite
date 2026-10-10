# Milestone 15: local Geoapify suggestion runtime verification

Source, offline tests and isolated Deno/PostgREST runtime tests. The app still uses
mock suggestions and its existing saves. No real credentials, deployment,
coordinate attachment or edits to migrations 1–9. Migration 10 adds only a private
confirmation RPC; it has not been deployed by this work.

`index.ts` registers the Deno handler; `handler.ts` authenticates, meters and
validates suggestions; `http.ts` bounds HTTP/body operations; `receipts.ts` signs
and verifies selection integrity. No SDK imports or dependencies were added.
Root TypeScript enables `.ts` imports required by Deno, allowing the existing
strict check to check these modules too.

## Contract

POST `/functions/v1/geoapify-suggest` with `Authorization: Bearer <user JWT>`,
`Content-Type: application/json` and exactly:

```json
{ "action": "suggest", "query": "100 Market Street, San Francisco" }
```

Query length is 3–300 Unicode characters after trimming; body limit is 2 KiB.
Actor IDs, coordinates, limits, provider URLs and attachment/save actions are
rejected. Only POST is supported. Browser origins/CORS are disabled in this native
iOS-first phase. Success returns `suggestions` (zero to five) and `attribution`:

```text
suggestion = {
  id, source: "geoapify", address, latitude, longitude,
  accuracy: "building", countryCode: "us", selectionReceipt, expiresAt
}
```

The core fields match the mock contract's meanings; `source` distinguishes genuine
results from `development-mock`. A later UI phase needs a typed adapter. Coordinates
remain hidden selection metadata, not editable fields or current save payloads.
Existing transient-state cleanup and manual entry must remain available.

Provider requests use a fixed HTTPS endpoint, `text`, `filter=countrycode:us`,
`lang=en`, `format=json` and `limit=5`. The key is sent only in `x-api-key`, never
in a URL or query-authentication fallback. Supabase credentials are never included
in the provider headers, and the provider key is never sent to Auth/quota RPCs.
The official [Address Autocomplete OpenAPI specification](https://apidocs.geoapify.com/assets/openapi/specs/address-autocomplete/address-autocomplete-api-openapi-specs.json)
(version 1.1.1, reviewed 2026-10-10) declares server
`https://api.geoapify.com/v1`, GET `/geocode/autocomplete`, and root security
alternatives including `ApiKeyInHeader` (`type: apiKey`, `in: header`,
`name: x-api-key`). This operation has no overriding security declaration, so the
header alternative applies to our exact endpoint. Documentation establishes
support; real hosted header authentication remains unverified until an approved
controlled request. Geoapify has no `type=building` request parameter.
Returned results must be US `building` results, with house number/street, provider
ID, standardized address within Migration 8's 300-character limit, finite in-range
coordinates (including rejection of the unresolved `(0,0)` sentinel),
general/building confidence both >=0.8 and a building-level match
(`full_match`, `inner_part` or `match_by_building`). Coarse/amenity/incomplete or
missing-confidence results are dropped. Whitelisted results are deduplicated and
capped at five. This conservative policy can reduce coverage; check real results
later. [Geoapify API reference](https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/).

Responses are `no-store`. Errors expose only a stable code and
`manualEntryAllowed: true`; empty precise results return a successful empty list.
The response includes Geoapify and OpenStreetMap attribution links, to be visibly
displayed by the later UI. Free usage requires provider/data-source attribution.
[Provider guidance](https://www.geoapify.com/address-autocomplete/).

## Authentication and durable admission

The handler calls its configured Supabase Auth `/auth/v1/user` with the JWT and
project anon key, then derives identity from the verified authenticated user UUID.
It does not trust decoded JWT claims or body actor IDs. Invalid, expired,
non-user/anonymous and unverified identities cannot obtain quota or contact the
provider. Auth failure also fails closed. This is the Auth-server validation
underlying [getUser(jwt)](https://supabase.com/docs/reference/javascript/auth-getuser).

Each provider attempt requires a committed service-role call to
`reserve_geoapify_request({ acting_user_id: verifiedUserId })`. The handler validates
the one-row admission/denial contract. Denial returns 429 and bounded `Retry-After`;
failed, uncertain, malformed, slow or expired admission never dispatches. There
are no local quota substitutes, refunds or automatic retries.
The reservation RPC requests `Prefer: tx=commit`, but the handler no longer
requires `Preference-Applied: tx=commit`. The owner's hosted probe returned HTTP
200, no acknowledgement, and an independently verified committed admission.
Default PostgREST `commit` therefore needs committed-row readback, not an override
configuration change.

After every affirmative reservation, a **separate POST / transaction** calls
`confirm_geoapify_request({ target_admission_id, acting_user_id,
expected_permit_expires_at })`. Migration 10 adds this `STABLE`, security-definer,
read-only RPC with an empty search path and execution granted only to
`service_role`. It returns only a boolean: the exact ID/user/expiry must match a
row visible to that new transaction, and expiry must exceed the database statement
start time. The original timestamp string is passed unchanged, preserving
PostgreSQL microseconds. No table grants, quota writes or existing RPCs change.

Only a complete JSON `true` authorizes further processing. Missing RPC/row,
`false`, malformed data, HTTP/transport errors, cancellation and uncertainty all
fail closed. Explicit rollback or conflicting commit/rollback response headers
are rejected. An acknowledgement never bypasses confirmation. Valid quota denials
still return 429 without a readback or provider request.

Readback is not a reusable dispatch token. The handler keeps the ID private to
one invocation, dispatches at most once, and never caches, resumes or retries a
permit. A new client invocation must reserve and confirm again. Lost responses,
abandoned work and provider failures never refund committed usage. A read inside
the reservation RPC would not establish commit; keep the requests separate.

Migration 9 retains 1,000 global/100 per-user rolling 24-hour admissions, its
one-second grace and three admissions per two seconds. SQL owns concurrency.
One 800 ms deadline starts **before** reservation and covers both RPCs and their
complete bodies. The original monotonic budget is checked before confirmation
and immediately before the sole provider Fetch; confirmation never resets it.
Admission occurs after that starting instant, so timely dispatch precedes its one-second expiration without synchronized Edge/DB
wall clocks. Reported expiry is also checked; an ahead clock can safely abandon a
usable permit. Slow/abandoned admissions still count, and no HTTP occurs inside
the database transaction.

Timeouts include bodies: input 1 s, Auth 3 s, reservation + confirmation/dispatch
800 ms total, provider 5 s. Response sizes are bounded: Auth/provider 64 KiB,
each quota RPC 4 KiB. Cancellation aborts work, and late results are ignored even if abort is ignored. All Fetches
disable redirects. Provider 429 returns `provider_throttled` with a conservative
60-second hint, without retries/sleep. No durable provider-backoff table is added;
later callers must honor the hint and meter each explicit new attempt.

## Signed selection receipts

HMAC-SHA-256/Web Crypto signs a versioned payload containing a fixed audience,
project URL issuer, verified user UUID, issue/expiry times and the validated
provider ID/address/coordinates. TTL is ten minutes; exact expiry is rejected.
The private verifier checks signature, canonical encoding, complete schema,
project, user, exact address and time bounds. It exposes no HTTP operation.

Receipts are integrity proofs, not JWTs, authentication or attachment permission.
They are signed, not encrypted: the recipient can read the address, coordinates
and their UUID. Same-user/same-address reuse within TTL is allowed; there is no
one-use ledger. Secret rotation invalidates outstanding receipts.

Later attachment must authenticate again, compare the receipt to the exact saved
address and verify selected provider results server-side again, reserving fresh
quota for every additional provider attempt. Group attachment must use the
original Migration 9 request-ID binding reader and exact entry IDs, then Migration
8's service-only authorization. Personal attachment must check owner, current
revision and address. Membership revocation, address edits and deletion/recreation
remain SQL checks; Restaurant ID reuse or a receipt must never bypass them.
Save-first/partial-enrichment semantics are deferred; this function never saves
or attaches locations.

## Server secrets and later deployment

| Name | Purpose |
| --- | --- |
| `SUPABASE_URL` | Runtime-provided HTTPS project origin; loopback HTTP is allowed locally. |
| `SUPABASE_ANON_KEY` | Runtime-provided legacy anon key for Auth with the caller JWT. |
| `SUPABASE_SERVICE_ROLE_KEY` | Runtime-provided legacy service-role JWT for admission only here. |
| `GEOAPIFY_API_KEY` | Owner-provisioned dedicated Geoapify provider key. |
| `GEOAPIFY_SELECTION_SECRET` | Owner-provisioned independent random 32 bytes encoded as 64 hex characters. |
| `GEOAPIFY_ALLOWED_USER_ID` | Required nonsecret UUID of Taylor's approved Supabase Auth account, for the temporary rollout restriction. |

No real values are included. Missing/malformed configuration fails closed. Never
use `EXPO_PUBLIC_*` or mobile configuration for provider/signing/service secrets.
Modern Supabase key environment names are not silently substituted; verify the
required legacy variables before deployment.
[Default secrets](https://supabase.com/docs/guides/functions/secrets).
Geoapify authentication uses the `x-api-key` header. Do not log Fetch headers,
URLs, raw errors, queries or JWTs; check production tracing redaction before live use.

### Temporary Taylor-only rollout restriction

The production entry point now requires `GEOAPIFY_ALLOWED_USER_ID`. Set it only
through the approved project configuration workflow to Taylor's independently
identified **Auth user UUID**; names, email addresses and caller claims do not
select an account. No real UUID or secret is included in source. Missing/empty or
malformed configuration returns 503 `service_unavailable` before networking.
There is no wildcard, list, bypass header or unrestricted default.

After the unchanged real Auth verification, the handler compares the verified
user UUID with the configured UUID (case-insensitively). A different authenticated
user receives 403 `access_denied` with manual entry allowed, before receipt-signing
setup, quota reservation, confirmation or Geoapify. Invalid/anonymous identities
still fail Auth. Taylor's requests retain the same committed-row confirmation,
800 ms shared dispatch budget, SQL limits, no retries and no refunds. This limits
eligible callers, not Taylor's request count; conduct one controlled request
without retries. Keep gateway `verify_jwt=true` and the app's existing mock/manual
flow unchanged. The retired isolated probe passes its existing test-account UUID
into this shared handler; production never reads its probe setting or imports it.

Removing the restriction requires a separately approved code change: remove the
`allowedUserId` config field and UUID validation/normalization from `handler.ts`,
remove the post-Auth comparison, and remove the entry point's environment read.
Update the restriction tests and shared probe fixture accordingly; rerun Auth,
quota, concurrency, confirmation and deadline tests before deploying only the
production function. Then remove only `GEOAPIFY_ALLOWED_USER_ID` from hosted
configuration. **Unsetting the value alone does not open access**; new handler
instances fail closed. Configuration is captured at handler creation, so do not
assume a setting change cancels an already running invocation.

### Remaining hosted tracing check and shutdown

Application modules contain no console logging or tracing hooks, and error
responses contain fixed codes rather than raw exceptions or provider data. That
does **not** establish platform/exporter redaction: the Geoapify `x-api-key`
header contains the key and the URL still contains address `text`; Auth/RPC
headers contain credentials; input,
success bodies and readable signed receipts contain address/user information.
Before live use, verify hosted outbound URL/header/body tracing and any external
log exports are disabled or redact these fields. Never use verbose HTTP logging
or session recording for the manual test. These hosted settings remain unverified
by local tests. Use a public building address for the controlled request.

Offline and loopback tests enforce header-only provider authentication, exact
unchanged query parameters, credential-free outbound URLs, credential separation,
no redirect/retry/query fallback, and sanitized errors with no application logging.
Moving the key out of URLs reduces exposure; it does not make header/body tracing
safe. Success responses and signed receipts still intentionally carry selections.

For an emergency, revoke the dedicated provider key and remove/disable only the
hosted `geoapify-suggest` endpoint through the approved workflow, then unset only
`GEOAPIFY_API_KEY`. Secret removal alone is not evidence that captured values or
in-flight dispatches have stopped. Leave Supabase keys, signing configuration,
migrations, committed quota rows and existing saves intact. Never refund usage or
expand limits to recover a failed test.

After separate approval:

1. Obtain approved Deno/Supabase CLI tooling. This checkout has no CLI config;
   initialize it only in a later approved setup. Run Deno checking and isolated
   local Edge/Auth/PostgREST smoke tests before hosted deployment.
2. The owner provisions a dedicated Geoapify **Free** account/key without paid
   enrollment/automatic upgrades, plus an independent random signing secret.
   Configure server secrets through an approved secure workflow such as Dashboard,
   never committed files or mobile settings. This change creates none.
3. Verify the existing migration state; do not rerun migrations 1–9. Apply only
   `migrations/20261010001000_geoapify_admission_confirmation.sql` once after
   Migration 9, using an approved migration workflow. Verify the new RPC is
   visible to PostgREST, executable only by `service_role`, and that table grants
   remain revoked. No transaction-override setting is required.
4. With Geoapify still disabled and provider Fetch intercepted by a controlled
   test harness, verify hosted Auth, reservation/readback, independent admission
   visibility and both cold/warm latency within the unchanged 800 ms total budget.
   Missing confirmation, rollback, malformed/stalled responses and quota denial
   must produce zero provider calls. Check named legacy runtime keys and READ
   COMMITTED admission isolation through the approved secure workflow. Keep gateway
   `verify_jwt=true` (default); do not use `--no-verify-jwt`. Auth-server verification
   remains mandatory. [Gateway guidance](https://supabase.com/docs/guides/functions/auth-headers).
5. Only when authorized, deploy with the explicit approved project reference:
   `supabase functions deploy geoapify-suggest --project-ref <approved-project-ref>`.
6. Test invalid/expired tokens, quota/dispatch boundaries, real US coverage,
   failures, attribution, key redaction, receipt tampering/expiry/account isolation
   and gateway behavior with disposable accounts. UI/attachment require a later phase.

Offline tests cost $0. Geoapify advertises 3,000 free daily credits and one credit
per autocomplete request; our ledger leaves headroom. It cannot control other
uses of the key, provider billing settings or Supabase invocation/egress quotas.
Provider soft limits are not a hard spend cap: confirm Free-account settings and
monitor live usage before enabling real requests.
[Pricing](https://www.geoapify.com/pricing/),
[cost/soft-limit guidance](https://www.geoapify.com/address-autocomplete/).

## Local validation

```sh
node supabase/tests/geoapify_suggest.cjs
node tests/personal-create-draft.cjs
node tests/address-autocomplete.cjs
node tests/personal-places.cjs
node tests/navigation.cjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
```

The new harness executes actual Edge modules with installed TypeScript/Node Web
APIs; every Fetch is mocked, including Auth and admission. A fake Deno runtime
also checks entry-point secret names and handler registration. No actual env,
secrets, network or provider credits are used. Mock concurrency tests verify the
handler; the existing PostgreSQL/PostGIS validator separately tests SQL locking
and rolling boundaries:

```sh
node supabase/tests/validate_address_autocomplete_groundwork.mjs \
  --postgres-bin /private/tmp/groupbite-m15-tooling/Postgres.app/Contents/Versions/17/bin \
  --pg-module /private/tmp/groupbite-m10-validation/node_modules/pg/lib/index.js
```

## Controlled runtime verification

The receipt decoder infers its return type rather than spelling
`Uint8Array<ArrayBuffer>`, which requires TypeScript 5.7-era library declarations.
Deno 2.1.14 / TypeScript 5.6.2 checks the actual entry point and runtime tests:

```sh
/private/tmp/groupbite-m15-runtime-tools/deno check --no-config \
  supabase/functions/geoapify-suggest/index.ts supabase/tests/geoapify_suggest_runtime.ts
/private/tmp/groupbite-m15-runtime-tools/deno test --no-config --cached-only \
  --allow-net=127.0.0.1 supabase/tests/geoapify_suggest_runtime.ts
node supabase/tests/validate_geoapify_runtime.mjs \
  --postgres-bin /private/tmp/groupbite-m15-tooling/Postgres.app/Contents/Versions/17/bin \
  --pg-module /private/tmp/groupbite-m10-validation/node_modules/pg/lib/index.js \
  --deno /private/tmp/groupbite-m15-runtime-tools/deno \
  --postgrest /private/tmp/groupbite-m15-runtime-tools/postgrest
```

Tool paths are explicit and assume separately approved temporary downloads; the
runner installs nothing. PostgREST 13.0.7 reuses the existing Postgres.app `libpq`
through a process-local library path. It creates a disposable PostgreSQL database
with no TCP listener, a private Unix socket, no password and durable commit
settings enabled. It hashes migrations 1–10 and test inputs, runs all nine prior
SQL suites and 23 Migration 9 lock-wait races, and checks Migration 10 preservation,
permissions and independent-transaction visibility before cleaning up its owned
processes and database. Downloaded tools remain in the temporary tooling directory.

The combined suite runs 20 native Deno tests. An independent database connection
checks admission visibility before the RPC response is returned to Deno, and the
mock-provider checks that observation plus the identity and unexpired committed
row again before execution. Real PostgREST cases cover acknowledged commit, silent rollback,
reported rollback and committed-but-unacknowledged responses. Both committed
modes dispatch only after successful readback; rollback never dispatches.
Successful admission bodies or headers alone never prove persistence. Missing confirmation, confirmation body stalls,
the shared 800 ms budget and fresh metering after explicit retries are tested. Daily quota limits, concurrent rate
admissions and retained usage after stalled bodies/provider failures are covered.
Native Fetch tests deliver headers and partial JSON before stalling each of Auth,
reservation, confirmation and provider bodies; the offline harness also verifies stream cancellation.

Every Geoapify URL is intercepted and replaced with a loopback fixture, and Deno
network permissions permit only `127.0.0.1`. Auth responses are mocked. Private
PostgREST fixtures use a service role without JWT authentication; SQL tests check
the real grants separately. No real credentials are generated or provisioned.
The local tests therefore verify Deno/Web APIs and PostgREST durability, but not
Supabase's actual Edge Runtime, gateway JWT handling or GoTrue Auth verification.
Supabase CLI/Docker remain unavailable. Those checks, real provider coverage and
production tracing redaction remain later work; runtime success here is not
deployment approval.
