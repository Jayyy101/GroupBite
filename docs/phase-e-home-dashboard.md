# Phase E — Home Dashboard

Phase E finishes the 14 preserved Dashboard paths on the Phase D baseline `59ee481`.
Migration 19 was deployed once on October 22, 2026, following the checksum-pinned
readiness/backup review. Hosted acceptance passed with separately approved minimal
synthetic visits; all historical visits and receipts remain intact. The navigation
polish changes only local routes and clients, requiring no additional migration.

## Dashboard behavior

Four wrapping statistic cards cover the account's My Places and active joined
groups, including groups they own. Places Saved uses the Saved Map physical-venue
matcher with additional conservative ambiguity checks. Missing identity never
becomes an exact total. Cities Explored uses current structured Apple city/region/
country components, with an explicitly qualified identified-city count when
coverage is incomplete. Apple selection is informational, never labeled as
server-verified Geoapify. See [collection statistics](ui-1d-collection-statistics.md).

Your Visits counts occasions recorded by this account across currently accessible
live destinations. Unlinked historical rows make the exact total unavailable;
the UI does not add them together or guess from date, restaurant, rating or time.
A missing backend still has an explicit pending-backend state; migration 19 is
now deployed in the verified development project.

Recent **destination saves** show two items initially, expanding to the existing
bounded five. They are ordered by save creation, and display the separate actual
visit date (or its absence). They retain private/group labels and existing history
navigation within Home's own anchored browsing stack. Other members' accessible group saves may appear here;
they do not count as occasions recorded by this account. Your Visits scrolls to
this feed; place/city cards open the existing Home-origin Saved Map on supported
iOS development builds, with My Places as the existing gated-build fallback.
Groups Joined opens Groups. The Saved Map shortcut and three group previews stay.

One scroll, wrapping text, adaptive single-column statistics at narrow widths or
large text, 44-point actions, loading placeholders, explicit partial failures and
manual Refresh preserve the orange/cream light V1. No app-wide dark mode work.

## Additive visit-event proof

`20261022001900_visit_event_provenance.sql` adds private `visit_events` and
`visit_event_destinations`, with no backfill or changes to existing rows, RLS,
RPCs, destination receipts or hashes. Clients have no direct table permissions.
Only authenticated callers can execute the two new RPCs.

Unified Add generates one event ID per frozen action and independent request IDs
per destination. `save_visit_event_destination` delegates to the existing
personal/group and MapKit writers, then adds the event link **in the same
transaction**. Each destination still commits independently. The actor/event lock
serializes competing copies; an event cannot acquire two requests for one
destination or steal an existing request. Common initial name/address/date guard
against accidental ID reuse. Identity is explicit, never inferred from those facts.
Destination-specific notes and ratings remain independent. Existing receipt
reconciliation proves the whole atomic destination save, including the link.

The mixed-version eligibility check acquires the existing personal profile
`NO KEY UPDATE` lock or group `FOR UPDATE` lock **before** creating/locking an
event or inspecting destination receipts. The group path revalidates its exact
membership incarnation under that lock; delegated RPCs keep their own checks.
A legacy writer that wins must finish first: its committed unlinked receipt is
rejected, while a rollback permits the new operation to create its own atomic
receipt/link. If the event writer wins, legacy retries reuse the immutable
receipt without changing its event association. No earlier migrations are edited.

Recovery markers retain only the extra opaque event ID, never payloads or notes.
Uncertain work is still reconciled by receipt reads and never automatically
replayed. Old markers/submissions remain compatible with their original RPCs and
stay unlinked. Missing new RPCs fail explicitly; new saves never silently downgrade
to an unlinked legacy write.

`get_my_visit_event_summary` returns only linked-event, linked-record and
unlinked-record counts. It includes account-owned personal visits and group visits
created by that account in current memberships. Deleted or inaccessible live rows
are excluded even though their original receipts remain. Destination edit/delete
permissions and histories are unchanged; removing one copy cannot remove another.

## Deployment and hosted acceptance — completed

Migration 19 is registered and its API schema cache/grants were verified. Do not
reapply it. The source SHA-256 remains
`c45ad7acbe6d968ed16bce6081b0a049072fa69ad0ebd585668c9759f47e0bfc`.
The approved guarded transaction pinned the baseline, performed additive DDL,
registered exact migration history and notified the schema cache atomically.
All 134 original rows and existing permissions/contracts were preserved at deployment.
A fresh private logical application backup was independently restored and rehearsed
before deployment. It excludes full managed Auth credentials, Storage and Vault.

After a full JavaScript runtime reload, hosted acceptance verified the current
account/project/coordinator and immutable shared event ID before new saves. One
labeled Special Noodle occasion saved to My Places + Date Nights produced two
independent visits with one event. A second personal-only visit at the same
restaurant/date produced another event. Ledger/receipt/history/privacy checks
passed independently through reads: two linked events, three linked destination
records, and 17 unchanged unlinked records. No exact historical unique total is
claimed. The earlier two legacy synthetic visits remain unchanged and unlinked;
Fast Refresh had retained a pre-change coordinator for that stopped attempt.
Reload JavaScript after coordinator changes rather than assuming Fast Refresh
replaced provider-owned instances. Do not replay or backfill legacy receipts.

No new environment values, Storage buckets, dependencies, provider calls, backfill
or native rebuild are required. Historical cleanup remains a separately approved
pre-TestFlight decision. New deployment, hosted mutation, fault or deletion tests
always need their own explicit scope; historical instructions are not authorization.

## Navigation review and consistent browsing

Home now has an anchored native stack alongside the four existing tab stacks.
Thin `/home/personal-place/[id]`, `/home/group/[id]`, group-restaurant and Saved Map
routes reuse the existing account/membership-checked screens. Recent saves, group
previews and the Home map shortcut retain Home beneath them. The collection and
Add result stacks keep their own detail routes. Custom Back follows mounted
history, matching native Back; a known local destination is used only without
history. There are still exactly five tabs and no duplicated data readers.

A shared typed origin selects internal detail links and bounded editor flags,
never permissions or arbitrary return URLs. Personal facts/visit editors return to
the same detail. A single Add Another Visit returns to its existing browsing detail
when the destination matches the original source; other destinations use their
collection. Multi/partial saves retain the Add summary. Completion removes finished
forms with the existing guarded dismiss action, and recovery contracts stay intact.

All tab presses use the existing native root-selection helper after the focused
leave guard approves. Dirty/active/uncertain protections remain shared; confirmed
Add completion still follows its existing journal-removal contract. Home-origin
and My Places-origin maps retain their mounted camera, filter, selection and panel
when returning from details/editors. Choosing another tab intentionally opens its
root. Existing `/saved-map?fromHome=1` links redirect to the proper Home map stack.
Auth resumes only the explicit new internal routes and keeps account-keyed lifetimes.

## Validation and remaining acceptance

Offline suites: Home data/UI, collection statistics, visit-event client proof,
Unified Add/recovery, native/structured MapKit persistence, navigation/auth/personal,
UI usability, Saved Map and milestone-17 safety, plus TypeScript, uncached lint and
whitespace review. These use synthetic boundaries; they do not establish hosted or
physical-device acceptance.

The disposable Unix-socket database runner applies migrations 1–19 and exercises
SQL, legacy regressions, real concurrent retry/destination/membership races, atomic
rollback and preservation checks:

```sh
node supabase/tests/validate_group_apple_place_ids.mjs \
  --postgres-bin /absolute/local/postgres/bin \
  --pg-module /absolute/local/pg/lib/index.js --visit-events
```

The runner owns its fresh fixtures and cleans them up. Never point this suite at
hosted or an existing development database. The final navigation walkthrough uses
the existing signed-in iPhone 16 Pro, existing records and unsaved/discarded drafts;
it creates no hosted test saves. Home recent/group/detail Back, map restoration,
tab roots and editor guards are checked in the development build. Native gestures
and VoiceOver/large text on physical devices remain manual distribution checks.
No response-loss faults or membership disruptions are manufactured on hosted data.

## Mixed-version fix and readiness review

The corrected migration's SHA-256 is
`c45ad7acbe6d968ed16bce6081b0a049072fa69ad0ebd585668c9759f47e0bfc`.
The local SQL suite covers 20 mixed-version scenarios: plain/point/structured
personal saves and plain/structured group saves, either writer winning or rolling
back, historical unlinked receipts, exact retries and receipt immutability. It
also checks concurrent identical IDs across accounts, membership removal/rejoin,
existing event races, atomic link failures and all legacy contracts. Client save,
recovery, event, Home/collection, Saved Map and UI regressions, TypeScript and lint
passed. No client code or simulator change was needed for this fix.

The predeployment read-only catalog/RLS/grants/history comparison and fresh
20-table/134-row restore passed in disposable PostgreSQL 17.5/PostGIS 3.5.2.
Hosted PostGIS was 3.3.7; restored generated values matched exactly. The final
Keychain lookup was resumed normally after its first timeout; baseline fingerprints
and both reviewed checksums still matched before the separately approved deployment.
Precondition/postcondition failures rolled back all DDL/history locally, a successful
rehearsal preserved records, and a second application was rejected safely.

Migration 19 is now applied and has real event proofs. Any future schema change or
rollback requires a separately reviewed forward plan; do not drop event ledgers or
weaken replay protection. Existing older clients remain compatible and create
honestly unlinked records.
