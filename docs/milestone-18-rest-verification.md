# Milestone 18 — REST verification passed

> Historical phase report: statements about pending deployment, approval, counts
> and simulator steps below describe this report's original checkpoint.
> Current state: migrations 15–17 and REST verification passed; the owner confirmed
> the separately approved In-N-Out location repair preserved its visit, and
> Special Noodle's saved coordinates produced a second verified personal pin.
> See the [current completion review](milestone-18-completion.md). Do not repeat
> migrations or repair from this historical report.

**PASS. Migration 17 is deployed and verified. The remaining REST check is
resolved; the compatible Milestone 18 debug app can safely restart for simulator
acceptance testing. No backend or app code change is needed.**

## Captured diagnostic

One standalone read-only request was sent at **2026-10-18 06:20:28 UTC** using the
existing project URL and publishable key. It did not use a user JWT, so it tested
anonymous access. No Keychain access, migration/deployment runner, records,
provider searches, retries or additional database inventories were involved.

```text
POST /rest/v1/rpc/get_personal_mapkit_locations
Body: {"page_size":1,"page_offset":0}
HTTP: 401
PostgreSQL error code: 42501
Message: permission denied for function get_personal_mapkit_locations
Details: null
Hint: null
```

This is the expected anonymous rejection. PostgREST maps insufficient privileges
(`42501`) to HTTP 401 for unauthenticated requests and 403 for authenticated ones.
A missing/stale function signature would instead produce `PGRST202`/404.
[Official PostgREST error reference](https://docs.postgrest.org/en/v13/references/errors.html).
A publishable key without a signed-in user's JWT uses the `anon` role; the app's
normal signed-in requests carry the user's JWT and use `authenticated`.
[Supabase API key roles](https://supabase.com/docs/guides/getting-started/api-keys).

## Signature and permission comparison

The previously verified actual hosted postdeployment catalog contains exactly
**one** overload:

```text
public.get_personal_mapkit_locations(
    page_size integer DEFAULT 200,
    page_offset integer DEFAULT 0
)
```

The request's parameter names and integer values match. The app sends these same
names, with page size 200 and an account-pinned user Authorization token. The
verified EXECUTE grants are authenticated=true; anon=false; PUBLIC=false;
service_role=false. The owner-derived reader filters on `auth.uid()` and matching
current address snapshots, with no client-supplied owner ID.

The current REST response identifies the exact function and reaches PostgreSQL's
permission check, demonstrating current route/signature/cache resolution. No
current signature ambiguity, missing function, schema-cache error or incorrect
grant was observed. The anonymous test's expected response was correct and now
passes. The original unexpected response was not retained, so its exact cause
remains unknown; do not label it a proven cache delay or change permissions to
make anonymous calls succeed.

The earlier hosted database/data/permission verification and owner-confirmed
account-role SQL Editor check remain valid. No repeat of completed migration,
record-preservation or regression suites was needed. This anonymous diagnostic
does not claim a newly executed authenticated user REST end-to-end save test;
that is the next simulator acceptance step with normal account sessions.

## Safe simulator restart

1. Start Metro from this checkout:

   ```sh
   PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm start -- --dev-client --clear
   ```

2. Open the existing compatible GroupBite iOS debug development build on iPhone
   16 Pro and reload the current bundle. No native rebuild is needed; Expo Go
   cannot supply the native MapKit module. Resume accounts only on this bundle.
3. Open My Places, inspect existing card/history, then View My Places on Map and
   Refresh Map. The map should load without a missing-RPC/backend-update error.
   In-N-Out remains unmapped until its separately approved location-only repair.
   Do not save another visit to repair it.
4. Search/select a restaurant in Add and check its full address and destination
   highlighting; this can be checked without pressing Save. If recovery results
   appear, use Check Saved Results; never resubmit an uncertain save. Intentional
   new-save acceptance remains the normal simulator test, not part of this
   read-only diagnostic.

Sanitized diagnostic/comparison JSON, standalone source and checksums are stored
outside Git in:

`/Users/jayma/Desktop/Stuff/GroupBite Backups/milestone-18-pre17/rest-verification-20261018T062201Z/`

The directory is 0700 and files 0600. No credentials or private rows were printed
or exported by the diagnostic. No migration rerun, hosted record change, In-N-Out
repair, seed, deletion, staging, commit or push occurred.
