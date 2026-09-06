# Draft recommendation replay benchmark

Run `npm run replay:check` to replay ten authored decision snapshots against the current engine. The command writes `dist/replay-report.json` and fails if a policy contract fails or behavior differs from the committed baseline. No Arena connection, account, network request, or player log is needed.

The report records every card's raw/contextual rank and score, score adjustments, reasons, source coverage, confidence, outlook, and the conditional Pick Two pair. Changes retain before/after results. A changed scenario input or expectation is labeled separately from changed engine behavior; added and removed scenarios are also reported.

## Maintaining scenarios

`fixtures/replay/scenarios.json` holds complete synthetic inputs, a short purpose, and independently stated policy expectations. It currently covers paused and partial coverage, third legendary copies, unsupported/supported Equipment, manual lanes, hybrid versus gold mana, Pick Two copies, and OUT preferences. The thin-versus-dense sample case is diagnostic only.

Add sanitized, authorized scenarios here when a disputed pick becomes a reproducible case. Never add raw Player.log data. Prefer a concrete policy constraint over declaring that an entire ranking is optimal. Snapshot comparisons show behavior drift; they do not establish recommendation quality.

After investigating a deliberate model change, run `npm run replay:update`, inspect the baseline diff, and commit it with the model change. Baseline updates refuse failed policy checks. Ordinary tests also check the reviewed baseline. Do not regenerate it merely to make a failing test pass.

Alternate files can be supplied with `--scenarios`, `--baseline`, and `--output`. These paths must differ. The benchmark evaluates separate observed decision states; it does not simulate unseen packs or other drafters' responses to a different pick.

## Initial confidence sensitivity evaluation

The diagnostic holds card characteristics and both source rates equal within each candidate. The thin candidate has a hypothetical 70% win rate and 12 observations per source; the dense candidate has 61% and 10,000. The current engine displays confidence 35% versus 89% and raw scores **94.8 versus 73.6**. Those confidence labels are not calibrated probabilities that a ranking is correct.

As a sensitivity check, each source's rate was replaced with `(n × rate + k × 55) / (n + k)` before running the unchanged engine. The illustrative prior is 55%; its strengths below are arbitrary probes, not fitted recommendations. Source counts were kept separate and were not added together.

| Illustrative prior strength k | Thin raw score | Dense raw score |
| --- | ---: | ---: |
| 0 (current input) | 94.8 | 73.6 |
| 200 | 53.0 | 73.1 |
| 1,000 | 50.6 | 71.4 |

The ordering is sensitive to how thin samples are shrunk. This does not establish which ordering is more accurate: these cases contain no held-out outcomes. Choosing a prior, strength, or different treatment for GIH/GD/GP bases requires an authorized outcome dataset with a defined split and evaluation objective. Trophy-pick agreement and a single game's result are insufficient substitutes.

Decision: preserve production weights. The benchmark now makes future changes inspectable; calibration remains an empirical validation task. The remaining near-term product work is local backup/restore.

Validation: ten replay scenarios, zero policy failures, zero baseline changes; 220 total tests pass. This is a developer evaluation tool; application behavior and the 0.1.11 public app are unchanged.
