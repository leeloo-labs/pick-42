'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRecommendationGate } = require('../src/draft/coverage-gate.cjs');

function pack(coverage) {
  return coverage.map((sourceCoverage, index) => ({ name: `Card ${index + 1}`, sourceCoverage, isBasicLand: false }));
}

test('allows a visible partial ranking when one source covers at least 90% of the pack', () => {
  const result = evaluateRecommendationGate({
    recommendations: pack([1, 1, 1, 1, 1, 1, 1, 1, 1, 0]),
    hasSeventeenLands: true,
    hasUntapped: false,
    contextLabel: 'HOB Quick Draft'
  });
  assert.equal(result.ready, true);
  assert.equal(result.kind, 'partial');
  assert.equal(result.coveredByAny, 9);
});

test('pauses when single-source coverage is below 90%', () => {
  const result = evaluateRecommendationGate({
    recommendations: pack([1, 1, 1, 1, 1, 1, 1, 1, 0, 0]),
    hasSeventeenLands: true,
    hasUntapped: false,
    contextLabel: 'HOB Quick Draft'
  });
  assert.equal(result.ready, false);
  assert.equal(result.kind, 'missing-sources');
});
