# Pick 42 project memory

## Identity and ownership

- Product name: **Pick 42**. The name refers to the final selection in a normal MTG Arena draft: three 14-card packs.
- Pick 42 is proprietary software owned by **Leeloo Labs LLC**.
- Canonical repository: `https://github.com/leeloo-labs/pick-42`.
- The product was initially called Arcane. The legacy `arcane-arena-companion` user-data directory now migrates once to `Pick 42` on boot (`src/draft-app/migrate-user-data.cjs`: an atomic rename plus a rewrite of settings paths that pointed inside it; never merged, never overwritten), and the remaining internal identifiers have been renamed to `pick42`. The only place `arcane` may still appear is the migration module itself, which must keep recognizing the legacy directory name.

## Product direction

Pick 42 is a local-first MTG Arena drafting companion. The match companion remains a working prototype, but current product development is focused on draft recommendations and limited deck construction because Arena games move too quickly for the match overlay to provide enough value.

The companion must remain transparent and advisory:

- Read only information Arena writes to local logs or displays visibly.
- Do not access private Arena services, reveal hidden information, or automate game/draft input.
- Explain rankings through source metrics and visible contextual adjustments.
- Fail closed when the imported source data is incomplete or does not match the active set.

## Data sources and ranking

- **17Lands:** imported CSV data, including GIH win rate, games in hand, games-not-seen win rate, and IIH when present. IIH may be calculated as GIH WR minus GNS WR when necessary, but never from a fallback basis. When GIH WR is blank (young-set sample suppression), fall back per card through GD WR then GP WR with the matching game count, record `winRateBasis`, and surface it in the 17L reason chip.
- **Untapped:** imported CSV data, including in-hand win rate, in-hand win-rate difference, and sample counts when available.
- Source imports are per draft type: each 17Lands/Untapped CSV is assigned to a format slot (`any`, `premier`, `quick`, `traditional`, `pick-two`; settings key `sourceImportPaths`, legacy single paths migrate to `any`). The live draft resolves its exact format first, then the `any` slot; mismatched-format data is never used silently.
- The coverage gate has a middle state: when at least 90% of a pack is covered by one source but not both, rankings run with a visible `partial` status instead of pausing; packs under 90% single-source coverage still pause.
- **Scryfall:** public set data for card images, Oracle text, and presentation enrichment. Arena group IDs remain the live identity source.
- **Archetype corpus:** authorized local CSV/JSON deck records, including set, format, result, archetype, and main-deck quantities. The corpus may come from a manual export, licensed feed, or offline processing of a licensed public dataset.
- Do not scrape 17Lands or Untapped or depend on undocumented/private APIs.

The blend engine exposes a confidence-aware raw score and one contextual recommendation model. Important invariants:

- Require usable matching rows from both imported statistical sources for at least 90% of nonbasic cards before enabling live rankings.
- Blank statistics do not count as source coverage.
- Basic lands are never ranked as flexible colorless cards.
- Shrink IIH toward zero using sample confidence before it changes a card score.
- Flag reliable extreme draw impact as `HIGH IMPACT`, `POSITIVE IIH`, `DRAW LIABILITY`, or `NEGATIVE IIH`; use `LOW-SAMPLE IIH` when the sample is too weak.
- Lane and matching build names use the set's themed archetype names — Boros Dwarves, Rakdos Amass, Golgari Ferocious, Azorius Recruit, Simic Elves — only when the pool contains at least two cards showing the tribe or mechanic; otherwise the plain guild name stands (`LANE_THEMES` in the blend engine; a new set means new entries there).
- Infer and surface a two-color `LEANING` or `COMMITTED` lane, but make the lane policy the only manual drafting control: lock with no splash, lock while open to a light splash, or stay open. A manual lock is authoritative except for a narrow, data-backed bomb exception.
- Treat premium removal, curve needs, real synergy enablers, duplicate pressure, and splash burden explicitly.
- Apply legend-rule duplicate pressure separately: a second copy may remain playable, while a third ordinary legendary should receive a major, visible deck-construction penalty.
- Hybrid mana can be paid by either color. Gold mana requires every listed color.
- Nonbasic lands are evaluated by the colors they actually produce; an off-plan dual land is not treated as universally colorless fixing. Hybrid cards may satisfy a supported lane through either payable half.
- Hard subtype requirements must be supported by the drafted pool; for example, Dwarven Mattock should be penalized without Dwarfs.
- Archetype-corpus signals must match the live set and event format, require at least four trophy decks and two distinguishing pool cards, shrink for sample size and age, and remain bounded. A reliable corpus match may support lane inference and the unified contextual ranking.
- Lane overrides are local and draft-scoped: lock the inferred lane with no splash, lock it while remaining open to a light premium splash, or stay open. A stale choice must not carry into a different draft.
- Synergy checks are bidirectional. A candidate can require support already in the pool, or satisfy a requirement on a drafted payoff; Equipment and creature subtypes both count when explicitly referenced.
- Created permanents count as synergy material. For example, an Equipment token can enable existing Equip/attach payoffs, and a card that creates Equipment while carrying double strike receives a visible self-contained package bonus.
- The META corpus manager can accumulate individual Arena-format lists copied manually from public 17Lands deck pages. It must require 40 main-deck cards, validate the record against the event trophy threshold, ignore sideboards, reject accidental duplicates, and store entries locally without automating the website.
- The META import can also process a user-downloaded 17Lands public game-data export offline (`src/draft/seventeenlands-dataset.cjs`): it streams the file, derives event records by grouping games per `draft_id` (match results for Traditional Draft), keeps up to 200 most-recent trophy runs with their final-game builds, and writes a normalized JSON corpus into the user-data directory. This is the sanctioned public-dataset path; live scraping of 17Lands or Untapped remains out of bounds.
- Pick Two drafts are a distinct `Pick Two Draft` format (42-card pool: three packs of seven two-card selections), never collapsed into Player Draft, so corpus matching stays format-strict. The contextual view recommends a pair through `recommendPickTwoPair`: the second selection is scored with the first pick added to the pool, and the flagged second card may legitimately differ from the second-ranked row. Live pick-phase shapes are covered by `fixtures/pick-two-live-draft.log`: human drafts announce packs through `Draft.Notify` with a comma-separated `PackCards` string under a session `draftId` that differs from the `CourseId` (the course snapshot links them through its own `DraftId` field, and an in-progress course carries an empty `CardPool` with `CurrentModule: PlayerDraft`), while picks arrive as wrapped `EventPlayerDraftMakePick` requests carrying `GrpIds` plus `Pack`/`Pick` numbers. Pick rounds are deduplicated by round key, never by card value, so a second copy of an already-drafted card stays pickable.
- Do not expose strategy presets or philosophy sliders. Let the user toggle between `CONTEXTUAL` (lane, active pool, curve, synergy, duplicates, and corpus) and `RAW DATA` (confidence-adjusted 17Lands and Untapped performance in a vacuum), and show both ranks and scores together.
- When a committed or locked lane has no eligible main-plan card in the pack, still rank the best fallback but label it `LIKELY SIDEBOARD`, `SPECULATIVE SPLASH`, or `SPECULATIVE PICK` and explain that Pick 42 does not currently expect it to make the deck.
- Show the complete drafted pool as an abbreviated card list. Draft-scoped `OUT` markings remain visible and persisted, but excluded cards must not affect lane inference, recommendations, or generated deck builds.
- Carry an `OUT` choice forward when another copy of the same card appears later in the draft. Apply a visible preference penalty and `LIKELY SIDEBOARD` outlook unless elite raw data, premium removal quality, or a newly live synergy package provides a transparent reason to reconsider.

## Deck builder and UI

- Generate 40-card limited decks, normally with 17 lands; use 16 only for a genuinely low curve with card flow.
- Build suggestions come from the newest unique Arena draft course, not a fixed event-name bucket. Infer the deepest two-color pair dynamically, honor a manual lane when present, then compare a viable splash and the strongest alternative pair.
- Present decks as an Arena-style, seven-column card board with stacked cards, visible quantities, and enlarged hover previews.
- Match Arena's card ordering and color grouping.
- Hybrid cards and matching dual lands use a two-color split treatment without a gold outline. Gold cards retain a gold outline and display both required colors.
- A drafted basic-fetching land (sacrifice: search for a basic land) is a guaranteed one-copy inclusion whenever the build includes no on-color dual land, and in a splash build even alongside a dual. It counts as a flexible source of every deck color.
- Use a warm neutral light theme so white and black cards both remain visually distinct.
- Recipe Mode is the reliable deck-building aid: it gives deterministic add/drop quantity instructions and preserves progress locally.
- The positional OCR overlay remains experimental and disabled in normal startup because Arena grid reordering and scrolling made it unreliable.

## Post-game review

- The draft app arms review only after its initial historical log scan, so an old match cannot be mistaken for a new test game.
- Prefer Arena's exact `CourseDeck.MainDeck` as the deck version; fall back to the selected Pick 42 recipe when the course deck is absent.
- The exact card list determines the version fingerprint, but its archetype label must honor the user's selected Pick 42 build. Never infer Jund merely because a Rakdos deck contains a green hybrid mana symbol.
- Keep the post-game UI ruthless: a compact result/play-draw/turn/mulligan summary, factual mana variance for both players, 17Lands IIH draw quality, and evidence-backed MVP/LVP candidates.
- Track cards through Arena's `ObjectIdChanged` lineage so zone changes cannot count one physical card multiple times.
- Grade mana variance as low, moderate, or high using explicit flood/starvation thresholds. Opponent analysis may use land progression and public cards only; never speculate about hidden cards.
- MVP candidates require attributable visible contribution such as recorded damage. LVP candidates require concrete negative evidence such as a drawn card remaining uncast across multiple turns; never call a zero-damage support card an LVP by default.
- A win or loss by itself is never evidence for a deck change, and IIH is historical correlation rather than causal credit for the result.
- Review contexts snapshot the recommended build (`deck.modeledBuild`) when armed, and reports show a factual build-vs-model diff (added, cut, basic-land shifts) for the registered Arena deck. The deviation is context only: the verdict may suggest a reversible swap back toward the model when concrete negative evidence lands on a card the player added, and may offer the swap as a clearly optional test after a loss, but a deviation plus a result is never itself treated as evidence.
- In the post-game IIH card list, show the complete top-four group with explicit drawn/not-drawn status, plus reliable drawn liabilities at or below −2.0 percentage points; hide everything else near neutral.
- Draw-quality tiers are copy-aware: the summed hypergeometric chance of seeing each top-four card (its copy count, the deck size, the cards actually seen) sets an expected baseline that the summary quotes. `strong` requires beating the baseline by 0.75 drawn cards and `exceptional` by 1.5, so seeing one of three copies is never counted as fortune. Captures without drawn quantities keep the absolute tiers.
- Exclude cards with unverified conditional cost reductions from printed-mana curve evidence, and count stranded evidence by distinct turn rather than by copies in hand.
- Persist completed reviews locally in the legacy Pick 42/Arcane user-data directory; never upload raw game data.
- Games played on another device never reach this machine's log. The current event card offers PLAYED ELSEWHERE steppers that store a manual per-draft record: it counts toward event records, trophies, and wrap-ups (which disclose the manually recorded games), clamps to the format's win/loss caps, and never contributes game evidence. The current draft always has an event card so the record can be entered before the first logged game; sample courses never accept manual records. The reviews store persists `{ reviews, manualRecords }` and still reads the legacy bare-array shape.

## Voice and copy

Pick 42's restrained, evidence-first copy is a deliberate product feature, not a placeholder tone. Every user-facing string must survive these rules:

- State what the data shows, never what it cannot show. Confidence lives in the numbers and labels; the prose stays neutral.
- Verdicts describe evidence and offer reversible actions. They never issue commands, promise outcomes, or dramatize.
- When there is no defensible evidence, say exactly that instead of filling the space with a guess — as in "No defensible LVP: Pick 42 will not call a card bad merely because it was drawn or died."
- Results and deviations are context, not verdicts: "Deviations are context, not verdicts", "one loss alone is not evidence against your changes". A single game never argues for a deck change on its own.
- Correlation language stays correlational: "IIH is historical correlation, not causal credit."
- Uncertainty is labeled, never hidden: LIMITED EVIDENCE, LOW-SAMPLE IIH, and partial-coverage labels remain visible wherever they apply.
- New copy that sounds more confident than its data supports is wrong even when it reads better. When in doubt, quote the numbers and stop.

## Development

```bash
npm install
npm run draft
npm run web
npm test
npm run check
```

- The test suite currently contains 158 passing tests.
- Every user-facing change that lands on `main` must also update the public download: finish by running `npm run release:mac` (requires a clean tree; it bumps the patch version, runs the suite, rebuilds the ad-hoc-signed Apple Silicon app via `scripts/package-mac.sh`, and publishes a GitHub release). The portfolio's download button points at `releases/latest/download/Pick-42-mac-arm64.zip`, so never rename the release asset.
- Preserve local-only behavior and existing saved state when changing Electron names or data paths.
- Add sanitized fixtures for newly observed Arena log shapes; never commit raw `Player.log` files.
- Keep ranking behavior inspectable and add regression tests for any recommendation the user identifies as clearly wrong.

## Architecture: one companion, two shells

- `src/draft-app/companion.cjs` (`createDraftCompanion`) is the platform-agnostic session: all draft/review state, the parsers, preferences, the demo driver, the log-session lifecycle, and the complete renderer view model. Platform behavior is injected as adapters.
- `src/draft-main.cjs` is the Electron shell (file dialogs, fs log tailer, windows, IPC); `src/web/main.js` is the browser shell (localStorage/IndexedDB persistence, File System Access pickers and log polling, fetch for Scryfall). Both expose the identical `window.draftCompanion` surface, and the renderer under `src/draft-renderer/` must keep working unchanged on both.
- New session behavior belongs in the companion; new platform behavior belongs in a shell adapter. Never fork renderer code per shell — the web build derives its `index.html` from the renderer's page (`scripts/build-web.mjs`).
- Node builtins used by shared modules need a browser shim in `src/web/shims/` (or an injectable seam) before they can ship in the web bundle.
