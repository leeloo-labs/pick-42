# Overnight implementation checkpoint

User authorized implementing the holistic review in priority order overnight, with usage conservation. Starting usage: 9% remaining. Stop starting tasks at 3% remaining or earlier if the next task cannot be completed and verified. Never redeem reset credits. Check usage between tasks. Pause the overnight automation by 9 AM Eastern on September 6 or when low on usage.

Automation: `pick-42-overnight-improvements` (hourly, current task).

## Queue

1. Complete: deck/recipe readiness, transparent build coverage, shared legendary and support evidence against the final deck. 187 tests passed; syntax and production web build passed. Browser fixtures verified disabled incomplete candidates and 40-card unrated builds with no numerical score. Recipe progress storage is preserved.
2. Complete: isolated browser and desktop log sessions; 11 deterministic tests cover delayed reads, stop, rotation, UTF-8 boundaries, initial failure, revoked access, and desktop file replacement/short reads. Historical scans now complete before reviews arm, including after rotation. Dropped browser snapshots also discard stale reads. Full suite: 198 passing; syntax and production web build passed.
3. Complete: a shared local-save retry queue retains the latest unsaved preferences/reviews, browser imports/catalog/log handles, and renderer recipe progress. Persistent notice works in full and compact views. IndexedDB saves wait for transaction commit; clipboard denial never reports COPIED and denied paste keeps existing text. Five regression tests added; full suite 203 passing. Browser quota/clipboard fixture verified step progress, visible notice, and retry recovery; normal browser startup has no warnings/errors.
4. Next: set-specific import profiles with conservative migration and always-accessible preparation.
5. Saved draft decisions, comparison timeline, replay benchmark; then evaluate confidence calibration.
6. Local backup/restore and distribution improvements. Notarization requires existing authorized signing credentials; do not purchase services or invent credentials.

Existing trust fixes are committed as `3025a1e` on `codex/product-trust-review`. Finish coherent work in tested commits. Merge and release validated user-facing work through `npm run release:mac` when closing a batch, avoiding repeated packaging between immediately adjacent tasks. Keep a morning record of what shipped, validation, remaining work, and remaining usage.
