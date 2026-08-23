'use strict';

const { normalizeCardName } = require('./csv.cjs');

const DEFAULT_PHILOSOPHY = Object.freeze({
  name: 'Stay open, then commit',
  sourceBalance: 55,
  powerPriority: 82,
  stayOpen: 76,
  colorDiscipline: 72,
  curveDiscipline: 56,
  signalSensitivity: 44,
  synergyPriority: 90,
  interactionPriority: 80,
  creaturePreference: 50,
  cardOverrides: {}
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

function manaProfile(cardOrManaCost) {
  const manaCost = typeof cardOrManaCost === 'string' ? cardOrManaCost : cardOrManaCost?.manaCost;
  const fixedPips = Object.fromEntries(DRAFT_COLORS.map((color) => [color, 0]));
  const hybridGroups = [];
  const symbols = String(manaCost || '').matchAll(/\{([^}]+)\}|\(([^)]+)\)/g);

  for (const match of symbols) {
    const symbol = match[1] || match[2] || '';
    const colors = [...new Set(symbol.match(/[WUBRG]/g) || [])];
    if (symbol.includes('/') && colors.length > 1) hybridGroups.push(colors);
    else for (const color of colors) fixedPips[color] += 1;
  }

  const fixedColors = DRAFT_COLORS.filter((color) => fixedPips[color] > 0);
  const colors = [...new Set([...fixedColors, ...hybridGroups.flat()])];
  return { manaCost: String(manaCost || ''), colors, fixedColors, fixedPips, hybridGroups };
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

function explicitSubtypeRequirements(rulesText) {
  const text = String(rulesText || '');
  const ignored = new Set(['Artifact', 'Card', 'Creature', 'Equipment', 'Land', 'Permanent', 'Spell', 'Token']);
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
  for (const match of text.matchAll(/(?:if|while) you control (?:a|an)\s+([A-Z][A-Za-z'’-]+)/g)) {
    add(match[1], 'soft', 'for its control requirement');
  }
  for (const match of text.matchAll(/\b([A-Z][A-Za-z'’-]+(?:s|ves))\s+you control/g)) {
    add(match[1], 'soft', 'for its typal payoff');
  }
  for (const match of text.matchAll(/(?:another|each)\s+([A-Z][A-Za-z'’-]+)/g)) {
    add(match[1], 'soft', 'for its typal payoff');
  }
  return [...found.values()];
}

function analyzePoolSynergy(card, pool) {
  const counts = new Map();
  for (const poolCard of pool) {
    for (const subtype of creatureSubtypes(poolCard)) counts.set(subtype, (counts.get(subtype) || 0) + 1);
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
  for (const tag of draftThemeTags(card)) {
    const support = themeSupport(tag, pool);
    if (!support.score) continue;
    score += support.score;
    reasons.push({ score: support.score, detail: `${support.count} ${tag} enabler${support.count === 1 ? '' : 's'} in pool` });
  }
  return { score, reasons, requirements, hardMissing };
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

function scoreDraftPack({ cards, seventeenLands = [], untapped = [], pool = [], packNumber = 1, pickNumber = 1, philosophy = {} }) {
  const settings = { ...DEFAULT_PHILOSOPHY, ...philosophy };
  const landsByName = new Map(seventeenLands.map((card) => [card.key || normalizeCardName(card.name), card]));
  const untappedByName = new Map(untapped.map((card) => [card.key || normalizeCardName(card.name), card]));
  const pickIndex = (Math.max(1, packNumber) - 1) * 14 + Math.max(1, pickNumber);
  const commitment = clamp((pickIndex - 3) / 12, 0, 1);
  const colorContext = inferColorContext(pool, packNumber, pickNumber);
  const source17Weight = clamp(settings.sourceBalance) / 100;
  const powerScale = 0.72 + clamp(settings.powerPriority) / 100 * 0.28;

  return cards.map((card, packIndex) => {
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
    const fit = evaluateColorFit(card, colorContext);
    const synergy = analyzePoolSynergy(card, pool);
    const baseFlexibility = flexibilityScore(card, fit, colorContext);
    const flexibility = synergy.hardMissing ? Math.min(30, baseFlexibility) : baseFlexibility;
    const curve = curveScore(card, pool);
    const urgency = urgencyScore(lands, tapped);
    const role = analyzeCardRole(card);
    const impact = cardImpactAdjustment(lands, tapped, source17Weight, settings.powerPriority);

    const colorScale = fit.score < 50 ? 0.42 : 0.16;
    const colorDelta = (fit.score - 50) * (settings.colorDiscipline / 100) * colorContext.confidence * colorScale;
    const openDelta = (flexibility - 50) * (settings.stayOpen / 100) * (1 - commitment) * 0.13;
    const curveDelta = (curve - 50) * (settings.curveDiscipline / 100) * commitment * 0.1;
    const signalDelta = (urgency - 50) * (settings.signalSensitivity / 100) * 0.08;
    const synergyDelta = synergy.score * (settings.synergyPriority / 100);
    const interactionDelta = role.score * (settings.interactionPriority / 100);
    const impactDelta = impact.score;
    const creatureDelta = roleAdjustment(card, settings, pool);
    const overrideDelta = Number(settings.cardOverrides?.[card.name] ?? settings.cardOverrides?.[key] ?? 0) || 0;
    const calculatedDelta = colorDelta + openDelta + curveDelta + signalDelta + synergyDelta + interactionDelta + impactDelta + creatureDelta + overrideDelta;
    const philosophyDelta = dataScore === null || isBasicLand ? 0 : calculatedDelta;
    const score = dataScore === null || isBasicLand ? null : clamp(50 + (dataScore - 50) * powerScale + philosophyDelta);

    const reasons = score === null ? [] : [];
    if (score !== null && impact.flag) reasons.push(`${impact.flag.detail} · ${rounded(impact.confidence * 100, 0)}% confidence`);
    if (score !== null) reasons.push(...synergy.reasons.map((reason) => `${signed(reason.score * (settings.synergyPriority / 100))} ${reason.detail}`));
    if (lands?.gihWinRate !== null && lands?.gihWinRate !== undefined) reasons.push(`17L ${rounded(lands.gihWinRate)}% GIH`);
    if (tapped?.inHandWinRate !== null && tapped?.inHandWinRate !== undefined) reasons.push(`Untapped ${rounded(tapped.inHandWinRate)}% in-hand`);
    if (score !== null) {
      if (Math.abs(colorDelta) >= 0.6) reasons.push(`${signed(colorDelta)} ${fit.reason}`);
      if (Math.abs(openDelta) >= 0.6) reasons.push(`${signed(openDelta)} flexibility`);
      if (Math.abs(curveDelta) >= 0.6) reasons.push(`${signed(curveDelta)} curve`);
      if (Math.abs(interactionDelta) >= 0.6) reasons.push(`${signed(interactionDelta)} ${role.detail}`);
      if (Math.abs(impactDelta) >= 0.6) reasons.push(`${signed(impactDelta)} draw impact`);
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
        impactSources: impact.sources
      },
      adjustments: {
        color: rounded(colorDelta),
        flexibility: rounded(openDelta),
        curve: rounded(curveDelta),
        signal: rounded(signalDelta),
        synergy: rounded(synergyDelta),
        interaction: rounded(interactionDelta),
        impact: rounded(impactDelta),
        creature: rounded(creatureDelta),
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
      synergy: { requirements: synergy.requirements, hardMissing: synergy.hardMissing },
      role: { kind: role.kind, detail: role.detail },
      reasons
    };
  }).sort((a, b) => {
    if (a.score === null && b.score === null) return a.packIndex - b.packIndex;
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score || a.packIndex - b.packIndex;
  });
}

module.exports = {
  DEFAULT_PHILOSOPHY,
  analyzePoolSynergy,
  analyzeCardRole,
  cardImpactAdjustment,
  colorsFromMana,
  creatureSubtypes,
  draftThemeTags,
  evaluateColorFit,
  explicitSubtypeRequirements,
  ferociousEnablerWeight,
  inferColorContext,
  impactSampleConfidence,
  manaProfile,
  manaValue,
  scoreDraftPack,
  winRateScore
};
