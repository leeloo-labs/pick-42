# Pick 42 overnight notes

Current release: [Pick 42 0.1.12](https://github.com/leeloo-labs/pick-42/releases/tag/v0.1.12), including the correctness improvements, local decision history, and portable backups. Reopening the existing Applications launcher loads the updated project. The public download is also updated.

## What changed

- **Local backup:** PREP can export portable product data and preview an additive restore. Existing entries win on conflicts; save failures remain retryable. Raw logs and file permissions stay on the original device.
- **DECISIONS:** compare recorded advice with the selection Arena recorded, including raw/contextual scores, adjustments, source measurements, lane policy, prior pool, and the conditional Pick Two pair. Bookmark decisions; the latest ten live drafts stay local, while samples are session-only. Historical scans do not reconstruct past advice.

- **PREP during drafts:** set-specific imports, preserved legacy data, log/card-name context, and measured readiness. Switching preparation sets keeps live ratings on the draft's own set.
- **Complete recipes:** incomplete builds show exact shortages and cannot enter Recipe Mode. Unrated builds show coverage without a numerical score. Final decks account for legendary duplicates and explicit support requirements.
- **Reliable log sessions:** replaced/stopped reads stay silent, split characters survive, and historical scans complete before reviews arm.
- **Recoverable local saves:** unsaved changes remain in the session with a visible retry notice. Denied clipboard access does not report success.
- The initial audit fixes also shipped: truthful paused/partial ranking states and sample data independent of import/log notifications.

## Validation

229 tests passed, syntax checks and the web build passed, and browser checks covered PREP, complete/incomplete builds, save failure/retry, and denied copies. The macOS signature verified and GitHub's uploaded asset matches the local package checksum. No new live Arena game, full Electron window workflow, or recommendation-quality study was performed.

## Remaining work and budget

The offline replay benchmark and an initial confidence sensitivity evaluation are complete. Ten synthetic scenarios show no policy failures or baseline drift. Production calibration remains unchanged because these scenarios contain no held-out outcomes. Local backup/restore is released and the public ZIP checksum is verified. See [the evaluation notes](REPLAY_BENCHMARK.md). A signing check found zero available valid identities while the Mac was locked. Notarization still requires an available Developer ID identity and authorized credentials. The backup controls passed automated tests; live visual inspection was unavailable while the Mac was locked.

The last account reading was **6% remaining**. Overnight work is paused at a tested, published release to preserve allowance for your feedback. No reset credits were used. The implemented priorities are complete through local backup/restore; this does not claim that the research and usability follow-ups below are done.

## Useful morning checks

1. Reopen Pick 42 and use PREP during a sample draft. Confirm that setup status and the active draft's ratings remain understandable.
2. Inspect a generated deck and its Recipe Mode instructions. Try skip, undo, and return.
3. Open DECISIONS, compare two cards, and bookmark a choice.
4. Export a backup from PREP. Choosing the same file should preview no duplicate additions; restore should preserve current entries.

Broader counterfactual replay across subsequent picks remains follow-up work. Faithful replay needs complete historical inputs and an explicit hypothetical pool; the current comparison shows recorded evidence and never claims to reconstruct later packs. Fresh-user live-draft testing, empirical scoring calibration, and notarization also remain open.

See [the checkpoint](OVERNIGHT_PROGRESS.md) for the release audit and [the original review](PRODUCT_REVIEW.md) for the rationale.
