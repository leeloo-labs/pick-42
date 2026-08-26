'use strict';

// Decks view: the deck-board builder, card tiles, and sidebar preview.

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
  const artCrop = displayCard.scryfall?.imageUris?.artCrop;
  const artUrl = artCrop || displayCard.scryfall?.imageUris?.normal;
  if (artUrl) {
    art.classList.add('has-scryfall-art');
    if (!artCrop) art.classList.add('full-card-art');
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
    column.append(element('b', '', build.curve[bucket]), bar, element('small', '', bucket));
    curve.append(column);
  }

  const cuts = byId('deck-cuts');
  cuts.replaceChildren();
  if (!build.cuts.length) cuts.append(element('span', 'pool-empty', 'No additional on-color cards.'));
  for (const card of build.cuts.slice(0, 10)) {
    const displayCut = enrichedCard(card);
    const row = element('div', 'cut-row');
    const cutMana = element('small', '');
    const cutPips = manaPipsElement(displayCut.manaCost);
    if (cutPips) cutMana.append(cutPips);
    else cutMana.textContent = '—';
    row.append(element('span', '', `${card.quantity}× ${card.name}`), cutMana);
    cuts.append(row);
  }
}
