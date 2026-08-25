# Pick 42 project memory

## Identity and ownership

- Product name: **Pick 42**. The name refers to the final selection in a normal MTG Arena draft: three 14-card packs.
- Pick 42 is proprietary software owned by **Leeloo Labs LLC**.
- Canonical repository: `https://github.com/leeloo-labs/pick-42`.
- The product was initially called Arcane. Some internal compatibility identifiers, storage keys, helper filenames, and the legacy Electron user-data directory still use `arcane`; preserve those until an explicit migration is implemented so existing imports and recipe progress are not lost.

## Product direction

Pick 42 is a local-first MTG Arena drafting companion. The match companion remains a working prototype, but current product development is focused on draft recommendations and limited deck construction because Arena games move too quickly for the match overlay to provide enough value.

The companion must remain transparent and advisory:

- Read only information Arena writes to local logs or displays visibly.
- Do not access private Arena services, reveal hidden information, or automate game/draft input.
- Explain rankings through source metrics and visible contextual adjustments.
- Fail closed when the imported source data is incomplete or does not match the active set.

## Data sources and ranking

- **17Lands:** imported CSV data, including GIH win rate, games in hand, games-not-seen win rate, and IIH when present. IIH may be calculated as GIH WR minus GNS WR when necessary.
- **Untapped:** imported CSV data, including in-hand win rate, in-hand win-rate difference, and sample counts when available.
- **Scryfall:** public set data for card images, Oracle text, and presentation enrichment. Arena group IDs remain the live identity source.
- **Archetype corpus:** authorized local CSV/JSON deck records, including set, format, result, archetype, and main-deck quantities. The corpus may come from a manual export, licensed feed, or offline processing of a licensed public dataset.
- Do not scrape 17Lands or Untapped or depend on undocumented/private APIs.

The blend engine exposes a confidence-aware raw score and one contextual recommendation model. Important invariants:

- Require usable matching rows from both imported statistical sources for at least 90% of nonbasic cards before enabling live rankings.
- Blank statistics do not count as source coverage.
- Basic lands are never ranked as flexible colorless cards.
- Shrink IIH toward zero using sample confidence before it changes a card score.
- Flag reliable extreme draw impact as `HIGH IMPACT`, `POSITIVE IIH`, `DRAW LIABILITY`, or `NEGATIVE IIH`; use `LOW-SAMPLE IIH` when the sample is too weak.
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
- In the post-game IIH card list, show the complete top-four group with explicit drawn/not-drawn status, plus reliable drawn liabilities at or below −2.0 percentage points; hide everything else near neutral.
- Exclude cards with unverified conditional cost reductions from printed-mana curve evidence, and count stranded evidence by distinct turn rather than by copies in hand.
- Persist completed reviews locally in the legacy Pick 42/Arcane user-data directory; never upload raw game data.

## Development

```bash
npm install
npm run draft
npm test
npm run check
```

- The test suite currently contains 105 passing tests.
- Preserve local-only behavior and existing saved state when changing Electron names or data paths.
- Add sanitized fixtures for newly observed Arena log shapes; never commit raw `Player.log` files.
- Keep ranking behavior inspectable and add regression tests for any recommendation the user identifies as clearly wrong.
