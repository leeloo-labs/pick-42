'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { scoreDraftPack, inferDraftLane, recommendPickTwoPair } = require('../src/draft/blend-engine.cjs');
const { evaluateRecommendationGate, presentDraftRecommendations } = require('../src/draft/coverage-gate.cjs');
const { normalizeFormat } = require('../src/draft/archetype-corpus.cjs');
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function runScenario(scenario) {
  if (typeof scenario?.id !== 'string' || !scenario.id.trim() || !Array.isArray(scenario.input?.cards) || !scenario.input.cards.length) throw new Error('Each replay needs an id and a visible pack');
  const input = JSON.parse(JSON.stringify(scenario.input));
  const args = { pool: [], seventeenLands: [], untapped: [], ...input };
  const lane = inferDraftLane(args);
  const ranked = scoreDraftPack({ ...args, lane });
  const gate = evaluateRecommendationGate({ recommendations: ranked, hasSeventeenLands: Boolean(args.seventeenLands.length), hasUntapped: Boolean(args.untapped.length), contextLabel: args.setCode });
  const pair = gate.ready && normalizeFormat(args.format) === 'pick-two' ? recommendPickTwoPair({ ...args, lane, recommendations: ranked }) : null;
  const cards = presentDraftRecommendations(ranked, gate).map((card) => ({
    name: card.name, packIndex: card.packIndex, contextualRank: card.contextualRank, rawRank: card.rawRank,
    score: card.score, dataScore: card.dataScore, coverage: card.sourceCoverage,
    confidence: card.metrics.confidence, adjustments: gate.ready ? card.adjustments : null,
    outlook: card.pickOutlook?.label || null, reasons: card.reasons
  })).sort((a, b) => a.packIndex - b.packIndex);
  const recommendation = gate.ready ? ranked.find((card) => card.eligible)?.name || null : null;
  const result = { gate: gate.kind, recommendation, pair, lane: { label: lane.label, mode: lane.mode, colors: lane.colors }, cards };
  const failures = [];
  const expect = scenario.expect || {};
  if ('gate' in expect && expect.gate !== result.gate) failures.push(`Expected gate ${expect.gate}, got ${result.gate}`);
  if ('top' in expect && expect.top !== recommendation) failures.push(`Expected ${expect.top} first, got ${recommendation}`);
  if (expect.pair && JSON.stringify(expect.pair) !== JSON.stringify(pair ? [pair.first.name, pair.second.name] : null)) failures.push('Conditional pair differs from the required pair');
  for (const constraint of expect.adjustments || []) {
    const value = cards.find((card) => card.name === constraint.card)?.adjustments?.[constraint.field];
    if (!Number.isFinite(value) || ('min' in constraint && value < constraint.min) || ('max' in constraint && value > constraint.max)) failures.push(`${constraint.card}: ${constraint.field}=${value} outside required bounds`);
  }
  return { id: scenario.id, purpose: scenario.purpose, kind: scenario.kind || 'regression', inputDigest: digest({ input: scenario.input, expect }), result, failures };
}
function runBenchmark(spec) {
  if (spec?.version !== 1 || (!Array.isArray(spec.scenarios) || !spec.scenarios.length)) throw new Error('Unsupported replay scenario file');
  const ids = spec.scenarios.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) throw new Error('Replay scenario ids must be unique');
  return { version: 1, cases: spec.scenarios.map(runScenario) };
}
function compareBaseline(current, baseline) {
  if (baseline?.version !== 1 || !Array.isArray(baseline.cases)) throw new Error('Unsupported replay baseline');
  const changes = [];
  if (new Set(baseline.cases.map((entry) => entry.id)).size !== baseline.cases.length) throw new Error('Replay baseline ids must be unique');
  const before = new Map(baseline.cases.map((entry) => [entry.id, entry]));
  for (const entry of current.cases) {
    const old = before.get(entry.id); before.delete(entry.id);
    if (!old) { changes.push({ id: entry.id, kind: 'added' }); continue; }
    if (old.inputDigest !== entry.inputDigest) { changes.push({ id: entry.id, kind: 'inputs-or-contract-changed' }); continue; }
    if (JSON.stringify(old.result) !== JSON.stringify(entry.result)) {
      changes.push({ id: entry.id, kind: 'behavior-changed', before: old.result, after: entry.result });
    }
  }
  for (const id of before.keys()) changes.push({ id, kind: 'removed' });
  return changes;
}
function main(argv) {
  const root = path.resolve(__dirname, '..');
  const option = (name, fallback) => { const index = argv.indexOf(name); if (index < 0) return fallback; if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`${name} needs a path`); return path.resolve(argv[index + 1]); };
  const specPath = option('--scenarios', path.join(root, 'fixtures/replay/scenarios.json'));
  const baselinePath = option('--baseline', path.join(root, 'fixtures/replay/baseline.json'));
  const reportPath = option('--output', path.join(root, 'dist/replay-report.json'));
  if (new Set([specPath, baselinePath, reportPath]).size !== 3) throw new Error('Scenario, baseline, and report files must be different');
  const current = runBenchmark(JSON.parse(fs.readFileSync(specPath, 'utf8')));
  const failures = current.cases.flatMap((entry) => entry.failures.map((message) => ({ id: entry.id, message })));
  let changes = [];
  if (argv.includes('--update')) {
    if (failures.length) throw new Error(`Refusing to bless a baseline with ${failures.length} failed policy checks`);
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, JSON.stringify(current, null, 2) + '\n');
  } else changes = compareBaseline(current, JSON.parse(fs.readFileSync(baselinePath, 'utf8')));
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ ...current, changes, failures, limitation: 'Synthetic regression scenarios measure behavior, not win-rate improvement or prediction accuracy.' }, null, 2) + '\n');
  for (const entry of current.cases) console.log(`${entry.failures.length ? 'FAIL' : 'PASS'} ${entry.id}: ${entry.result.gate} · ${entry.result.pair ? `${entry.result.pair.first.name} + ${entry.result.pair.second.name}` : entry.result.recommendation || 'paused'}${entry.kind === 'diagnostic' ? ' · diagnostic only' : ''}`);
  for (const change of changes) console.log(`CHANGE ${change.id}: ${change.kind}`);
  console.log(`${current.cases.length} scenarios · ${failures.length} policy failures · ${changes.length} baseline changes\nReport: ${reportPath}`);
  return failures.length || changes.length ? 1 : 0;
}
if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { runScenario, runBenchmark, compareBaseline, main };
