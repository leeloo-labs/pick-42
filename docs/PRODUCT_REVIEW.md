# Pick 42 — holistic product review

Baseline: **0.1.9**, commit `8a88e15`. Changes in this review are local to `codex/product-trust-review`; they have not been released.

## Product judgment

Pick 42 has a coherent purpose: help a limited player make a defensible pick, turn the resulting pool into a deck, and learn from visible game evidence. Its strongest features are the contextual/raw comparison, explicit lane policy, OUT markings, Arena-shaped deck board, and deterministic Recipe Mode. The restrained review language is part of the product's value. Preserve it.

The next investment should be **consistency and inspectability across the whole draft**, followed by a way to evaluate recommendation changes. More heuristic bonuses are less valuable while setup can misrepresent the active data, the deck builder applies different construction rules from the draft engine, and there is no saved decision timeline to explain a disputed pick.

This is a judgment from code inspection, local probes, and browser testing. It is not evidence that Pick 42 improves win rate, nor a study of player adoption or competing products.

## Improvements implemented in this review

| Problem reproduced | Change | Why it matters |
| --- | --- | --- |
| In a sample draft, LOG → Rescan changed the status to an error and removed the sample ratings. Import success notifications had the same coupling. | The shared companion now owns an explicit session mode. Only starting a demo or a log session changes which ratings are used. Live sessions discard the demo view and ignore delayed Next Sample actions. | Notifications no longer change recommendation inputs. Starting a sample also preserves the user's selected prep set. |
| A paused pack still exposed contextual/raw rank numbers and, for rated cards, scores. | Paused view models return cards in original pack order with recommendation scores and ranks cleared. Both renderer views keep source measurements visible. | “Paused” now means there is no displayed pick recommendation. |
| The coverage gate supported partial data, but its partial-status message was hidden when rankings were enabled. | The status bar explicitly shows PARTIAL DATA, the number of cards rated, and the number covered by both sources. | Single-source recommendations carry a visible qualification. |
| SET PREP could approve a matching all-types import while the exact draft-type slot contained another set's data. ANY could approve an unrelated format slot. Matching names with blank win rates also counted as ready. | Preparation and live imports share the same slot resolver. Prep counts usable matching statistics, exposes the chosen file and slot, and labels missing set verification as pending. Its copy distinguishes import presence from future pack coverage. | The checklist measures the data the app will actually use and no longer promises that both imports are mandatory for partial rankings. |
| Component display rules could override the browser's default hidden behavior, exposing sample controls in a live view. | A shared hidden rule now takes precedence. Missing-import tooltips also identify missing imports instead of naming sample data. | Controls and labels follow the session state. |

The scoring weights, draft strategy, review verdicts, saved-data formats, and public download are unchanged. Ten regression tests cover the new session and readiness cases. The README describes the corrected behavior.

## Highest-priority remaining work

### 1. Make deck construction uphold the draft engine's rules

**Confirmed:** `buildLimitedDecks` returns incomplete candidates with `available: false`, but `chosenBuild`, the deck tabs, and Recipe Mode do not filter or block them. A synthetic 23-card pool spread across five colors produced suggestions totaling **27, 32, and 27 cards**. They still had numerical build scores. Separately, 23 unrated white creatures produced a complete deck scored **32.0** with **0/23** source coverage. A complete card count and a data-supported recommendation are different properties.

**Confirmed:** the deck selector's duplicate adjustment is only `(duplicateCount - 1) × 1.5` after two existing copies. It has no separate legendary case. Its source scoring uses an empty pool, so the draft engine's pool-aware legendary penalty does not carry into deck selection. A browser sample produced four copies of one legendary and three of another; that sample alone does not establish the correct cuts, but the missing construction rule is directly visible in the code.

The deck selector also uses a narrower role model than the draft engine's bidirectional support checks. Shared concepts such as subtype requirements, Equipment packages, and legends should be evaluated against the proposed final deck, including what disappears when a support card is cut.

**Proposed change:** only offer complete builds as actionable recipes; show incomplete candidates as pool-depth information with the exact shortage. Give build data coverage its own label and withhold an evidence-based build score when data is absent. Extract shared construction checks for legendary copies and explicit support requirements, then run them against the selected deck.

**Acceptance:** no recipe targets fewer than 40 cards; unrated builds are unmistakable; a third ordinary legendary receives an inspectable penalty; cutting the only enabler updates the payoff's evaluation. Preserve manual lane authority.

Code: [build generation](../src/draft/deck-builder.cjs), [build selection](../src/draft-renderer/views/shared.js), [Recipe Mode](../src/draft-renderer/views/build.js).

### 2. Isolate log reads by session and make persistence failures visible

**Confirmed by a controlled asynchronous probe:** starting browser log A, starting B before A's read resolves, then resolving A emitted **“old log”** and created two polling timers. The shared `reading`, `handle`, and `offset` variables do not identify the session that owns an in-flight read. The desktop tailer has a similar shared-state structure and deserves equivalent tests; this review did not reproduce the desktop race.

**Confirmed by inspection:** the browser storage adapter suppresses localStorage write failures, and clipboard copying can report success after a denied write. That protects the active session from crashing but can make “saved” or “copied” misleading. Recipe progress uses a different write path that can throw. For a local-first product, persistence is a core user promise.

**Proposed change:** give each watcher start a generation token and discard callbacks from replaced sessions. Report initial-scan failure before arming review. Test truncation, replacement during a read, split UTF-8 characters, revoked access, and old reads resolving after Stop. Then add a single truthful saved/unsaved status and a local backup/restore flow for imports, corpus, preferences, and completed reviews.

**Acceptance:** only the current log can feed a session; only one poll loop survives; failed writes leave the last good data intact and show a recoverable error. Backup files remain entirely under the user's control.

Code: [browser log poller](../src/web/log-poller.js), [desktop log tailer](../src/core/log-tailer.cjs), [browser shell](../src/web/main.js), [local stores](../src/draft-app/local-store.cjs).

### 3. Give each set its own preparation profile

**Confirmed:** ratings are stored by source and draft type, not by set. Importing SOS Quick into a slot replaces HOB Quick. Selecting an old set can therefore require reimporting its files. SET PREP is inside the empty-pack view, while startup opens a sample draft. In the inspected 1280×720 viewport, part of the checklist was below the initial fold.

**Proposed change:** keep ratings under **set → draft type → source**, with an always-accessible PREP entry. Show the selected log, card-name coverage, active export names, rated-card counts, and exact/cross-format corpus availability in one place. Distinguish “one trophy deck saved” from “enough matching evidence to influence advice.” Keep images and trophy evidence visibly optional to ratings coverage.

Do not replace the local import workflow with scraping. Make authorized imports easier to understand and reuse. Migrate existing slots conservatively: preserve files, mark ambiguous set identity as unverified, and avoid guessing.

**Acceptance:** switching HOB Quick → SOS Quick → HOB Quick restores the original imports; a first-time user can identify the next setup step without opening four separate menus. Measure task completion locally during usability sessions; no telemetry upload is needed.

Code: [source store](../src/draft-app/source-imports.cjs), [stored import paths](../src/draft-app/local-store.cjs), [prep view](../src/draft-renderer/views/draft.js).

## The strongest new product feature: a local draft decision timeline

Save a compact snapshot at each decision: visible pack, active pool, OUT choices, lane policy, source fingerprints, recommendation pair, material adjustments, and the actual pick once Arena records it. Let the player bookmark a decision and compare their pick with the recommendation after the draft.

The useful question is “What made these two cards differ at this point?” A comparison could show raw-data difference, lane fit, missing support, duplicate pressure, and curve need in a short table. Preserve the exact evidence used at the time, as game reviews already do for their source statistics.

This feature would also create a **local replay benchmark** for development. Turn disputed picks and sanitized fixtures into named scenarios. A model update can then show which decisions changed and why. Keep actual later packs separate from hypothetical alternatives: taking a different card changes the pool, and a replay cannot claim to reconstruct how other players would have drafted.

Start with saved decisions and comparison, then add counterfactual inspection. Keep the player in control and never automate Arena input.

### Why calibration should follow that benchmark

A controlled probe used two otherwise identical three-mana creatures and matching statistics from both sources:

| Input | Games per source | Displayed sample confidence | Raw score |
| --- | ---: | ---: | ---: |
| 70% win rate | 12 | 35% | 94.8 |
| 61% win rate | 10,000 | 89% | 73.6 |

The raw-score formula retains **89.6%** of the distance from neutral even at its minimum confidence: `0.84 + 0.35 × 0.16`. This is a weak adjustment for a thin sample. It does not make the first card intrinsically wrong, but it shows that the confidence percentage is not a calibrated probability that the ranking is correct. The lane percentage is likewise a heuristic evidence score.

Evaluate a stronger prior or sample-size shrinkage against held-out, authorized data and a curated replay set. Also inspect 17Lands GIH/GD/GP basis differences and disagreement between sources. Do not tune weights until one attractive example looks right, and do not treat agreeing with trophy picks or winning a game as proof of recommendation quality.

Code: [raw confidence calculation](../src/draft/blend-engine.cjs).

## Practical sequence

1. Review and release the bounded trust fixes in this branch through the normal macOS release process.
2. Fix incomplete recipes and missing deck-construction invariants; isolate log-session reads. These are correctness work with concrete regression cases.
3. Add set profiles and accessible preparation. Test the first successful live draft with someone unfamiliar with the project.
4. Add saved decision comparisons and the replay benchmark, then evaluate confidence calibration and heuristic changes.
5. Make backups and distribution smoother before broadening the audience. The current download instructions explicitly require a macOS first-launch approval; signing/notarization is a release investment to plan, rather than another strategy feature.

Keep the match overlay and positional OCR experimental. The shared companion and unchanged renderer across Electron/web are sound architectural choices. Improve the seams and shared domain rules before splitting the engine into more services or adding configuration controls.

## Validation and limits

- Baseline: **170/170 tests passed**. After changes: **180/180 passed**; syntax checks and the production web build passed.
- Browser: reproduced and retested LOG → Rescan during a sample; completed a 42-pick sample; inspected generated primary/alternative decks; exercised Recipe Mode skip, undo, and return.
- Browser fixtures: inspected a live-shaped pack with insufficient coverage, verified both contextual/raw views withheld rankings, checked the PARTIAL DATA label, and inspected SET PREP's measured counts and partial guidance. These fixtures used synthetic local data, not a real live event.
- Probes: measured confidence behavior, unrated/incomplete deck outputs, and the browser log replacement race. These findings remain follow-up work, not fixes claimed by this branch.
- No new live Arena game, Electron window workflow, fresh-account usability study, held-out performance evaluation, macOS package, or release was exercised. Browser inspection supplements the shared-module tests; it does not establish full platform parity.

The existing project memory also contains a policy inconsistency: one invariant requires both ratings sources before ranking, while the newer coverage rule, README, implementation, and tests permit visible partial rankings. This review follows the established partial-data behavior. Consolidate that wording so future changes have one authoritative rule.
