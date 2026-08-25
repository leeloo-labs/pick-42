'use strict';

const { normalizeCardName } = require('./csv.cjs');
const { buildArchetypeContext, evaluateArchetypeSignal } = require('./archetype-corpus.cjs');

const DEFAULT_STRATEGY_ID = 'balanced';
const STRATEGY_BASE = Object.freeze({
  sourceBalance: 55,
  supportedLanePriority: 0,
  cardOverrides: {}
});

const DRAFT_STRATEGIES = Object.freeze({
  balanced: Object.freeze({
    id: 'balanced',
    name: 'Balanced',
    tag: 'ADAPTIVE',
    description: 'Stay open early, follow strong signals, then balance power, color fit, curve, interaction, and synergy.',
    settings: Object.freeze({
      powerPriority: 82, stayOpen: 76, colorDiscipline: 72, curveDiscipline: 70,
      signalSensitivity: 55, synergyPriority: 70, interactionPriority: 80, creaturePreference: 55,
      aggressionPriority: 20, controlPriority: 20, fixingPriority: 45, rarityPriority: 10,
      archetypePriority: 0
    })
  }),
  synergy: Object.freeze({
    id: 'synergy',
    name: 'Synergy First',
    tag: 'SUPPORTED LANES',
    description: 'Commit to supported set themes and reward real enabler-payoff density without ignoring hard data guardrails.',
    settings: Object.freeze({
      powerPriority: 60, stayOpen: 50, colorDiscipline: 88, curveDiscipline: 65,
      signalSensitivity: 72, synergyPriority: 100, interactionPriority: 65, creaturePreference: 58,
      aggressionPriority: 15, controlPriority: 15, fixingPriority: 35, rarityPriority: 5,
      archetypePriority: 100, supportedLanePriority: 100
    })
  }),
  power: Object.freeze({
    id: 'power',
    name: 'Power & Fixing',
    tag: 'CEILING',
    description: 'Take the highest-impact cards and prioritize mana fixing that keeps premium splashes available.',
    settings: Object.freeze({
      powerPriority: 100, stayOpen: 90, colorDiscipline: 42, curveDiscipline: 42,
      signalSensitivity: 45, synergyPriority: 45, interactionPriority: 78, creaturePreference: 45,
      aggressionPriority: 10, controlPriority: 20, fixingPriority: 100, rarityPriority: 100,
      archetypePriority: 0
    })
  }),
  aggro: Object.freeze({
    id: 'aggro',
    name: 'Aggro',
    tag: 'PRESSURE',
    description: 'Build a low, reliable curve with efficient threats, tempo, combat tricks, evasion, and cheap interaction.',
    settings: Object.freeze({
      powerPriority: 78, stayOpen: 55, colorDiscipline: 88, curveDiscipline: 100,
      signalSensitivity: 70, synergyPriority: 65, interactionPriority: 78, creaturePreference: 88,
      aggressionPriority: 100, controlPriority: 0, fixingPriority: 15, rarityPriority: 5,
      archetypePriority: 0
    })
  }),
  control: Object.freeze({
    id: 'control',
    name: 'Control',
    tag: 'INEVITABILITY',
    description: 'Prioritize early defense and interaction, then card advantage, resilient threats, and late-game finishers.',
    settings: Object.freeze({
      powerPriority: 86, stayOpen: 60, colorDiscipline: 82, curveDiscipline: 78,
      signalSensitivity: 60, synergyPriority: 60, interactionPriority: 100, creaturePreference: 35,
      aggressionPriority: 0, controlPriority: 100, fixingPriority: 65, rarityPriority: 15,
      archetypePriority: 0
    })
  })
});

function philosophyForStrategy(strategyId = DEFAULT_STRATEGY_ID, overrides = {}) {
  const strategy = DRAFT_STRATEGIES[strategyId] || DRAFT_STRATEGIES[DEFAULT_STRATEGY_ID];
  return {
    ...STRATEGY_BASE,
    ...strategy.settings,
    ...overrides,
    strategyId: strategy.id,
    name: strategy.name,
    cardOverrides: overrides.cardOverrides || STRATEGY_BASE.cardOverrides
  };
}

const DEFAULT_PHILOSOPHY = Object.freeze(philosophyForStrategy());
const CONTEXTUAL_PHILOSOPHY = Object.freeze({
  ...philosophyForStrategy('balanced'),
  strategyId: 'contextual',
  name: 'Contextual',
  powerPriority: 85,
  stayOpen: 65,
  colorDiscipline: 82,
  curveDiscipline: 75,
  signalSensitivity: 65,
  synergyPriority: 85,
  interactionPriority: 85,
  aggressionPriority: 35,
  controlPriority: 35,
  fixingPriority: 30,
  archetypePriority: 75,
  supportedLanePriority: 0
});

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function rounded(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

const DRAFT_COLORS = ['W', 'U', 'B', 'R', 'G'];
const DRAFT_COLOR_PAIRS = Object.freeze([
  { colors: ['W', 'U'], name: 'Azorius' },
  { colors: ['U', 'B'], name: 'Dimir' },
  { colors: ['B', 'R'], name: 'Rakdos' },
  { colors: ['R', 'G'], name: 'Gruul' },
  { colors: ['W', 'G'], name: 'Selesnya' },
  { colors: ['W', 'B'], name: 'Orzhov' },
  { colors: ['U', 'R'], name: 'Izzet' },
  { colors: ['B', 'G'], name: 'Golgari' },
  { colors: ['W', 'R'], name: 'Boros' },
  { colors: ['U', 'G'], name: 'Simic' }
]);

function manaProfile(cardOrManaCost) {
  const card = typeof cardOrManaCost === 'object' && cardOrManaCost ? cardOrManaCost : null;
  const manaCost = typeof cardOrManaCost === 'string' ? cardOrManaCost : card?.manaCost;
  const fixedPips = Object.fromEntries(DRAFT_COLORS.map((color) => [color, 0]));
  const hybridGroups = [];
  if (card && /\bLand\b/i.test(String(card.typeLine || ''))) {
    const colors = manaFixingColors(card);
    if (colors.length) hybridGroups.push(colors);
    return { manaCost: String(manaCost || ''), colors, fixedColors: [], fixedPips, hybridGroups, isLandSource: true };
  }
  const symbols = String(manaCost || '').matchAll(/\{([^}]+)\}|\(([^)]+)\)/g);

  for (const match of symbols) {
    const symbol = match[1] || match[2] || '';
    const colors = [...new Set(symbol.match(/[WUBRG]/g) || [])];
    if (symbol.includes('/') && colors.length > 1) hybridGroups.push(colors);
    else for (const color of colors) fixedPips[color] += 1;
  }

  const fixedColors = DRAFT_COLORS.filter((color) => fixedPips[color] > 0);
  const colors = [...new Set([...fixedColors, ...hybridGroups.flat()])];
  return { manaCost: String(manaCost || ''), colors, fixedColors, fixedPips, hybridGroups, isLandSource: false };
}

function colorsFromMana(manaCost) {
  return manaProfile(manaCost).colors;
}

function manaValue(manaCost) {
  const symbols = String(manaCost || '').match(/\{([^}]+)\}|\(([^)]+)\)/g) || [];
  return symbols.reduce((total, symbol) => {
    const number = Number(symbol.replace(/[^0-9]/g, ''));
    return total + (Number.isFinite(number) && number > 0 ? number : 1);
  }, 0);
}

function winRateScore(rate) {
  if (rate === null || rate === undefined) return null;
  return clamp(50 + (rate - 55) * 4);
}

function sampleConfidence(games) {
  if (!games || games <= 0) return 0.35;
  return clamp(Math.log10(games + 1) / 4.5, 0.35, 1);
}

function weightedAverage(parts) {
  const present = parts.filter((part) => part.value !== null && part.value !== undefined && part.weight > 0);
  if (!present.length) return null;
  const weight = present.reduce((total, part) => total + part.weight, 0);
  return present.reduce((total, part) => total + part.value * part.weight, 0) / weight;
}

function poolColorWeights(pool) {
  const weights = Object.fromEntries(DRAFT_COLORS.map((color) => [color, 0]));
  const hybridGroups = [];
  for (const card of pool) {
    if (/\bBasic Land\b/i.test(String(card.typeLine || ''))) continue;
    const profile = manaProfile(card);
    if (profile.fixedColors.length === 1) {
      const color = profile.fixedColors[0];
      weights[color] += 1 + Math.min(0.25, Math.max(0, profile.fixedPips[color] - 1) * 0.25);
    } else if (profile.fixedColors.length > 1) {
      for (const color of profile.fixedColors) weights[color] += 0.75;
    }
    hybridGroups.push(...profile.hybridGroups);
  }
  for (const group of hybridGroups) {
    const strongestWeight = Math.max(...group.map((color) => weights[color]));
    const strongestColors = group.filter((color) => weights[color] === strongestWeight);
    for (const color of strongestColors) weights[color] += 1 / strongestColors.length;
  }
  return weights;
}

function inferColorContext(pool, packNumber = 1, pickNumber = 1) {
  const weights = poolColorWeights(pool);
  const ranked = Object.entries(weights)
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1] || DRAFT_COLORS.indexOf(a[0]) - DRAFT_COLORS.indexOf(b[0]));
  const topWeight = ranked[0]?.[1] || 0;
  const primaryColors = topWeight >= 2.5
    ? ranked.filter(([, weight]) => weight >= topWeight - 0.35).slice(0, 2).map(([color]) => color)
    : [];
  const secondaryThreshold = Math.max(1.25, topWeight * 0.25);
  const secondaryColors = primaryColors.length
    ? ranked.filter(([color, weight]) => !primaryColors.includes(color) && weight >= secondaryThreshold).slice(0, 2).map(([color]) => color)
    : [];
  const acceptedColors = primaryColors.length
    ? [...primaryColors, ...secondaryColors]
    : ranked.map(([color]) => color);
  const pickIndex = (Math.max(1, packNumber) - 1) * 14 + Math.max(1, pickNumber);
  const evidenceConfidence = primaryColors.length ? clamp((topWeight - 2) / 2.5, 0, 1) : 0;
  const depthConfidence = primaryColors.length ? clamp((pool.length - 2) / 5, 0, 1) : 0;
  const timingConfidence = primaryColors.length ? clamp((pickIndex - 3) / 8, 0, 1) : 0;
  const confidence = evidenceConfidence * 0.5 + depthConfidence * 0.3 + timingConfidence * 0.2;

  return {
    weights,
    primaryColors,
    secondaryColors,
    acceptedColors,
    confidence,
    established: primaryColors.length > 0
  };
}

function pairKey(colors) {
  const selected = new Set(colors || []);
  return DRAFT_COLORS.filter((color) => selected.has(color)).join('');
}

function cardPlayableInLane(card, colors) {
  const laneColors = new Set(colors || []);
  const profile = manaProfile(card);
  const fixedFit = profile.fixedColors.every((color) => laneColors.has(color));
  const hybridFit = profile.hybridGroups.every((group) => group.some((color) => laneColors.has(color)));
  return {
    playable: !profile.colors.length || (fixedFit && hybridFit),
    colorless: !profile.colors.length,
    profile
  };
}

function sourceLaneQuality(card, landsByName, untappedByName) {
  const key = normalizeCardName(card.name);
  const lands = landsByName.get(key);
  const tapped = untappedByName.get(key);
  const rate = weightedAverage([
    { value: lands?.gihWinRate ?? null, weight: 0.55 },
    { value: tapped?.inHandWinRate ?? null, weight: 0.45 }
  ]);
  if (rate === null) return 0.82;
  return clamp(0.78 + (rate - 55) * 0.045, 0.4, 1.28);
}

function laneThemeLabel(name, colors, pool) {
  if (name === 'Boros') {
    const dwarves = pool.filter((card) => creatureSubtypes(card).includes('Dwarf')).length;
    if (dwarves >= 2) return 'Boros Dwarves';
  }
  return name || pairKey(colors);
}

function inferDraftLane({
  pool = [],
  seventeenLands = [],
  untapped = [],
  archetypeCorpus = null,
  setCode = null,
  format = null,
  packNumber = 1,
  pickNumber = 1,
  draftId = null,
  preference = null
} = {}) {
  const landsByName = new Map(seventeenLands.map((card) => [card.key || normalizeCardName(card.name), card]));
  const untappedByName = new Map(untapped.map((card) => [card.key || normalizeCardName(card.name), card]));
  const colorDepth = Object.fromEntries(DRAFT_COLORS.map((color) => [color, 0]));
  const pairScores = DRAFT_COLOR_PAIRS.map((pair) => ({ ...pair, score: 0, cards: 0 }));

  for (const card of pool) {
    if (/\bBasic Land\b/i.test(String(card.typeLine || ''))) continue;
    const profile = manaProfile(card);
    if (!profile.colors.length) continue;
    const quality = sourceLaneQuality(card, landsByName, untappedByName);
    const isLand = /\bLand\b/i.test(String(card.typeLine || ''));
    const isHybridOnly = !profile.fixedColors.length && profile.hybridGroups.length > 0;
    const identityWeight = isLand ? 0.25 : isHybridOnly ? 0.48 : profile.fixedColors.length > 1 ? 1.55 : 1;

    for (const color of profile.fixedColors) colorDepth[color] += quality * (profile.fixedColors.length > 1 ? 1.2 : 1);
    for (const group of profile.hybridGroups) {
      for (const color of group) colorDepth[color] += quality * (isLand ? 0.12 : 0.22);
    }
    for (const pair of pairScores) {
      if (!cardPlayableInLane(card, pair.colors).playable) continue;
      pair.score += identityWeight * quality;
      pair.cards += 1;
    }
  }

  const corpusContext = buildArchetypeContext({ pool, corpus: archetypeCorpus, setCode, format });
  if (corpusContext?.best?.colors?.length === 2) {
    const corpusKey = pairKey(corpusContext.best.colors);
    const match = pairScores.find((pair) => pairKey(pair.colors) === corpusKey);
    const corpusConfidence = clamp((corpusContext.best.laneStrength - 0.35) / 1.65, 0, 1);
    if (match) match.score += 2.4 + corpusConfidence * 1.8;
  }

  pairScores.sort((left, right) => right.score - left.score || DRAFT_COLOR_PAIRS.indexOf(left) - DRAFT_COLOR_PAIRS.indexOf(right));
  const top = pairScores[0] || { colors: [], name: 'Open', score: 0, cards: 0 };
  const runnerUp = pairScores[1] || { score: 0 };
  const margin = Math.max(0, top.score - runnerUp.score);
  const pickIndex = (Math.max(1, packNumber) - 1) * 14 + Math.max(1, pickNumber);
  const secondColorDepth = Math.min(...top.colors.map((color) => colorDepth[color] || 0));
  const corpusMatches = corpusContext?.best?.colors?.length === 2
    && pairKey(corpusContext.best.colors) === pairKey(top.colors);
  const evidenceConfidence = clamp((pool.length - 2) / 10, 0, 1);
  const marginConfidence = clamp(margin / 2.8, 0, 1);
  const colorConfidence = clamp(secondColorDepth / 2.5, 0, 1);
  const timingConfidence = clamp((pickIndex - 3) / 18, 0, 1);
  const confidence = clamp(
    evidenceConfidence * 0.27
      + marginConfidence * 0.32
      + colorConfidence * 0.25
      + timingConfidence * 0.16
      + (corpusMatches ? 0.12 : 0),
    0,
    1
  );
  const automaticStatus = pool.length >= 9 && top.score >= 5 && confidence >= 0.6
    ? 'committed'
    : (pool.length >= 3 && top.score >= 2.25 && confidence >= 0.28 ? 'leaning' : 'open');
  const automatic = {
    status: automaticStatus,
    label: laneThemeLabel(top.name, top.colors, pool),
    archetype: top.name,
    colors: top.colors,
    confidence: rounded(confidence * 100, 0),
    score: rounded(top.score),
    margin: rounded(margin),
    evidence: {
      colorDepth: Object.fromEntries(Object.entries(colorDepth).map(([color, value]) => [color, rounded(value)])),
      corpusMatch: corpusMatches ? corpusContext.best.archetype : null,
      runnerUp: pairScores[1]?.name || null
    }
  };

  const activePreference = preference
    && (!preference.draftId || !draftId || String(preference.draftId) === String(draftId))
    ? preference
    : null;
  const mode = ['lock-no-splash', 'lock-splash', 'stay-open'].includes(activePreference?.mode)
    ? activePreference.mode
    : 'auto';
  if (mode === 'stay-open') {
    return { ...automatic, status: 'open', mode, manual: true, splashPolicy: 'open', automatic };
  }
  if (mode === 'lock-no-splash' || mode === 'lock-splash') {
    const colors = activePreference.colors?.length === 2 ? activePreference.colors : automatic.colors;
    const archetype = DRAFT_COLOR_PAIRS.find((pair) => pairKey(pair.colors) === pairKey(colors))?.name || automatic.archetype;
    return {
      ...automatic,
      status: 'locked',
      mode,
      manual: true,
      colors,
      archetype,
      label: activePreference.label || laneThemeLabel(archetype, colors, pool),
      splashPolicy: mode === 'lock-splash' ? 'open' : 'none',
      automatic
    };
  }
  return { ...automatic, mode: 'auto', manual: false, splashPolicy: 'automatic', automatic };
}

function evaluateDraftLaneFit(card, lane, dataScore = null, rarity = null) {
  if (!lane || lane.status === 'open' || !lane.colors?.length) {
    return { classification: 'open', score: 0, tier: 0, playable: true, splashable: false, bombOverride: false, detail: null };
  }
  const fit = cardPlayableInLane(card, lane.colors);
  const strength = clamp((lane.confidence || 0) / 100, 0.35, 1);
  if (fit.colorless) {
    return { classification: 'colorless', score: 0, tier: 0, playable: true, splashable: false, bombOverride: false, detail: null };
  }
  if (fit.profile.isLandSource) {
    const laneColors = fit.profile.colors.filter((color) => lane.colors.includes(color));
    const extraColors = fit.profile.colors.filter((color) => !lane.colors.includes(color));
    if (laneColors.length && extraColors.length) {
      const noSplash = lane.mode === 'lock-no-splash';
      return {
        classification: 'partial-land',
        score: noSplash ? -6 : -2,
        tier: noSplash ? 1 : 0,
        playable: true,
        splashable: !noSplash,
        bombOverride: false,
        detail: noSplash
          ? `only the ${laneColors.join('/')} half supports ${lane.label} · ${extraColors.join('/')} is outside the no-splash plan`
          : `only the ${laneColors.join('/')} half supports ${lane.label}`
      };
    }
  }
  if (fit.playable) {
    const score = lane.status === 'locked' ? 4 : lane.status === 'committed' ? 3 * strength : 1.5 * strength;
    return {
      classification: 'on-lane', score, tier: 0, playable: true, splashable: false, bombOverride: false,
      detail: 'fits the current lane'
    };
  }

  const offLanePips = fit.profile.fixedColors
    .filter((color) => !lane.colors.includes(color))
    .reduce((total, color) => total + fit.profile.fixedPips[color], 0);
  const splashable = fit.profile.fixedColors.length === 1 && offLanePips === 1 && fit.profile.hybridGroups.length === 0;
  const normalizedRarity = String(rarity || '').toLowerCase();
  const bombOverride = (['rare', 'mythic', 'mythic rare'].includes(normalizedRarity) && dataScore >= 76) || dataScore >= 84;
  if (bombOverride) {
    return {
      classification: 'bomb-exception', score: -6 * strength, tier: 0, playable: false, splashable, bombOverride: true,
      detail: `off-lane bomb exception for ${lane.label}`
    };
  }
  if (lane.status === 'leaning') {
    return {
      classification: 'off-lane', score: -3 * strength, tier: 0, playable: false, splashable, bombOverride: false,
      detail: `outside the emerging ${lane.label} lane`
    };
  }
  if (lane.mode === 'lock-splash' && splashable && dataScore >= 60) {
    return {
      classification: 'splash', score: -12, tier: 0, playable: false, splashable: true, bombOverride: false,
      detail: `possible ${lane.label} splash`
    };
  }
  const penalty = lane.mode === 'lock-no-splash' ? -28 : lane.mode === 'lock-splash' ? -24 : -20 * strength;
  return {
    classification: 'off-lane', score: penalty, tier: 2, playable: false, splashable, bombOverride: false,
    detail: lane.mode === 'lock-no-splash' ? `excluded by ${lane.label} · no splash` : `outside committed ${lane.label}`
  };
}

function evaluateColorFit(card, context) {
  const profile = manaProfile(card);
  if (!profile.colors.length) {
    return { score: 72, classification: 'colorless', reason: 'colorless', colors: [], newColors: [] };
  }
  if (!context.established) {
    const isHybrid = profile.hybridGroups.length > 0;
    const score = profile.fixedColors.length <= 1 && (profile.colors.length === 1 || isHybrid) ? 64 : 34;
    return { score, classification: 'open', reason: 'draft still open', colors: profile.colors, newColors: [] };
  }

  const accepted = new Set(context.acceptedColors);
  const newFixedColors = profile.fixedColors.filter((color) => !accepted.has(color));
  const unsupportedHybridGroups = profile.hybridGroups.filter((group) => !group.some((color) => accepted.has(color)));
  const newHybridColors = unsupportedHybridGroups.flat();
  const newColors = [...new Set([...newFixedColors, ...newHybridColors])];
  const matchedColors = profile.colors.filter((color) => accepted.has(color));

  if (newColors.length) {
    const partial = matchedColors.length > 0;
    return {
      score: partial ? 28 : (profile.colors.length === 1 ? 10 : 8),
      classification: partial ? 'splash' : 'new-color',
      reason: partial ? `adds ${newColors.join('/')} to the current plan` : `new color ${newColors.join('/')}`,
      colors: profile.colors,
      newColors
    };
  }

  if (profile.hybridGroups.length) {
    const matchedPrimary = matchedColors.some((color) => context.primaryColors.includes(color));
    return {
      score: matchedPrimary ? 90 : 86,
      classification: 'hybrid-fit',
      reason: `hybrid fits ${matchedColors.join('/')} plan`,
      colors: profile.colors,
      newColors: []
    };
  }
  if (profile.fixedColors.length === 1 && context.primaryColors.includes(profile.fixedColors[0])) {
    return {
      score: 94,
      classification: 'primary',
      reason: `fits primary ${profile.fixedColors[0]}`,
      colors: profile.colors,
      newColors: []
    };
  }
  if (profile.fixedColors.length === 1 && context.secondaryColors.includes(profile.fixedColors[0])) {
    return {
      score: 86,
      classification: 'secondary',
      reason: `fits ${profile.fixedColors[0]} secondary`,
      colors: profile.colors,
      newColors: []
    };
  }
  return {
    score: 82,
    classification: 'plan-fit',
    reason: `fits ${profile.fixedColors.join('/')} plan`,
    colors: profile.colors,
    newColors: []
  };
}

function flexibilityScore(card, colorFit = null, context = null) {
  if (/\bBasic Land\b/i.test(String(card.typeLine || ''))) return 0;
  const profile = manaProfile(card);
  const colors = profile.colors;
  if (!colors.length) return 96;
  if (context?.confidence >= 0.35 && colorFit?.classification === 'new-color') return 24;
  if (context?.confidence >= 0.35 && colorFit?.classification === 'splash') return 38;
  if (profile.hybridGroups.length && colorFit?.classification === 'hybrid-fit') {
    const accepted = new Set(context?.acceptedColors || []);
    return profile.colors.every((color) => accepted.has(color)) ? 88 : 76;
  }
  if (colors.length === 1) {
    const pips = profile.fixedPips[colors[0]] || 1;
    return pips <= 1 ? 76 : 57;
  }
  return 24;
}

function singularSubtype(value) {
  const irregular = { Dwarves: 'Dwarf', Elves: 'Elf', Wolves: 'Wolf' };
  if (irregular[value]) return irregular[value];
  if (/ies$/.test(value)) return `${value.slice(0, -3)}y`;
  if (/s$/.test(value)) return value.slice(0, -1);
  return value;
}

function creatureSubtypes(card) {
  if (!/\bCreature\b/i.test(String(card.typeLine || ''))) return [];
  const subtypeText = String(card.typeLine || '').split(/—|-/).slice(1).join(' ');
  return subtypeText.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
}

function draftThemeTags(card) {
  const tags = [];
  for (const match of String(card.rulesText || '').matchAll(/(?:^|\n)([A-Z][A-Za-z'’ -]{2,24})\s+—/g)) {
    tags.push(match[1].trim());
  }
  return [...new Set(tags)];
}

function ferociousEnablerWeight(card) {
  const rulesText = String(card.rulesText || '');
  const power = Number(card.printedPower);
  const isFerociousPayoff = draftThemeTags(card).includes('Ferocious');
  if (/\bCreature\b/i.test(String(card.typeLine || '')) && Number.isFinite(power) && power >= 4) return 1;
  if (/\bamass\b[^.]*\b(?:4|5|6|7|8|9|\d{2,})\b/i.test(rulesText)) return 0.75;
  if (/\bcreate\b[^.]*\b(?:4|5|6|7|8|9)\/\d+\b/i.test(rulesText)) return 1;
  if (!isFerociousPayoff && /\bput (?:two|three|four|[2-9]) \+1\/\+1 counters\b/i.test(rulesText)) return 0.5;
  if (!isFerociousPayoff && /\bgets? \+(?:2|3|4|5|6|7|8|9)\/\+\d+\b/i.test(rulesText)) return 0.5;
  return 0;
}

function themeSupport(tag, pool) {
  if (tag !== 'Ferocious') return { score: 0, count: 0 };
  const enablers = pool.map((card) => ferociousEnablerWeight(card)).filter((weight) => weight > 0);
  return { score: Math.min(3, enablers.reduce((total, weight) => total + weight, 0) * 1.2), count: enablers.length };
}

function createsEquipmentToken(card) {
  return /\bcreate\b[^.]*\bEquipment artifact token\b/i.test(String(card.rulesText || ''));
}

function explicitSubtypeRequirements(rulesText) {
  const text = String(rulesText || '');
  const ignored = new Set(['Artifact', 'Card', 'Creature', 'Land', 'Permanent', 'Spell', 'Token']);
  const found = new Map();
  const add = (subtype, kind, detail) => {
    const normalized = singularSubtype(subtype);
    if (!normalized || ignored.has(normalized)) return;
    const previous = found.get(normalized);
    if (!previous || kind === 'hard') found.set(normalized, { subtype: normalized, kind, detail });
  };

  for (const match of text.matchAll(/attach[^.]*target\s+([A-Z][A-Za-z'’-]+)\s+you control/g)) {
    add(match[1], 'hard', 'for its attach trigger');
  }
  for (const match of text.matchAll(/\b(?:if|while) you control (?:a|an)\s+([A-Z][A-Za-z'’-]+)/g)) {
    add(match[1], 'soft', 'for its control requirement');
  }
  for (const match of text.matchAll(/\b([A-Z][A-Za-z'’-]+(?:s|ves))\s+you control/g)) {
    add(match[1], 'soft', 'for its typal payoff');
  }
  for (const match of text.matchAll(/\b(?:another|each)\s+([A-Z][A-Za-z'’-]+)/g)) {
    add(match[1], 'soft', 'for its typal payoff');
  }
  if (/\bEquip abilities? you activate\b/i.test(text)) {
    add('Equipment', 'soft', 'for its equip payoff');
  }
  return [...found.values()];
}

function analyzePoolSynergy(card, pool) {
  const counts = new Map();
  for (const poolCard of pool) {
    for (const subtype of creatureSubtypes(poolCard)) counts.set(subtype, (counts.get(subtype) || 0) + 1);
    if (/\bEquipment\b/i.test(String(poolCard.typeLine || ''))) counts.set('Equipment', (counts.get('Equipment') || 0) + 1);
    if (createsEquipmentToken(poolCard)) counts.set('Equipment', (counts.get('Equipment') || 0) + 1);
  }

  const requirements = explicitSubtypeRequirements(card.rulesText);
  const reasons = [];
  let score = 0;
  let hardMissing = false;
  for (const requirement of requirements) {
    const count = counts.get(requirement.subtype) || 0;
    if (!count) {
      const penalty = requirement.kind === 'hard' ? -20 : -7;
      score += penalty;
      hardMissing ||= requirement.kind === 'hard';
      reasons.push({ score: penalty, detail: `no ${requirement.subtype} ${requirement.detail}` });
    } else {
      const bonus = requirement.kind === 'hard' ? Math.min(4, 1.5 + count) : Math.min(6, count * 1.5);
      score += bonus;
      reasons.push({ score: bonus, detail: `${count} ${requirement.subtype}${count === 1 ? '' : 's'} ${requirement.detail}` });
    }
  }

  const candidateTraits = new Set(creatureSubtypes(card));
  if (/\bEquipment\b/i.test(String(card.typeLine || ''))) candidateTraits.add('Equipment');
  if (createsEquipmentToken(card)) candidateTraits.add('Equipment');
  const reciprocal = new Map();
  for (const poolCard of pool) {
    for (const requirement of explicitSubtypeRequirements(poolCard.rulesText)) {
      if (!candidateTraits.has(requirement.subtype)) continue;
      const key = `${requirement.subtype}:${requirement.kind}`;
      const previous = reciprocal.get(key) || { ...requirement, count: 0 };
      previous.count += 1;
      reciprocal.set(key, previous);
    }
  }
  for (const support of reciprocal.values()) {
    const bonus = Math.min(6, support.count * (support.kind === 'hard' ? 2.5 : 1.5));
    score += bonus;
    reasons.push({
      score: bonus,
      detail: `supports ${support.count} ${support.subtype} payoff${support.count === 1 ? '' : 's'} in pool`
    });
  }
  if (createsEquipmentToken(card) && /\bDouble strike\b/i.test(String(card.rulesText || ''))) {
    score += 3;
    reasons.push({ score: 3, detail: 'self-contained double-strike Equipment package' });
  }
  for (const tag of draftThemeTags(card)) {
    const support = themeSupport(tag, pool);
    if (!support.score) continue;
    score += support.score;
    reasons.push({ score: support.score, detail: `${support.count} ${tag} enabler${support.count === 1 ? '' : 's'} in pool` });
  }
  return { score, reasons, requirements, hardMissing };
}

function supportedLaneAdjustment(card, colorFit, archetype, priority) {
  const weight = clamp(priority) / 100;
  if (!weight || !archetype?.available) return { score: 0, detail: null };
  if (colorFit.classification === 'partial-land') return { score: 0, detail: null };
  const confidence = clamp(archetype.confidence) / 100;
  const lane = archetype.archetype || 'supported';
  const laneColors = new Set(archetype.colors || []);
  const profile = manaProfile(card);
  const fixedFit = profile.fixedColors.every((color) => laneColors.has(color));
  const hybridFit = profile.hybridGroups.every((group) => group.some((color) => laneColors.has(color)));
  const onLane = profile.colors.length > 0 && laneColors.size > 0 && fixedFit && hybridFit;
  if (onLane) {
    return { score: 6 * confidence * weight, detail: `stays in the supported ${lane} lane` };
  }
  const partiallyMatches = profile.colors.some((color) => laneColors.has(color));
  if (profile.colors.length && !partiallyMatches) {
    return { score: -18 * confidence * weight, detail: `outside the supported ${lane} lane` };
  }
  if (profile.colors.length && (partiallyMatches || colorFit.classification === 'splash')) {
    return { score: -10 * confidence * weight, detail: `adds a color outside the supported ${lane} lane` };
  }
  return { score: 0, detail: null };
}

function combinedArchetypeDetail(archetype, supportedLane, total) {
  const lane = archetype?.archetype || 'Supported lane';
  const inclusion = Number.isFinite(archetype?.inclusionCount) && Number.isFinite(archetype?.deckCount)
    ? `${archetype.inclusionCount}/${archetype.deckCount} trophy decks`
    : null;
  if (!supportedLane?.score) return archetype?.detail || `${lane} corpus signal`;
  if (supportedLane.score > 0 && archetype.score < 0) {
    return total >= 0
      ? `${lane} lane fit outweighs limited direct inclusion${inclusion ? ` · ${inclusion}` : ''}`
      : `${lane} color fit, but the trophy pattern remains negative${inclusion ? ` · ${inclusion}` : ''}`;
  }
  if (supportedLane.score > 0) return `${lane} lane and trophy pattern support this pick${inclusion ? ` · ${inclusion}` : ''}`;
  if (archetype.score > 0 && total >= 0) return `${lane} trophy inclusion narrowly outweighs the off-lane cost${inclusion ? ` · ${inclusion}` : ''}`;
  return `${supportedLane.detail}${inclusion ? ` · ${inclusion}` : ''}`;
}

function curveScore(card, pool) {
  const value = manaValue(card.manaCost);
  if (!value) return 55;
  const isCreature = /\bCreature\b/i.test(String(card.typeLine || ''));
  if (!isCreature) return 50;
  const target = { 1: 2, 2: 5, 3: 5, 4: 4, 5: 3, 6: 2 };
  const bucket = Math.min(6, value);
  const current = pool.filter((entry) => /\bCreature\b/i.test(String(entry.typeLine || '')) && Math.min(6, manaValue(entry.manaCost)) === bucket).length;
  const need = target[bucket] ?? 2;
  if (current === 0) return 82;
  return clamp(78 - (current / need) * 48, 22, 78);
}

function duplicateAdjustment(card, pool, role = {}) {
  if (/\bLand\b/i.test(String(card.typeLine || ''))) {
    return { score: 0, existingCopies: 0, candidateCopy: 1, detail: null };
  }
  const key = normalizeCardName(card.name);
  const existingCopies = pool.reduce((total, poolCard) => {
    if (normalizeCardName(poolCard.name) !== key) return total;
    return total + Math.max(1, Number(poolCard.quantity) || 1);
  }, 0);
  const candidateCopy = existingCopies + 1;
  if (!existingCopies) return { score: 0, existingCopies, candidateCopy, detail: null };

  if (/\bLegendary\b/i.test(String(card.typeLine || ''))) {
    const score = existingCopies === 1 ? -3.5 : -15 - (existingCopies - 2) * 8;
    return {
      score,
      existingCopies,
      candidateCopy,
      detail: candidateCopy === 2
        ? 'second legendary copy carries legend-rule risk'
        : candidateCopy === 3
          ? 'third legendary copy is unlikely to make the 40-card deck'
          : `${candidateCopy}th legendary copy is unlikely to make the 40-card deck`
    };
  }

  if (role.kind === 'premium-removal') {
    return { score: 0, existingCopies, candidateCopy, detail: null };
  }
  if (existingCopies === 1) {
    return { score: -0.75, existingCopies, candidateCopy, detail: 'second copy slightly reduces deck diversity' };
  }
  const score = -(existingCopies - 1) * 1.5;
  return {
    score,
    existingCopies,
    candidateCopy,
    detail: `${candidateCopy}${candidateCopy === 3 ? 'rd' : 'th'} copy adds diminishing returns`
  };
}

function urgencyScore(seventeenLands, untapped) {
  const lastSeen = weightedAverage([
    { value: seventeenLands?.alsa ?? null, weight: 1 },
    { value: untapped?.avgLastOffered ?? null, weight: 1 }
  ]);
  if (lastSeen === null) return 50;
  return clamp(88 - (lastSeen - 1) * 7.5, 18, 88);
}

function roleAdjustment(card, philosophy, pool) {
  const type = String(card.typeLine || '');
  if (!/Creature/i.test(type)) return 0;
  const creatureCount = pool.filter((entry) => /Creature/i.test(String(entry.typeLine || ''))).length;
  const need = clamp((15 - creatureCount) / 15, 0, 1);
  return ((philosophy.creaturePreference - 50) / 50) * need * 4;
}

function analyzeCardRole(card) {
  const text = String(card.rulesText || '').replace(/\s+/g, ' ').trim();
  const hasAdditionalCost = /as an additional cost|costs? .+ less to cast if/i.test(text);
  if (!hasAdditionalCost && /\b(?:Destroy|Exile) target creature\./i.test(text)) {
    return { score: 6, kind: 'premium-removal', detail: 'premium unconditional removal' };
  }
  const damage = Number(text.match(/\bdeals? (\d+) damage to target creature/i)?.[1]);
  if (Number.isFinite(damage) && damage >= 5) return { score: 3, kind: 'strong-removal', detail: 'high-damage removal' };
  if (!hasAdditionalCost && /\b(?:Destroy|Exile) target (?:tapped |attacking |blocking )?creature\b/i.test(text)) {
    return { score: 2, kind: 'conditional-removal', detail: 'reliable interaction' };
  }
  if (Number.isFinite(damage) && damage >= 3) return { score: 1.5, kind: 'damage-removal', detail: 'efficient interaction' };
  return { score: 0, kind: null, detail: null };
}

function strategyRoleScores(card, interactionRole = analyzeCardRole(card)) {
  const type = String(card.typeLine || '');
  const text = String(card.rulesText || '').replace(/\s+/g, ' ').trim();
  const value = manaValue(card.manaCost);
  const power = Number(card.printedPower);
  const toughness = Number(card.printedToughness);
  const creature = /\bCreature\b/i.test(type);
  const combatTrick = /until end of turn/i.test(text) && /(?:gets? [+-]\d+\/|gains? (?:first strike|double strike|trample|menace))/i.test(text);
  const evasion = /\b(?:Flying|Menace|Trample)\b|can(?:not|'t) be blocked/i.test(text);
  const haste = /\bHaste\b/i.test(text);
  const defensiveKeyword = /\b(?:Deathtouch|Lifelink|Reach|Vigilance|Ward)\b/i.test(text);
  const cardAdvantage = /\bdraw (?:a|one|two|three|\d+) cards?\b|return (?:up to )?one target .+ card from your graveyard to your hand/i.test(text);
  const sweeper = /(?:destroy|exile) all creatures|deals? \d+ damage to each creature/i.test(text);
  const tempo = /return target .+ to (?:its|their) owner's hand|tap target creature|target creature can(?:not|'t) block/i.test(text);
  let aggression = 0;
  let control = 0;

  if (creature) {
    if (value <= 2) aggression += 2.5;
    else if (value === 3) aggression += 1.25;
    else if (value >= 5) aggression -= 2;
    if (Number.isFinite(power) && value > 0 && power >= value) aggression += 1;
    if (evasion) aggression += 1.1;
    if (haste) aggression += 1.4;

    if (value <= 3 && Number.isFinite(toughness) && toughness >= Math.max(3, power + 1)) control += 1.7;
    if (/\bDefender\b/i.test(text)) { aggression -= 1.5; control += 2; }
    if (defensiveKeyword) control += 1;
    if (value >= 5 && (evasion || (Number.isFinite(power) && power >= 4))) control += 1.2;
  }

  if (interactionRole.score) {
    control += interactionRole.score * 0.55;
    if (value > 0 && value <= 3) aggression += Math.min(1.2, interactionRole.score * 0.2);
  }
  if (combatTrick) { aggression += 1.7; control -= 1; }
  if (tempo) { aggression += value <= 3 ? 1.4 : 0.5; control += 0.8; }
  if (cardAdvantage) { control += 2.4; if (value >= 4) aggression -= 0.8; }
  if (sweeper) { aggression -= 2; control += 4; }

  const aggressionDetail = aggression >= 1.5
    ? (value <= 2 && creature ? 'efficient early pressure' : (combatTrick || tempo ? 'tempo for an aggressive plan' : 'aggressive threat'))
    : (aggression <= -1 ? 'slow for an aggressive plan' : null);
  const controlDetail = control >= 2
    ? (interactionRole.score ? 'interaction for a control plan' : (cardAdvantage ? 'card advantage and inevitability' : 'defense and late-game value'))
    : (control <= -0.8 ? 'low control value' : null);
  return {
    aggression: { score: clamp(aggression, -4, 5), detail: aggressionDetail },
    control: { score: clamp(control, -3, 6), detail: controlDetail }
  };
}

function manaFixingColors(card) {
  const text = String(card.rulesText || '');
  if (/add one mana of any color/i.test(text)) return DRAFT_COLORS;
  const colors = [];
  for (const clause of text.match(/\bAdd\b[^.\n]*/gi) || []) {
    for (const match of clause.matchAll(/\{([WUBRG])\}/g)) colors.push(match[1]);
  }
  return [...new Set(colors)];
}

function fixingAdjustment(card, priority, laneFit = null) {
  if (/\bBasic Land\b/i.test(String(card.typeLine || ''))) return 0;
  if (laneFit?.classification === 'partial-land' && laneFit.tier > 0) return 0;
  const fixing = manaFixingColors(card);
  if (fixing.length < 2) return 0;
  const base = /\bLand\b/i.test(String(card.typeLine || '')) ? 2.8 : 2;
  return base * (clamp(priority) / 100);
}

function rarityAdjustment(rarity, priority, confidence) {
  const normalized = String(rarity || '').toLowerCase();
  const base = normalized === 'mythic' || normalized === 'm' ? 1.5 : (normalized === 'rare' || normalized === 'r' ? 0.8 : 0);
  if (!base) return 0;
  const priorStrength = 1.05 - clamp(confidence, 0, 1) * 0.45;
  return base * (clamp(priority) / 100) * priorStrength;
}

function impactSampleSize(source, kind) {
  if (!source) return null;
  if (kind === 'seventeenLands') {
    const inHand = Number(source.gamesInHand);
    const notSeen = Number(source.gamesNotSeen);
    if (inHand > 0 && notSeen > 0) return Math.min(inHand, notSeen);
    return inHand > 0 ? inHand : null;
  }
  const games = Number(source.games);
  return games > 0 ? games : null;
}

function impactSampleConfidence(samples) {
  if (!samples || samples <= 0) return 0.2;
  return clamp(Math.sqrt(samples / (samples + 700)), 0.2, 1);
}

function classifyImpact(value, confidence, confidenceAdjustedValue) {
  if (value === null) return null;
  if (confidence < 0.45 && Math.abs(value) >= 5) {
    return {
      kind: 'uncertain',
      severity: 'watch',
      label: 'LOW-SAMPLE IIH',
      detail: `${signed(value)}pp IIH · early signal`
    };
  }
  if (confidenceAdjustedValue <= -5.5) {
    return {
      kind: 'negative',
      severity: 'strong',
      label: 'DRAW LIABILITY',
      detail: `${signed(value)}pp IIH · strong negative impact`
    };
  }
  if (confidenceAdjustedValue <= -5) {
    return {
      kind: 'negative',
      severity: 'strong',
      label: 'NEGATIVE IIH',
      detail: `${signed(value)}pp IIH · negative draw signal`
    };
  }
  if (confidenceAdjustedValue >= 5.5) {
    return {
      kind: 'positive',
      severity: 'strong',
      label: 'HIGH IMPACT',
      detail: `${signed(value)}pp IIH · strong positive impact`
    };
  }
  if (confidenceAdjustedValue >= 5) {
    return {
      kind: 'positive',
      severity: 'strong',
      label: 'POSITIVE IIH',
      detail: `${signed(value)}pp IIH · positive draw signal`
    };
  }
  return null;
}

function cardImpactAdjustment(seventeenLands, untapped, source17Weight, powerPriority) {
  const landsValue = seventeenLands?.improvementInHand ?? seventeenLands?.improvementWhenDrawn ?? null;
  const untappedValue = untapped?.improvementInHand ?? untapped?.inHandWinRateDelta ?? null;
  const landsSamples = impactSampleSize(seventeenLands, 'seventeenLands');
  const untappedSamples = impactSampleSize(untapped, 'untapped');
  const landsConfidence = landsValue === null ? null : impactSampleConfidence(landsSamples);
  const untappedConfidence = untappedValue === null ? null : impactSampleConfidence(untappedSamples);
  const sourceParts = [
    { value: landsValue, confidence: landsConfidence, samples: landsSamples, weight: source17Weight },
    { value: untappedValue, confidence: untappedConfidence, samples: untappedSamples, weight: 1 - source17Weight }
  ];
  const value = weightedAverage(sourceParts.map((part) => ({
    value: part.value,
    weight: part.weight * (part.confidence ?? 0)
  })));
  if (value === null) {
    return { value: null, confidence: 0, confidenceAdjustedValue: null, score: 0, flag: null, sources: {} };
  }
  const confidence = weightedAverage(sourceParts.map((part) => ({ value: part.confidence, weight: part.value === null ? 0 : part.weight }))) ?? 0;
  const confidenceAdjustedValue = value * confidence;
  const powerScale = 0.75 + (clamp(powerPriority) / 100) * 0.25;
  const score = clamp(confidenceAdjustedValue * 0.9, -7, 7) * powerScale;
  return {
    value,
    confidence,
    confidenceAdjustedValue,
    score,
    flag: classifyImpact(value, confidence, confidenceAdjustedValue),
    sources: {
      seventeenLands: { value: landsValue, confidence: landsConfidence, samples: landsSamples },
      untapped: { value: untappedValue, confidence: untappedConfidence, samples: untappedSamples }
    }
  };
}

function signed(value) {
  const result = rounded(value);
  return `${result >= 0 ? '+' : ''}${result}`;
}

function mainPlanFit(card) {
  if (card.poolPlan?.previouslyExcluded && !card.poolPlan.reconsidered) return false;
  const lane = card.draftLane || {};
  if (!['committed', 'locked'].includes(lane.status)) return true;
  if (['on-lane', 'colorless', 'open'].includes(lane.classification)) return true;
  return lane.classification === 'partial-land' && lane.mode !== 'lock-no-splash';
}

function pickOutlook(card, fallback) {
  if (!card.eligible || mainPlanFit(card)) return null;
  if (card.poolPlan?.previouslyExcluded) {
    return {
      kind: 'likely-sideboard',
      label: 'LIKELY SIDEBOARD',
      detail: fallback
        ? `The best fallback available, but you marked an earlier ${card.name} OUT; Pick 42 does not expect this copy to make the deck unless you restore it to the active pool.`
        : `You marked an earlier ${card.name} OUT; Pick 42 does not expect this copy to make the deck unless you restore it to the active pool.`,
      fallback,
      likelyToPlay: false,
      source: 'pool-choice'
    };
  }
  const lane = card.draftLane || {};
  const speculative = ['splash', 'bomb-exception'].includes(lane.classification);
  const label = lane.classification === 'bomb-exception'
    ? 'SPECULATIVE PICK'
    : (speculative ? 'SPECULATIVE SPLASH' : 'LIKELY SIDEBOARD');
  let detail;
  if (lane.classification === 'bomb-exception') {
    detail = `Powerful enough to take outside ${lane.label}, but it still needs a pivot or mana support to make the deck.`;
  } else if (lane.classification === 'splash') {
    detail = `A possible ${lane.label} splash, but it is not part of the current main-deck plan without more fixing.`;
  } else if (lane.classification === 'partial-land') {
    detail = fallback
      ? `The best fallback available, but only one half supports ${lane.label}; Pick 42 does not expect it to make the no-splash deck.`
      : `Only one half supports ${lane.label}; Pick 42 does not expect it to make the no-splash deck.`;
  } else {
    detail = fallback
      ? `The best fallback available, but it is outside ${lane.label}; Pick 42 does not expect it to make the deck.`
      : `Outside ${lane.label}; Pick 42 does not expect it to make the deck.`;
  }
  return { kind: speculative ? 'speculative' : 'likely-sideboard', label, detail, fallback, likelyToPlay: false };
}

function excludedCardPlan(card, excludedNames, dataScore, synergy, role) {
  if (!excludedNames.has(normalizeCardName(card.name))) {
    return { previouslyExcluded: false, reconsidered: false, adjustment: 0, detail: null };
  }
  let reconsiderReason = null;
  if (dataScore >= 78) reconsiderReason = `elite ${rounded(dataScore)} raw score`;
  else if (role.kind === 'premium-removal' && dataScore >= 68) reconsiderReason = 'premium removal backed by strong source data';
  else if (synergy.score >= 9 && dataScore >= 65) reconsiderReason = 'a newly live synergy package backed by strong source data';
  const reconsidered = Boolean(reconsiderReason);
  return {
    previouslyExcluded: true,
    reconsidered,
    adjustment: reconsidered ? -2 : -16,
    detail: reconsidered
      ? `reconsider the earlier OUT mark: ${reconsiderReason}`
      : `an earlier ${card.name} is marked OUT in the active pool`
  };
}

function scoreDraftPack({
  cards,
  seventeenLands = [],
  untapped = [],
  archetypeCorpus = null,
  pool = [],
  excludedPoolNames = [],
  packNumber = 1,
  pickNumber = 1,
  draftId = null,
  setCode = null,
  format = null,
  lane = null,
  philosophy = {}
}) {
  const settings = { ...DEFAULT_PHILOSOPHY, ...philosophy };
  const landsByName = new Map(seventeenLands.map((card) => [card.key || normalizeCardName(card.name), card]));
  const untappedByName = new Map(untapped.map((card) => [card.key || normalizeCardName(card.name), card]));
  const excludedNames = new Set(excludedPoolNames.map(normalizeCardName).filter(Boolean));
  const pickIndex = (Math.max(1, packNumber) - 1) * 14 + Math.max(1, pickNumber);
  const commitment = clamp((pickIndex - 3) / 12, 0, 1);
  const source17Weight = clamp(settings.sourceBalance) / 100;
  const powerScale = 0.72 + clamp(settings.powerPriority) / 100 * 0.28;
  const archetypeContext = buildArchetypeContext({ pool, corpus: archetypeCorpus, setCode, format });
  const draftLane = lane || inferDraftLane({
    pool,
    seventeenLands,
    untapped,
    archetypeCorpus,
    setCode,
    format,
    packNumber,
    pickNumber,
    draftId
  });
  const inferredColorContext = inferColorContext(pool, packNumber, pickNumber);
  const laneIsEstablished = ['committed', 'locked'].includes(draftLane.status) && draftLane.colors?.length === 2;
  const colorContext = laneIsEstablished
    ? {
        ...inferredColorContext,
        primaryColors: [...draftLane.colors],
        secondaryColors: [],
        acceptedColors: [...draftLane.colors],
        confidence: Math.max(inferredColorContext.confidence, clamp((draftLane.confidence || 0) / 100, 0, 1)),
        established: true
      }
    : inferredColorContext;

  const scoredCards = cards.map((card, packIndex) => {
    const key = normalizeCardName(card.name);
    const lands = landsByName.get(key) || null;
    const tapped = untappedByName.get(key) || null;
    const isBasicLand = /\bBasic Land\b/i.test(String(card.typeLine || ''));
    const landsScore = winRateScore(lands?.gihWinRate);
    const untappedScore = winRateScore(tapped?.inHandWinRate);
    const sourceCoverage = Number(landsScore !== null) + Number(untappedScore !== null);
    const rawPower = weightedAverage([
      { value: landsScore, weight: source17Weight },
      { value: untappedScore, weight: 1 - source17Weight }
    ]);
    const confidence = weightedAverage([
      { value: sampleConfidence(lands?.gamesInHand), weight: landsScore === null ? 0 : source17Weight },
      { value: sampleConfidence(tapped?.games), weight: untappedScore === null ? 0 : 1 - source17Weight }
    ]) ?? 0;
    const dataScore = rawPower === null ? null : 50 + (rawPower - 50) * (0.84 + confidence * 0.16);
    const rarity = lands?.rarity ?? tapped?.rarity ?? card.rarity;
    const laneFit = evaluateDraftLaneFit(card, draftLane, dataScore, rarity);
    const evaluatedFit = evaluateColorFit(card, colorContext);
    const fit = laneFit.classification === 'partial-land'
      ? {
          ...evaluatedFit,
          score: 50,
          classification: 'partial-land',
          reason: laneFit.detail,
          newColors: laneFit.profile?.colors || evaluatedFit.newColors
        }
      : evaluatedFit;
    const synergy = analyzePoolSynergy(card, pool);
    const baseFlexibility = flexibilityScore(card, fit, colorContext);
    const flexibility = synergy.hardMissing ? Math.min(30, baseFlexibility) : baseFlexibility;
    const curve = curveScore(card, pool);
    const urgency = urgencyScore(lands, tapped);
    const role = analyzeCardRole(card);
    const strategyRoles = strategyRoleScores(card, role);
    const impact = cardImpactAdjustment(lands, tapped, source17Weight, settings.powerPriority);
    const archetype = evaluateArchetypeSignal({ card, context: archetypeContext });
    const duplicate = duplicateAdjustment(card, pool, role);
    const poolPlan = excludedCardPlan(card, excludedNames, dataScore, synergy, role);

    const colorScale = fit.score < 50 ? 0.42 : 0.16;
    const colorDelta = (fit.score - 50) * (settings.colorDiscipline / 100) * colorContext.confidence * colorScale;
    const openDelta = (flexibility - 50) * (settings.stayOpen / 100) * (1 - commitment) * 0.13;
    const curveDelta = (curve - 50) * (settings.curveDiscipline / 100) * commitment * 0.1;
    const signalDelta = (urgency - 50) * (settings.signalSensitivity / 100) * 0.08;
    const synergyDelta = synergy.score * (settings.synergyPriority / 100);
    const interactionDelta = role.score * (settings.interactionPriority / 100);
    const impactDelta = impact.score;
    const creatureDelta = roleAdjustment(card, settings, pool);
    const aggressionDelta = strategyRoles.aggression.score * (settings.aggressionPriority / 100);
    const controlDelta = strategyRoles.control.score * (settings.controlPriority / 100);
    const fixingDelta = fixingAdjustment(card, settings.fixingPriority, laneFit);
    const rarityDelta = rarityAdjustment(rarity, settings.rarityPriority, confidence);
    const archetypeDelta = archetype.available ? archetype.score * (clamp(settings.archetypePriority) / 100) : 0;
    const supportedLane = supportedLaneAdjustment(card, fit, archetype, settings.supportedLanePriority);
    const supportedLaneDelta = supportedLane.score;
    const archetypeRecommendationDelta = archetypeDelta + supportedLaneDelta;
    const laneDelta = laneFit.score;
    const duplicateDelta = duplicate.score;
    const poolPlanDelta = poolPlan.adjustment;
    const overrideDelta = Number(settings.cardOverrides?.[card.name] ?? settings.cardOverrides?.[key] ?? 0) || 0;
    const calculatedDelta = colorDelta + openDelta + curveDelta + signalDelta + synergyDelta + interactionDelta + impactDelta + creatureDelta + aggressionDelta + controlDelta + fixingDelta + rarityDelta + archetypeDelta + supportedLaneDelta + laneDelta + duplicateDelta + poolPlanDelta + overrideDelta;
    const philosophyDelta = dataScore === null || isBasicLand ? 0 : calculatedDelta;
    const score = dataScore === null || isBasicLand ? null : clamp(50 + (dataScore - 50) * powerScale + philosophyDelta);

    const reasons = score === null ? [] : [];
    if (score !== null && poolPlan.previouslyExcluded) reasons.push(`${signed(poolPlanDelta)} pool choice: ${poolPlan.detail}`);
    if (score !== null && impact.flag) reasons.push(`${impact.flag.detail} · ${rounded(impact.confidence * 100, 0)}% confidence`);
    if (score !== null) reasons.push(...synergy.reasons.map((reason) => `${signed(reason.score * (settings.synergyPriority / 100))} ${reason.detail}`));
    const combinePartialLandContext = laneFit.classification === 'partial-land'
      && Math.abs(laneDelta) >= 0.6
      && Math.abs(archetypeRecommendationDelta) >= 0.6;
    if (score !== null && combinePartialLandContext) {
      const inclusion = Number.isFinite(archetype.inclusionCount) && Number.isFinite(archetype.deckCount)
        ? ` · ${archetype.inclusionCount}/${archetype.deckCount} trophy-deck inclusion`
        : '';
      reasons.push(`${signed(laneDelta + archetypeRecommendationDelta)} context: ${laneFit.detail}${inclusion}`);
    } else if (score !== null && Math.abs(archetypeRecommendationDelta) >= 0.6) {
      reasons.push(`${signed(archetypeRecommendationDelta)} ${settings.name}: ${combinedArchetypeDetail(archetype, supportedLane, archetypeRecommendationDelta)}`);
    }
    if (score !== null && !combinePartialLandContext && Math.abs(laneDelta) >= 0.6 && laneFit.detail) {
      reasons.push(`${signed(laneDelta)} lane: ${laneFit.detail}`);
    }
    if (score !== null && Math.abs(duplicateDelta) >= 0.6 && duplicate.detail) {
      reasons.push(`${signed(duplicateDelta)} duplicate: ${duplicate.detail}`);
    }
    if (lands?.gihWinRate !== null && lands?.gihWinRate !== undefined) reasons.push(`17L ${rounded(lands.gihWinRate)}% GIH`);
    if (tapped?.inHandWinRate !== null && tapped?.inHandWinRate !== undefined) reasons.push(`Untapped ${rounded(tapped.inHandWinRate)}% in-hand`);
    if (score !== null) {
      if (Math.abs(colorDelta) >= 0.6) reasons.push(`${signed(colorDelta)} ${fit.reason}`);
      if (Math.abs(openDelta) >= 0.6) reasons.push(`${signed(openDelta)} flexibility`);
      if (Math.abs(curveDelta) >= 0.6) reasons.push(`${signed(curveDelta)} curve`);
      if (Math.abs(interactionDelta) >= 0.6) reasons.push(`${signed(interactionDelta)} ${role.detail}`);
      if (Math.abs(impactDelta) >= 0.6) reasons.push(`${signed(impactDelta)} draw impact`);
      if (Math.abs(aggressionDelta) >= 0.6 && strategyRoles.aggression.detail) reasons.push(`${signed(aggressionDelta)} ${settings.name}: ${strategyRoles.aggression.detail}`);
      if (Math.abs(controlDelta) >= 0.6 && strategyRoles.control.detail) reasons.push(`${signed(controlDelta)} ${settings.name}: ${strategyRoles.control.detail}`);
      if (Math.abs(fixingDelta) >= 0.6) reasons.push(`${signed(fixingDelta)} ${settings.name}: flexible mana fixing`);
      if (Math.abs(rarityDelta) >= 0.6) reasons.push(`${signed(rarityDelta)} ${settings.name}: rarity ceiling prior`);
      if (overrideDelta) reasons.push(`${signed(overrideDelta)} personal note`);
    }
    if (isBasicLand) reasons.push('Basic land · not ranked');
    else if (sourceCoverage === 0) reasons.push(lands || tapped ? 'Matched row has no usable in-hand win rate · unranked' : 'No imported source row · unranked');
    else if (sourceCoverage === 1) reasons.push('Only one source matched');

    return {
      ...card,
      packIndex,
      score: rounded(score),
      dataScore: rounded(dataScore),
      philosophyDelta: rounded(philosophyDelta),
      sourceCoverage,
      eligible: score !== null,
      isBasicLand,
      sourceScores: {
        seventeenLands: rounded(landsScore),
        untapped: rounded(untappedScore)
      },
      metrics: {
        seventeenLands: lands,
        untapped: tapped,
        confidence: rounded(confidence * 100, 0),
        drawImpact: rounded(impact.value),
        drawImpactConfidence: rounded(impact.confidence * 100, 0),
        drawImpactAdjusted: rounded(impact.confidenceAdjustedValue),
        impactFlag: impact.flag,
        impactSources: impact.sources,
        archetype
      },
      adjustments: {
        lane: rounded(laneDelta),
        duplicate: rounded(duplicateDelta),
        color: rounded(colorDelta),
        flexibility: rounded(openDelta),
        curve: rounded(curveDelta),
        signal: rounded(signalDelta),
        synergy: rounded(synergyDelta),
        interaction: rounded(interactionDelta),
        impact: rounded(impactDelta),
        creature: rounded(creatureDelta),
        aggression: rounded(aggressionDelta),
        control: rounded(controlDelta),
        fixing: rounded(fixingDelta),
        rarity: rounded(rarityDelta),
        archetype: rounded(archetypeDelta),
        supportedLane: rounded(supportedLaneDelta),
        archetypeRecommendation: rounded(archetypeRecommendationDelta),
        poolPlan: rounded(poolPlanDelta),
        override: rounded(overrideDelta)
      },
      colorContext: {
        primaryColors: colorContext.primaryColors,
        secondaryColors: colorContext.secondaryColors,
        acceptedColors: colorContext.acceptedColors,
        confidence: rounded(colorContext.confidence * 100, 0),
        classification: fit.classification,
        reason: fit.reason,
        colors: fit.colors,
        newColors: fit.newColors
      },
      draftLane: {
        status: draftLane.status,
        mode: draftLane.mode,
        label: draftLane.label,
        colors: draftLane.colors,
        confidence: draftLane.confidence,
        tier: laneFit.tier,
        classification: laneFit.classification,
        splashable: laneFit.splashable,
        bombOverride: laneFit.bombOverride
      },
      synergy: { requirements: synergy.requirements, hardMissing: synergy.hardMissing },
      duplicate: {
        existingCopies: duplicate.existingCopies,
        candidateCopy: duplicate.candidateCopy,
        legendary: /\bLegendary\b/i.test(String(card.typeLine || ''))
      },
      poolPlan,
      role: { kind: role.kind, detail: role.detail, strategy: strategyRoles },
      reasons
    };
  }).sort((a, b) => {
    if (a.score === null && b.score === null) return a.packIndex - b.packIndex;
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    if ((a.draftLane?.tier || 0) !== (b.draftLane?.tier || 0)) return (a.draftLane?.tier || 0) - (b.draftLane?.tier || 0);
    return b.score - a.score || a.packIndex - b.packIndex;
  });

  const rawCards = [...scoredCards].sort((a, b) => {
    if (a.dataScore === null && b.dataScore === null) return a.packIndex - b.packIndex;
    if (a.dataScore === null) return 1;
    if (b.dataScore === null) return -1;
    return b.dataScore - a.dataScore || a.packIndex - b.packIndex;
  });
  const rawRanks = new Map(rawCards.map((card, index) => [card.packIndex, index + 1]));
  const hasMainPlanOption = scoredCards.some((card) => card.eligible && mainPlanFit(card));

  return scoredCards.map((card, index) => ({
    ...card,
    contextualRank: index + 1,
    rawRank: rawRanks.get(card.packIndex),
    pickOutlook: pickOutlook(card, index === 0 && (!hasMainPlanOption || !mainPlanFit(card)))
  }));
}

// Pick Two events take two cards per pack. The second selection is not simply the
// second-ranked row: the first pick joins the pool before the remainder is
// re-scored, so lane pressure, curve, synergy, and duplicate effects apply.
function recommendPickTwoPair({ recommendations, cards, pool = [], ...scoreArgs }) {
  if (!Array.isArray(recommendations) || recommendations.length < 2) return null;
  if (!Array.isArray(cards) || cards.length < 2) return null;
  const first = recommendations.find((card) => card.eligible) || recommendations[0];
  const firstKey = normalizeCardName(first.name);
  const firstCard = cards.find((card) => normalizeCardName(card.name) === firstKey);
  if (!firstCard) return null;
  const remaining = cards.filter((card) => card !== firstCard);
  if (!remaining.length) return null;
  const followUps = scoreDraftPack({ ...scoreArgs, cards: remaining, pool: [...pool, firstCard] });
  const second = followUps.find((card) => card.eligible) || followUps[0];
  if (!second) return null;
  const naiveSecond = recommendations.find((card) => card !== first && (card.eligible || !recommendations.some((entry) => entry.eligible)));
  return {
    first: { name: first.name, score: first.score },
    second: {
      name: second.name,
      score: second.score,
      reason: second.reasons?.[0] || null,
      outlook: second.pickOutlook?.label || null
    },
    secondDiffersFromList: Boolean(naiveSecond) && normalizeCardName(naiveSecond.name) !== normalizeCardName(second.name)
  };
}

module.exports = {
  CONTEXTUAL_PHILOSOPHY,
  DEFAULT_PHILOSOPHY,
  DEFAULT_STRATEGY_ID,
  DRAFT_STRATEGIES,
  analyzePoolSynergy,
  analyzeCardRole,
  cardImpactAdjustment,
  colorsFromMana,
  creatureSubtypes,
  draftThemeTags,
  duplicateAdjustment,
  evaluateColorFit,
  evaluateDraftLaneFit,
  explicitSubtypeRequirements,
  ferociousEnablerWeight,
  inferColorContext,
  inferDraftLane,
  impactSampleConfidence,
  manaProfile,
  manaValue,
  philosophyForStrategy,
  recommendPickTwoPair,
  scoreDraftPack,
  strategyRoleScores,
  winRateScore
};
