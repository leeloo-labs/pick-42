# Overnight implementation checkpoint

User authorized implementing the holistic review in priority order overnight, with usage conservation. Starting usage: 9% remaining. Stop starting tasks at 3% remaining or earlier if the next task cannot be completed and verified. Never redeem reset credits. Check usage between tasks. Pause the overnight automation by 9 AM Eastern on September 6 or when low on usage.

Automation: `pick-42-overnight-improvements` (hourly, current task).

## Queue

1. Complete: deck/recipe readiness, transparent build coverage, shared legendary and support evidence against the final deck. 187 tests passed; syntax and production web build passed. Browser fixtures verified disabled incomplete candidates and 40-card unrated builds with no numerical score. Recipe progress storage is preserved.
2. Complete: isolated browser and desktop log sessions; 11 deterministic tests cover delayed reads, stop, rotation, UTF-8 boundaries, initial failure, revoked access, and desktop file replacement/short reads. Historical scans now complete before reviews arm, including after rotation. Dropped browser snapshots also discard stale reads. Full suite: 198 passing; syntax and production web build passed.
3. Complete: a shared local-save retry queue retains the latest unsaved preferences/reviews, browser imports/catalog/log handles, and renderer recipe progress. Persistent notice works in full and compact views. IndexedDB saves wait for transaction commit; clipboard denial never reports COPIED and denied paste keeps existing text. Five regression tests added; full suite 203 passing. Browser quota/clipboard fixture verified step progress, visible notice, and retry recovery; normal browser startup has no warnings/errors.
4. Complete: per-set import profiles in both shells, preserved labeled legacy imports, conservative path retention, PREP navigation/modal, log and card-name context, and explicit optional trophy/image evidence. Live ratings stay on the draft set while preparing another set. Six regression cases added; full suite 209 passing, syntax and web build passed. Browser checked PREP from an active sample at 1280×720.
5. Decision capture and comparison implemented in this continuation: immutable recorded advice after a copy-aware visible pool selection, conditional Pick Two pair, bookmarked comparisons, and the last ten live drafts stored locally (samples in memory). Seven regression tests added; 216 tests pass. Replay benchmark and calibration evaluation remain queued. Released in 0.1.11.
6. Local backup/restore and distribution improvements. Notarization requires existing authorized signing credentials; do not purchase services or invent credentials.

Existing trust fixes are committed as `3025a1e` on `codex/product-trust-review`. Finish coherent work in tested commits. Merge and release validated user-facing work through `npm run release:mac` when closing a batch, avoiding repeated packaging between immediately adjacent tasks. Keep a morning record of what shipped, validation, remaining work, and remaining usage.


## First release batch

The initial audit fixes and priorities 1–4 are complete in five focused commits through `97a2aa7`. Released **0.1.10** at commit `df8db06` through the required macOS workflow. GitHub latest is v0.1.10, the release is public (not a draft), and its uploaded `Pick-42-mac-arm64.zip` SHA-256 matches the local package: `c7ac1fccc410a98b9ed685c93c23c222f00c50ce74fa381259ba10af3cd4b54f`. No release repair is pending. Check current usage before beginning the larger decision-history work. The most recent usage snapshot still reports 8% remaining; it may not reflect the cost of this active turn until the turn settles. Preserve sufficient allowance for a complete next task, tests, and another release. It is preferable to let the overnight continuation reassess a fresh usage snapshot than start a large feature near the account limit.

Working tree is on clean `main` after the first batch. Start a new `codex/` branch for the next implementation. The Applications launcher already points to this checkout.

Next substantive task: a replay benchmark, followed by calibration evaluation. Saved local draft decisions and comparison shipped in 0.1.11. No scoring calibration change has been made. Backup/restore and signing/notarization remain queued. Do not claim those are complete.


## Second continuation

Started with 7% account allowance remaining. Implemented the bounded decision-history feature on `codex/draft-decision-history`. Browser checks cover recorded advice/selection, comparison rows, bookmarking, and bookmark filtering. No scoring weights changed. Released 0.1.11 at `070819f`. The public asset is uploaded, the release is not a draft, and the macOS ZIP digest matches the locally verified package: `fc846ddc4ea38efe234f48fa2515427bedc1618f24be4c9962673d7732fab5ee`. No release repair is pending. Latest reported usage at this boundary: 7% remaining. Next continuation should check usage again before taking the replay benchmark.
