# Personal Geoapify coordinate attachment

**Deployment reconciliation (owner report 2026-10-11):** this function and
`geoapify-suggest` are already deployed; this function was redeployed after the
coordinate-tolerance fix. Migration 11 was applied through SQL Editor and its
service-role-only RPC permissions were verified. Exact deployed source versions
remain unverified. Preserve Migration
11 as versioned history/source; do not run it again or redeploy this function
from the historical checklist. See the
[checkpoint audit](../../../docs/stabilization-checkpoint.md).

Backend-only stage. This separate function enriches an **already saved** personal
place. It does not save/delete places, attach group restaurants, call Geoapify,
reserve provider quota, or enable native UI wiring. Existing manual saves work
without it. The production suggestion function's 800 ms admission budget and
5-second provider deadline are unchanged.

## Contract and security

POST with the real user's Bearer JWT and JSON containing exactly:

```json
{
  "personalPlaceId": "<saved personal-place UUID>",
  "expectedRevision": 1,
  "selectionReceipt": "<signed Geoapify selection receipt>"
}
```

Use the revision **returned by the completed save**, not its pre-save revision.
The receipt must match that saved address exactly; this function does not replace
or normalize addresses. Coordinates, provider fields, user IDs and expiry supplied
separately by a caller are rejected. Native requests only; browser Origin is denied.

The function verifies the JWT with Supabase Auth, then requires the existing
`GEOAPIFY_ALLOWED_USER_ID` (initially Taylor). It resolves the target through the
user's existing RLS and verifies the receipt's HMAC, project issuer, audience,
authenticated user, schema, 10-minute lifetime and exact address. Only verified
coordinates, provider result ID and signed expiry reach the service-only RPC.

Migration 11 adds `attach_geoapify_personal_place_location`. Its SECURITY DEFINER
function has an empty search_path and service-role-only EXECUTE permission. It
locks the owned target, checks its revision/address and checks signed expiry
against `clock_timestamp()` **after** waiting for the lock. It delegates the write
to Migration 8, preserving first-resolution-wins, revision increments and address
edit invalidation. It adds no table permissions or backfill.

Successful responses are `{ "status": "attached" }` or
`{ "status": "already_resolved" }`. Success requires a separate committed-row
readback under user RLS; it does not require hosted PostgREST to acknowledge
`Prefer: tx=commit`. An explicit rollback acknowledgement is rejected. An existing
resolution is preserved even if a different valid selection is submitted.

When confirming a new attachment, finite, in-range coordinates must match the
signed values within **1e-12 degrees absolute per axis**, with no relative
tolerance or numeric coercion. This covers 15-significant-digit SQL/JSON float
formatting (less than 0.12 micrometers of latitude). Signed coordinates and RPC
inputs are never rounded; address, provider result ID and accuracy checks remain
exact. A committed attachment can have returned `attachment_unconfirmed` from
the former exact floating-point comparison; reconcile by readback, never replay
the write or edit the already resolved place to test this correction.

Errors contain only a fixed `error.code`: 400 invalid input/selection, 401 invalid
authentication, 403 non-allowlisted user/Origin, 404 unavailable target, 409 changed
place, or 503 unavailable/unconfirmed operation. No payload or exception logging.

Request parsing is bounded to 1 second/8 KiB. Auth is bounded to 3 seconds. Target
lookup, receipt verification, the single attachment RPC and readback share one
3-second enrichment deadline, including response bodies. Cancellation propagates;
redirects and automatic retries are disabled. Late verification cannot start a write.

**Failure must not undo or retry the original save.** A timeout, cancellation or lost
response can occur after the attachment committed. Reconcile using existing
personal-place and saved-location reads; do not automatically replay attachment.
Attachment increments the place revision, so refresh it before subsequent edits.
The receipt is selection evidence, not a globally single-use token: reuse cannot
overwrite a resolved target or authorize another user's place. No receipt is stored.

## Configuration and remaining deployment checks

Required environment names: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `GEOAPIFY_SELECTION_SECRET`,
`GEOAPIFY_ALLOWED_USER_ID`. Use the same project/signing secret and Taylor UUID as
`geoapify-suggest`. The signing secret must be 64 hexadecimal characters (32 random
bytes). This function does not need `GEOAPIFY_API_KEY`. Never put credentials or
receipts in source, URLs, shell history or diagnostics.

Historical first-deployment checks (current deployments must be reconciled first):

1. Migration 11's application and service-role-only permissions are owner-verified.
   Do not reapply migrations 1–12 from these notes. Reconcile SQL Editor migration
   history before future CLI migration operations; any further hosted inspection
   requires separate authorization.
2. Preserve the existing deployment. A separately approved review can verify its
   source revision and JWT configuration without redeploying or changing secrets.
   Keep the allowlist and native feature gates unchanged.
3. Review hosted log/tracing settings: platforms can capture Authorization/apikey
   headers and JSON bodies (addresses/receipts) independently of this code. Disable
   payload/header capture and avoid request dumps; URLs contain target/user UUIDs.
4. With Taylor, save one disposable personal place normally and retain its returned
   revision. Submit an unexpired real signed receipt matching its address. Verify
   the committed location and new revision using separate user reads. Attachment
   makes no additional provider request. Verify missing/other-user JWT, stale and
   expired receipts fail without changing the saved place; verify first-resolution
   wins and address editing still invalidates location. Gateway/PostgREST behavior
   and hosted clock agreement remain unverified by offline tests.
5. Keep UI/group attachment unwired until a separate implementation is approved.
   To stop this endpoint, disable/delete only this function; preserve existing saves,
   migrations and location data. Do not remove the shared suggestion allowlist.

## Offline validation

```sh
node supabase/tests/geoapify_personal_attachment.cjs
deno test --no-config --cached-only supabase/tests/geoapify_personal_attachment_runtime.ts
node supabase/tests/validate_personal_geoapify_attachment.mjs \
  --postgres-bin /absolute/local/postgresql/bin \
  --pg-module /absolute/local/pg/lib/index.js
```

The first two use synthetic credentials, signed fixtures and mocked Fetch with no
network or env permission. The SQL runner applies migrations only in its own fresh
temporary local database, listening on a private Unix socket with no TCP. It uses
explicit preinstalled tooling, never reads project secrets, and removes only its
own disposable fixture after stopping its processes. It tests unchanged foundation
objects/data, RPC privilege boundaries, rollback and real concurrent lock waits.
