'use strict';

let model = null;
let selectedName = null;
let selectedBuildId = 'golgari';
let activeView = 'draft';
let lastFullView = 'decks';
let viewInitialized = false;
let philosophyTimer = null;
let recipeCopyTimer = null;
let previewCopyTimer = null;
let previewedCardName = null;

const DECK_STACK_STEP = 28;
const MANA_ACCENTS = Object.freeze({ W: '#d8cda9', U: '#4d9fc9', B: '#28252d', R: '#c85b48', G: '#4c925d' });

const byId = (id) => document.getElementById(id);
const { buildRecipeTasks: recipeTasks, recipeProgress } = window.ArcaneRecipe;
const { manaPresentation, sortArenaCards } = window.ArcaneArenaSort;

function setText(id, value) {
  byId(id).textContent = value;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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

function renderStatus() {
  byId('status-dot').className = `status-dot ${model.status?.kind || ''}`;
  setText('status-message', model.status?.message || 'Ready');
  const gate = model.recommendationGate;
  setText('coverage-label', `${gate.coveredByBoth} / ${gate.total} draftable cards covered by both sources`);

  const source17 = model.sources.seventeenLands;
  const sourceUt = model.sources.untapped;
  const sourceLabel = (source) => source.kind === 'sample' && model.status?.kind !== 'demo' ? 'SAMPLE · OFF' : `${source.count} · ${source.kind}`;
  setText('source-17-label', sourceLabel(source17));
  setText('source-ut-label', sourceLabel(sourceUt));
  byId('import-17lands').title = source17.label;
  byId('import-untapped').title = sourceUt.label;
  byId('restart-demo').hidden = model.status?.kind !== 'demo';
}

function renderDecision() {
  setText('set-name', model.draft.setCode || 'DRAFT');
  setText('pack-number', model.draft.packNumber || '—');
  setText('pick-number', model.draft.pickNumber || '—');
  setText('format-pill', String(model.draft.format || 'DRAFT').toUpperCase());
}

function chosenCard() {
  return model.recommendations.find((card) => card.name === selectedName && card.eligible)
    || model.recommendations.find((card) => card.eligible)
    || null;
}

function renderHero() {
  if (!model.recommendationGate.ready) return;
  const card = chosenCard();
  if (!card) {
    setText('hero-score', '—');
    setText('hero-name', 'Waiting for a draft pack');
    setText('hero-type', 'Arena draft events will appear here.');
    configureImpactFlag(byId('hero-impact-flag'), null);
    return;
  }
  const rank = model.recommendations.findIndex((entry) => entry.name === card.name) + 1;
  const isTop = rank === 1;
  setText('hero-rank-label', isTop ? 'PICK' : `#${rank}`);
  setText('hero-kicker', isTop ? 'TOP RECOMMENDATION' : 'INSPECTING RANKED CARD');
  setText('hero-score', card.score.toFixed(1));
  setText('hero-name', card.name);
  setText('hero-mana', compactMana(card.manaCost));
  setText('hero-type', card.typeLine || `Arena ID ${card.grpId}`);
  setText('hero-17', percent(card.metrics.seventeenLands?.gihWinRate));
  setText('hero-ut', percent(card.metrics.untapped?.inHandWinRate));
  setText('hero-delta', signed(card.philosophyDelta));
  byId('hero-delta').style.color = card.philosophyDelta >= 0 ? 'var(--green)' : 'var(--red)';
  configureImpactFlag(byId('hero-impact-flag'), card);

  const reasons = byId('hero-reasons');
  reasons.replaceChildren();
  for (const reason of card.reasons.slice(0, 4)) reasons.append(element('span', 'reason-chip', reason));
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
  setText('list-context', ready ? 'DATA + YOUR RULES' : 'UNRANKED · MISSING DATA');
  byId('empty-pack').hidden = hasCards;
  document.querySelector('.list-heading').hidden = !hasCards;

  model.recommendations.forEach((card, index) => {
    const impactKind = card.metrics.impactFlag?.kind || '';
    const row = element('article', `rank-row ${card.eligible ? '' : 'unranked'} ${chosenCard()?.name === card.name ? 'selected' : ''} ${impactKind ? `impact-${impactKind}` : ''}`);
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
    copy.append(title, element('span', 'rank-card-detail', `${compactMana(card.manaCost)} · ${card.reasons[0] || card.typeLine || 'No source row'}`));
    row.append(copy);
    const sources = element('div', 'rank-sources');
    sources.append(
      sourceStat('17L', card.metrics.seventeenLands?.gihWinRate, 'lands'),
      sourceStat('UT', card.metrics.untapped?.inHandWinRate, 'ut')
    );
    row.append(sources);
    const score = element('strong', `rank-score ${card.eligible ? '' : 'unranked-score'}`, card.eligible ? card.score.toFixed(1) : '—');
    score.append(element('small', '', card.isBasicLand ? 'BASIC' : (card.eligible ? `${signed(card.philosophyDelta)} φ` : 'NO DATA')));
    row.append(score);
    const select = () => { selectedName = card.name; renderHero(); renderRanking(); };
    row.addEventListener('click', select);
    row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') select(); });
    list.append(row);
  });
}

function renderPhilosophy() {
  for (const input of document.querySelectorAll('[data-setting]')) {
    const value = model.philosophy[input.dataset.setting];
    if (document.activeElement !== input) input.value = value;
    const output = byId(`${input.dataset.setting}-output`);
    output.textContent = input.dataset.setting === 'sourceBalance' ? `17L ${value} · UT ${100 - value}` : value;
  }
}

function renderPool() {
  const summary = model.poolSummary;
  setText('pool-total', summary.total);
  setText('creature-total', summary.creatures);

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
  for (const card of model.draft.pool.slice(-5).reverse()) pool.append(element('span', 'pool-chip', card.name));
  byId('next-demo').hidden = model.status?.kind !== 'demo';
}

function chosenBuild() {
  const builds = model.deckBuilds || [];
  return builds.find((build) => build.id === selectedBuildId) || builds[0] || null;
}

function renderView() {
  const compact = Boolean(model.arena?.compactBuildMode);
  if (compact && activeView !== 'build') {
    lastFullView = activeView;
    activeView = 'build';
  } else if (!compact && activeView === 'build') {
    activeView = lastFullView || 'decks';
  }
  document.body.classList.toggle('build-mode', compact);
  byId('draft-view').hidden = activeView !== 'draft';
  byId('deck-view').hidden = activeView !== 'decks';
  byId('build-view').hidden = activeView !== 'build';
  byId('show-draft').classList.toggle('active', activeView === 'draft');
  byId('show-decks').classList.toggle('active', activeView === 'decks');
  byId('show-build').classList.toggle('active', activeView === 'build');
  setText('deck-ready-count', (model.deckBuilds || []).length);
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
  row.append(element('span', 'recipe-queue-index', status === 'done' ? '✓' : status === 'skipped' ? '—' : String(index + 1).padStart(2, '0')));
  const copy = element('span', 'recipe-queue-copy');
  copy.append(element('b', '', task.card.name), element('small', '', `${task.phase} · ${task.kind === 'cut' ? '0' : task.target} TARGET`));
  row.append(copy, element('strong', 'recipe-queue-target', task.kind === 'cut' ? 'REMOVE' : `${task.target}×`));
  return row;
}

async function copyRecipeSearch(task) {
  if (!task) return;
  await window.draftCompanion.copySearch(task.card.name);
  const button = byId('recipe-copy');
  button.textContent = 'COPIED';
  clearTimeout(recipeCopyTimer);
  recipeCopyTimer = setTimeout(() => { button.textContent = 'COPY SEARCH'; }, 900);
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
    setText('recipe-next', remaining === 1 ? 'DONE' : 'DONE + NEXT');
  } else {
    const skipped = recipe.tasks.filter((task) => recipe.state.skipped.has(task.id)).length;
    byId('recipe-complete').querySelector('p').textContent = skipped
      ? `${skipped} step${skipped === 1 ? ' was' : 's were'} skipped. Review those quantities, then confirm Arena shows 40 cards.`
      : 'Every target quantity has been confirmed. Check Arena shows 40 cards before continuing.';
  }

  const list = byId('recipe-queue-list');
  list.replaceChildren();
  recipe.tasks.forEach((task, index) => list.append(recipeQueueRow(task, recipe.state, index, recipe.current)));
}

function cardColorSymbols(card, land = false) {
  const symbols = land ? [...(card.colors || [])] : (String(card.manaCost || '').match(/[WUBRG]/g) || []);
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
  if (land || /\bLand\b/i.test(type)) return '◆';
  if (/\bCreature\b/i.test(type)) return '✦';
  if (/\bInstant\b/i.test(type)) return '↯';
  if (/\bSorcery\b/i.test(type)) return '◈';
  if (/\bArtifact\b/i.test(type)) return '⬡';
  if (/\bEnchantment\b/i.test(type)) return '✧';
  return '◇';
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
  setText('preview-card-glyph', cardGlyph(displayCard, land));
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
  art.append(element('span', '', cardGlyph(displayCard, land)), element('small', '', land ? 'LAND' : String(displayCard.typeLine || 'CARD').split('—')[0].trim().toUpperCase()));
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
    stack.style.height = `${Math.max(176, 158 + Math.max(0, sortedCards.length - 1) * DECK_STACK_STEP)}px`;
    sortedCards.forEach((card, index) => stack.append(deckBoardCard(card, bucket.land, index)));
    if (!bucket.cards.length) stack.append(element('span', 'deck-lane-empty', '—'));
    lane.append(heading, stack);
    board.append(lane);
  }

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
    row.append(element('span', '', `${card.quantity}× ${card.name}`), element('small', '', compactMana(card.manaCost)));
    cuts.append(row);
  }
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
  renderHero();
  renderRanking();
  renderPhilosophy();
  renderPool();
  renderDeckBuilder();
  renderBuildOverlay();
  renderView();
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

for (const input of document.querySelectorAll('[data-setting]')) {
  input.addEventListener('input', () => {
    const output = byId(`${input.dataset.setting}-output`);
    output.textContent = input.dataset.setting === 'sourceBalance' ? `17L ${input.value} · UT ${100 - Number(input.value)}` : input.value;
    clearTimeout(philosophyTimer);
    philosophyTimer = setTimeout(() => updateFrom(() => window.draftCompanion.updatePhilosophy({ [input.dataset.setting]: Number(input.value) })), 70);
  });
}

byId('import-17lands').addEventListener('click', () => updateFrom(() => window.draftCompanion.importSource('seventeenLands')));
byId('import-untapped').addEventListener('click', () => updateFrom(() => window.draftCompanion.importSource('untapped')));
byId('choose-log').addEventListener('click', () => updateFrom(() => window.draftCompanion.chooseLog()));
byId('restart-demo').addEventListener('click', () => updateFrom(() => window.draftCompanion.startDemo()));
byId('empty-demo').addEventListener('click', () => updateFrom(() => window.draftCompanion.startDemo()));
byId('next-demo').addEventListener('click', () => updateFrom(() => window.draftCompanion.advanceDemo()));
byId('show-draft').addEventListener('click', () => { activeView = 'draft'; renderView(); });
byId('show-decks').addEventListener('click', () => { activeView = 'decks'; renderView(); });
byId('show-build').addEventListener('click', () => {
  lastFullView = activeView === 'build' ? 'decks' : activeView;
  updateFrom(() => window.draftCompanion.enterBuildMode());
});
byId('build-expand').addEventListener('click', () => updateFrom(() => window.draftCompanion.exitBuildMode()));
byId('build-empty-expand').addEventListener('click', () => updateFrom(() => window.draftCompanion.exitBuildMode()));
byId('build-minimize').addEventListener('click', () => window.draftCompanion.minimize());
byId('deck-recipe-button').addEventListener('click', () => {
  lastFullView = activeView === 'build' ? 'decks' : activeView;
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
  const button = byId('preview-copy-name');
  button.textContent = 'COPIED';
  clearTimeout(previewCopyTimer);
  previewCopyTimer = setTimeout(() => { button.textContent = 'COPY NAME'; }, 900);
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
  window.draftCompanion.onState((next) => { model = next; render(); });
});
