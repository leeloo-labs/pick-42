# Draft data model

Pick 42 treats source statistics and draft context as separate layers. The interface exposes both: a raw ranking in a vacuum and a contextual recommendation for the active lane and pool.

## Inputs

### 17Lands card data

The adapter accepts common exported headers including `Name`, `GIH WR`, `# GIH`, `ALSA`, `ATA`, `OH WR`, and `IWD`.

### Untapped card data

The adapter accepts common exported headers including `Card`, `In Hand WR`, `In Hand WR Difference`, `Avg Last Offered`, `In Opening Hand WR`, `Played WR`, `Included WR`, and `Total Games`.

Cards are joined by a Unicode-normalized, punctuation-tolerant card name. Arena group IDs remain the primary identity inside a live draft.

### Archetype corpus

Pick 42 accepts a local, source-independent CSV or JSON corpus containing complete event records and main-deck card quantities. Individual Arena-format lists copied manually from public 17Lands trophy pages can also be validated and accumulated locally; this workflow performs no automated page access. Pick 42 filters trophy exemplars by set and event format, groups them by an explicit or color-inferred archetype, and measures card inclusion and pool-conditioned co-occurrence. An archetype requires four matching trophy decks and the pool must contain at least two distinguishing cards before it can affect a score. Recency and sample confidence shrink the bounded contextual signal. A missing, mismatched, or weak corpus contributes zero rather than falling back to a guess. The exact import contract is documented in [ARCHETYPE_CORPUS.md](ARCHETYPE_CORPUS.md).

## Ranking

1. Convert each available in-hand win rate to a common 0–100 power scale.
2. Blend the two sources using the stored evidence weighting.
3. Pull small samples toward the midpoint using a logarithmic confidence factor.
4. Treat 17Lands IIH and Untapped In-Hand WR Difference as a separate draw-impact signal. The signal is shrunk toward zero using the relevant sample count before it can materially raise or lower a rating.
5. Flag reliable extreme values as **High impact**, **Positive IIH**, **Negative IIH**, or **Draw liability**. Extreme values from small samples are labeled **Low-sample IIH** instead of being presented as conclusions.
6. Save this confidence-adjusted blend as the **Raw Data** score and rank; it deliberately ignores the lane and pool.
7. Infer the draft lane from the active pool. Before commitment, apply only a modest leaning adjustment. A manual no-splash or splash-permitted lock becomes the authoritative policy, except for a narrow data-backed bomb escape.
8. Produce the **Contextual** score by applying visible adjustments for lane fit, early flexibility, curve need, pick urgency, interaction, real synergy, duplicate pressure, splash burden, and eligible trophy-corpus evidence.
9. Display both ranks and scores, plus each material contextual reason, instead of hiding the calculation behind a letter grade.

After ranking, Pick 42 assigns a deck-use outlook without changing the score. If a committed or locked lane has no eligible main-plan option, the top remaining card is marked as the best fallback and **Likely Sideboard**. A credible light splash is marked **Speculative Splash**, while an exceptional off-lane bomb is a **Speculative Pick**. The raw ranking never receives these contextual labels.

The live interface enables a recommendation only when at least 90% of nonbasic cards in the pack have a usable in-hand win rate from both imported sources. A matched row with blank performance fields does not count as coverage. A card with no usable source rating has no score. Basic lands are explicitly unranked. This prevents contextual heuristics from becoming a recommendation when the statistical foundation is absent or belongs to the wrong set.

Color commitment is an explicit state: open, leaning, committed, or manually locked. Pick 42 infers a two-color pair from active-pool depth, source quality, timing, and eligible corpus evidence. The lane popover is the only manual drafting-policy control: lock with no splash, lock while open to splash, or stay open. The choice is persisted only for the active draft.

Pick 42 also reads localized rules text from Arena's installed card database. Explicit subtype requirements—such as an Equipment that attaches to a Dwarf—are compared with creature subtypes already in the active pool. Missing hard requirements suppress the normal colorless-flexibility bonus and apply a visible synergy penalty; supported requirements receive a visible bonus.

The full drafted pool remains visible as an abbreviated deck list. Marking a card **OUT** is draft-scoped and reversible; excluded cards remain on screen but are removed from lane inference, recommendation context, synergy counts, and generated deck builds.

The normalized name of an excluded card also becomes draft-scoped preference evidence. A later copy receives a visible contextual penalty and **Likely Sideboard** outlook. The model can override that outlook only for elite raw performance, sufficiently strong premium removal, or a newly live synergy package backed by strong source data; the smaller residual penalty and reconsideration reason remain visible.

## Live Arena events

The parser recognizes the currently observed Human Draft shapes (`Draft.Notify`, `EventPlayerDraftMakePick`) and Quick Draft shapes (`BotDraft_DraftStatus`, `BotDraft_DraftPick`). Arena reuses `InternalEventName` for repeated entries into the same queue, so Pick 42 uses the unique `CourseId` as the saved-draft identity. When a finished draft is reopened, it selects the most current matching `EventGetCoursesV2` course snapshot, restores its `CardPool`, and discards any registered deck inherited from an older course. When present on that exact course, `CourseDeck.MainDeck` and `CourseDeck.Sideboard` are retained as the registered deck version for post-game review. Deck suggestions are then inferred dynamically from that restored pool instead of being tied to fixed prototype color combinations. Arena does not publish a stable log schema, so additional sanitized fixtures are needed as client versions and draft formats are tested.

Pick 42 only reads local events that Arena writes to `Player.log`. It does not automate selections or infer cards not present in the log.
