# Home dashboard read model

`useHomeDashboard()` is a Home-owned, read-only hook, now wired to Home with
`includeCollections: true` for the Phase E statistics. It uses the existing authenticated Supabase client and RLS; it adds
no provider, global cache, persistent storage or dependency. Phase E adds the
separate aggregate visit-summary RPC; see [its contract](phase-e-home-dashboard.md).

## Consumer contract

- `counts.places`: exact account-owned `personal_places` count; internal personal-row count; not a collective headline.
- `counts.visits`: exact account-owned `personal_visits` count, including legacy
  and undated rows; internal destination-row count; not a unique-occasion headline.
- `counts.groups`: exact current membership count, including Owner membership.
- `groups`: up to three current groups, newest membership first, with `id`,
  `name`, `role` and `membershipId`.
- Each count/group section has `status: loading | ready | error`, `data` and
  `error`. Unavailable data is `null`, never a fabricated zero or empty success.
- `recent.entries`: at most five personal/group visits merged by creation
  instant descending, then visit UUID descending, then source kind ascending.
  PostgreSQL microsecond precision is retained. `visited_on` is independent and
  nullable; never present `created_at` as the actual visit date.
- `recent.status` and overall `status` are `loading | ready | partial | error`.
  `personalError`/`groupError` identify unavailable streams. A partial list is
  incomplete and must be labeled accordingly, including when it is empty.
- `refresh()` clears the visible snapshot and requests a fresh batch. It also
  recovers after an access-check failure; there is no automatic mutation/replay.

Personal entries carry `kind`, `origin`, `visitId`, `entryId`, name/address, date,
creation timestamp and rating. Group entries additionally carry `restaurantId`,
`groupId`, `groupName` and `membershipId`. Independent destinations remain separate,
even when facts match or visit UUIDs coincide across the two tables. Neither
private nor group notes are requested. Device-only records are never read.

Home initially displays two recent destination saves, with See more expanding to
the bounded five and Show less collapsing them. Home's thin detail aliases use
`/home/personal-place/[id]` with `entryId`, or
`/home/group/[id]/restaurant/[entryId]` with `groupId` and `entryId`. These open the
existing permission-checked history within Home's anchored stack, retaining Home
for custom/native Back. They do not open standalone visit editors or serialize
notes in navigation. Use a source-qualified row key such as `${kind}:${visitId}`.
Group previews use `/home/group/[id]`; View all groups deliberately opens Groups.
Editor/completion return paths share the typed navigation origin helpers.

## Read and lifecycle boundaries

Counts use exact counts independent of returned row limits. Personal and group
visit discovery each request at most five rows; metadata uses bounded ID batches.
The group preview selects at most three memberships with its exact count. Group
visit discovery first reads identities, captures current admission IDs, and then
reads visit content. Both group branches undergo one final batched membership
and group-metadata check before publication. Missing parents, access failures,
or inconsistent admissions fail the affected data closed.

A nonempty load uses at most 14 requests, independent of history/group size; an
empty account uses five. While focused/active, one nonoverlapping 15-second check
reads only membership/group metadata for at most eight referenced groups. No
histories or counts are polled. A failed/changed access check clears group count,
preview and group visits until explicit Refresh; successful personal data remains.

Without the collection option these checks cover only groups represented in the preview or recent feed.
Home now enables collection statistics, which also revalidates the full membership
set, including empty/unshown groups; see [collection statistics](ui-1d-collection-statistics.md). A
membership change involving an unshown group can leave the exact group count
stale until explicit Refresh or a focus/foreground reload. The count is exact as
of its successful read, not continuously synchronized. Global count polling or
additional backend queries require a separate performance decision.

The hook pins every request to its initiating account, uses the existing
20-second per-request deadline for authorization preflight and HTTP together,
serializes batches and invalidates work on newer
refreshes, account changes, blur, background or disposal. Foreground/focus return
loads again. Rendering gates old snapshots before effect cleanup. No Home data
survives in persistent storage.

Authorization/session retrieval itself cannot be aborted. Its dashboard wait is
bounded by that deadline; a late token result checks cancellation/expiry before
HTTP dispatch. A canceled stalled preflight may hold the serialized queue until
its deadline expires, after which the newest eligible refresh can proceed.

These reads are separate database snapshots, not an atomic dashboard transaction.
Ordinary saves/deletions can race a refresh, and exact counts/global recency sorts
may become costly with larger histories. Access changes are detected at lifecycle
boundaries and polling, rather than instantaneously. A canceled native request
depends on the transport honoring abort; responses are still discarded and bounded
by deadlines. Backend performance and native transport behavior remain unmeasured.

## Offline validation

Run `node tests/home-dashboard.cjs`. It exercises actual client queries and the
hook with mocked HTTP, membership rules and native/navigation lifecycle events.
It verifies query bounds, projections, counts, destination mapping, timestamp
ordering, admission changes, partial failures, cancellation and stale results.
This does not prove hosted RLS or simulator acceptance. No hosted operations or
database fixture runners are needed for this step.
