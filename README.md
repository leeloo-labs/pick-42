# Pick 42

Pick 42 is a local-first MTG Arena draft companion from **Leeloo Labs LLC**. It turns Arena's visible draft and game logs into transparent pick recommendations, 40-card limited builds, and conservative post-game analysis.

The current product flow is:

1. **Draft** — compare contextual and in-a-vacuum card rankings.
2. **Decks** — build and visually reproduce a 40-card Arena deck.
3. **Play** — review mana variance, IIH draw quality, visible contributions, and repeated signals across games.

Pick 42 is advisory. It does not connect to private Arena services, reveal hidden cards, automate game input, scrape 17Lands or Untapped, or upload your `Player.log`.

Pick 42 is proprietary software owned by Leeloo Labs LLC. It is not licensed for public use, copying, modification, or distribution. See [LICENSE](LICENSE).

## Run Pick 42

Requirements: Node.js 22 or newer and npm.

```bash
npm install
npm run draft
```

Enable Arena logging under **Options → Account → Detailed Logs**, then restart Arena. Pick 42 automatically watches the standard `Player.log` location when it can find it. The **LOG** button shows the connection state and opens a status menu with the watched path, the time of the last log activity, a rescan of the standard location, and a file picker for non-standard installs.

Standard locations:

- macOS: `~/Library/Logs/Wizards Of The Coast/MTGA/Player.log`
- Windows: `%USERPROFILE%\AppData\LocalLow\Wizards Of The Coast\MTGA\Player.log`
- Linux/Proton: the Arena Steam prefix under `AppData/LocalLow/Wizards Of The Coast/MTGA/Player.log`

The original live match-overlay prototype remains available with `npm start`, but active development is focused on limited drafting, deck construction, and post-game review.

## Product principles

- **Local first:** logs, imported statistics, trophy decks, recipe progress, and game reviews stay on the computer.
- **Visible information only:** no hidden opponent cards or private Arena endpoints.
- **Inspectable rankings:** source metrics and every material contextual adjustment remain visible.
- **Fail closed:** real recommendations pause when imported data is incomplete or does not match the active set.
- **Advisory, never automatic:** Pick 42 recommends; the player makes every draft and gameplay decision.

## Draft

### Source data

Use the title-bar source controls to import:

- **17L** — 17Lands card-performance CSV data, including GIH win rate, games in hand, games-not-seen win rate, and IIH when available. When a win-rate cell is blank (young sets suppress low-sample cells), Pick 42 falls back through GD WR and GP WR and shows the basis it used.
- **UT** — Untapped card-stat CSV data, including in-hand win rate, in-hand win-rate difference, and sample counts when available.
- **META** — a manually collected local corpus of trophy decks.
- **LOG** — Arena's `Player.log`.

The **17L** and **UT** buttons open a per-draft-type menu: each CSV export is assigned to the draft type it was filtered for (Premier, Quick, Traditional, Pick Two) or to **All draft types**. The live draft uses its matching import, falling back to the all-types slot, so a Quick Draft export never silently rates a Pick Two pack. The button shows which import is feeding the active draft.

Live rankings require usable matching rows from both statistical sources for at least 90% of the nonbasic cards in the active pack. Blank values do not count as coverage, missing cards remain unranked, and basic lands are never treated as flexible colorless picks. Bundled sample rows are active only in sample mode.

Pick 42 does not scrape 17Lands or Untapped and does not depend on undocumented APIs. Current data is imported by the user.

### Contextual and raw rankings

Every pack exposes two views:

- **Contextual** answers “What should I pick?” using the manual lane, active pool, draft timing, curve, interaction, synergy, duplicate pressure, splash burden, IIH, and matching trophy patterns.
- **Raw Data** answers “How strong is this card in a vacuum?” using only the confidence-adjusted 17Lands and Untapped blend.

Both ranks and scores stay visible so a contextual move can be inspected rather than accepted as a black box.

IIH is shrunk toward zero based on sample confidence before it changes a recommendation. Reliable extremes surface as **High Impact**, **Positive IIH**, **Draw Liability**, or **Negative IIH**. Weak samples are labeled **Low-Sample IIH** instead of receiving a confident adjustment.

### Lane commitment and active pool

Pick 42 can infer that a pool is leaning toward or has committed to an archetype, but the drafting policy is manual. The lane menu offers:

1. Lock the inferred lane with no splash.
2. Lock the lane while remaining open to a light premium splash.
3. Stay open.

A locked lane gates ordinary off-color cards. Only a truly exceptional, data-backed bomb can overcome it. When no card in the pack realistically fits, Pick 42 still identifies the best fallback but labels it **Likely Sideboard**, **Speculative Splash**, or **Speculative Pick** instead of pretending it belongs in the deck.

The active-pool panel is an abbreviated deck list. Marking a card **OUT** keeps it visible but removes it from lane inference, recommendations, and deck construction. That choice carries forward when another copy appears later in the same draft, unless strong new evidence provides an explicit reason to reconsider.

### Pick Two drafts

Arena's Pick Two events keep the same 42-card pool — three packs of seven two-card selections. Pick 42 labels them as a distinct format so trophy-corpus matching stays format-true, and the Contextual view adds a pair recommendation: the second selection is re-scored with the first pick already in the pool, so lane pressure, curve, synergy, and duplicate effects apply between the two picks. Because of that, the recommended second card is not always the second-ranked row. The hero card presents the pair as one unit — the top pick with an attached second-selection band showing its own score, mana, and reasoning — and the pack ranking flags both cards with **1st Pick** and **2nd Pick**. After a selection is made, the leftover pack passes on, so the decision area shows an animated waiting state (naming what was just taken) until the next pack arrives. A bundled **Pick Two sample** (next to the regular sample pack on the empty draft view) tours the whole flow — live pair recommendations, two-card picks, and the waiting state — without spending an entry.

### Trophy-deck corpus

Open **META** to build the trophy corpus two ways:

- **Process a 17Lands public dataset.** Once the set appears in the [17Lands public datasets](https://www.17lands.com/public_datasets), download its game-data file and choose it through **Import Data File**. Pick 42 streams the file offline, derives each event's record from its game rows, keeps the most recent trophy runs with their final builds, and saves a small normalized corpus locally. No scraping, no API calls.
- **Paste individual trophy decks** copied from 17Lands deck pages, useful before the public dataset exists. Pick 42 validates the main deck and record, infers primary colors from fixed mana requirements and the mana base, distinguishes splashes from true three-color decks, and stores the result locally.

Hybrid payment options do not create phantom colors. Corpus examples are filtered to the active set and draft format before they affect a recommendation. See [docs/ARCHETYPE_CORPUS.md](docs/ARCHETYPE_CORPUS.md) for the full workflow and normalized CSV/JSON schema.

## Decks

Once the latest draft contains at least 23 playable nonbasic cards, Pick 42 generates complete 40-card suggestions. The current manual lane is the primary build, followed by viable splash or alternate-color options.

Each build includes:

- 23 selected spells and explicit on-color cuts;
- 17 lands by default, dropping to 16 only for a genuinely low curve with card flow;
- creature and effective-body counts, interaction density, average mana value, and spell curve;
- color-source targets that count drafted fixing and dual lands;
- explicit warnings when a splash cannot meet its modeled mana requirements.

Hybrid mana can be paid by either color. Gold cards require every listed color. Hard subtype requirements, premium removal, duplicate pressure, real synergy enablers, and splash burden are modeled directly.

### Arena-style deck board

The full **DECKS** view uses Arena's seven-column ordering: one through five mana, six-plus, and lands. Cards stack like the Arena client, quantities remain visible, colors stay grouped, and hover or keyboard focus opens an enlarged preview.

Public Scryfall set data enriches the local Arena card identity with Oracle text, card images, art crops, and artist attribution. The data is cached in Electron's user-data directory. If Scryfall is unavailable, Pick 42 falls back to Arena's local card text and color-framed placeholders.

The interface uses a pinned local [Lucide](https://lucide.dev) package for navigation, actions, lane state, card types, and review cues. It does not load icon assets from a CDN.

### Recipe Mode

Use **Collapse to Side Panel** from **DECKS** to open the compact Recipe Mode beside Arena. It gives deterministic quantity instructions in this order:

1. Remove excluded drafted cards.
2. Set every selected spell to its target quantity.
3. Set drafted utility lands.
4. Set final basic-land quantities.

**Copy Search** places the current card name on the clipboard. After matching the large **Set To** quantity in Arena, use **Done + Next**. **Skip** leaves a step for review and **Undo** restores the previous step. Progress is saved locally for the current draft and build.

Recipe Mode does not inspect card positions or depend on Arena's grid ordering. The earlier positional OCR overlay remains experimental and disabled during normal startup.

Keyboard shortcuts:

- `Cmd/Ctrl + Shift + C` — copy the current card name
- `Cmd/Ctrl + Shift + Right` — complete the current instruction
- `Cmd/Ctrl + Shift + Left` — undo the previous instruction
- `Cmd/Ctrl + Shift + D` — hide or restore Pick 42

## Play

Leave `npm run draft` open while playing the drafted deck, then open **PLAY**. Pick 42 only reviews a game when Arena's registered deck size and opening-hand evidence match the current limited deck. An unrelated constructed or limited game is ignored.

The report intentionally focuses on evidence that can change a decision:

- a compact result, play/draw, game-turn, mulligan, and game-shape summary;
- a game history grouped by draft: the live event stays expanded with its record and format-aware state (gold trophy at 7 wins for Premier/Quick, 4 for Pick Two, 3-0 for Traditional; ENDED at the loss cap), while previous events collapse into compact record pills that expand on demand;
- early concessions (a loss conceded within the first few of your turns) are labeled on the game, receive a LIMITED EVIDENCE verdict instead of deck conclusions, and stay out of series-level card evidence while still counting toward the event record;
- low, moderate, or high mana-variance analysis for both players;
- the deck's four highest reliable 17Lands IIH cards, each marked drawn or not drawn;
- additional reliable negative-IIH cards only when they were actually drawn;
- MVP candidates supported by attributable recorded damage;
- LVP candidates only when concrete negative evidence exists;
- a build-vs-model note when the registered deck differs from the recommended Pick 42 build, listing exactly what was added and cut;
- a plain-language verdict recommending whether to run it back or test a reversible change. When a loss's clearest negative evidence points at a card the player added over the model, the verdict suggests the specific reversible swap back; a deviation alone is context, never evidence.
- Once the event is decided, the final game's verdict becomes a **Draft wrap-up** instead of advice about a deck with no next game: a trophy celebration or a completion summary with the run's repeatable signals, framed as reads for the next draft.

Games from the exact same deck version are combined into a series verdict. Changing the deck version starts a new evidence series rather than mixing incompatible results.

Game shape distinguishes **Close**, **Competitive**, **Decisive**, and conservative wire-to-wire **Blowout** wins using life, board, power, hand pressure, lead changes, and contested turns—not final life totals alone. A turning-point section appears only when a logged tactical action and the immediately following lethal line meet a deliberately high confidence threshold.

IIH remains historical correlation, not causal credit. Hidden opponent cards remain excluded, and Pick 42 will not call a support card bad merely because it dealt no damage or died.

## Development

```bash
npm test
npm run check
```

The current suite contains 127 passing tests covering log reconstruction, draft restoration, source normalization, contextual ranking regressions, trophy-corpus inference, deck building, Recipe Mode, game matching, game shape, turning points, and series verdicts.

Important paths:

- `src/core/` — Arena log streaming and visible match-state reconstruction
- `src/draft/blend-engine.cjs` — confidence-aware source blend and contextual recommendation engine
- `src/draft/draft-log-parser.cjs` — active and completed draft reconstruction
- `src/draft/archetype-corpus.cjs` — manual trophy-deck normalization and matching
- `src/draft/pool-plan.cjs` — persisted active-pool exclusions
- `src/draft/deck-builder.cjs` — limited builds and mana-base modeling
- `src/draft/game-review.cjs` — conservative single-game and series analysis
- `src/draft-renderer/` — Draft, Decks, Play, Recipe Mode, and local Lucide integration
- `fixtures/` — deterministic sanitized Arena-log fixtures
- `test/` — Node test suite and recommendation regressions

## Current limitations

- Arena does not publish or version the `Player.log` schema, so new client shapes require sanitized fixtures and parser updates.
- Statistical quality depends on current, correctly matched 17Lands and Untapped exports.
- Trophy decks are imported manually; Pick 42 does not crawl trophy pages.
- Tactical review is deliberately conservative and cannot know hidden cards, player intent, or unlogged decision alternatives.
- The positional OCR deck-builder overlay is experimental and disabled because Arena reorders and virtualizes its card grid.

## Privacy

Arena logs can contain display names, account identifiers, session metadata, machine paths, and credentials. Pick 42 reads them locally and does not upload them. Never commit or attach a raw `Player.log`; add only minimal sanitized fixtures for newly observed log shapes.
