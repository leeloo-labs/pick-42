'use strict';

// Draft view: current decision, lane, hero, ranking, and pool.

function renderDecision() {
  setText('set-name', model.draft.setCode || 'DRAFT');
  setText('pack-number', model.draft.packNumber || '—');
  setText('pick-number', model.draft.pickNumber || '—');
  setText('format-pill', String(model.draft.format || 'DRAFT').toUpperCase());
}

function renderLane() {
  const lane = model.draftLane || {};
  const card = byId('lane-card');
  const inferredStatus = lane.automatic?.status || lane.status;
  const visible = lane.manual || ['leaning', 'committed'].includes(inferredStatus);
  card.hidden = !visible;
  if (!visible) {
    laneMenuOpen = false;
    return;
  }

  const stayingOpen = lane.mode === 'stay-open';
  const statusLabel = stayingOpen
    ? 'STAYING OPEN'
    : lane.status === 'locked'
      ? 'LOCKED'
      : lane.status === 'committed'
        ? 'COMMITTED'
        : 'LEANING';
  const detail = stayingOpen
    ? `Watching ${lane.label} signals without restricting the pack`
    : lane.mode === 'lock-no-splash'
      ? 'No splash · off-color cards are gated'
      : lane.mode === 'lock-splash'
        ? 'Locked · premium light splashes remain eligible'
        : lane.status === 'committed'
          ? 'Lane established · contextual ranking now works within it'
          : 'Likely lane · lock it manually when you are ready';
  card.className = `lane-card status-${lane.status || 'open'} mode-${lane.mode || 'auto'} ${laneMenuOpen ? 'menu-open' : ''}`;
  setText('lane-status', statusLabel);
  setText('lane-label', stayingOpen ? 'Signals unlocked' : lane.label);
  setText('lane-detail', detail);
  setText('lane-confidence', `${lane.confidence ?? 0}%`);
  setIcon(byId('lane-glyph'), lane.status === 'locked' ? 'lock-keyhole' : lane.status === 'committed' ? 'scan-search' : 'unlock');
  setText('lane-lock-name', `Lock in ${lane.label} — no splash`);
  setText('lane-splash-name', `Lock in ${lane.label} — light splash`);
  byId('lane-menu').hidden = !laneMenuOpen;
  byId('lane-summary').setAttribute('aria-expanded', String(laneMenuOpen));
  byId('lane-resume-auto').hidden = !lane.manual;
  for (const option of document.querySelectorAll('[data-lane-mode]')) {
    const active = lane.mode === option.dataset.laneMode;
    option.classList.toggle('active', active);
    option.setAttribute('aria-pressed', String(active));
  }
}

function activeRecommendations() {
  if (rankingMode === 'raw') {
    return [...model.recommendations].sort((left, right) => left.rawRank - right.rawRank);
  }
  return model.recommendations;
}

function chosenCard() {
  const cards = activeRecommendations();
  return cards.find((card) => card.name === selectedName && card.eligible)
    || cards.find((card) => card.eligible)
    || null;
}

function rawReasons(card) {
  if (card.dataScore === null || card.dataScore === undefined) return ['No usable imported in-hand data'];
  const reasons = [];
  if (card.metrics.seventeenLands?.gihWinRate !== null && card.metrics.seventeenLands?.gihWinRate !== undefined) {
    reasons.push(`17L ${percent(card.metrics.seventeenLands.gihWinRate)} ${card.metrics.seventeenLands.winRateBasis || 'GIH'}`);
  }
  if (card.metrics.untapped?.inHandWinRate !== null && card.metrics.untapped?.inHandWinRate !== undefined) {
    reasons.push(`Untapped ${percent(card.metrics.untapped.inHandWinRate)} in-hand`);
  }
  reasons.push(`${card.metrics.confidence || 0}% sample confidence`);
  if (card.contextualRank !== card.rawRank) reasons.push(`Context moves this to #${card.contextualRank}`);
  return reasons;
}

function renderRankingLens() {
  const raw = rankingMode === 'raw';
  setText('ranking-lens-title', raw ? 'Raw, in-a-vacuum ranking' : 'Contextual recommendation');
  setText('ranking-lens-detail', raw
    ? 'Confidence-adjusted 17Lands and Untapped results only. Your lane and pool are ignored.'
    : 'Manual lane choice, active pool, curve, synergy, duplicates, and trophy patterns.');
  for (const [id, active] of [['ranking-contextual', !raw], ['ranking-raw', raw]]) {
    byId(id).classList.toggle('active', active);
    byId(id).setAttribute('aria-pressed', String(active));
  }
}

function renderHero() {
  if (!model.recommendationGate.ready) return;
  const card = chosenCard();
  if (!card) {
    setText('hero-score', '—');
    setText('hero-name', 'Waiting for a draft pack');
    setText('hero-type', 'Arena draft events will appear here.');
    configureImpactFlag(byId('hero-impact-flag'), null);
    configureOutlookFlag(byId('hero-outlook-flag'), null);
    return;
  }
  const rank = rankingMode === 'raw' ? card.rawRank : card.contextualRank;
  const isTop = rank === 1;
  const pairActive = Boolean(model.pickPair) && rankingMode === 'contextual';
  setText('hero-rank-label', isTop ? (pairActive ? 'PICK 1' : 'PICK') : `#${rank}`);
  setText('hero-kicker', isTop
    ? (rankingMode === 'raw' ? 'TOP RAW CARD' : (pairActive ? 'TOP CONTEXTUAL PAIR' : (card.pickOutlook?.fallback ? 'BEST AVAILABLE FALLBACK' : 'TOP CONTEXTUAL PICK')))
    : (rankingMode === 'raw' ? 'INSPECTING RAW RANK' : 'INSPECTING CONTEXTUAL RANK'));
  setText('hero-score', Number(rankingMode === 'raw' ? card.dataScore : card.score).toFixed(1));
  setText('hero-score-label', rankingMode === 'raw' ? 'RAW SCORE' : 'CONTEXT SCORE');
  setText('hero-name', card.name);
  const heroMana = byId('hero-mana');
  heroMana.replaceChildren();
  const heroPips = manaPipsElement(card.manaCost);
  if (heroPips) heroMana.append(heroPips);
  else heroMana.textContent = '—';
  setText('hero-type', card.typeLine || `Arena ID ${card.grpId}`);
  setText('hero-17', percent(card.metrics.seventeenLands?.gihWinRate));
  setText('hero-17-basis', `${card.metrics.seventeenLands?.winRateBasis || 'GIH'} WR`);
  setText('hero-ut', percent(card.metrics.untapped?.inHandWinRate));
  if (rankingMode === 'raw') {
    setText('hero-adjust-label', 'CONTEXT RANK · SCORE');
    setText('hero-delta', `#${card.contextualRank} · ${card.score.toFixed(1)}`);
    byId('hero-delta').style.color = 'var(--violet)';
  } else {
    setText('hero-adjust-label', 'RAW RANK · SCORE');
    setText('hero-delta', `#${card.rawRank} · ${card.dataScore.toFixed(1)}`);
    byId('hero-delta').style.color = 'var(--cyan)';
  }
  configureImpactFlag(byId('hero-impact-flag'), card);
  configureOutlookFlag(byId('hero-outlook-flag'), card);

  const reasons = byId('hero-reasons');
  reasons.replaceChildren();
  const activeReasons = rankingMode === 'raw' ? rawReasons(card) : card.reasons;
  if (rankingMode === 'contextual' && card.pickOutlook) reasons.append(element('span', 'reason-chip outlook-reason', card.pickOutlook.detail));
  for (const reason of activeReasons.slice(0, 4)) reasons.append(element('span', 'reason-chip', reason));

  const pairNode = byId('hero-pair');
  let bandPair = null;
  let inspecting = false;
  if (rankingMode === 'contextual' && model.pickPair) {
    if (card.name === model.pickPair.first.name) {
      bandPair = model.pickPair;
    } else {
      // Inspecting a different card: show the best companion for THAT card instead
      // of the stale recommended pair (which could even duplicate the inspected card).
      bandPair = ensureInspectedPair(card.name);
      inspecting = true;
    }
  }
  if (bandPair) {
    pairNode.hidden = false;
    setText('hero-pair-eyebrow', inspecting ? 'PICK TWO · BEST COMPANION FOR THIS PICK' : 'PICK TWO · TAKE BOTH');
    setText('hero-pair-score', bandPair.second.score.toFixed(1));
    setText('hero-pair-name', bandPair.second.name);
    const pairMana = byId('hero-pair-mana');
    pairMana.replaceChildren();
    const pairPips = manaPipsElement(bandPair.second.manaCost);
    if (pairPips) pairMana.append(pairPips);
    const note = bandPair.second.reason
      ? bandPair.second.reason
      : (bandPair.second.outlook || '');
    setText('hero-pair-note', `${bandPair.second.typeLine ? `${bandPair.second.typeLine} · ` : ''}${!inspecting && bandPair.secondDiffersFromList ? 'Rises above the list order once the first pick joins your pool' : (note || 'Scored with the first pick already in your pool')}`);
    hydrateIcons(pairNode);
  } else {
    pairNode.hidden = true;
  }
}

let inspectedPair = null;
let inspectedPairKey = null;

function ensureInspectedPair(cardName) {
  const key = `${model.draft.draftId}:${model.draft.packNumber}:${model.draft.pickNumber}:${cardName}`;
  if (inspectedPairKey === key) return inspectedPair;
  inspectedPairKey = key;
  inspectedPair = null;
  window.draftCompanion.pickPairFor(cardName).then((pair) => {
    if (inspectedPairKey !== key) return;
    inspectedPair = pair;
    renderHero();
  }).catch(() => { /* Leave the band hidden if the pack changed mid-request. */ });
  return null;
}

function sourceStat(label, value, className) {
  const stat = element('span', `source-stat ${className}`);
  stat.append(element('b', '', label), document.createTextNode(percent(value)));
  return stat;
}

// The SET PREP card: pick the set you are drafting next and watch each data
// requirement check off as its file lands. Every state is measured — a slot
// counts only when its rows name the set's cards.
function renderSetPrep() {
  const host = byId('set-prep');
  const prep = model.setPrep;
  if (!host) return;
  host.replaceChildren();
  if (!prep) return;

  const card = element('div', 'set-prep-card');
  const head = element('div', 'set-prep-head');
  head.append(element('span', 'set-prep-eyebrow', 'SET PREP'));
  const sets = element('div', 'set-prep-sets');
  for (const entry of prep.availableSets || []) {
    const chip = element('button', `set-prep-chip ${entry.active ? 'active' : ''}`);
    chip.type = 'button';
    chip.append(element('b', '', entry.displayCode), element('small', '', entry.name));
    if (!entry.active) chip.addEventListener('click', () => updateFrom(() => window.draftCompanion.setActiveSet(entry.code)));
    sets.append(chip);
  }
  head.append(sets);
  card.append(head);

  const formats = element('div', 'set-prep-formats');
  for (const format of prep.formats || []) {
    const chip = element('button', `set-prep-format ${format === prep.format ? 'active' : ''}`, format === 'any' ? 'ANY' : format.toUpperCase());
    chip.type = 'button';
    chip.addEventListener('click', () => updateFrom(() => window.draftCompanion.setPrepFormat(format)));
    formats.append(chip);
  }
  card.append(formats);

  const progress = element('div', 'set-prep-progress');
  const track = element('span', 'set-prep-track');
  const bar = element('span', 'set-prep-bar');
  bar.style.width = `${prep.percent}%`;
  track.append(bar);
  progress.append(track, element('b', '', `${prep.readyCount} of ${prep.total} ready`));
  card.append(progress);
  const summary = prep.complete
    ? `${prep.displayCode} is fully prepared. Draft when ready.`
    : (prep.rankingsReady
      ? `${prep.displayCode} rankings can run; the unchecked items add context.`
      : `Live ${prep.displayCode} rankings pause until both ratings sources are imported.`);
  card.append(element('p', 'set-prep-summary', summary));

  const rows = element('div', 'set-prep-items');
  for (const item of prep.items || []) {
    const row = element('div', `set-prep-item ${item.ready ? 'ready' : ''}`);
    const mark = element('span', 'set-prep-mark');
    mark.append(iconElement(item.ready ? 'circle-check' : 'circle-dashed'));
    const copy = element('span', 'set-prep-copy');
    copy.append(element('b', '', item.label), element('small', '', item.detail));
    row.append(mark, copy);
    const action = setPrepAction(item, prep);
    if (action) row.append(action);
    rows.append(row);
  }
  card.append(rows);
  host.append(card);
  hydrateIcons(card);
}

function setPrepAction(item, prep) {
  const button = (label, onClick) => {
    const control = element('button', 'set-prep-action', label);
    control.type = 'button';
    control.addEventListener('click', onClick);
    return control;
  };
  if (item.id === 'seventeenLands') return button('IMPORT CSV', () => updateFrom(() => window.draftCompanion.importSource('seventeenLands', prep.format)));
  if (item.id === 'untapped') return button('IMPORT CSV', () => updateFrom(() => window.draftCompanion.importSource('untapped', prep.format)));
  if (item.id === 'corpus') return button('IMPORT DATA', () => updateFrom(() => window.draftCompanion.importArchetypeCorpus()));
  return null;
}

function renderRanking() {
  const list = byId('ranking-list');
  list.replaceChildren();
  const hasCards = model.recommendations.length > 0;
  const ready = model.recommendationGate.ready;
  byId('hero-card').hidden = !hasCards || !ready;
  byId('coverage-gate').hidden = !hasCards || ready;
  setText('coverage-gate-message', model.recommendationGate.message);
  setText('coverage-gate-count', `${model.recommendationGate.coveredByBoth} / ${model.recommendationGate.total}`);
  setText('list-title', ready ? 'PACK RANKING' : 'PACK CONTENTS');
  setText('list-context', ready
    ? (rankingMode === 'raw' ? 'IN A VACUUM' : 'LANE + ACTIVE POOL')
    : 'UNRANKED · MISSING DATA');
  const waiting = Boolean(model.draft.waitingForPack) && !hasCards;
  byId('empty-pack').hidden = hasCards || waiting;
  renderSetPrep();
  const waitingPanel = byId('waiting-pack');
  waitingPanel.hidden = !waiting;
  if (waiting) {
    const pool = model.draft.pool || [];
    const pickCount = /pick two/i.test(String(model.draft.format || '')) ? 2 : 1;
    const taken = pool.slice(-pickCount).map((entry) => entry.name).filter(Boolean);
    setText('waiting-pack-detail', taken.length
      ? `You took ${taken.join(' + ')}. The next pack is on its way…`
      : 'The next pack is on its way…');
  }
  document.querySelector('.list-heading').hidden = !hasCards;

  activeRecommendations().forEach((card, index) => {
    const impactKind = card.metrics.impactFlag?.kind || '';
    const cardIsLand = /\bLand\b/i.test(card.typeLine || '');
    const pairRole = rankingMode === 'contextual' && model.pickPair
      ? (card.name === model.pickPair.first.name ? 'pair-first' : (card.name === model.pickPair.second.name ? 'pair-second' : ''))
      : '';
    const row = element('article', `rank-row tone-${cardTone(card, cardIsLand)} ${pairRole} ${card.eligible ? '' : 'unranked'} ${chosenCard()?.name === card.name ? 'selected' : ''} ${impactKind ? `impact-${impactKind}` : ''}`);
    applyDeckManaStyle(row, card, cardIsLand);
    row.tabIndex = 0;
    row.append(element('span', 'rank-number', String(index + 1).padStart(2, '0')));
    const copy = element('div', 'rank-card');
    const title = element('div', 'rank-card-title');
    title.append(element('strong', '', card.name));
    if (card.metrics.impactFlag) {
      const flag = element('span', 'impact-flag');
      configureImpactFlag(flag, card, true);
      title.append(flag);
    }
    if (rankingMode === 'contextual' && card.pickOutlook?.fallback) {
      const flag = element('span', 'outlook-flag');
      configureOutlookFlag(flag, card, true);
      title.append(flag);
    }
    if (rankingMode === 'contextual' && model.pickPair && card.name === model.pickPair.first.name) {
      title.append(element('span', 'pair-flag', '1ST PICK'));
    }
    if (rankingMode === 'contextual' && model.pickPair && card.name === model.pickPair.second.name) {
      const flag = element('span', 'pair-flag', '2ND PICK');
      flag.title = `Best second selection once ${model.pickPair.first.name} joins your pool`;
      title.append(flag);
    }
    const detail = rankingMode === 'raw' ? rawReasons(card)[0] : card.reasons[0];
    const detailNode = element('span', 'rank-card-detail');
    const detailPips = manaPipsElement(card.manaCost);
    if (detailPips) detailNode.append(detailPips);
    detailNode.append(document.createTextNode(detail || card.typeLine || 'No source row'));
    copy.append(title, detailNode);
    row.append(copy);
    const sources = element('div', 'rank-sources');
    sources.append(
      sourceStat('17L', card.metrics.seventeenLands?.gihWinRate, 'lands'),
      sourceStat('UT', card.metrics.untapped?.inHandWinRate, 'ut')
    );
    row.append(sources);
    const scores = element('div', `rank-dual-scores ${card.eligible ? '' : 'unranked-score'}`);
    const contextScore = element('span', `rank-lens-score contextual ${rankingMode === 'contextual' ? 'active' : ''}`);
    contextScore.append(element('small', '', `CTX #${card.contextualRank}`), element('strong', '', card.eligible ? card.score.toFixed(1) : '—'));
    const rawScore = element('span', `rank-lens-score raw ${rankingMode === 'raw' ? 'active' : ''}`);
    rawScore.append(element('small', '', `RAW #${card.rawRank}`), element('strong', '', card.dataScore === null ? '—' : card.dataScore.toFixed(1)));
    scores.append(contextScore, rawScore);
    row.append(scores);
    const select = () => { selectedName = card.name; renderHero(); renderRanking(); };
    row.addEventListener('click', select);
    row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') select(); });
    list.append(row);
  });
}

function normalizedCardName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[’‘]/g, "'")
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function poolManaValue(card) {
  const tokens = String(card.manaCost || '').match(/\{([^}]+)\}/g) || [];
  return tokens.reduce((total, token) => {
    const value = token.slice(1, -1);
    if (/^\d+$/.test(value)) return total + Number(value);
    if (/^[XYZ]$/.test(value)) return total;
    return total + 1;
  }, 0);
}

function groupedPoolCards() {
  const groups = new Map();
  for (const original of model.draft.pool) {
    const key = normalizedCardName(original.name);
    const quantity = Math.max(1, Number(original.quantity) || 1);
    const existing = groups.get(key);
    if (existing) existing.quantity += quantity;
    else groups.set(key, { ...enrichedCard(original), quantity, key });
  }
  const arenaOrder = new Map(sortArenaCards([...groups.values()]).map((card, index) => [card.key, index]));
  return [...groups.values()].sort((left, right) => {
    const leftLand = /\bLand\b/i.test(left.typeLine || '');
    const rightLand = /\bLand\b/i.test(right.typeLine || '');
    if (leftLand !== rightLand) return leftLand ? 1 : -1;
    return poolManaValue(left) - poolManaValue(right)
      || (arenaOrder.get(left.key) || 0) - (arenaOrder.get(right.key) || 0)
      || left.name.localeCompare(right.name);
  });
}

function renderPool() {
  const summary = model.poolSummary;
  setText('pool-total', summary.total);
  setText('pool-drafted-total', summary.draftedTotal);
  setText('creature-total', summary.creatures);
  setText('pool-excluded-total', summary.excludedTotal);

  const pips = byId('color-pips');
  pips.replaceChildren();
  for (const color of ['W', 'U', 'B', 'R', 'G']) {
    pips.append(element('span', `color-pip ${color} ${summary.colors[color] ? '' : 'zero'}`, `${color} ${summary.colors[color]}`));
  }

  const curve = byId('curve-chart');
  curve.replaceChildren();
  const max = Math.max(1, ...Object.values(summary.curve));
  for (const bucket of ['1', '2', '3', '4', '5+']) {
    const column = element('div', 'curve-column');
    const bar = element('span', 'curve-bar');
    bar.style.height = `${Math.max(2, (summary.curve[bucket] / max) * 27)}px`;
    column.append(element('b', '', summary.curve[bucket]), bar, element('small', '', bucket));
    curve.append(column);
  }

  const pool = byId('pool-list');
  pool.replaceChildren();
  if (!model.draft.pool.length) pool.append(element('span', 'pool-empty', 'Your picks will collect here.'));
  const excludedNames = new Set(model.poolPlan?.excludedNames || []);
  for (const card of groupedPoolCards()) {
    const excluded = excludedNames.has(card.key);
    const land = /\bLand\b/i.test(card.typeLine || '');
    const row = element('article', `pool-deck-row tone-${cardTone(card, land)} ${excluded ? 'excluded' : ''}`);
    applyDeckManaStyle(row, card, land);
    const quantity = element('span', 'pool-card-quantity', `${card.quantity}×`);
    const copy = element('span', 'pool-card-copy');
    const poolDetail = element('small', '');
    const poolPips = manaPipsElement(card.manaCost);
    if (poolPips) poolDetail.append(poolPips);
    poolDetail.append(document.createTextNode(card.typeLine || (poolPips ? '' : 'Card')));
    copy.append(element('strong', '', card.name), poolDetail);
    const toggle = element('button', `pool-card-toggle ${excluded ? 'restore' : ''}`);
    toggle.type = 'button';
    toggle.title = excluded ? 'Return this card to the active pool' : 'Exclude this card from recommendations and deck builds';
    toggle.setAttribute('aria-pressed', String(excluded));
    toggle.append(iconElement(excluded ? 'eye' : 'eye-off'), element('span', '', excluded ? 'IN' : 'OUT'));
    toggle.addEventListener('click', () => updateFrom(() => window.draftCompanion.setPoolCardExcluded(card.name, !excluded)));
    row.append(quantity, copy, toggle);
    pool.append(row);
  }
  byId('next-demo').hidden = model.status?.kind !== 'demo';
}
