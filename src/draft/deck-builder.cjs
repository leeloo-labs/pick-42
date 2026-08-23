'use strict';

const { normalizeCardName } = require('./csv.cjs');
const {
  analyzeCardRole,
  draftThemeTags,
  ferociousEnablerWeight,
  manaProfile,
  manaValue,
  scoreDraftPack
} = require('./blend-engine.cjs');

const COLOR_NAMES = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

const ARCHETYPES = Object.freeze([
  {
    id: 'golgari',
    name: 'Golgari',
    colors: ['B', 'G'],
    baseColors: ['B', 'G'],
    splashColors: [],
    label: 'B/G FEROCIOUS',
    description: 'The deepest creature build. Mirkwood supports the Wolf package while black supplies premium removal.'
  },
  {
    id: 'jund',
    name: 'Jund',
    colors: ['B', 'G', 'R'],
    baseColors: ['B', 'G'],
    splashColors: ['R'],
    label: 'B/G + RED SPLASH',
    description: 'The highest ceiling. It splashes efficient red interaction, accepting a tighter mana base.'
  },
  {
    id: 'rakdos',
    name: 'Rakdos',
    colors: ['B', 'R'],
    baseColors: ['B', 'R'],
    splashColors: [],
    label: 'B/R INTERACTION',
    description: 'The most removal-dense build. Red adds reach and tempo while black carries the creature base.'
  }
]);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function rounded(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function isBasicLand(card) {
  return /\bBasic Land\b/i.test(String(card.typeLine || ''));
}

function isLand(card) {
  return /\bLand\b/i.test(String(card.typeLine || ''));
}

function isCreature(card) {
  return /\bCreature\b/i.test(String(card.typeLine || ''));
}

function landColors(card) {
  const colors = [];
  for (const match of String(card.rulesText || '').matchAll(/\bAdd\s+\{([WUBRG])\}(?:\s+or\s+\{([WUBRG])\})?/gi)) {
    colors.push(match[1], match[2]);
  }
  return [...new Set(colors.filter(Boolean))];
}

function canPlay(card, colors) {
  const allowed = new Set(colors);
  const profile = manaProfile(card);
  if (!profile.fixedColors.every((color) => allowed.has(color))) return false;
  return profile.hybridGroups.every((group) => group.some((color) => allowed.has(color)));
}

function cardRoles(card) {
  const rulesText = String(card.rulesText || '');
  const role = analyzeCardRole(card);
  const makesBody = /\bamass\b|\bcreate\b[^.]*\bcreature token\b/i.test(rulesText);
  const sacrificeRemoval = /target opponent sacrifices a creature/i.test(rulesText);
  return {
    creature: isCreature(card),
    makesBody,
    interaction: Boolean(role.kind) || sacrificeRemoval,
    premiumRemoval: role.kind === 'premium-removal',
    equipment: /\bEquipment\b/i.test(String(card.typeLine || '')),
    cardAdvantage: /\bdraw (?:a|one|two|three|\d+) cards?\b|return up to one target creature card from your graveyard to your hand/i.test(rulesText),
    combatTrick: /until end of turn/i.test(rulesText) && !Boolean(role.kind),
    ferociousPayoff: draftThemeTags(card).includes('Ferocious'),
    ferociousEnabler: ferociousEnablerWeight(card) > 0
  };
}

function splashBurden(card, archetype) {
  if (!archetype.splashColors.length) return 0;
  const profile = manaProfile(card);
  let burden = 0;
  for (const color of archetype.splashColors) burden += profile.fixedPips[color] * 4;
  for (const group of profile.hybridGroups) {
    const playableOptions = group.filter((color) => archetype.colors.includes(color));
    if (playableOptions.length && playableOptions.every((color) => archetype.splashColors.includes(color))) burden += 2.5;
  }
  return burden;
}

function scorePoolCards({ cards, seventeenLands, untapped, philosophy, archetype }) {
  const eligible = cards.filter((card) => !isLand(card) && canPlay(card, archetype.colors));
  const sourceScores = scoreDraftPack({
    cards: eligible,
    seventeenLands,
    untapped,
    pool: [],
    packNumber: 1,
    pickNumber: 1,
    philosophy
  });
  const byIndex = new Map(sourceScores.map((card) => [card.packIndex, card]));

  return eligible.map((card, poolIndex) => {
    const source = byIndex.get(poolIndex);
    const roles = cardRoles(card);
    const sourceValue = source?.dataScore ?? 32;
    const roleValue = (source?.adjustments?.interaction || 0) + (source?.adjustments?.impact || 0);
    const burden = splashBurden(card, archetype);
    return {
      ...card,
      poolIndex,
      manaValue: manaValue(card.manaCost),
      roles,
      sourceValue: rounded(sourceValue),
      deckValue: sourceValue + roleValue - burden,
      splashBurden: burden,
      sourceCoverage: source?.sourceCoverage || 0,
      metrics: source?.metrics || { seventeenLands: null, untapped: null },
      reasons: [
        sourceValue === 32 ? 'No complete source rating' : `${rounded(sourceValue)} blended data`,
        roles.premiumRemoval ? 'Premium removal' : null,
        burden ? `−${rounded(burden)} splash burden` : null
      ].filter(Boolean)
    };
  });
}

function curveBucket(card) {
  const value = card.manaValue || manaValue(card.manaCost);
  if (value >= 5) return '5+';
  return String(Math.max(1, value || 1));
}

function selectionCounts(selected) {
  const curve = { '1': 0, '2': 0, '3': 0, '4': 0, '5+': 0 };
  const counts = {
    creatures: 0,
    bodies: 0,
    interaction: 0,
    equipment: 0,
    combatTricks: 0,
    cardAdvantage: 0,
    ferociousPayoffs: 0,
    ferociousEnablers: 0,
    curve
  };
  for (const card of selected) {
    if (card.roles.creature) {
      counts.creatures += 1;
      curve[curveBucket(card)] += 1;
    }
    counts.bodies += card.roles.creature ? 1 : (card.roles.makesBody ? 0.75 : 0);
    counts.interaction += Number(card.roles.interaction);
    counts.equipment += Number(card.roles.equipment);
    counts.combatTricks += Number(card.roles.combatTrick);
    counts.cardAdvantage += Number(card.roles.cardAdvantage);
    counts.ferociousPayoffs += Number(card.roles.ferociousPayoff);
    counts.ferociousEnablers += Number(card.roles.ferociousEnabler);
  }
  return counts;
}

function marginalValue(card, selected, archetype, creaturePass = false) {
  const counts = selectionCounts(selected);
  const desiredCurve = { '1': 2, '2': 5, '3': 4, '4': 2, '5+': 2 };
  let value = card.deckValue;

  if (card.roles.creature) {
    const bucket = curveBucket(card);
    const need = desiredCurve[bucket] - counts.curve[bucket];
    value += need > 0 ? Math.min(4, need * 1.2) : Math.max(-4, need * 1.5);
    if (counts.creatures < 14) value += 2.5;
  } else if (creaturePass) {
    value -= 20;
  }
  if (card.roles.makesBody && counts.bodies < 14) value += 2.5;
  if (card.roles.interaction) value += counts.interaction < 6 ? 1.5 : Math.max(-5, (7 - counts.interaction) * 1.5);
  if (card.roles.cardAdvantage && counts.cardAdvantage < 2) value += 1.5;
  if (card.roles.equipment && counts.equipment >= 2) value -= (counts.equipment - 1) * 2.5;
  if (card.roles.combatTrick && counts.combatTricks >= 1) value -= counts.combatTricks * 3;
  if (card.roles.ferociousPayoff) value += Math.min(2, counts.ferociousEnablers * 0.65) - (counts.ferociousEnablers ? 0 : 2);
  if (card.roles.ferociousEnabler && counts.ferociousPayoffs >= 2) value += 1.5;

  const duplicateCount = selected.filter((entry) => entry.name === card.name).length;
  if (duplicateCount >= 2 && !card.roles.premiumRemoval) value -= (duplicateCount - 1) * 1.5;
  if (archetype.id === 'jund' && card.splashBurden) value -= card.splashBurden * 0.5;
  return value;
}

function selectSpells(scoredCards, archetype, target = 23) {
  const selected = [];
  const available = [...scoredCards];
  const eligibleCreatureCount = available.filter((card) => card.roles.creature).length;
  const creatureTarget = Math.min(14, eligibleCreatureCount);

  while (selected.filter((card) => card.roles.creature).length < creatureTarget && available.length) {
    const creatures = available.filter((card) => card.roles.creature);
    if (!creatures.length) break;
    creatures.sort((a, b) => marginalValue(b, selected, archetype, true) - marginalValue(a, selected, archetype, true) || a.poolIndex - b.poolIndex);
    const chosen = creatures[0];
    selected.push(chosen);
    available.splice(available.indexOf(chosen), 1);
  }

  while (selected.length < target && available.length) {
    available.sort((a, b) => marginalValue(b, selected, archetype) - marginalValue(a, selected, archetype) || a.poolIndex - b.poolIndex);
    selected.push(available.shift());
  }

  return { selected, available };
}

function groupedCards(cards) {
  const groups = new Map();
  for (const card of cards) {
    const key = `${normalizeCardName(card.name)}|${card.manaCost}|${card.typeLine}`;
    if (!groups.has(key)) groups.set(key, { ...card, quantity: 0 });
    groups.get(key).quantity += 1;
  }
  return [...groups.values()].sort((a, b) => (a.manaValue || 0) - (b.manaValue || 0) || b.deckValue - a.deckValue || a.name.localeCompare(b.name));
}

function cardGroupKey(card) {
  return `${normalizeCardName(card.name)}|${card.manaCost || ''}|${card.typeLine || ''}`;
}

function excludedCards(pool, selected, lands) {
  const remaining = new Map();
  for (const card of pool.filter((entry) => !isBasicLand(entry))) {
    const key = cardGroupKey(card);
    if (!remaining.has(key)) remaining.set(key, []);
    remaining.get(key).push(card);
  }

  const remove = (card, quantity = 1) => {
    const matches = remaining.get(cardGroupKey(card));
    if (!matches) return;
    matches.splice(0, quantity);
    if (!matches.length) remaining.delete(cardGroupKey(card));
  };
  for (const card of selected) remove(card);
  for (const land of lands.filter((entry) => !entry.basic)) remove(land, land.quantity);

  return groupedCards([...remaining.values()].flat());
}

function lowCurveLandCount(selected) {
  const average = selected.reduce((total, card) => total + card.manaValue, 0) / Math.max(1, selected.length);
  const expensive = selected.filter((card) => card.manaValue >= 5).length;
  const cardAdvantage = selected.filter((card) => card.roles.cardAdvantage).length;
  return average <= 2.25 && expensive <= 1 && cardAdvantage >= 2 ? 16 : 17;
}

function colorDemand(selected, archetype) {
  const demand = Object.fromEntries(archetype.colors.map((color) => [color, 0]));
  const earlyCards = Object.fromEntries(archetype.colors.map((color) => [color, 0]));
  const doublePips = Object.fromEntries(archetype.colors.map((color) => [color, 0]));
  const coloredCards = Object.fromEntries(archetype.colors.map((color) => [color, 0]));

  for (const card of selected) {
    const profile = manaProfile(card);
    for (const color of profile.fixedColors) {
      if (!(color in demand)) continue;
      const pips = profile.fixedPips[color];
      const timingWeight = card.manaValue <= 2 ? 1.5 : (card.manaValue === 3 ? 1.25 : 1);
      demand[color] += pips * timingWeight;
      coloredCards[color] += 1;
      if (card.manaValue <= 2) earlyCards[color] += 1;
      if (pips >= 2) doublePips[color] += 1;
    }
  }
  return { demand, earlyCards, doublePips, coloredCards };
}

function allocateLands(selected, draftedLands, archetype, landCount) {
  const nonbasics = draftedLands.filter((card) => {
    const produced = landColors(card).filter((color) => archetype.colors.includes(color));
    return produced.length >= 2;
  }).slice(0, 2);
  const basicSlots = landCount - nonbasics.length;
  const demand = colorDemand(selected, archetype);
  const nonbasicSources = Object.fromEntries(archetype.colors.map((color) => [color, nonbasics.filter((land) => landColors(land).includes(color)).length]));
  const targets = {};
  for (const color of archetype.colors) {
    if (archetype.splashColors.includes(color)) {
      targets[color] = demand.coloredCards[color] ? clamp(demand.coloredCards[color] + 2, 3, 5) : 0;
    } else if (demand.doublePips[color] >= 2) targets[color] = 9;
    else if (demand.earlyCards[color] >= 4) targets[color] = 8;
    else if (demand.earlyCards[color] >= 2) targets[color] = 7;
    else targets[color] = demand.coloredCards[color] ? 6 : 0;
  }

  const basics = Object.fromEntries(archetype.colors.map((color) => [color, Math.max(0, targets[color] - nonbasicSources[color])]));
  const totalRequested = () => Object.values(basics).reduce((total, count) => total + count, 0);
  while (totalRequested() > basicSlots) {
    const reducible = archetype.colors
      .filter((color) => basics[color] > (archetype.splashColors.includes(color) ? 3 : 5))
      .sort((a, b) => (targets[b] - demand.demand[b]) - (targets[a] - demand.demand[a]) || basics[b] - basics[a]);
    const color = reducible[0] || archetype.colors.slice().sort((a, b) => basics[b] - basics[a])[0];
    basics[color] -= 1;
  }
  while (totalRequested() < basicSlots) {
    const color = archetype.colors.slice().sort((a, b) => (demand.demand[b] / Math.max(1, basics[b] + nonbasicSources[b])) - (demand.demand[a] / Math.max(1, basics[a] + nonbasicSources[a])))[0];
    basics[color] += 1;
  }

  const lands = [
    ...archetype.colors.filter((color) => basics[color] > 0).map((color) => ({ name: COLOR_NAMES[color], quantity: basics[color], colors: [color], basic: true })),
    ...groupedCards(nonbasics).map((land) => ({ ...land, colors: landColors(land), basic: false }))
  ];
  const sources = Object.fromEntries(archetype.colors.map((color) => [color, basics[color] + nonbasicSources[color]]));
  const warnings = archetype.colors
    .filter((color) => sources[color] < targets[color])
    .map((color) => `${sources[color]} ${color} sources for a ${targets[color]}-source target`);
  return { lands, sources, targets, demand: demand.demand, warnings };
}

function buildCurve(selected) {
  const curve = { '1': 0, '2': 0, '3': 0, '4': 0, '5+': 0 };
  for (const card of selected) curve[curveBucket(card)] += 1;
  return curve;
}

function buildOne({ pool, seventeenLands, untapped, philosophy, archetype }) {
  const draftedLands = pool.filter((card) => isLand(card) && !isBasicLand(card));
  const scoredCards = scorePoolCards({ cards: pool, seventeenLands, untapped, philosophy, archetype });
  const initial = selectSpells(scoredCards, archetype, 23);
  let landCount = lowCurveLandCount(initial.selected);
  let selection = initial;
  if (landCount === 16) selection = selectSpells(scoredCards, archetype, 24);
  const selected = selection.selected;
  const mana = allocateLands(selected, draftedLands, archetype, landCount);
  const counts = selectionCounts(selected);
  const averageManaValue = selected.reduce((total, card) => total + card.manaValue, 0) / Math.max(1, selected.length);
  const sourceCoverage = selected.filter((card) => card.sourceCoverage === 2).length;
  const stability = mana.warnings.length ? (archetype.colors.length === 3 ? 'GREEDY' : 'TIGHT') : 'STABLE';

  return {
    ...archetype,
    available: selected.length + landCount === 40,
    mainDeck: groupedCards(selected),
    cuts: groupedCards(selection.available),
    lands: mana.lands,
    excluded: excludedCards(pool, selected, mana.lands),
    curve: buildCurve(selected),
    mana: { ...mana, stability },
    summary: {
      total: selected.length + landCount,
      spells: selected.length,
      lands: landCount,
      creatures: counts.creatures,
      bodies: rounded(counts.bodies),
      interaction: counts.interaction,
      averageManaValue: rounded(averageManaValue, 2),
      sourceCoverage: `${sourceCoverage}/${selected.length}`
    },
    score: rounded(selected.reduce((total, card) => total + card.deckValue, 0) / Math.max(1, selected.length))
  };
}

function buildLimitedDecks({ pool = [], seventeenLands = [], untapped = [], philosophy = {} }) {
  if (pool.filter((card) => !isBasicLand(card)).length < 23) return [];
  return ARCHETYPES.map((archetype) => buildOne({ pool, seventeenLands, untapped, philosophy, archetype }));
}

module.exports = {
  ARCHETYPES,
  allocateLands,
  buildLimitedDecks,
  canPlay,
  cardRoles,
  excludedCards,
  landColors,
  lowCurveLandCount
};
