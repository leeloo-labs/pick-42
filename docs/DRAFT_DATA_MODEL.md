# Draft data model

Pick 42 treats source statistics and personal drafting rules as separate layers. That keeps a recommendation inspectable and makes it possible to change the philosophy without rewriting source data.

## Inputs

### 17Lands card data

The adapter accepts common exported headers including `Name`, `GIH WR`, `# GIH`, `ALSA`, `ATA`, `OH WR`, and `IWD`.

### Untapped card data

The adapter accepts common exported headers including `Card`, `In Hand WR`, `In Hand WR Difference`, `Avg Last Offered`, `In Opening Hand WR`, `Played WR`, `Included WR`, and `Total Games`.

Cards are joined by a Unicode-normalized, punctuation-tolerant card name. Arena group IDs remain the primary identity inside a live draft.

## Ranking

1. Convert each available in-hand win rate to a common 0–100 power scale.
2. Blend the two sources using the **Source balance** control.
3. Pull small samples toward the midpoint using a logarithmic confidence factor.
4. Treat 17Lands IIH and Untapped In-Hand WR Difference as a separate draw-impact signal. The signal is shrunk toward zero using the relevant sample count before it can materially raise or lower a rating.
5. Flag reliable extreme values as **High impact**, **Positive IIH**, **Negative IIH**, or **Draw liability**. Extreme values from small samples are labeled **Low-sample IIH** instead of being presented as conclusions.
6. Apply signed philosophy adjustments for color fit, early flexibility, curve need, pick urgency, creature preference, and optional per-card notes.
7. Display the resulting score and each material reason instead of hiding the calculation behind a letter grade.

The live interface enables a recommendation only when at least 90% of nonbasic cards in the pack have a usable in-hand win rate from both imported sources. A matched row with blank performance fields does not count as coverage. A card with no usable source rating has no score. Basic lands are explicitly unranked. This prevents contextual heuristics from becoming a recommendation when the statistical foundation is absent or belongs to the wrong set.

Color commitment ramps up after the first few picks. Early picks therefore favor power and flexible mana; later picks increasingly respect the colors and curve already present in the pool.

Pick 42 also reads localized rules text from Arena's installed card database. Explicit subtype requirements—such as an Equipment that attaches to a Dwarf—are compared with creature subtypes already in the pool. Missing hard requirements suppress the normal colorless-flexibility bonus and apply a visible synergy penalty; supported requirements receive a small visible bonus. The **Synergy requirements** control determines how strongly this context affects the score.

## Live Arena events

The parser recognizes the currently observed Human Draft shapes (`Draft.Notify`, `EventPlayerDraftMakePick`) and Quick Draft shapes (`BotDraft_DraftStatus`, `BotDraft_DraftPick`). Arena does not publish a stable log schema, so additional sanitized fixtures are needed as client versions and draft formats are tested.

Pick 42 only reads local events that Arena writes to `Player.log`. It does not automate selections or infer cards not present in the log.
