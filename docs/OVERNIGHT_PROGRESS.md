# Overnight implementation checkpoint

User authorized implementing the holistic review in priority order overnight, with usage conservation. Starting usage: 9% remaining. Stop starting tasks at 3% remaining or earlier if the next task cannot be completed and verified. Never redeem reset credits. Check usage between tasks. Pause the overnight automation by 9 AM Eastern on September 6 or when low on usage.

Automation: `pick-42-overnight-improvements` (hourly, current task).

## Queue

1. Complete: deck/recipe readiness, transparent build coverage, shared legendary and support evidence against the final deck. 187 tests passed; syntax and production web build passed. Browser fixtures verified disabled incomplete candidates and 40-card unrated builds with no numerical score. Recipe progress storage is preserved.
2. Complete: isolated browser and desktop log sessions; 11 deterministic tests cover delayed reads, stop, rotation, UTF-8 boundaries, initial failure, revoked access, and desktop file replacement/short reads. Historical scans now complete before reviews arm, including after rotation. Dropped browser snapshots also discard stale reads. Full suite: 198 passing; syntax and production web build passed.
3. Complete: a shared local-save retry queue retains the latest unsaved preferences/reviews, browser imports/catalog/log handles, and renderer recipe progress. Persistent notice works in full and compact views. IndexedDB saves wait for transaction commit; clipboard denial never reports COPIED and denied paste keeps existing text. Five regression tests added; full suite 203 passing. Browser quota/clipboard fixture verified step progress, visible notice, and retry recovery; normal browser startup has no warnings/errors.
4. Complete: per-set import profiles in both shells, preserved labeled legacy imports, conservative path retention, PREP navigation/modal, log and card-name context, and explicit optional trophy/image evidence. Live ratings stay on the draft set while preparing another set. Six regression cases added; full suite 209 passing, syntax and web build passed. Browser checked PREP from an active sample at 1280×720.
5. Decision capture and comparison implemented in this continuation: immutable recorded advice after a copy-aware visible pool selection, conditional Pick Two pair, bookmarked comparisons, and the last ten live drafts stored locally (samples in memory). Seven regression tests added; 216 tests pass. Replay benchmark and initial confidence sensitivity evaluation completed in the third continuation. Production calibration changes remain deferred pending empirical validation. Released in 0.1.11.
6. Complete: local backup/restore, released in 0.1.12. Distribution signing assessment completed; notarization remains dependent on available credentials. Notarization requires existing authorized signing credentials; do not purchase services or invent credentials.

Existing trust fixes are committed as `3025a1e` on `codex/product-trust-review`. Finish coherent work in tested commits. Merge and release validated user-facing work through `npm run release:mac` when closing a batch, avoiding repeated packaging between immediately adjacent tasks. Keep a morning record of what shipped, validation, remaining work, and remaining usage.


## First release batch

The initial audit fixes and priorities 1–4 are complete in five focused commits through `97a2aa7`. Released **0.1.10** at commit `df8db06` through the required macOS workflow. GitHub latest is v0.1.10, the release is public (not a draft), and its uploaded `Pick-42-mac-arm64.zip` SHA-256 matches the local package: `c7ac1fccc410a98b9ed685c93c23c222f00c50ce74fa381259ba10af3cd4b54f`. No release repair is pending. Check current usage before beginning the larger decision-history work. The most recent usage snapshot still reports 8% remaining; it may not reflect the cost of this active turn until the turn settles. Preserve sufficient allowance for a complete next task, tests, and another release. It is preferable to let the overnight continuation reassess a fresh usage snapshot than start a large feature near the account limit.

Working tree is on clean `main` after the first batch. Start a new `codex/` branch for the next implementation. The Applications launcher already points to this checkout.

Next substantive task: local backup/restore. The replay benchmark and initial calibration sensitivity evaluation are complete; production calibration changes require authorized held-out outcome evidence. Saved local draft decisions and comparison shipped in 0.1.11. No scoring calibration change has been made. Backup/restore and signing/notarization remain queued. Do not claim those are complete.


## Second continuation

Started with 7% account allowance remaining. Implemented the bounded decision-history feature on `codex/draft-decision-history`. Browser checks cover recorded advice/selection, comparison rows, bookmarking, and bookmark filtering. No scoring weights changed. Released 0.1.11 at `070819f`. The public asset is uploaded, the release is not a draft, and the macOS ZIP digest matches the locally verified package: `fc846ddc4ea38efe234f48fa2515427bedc1618f24be4c9962673d7732fab5ee`. No release repair is pending. Latest reported usage at this boundary: 7% remaining. Next continuation should check usage again before taking the replay benchmark.


## Third continuation

Started with 7% remaining. Added the developer-only offline replay benchmark: ten curated synthetic scenarios, independently stated policy contracts, reviewed baseline, full before/after rank/score/reason/pair changes, input-change detection, and safe explicit baseline updates. Four benchmark tests bring the suite to 220 passing. `npm run replay:check` reports zero failures and zero drift. A diagnostic prior-sensitivity evaluation is recorded in docs/REPLAY_BENCHMARK.md; it supports further evaluation, not a production weight change. No runtime application behavior changed, so the latest app remains 0.1.11. Next: local backup/restore, then assess available signing credentials without purchasing or changing accounts.


## Fourth continuation

Started with 6% remaining. Implemented portable local backup/restore in both shells, available in PREP. Additive preview keeps existing conflicts, validates all sections before writes, preserves ratings bases and sample counts, and routes failed saves through retry. Nine regression tests cover round trips, provenance, retention, malformed inputs, stale confirmations, and quota recovery; 229 total tests pass. Syntax, production web build, and all ten replay scenarios pass with no ranking drift. Live UI inspection was unavailable because the Mac was locked; automated control tests passed.

A read-only signing-identity check returned zero valid identities. No credentials were created or purchased. Notarization remains dependent on an available Developer ID identity and authorized notarization credentials; the locked Mac may affect credential availability. Production calibration remains dependent on held-out outcomes. Both are deferred rather than guessed. Release 0.1.12 is the next required step for this batch; verify publication and checksum before claiming it shipped.


## Overnight stopping point

Published **0.1.12**, release commit `84fbcb2`, implementing backup/restore from `a1c4311`. The public latest release is not a draft and its fixed-name ZIP matches the locally verified package: `77581862559d4da24e7e899c91c7c3425cf4b110f9bf636959eed60d6241f299`. The extracted app passed `codesign --verify --deep --strict`. No release repair is pending. Main is the current checkout, and the Applications launcher uses it.

The last account snapshot reports 6% remaining. Pause the overnight automation at this tested release to preserve allowance for morning feedback. No reset credits were used. The concrete correctness, preparation, saved-history, benchmark and backup batches are complete. Fresh-user live testing, empirical calibration, available signing/notarization credentials, and broader counterfactual replay across subsequent picks remain follow-ups; they are not claimed as implemented. Do not start another overnight batch or resume after reset without a user request.
