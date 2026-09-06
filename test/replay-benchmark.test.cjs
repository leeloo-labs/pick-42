'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runBenchmark, compareBaseline, main } = require('../scripts/replay-benchmark.cjs');
const spec = require('../fixtures/replay/scenarios.json');
const baseline = require('../fixtures/replay/baseline.json');

test('curated replay policy checks pass without changes to the reviewed baseline', () => {
  const before = JSON.stringify(spec);
  const current = runBenchmark(spec);
  assert.deepEqual(current.cases.flatMap((entry) => entry.failures), []);
  assert.deepEqual(compareBaseline(current, baseline), []);
  assert.equal(JSON.stringify(spec), before);
  assert.deepEqual(runBenchmark(spec), current);
});

test('replay distinguishes behavior drift from changed evidence, additions, and removals', () => {
  const current = structuredClone(baseline);
  current.cases[0].result.cards[0].score = 99;
  current.cases[1].inputDigest = 'different input';
  current.cases.pop();
  current.cases.push({ ...current.cases[2], id: 'new-case' });
  const changes = compareBaseline(current, baseline);
  assert.deepEqual(changes.map((entry) => entry.kind), ['behavior-changed', 'inputs-or-contract-changed', 'added', 'removed']);
  assert.equal(changes[0].before.cards[0].score, null);
  assert.equal(changes[0].after.cards[0].score, 99);
});

test('a failed policy check cannot be blessed into a new replay baseline', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pick42-replay-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const changed = structuredClone(spec); changed.scenarios[0].expect.top = 'Fabricated recommendation';
  const input = path.join(dir, 'scenarios.json'), target = path.join(dir, 'baseline.json');
  fs.writeFileSync(input, JSON.stringify(changed)); fs.writeFileSync(target, 'last good baseline');
  assert.throws(() => main(['--scenarios', input, '--baseline', target, '--output', path.join(dir, 'report.json'), '--update']), /Refusing to bless/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'last good baseline');
  assert.throws(() => main(['--scenarios', input, '--baseline', input, '--update']), /must be different/);
});

test('empty scenarios and duplicate identifiers cannot silently weaken the replay set', () => {
  assert.throws(() => runBenchmark({ version: 1, scenarios: [] }), /Unsupported/);
  assert.throws(() => runBenchmark({ version: 1, scenarios: [spec.scenarios[0], spec.scenarios[0]] }), /unique/);
  assert.throws(() => compareBaseline(baseline, { version: 1, cases: [baseline.cases[0], baseline.cases[0]] }), /unique/);
});
