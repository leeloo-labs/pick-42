'use strict';

let selectedDecisionId = null;
let decisionDetailToken = 0;
let comparisonNames = null;

function renderDecisionHistory() {
  if (!byId('decision-history-dialog').open) return;
  const history = model.decisionHistory || { entries: [], maxDrafts: 10 };
  const entries = [...history.entries].reverse().filter((entry) => !byId('history-bookmarks-only').checked || entry.bookmarked);
  setText('history-retention', `Last ${history.maxDrafts} live drafts stored on this device. Sample decisions last for this session. Bookmarks follow the same retention limit.`);
  const list = byId('history-list');
  list.replaceChildren();
  if (!entries.some((entry) => entry.id === selectedDecisionId)) { selectedDecisionId = entries[0]?.id || null; comparisonNames = null; }
  let previousDraft = null;
  for (const entry of entries) {
    const draftKey = `${entry.demo}:${entry.draftId}`;
    if (draftKey !== previousDraft) {
      list.append(element('h3', 'history-draft-group', `${entry.demo ? 'Sample draft' : entry.setCode || 'Draft'} · ${new Date(entry.observedAt).toLocaleDateString()}`));
      previousDraft = draftKey;
    }
    const button = element('button', `history-entry ${entry.id === selectedDecisionId ? 'active' : ''}`);
    button.type = 'button';
    button.append(element('strong', '', `${entry.demo ? 'SAMPLE · ' : ''}${entry.setCode || 'Draft'} · P${entry.packNumber}P${entry.pickNumber}${entry.bookmarked ? ' ★' : ''}`),
      element('small', '', `${entry.format || 'Draft'} · ${entry.actual.length ? entry.actual.join(' + ') : 'Selection not recorded'}`));
    button.addEventListener('click', () => { selectedDecisionId = entry.id; comparisonNames = null; renderDecisionHistory(); });
    list.append(button);
  }
  const detail = byId('history-detail');
  detail.replaceChildren();
  if (!selectedDecisionId) {
    detail.append(element('h2', '', 'No recorded decisions'), element('p', '', 'Decisions are captured while Pick 42 follows a draft. Historical log scans do not reconstruct past advice.'));
    return;
  }
  const token = ++decisionDetailToken;
  window.draftCompanion.decisionDetails(selectedDecisionId).then((record) => {
    if (token !== decisionDetailToken || !record || !byId('decision-history-dialog').open) return;
    renderDecisionDetail(record);
  }).catch(() => {
    if (token === decisionDetailToken) detail.append(element('p', '', 'Could not load this decision. Select it again to retry.'));
  });
}

function renderDecisionDetail(record) {
  const host = byId('history-detail');
  host.replaceChildren();
  const header = element('div', 'history-detail-heading');
  header.append(element('h2', '', `Pack ${record.packNumber}, pick ${record.pickNumber}`));
  const bookmark = element('button', '', record.bookmarked ? 'BOOKMARKED' : 'BOOKMARK');
  bookmark.type = 'button';
  bookmark.addEventListener('click', () => updateFrom(() => window.draftCompanion.bookmarkDecision(record.id, !record.bookmarked)));
  header.append(bookmark); host.append(header);
  host.append(element('p', 'history-meta', `${record.demo ? 'Sample · ' : ''}${record.setCode || 'Unknown set'} · ${record.format} · ${new Date(record.observedAt).toLocaleString()}`));
  host.append(element('p', '', `Recorded selection: ${record.actual?.length ? record.actual.map((card) => card.name).join(' + ') : 'not yet observed in Arena’s pool'}.`));
  host.append(element('p', '', `Recorded advice: ${record.recommended?.length ? record.recommended.join(' + ') : 'rankings paused'}.`));
  host.append(element('p', 'history-gate', record.gate.message));
  if (record.pair) host.append(element('p', 'history-meta', `Pick Two: ${record.pair.second.name} was evaluated after adding ${record.pair.first.name}, with a second-pick score of ${Number(record.pair.second.score).toFixed(1)}. The comparison below uses individual scores before either pick.`));
  const cards = record.recommendations || [];
  if (!comparisonNames) {
    const first = record.recommended?.[0] || cards[0]?.name;
    const actualOther = record.actual?.find((card) => card.name !== first)?.name;
    comparisonNames = [first, actualOther || cards.find((card) => card.name !== first)?.name || first];
  }
  const controls = element('div', 'history-compare-controls');
  comparisonNames.forEach((name, index) => {
    const label = element('label', '', index ? 'Compare with' : 'Card');
    const select = element('select');
    for (const candidate of cards) {
      const option = element('option', '', candidate.name); option.value = candidate.name; option.selected = candidate.name === name; select.append(option);
    }
    select.addEventListener('change', () => { comparisonNames[index] = select.value; renderDecisionDetail(record); });
    label.append(select); controls.append(label);
  });
  host.append(controls);
  const chosen = comparisonNames.map((name) => cards.find((card) => card.name === name));
  const table = element('table', 'history-comparison');
  const row = (label, values) => {
    const tr = element('tr'); tr.append(element('th', '', label));
    for (const value of values) tr.append(element('td', '', value)); table.append(tr);
  };
  const number = (value) => Number.isFinite(value) ? value.toFixed(1) : '—';
  row('Card', chosen.map((card) => card?.name || '—'));
  row('Raw rank · score', chosen.map((card) => Number.isFinite(card?.rawRank) && Number.isFinite(card?.dataScore) ? `#${card.rawRank} · ${number(card.dataScore)}` : '—'));
  row('Context rank · score', chosen.map((card) => Number.isFinite(card?.contextualRank) && Number.isFinite(card?.score) ? `#${card.contextualRank} · ${number(card.score)}` : '—'));
  row('Sources', chosen.map((card) => `${card?.sourceCoverage || 0}/2`));
  const labels = { lane: 'Lane', duplicate: 'Duplicates', color: 'Color fit', flexibility: 'Flexibility', curve: 'Curve', signal: 'Signals', synergy: 'Synergy', interaction: 'Interaction', impact: 'Draw impact', creature: 'Creature needs', aggression: 'Aggression roles', control: 'Control roles', fixing: 'Fixing', rarity: 'Rarity', archetype: 'Trophy pattern', poolPlan: 'OUT preference' };
  if (record.gate.ready) for (const [key, label] of Object.entries(labels)) {
    if (chosen.some((card) => card?.adjustments?.[key])) row(label, chosen.map((card) => number(card?.adjustments?.[key])));
  }
  if (record.gate.ready) row('Scaling, bounds, rounding', chosen.map((card) => Number.isFinite(card?.score) && Number.isFinite(card?.dataScore) ? number(card.score - card.dataScore - Object.values(card.adjustments || {}).reduce((sum, value) => sum + (Number(value) || 0), 0)) : '—'));
  host.append(table);
  for (const card of chosen.filter(Boolean)) {
    const details = element('details', 'history-reasons'); details.append(element('summary', '', `${card.name} · recorded evidence`));
    for (const reason of card.reasons || []) details.append(element('p', '', typeof reason === 'string' ? reason : [reason.label, reason.detail].filter(Boolean).join(' · ')));
    if (!record.gate.ready) details.append(element('p', '', 'Recommendations were paused for this pack.'));
    for (const [source, data] of Object.entries(card.metrics || {})) {
      if (!data || typeof data !== 'object') continue;
      const value = source === 'seventeenLands' ? data.gihWinRate : data.inHandWinRate;
      if (Number.isFinite(value)) details.append(element('p', '', `${source === 'seventeenLands' ? '17Lands' : 'Untapped'} · ${number(value)}%${data.winRateBasis ? ` · ${data.winRateBasis}` : ''}`));
    }
    host.append(details);
  }
  const context = element('details', 'history-reasons'); context.append(element('summary', '', `Pool before the pick · ${record.pool.length} cards`));
  const grouped = new Map();
  for (const card of record.pool) grouped.set(card.name, (grouped.get(card.name) || 0) + (card.quantity || 1));
  for (const [name, quantity] of grouped) context.append(element('p', '', `${quantity}× ${name}`));
  context.append(element('p', '', `OUT: ${record.excluded?.join(', ') || 'none'}`));
  context.append(element('p', '', `Lane: ${record.lane?.name || record.lane?.label || record.lane?.colors?.join('/') || 'open'}`));
  const policies = { auto: 'Automatic lane', 'lock-no-splash': 'Locked · no splash', 'lock-splash': 'Locked · open to a light splash', 'stay-open': 'Stay open' };
  context.append(element('p', '', `Lane policy: ${policies[record.lane?.mode] || 'Automatic lane'}`));
  context.append(element('p', 'history-meta', `Source fingerprints · 17L ${record.sources?.seventeenLands || 'none'} · UT ${record.sources?.untapped || 'none'} · corpus ${record.sources?.corpus || 'none'}`));
  host.append(context, element('p', 'history-meta', 'This is the evidence recorded at the decision. Later imports do not rescore it. A score difference is not a predicted change in win rate.'));
}
