# Phase G — Visit Photos

Visit-scoped photo attachments and the native visit-date calendar were implemented
from `main` / `c21848e`. Migration 20 is deployed and verified; the user reports that
the manual photo and calendar tests passed, including private/group separation.
The consolidated review reuses those results and the existing local/deployment
evidence. It does not repeat hosted procedures or change test records.

The user confirmed the Phase B decisions in chat; there is no separate architecture
document to recover. Profile and group avatars remain deferred.

## Experience

- Unified Add selects up to six photos through the native iOS multi-selection
  picker. No broad photo-library grant, camera or microphone access is requested.
- My Places receives its own private attachment when selected. Each selected group
  has a separate, initially unchecked **Share photos with …** control. Deselecting
  a group or changing its membership incarnation revokes that choice.
- A group-only Add with selected photos requires explicit group photo consent.
  Photos, paths and consent never enter the existing visit-save payloads or notes.
- Histories attach photos to exact individual visit IDs, including existing visits.
  Horizontal thumbnail strips open a full-screen, paged gallery with native pinch
  zoom, previous/next controls, a counter and a removal confirmation.
- Personal owners can add/remove photos on their own visits. Group visit creators
  and current Owners can manage attachments; other current members can view them.
- A visit permits twelve active attachments, including incomplete reservations.
  Managers can remove unfinished reservations without needing the original device.

The photo UI reuses the existing cream/orange palette, rounded surfaces, screen
scaffold, account gate, Back/leave guards and collection-specific detail aliases.
No photo routes or private paths are added to the auth return allowlist.

## Device processing and recovery

Four photo-specific SDK 54-compatible dependencies provide the system picker, image manipulation,
durable app files and UUIDs. The picker returns images only. Native manipulation
normalizes orientation/HEIC and produces a JPEG of at most 1600 pixels on its long
edge (quality .8) plus a 480-pixel thumbnail (.72). The client explicitly removes
JPEG EXIF/XMP/IPTC/comment segments after encoding, retaining image/ICC bytes.
The native encoder creates EXIF even when re-encoding, so re-encoding alone is not
treated as metadata removal. Full images are capped at 5 MiB, thumbnails at 512 KiB.

Prepared copies use generated filenames in an account-specific Documents directory.
The queue stores relative filenames so an iOS reinstall-in-place/container-path
change does not invalidate them. It contains no notes, original filenames, tokens,
signed URLs, image base64 or frozen visit payloads. Originals in Photos are untouched.

The existing Add coordinator gains one optional pre-dispatch hook. It retains the
photo queue and explicit sharing choices against **the already-frozen destination
request IDs**, before sending any visit write. A failed photo-journal write sends
no visit writes. All normal Add behavior remains unchanged when no photos exist.

After a save, the photo controller reads the authoritative destination receipt.
Only an available receipt with matching destination/group and an exact entry/visit
ID can unlock a photo upload. It never guesses a visit from the latest history.
Failed, partial, uncertain or unavailable destinations do not receive uploads.
Photo errors cannot downgrade a confirmed visit or cause a visit replay.

Each destination/photo pair has its own immutable UUID and two object paths.
The queue persists uncertainty before dispatch, uses deadlines and pins every
request to its initiating account. Uploads use ArrayBuffers, `x-upsert: false`, no
transport retry, and no overwrite. Duplicate-path responses are reconciled through
reads. After both objects are read-confirmed, the job is durably complete. Generated
copies are released only after every destination sharing that asset is confirmed;
remaining jobs retain their local files. No directory scan or old-file cleanup runs.

Restart, focus, account restoration and foreground do not upload anything. Every
unfinished restored job becomes review-only. **Add → Photos to finish** offers:

1. **Check saved photos**: receipt/metadata reads only.
2. **Continue photo uploads**: explicit continuation using the same consent, UUID,
   reservation and immutable paths. An earlier request may still finish; missing
   metadata is never interpreted as proof that the earlier request failed.

Lost removal responses reconcile through a revisioned tombstone. Removed identities
never become writable again. Background/access changes hide image sources/gallery
and stop later dispatches. Native picker returns can retain local draft selection
in the original form while private UI is hidden; they do not bypass upload checks.
Queue corruption fails closed without overwriting the unreadable evidence.

Limits: local recovery needs this device's intact app storage. A lost local file
cannot recreate an original image; remove an unfinished reservation and choose the
photo again. A deleted visit or permanently inaccessible destination may leave a
retained queue item that cannot be continued; V1 deliberately keeps that evidence.
Unsubmitted/discarded picker copies can remain local; there is no broad scavenger.

## Deployed backend

Migration `20261022002000_visit_photos.sql` creates one private `visit-photos` bucket,
an RLS-protected metadata table and authenticated authorization/command/read RPCs.
Its exact reviewed source was deployed once successfully to the existing GroupBite
project after the earlier guarded attempt aborted before any migration statements.
The source SHA-256 remains
`7c9685de684a3cfbba5912a5088f956bc24c1f8fce3b8d30307896ecbd390598`.
Read-only installation verification confirmed the private bucket, metadata schema,
four exact RPC definitions/grants, two scoped Storage policies and atomic migration
history registration. Existing rows, schema and permissions were preserved.
The bucket accepts JPEG only, with a 5 MiB per-object limit. Exact stored byte sizes
and MIME types must match the reservation before an attachment is reported ready.
Storage INSERT RLS intentionally tolerates its permission preflight's partial
metadata; bucket limits and completion reads enforce the file contract.

Object names are `<uploader UUID>/<photo UUID>/image.jpg` and `thumbnail.jpg`.
Policies authorize the exact name through its reserved visit. No public access,
signed URLs, UPDATE/upsert or client Storage DELETE policy is introduced. Images
use authenticated requests and `expo-image` with disk caching disabled. Server
authorization checks current group membership on each new request. Previously
delivered pixels cannot be recalled, so the UI also clears them at existing gates.

Mutation RPCs follow existing parent-first locks, recheck scope/management rights
and group admission IDs, serialize capacity checks and preserve revisioned removal.
Personal visits remain owner-private regardless of group ownership. Visit deletion
cascades metadata, revoking byte access without changing existing visit writers.

Removal immediately revokes access; physical Storage bytes are retained. A later
separately reviewed Storage API garbage collector must reclaim tombstones and
objects orphaned by visit/account deletion. Do not delete `storage.objects` rows by
SQL, configure an automatic purge, or run a historical cleanup script as part of
this phase. No garbage collector is deployed or enabled here.

The initial catalog guard compared differently rendered PostGIS types/generated
expressions because the writer's search path included `extensions` and the read-only
role's did not. Pinning the transaction search path made the full catalog comparison
exact without ignoring fields. That guard passed as the writer inside an explicit
read-only transaction before the successful submission. The verified application
snapshot was reused after confirming its data/history still matched; Storage was
empty at deployment. The snapshot excludes Storage bytes and full Auth/platform
recovery, and managed backups/PITR were unavailable. It is not a backup of photos
uploaded during subsequent acceptance.

Manual upload acceptance and private/group separation passed. A real two-account
test of this private photo's metadata and Storage denial remains **unverified**:
only one existing normal account session was safely available, so that check was
stopped without changing sessions or substituting privileged access. The isolated
SQL authorization checks are supporting evidence, not that missing hosted test.

## Native visit-date calendar

Unified Add and personal/group visit editing use the shared `VisitDateField` and
Expo SDK 54-compatible `@react-native-community/datetimepicker` 8.4.4. Tapping the
field dismisses the keyboard and expands the native iOS calendar. Month/year
navigation supports historical dates; Today, Done and Clear keep selection simple
and optional. New Add visits retain today's local default. Opening/closing a field
does not replace an existing or absent edit date.

Dates remain `YYYY-MM-DD` or null in existing payloads. Local-noon conversion and
local date getters avoid UTC shifts, including around DST. Existing validation,
account/revision checks, save recovery, dirty-form guards and navigation remain in
place. The development build was rebuilt in place without clearing app data.
`/dev-visit-date` previews the actual shared field using screen-local state only.

## Local validation and review

`tests/visit-photos.cjs` exercises actual recovery/native-adapter code with synthetic
boundaries. `tests/visit-photo-ui.cjs` exercises actual Add/photo TSX composition.
Coverage includes explicit consent, receipt gating, journal failure, partial/lost
uploads, read-only reconciliation, restart/account/background handling, locks,
picker-return retention, image dimensions/metadata and shared-file lifetime.

The disposable PostgreSQL runner supports `--visit-photos`, applying migrations
1–20 on a fresh private Unix socket with synthetic Auth and Storage SQL tables.
It covers private/group RLS, exact scopes, preflight metadata, partial/wrong-size
objects, capacity, membership removal/rejoin, management rights, tombstones,
visit deletion, actual concurrent lock waits, historical preservation and rollback.
All previous SQL/client save and membership regressions remain in the runner.

```sh
node tests/visit-photos.cjs
node tests/visit-photo-ui.cjs
node supabase/tests/validate_group_apple_place_ids.mjs \
  --postgres-bin /absolute/local/postgres/bin \
  --pg-module /absolute/local/pg/lib/index.js --visit-photos
```

The signed-in iPhone 16 Pro / iOS 18.3 simulator was rebuilt in place, retaining
app storage/session. `/dev-visit-photos` is an authenticated, development-only
visual harness using the production thumbnail strip, picker and gallery. It never
calls save/Storage APIs or stages upload jobs. Public sample photos are bundled
only for that preview; the normal UI contains no sample attachments.

A temporary native UI test selected two default simulator photos and verified both
selection controls. Native inspection confirmed 1600×1200 / 1600×1068 images and
480×360 / 480×320 thumbnails, with EXIF absent after the explicit stripping pass.
Initial automation used an unavailable remote-picker accessibility query; the
successful test used coordinates for the known default tiles. These are selection
and rendering checks, not proof of hosted transfers or every physical gesture.

Initial photo validation: 186 focused offline checks passed across navigation/auth,
private visits, Add/drafts/recovery/safety, UI and photo suites. TypeScript,
uncached lint, tracked/new-file/context whitespace checks passed. The disposable
SQL run produced 94 PASS lines, including real photo/membership lock races and
migration preservation. Native large-text review checked scale 2.143 and corrected
confirmation-action wrapping; normal text size (scale 1) was restored. Normal
preview/gallery controls, next-photo navigation and cancellable removal were checked.
The native calendar was subsequently checked in the iPhone 16 Pro simulator:
opening without a keyboard, selecting a past day, clearing, Today, and previous/next
month navigation all passed. Large-text review passed and the original text size
was restored. Six focused offline calendar checks cover five timezones, DST,
saved/null dates, Add/edit payloads, disabled state and dirty exits. Relevant Add,
personal/group safety, UI/navigation/auth, TypeScript, uncached lint and whitespace
checks passed after integration. The user then approved manual calendar acceptance.

Both preview routes are gated by `__DEV__` and the existing authenticated app layout;
they are absent from normal product navigation and the auth-return allowlist.
They never create visit or photo metadata. The public sample assets are used only
by the photo preview; no real photo, token, session or recovery journal is bundled.
The consolidated review added a focused regression checking both preview routes
with development mode disabled: no rendered UI, requests or local writes, and no
allowed auth return. All seven photo UI integration checks and targeted lint pass.
The existing broader test evidence was reused; no SQL or hosted procedure was rerun.

Private review gallery: `/private/tmp/groupbite-phase-g/review.html`.
Captures and logs are in that directory. Calendar evidence is under
`/private/tmp/groupbite-date-picker/`; deployment verification is archived privately
alongside the existing predeployment application snapshot, outside Git.

Remaining limits include the real cross-account metadata/Storage check above,
broader device/VoiceOver/HEIC/iCloud coverage, and hosted membership-revocation or
response-loss scenarios not established by isolated tests. Physical Storage cleanup
is separate and is not implemented or scheduled. Fault scenarios use isolated
fixtures; real recovery storage and hosted faults are untouched.

Implementation references: [Expo picker](https://docs.expo.dev/versions/latest/sdk/imagepicker/),
[Expo image manipulation](https://docs.expo.dev/versions/latest/sdk/imagemanipulator/),
[Supabase private downloads](https://supabase.com/docs/guides/storage/serving/downloads),
[Storage authorization](https://supabase.com/docs/guides/storage/security/access-control),
[Storage upload preflight/completion source](https://github.com/supabase/storage/blob/master/src/storage/uploader.ts).
Preview images: Unsplash photo IDs `1546069901-ba9599a7e63c`,
`1565299624946-b28f40a0ae38`, `1555396273-367ea4eb4db5`.
