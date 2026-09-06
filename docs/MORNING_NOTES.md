# Pick 42 overnight notes

Current release: [Pick 42 0.1.11](https://github.com/leeloo-labs/pick-42/releases/tag/v0.1.11), including the first improvement batch and local decision history. Reopening the existing Applications launcher loads the updated project. The public download is also updated.

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

The offline replay benchmark and an initial confidence sensitivity evaluation are complete. Ten synthetic scenarios show no policy failures or baseline drift. Production calibration remains unchanged because these scenarios contain no held-out outcomes. Local backup/restore is implemented; its release verification is recorded in the checkpoint. See [the evaluation notes](REPLAY_BENCHMARK.md). A signing check found zero available valid identities while the Mac was locked. Notarization still requires an available Developer ID identity and authorized credentials. The backup controls passed automated tests; live visual inspection was unavailable while the Mac was locked.

The latest account reading at the second release's completion was **7% remaining**. The hourly overnight continuation will check again before starting another bounded task and stop starting work at **3%**, or earlier if there is insufficient allowance to finish and verify it. It pauses by 9 AM Eastern September 6. No reset credits were used. See [the checkpoint](OVERNIGHT_PROGRESS.md) for subsequent progress.
