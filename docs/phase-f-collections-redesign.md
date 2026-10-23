# Phase F — Navigation and collection browsing

Implemented from clean `main` at `3270a8d` on October 22, 2026.
The user approved the visual redesign and final compact My Places feature.
This work is approved for a local commit only; no push is authorized.

The tabs are **Home, Map, Add, Collections, Account**. Map owns the existing
`/saved-map` root, initially All Saved. It reads private personal places and
currently accessible groups through the existing checked reader. Its iOS/development
gate remains; unsupported builds show an explanation without reading map data.
Collections keeps `/groups` for URL compatibility. My Places and its personal
details now belong to that stack. My Places remains account-private data, with
no Supabase group, membership or permission changes.

Collections introduces a compact terracotta My Places feature and a clearly labeled
Your Groups section. Group rows share a divided surface, retain Owner/Member
labels and lead to the existing group screen. Create and Join remain full-screen
parent-stack forms. Creation recovery, duplicate locks and guarded tab/root exits
continue to use the existing providers and leave guard. The final feature is about
33% shorter at normal text size, with reduced vertical spacing and the description
“Your own food memories.” Its color, serif title, private identity and action remain.

Personal and group browsers share serif headings, a restaurant/visit count rail,
fine dividers and spacious restaurant rows. Addresses and cuisine wrap; average
ratings have a distinct badge labeled `avg / 5`, and unrated restaurants say so.
These are destination-specific counts, not deduplicated cross-collection totals.
Group member/invite/ownership/request controls are under **People & settings**;
pending request counts remain visible on the disclosure. The actual authorization,
membership incarnation checks, revision checks and mutation handlers are unchanged.

Home puts My Places immediately after the greeting and retains its group previews
and Saved Map shortcut. `/home/my-places` reuses the private browser and Home detail
aliases, so personal browsing and editors retain Home Back context. Map detail links
keep their own aliases and checked details. A bounded native camera read immediately
before opening a map detail preserves center, altitude, heading and pitch; stale
access/read snapshots cannot navigate, repeated taps share a lock, and a failed or
400 ms native read falls back to the existing region restoration. Nothing persists
this camera or requests device location. Filter/selection stay in account-scoped
screen memory. Normal guarded tab presses select roots; they do not clear root-local
map filters. Home's separate map still has contextual Back.

Large-text browsers use a smaller base heading above 1.5× scale, with system scaling
still enabled. Only the scaffold remounts on a font-scale change to remeasure native
text; data controllers, membership state and recovery providers stay mounted.

## Visual review

Actual iPhone 16 Pro / iOS 18.3 simulator captures and a local gallery are at
`/private/tmp/groupbite-phase-f/review.html`. Screenshots remain outside Git.
The final compact-card captures are also at `/private/tmp/groupbite-phase-f-compact/`.
The gallery includes Home, Collections, My Places, Owner/Member group views,
settings, Map and accessibility-large text (runtime scale 2.143). The original
Large text preference is restored. Existing session, data and recovery are retained.

Suggested read-only walkthrough:

1. Open Collections. Compare the private feature, group roles and Create/Join actions.
2. Open My Places, inspect rated/unrated rows and visit totals, then open a restaurant
   history. Back should restore My Places, then Collections.
3. Open a group. Browse restaurants, expand People & settings and inspect the current
   role's controls. Avoid generating invites or changing membership during visual review.
4. Open Map, filter to a group and select a restaurant. Pan, zoom, rotate or tilt;
   open a collection detail and return. The same map view/filter/selection should return.
5. Switch to Home and use its My Places shortcut and group previews. Their Back paths
   stay within Home. Reselect Collections while browsing a detail to return to its root.
6. Open Create/Join, inspect the form and use Back/Cancel without submitting. Try the
   keyboard and a physical edge swipe as part of the remaining manual interaction review.

## Validation and boundaries

197 focused offline checks passed across navigation/leave safety and Add result destinations,
authentication/deep links, personal histories/account isolation, group/Join permissions,
save safety/recovery, collection UI, Home UI and Saved Map. TypeScript, uncached lint
and whitespace checks passed for this tree. The existing test harness models
HTTP/native boundaries; it does not establish hosted mutation acceptance.

Simulator browsing verified Collections/private/Home returns, Owner/Member control
visibility, clean Create/Join Back, root reselect and full native camera/filter/selection
restoration after detail Back. No saves, journal clearing, resets, account switches,
membership changes, database work or hosted application writes were performed.
The retained confirmed Add recovery was not cleared to exercise its tab press; Add
root/result behavior remains covered offline. Physical swipe/VoiceOver, actual keyboard
typing and smaller-device review remain manual. No native rebuild was needed.
