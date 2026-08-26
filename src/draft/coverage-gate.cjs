'use strict';

function evaluateRecommendationGate({
  recommendations = [],
  demo = false,
  hasSeventeenLands = false,
  hasUntapped = false,
  contextLabel = 'this set'
} = {}) {
  const draftable = recommendations.filter((card) => !card.isBasicLand);
  const coveredByBoth = draftable.filter((card) => card.sourceCoverage === 2).length;
  const coveredByAny = draftable.filter((card) => card.sourceCoverage >= 1).length;
  const total = draftable.length;
  const bothCoverage = total ? coveredByBoth / total : 0;
  const anyCoverage = total ? coveredByAny / total : 0;

  if (!total) {
    return { ready: false, kind: 'waiting', message: 'Waiting for a draft pack', coveredByBoth, coveredByAny, total };
  }
  if (demo) {
    return { ready: true, kind: 'demo', message: 'Sample data is active for the sample draft only', coveredByBoth, coveredByAny, total };
  }
  if (bothCoverage >= 0.9) {
    return { ready: true, kind: 'ready', message: 'Both sources cover the live pack', coveredByBoth, coveredByAny, total };
  }
  // A nearly complete pack from either import is enough to rank transparently.
  // Cards without usable data remain visibly unranked.
  if (anyCoverage >= 0.9) {
    return {
      ready: true,
      kind: 'partial',
      message: `Partial data · ${coveredByBoth}/${total} cards match both imports; single-source ratings fill the gaps`,
      coveredByBoth,
      coveredByAny,
      total
    };
  }
  if (!hasSeventeenLands || !hasUntapped) {
    const missing = [
      !hasSeventeenLands ? '17Lands' : null,
      !hasUntapped ? 'Untapped' : null
    ].filter(Boolean).join(' and ');
    return {
      ready: false,
      kind: 'missing-sources',
      message: `Recommendations paused · import ${missing} data for ${contextLabel}`,
      coveredByBoth,
      coveredByAny,
      total
    };
  }
  return {
    ready: false,
    kind: 'low-coverage',
    message: `Recommendations paused · only ${coveredByAny}/${total} draftable cards have usable imported data`,
    coveredByBoth,
    coveredByAny,
    total
  };
}

module.exports = { evaluateRecommendationGate };
