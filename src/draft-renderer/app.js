'use strict';

let model = null;
let selectedName = null;
let selectedBuildId = null;
let activeView = 'draft';
let viewInitialized = false;
let rankingMode = 'contextual';
let recipeCopyTimer = null;
let previewCopyTimer = null;
let previewedCardName = null;
let deckBoardResizeFrame = null;
let deckBoardResizeObserver = null;
let laneMenuOpen = false;

const MANA_ACCENTS = Object.freeze({ W: '#d8cda9', U: '#4d9fc9', B: '#28252d', R: '#c85b48', G: '#4c925d' });

const byId = (id) => document.getElementById(id);
const { buildRecipeTasks: recipeTasks, recipeProgress } = window.ArcaneRecipe;
const { manaPresentation, manaTokens, sortArenaCards } = window.ArcaneArenaSort;

function setText(id, value) {
  byId(id).textContent = value;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconElement(name, className = '') {
  const node = element('i', className);
  node.dataset.lucide = name;
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function hydrateIcons(root = document) {
  if (!window.lucide?.createIcons) return;
  window.lucide.createIcons({
    root,
    attrs: {
      'aria-hidden': 'true',
      focusable: 'false',
      'stroke-width': 1.8
    }
  });
}

function setIcon(node, name) {
  node.replaceChildren(iconElement(name));
  hydrateIcons(node.parentElement || document);
}

function percent(value) {
  return value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`;
}

function signed(value) {
  if (value === null || value === undefined) return '—';
  return `${value >= 0 ? '+' : ''}${Number(value).toFixed(1)}`;
}

function compactMana(value) {
  return String(value || '—').replace(/[{}]/g, '');
}

function manaPipsElement(manaCost) {
  const tokens = manaTokens({ manaCost });
  if (!tokens.length) return null;
  const pips = element('span', 'mana-pips');
  pips.setAttribute('role', 'img');
  pips.setAttribute('aria-label', `Mana cost ${compactMana(manaCost)}`);
  for (const token of tokens) {
    if (/^[WUBRG]$/.test(token)) {
      pips.append(element('i', `mana-pip pip-${token}`, token));
    } else if (/^[WUBRG]\/[WUBRG]$/.test(token)) {
      const [left, right] = token.split('/');
      const pip = element('i', 'mana-pip pip-hybrid', `${left}${right}`);
      pip.style.setProperty('--pip-a', MANA_ACCENTS[left]);
      pip.style.setProperty('--pip-b', MANA_ACCENTS[right]);
      pips.append(pip);
    } else {
      pips.append(element('i', 'mana-pip pip-generic', token));
    }
  }
  return pips;
}

function configureImpactFlag(node, card, compact = false) {
  const flag = card?.metrics?.impactFlag;
  node.hidden = !flag;
  node.className = `impact-flag ${flag?.kind || ''} ${flag?.severity || ''}`;
  if (!flag) {
    node.textContent = '';
    node.removeAttribute('title');
    return;
  }
  const value = signed(card.metrics.drawImpact);
  node.textContent = compact ? `${flag.label} ${value}pp` : `${flag.label} · ${value}pp IIH`;
  node.title = `${flag.detail}. Confidence ${card.metrics.drawImpactConfidence}%.`;
}

function configureOutlookFlag(node, card, compact = false) {
  const outlook = rankingMode === 'contextual' ? card?.pickOutlook : null;
  node.hidden = !outlook;
  node.className = `outlook-flag ${outlook?.kind || ''}`;
  if (!outlook) {
    node.textContent = '';
    node.removeAttribute('title');
    return;
  }
  node.textContent = compact && outlook.fallback ? 'LIKELY OUT' : outlook.label;
  node.title = outlook.detail;
}

function renderStatus() {
  byId('status-dot').className = `status-dot ${model.status?.kind || ''}`;
  setText('status-message', model.status?.message || 'Ready');
  const gate = model.recommendationGate;
  const draftedTotal = model.poolSummary?.draftedTotal || 0;
  setText('coverage-label', gate.total
    ? `${gate.coveredByBoth} / ${gate.total} draftable cards covered by both sources`
    : (draftedTotal ? `No active pack · ${draftedTotal} cards drafted` : 'Waiting for a draft pack'));

  const source17 = model.sources.seventeenLands;
  const sourceUt = model.sources.untapped;
  const sourceLabel = (source) => source.kind === 'sample' && model.status?.kind !== 'demo' ? 'SAMPLE · OFF' : `${source.count} · ${source.kind}`;
  setText('source-17-label', sourceLabel(source17));
  setText('source-ut-label', sourceLabel(sourceUt));
  byId('import-17lands').title = source17.label;
  byId('import-untapped').title = sourceUt.label;
  const corpus = model.archetypeCorpus || {};
  const corpusSource = corpus.source || { kind: 'empty', trophyCount: 0, label: 'No corpus' };
  const corpusMatch = corpus.match || { trophyCount: 0, archetypeCount: 0 };
  const corpusLabel = corpusSource.kind === 'empty'
    ? 'Import corpus'
    : (corpusMatch.trophyCount ? `${corpusMatch.trophyCount} match` : `${corpusSource.trophyCount} · no match`);
  setText('source-meta-label', corpusLabel);
  byId('import-archetypes').title = corpusSource.kind === 'empty'
    ? 'Import an authorized trophy-deck corpus (CSV or JSON)'
    : `${corpusSource.label} · ${corpusMatch.trophyCount} matching trophies across ${corpusMatch.archetypeCount} archetypes`;
  byId('restart-demo').hidden = model.status?.kind !== 'demo';
}

function corpusFormatValue(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('quick')) return 'QuickDraft';
  if (normalized.includes('traditional')) return 'TraditionalDraft';
  if (normalized.includes('pick-two') || normalized.includes('picktwo')) return 'PickTwoDraft';
  return 'PremierDraft';
}

function setCorpusEntryMessage(message, kind = '') {
  const node = byId('corpus-entry-message');
  node.textContent = message;
  node.className = `corpus-entry-message ${kind}`;
}

function seedCorpusForm() {
  const defaults = model.archetypeCorpus?.defaults || {};
  if (!byId('corpus-set-code').value) byId('corpus-set-code').value = defaults.setCode || 'HOB';
  if (!byId('corpus-event-date').value) byId('corpus-event-date').value = defaults.eventDate || '';
  byId('corpus-format').value = corpusFormatValue(defaults.format);
}

function renderCorpusManager() {
  const corpus = model.archetypeCorpus || {};
  const manualDecks = corpus.manualDecks || [];
  const match = corpus.match || { trophyCount: 0 };
  setText('corpus-library-title', `${manualDecks.length} pasted deck${manualDecks.length === 1 ? '' : 's'}`);
  const matchPill = byId('corpus-match-pill');
  matchPill.textContent = match.trophyCount ? `${match.trophyCount} MATCHING` : 'NO ACTIVE MATCH';
  matchPill.className = `corpus-match-pill ${match.trophyCount ? 'active' : ''}`;

  const list = byId('corpus-manual-list');
  list.replaceChildren();
  for (const deck of [...manualDecks].reverse()) {
    const row = element('article', 'corpus-manual-row');
    const copy = element('div');
    const splash = deck.splashColors?.length ? ` · ${deck.splashColors.join('/')} splash` : '';
    copy.append(
      element('strong', '', deck.archetype || 'Unknown archetype'),
      element('small', '', `${deck.setCode} · ${deck.format} · ${deck.record} · ${deck.total} cards${splash}${deck.rank ? ` · ${deck.rank}` : ''}`)
    );
    const remove = element('button');
    remove.type = 'button';
    remove.title = 'Remove pasted deck';
    remove.setAttribute('aria-label', 'Remove pasted deck');
    remove.append(iconElement('trash-2'));
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Remove the ${deck.archetype || deck.setCode} ${deck.record} deck from the local corpus?`)) return;
      await updateFrom(() => window.draftCompanion.removeTrophyDeck(deck.id));
    });
    row.append(copy, remove);
    list.append(row);
  }
  if (!manualDecks.length) list.append(element('p', 'corpus-manual-empty', 'No pasted decks yet. Copy a complete deck from a 17Lands trophy page to begin building the local library.'));
  hydrateIcons(list);
}

function openCorpusManager() {
  seedCorpusForm();
  renderCorpusManager();
  setCorpusEntryMessage('A complete main deck must contain at least 40 cards.');
  const dialog = byId('corpus-dialog');
  if (!dialog.open) dialog.showModal();
  byId('corpus-deck-text').focus();
}

async function savePastedTrophyDeck() {
  const button = byId('corpus-save');
  button.disabled = true;
  setCorpusEntryMessage('Validating deck and trophy record…');
  try {
    const next = await window.draftCompanion.addTrophyDeck({
      setCode: byId('corpus-set-code').value,
      format: byId('corpus-format').value,
      record: byId('corpus-record').value,
      eventDate: byId('corpus-event-date').value,
      archetype: byId('corpus-archetype').value,
      rank: byId('corpus-rank').value,
      sourceUrl: byId('corpus-source-url').value,
      deckText: byId('corpus-deck-text').value
    });
    model = next;
    render();
    byId('corpus-record').value = '';
    byId('corpus-archetype').value = '';
    byId('corpus-rank').value = '';
    byId('corpus-source-url').value = '';
    byId('corpus-deck-text').value = '';
    setCorpusEntryMessage('Trophy deck saved to the local corpus.', 'success');
  } catch (error) {
    setCorpusEntryMessage(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

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
  setText('lane-lock-name', `Lock in ${lane.label}`);
  setText('lane-splash-name', `Lock in ${lane.label}`);
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
    reasons.push(`17L ${percent(card.metrics.seventeenLands.gihWinRate)} GIH`);
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
  setText('hero-rank-label', isTop ? 'PICK' : `#${rank}`);
  setText('hero-kicker', isTop
    ? (rankingMode === 'raw' ? 'TOP RAW CARD' : (card.pickOutlook?.fallback ? 'BEST AVAILABLE FALLBACK' : 'TOP CONTEXTUAL PICK'))
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
}

function sourceStat(label, value, className) {
  const stat = element('span', `source-stat ${className}`);
  stat.append(element('b', '', label), document.createTextNode(percent(value)));
  return stat;
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
  byId('empty-pack').hidden = hasCards;
  document.querySelector('.list-heading').hidden = !hasCards;

  activeRecommendations().forEach((card, index) => {
    const impactKind = card.metrics.impactFlag?.kind || '';
    const cardIsLand = /\bLand\b/i.test(card.typeLine || '');
    const row = element('article', `rank-row tone-${cardTone(card, cardIsLand)} ${card.eligible ? '' : 'unranked'} ${chosenCard()?.name === card.name ? 'selected' : ''} ${impactKind ? `impact-${impactKind}` : ''}`);
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
    column.append(bar, element('small', '', `${bucket} · ${summary.curve[bucket]}`));
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

function chosenBuild() {
  const builds = model.deckBuilds || [];
  return builds.find((build) => build.id === selectedBuildId) || builds[0] || null;
}

function renderView() {
  const compact = Boolean(model.arena?.compactBuildMode);
  if (compact && activeView !== 'build') {
    activeView = 'build';
  } else if (!compact && activeView === 'build') {
    activeView = 'decks';
  }
  document.body.classList.toggle('build-mode', compact);
  byId('draft-view').hidden = activeView !== 'draft';
  byId('deck-view').hidden = activeView !== 'decks';
  byId('play-view').hidden = activeView !== 'play';
  byId('build-view').hidden = activeView !== 'build';
  byId('show-draft').classList.toggle('active', activeView === 'draft');
  byId('show-decks').classList.toggle('active', activeView === 'decks');
  byId('show-play').classList.toggle('active', activeView === 'play');
  setText('deck-ready-count', (model.deckBuilds || []).length);
  setText('play-count', (model.review?.reviews || []).length);
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function checklistStorageKey(build) {
  const pool = model.draft.pool
    .map((card) => String(card.grpId || `${card.name}|${card.manaCost || ''}`))
    .sort()
    .join(',');
  const draft = model.draft.draftId || model.draft.setCode || 'limited';
  return `arcane.recipe.v2.${hashString(`${draft}|${pool}`)}.${build.id}`;
}

function readRecipe(build) {
  try {
    const saved = JSON.parse(localStorage.getItem(checklistStorageKey(build)) || '{}');
    return {
      done: new Set(Array.isArray(saved.done) ? saved.done : []),
      skipped: new Set(Array.isArray(saved.skipped) ? saved.skipped : []),
      history: Array.isArray(saved.history) ? saved.history.filter((entry) => entry?.id && entry?.status) : []
    };
  } catch {
    return { done: new Set(), skipped: new Set(), history: [] };
  }
}

function writeRecipe(build, recipe) {
  localStorage.setItem(checklistStorageKey(build), JSON.stringify({
    done: [...recipe.done],
    skipped: [...recipe.skipped],
    history: recipe.history.slice(-200)
  }));
}

function currentRecipe(build) {
  const tasks = recipeTasks(build);
  const state = readRecipe(build);
  return { tasks, state, ...recipeProgress(tasks, state.done, state.skipped) };
}

function recipeDetail(task) {
  if (task.kind === 'cut') return `Drafted ${task.card.quantity || 1}× · remove every copy from Arena`;
  if (task.card.land) {
    const colors = (task.card.colors || []).join('/');
    return task.card.basic ? 'Basic land · set the final quantity' : `Drafted land${colors ? ` · ${colors}` : ''}`;
  }
  return `${compactMana(task.card.manaCost)} · ${task.card.typeLine || 'SPELL'}`;
}

function recipeQueueRow(task, state, index, current) {
  const status = state.done.has(task.id) ? 'done' : state.skipped.has(task.id) ? 'skipped' : task.id === current?.id ? 'current' : '';
  const row = element('article', `recipe-queue-row ${task.kind} ${status}`);
  const marker = element('span', 'recipe-queue-index');
  if (status === 'done') marker.append(iconElement('check'));
  else if (status === 'skipped') marker.append(iconElement('skip-forward'));
  else marker.textContent = String(index + 1).padStart(2, '0');
  row.append(marker);
  const copy = element('span', 'recipe-queue-copy');
  copy.append(element('b', '', task.card.name), element('small', '', `${task.phase} · ${task.kind === 'cut' ? '0' : task.target} TARGET`));
  row.append(copy, element('strong', 'recipe-queue-target', task.kind === 'cut' ? 'REMOVE' : `${task.target}×`));
  return row;
}

async function copyRecipeSearch(task) {
  if (!task) return;
  await window.draftCompanion.copySearch(task.card.name);
  const label = byId('recipe-copy-label');
  label.textContent = 'COPIED';
  clearTimeout(recipeCopyTimer);
  recipeCopyTimer = setTimeout(() => { label.textContent = 'COPY SEARCH'; }, 900);
}

async function advanceRecipe(status = 'done') {
  const build = chosenBuild();
  if (!build) return;
  const recipe = currentRecipe(build);
  if (!recipe.current) return;
  recipe.state.done.delete(recipe.current.id);
  recipe.state.skipped.delete(recipe.current.id);
  recipe.state[status === 'skipped' ? 'skipped' : 'done'].add(recipe.current.id);
  recipe.state.history.push({ id: recipe.current.id, status: status === 'skipped' ? 'skipped' : 'done' });
  writeRecipe(build, recipe.state);
  renderBuildOverlay();
  const next = currentRecipe(build).current;
  if (next) await copyRecipeSearch(next);
}

async function undoRecipe() {
  const build = chosenBuild();
  if (!build) return;
  const recipe = currentRecipe(build);
  const previous = recipe.state.history.pop();
  if (!previous) return;
  recipe.state.done.delete(previous.id);
  recipe.state.skipped.delete(previous.id);
  writeRecipe(build, recipe.state);
  renderBuildOverlay();
  const restored = recipeTasks(build).find((task) => task.id === previous.id);
  if (restored) await copyRecipeSearch(restored);
}

function renderBuildOverlay() {
  const builds = model.deckBuilds || [];
  const build = chosenBuild();
  byId('build-empty').hidden = Boolean(build);
  byId('build-content').hidden = !build;
  setText('build-scene-pill', model.arena?.inDeckBuilder ? 'DECK BUILDER' : 'MANUAL');

  const tabs = byId('build-archetype-tabs');
  tabs.replaceChildren();
  for (const entry of builds) {
    const tab = element('button', entry.id === build?.id ? 'active' : '');
    tab.type = 'button';
    tab.append(element('strong', '', entry.name), element('span', '', entry.score === null ? '—' : entry.score.toFixed(1)));
    tab.addEventListener('click', () => {
      selectedBuildId = entry.id;
      renderDeckBuilder();
      renderBuildOverlay();
      updateFrom(() => window.draftCompanion.selectBuild(entry.id));
    });
    tabs.append(tab);
  }
  if (!build) return;

  setText('build-name', build.name);
  setText('build-label', build.label);
  setText('build-stability', build.mana.stability);
  byId('build-stability').className = `build-stability ${build.mana.warnings.length ? 'warning' : ''}`;
  setText('build-spell-count', build.summary.spells);
  setText('build-land-count', build.summary.lands);
  setText('build-creature-count', build.summary.creatures);
  setText('build-interaction-count', build.summary.interaction);

  const recipe = currentRecipe(build);
  const total = recipe.tasks.length;
  const remaining = total - recipe.completed;
  setText('build-progress-value', `${recipe.completed}/${total}`);
  setText('build-progress-copy', remaining ? `${remaining} recipe steps left` : 'Recipe complete · verify 40 cards');
  byId('build-progress-bar').style.width = `${total ? (recipe.completed / total) * 100 : 0}%`;
  setText('recipe-step-count', `${recipe.completed} / ${total}`);

  const currentPanel = byId('recipe-current');
  const completePanel = byId('recipe-complete');
  currentPanel.hidden = !recipe.current;
  completePanel.hidden = Boolean(recipe.current);
  byId('recipe-undo').disabled = recipe.state.history.length === 0;
  if (recipe.current) {
    const position = recipe.tasks.findIndex((task) => task.id === recipe.current.id) + 1;
    setText('recipe-phase', recipe.current.phase);
    byId('recipe-phase').className = `recipe-phase ${recipe.current.kind}`;
    setText('recipe-position', `STEP ${position} OF ${total}`);
    setText('recipe-action', 'SET TO');
    setText('recipe-quantity', recipe.current.target);
    setText('recipe-card-name', recipe.current.card.name);
    setText('recipe-card-detail', recipeDetail(recipe.current));
    setText('recipe-next-label', remaining === 1 ? 'DONE' : 'DONE + NEXT');
  } else {
    const skipped = recipe.tasks.filter((task) => recipe.state.skipped.has(task.id)).length;
    byId('recipe-complete').querySelector('p').textContent = skipped
      ? `${skipped} step${skipped === 1 ? ' was' : 's were'} skipped. Review those quantities, then confirm Arena shows 40 cards.`
      : 'Every target quantity has been confirmed. Check Arena shows 40 cards before continuing.';
  }

  const list = byId('recipe-queue-list');
  list.replaceChildren();
  recipe.tasks.forEach((task, index) => list.append(recipeQueueRow(task, recipe.state, index, recipe.current)));
  hydrateIcons(list);
}

function cardColorSymbols(card, land = false) {
  const symbols = land ? [...(card.colors || [])] : (String(card.manaCost || '').match(/[WUBRG]/g) || []);
  if (land && !symbols.length) {
    const manaAbilities = (String(card.rulesText || '').match(/\bAdd\b[^.\n]*/gi) || []).join(' ');
    symbols.push(...(manaAbilities.match(/[WUBRG]/g) || []));
  }
  const basicColor = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' }[card.name];
  if (!symbols.length && basicColor) symbols.push(basicColor);
  return [...new Set(symbols)];
}

function cardTone(card, land = false) {
  const colors = cardColorSymbols(card, land);
  if (colors.length > 1) return 'multicolor';
  return { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' }[colors[0]] || 'colorless';
}

function cardGlyph(card, land = false) {
  const type = String(card.typeLine || '');
  if (land || /\bLand\b/i.test(type)) return 'mountain';
  if (/\bCreature\b/i.test(type)) return 'paw-print';
  if (/\bInstant\b/i.test(type)) return 'zap';
  if (/\bSorcery\b/i.test(type)) return 'scroll-text';
  if (/\bArtifact\b/i.test(type)) return 'anvil';
  if (/\bEnchantment\b/i.test(type)) return 'sparkles';
  return 'diamond';
}

function applyDeckManaStyle(tile, card, land = false) {
  const landColors = land ? cardColorSymbols(card, true) : [];
  const presentation = land && landColors.length === 2
    ? { mode: 'hybrid', sourceColors: landColors }
    : manaPresentation(card);
  if (!['hybrid', 'gold'].includes(presentation.mode)) return;
  tile.classList.add(`mana-${presentation.mode}`);
  tile.style.setProperty('--mana-a', MANA_ACCENTS[presentation.sourceColors[0]]);
  tile.style.setProperty('--mana-b', MANA_ACCENTS[presentation.sourceColors[1]]);
}

function scryfallDetails(card) {
  return model?.scryfall?.cards?.[card.name] || null;
}

function enrichedCard(card) {
  const scryfall = scryfallDetails(card);
  if (!scryfall) return { ...card, scryfall: null };
  return {
    ...card,
    manaCost: scryfall.manaCost || card.manaCost,
    typeLine: scryfall.typeLine || card.typeLine,
    rulesText: scryfall.oracleText || card.rulesText,
    printedPower: scryfall.power ?? card.printedPower,
    printedToughness: scryfall.toughness ?? card.printedToughness,
    scryfall
  };
}

function deckRatingLabel(card, land = false) {
  if (land || card.sourceValue === null || card.sourceValue === undefined) return card.basic ? 'BASIC LAND' : 'DRAFTED CARD';
  return `${Number(card.sourceValue).toFixed(1)} BLENDED RATING`;
}

function previewCard(card, land = false) {
  previewedCardName = card.name;
  const displayCard = enrichedCard(card);
  const tone = cardTone(displayCard, land);
  const preview = byId('deck-card-preview');
  preview.className = `preview-card tone-${tone}`;
  setText('preview-card-name', displayCard.name);
  setText('preview-card-mana', land ? (cardColorSymbols(displayCard, true).join('/') || 'LAND') : compactMana(displayCard.manaCost));
  setIcon(byId('preview-card-glyph'), cardGlyph(displayCard, land));
  setText('preview-card-kind', land ? 'LAND' : String(displayCard.typeLine || 'SPELL').split('—')[0].trim().toUpperCase());
  setText('preview-card-type', displayCard.typeLine || (land ? 'Land' : 'Card'));
  setText('preview-card-quantity', `${card.quantity || 1}× IN DECK`);
  const fallbackRules = land
    ? `${card.name} contributes ${(card.colors || []).join('/') || 'colorless'} mana to this build.`
    : 'No rules text was available in Arena’s local card catalog.';
  setText('preview-card-rules', displayCard.rulesText || fallbackRules);
  const ratingLabel = deckRatingLabel(card, land);
  setText('preview-card-score', ratingLabel);
  const stats = byId('preview-card-stats');
  const hasStats = displayCard.printedPower !== null && displayCard.printedPower !== undefined && displayCard.printedToughness !== null && displayCard.printedToughness !== undefined;
  stats.hidden = !hasStats;
  stats.textContent = hasStats ? `${displayCard.printedPower}/${displayCard.printedToughness}` : '';

  const reasons = byId('preview-card-reasons');
  reasons.replaceChildren();
  for (const reason of (card.reasons || []).slice(0, 3)) reasons.append(element('span', '', reason));

  const image = byId('preview-card-image');
  const fallback = byId('preview-card-fallback');
  const imageMeta = byId('preview-image-meta');
  const attribution = byId('preview-card-attribution');
  const imageUrl = displayCard.scryfall?.imageUris?.normal;
  const showFallback = () => {
    image.hidden = true;
    fallback.hidden = false;
    imageMeta.hidden = true;
    attribution.hidden = true;
    preview.classList.remove('has-scryfall-image');
  };
  if (imageUrl) {
    image.onerror = showFallback;
    image.alt = `${displayCard.name} card image from Scryfall`;
    image.src = imageUrl;
    image.hidden = false;
    fallback.hidden = true;
    imageMeta.hidden = false;
    attribution.hidden = false;
    preview.classList.add('has-scryfall-image');
    setText('preview-image-quantity', `${card.quantity || 1}× IN DECK`);
    setText('preview-image-score', ratingLabel);
    attribution.textContent = `Image via Scryfall${displayCard.scryfall.artist ? ` · Art by ${displayCard.scryfall.artist}` : ''}`;
  } else {
    image.removeAttribute('src');
    showFallback();
  }
  for (const node of document.querySelectorAll('.deck-mini-card')) node.classList.toggle('previewing', node.dataset.cardName === card.name);
}

function resetDeckSidebar() {
  for (const id of ['deck-total', 'deck-land-count', 'deck-creature-count', 'deck-interaction-count', 'deck-avg-mv']) setText(id, '—');
  previewedCardName = null;
  const preview = byId('deck-card-preview');
  preview.className = 'preview-card tone-colorless';
  const image = byId('preview-card-image');
  image.hidden = true;
  image.removeAttribute('src');
  byId('preview-card-fallback').hidden = false;
  byId('preview-image-meta').hidden = true;
  byId('preview-card-attribution').hidden = true;
  setText('preview-card-name', 'No card selected');
  setText('preview-card-mana', '—');
  setIcon(byId('preview-card-glyph'), 'diamond');
  setText('preview-card-kind', 'DECK CARD');
  setText('preview-card-type', 'Select a card from the board');
  setText('preview-card-quantity', '—');
  setText('preview-card-rules', 'Hover or focus any card to read its full details here.');
  byId('preview-card-reasons').replaceChildren();
  setText('preview-card-score', 'TARGET DECK');
  const stats = byId('preview-card-stats');
  stats.hidden = true;
  stats.textContent = '';
  setText('mana-stability', '—');
  setText('mana-land-total', '—');
  byId('mana-source-list').replaceChildren();
  const note = byId('mana-note');
  note.className = 'mana-note';
  note.textContent = '';
  byId('deck-curve').replaceChildren();
  byId('deck-cuts').replaceChildren();
}

function deckBoardCard(card, land = false, index = 0) {
  const displayCard = enrichedCard(card);
  const tile = element('article', `deck-mini-card tone-${cardTone(displayCard, land)}`);
  tile.tabIndex = 0;
  tile.dataset.cardName = card.name;
  tile.style.setProperty('--stack-index', index);
  tile.setAttribute('aria-label', `${card.quantity || 1} ${displayCard.name}. ${displayCard.typeLine || ''}`);
  applyDeckManaStyle(tile, displayCard, land);

  const title = element('header', 'deck-mini-title');
  title.append(
    element('strong', '', displayCard.name),
    element('span', 'deck-mini-mana', land ? (cardColorSymbols(displayCard, true).join('') || '◆') : compactMana(displayCard.manaCost)),
    element('em', 'deck-mini-quantity', `${card.quantity || 1}×`)
  );
  const art = element('div', 'deck-mini-art');
  const typeIcon = element('span', 'deck-mini-type-icon');
  typeIcon.append(iconElement(cardGlyph(displayCard, land)));
  art.append(typeIcon, element('small', '', land ? 'LAND' : String(displayCard.typeLine || 'CARD').split('—')[0].trim().toUpperCase()));
  const artUrl = displayCard.scryfall?.imageUris?.artCrop;
  if (artUrl) {
    art.classList.add('has-scryfall-art');
    art.style.backgroundImage = `url("${artUrl}"), linear-gradient(145deg, var(--card-deep), var(--card-mid))`;
  }
  const footer = element('footer', 'deck-mini-footer');
  footer.append(element('span', '', displayCard.typeLine || (land ? 'Land' : 'Card')));
  if (displayCard.printedPower !== null && displayCard.printedPower !== undefined && displayCard.printedToughness !== null && displayCard.printedToughness !== undefined) {
    footer.append(element('b', '', `${displayCard.printedPower}/${displayCard.printedToughness}`));
  }
  tile.append(title, art, footer);
  const inspect = () => previewCard(card, land);
  tile.addEventListener('mouseenter', inspect);
  tile.addEventListener('focus', inspect);
  tile.addEventListener('click', inspect);
  return tile;
}

function resizeDeckBoardCards() {
  if (deckBoardResizeFrame !== null) cancelAnimationFrame(deckBoardResizeFrame);
  deckBoardResizeFrame = requestAnimationFrame(() => {
    deckBoardResizeFrame = null;
    for (const stack of document.querySelectorAll('.deck-card-stack')) {
      const width = stack.getBoundingClientRect().width;
      if (!width) continue;
      const count = Number(stack.dataset.cardCount || 0);
      const cardHeight = width * 1.4;
      const stackStep = Math.max(25, Math.min(42, width * 0.18));
      const stackHeight = count ? cardHeight + Math.max(0, count - 1) * stackStep : cardHeight;
      stack.style.setProperty('--deck-card-width', `${width}px`);
      stack.style.setProperty('--deck-stack-step', `${stackStep}px`);
      stack.style.height = `${Math.max(176, stackHeight)}px`;
    }
  });
}

function renderDeckBuilder() {
  const builds = model.deckBuilds || [];
  const build = chosenBuild();
  const empty = !build;
  byId('deck-empty').hidden = !empty;
  byId('deck-board-shell').hidden = empty;

  const tabs = byId('deck-tabs');
  tabs.replaceChildren();
  for (const entry of builds) {
    const tab = element('button', `deck-tab ${entry.id === build?.id ? 'active' : ''}`);
    const copy = element('span');
    copy.append(element('strong', '', entry.name), element('small', '', entry.label));
    tab.append(copy, element('span', '', entry.score === null ? '—' : entry.score.toFixed(1)));
    tab.addEventListener('click', () => {
      selectedBuildId = entry.id;
      renderDeckBuilder();
      renderBuildOverlay();
      updateFrom(() => window.draftCompanion.selectBuild(entry.id));
    });
    tabs.append(tab);
  }

  if (!build) {
    setText('deck-name', 'Waiting for a complete pool');
    setText('deck-label', '40 CARDS');
    setText('deck-description', 'Pick 42 will generate color suggestions after enough cards have been drafted.');
    setText('deck-score', '—');
    resetDeckSidebar();
    return;
  }

  setText('deck-name', build.name);
  setText('deck-label', build.label);
  setText('deck-description', build.description);
  setText('deck-score', build.score.toFixed(1));
  setText('deck-total', build.summary.total);
  setText('deck-land-count', build.summary.lands);
  setText('deck-creature-count', `${build.summary.creatures} + tokens`);
  setText('deck-interaction-count', build.summary.interaction);
  setText('deck-avg-mv', Number(build.summary.averageManaValue).toFixed(2));

  const board = byId('deck-columns');
  board.replaceChildren();
  const buckets = [
    { label: 'ONE', cards: build.mainDeck.filter((card) => card.manaValue <= 1) },
    { label: 'TWO', cards: build.mainDeck.filter((card) => card.manaValue === 2) },
    { label: 'THREE', cards: build.mainDeck.filter((card) => card.manaValue === 3) },
    { label: 'FOUR', cards: build.mainDeck.filter((card) => card.manaValue === 4) },
    { label: 'FIVE', cards: build.mainDeck.filter((card) => card.manaValue === 5) },
    { label: 'SIX+', cards: build.mainDeck.filter((card) => card.manaValue >= 6) },
    { label: 'LANDS', cards: build.lands, land: true }
  ];
  for (const bucket of buckets) {
    const lane = element('section', `deck-lane ${bucket.land ? 'lands' : ''}`);
    const total = bucket.cards.reduce((count, card) => count + card.quantity, 0);
    const heading = element('header', 'deck-lane-heading');
    heading.append(element('span', '', bucket.label), element('b', '', total));
    const stack = element('div', 'deck-card-stack');
    const sortedCards = sortArenaCards(bucket.cards.map(enrichedCard), { lands: bucket.land });
    stack.dataset.cardCount = String(sortedCards.length);
    sortedCards.forEach((card, index) => stack.append(deckBoardCard(card, bucket.land, index)));
    if (!bucket.cards.length) stack.append(element('span', 'deck-lane-empty', '—'));
    lane.append(heading, stack);
    board.append(lane);
  }
  resizeDeckBoardCards();

  const allCards = [...build.mainDeck.map((card) => ({ card, land: false })), ...build.lands.map((card) => ({ card, land: true }))];
  const preferred = allCards.find((entry) => entry.card.name === previewedCardName) || allCards[0];
  if (preferred) previewCard(preferred.card, preferred.land);

  setText('mana-stability', build.mana.stability);
  setText('mana-land-total', build.summary.lands);
  const manaList = byId('mana-source-list');
  manaList.replaceChildren();
  for (const land of build.lands) {
    const row = element('div', 'mana-source-row');
    const copy = element('div');
    copy.append(element('strong', '', `${land.quantity}× ${land.name}`), element('small', '', `${(land.colors || []).join('/')} source${land.quantity === 1 ? '' : 's'}`));
    row.append(copy, element('span', '', land.basic ? 'BASIC' : 'DRAFTED'));
    manaList.append(row);
  }
  const warnings = build.mana.warnings || [];
  const note = byId('mana-note');
  note.className = `mana-note ${warnings.length ? 'warning' : ''}`;
  note.textContent = warnings.length ? `Mana warning: ${warnings.join(' · ')}.` : 'The proposed basics meet every modeled color-source target.';

  const curve = byId('deck-curve');
  curve.replaceChildren();
  const curveMax = Math.max(1, ...Object.values(build.curve));
  for (const bucket of ['1', '2', '3', '4', '5+']) {
    const column = element('div', 'deck-curve-column');
    const bar = element('span');
    bar.style.height = `${Math.max(3, (build.curve[bucket] / curveMax) * 52)}px`;
    column.append(bar, element('b', '', build.curve[bucket]), element('small', '', bucket));
    curve.append(column);
  }

  const cuts = byId('deck-cuts');
  cuts.replaceChildren();
  if (!build.cuts.length) cuts.append(element('span', 'pool-empty', 'No additional on-color cards.'));
  for (const card of build.cuts.slice(0, 10)) {
    const row = element('div', 'cut-row');
    const cutMana = element('small', '');
    const cutPips = manaPipsElement(card.manaCost);
    if (cutPips) cutMana.append(cutPips);
    else cutMana.textContent = '—';
    row.append(element('span', '', `${card.quantity}× ${card.name}`), cutMana);
    cuts.append(row);
  }
}

function renderReviewImpactList(id, cards, emptyText, formatter = null) {
  const list = byId(id);
  list.replaceChildren();
  if (!cards?.length) {
    list.append(element('span', 'review-list-empty', emptyText));
    return;
  }
  for (const card of cards) {
    const display = formatter ? formatter(card) : { label: card.label || '', detail: card.detail || '' };
    const row = element('article', `review-impact-row${display.className ? ` ${display.className}` : ''}`);
    const heading = element('div');
    heading.append(element('strong', '', card.name), element('span', '', display.label));
    row.append(heading, element('p', '', display.detail));
    list.append(row);
  }
}

function varianceLabel(entry) {
  if (!entry || entry.level === 'LOW') return 'STABLE';
  return `${entry.level} · ${String(entry.kind || '').toUpperCase()}`;
}

function renderReview() {
  const reviewState = model.review || { status: 'off', reviews: [] };
  const review = reviewState.latest;
  const recording = review?.status === 'recording';
  const ignored = Boolean(reviewState.lastIgnored) && !recording;
  const content = byId('review-content');
  byId('review-empty').hidden = Boolean(review);
  content.hidden = !review;

  const pill = byId('review-status-pill');
  pill.className = `review-status-pill ${recording ? 'recording' : (ignored ? 'waiting' : (review ? 'complete' : 'waiting'))}`;
  pill.textContent = recording ? 'RECORDING' : (ignored ? 'IGNORED' : (review ? 'COMPLETE' : 'WAITING'));

  if (!review) {
    setText('review-title', reviewState.message || 'Ready for your next Arena game');
    setText('review-subtitle', reviewState.lastIgnored
      ? `${reviewState.lastIgnored.reason} Pick 42 is still waiting for the registered draft deck.`
      : reviewState.armed
        ? 'Keep Pick 42 running while you play. Recording begins when Arena starts the next game.'
      : 'Choose your Arena log to arm post-game review.');
    return;
  }

  const result = recording ? 'IN PROGRESS' : (review.won === true ? 'WIN' : (review.won === false ? 'LOSS' : 'COMPLETE'));
  setText('review-title', recording ? `Recording game ${review.gameNumber}` : `${result} · ${review.deck?.name || 'Limited deck'}`);
  setText('review-subtitle', recording
    ? 'Evidence is updating live. The final report will use only facts Arena exposes.'
    : (ignored
      ? `${reviewState.lastIgnored.reason} Showing the most recent matching draft game instead.`
      : `${review.cardsSeenCount} cards were observed across ${review.yourTurnsObserved} of your turns. Hidden opponent cards are excluded.`));
  setText('review-result', result);
  setText('review-turns', review.turns || '—');
  setText('review-seat', review.onPlay === null ? '—' : (review.onPlay ? 'PLAY' : 'DRAW'));
  setText('review-mulligans', review.mulligans === null || review.mulligans === undefined ? '—' : review.mulligans);

  const analysis = review.postGame || {};
  const gameShape = analysis.gameShape || {};
  const shapeStat = byId('review-shape-stat');
  setText('review-shape', recording ? 'LIVE' : (gameShape.label || 'UNRATED'));
  shapeStat.className = `review-shape-stat ${recording ? 'live' : (gameShape.tier || 'unrated')}`;
  shapeStat.title = gameShape.detail || '';
  const turningPoint = analysis.turningPoint || {};
  const turningPointCard = byId('review-turning-point-card');
  turningPointCard.hidden = !turningPoint.detected;
  if (turningPoint.detected) {
    setText('review-turning-point-label', turningPoint.label || 'TACTICAL EXPOSURE');
    setText('review-turning-point-title', turningPoint.title || 'A tactical exposure changed the game');
    setText('review-turning-point-confidence', turningPoint.confidence || 'HIGH · ACTION AND LETHAL LINE CONFIRMED');
    setText('review-turning-point-summary', turningPoint.summary || 'The recorded combat action directly opened the immediately following lethal line.');
    setText('review-turning-point-action', turningPoint.action || 'Treat this as tactical evidence, not proof that the deck failed.');
  }
  const variance = analysis.variance || {};
  const varianceLevel = String(variance.level || 'LOW').toLowerCase();
  setText('review-variance-title', variance.headline || 'Collecting mana evidence');
  setText('review-variance-summary', variance.summary || 'Waiting for both players to complete turns.');
  const variancePill = byId('review-variance-level');
  variancePill.className = `review-variance-level ${varianceLevel}`;
  variancePill.textContent = String(variance.level || 'LOW').toUpperCase();
  setText('review-you-variance', varianceLabel(variance.you));
  setText('review-you-variance-detail', variance.you?.detail || 'No reliable mana record yet.');
  setText('review-opponent-variance', varianceLabel(variance.opponent));
  setText('review-opponent-variance-detail', variance.opponent?.detail || 'No reliable opponent mana record yet.');

  const drawQuality = analysis.drawQuality || {};
  setText('review-iih-summary', drawQuality.summary || 'Waiting for matching 17Lands IIH data.');
  setText('review-iih-note', drawQuality.note || 'IIH is historical correlation, not causal credit.');
  renderReviewImpactList('review-iih-cards', drawQuality.cards, 'No reliable IIH comparison was available.', (card) => ({
    label: `${card.iih > 0 ? '+' : ''}${Number(card.iih).toFixed(1)}pp IIH`,
    detail: `${card.category} · ${card.quantity ? `${card.quantity} cop${card.quantity === 1 ? 'y' : 'ies'} observed · ` : ''}${Number(card.gamesInHand || 0).toLocaleString()} games in hand`,
    className: String(card.category || '').includes('NOT DRAWN')
      ? 'not-drawn'
      : (String(card.category || '').includes('LIABILITY') ? 'liability' : 'drawn')
  }));

  const contributions = analysis.contributions || {};
  renderReviewImpactList('review-mvp-list', contributions.mvp, contributions.mvpEmpty || 'No evidence-backed MVP yet.');
  renderReviewImpactList('review-lvp-list', contributions.lvp, contributions.lvpEmpty || 'No evidence-backed LVP.');
  const verdict = analysis.verdict || {};
  const series = analysis.series || {};
  const verdictCard = byId('review-verdict-card');
  verdictCard.className = `review-card review-verdict-card ${verdict.tone || 'neutral'}`;
  setText('review-verdict-eyebrow', verdict.scope === 'series' ? 'SERIES VERDICT' : 'GAME VERDICT');
  setText('review-verdict-label', verdict.label || 'PENDING');
  setText('review-verdict-title', verdict.title || 'Verdict pending');
  setText('review-verdict-evidence', verdict.scope === 'series'
    ? `${series.games} GAMES · ${series.record} · SAME DECK VERSION`
    : (recording && series.games ? `GAME IN PROGRESS · ${series.games} PRIOR MATCHING GAME${series.games === 1 ? '' : 'S'}` : '1 GAME · CURRENT DECK VERSION'));
  setText('review-verdict-summary', verdict.summary || 'Waiting for enough evidence.');
  setText('review-verdict-action', verdict.action || 'Keep playing.');
  byId('review-disclaimer').replaceChildren(
    iconElement('shield-check'),
    element('span', '', 'Pick 42 reports observable evidence and does not assign causal credit from one game.')
  );
}

function render() {
  if (!model) return;
  if (model.selectedBuildId && (model.deckBuilds || []).some((build) => build.id === model.selectedBuildId)) selectedBuildId = model.selectedBuildId;
  if (!viewInitialized) {
    activeView = model.draft.pool.length >= 40 && (model.deckBuilds || []).length ? 'decks' : 'draft';
    viewInitialized = true;
  }
  if (selectedName && !model.recommendations.some((card) => card.name === selectedName)) selectedName = null;
  renderStatus();
  renderDecision();
  renderLane();
  renderRankingLens();
  renderHero();
  renderRanking();
  renderPool();
  renderCorpusManager();
  renderDeckBuilder();
  renderReview();
  renderBuildOverlay();
  renderView();
  hydrateIcons();
}

async function updateFrom(action) {
  try {
    const next = await action();
    if (next) { model = next; render(); }
  } catch (error) {
    setText('status-message', error.message);
    byId('status-dot').className = 'status-dot error';
  }
}

byId('import-17lands').addEventListener('click', () => updateFrom(() => window.draftCompanion.importSource('seventeenLands')));
byId('ranking-contextual').addEventListener('click', () => {
  rankingMode = 'contextual';
  renderRankingLens();
  renderHero();
  renderRanking();
});
byId('ranking-raw').addEventListener('click', () => {
  rankingMode = 'raw';
  renderRankingLens();
  renderHero();
  renderRanking();
});
byId('lane-summary').addEventListener('click', () => {
  laneMenuOpen = !laneMenuOpen;
  renderLane();
});
for (const option of document.querySelectorAll('[data-lane-mode]')) {
  option.addEventListener('click', () => {
    laneMenuOpen = false;
    updateFrom(() => window.draftCompanion.setLanePreference(option.dataset.laneMode));
  });
}
byId('lane-resume-auto').addEventListener('click', () => {
  laneMenuOpen = false;
  updateFrom(() => window.draftCompanion.setLanePreference('auto'));
});
byId('import-untapped').addEventListener('click', () => updateFrom(() => window.draftCompanion.importSource('untapped')));
byId('import-archetypes').addEventListener('click', openCorpusManager);
byId('corpus-close').addEventListener('click', () => byId('corpus-dialog').close());
byId('corpus-paste').addEventListener('click', async () => {
  const button = byId('corpus-paste');
  button.disabled = true;
  try {
    const result = await window.draftCompanion.readClipboard();
    byId('corpus-deck-text').value = result?.text || '';
    setCorpusEntryMessage(result?.text ? 'Deck list pasted from the clipboard.' : 'The clipboard is empty.', result?.text ? 'success' : 'error');
  } finally {
    button.disabled = false;
  }
});
byId('corpus-save').addEventListener('click', savePastedTrophyDeck);
byId('corpus-deck-text').addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') savePastedTrophyDeck();
});
byId('corpus-import-file').addEventListener('click', () => updateFrom(() => window.draftCompanion.importArchetypeCorpus()));
byId('choose-log').addEventListener('click', () => updateFrom(() => window.draftCompanion.chooseLog()));
byId('restart-demo').addEventListener('click', () => updateFrom(() => window.draftCompanion.startDemo()));
byId('empty-demo').addEventListener('click', () => updateFrom(() => window.draftCompanion.startDemo()));
byId('next-demo').addEventListener('click', () => updateFrom(() => window.draftCompanion.advanceDemo()));
byId('show-draft').addEventListener('click', () => { activeView = 'draft'; renderView(); });
byId('show-decks').addEventListener('click', () => { activeView = 'decks'; renderView(); });
byId('show-play').addEventListener('click', () => { activeView = 'play'; renderView(); });
byId('build-expand').addEventListener('click', () => updateFrom(() => window.draftCompanion.exitBuildMode()));
byId('build-empty-expand').addEventListener('click', () => updateFrom(() => window.draftCompanion.exitBuildMode()));
byId('build-minimize').addEventListener('click', () => window.draftCompanion.minimize());
byId('deck-side-panel-button').addEventListener('click', () => {
  updateFrom(() => window.draftCompanion.enterBuildMode());
});
byId('build-reset').addEventListener('click', () => {
  const build = chosenBuild();
  if (!build) return;
  localStorage.removeItem(checklistStorageKey(build));
  renderBuildOverlay();
});
byId('recipe-copy').addEventListener('click', () => {
  const build = chosenBuild();
  if (build) copyRecipeSearch(currentRecipe(build).current);
});
byId('recipe-next').addEventListener('click', () => advanceRecipe('done'));
byId('recipe-skip').addEventListener('click', () => advanceRecipe('skipped'));
byId('recipe-undo').addEventListener('click', () => undoRecipe());
byId('preview-copy-name').addEventListener('click', async () => {
  if (!previewedCardName) return;
  await window.draftCompanion.copySearch(previewedCardName);
  const label = byId('preview-copy-name-label');
  label.textContent = 'COPIED';
  clearTimeout(previewCopyTimer);
  previewCopyTimer = setTimeout(() => { label.textContent = 'COPY NAME'; }, 900);
});
byId('minimize-button').addEventListener('click', () => window.draftCompanion.minimize());
byId('close-button').addEventListener('click', () => window.draftCompanion.close());

window.draftCompanion.onRecipeCommand((command) => {
  if (!model || activeView !== 'build') return;
  const build = chosenBuild();
  if (!build) return;
  if (command === 'copy') copyRecipeSearch(currentRecipe(build).current);
  if (command === 'next') advanceRecipe('done');
  if (command === 'undo') undoRecipe();
});

window.draftCompanion.bootstrap().then((initial) => {
  model = initial;
  render();
  deckBoardResizeObserver = new ResizeObserver(resizeDeckBoardCards);
  deckBoardResizeObserver.observe(byId('deck-columns'));
  window.draftCompanion.onState((next) => { model = next; render(); });
});
