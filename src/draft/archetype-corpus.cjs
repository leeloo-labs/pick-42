'use strict';

const { normalizeCardName, numberValue, parseCsv, readColumn } = require('./csv.cjs');

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];
const ARCHETYPE_COLORS = Object.freeze({
  azorius: ['W', 'U'], dimir: ['U', 'B'], rakdos: ['B', 'R'], gruul: ['R', 'G'], selesnya: ['W', 'G'],
  orzhov: ['W', 'B'], izzet: ['U', 'R'], golgari: ['B', 'G'], boros: ['W', 'R'], simic: ['U', 'G']
});
const COLOR_NAMES = Object.freeze({
  W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green',
  WU: 'Azorius', UB: 'Dimir', BR: 'Rakdos', RG: 'Gruul', WG: 'Selesnya',
  WB: 'Orzhov', UR: 'Izzet', BG: 'Golgari', WR: 'Boros', UG: 'Simic'
});
const MIN_ARCHETYPE_DECKS = 4;

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function rounded(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function normalizeFormat(value) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normalized || normalized === 'any' || normalized === 'all') return 'any';
  if (normalized.includes('picktwo')) return 'pick-two';
  if (normalized.includes('quick')) return 'quick';
  if (normalized.includes('traditional') || normalized.includes('traddraft') || normalized.includes('bestofthree') || normalized === 'bo3') return 'traditional';
  if (normalized.includes('premier') || normalized.includes('playerdraft') || normalized === 'bo1') return 'premier';
  return normalized;
}

function formatLabel(value) {
  return { any: 'Any Draft', quick: 'Quick Draft', premier: 'Premier Draft', traditional: 'Traditional Draft', 'pick-two': 'Pick-Two Draft' }[value] || value;
}

function trophyThreshold(format) {
  return { quick: 7, premier: 7, traditional: 3, 'pick-two': 4 }[normalizeFormat(format)] ?? null;
}

function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'trophy', 'trophied'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  return null;
}

function recordValues(record, wins, losses) {
  const match = String(record || '').match(/(\d+)\s*[-–]\s*(\d+)/);
  return {
    wins: numberValue(wins) ?? (match ? Number(match[1]) : null),
    losses: numberValue(losses) ?? (match ? Number(match[2]) : null)
  };
}

function parseColors(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  const named = Object.entries(ARCHETYPE_COLORS).find(([name]) => text.toLowerCase().includes(name));
  if (named) return named[1];
  const words = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
  const found = [];
  for (const [word, color] of Object.entries(words)) if (new RegExp(`\\b${word}\\b`, 'i').test(text)) found.push(color);
  if (!found.length) found.push(...(text.toUpperCase().match(/[WUBRG]/g) || []));
  return COLOR_ORDER.filter((color) => new Set(found).has(color));
}

function colorKey(colors) {
  return COLOR_ORDER.filter((color) => colors.includes(color)).join('');
}

function archetypeName(colors) {
  const key = colorKey(colors);
  if (COLOR_NAMES[key]) return COLOR_NAMES[key];
  if (!key) return 'Unknown archetype';
  return key.split('').map((color) => COLOR_NAMES[color]).join('/');
}

function catalogByName(catalog) {
  const index = new Map();
  for (const card of Object.values(catalog || {})) {
    if (card?.name) index.set(normalizeCardName(card.name), card);
  }
  return index;
}

function emptyColorCounts() {
  return Object.fromEntries(COLOR_ORDER.map((color) => [color, 0]));
}

function manaRequirements(manaCost) {
  const fixedPips = emptyColorCounts();
  const hybridGroups = [];
  const symbols = String(manaCost || '').matchAll(/\{([^}]+)\}|\(([^)]+)\)/g);
  for (const symbol of symbols) {
    const value = String(symbol[1] || symbol[2] || '').toUpperCase();
    const colors = COLOR_ORDER.filter((color) => new RegExp(`(?:^|/)${color}(?:/|$)`).test(value));
    if (colors.length > 1) {
      hybridGroups.push(colors);
    } else if (colors.length === 1 && !/^\d+\//.test(value)) {
      fixedPips[colors[0]] += 1;
    }
  }
  return { fixedPips, hybridGroups };
}

function basicLandColor(name) {
  return { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' }[normalizeCardName(name)] || null;
}

function producedLandColors(card) {
  if (!/\bLand\b/i.test(String(card?.typeLine || ''))) return [];
  const colors = [];
  for (const line of String(card?.rulesText || '').split(/\n|\./)) {
    if (!/\bAdd\b/i.test(line)) continue;
    colors.push(...(line.toUpperCase().match(/\{([WUBRG])\}/g) || []).map((symbol) => symbol[1]));
  }
  return [...new Set(colors)];
}

function inferColorProfile(cards, index) {
  const fixedPips = emptyColorCounts();
  const fixedCards = emptyColorCounts();
  const sources = emptyColorCounts();
  const hybridOptions = emptyColorCounts();

  for (const card of cards) {
    const quantity = Math.max(1, Number(card.quantity) || 1);
    const basicColor = basicLandColor(card.name);
    if (basicColor) {
      sources[basicColor] += quantity;
      continue;
    }

    const catalogCard = index.get(card.key);
    if (!catalogCard) continue;
    if (/\bLand\b/i.test(String(catalogCard.typeLine || ''))) {
      for (const color of producedLandColors(catalogCard)) sources[color] += quantity;
      continue;
    }

    const requirements = manaRequirements(catalogCard.manaCost);
    for (const color of COLOR_ORDER) {
      if (requirements.fixedPips[color]) {
        fixedPips[color] += requirements.fixedPips[color] * quantity;
        fixedCards[color] += quantity;
      }
    }
    for (const group of requirements.hybridGroups) {
      for (const color of group) hybridOptions[color] += quantity;
    }
  }

  const score = Object.fromEntries(COLOR_ORDER.map((color) => [
    color,
    fixedPips[color] * 2 + fixedCards[color] + sources[color] * 1.5
  ]));
  const committed = COLOR_ORDER
    .filter((color) => fixedPips[color] > 0 || sources[color] > 0)
    .sort((left, right) => score[right] - score[left] || COLOR_ORDER.indexOf(left) - COLOR_ORDER.indexOf(right));
  const primaryColors = [];
  const splashColors = [];

  if (committed[0]) primaryColors.push(committed[0]);
  if (committed[1]) {
    const second = committed[1];
    const isCoreColor = fixedCards[second] >= 2 || sources[second] >= 3;
    (isCoreColor ? primaryColors : splashColors).push(second);
  }
  for (const color of committed.slice(2)) {
    const secondScore = score[primaryColors[1] || primaryColors[0]] || 1;
    const isTrueThirdColor = fixedPips[color] >= 3
      && fixedCards[color] >= 3
      && sources[color] >= 4
      && score[color] >= secondScore * 0.5;
    (isTrueThirdColor ? primaryColors : splashColors).push(color);
  }

  const orderedPrimary = COLOR_ORDER.filter((color) => primaryColors.includes(color));
  const orderedSplash = COLOR_ORDER.filter((color) => splashColors.includes(color));
  return {
    primaryColors: orderedPrimary,
    splashColors: orderedSplash,
    colorIdentity: COLOR_ORDER.filter((color) => orderedPrimary.includes(color) || orderedSplash.includes(color)),
    evidence: { fixedPips, fixedCards, sources, hybridOptions }
  };
}

function isGenericArchetypeLabel(label, colors) {
  return String(label || '').trim().toLowerCase() === archetypeName(parseColors(colors)).toLowerCase();
}

function normalizeCards(value) {
  const entries = [];
  if (Array.isArray(value)) {
    for (const card of value) {
      const name = typeof card === 'string' ? card : card?.name ?? card?.cardName ?? card?.card;
      const quantity = typeof card === 'string' ? 1 : numberValue(card?.quantity ?? card?.count ?? card?.copies) ?? 1;
      if (name) entries.push({ name: String(name).trim(), key: normalizeCardName(name), quantity: Math.max(1, Math.round(quantity)) });
    }
  } else if (value && typeof value === 'object') {
    for (const [name, quantity] of Object.entries(value)) {
      entries.push({ name, key: normalizeCardName(name), quantity: Math.max(1, Math.round(numberValue(quantity) ?? 1)) });
    }
  }
  const merged = new Map();
  for (const card of entries) {
    const previous = merged.get(card.key);
    if (previous) previous.quantity += card.quantity;
    else merged.set(card.key, { ...card });
  }
  return [...merged.values()];
}

function parseArenaDeckText(text) {
  const source = String(text || '').replace(/\u00a0/g, ' ').trim();
  if (!source) throw new Error('Paste a deck list copied from 17Lands.');
  const cards = [];
  let inMainDeck = true;
  let sawDeckHeading = false;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^Deck$/i.test(line)) {
      inMainDeck = true;
      sawDeckHeading = true;
      continue;
    }
    if (/^(?:Sideboard|Commander|Companion|Maybeboard)$/i.test(line)) {
      if (sawDeckHeading || cards.length) inMainDeck = false;
      continue;
    }
    if (!inMainDeck) continue;

    let quantity;
    let name;
    const prefixed = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    const suffixed = line.match(/^(.+?)\s+x(\d+)$/i);
    if (prefixed) {
      quantity = Number(prefixed[1]);
      name = prefixed[2];
    } else if (suffixed) {
      name = suffixed[1];
      quantity = Number(suffixed[2]);
    } else {
      continue;
    }
    name = String(name)
      .replace(/\s+\([A-Z0-9]{2,10}\)\s+[A-Za-z0-9-]+\s*$/i, '')
      .trim();
    if (name && Number.isFinite(quantity) && quantity > 0) cards.push({ name, quantity });
  }

  const normalized = normalizeCards(cards);
  const total = normalized.reduce((sum, card) => sum + card.quantity, 0);
  if (!normalized.length) throw new Error('No Arena-format main-deck lines were found. Use 17Lands’ Copy Deck button and paste the result unchanged.');
  if (total < 40) throw new Error(`Only ${total} main-deck cards were found; a limited deck should contain at least 40. Check that the whole copied list was pasted.`);
  return { cards: normalized, total };
}

function normalizedDeck(value, index, fallbackId, { reclassifyColors = false, reclassifyArchetype = false } = {}) {
  const format = normalizeFormat(value.format ?? value.eventType ?? value.event_type);
  const record = recordValues(value.record, value.wins, value.losses);
  const explicitTrophy = booleanValue(value.trophy ?? value.isTrophy ?? value.is_trophy);
  const threshold = trophyThreshold(format);
  const cards = normalizeCards(value.cards ?? value.mainDeck ?? value.main_deck ?? value.deck);
  const explicitColors = parseColors(value.colors ?? value.colorIdentity ?? value.color_identity);
  const explicitSplashColors = parseColors(value.splashColors ?? value.splash_colors);
  const label = String(value.archetype ?? value.cluster ?? '').trim();
  const labelColors = parseColors(label);
  const inferredProfile = inferColorProfile(cards, index);
  const usesInferredColors = reclassifyColors || (!explicitColors.length && !labelColors.length);
  const colors = reclassifyColors
    ? inferredProfile.primaryColors
    : (explicitColors.length ? explicitColors : (labelColors.length ? labelColors : inferredProfile.primaryColors));
  const splashColors = usesInferredColors
    ? inferredProfile.splashColors
    : explicitSplashColors.filter((color) => !colors.includes(color));
  const colorIdentity = COLOR_ORDER.filter((color) => colors.includes(color) || splashColors.includes(color));
  const inferredTrophy = threshold !== null && record.wins !== null ? record.wins >= threshold : false;
  return {
    id: String(value.id ?? value.deckId ?? value.deck_id ?? fallbackId),
    setCode: String(value.setCode ?? value.set_code ?? value.expansion ?? '').trim().toUpperCase(),
    format,
    formatLabel: formatLabel(format),
    eventDate: String(value.eventDate ?? value.event_date ?? value.date ?? '').trim() || null,
    wins: record.wins,
    losses: record.losses,
    rank: String(value.rank ?? value.rankBucket ?? value.rank_bucket ?? '').trim() || null,
    sourceUrl: String(value.sourceUrl ?? value.source_url ?? value.url ?? '').trim() || null,
    trophy: explicitTrophy ?? inferredTrophy,
    archetype: reclassifyArchetype || !label ? archetypeName(colors) : label,
    archetypeSource: String(value.archetypeSource || '').trim() || (label ? 'custom' : 'auto'),
    colors,
    splashColors,
    colorIdentity,
    colorEvidence: inferredProfile.evidence,
    cards
  };
}

function createArchetypeDeck(value, {
  catalog = {},
  fallbackId = 'manual-deck',
  reclassifyColors = false,
  reclassifyArchetype = false
} = {}) {
  return normalizedDeck(value, catalogByName(catalog), fallbackId, { reclassifyColors, reclassifyArchetype });
}

function decksFromCsv(text, index) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('The archetype corpus CSV is empty.');
  const grouped = new Map();
  for (const row of rows) {
    const deckId = readColumn(row, ['Deck ID', 'DeckId', 'Draft ID', 'DraftId']);
    const cardName = readColumn(row, ['Card Name', 'Card', 'Name']);
    const zone = String(readColumn(row, ['Zone', 'Board']) || 'main').toLowerCase();
    if (!deckId) throw new Error('Archetype corpus CSV rows require a Deck ID column.');
    if (!cardName || /side/.test(zone)) continue;
    if (!grouped.has(deckId)) {
      grouped.set(deckId, {
        id: deckId,
        setCode: readColumn(row, ['Set Code', 'Set', 'Expansion']),
        format: readColumn(row, ['Format', 'Event Type']),
        eventDate: readColumn(row, ['Event Date', 'Date']),
        record: readColumn(row, ['Record']),
        wins: readColumn(row, ['Wins']),
        losses: readColumn(row, ['Losses']),
        rank: readColumn(row, ['Rank', 'Rank Bucket']),
        trophy: readColumn(row, ['Trophy', 'Is Trophy']),
        archetype: readColumn(row, ['Archetype', 'Cluster']),
        colors: readColumn(row, ['Colors', 'Color Identity']),
        cards: []
      });
    }
    grouped.get(deckId).cards.push({
      name: cardName,
      quantity: readColumn(row, ['Quantity', 'Count', 'Copies']) || 1
    });
  }
  return [...grouped.values()].map((deck, deckIndex) => normalizedDeck(deck, index, `deck-${deckIndex + 1}`));
}

function parseArchetypeCorpus(text, { catalog = {}, fileName = '' } = {}) {
  const sourceText = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!sourceText) throw new Error('The archetype corpus file is empty.');
  const index = catalogByName(catalog);
  let decks;
  let metadata = {};
  if (sourceText.startsWith('{') || sourceText.startsWith('[') || /\.json$/i.test(fileName)) {
    let payload;
    try { payload = JSON.parse(sourceText); } catch (error) { throw new Error(`The archetype corpus JSON is invalid: ${error.message}`); }
    const values = Array.isArray(payload) ? payload : payload.decks;
    if (!Array.isArray(values)) throw new Error('Archetype corpus JSON requires a decks array.');
    metadata = Array.isArray(payload) ? {} : {
      source: payload.source || null,
      license: payload.license || null,
      generatedAt: payload.generatedAt || payload.generated_at || null
    };
    decks = values.map((deck, deckIndex) => normalizedDeck(deck, index, `deck-${deckIndex + 1}`));
  } else {
    decks = decksFromCsv(sourceText, index);
  }

  decks = decks.filter((deck) => deck.cards.length > 0);
  if (!decks.length) throw new Error('No main-deck cards were found in the archetype corpus.');
  const trophyCount = decks.filter((deck) => deck.trophy).length;
  if (!trophyCount) throw new Error('No trophy decks were found. Include Trophy=true or a format and qualifying win record.');
  const summary = summarizeArchetypeCorpus({ decks });
  return { version: 1, ...metadata, decks, summary };
}

function summarizeArchetypeCorpus(corpus, { setCode = null, format = null } = {}) {
  const targetSet = String(setCode || '').trim().toUpperCase();
  const targetFormat = normalizeFormat(format);
  const allDecks = (corpus?.decks || []).filter((deck) => {
    if (targetSet && deck.setCode !== targetSet) return false;
    if (targetFormat !== 'any' && deck.format !== 'any' && deck.format !== targetFormat) return false;
    return true;
  });
  const trophyDecks = allDecks.filter((deck) => deck.trophy);
  const archetypes = [...new Set(trophyDecks.map((deck) => deck.archetype).filter(Boolean))].sort();
  return {
    deckCount: allDecks.length,
    trophyCount: trophyDecks.length,
    archetypeCount: archetypes.length,
    archetypes,
    setCodes: [...new Set(allDecks.map((deck) => deck.setCode).filter(Boolean))].sort(),
    formats: [...new Set(allDecks.map((deck) => deck.format).filter((value) => value !== 'any'))].sort()
  };
}

function weightedPresence(decks, key, weightById) {
  let present = 0;
  let total = 0;
  for (const deck of decks) {
    const weight = weightById.get(deck.id) || 1;
    total += weight;
    if (deck.cardKeys.has(key)) present += weight;
  }
  return { present, total, rate: total ? present / total : 0 };
}

function recencyWeights(decks) {
  const dates = decks.map((deck) => Date.parse(deck.eventDate || '')).filter(Number.isFinite);
  const newest = dates.length ? Math.max(...dates) : null;
  return new Map(decks.map((deck) => {
    const timestamp = Date.parse(deck.eventDate || '');
    const ageDays = newest !== null && Number.isFinite(timestamp) ? Math.max(0, (newest - timestamp) / 86400000) : 0;
    return [deck.id, Math.max(0.2, 0.5 ** (ageDays / 45))];
  }));
}

function buildArchetypeContext({ pool = [], corpus, setCode = null, format = null }) {
  const exact = buildArchetypeContextExact({ pool, corpus, setCode, format });
  const targetFormat = normalizeFormat(format);
  if (exact.available || targetFormat === 'any') return exact;
  // 17Lands rarely publishes datasets for every draft type, so a quick draft
  // may only have premier trophies to learn from. Same-set decks from other
  // formats stand in — visibly, and with dampened influence.
  const fallback = buildArchetypeContextExact({ pool, corpus, setCode, format: 'any' });
  if (!fallback.available) return exact;
  return {
    ...fallback,
    status: 'cross-format',
    crossFormat: true,
    corpusFormats: [...new Set(fallback.allDecks.map((deck) => deck.format).filter(Boolean))].sort(),
    influence: 0.85
  };
}

function buildArchetypeContextExact({ pool = [], corpus, setCode = null, format = null }) {
  const empty = (status, detail) => ({ available: false, status, score: 0, detail, confidence: 0 });
  if (!corpus?.decks?.length) return empty('missing', 'No archetype corpus imported');
  const summary = summarizeArchetypeCorpus(corpus, { setCode, format });
  if (!summary.trophyCount) return empty('mismatch', 'No corpus decks match this set and format');

  const targetSet = String(setCode || '').trim().toUpperCase();
  const targetFormat = normalizeFormat(format);
  const allDecks = corpus.decks.filter((deck) => {
    if (targetSet && deck.setCode !== targetSet) return false;
    return targetFormat === 'any' || deck.format === 'any' || deck.format === targetFormat;
  }).map((deck) => deck.cardKeys instanceof Set ? deck : { ...deck, cardKeys: new Set(deck.cards.map((entry) => entry.key)) });
  const trophies = allDecks.filter((deck) => deck.trophy);
  const groups = new Map();
  for (const deck of trophies) {
    if (!groups.has(deck.archetype)) groups.set(deck.archetype, []);
    groups.get(deck.archetype).push(deck);
  }
  const eligibleGroups = [...groups.entries()].filter(([, decks]) => decks.length >= MIN_ARCHETYPE_DECKS);
  if (!eligibleGroups.length) return empty('low-sample', `Need at least ${MIN_ARCHETYPE_DECKS} matching trophy decks in an archetype`);

  const poolCards = new Map();
  for (const poolCard of pool) {
    if (/\bBasic Land\b/i.test(String(poolCard.typeLine || ''))) continue;
    const key = normalizeCardName(poolCard.name);
    const previous = poolCards.get(key) || { name: poolCard.name, quantity: 0 };
    previous.quantity += Number(poolCard.quantity || 1);
    poolCards.set(key, previous);
  }
  if (poolCards.size < 2) return empty('early', 'Need at least two drafted cards before using archetype exemplars');

  const weightById = recencyWeights(allDecks);
  let best = null;
  for (const [name, decks] of eligibleGroups) {
    const outside = trophies.filter((deck) => deck.archetype !== name);
    const laneColors = COLOR_ORDER.filter((color) => decks.filter((deck) => deck.colors.includes(color)).length >= Math.ceil(decks.length / 2));
    const matches = [];
    let evidence = 0;
    for (const [key, poolCard] of poolCards) {
      const insideRate = weightedPresence(decks, key, weightById).rate;
      const outsideRate = outside.length ? weightedPresence(outside, key, weightById).rate : 0.25;
      const specificity = Math.max(0, insideRate - outsideRate);
      if (insideRate >= 0.25 && specificity >= 0.08) {
        const contribution = specificity * Math.min(2, poolCard.quantity);
        evidence += contribution;
        matches.push({ key, name: poolCard.name, specificity, contribution });
      }
    }
    const laneStrength = evidence + Math.min(3, matches.length) * 0.12;
    if (!best || laneStrength > best.laneStrength) best = { name, colors: laneColors, decks, outside, matches, evidence, laneStrength };
  }
  if (!best || best.matches.length < 2 || best.laneStrength < 0.55) return empty('no-lane', 'The drafted pool does not yet match a corpus archetype reliably');

  return { available: true, status: 'ready', allDecks, trophies, best, weightById };
}

function evaluateArchetypeSignal({ card, pool = [], corpus, setCode = null, format = null, context = null }) {
  const active = context || buildArchetypeContext({ pool, corpus, setCode, format });
  if (!active.available) return active;
  const { allDecks, trophies, best, weightById } = active;

  const key = normalizeCardName(card.name);
  const groupPresence = weightedPresence(best.decks, key, weightById);
  const globalPresence = weightedPresence(trophies, key, weightById);
  let pairWeight = 0;
  let pairDelta = 0;
  for (const match of best.matches) {
    const withPoolCard = trophies.filter((deck) => deck.cardKeys.has(match.key));
    if (withPoolCard.length < 2) continue;
    const conditional = weightedPresence(withPoolCard, key, weightById).rate;
    const weight = match.contribution;
    pairDelta += (conditional - globalPresence.rate) * weight;
    pairWeight += weight;
  }
  const conditionalDelta = pairWeight ? pairDelta / pairWeight : 0;
  const sameArchetypeAllDecks = allDecks.filter((deck) => deck.archetype === best.name);
  const baselinePresence = weightedPresence(sameArchetypeAllDecks, key, weightById);
  const hasNonTrophyBaseline = sameArchetypeAllDecks.length >= best.decks.length + 4;
  const trophyLift = hasNonTrophyBaseline ? groupPresence.rate - baselinePresence.rate : 0;
  const sampleConfidence = clamp((best.decks.length - MIN_ARCHETYPE_DECKS + 2) / 8, 0.35, 1);
  const laneConfidence = clamp((best.laneStrength - 0.35) / 1.65, 0, 1);
  const confidence = sampleConfidence * (0.55 + laneConfidence * 0.45);
  const influence = Number(active.influence) || 1;
  const rawScore = (groupPresence.rate - 0.4) * 7 + conditionalDelta * 9 + trophyLift * 3;
  const score = clamp(rawScore * confidence * influence, -8, 8);
  const inclusionCount = best.decks.filter((deck) => deck.cardKeys.has(key)).length;
  const direction = score >= 0 ? 'supports' : 'questions';
  const matchNames = best.matches.sort((a, b) => b.contribution - a.contribution).slice(0, 3).map((entry) => entry.name);
  const detail = `${best.name} trophy pattern ${direction} this pick · ${inclusionCount}/${best.decks.length} decks · linked to ${matchNames.join(', ')}${active.crossFormat ? ' · cross-format trophies' : ''}`;

  return {
    available: true,
    status: 'ready',
    score: rounded(score),
    confidence: rounded(confidence * 100, 0),
    archetype: best.name,
    colors: best.colors,
    inclusionCount,
    deckCount: best.decks.length,
    inclusionRate: rounded(groupPresence.rate * 100, 0),
    conditionalLift: rounded(conditionalDelta * 100, 0),
    trophyLift: hasNonTrophyBaseline ? rounded(trophyLift * 100, 0) : null,
    poolMatches: matchNames,
    detail
  };
}

module.exports = {
  MIN_ARCHETYPE_DECKS,
  buildArchetypeContext,
  createArchetypeDeck,
  evaluateArchetypeSignal,
  inferColorProfile,
  isGenericArchetypeLabel,
  manaRequirements,
  normalizeFormat,
  parseArenaDeckText,
  parseArchetypeCorpus,
  summarizeArchetypeCorpus,
  trophyThreshold
};
