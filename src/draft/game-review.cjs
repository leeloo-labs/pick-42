'use strict';

const { EventEmitter } = require('node:events');
const { manaProfile, manaValue } = require('./blend-engine.cjs');
const { normalizeFormat, trophyThreshold } = require('./archetype-corpus.cjs');
const { normalizeCardName } = require('./csv.cjs');

const COLORS = ['W', 'U', 'B', 'R', 'G'];
const COLOR_NAMES = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
const ANALYSIS_VERSION = 4;
const CAPTURE_VERSION = 4;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cardKey(card) {
  return card?.stableId || card?.instanceId
    ? `i:${card.stableId || card.instanceId}`
    : `g:${card?.grpId || card?.name || 'unknown'}`;
}

function cardColors(card) {
  const colors = new Set(String(card?.manaCost || '').match(/[WUBRG]/g) || []);
  if (/\bLand\b/i.test(String(card?.typeLine || ''))) {
    const basic = Object.entries(COLOR_NAMES).find(([, name]) => name === card?.name)?.[0];
    if (basic) colors.add(basic);
    const addText = String(card?.rulesText || '').match(/\bAdd\b[^.\n]*/gi) || [];
    for (const sentence of addText) {
      for (const color of sentence.match(/[WUBRG]/g) || []) colors.add(color);
    }
  }
  return [...colors];
}

function isLand(card) {
  return /\bLand\b/i.test(String(card?.typeLine || ''));
}

function hasConditionalCostReduction(card) {
  return /\bcosts?\b[^.\n]{0,80}\bless to cast\b/i.test(String(card?.rulesText || ''));
}

function castableByManaBase(card, sources = {}) {
  if (!card || isLand(card)) return false;
  const profile = manaProfile(card);
  if (!profile.fixedColors.every((color) => Number(sources[color] || 0) >= Number(profile.fixedPips[color] || 1))) return false;
  return profile.hybridGroups.every((group) => group.some((color) => Number(sources[color] || 0) > 0));
}

function sourceCounts(lands) {
  const counts = Object.fromEntries(COLORS.map((color) => [color, 0]));
  for (const land of lands) {
    for (const color of cardColors(land)) counts[color] += 1;
  }
  return counts;
}

function castingProblem(card, lands, sources) {
  if (!card || isLand(card)) return null;
  const value = manaValue(card.manaCost);
  if (lands.length < value && hasConditionalCostReduction(card)) return null;
  if (lands.length < value) return { kind: 'curve', missingColors: [], manaValue: value };

  const profile = manaProfile(card);
  const missingColors = profile.fixedColors.filter((color) => (sources[color] || 0) < (profile.fixedPips[color] || 0));
  for (const group of profile.hybridGroups) {
    if (!group.some((color) => (sources[color] || 0) > 0)) missingColors.push(...group);
  }
  return missingColors.length
    ? { kind: 'color', missingColors: [...new Set(missingColors)], manaValue: value }
    : null;
}

function deckFingerprint(deck) {
  const cards = [...(deck?.cards || []), ...(deck?.lands || [])]
    .map((card) => `${card.grpId || card.name}:${card.quantity || 1}`)
    .sort()
    .join('|');
  let hash = 2166136261;
  for (let index = 0; index < cards.length; index += 1) {
    hash ^= cards.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function reviewDeckIdentity({ selectedBuild, selectedBuildId }) {
  // Arena's exact list determines the version fingerprint, but archetype identity is an
  // explicit user choice. Inferring it from mana symbols misclassifies hybrid cards.
  return {
    buildId: selectedBuild?.id || selectedBuildId || 'limited',
    name: selectedBuild?.name || 'Limited deck'
  };
}

function draftDeckMatchDecision(state, deck) {
  const expectedTotal = Number(deck?.total || 0);
  if (!state?.matchId || state.gameNumber === null || state.gameNumber === undefined || expectedTotal < 35) {
    return { status: 'pending', reason: 'Waiting for a registered limited deck.' };
  }

  const localSeatId = Number(state.localSeatId || 0);
  const localZone = (state.zones || []).find((zone) => Number(zone.seatId) === localSeatId);
  if (localZone && Number(localZone.library || 0) > 0) {
    const publicZoneTotal = ['hand', 'library', 'graveyard', 'exile']
      .reduce((total, key) => total + Number(localZone[key] || 0), 0);
    const localCardsInPlay = [...(state.battlefield || []), ...(state.stack || [])]
      .filter((card) => Number(card.ownerSeatId) === localSeatId)
      .filter((card) => !card.objectType || card.objectType === 'GameObjectType_Card')
      .filter((card) => card.objectType !== 'GameObjectType_Token')
      .length;
    const observedTotal = publicZoneTotal + localCardsInPlay;
    if (observedTotal !== expectedTotal) {
      return {
        status: 'rejected',
        reason: `Arena reported a ${observedTotal}-card game deck, not the registered ${expectedTotal}-card draft deck.`,
        observedTotal,
        expectedTotal
      };
    }
  } else {
    return { status: 'pending', reason: 'Waiting for Arena to report the game deck size.' };
  }

  const expectedById = new Map();
  for (const card of [...(deck?.cards || []), ...(deck?.lands || [])]) {
    const grpId = Number(card.grpId || 0);
    if (!grpId) continue;
    expectedById.set(grpId, (expectedById.get(grpId) || 0) + Number(card.quantity || 1));
  }
  const openingCards = state.hand || [];
  if (!openingCards.length) return { status: 'pending', reason: 'Waiting for Arena to reveal the opening hand.' };
  const observedById = new Map();
  for (const card of openingCards) {
    const grpId = Number(card.grpId || 0);
    if (!grpId) continue;
    observedById.set(grpId, (observedById.get(grpId) || 0) + 1);
  }
  if (expectedById.size && observedById.size) {
    const mismatch = [...observedById.entries()].find(([grpId, quantity]) => !expectedById.has(grpId) || quantity > expectedById.get(grpId));
    if (mismatch) {
      return {
        status: 'rejected',
        reason: 'The opening hand contains cards that are not in the registered draft deck.',
        grpId: mismatch[0]
      };
    }
  }

  return {
    status: 'accepted',
    reason: `Arena's ${expectedTotal}-card game deck and opening hand match the registered draft deck.`,
    expectedTotal
  };
}

function reviewClearlyMismatchesDeck(review) {
  const deckNames = new Set([...(review?.deck?.cards || []), ...(review?.deck?.lands || [])]
    .map((card) => normalizeCardName(card.name))
    .filter(Boolean));
  if (!deckNames.size) return false;
  const observed = (review?.drawnCards || review?.cardsSeen || [])
    .filter((card) => card?.name && !String(card.name).startsWith('Arena card '));
  const totals = observed.reduce((result, card) => {
    const quantity = Number(card.quantity || 1);
    if (deckNames.has(normalizeCardName(card.name))) result.matches += quantity;
    else result.mismatches += quantity;
    return result;
  }, { matches: 0, mismatches: 0 });
  return totals.mismatches >= 3 && totals.mismatches > totals.matches;
}

function groupedSeenCards(cards) {
  const grouped = new Map();
  for (const card of cards.values()) {
    if (!card?.name || card.name === 'Unknown card' || card.name.startsWith('Arena card ')) continue;
    const current = grouped.get(card.name) || { name: card.name, quantity: 0, manaCost: card.manaCost || '', typeLine: card.typeLine || '' };
    current.quantity += 1;
    grouped.set(card.name, current);
  }
  return [...grouped.values()].sort((a, b) => manaValue(a.manaCost) - manaValue(b.manaCost) || a.name.localeCompare(b.name));
}

function groupedPlayedCards(cards) {
  const grouped = new Map();
  for (const entry of cards.values()) {
    const card = entry.card;
    if (!card?.name || isLand(card)) continue;
    const current = grouped.get(card.name) || {
      name: card.name,
      quantity: 0,
      manaCost: card.manaCost || '',
      typeLine: card.typeLine || '',
      damage: 0,
      playerDamage: 0,
      turnsInPlay: new Set(),
      survived: 0
    };
    current.quantity += 1;
    current.damage += Number(entry.damage || 0);
    current.playerDamage += Number(entry.playerDamage || 0);
    for (const turn of entry.turnsInPlay || []) current.turnsInPlay.add(turn);
    current.survived += Number(entry.endedOnBattlefield || 0);
    grouped.set(card.name, current);
  }
  return [...grouped.values()].map((entry) => ({
    ...entry,
    turnsInPlay: entry.turnsInPlay.size
  })).sort((left, right) => right.playerDamage - left.playerDamage || right.damage - left.damage || right.turnsInPlay - left.turnsInPlay || left.name.localeCompare(right.name));
}

function severityValue(level) {
  return ({ LOW: 0, MODERATE: 1, HIGH: 2 })[level] || 0;
}

function playerVariance(player, review, local) {
  const timeline = player?.timeline || [];
  const final = timeline.at(-1) || { lands: 0, playerTurn: 0, visibleNonlands: 0 };
  const missed = timeline.filter((turn, index) => index > 0 && turn.lands <= timeline[index - 1].lands);
  const earlyMisses = missed.filter((turn) => turn.playerTurn <= 4);
  let level = 'LOW';
  let kind = 'stable';
  let delta = null;
  let expectedLands = null;
  let observedLands = null;

  if (local) {
    const drawn = review.drawnCards || review.cardsSeen || [];
    const deckLands = (review.deck?.lands || []).reduce((total, card) => total + Number(card.quantity || 1), 0);
    const deckTotal = Number(review.deck?.total || 40);
    const observed = drawn.reduce((total, card) => total + Number(card.quantity || 1), 0);
    observedLands = drawn.filter(isLand).reduce((total, card) => total + Number(card.quantity || 1), 0);
    if (observed && deckLands) {
      expectedLands = observed * deckLands / deckTotal;
      delta = observedLands - expectedLands;
    }
    const fourthTurn = timeline.find((turn) => turn.playerTurn === 4);
    if ((fourthTurn && fourthTurn.lands <= 2) || (delta !== null && delta <= -3)) {
      level = 'HIGH';
      kind = 'starved';
    } else if (delta !== null && delta >= 3) {
      level = 'HIGH';
      kind = 'flooded';
    } else if (earlyMisses.length >= 2 || (delta !== null && delta <= -1.75)) {
      level = 'MODERATE';
      kind = 'starved';
    } else if (delta !== null && delta >= 2) {
      level = 'MODERATE';
      kind = 'flooded';
    }
  } else {
    const fourthTurn = timeline.find((turn) => turn.playerTurn === 4);
    if (fourthTurn && fourthTurn.lands <= 2) {
      level = 'HIGH';
      kind = 'starved';
    } else if (final.lands >= 9 && final.lands >= Number(final.visibleNonlands || 0) + 3) {
      level = 'HIGH';
      kind = 'flooded';
    } else if (earlyMisses.length >= 2 || (timeline.length >= 5 && final.lands <= 3)) {
      level = 'MODERATE';
      kind = 'starved';
    } else if (final.lands >= 7 && final.lands > Number(final.visibleNonlands || 0)) {
      level = 'MODERATE';
      kind = 'flooded';
    }
  }

  const expectedText = expectedLands === null
    ? null
    : `${observedLands} lands observed versus ${expectedLands.toFixed(1)} expected from the registered ${review.deck?.lands?.reduce((total, card) => total + Number(card.quantity || 1), 0) || 0}/${review.deck?.total || 40} mana base`;
  const development = timeline.length
    ? `${final.lands} lands after ${final.playerTurn} turns; ${missed.length} turn${missed.length === 1 ? '' : 's'} without an additional land in play${local ? '' : `; ${Number(final.visibleNonlands || 0)} nonland cards visible in public zones`}`
    : 'No reliable turn-by-turn mana record';
  return {
    level,
    kind,
    finalLands: final.lands,
    turns: final.playerTurn,
    missedLandDrops: missed.map((turn) => turn.playerTurn),
    expectedLands: expectedLands === null ? null : Math.round(expectedLands * 10) / 10,
    observedLands,
    detail: [expectedText, development].filter(Boolean).join('. ') + '.'
  };
}

function varianceAnalysis(review) {
  const you = playerVariance(review.playerMana?.you, review, true);
  const opponent = playerVariance(review.playerMana?.opponent, review, false);
  const level = severityValue(you.level) >= severityValue(opponent.level) ? you.level : opponent.level;
  const subjects = [you.level !== 'LOW' ? `your mana was ${you.kind}` : null, opponent.level !== 'LOW' ? `the opponent was ${opponent.kind}` : null].filter(Boolean);
  return {
    level,
    headline: level === 'LOW' ? 'No strong mana-variance signal' : `${level.charAt(0)}${level.slice(1).toLowerCase()} mana variance`,
    summary: subjects.length
      ? `${subjects.join(' and ')} by Pick 42’s factual thresholds. This is evidence about draw shape, not proof that luck decided the result.`
      : 'Neither player crossed Pick 42’s flood or mana-starvation threshold.',
    you,
    opponent
  };
}

function drawQualityAnalysis(review, seventeenLands = []) {
  const rows = new Map(seventeenLands.map((row) => [normalizeCardName(row.name), row]));
  const deckCards = (review.deck?.cards || []).filter((card) => !isLand(card));
  const ratedDeck = deckCards.map((card) => {
    const row = rows.get(normalizeCardName(card.name));
    const rawIih = row?.improvementInHand ?? row?.improvementWhenDrawn;
    const iih = rawIih === null || rawIih === undefined || rawIih === '' ? NaN : Number(rawIih);
    return Number.isFinite(iih) ? { name: card.name, iih, gamesInHand: Number(row.gamesInHand || 0) } : null;
  }).filter(Boolean).sort((left, right) => right.iih - left.iih || left.name.localeCompare(right.name));
  const drawn = new Map((review.drawnCards || review.cardsSeen || []).filter((card) => !isLand(card)).map((card) => [normalizeCardName(card.name), card]));
  const reliable = ratedDeck.filter((card) => card.gamesInHand >= 1000);
  const ranked = reliable.length >= 4 ? reliable : ratedDeck;
  const top = ranked.slice(0, Math.min(4, ranked.length));
  const topDrawn = top.filter((card) => drawn.has(normalizeCardName(card.name)));
  const displayCard = (card, category) => ({
    ...card,
    category,
    quantity: review.captureVersion >= 2 ? Number(drawn.get(normalizeCardName(card.name))?.quantity || 1) : null
  });
  const topCards = top.map((card) => drawn.has(normalizeCardName(card.name))
    ? displayCard(card, 'TOP-4 · DRAWN')
    : { ...card, category: 'TOP-4 · NOT DRAWN', quantity: 0 });
  const topNames = new Set(topCards.map((card) => normalizeCardName(card.name)));
  const liabilities = ratedDeck
    .filter((card) => drawn.has(normalizeCardName(card.name)) && card.iih <= -2 && card.gamesInHand >= 1000 && !topNames.has(normalizeCardName(card.name)))
    .sort((left, right) => left.iih - right.iih || right.gamesInHand - left.gamesInHand)
    .map((card) => displayCard(card, 'NOTABLE LIABILITY'));
  let tier = 'unrated';
  if (top.length >= 4 && topDrawn.length === top.length) tier = 'near-ceiling';
  else if (top.length >= 4 && topDrawn.length >= 3) tier = 'exceptional';
  else if (topDrawn.length >= 2) tier = 'strong';
  else if (topDrawn.length === 1) tier = 'average';
  else if (top.length && liabilities.length) tier = 'rough';
  else if (top.length) tier = 'average';
  return {
    available: ratedDeck.length > 0,
    tier,
    topCount: top.length,
    topDrawnCount: topDrawn.length,
    summary: ratedDeck.length
      ? `You saw ${topDrawn.length} of the ${top.length} highest-IIH cards in this deck${topDrawn.length ? `: ${topDrawn.map((card) => card.name).join(', ')}` : ''}.`
      : 'No matching 17Lands IIH rows were available for the registered deck.',
    note: 'The full top four is marked drawn or not drawn; beyond that, only reliable draws at or below −2.0pp IIH are shown. IIH is historical correlation, not causal credit.',
    cards: [...topCards, ...liabilities]
  };
}

function contributionAnalysis(review) {
  const deckNames = new Set((review.deck?.cards || []).map((card) => normalizeCardName(card.name)));
  const played = (review.cardsPlayed || []).filter((card) => deckNames.has(normalizeCardName(card.name)));
  const mvp = played.filter((card) => Number(card.damage || 0) > 0)
    .sort((left, right) => Number(right.damage || 0) - Number(left.damage || 0) || Number(right.turnsInPlay || 0) - Number(left.turnsInPlay || 0))
    .slice(0, 2)
    .map((card) => ({
      name: card.name,
      label: `${card.damage} DAMAGE OBSERVED`,
      detail: `${card.damage} total damage was attributed to this card${card.turnsInPlay ? ` across ${card.turnsInPlay} recorded turn${card.turnsInPlay === 1 ? '' : 's'} in play` : ''}.`
    }));
  const playedNames = new Set(played.map((card) => normalizeCardName(card.name)));
  const drawnNames = new Set((review.drawnCards || review.cardsSeen || []).map((card) => normalizeCardName(card.name)));
  const lvp = (review.stranded || [])
    .filter((card) => card.turns >= 2 && drawnNames.has(normalizeCardName(card.name)) && !playedNames.has(normalizeCardName(card.name)))
    .slice(0, 2)
    .map((card) => ({
      name: card.name,
      label: 'NEVER DEPLOYED',
      detail: `${card.name} remained uncast across ${card.turns} recorded turn${card.turns === 1 ? '' : 's'}.`
    }));
  return {
    mvp,
    lvp,
    mvpEmpty: 'No card had enough attributable damage to name an evidence-backed MVP.',
    lvpEmpty: 'No defensible LVP: Pick 42 will not call a card bad merely because it was drawn or died.'
  };
}

function controlScore(snapshot) {
  if (!snapshot?.you || !snapshot?.opponent) return 0;
  const lifeLead = Number(snapshot.you.life || 0) - Number(snapshot.opponent.life || 0);
  const powerLead = Number(snapshot.you.power || 0) - Number(snapshot.opponent.power || 0);
  const creatureLead = Number(snapshot.you.creatures || 0) - Number(snapshot.opponent.creatures || 0);
  const boardLead = Number(snapshot.you.nonlands || 0) - Number(snapshot.opponent.nonlands || 0);
  const handLead = Number(snapshot.you.hand || 0) - Number(snapshot.opponent.hand || 0);
  return lifeLead * 0.4 + powerLead + creatureLead * 1.5 + boardLead * 0.5 + handLead * 0.25;
}

function effectiveRulesText(card) {
  return [
    card?.effectiveRulesText,
    card?.rulesText,
    ...(card?.abilitySourceCards || []).map((source) => source?.rulesText)
  ].filter(Boolean).join('\n');
}

function hasKeyword(card, keyword) {
  return new RegExp(`\\b${keyword}\\b`, 'i').test(effectiveRulesText(card));
}

function canBlockFlying(card) {
  return /\bCreature\b/i.test(String(card?.typeLine || ''))
    && !card?.tapped
    && (hasKeyword(card, 'flying') || hasKeyword(card, 'reach'));
}

function turningPointAnalysis(review) {
  const unavailable = (reason) => ({ detected: false, reason });
  if (!review || review.status === 'recording') return unavailable('Waiting for the game to finish.');
  if (review.won !== false) return unavailable('Conservative tactical turning points are currently limited to losses.');

  const choices = (review.combatChoices || []).filter((choice) => choice?.attackers?.length && choice?.board?.you);
  const damageEvents = (review.damageEvents || [])
    .filter((event) => event?.kind === 'damage' && Number(event.amount || 0) > 0 && event.sourceCard)
    .sort((left, right) => Number(right.turn || 0) - Number(left.turn || 0));
  if (!choices.length || !damageEvents.length) return unavailable('No complete attacker-choice and lethal-damage pair was recorded.');

  const trajectory = review.gameTrajectory || [];
  const localSeatId = Number(choices[0]?.localSeatId || 0);
  for (const lethal of damageEvents) {
    const lethalTurn = Number(lethal.turn || 0);
    const source = lethal.sourceCard;
    const hitYou = (lethal.affectedIds || []).some((id) => Number(id) === localSeatId);
    if (!hitYou || Number(source.ownerSeatId || source.controllerSeatId || 0) === localSeatId) continue;
    if (!hasKeyword(source, 'flying') || !hasKeyword(source, 'menace')) continue;

    const choice = choices
      .filter((entry) => Number(entry.turn || 0) === lethalTurn - 1)
      .sort((left, right) => String(right.id || '').localeCompare(String(left.id || '')))[0];
    if (!choice) continue;

    const postAttack = trajectory.find((snapshot) => Number(snapshot.gameTurn || 0) === Number(choice.turn));
    const yourLife = Number(choice.board.you.life ?? postAttack?.you?.life);
    const opponentLifeBefore = Number(choice.board.opponent?.life);
    const opponentLifeAfter = Number(postAttack?.opponent?.life);
    if (!Number.isFinite(yourLife) || yourLife <= 0 || Number(lethal.amount || 0) < yourLife) continue;
    if (!Number.isFinite(opponentLifeBefore) || !Number.isFinite(opponentLifeAfter)) continue;
    if (opponentLifeAfter <= 0 || opponentLifeAfter >= opponentLifeBefore) continue;

    const committedAerial = (choice.attackers || []).filter((card) => hasKeyword(card, 'flying') && !hasKeyword(card, 'vigilance'));
    const committedIds = new Set(committedAerial.map((card) => Number(card.stableId || card.instanceId || 0)).filter(Boolean));
    const aerialHeldBack = (choice.board.you.creatures || [])
      .filter(canBlockFlying)
      .filter((card) => !committedIds.has(Number(card.stableId || card.instanceId || 0)));
    const aerialBlockerIds = new Set([
      ...aerialHeldBack.map((card) => Number(card.stableId || card.instanceId || 0)),
      ...committedAerial.map((card) => Number(card.stableId || card.instanceId || 0))
    ].filter(Boolean));
    if (aerialBlockerIds.size < 2 || !committedAerial.length || aerialHeldBack.length >= 2) continue;

    const boardAhead = postAttack
      && Number(postAttack.you?.power || 0) >= Number(postAttack.opponent?.power || 0) + 4
      && Number(postAttack.you?.creatures || 0) >= Number(postAttack.opponent?.creatures || 0) + 1;
    if (!boardAhead) continue;

    const menaceSource = (source.abilitySourceCards || []).find((card) => hasKeyword(card, 'menace'));
    const attackerNames = [...new Set(committedAerial.map((card) => card.name).filter(Boolean))];
    const heldName = attackerNames.length === 1 ? attackerNames[0] : `${attackerNames.slice(0, -1).join(', ')} and ${attackerNames.at(-1)}`;
    const sourceName = source.name || 'the opposing flyer';
    const sourceSetup = menaceSource?.name ? `${menaceSource.name} gave ${sourceName} menace` : `${sourceName} gained menace`;
    return {
      detected: true,
      kind: 'tactical-exposure',
      confidence: 'HIGH · ACTION AND LETHAL LINE CONFIRMED',
      label: 'TACTICAL EXPOSURE',
      title: `Turn ${choice.turn}: the nonlethal attack opened the lethal lane`,
      summary: `At ${yourLife} life, attacking with ${heldName} reduced your available flying or reach blockers from ${aerialBlockerIds.size} to ${aerialHeldBack.length} and left the opponent at ${opponentLifeAfter}. On turn ${lethalTurn}, ${sourceSetup}; it dealt ${Number(lethal.amount)} unblocked damage for lethal.`,
      action: `Holding ${heldName} would have covered the opponent’s actual menace attack. This confirms the tactical exposure, not the eventual result of every possible future draw.`,
      evidence: {
        choiceTurn: Number(choice.turn),
        lethalTurn,
        yourLife,
        opponentLifeBefore,
        opponentLifeAfter,
        aerialBlockersBefore: aerialBlockerIds.size,
        aerialBlockersAfterAttack: aerialHeldBack.length,
        lethalDamage: Number(lethal.amount),
        attackerNames,
        lethalSource: sourceName,
        menaceSource: menaceSource?.name || null
      }
    };
  }

  return unavailable('No combat sequence crossed every conservative tactical threshold.');
}

function dominanceAnalysis(review) {
  const trajectory = (review.gameTrajectory || []).filter((snapshot) => snapshot?.you && snapshot?.opponent);
  if (!review.won || trajectory.length < 6) {
    return {
      available: trajectory.length >= 6,
      tier: 'none',
      headline: review.won ? 'Not enough trajectory evidence for a blowout call' : 'Blowout celebration applies only to wins'
    };
  }

  const first = trajectory[0];
  const final = trajectory.at(-1);
  const eligible = trajectory.filter((snapshot) => Number(snapshot.gameTurn || 0) >= 2);
  const scores = eligible.map(controlScore);
  const controlled = scores.filter((score) => score >= 2).length;
  const controlRate = eligible.length ? controlled / eligible.length : 0;
  const neverBehind = scores.every((score) => score >= -2.5);
  const minimumLife = Math.min(...trajectory.map((snapshot) => Number(snapshot.you.life ?? first.you.life ?? 0)));
  const yourLifeLost = Math.max(0, Number(first.you.life || 0) - Number(final.you.life || 0));
  const opponentLifeLost = Math.max(0, Number(first.opponent.life || 0) - Number(final.opponent.life || 0));
  const finalLifeLead = Number(final.you.life || 0) - Number(final.opponent.life || 0);
  const finalPowerLead = Number(final.you.power || 0) - Number(final.opponent.power || 0);
  const finalBoardLead = Number(final.you.nonlands || 0) - Number(final.opponent.nonlands || 0);
  const early = trajectory.filter((snapshot) => Number(snapshot.gameTurn || 0) <= 6).at(-1) || first;
  const earlyDamage = Math.max(0, Number(first.opponent.life || 0) - Number(early.opponent.life || 0));
  const concession = /concede/i.test(String(review.result?.reason || ''));
  const signals = [
    opponentLifeLost >= 12,
    finalLifeLead >= 8,
    finalPowerLead >= 4 || finalBoardLead >= 3,
    earlyDamage >= 6,
    yourLifeLost <= 4,
    concession
  ].filter(Boolean).length;
  const blowout = neverBehind
    && controlRate >= 0.75
    && minimumLife >= 10
    && signals >= 4
    && (finalPowerLead >= 4 || finalBoardLead >= 3);
  const decisive = !blowout && neverBehind && controlRate >= 0.6 && signals >= 3;

  return {
    available: true,
    tier: blowout ? 'blowout' : (decisive ? 'decisive' : 'competitive'),
    headline: blowout ? 'Wire-to-wire blowout' : (decisive ? 'Decisive win' : 'Competitive win'),
    neverBehind,
    controlRate: Math.round(controlRate * 100),
    trackedTurns: eligible.length,
    minimumLife,
    yourLifeLost,
    opponentLifeLost,
    earlyDamage,
    final: {
      yourLife: Number(final.you.life || 0),
      opponentLife: Number(final.opponent.life || 0),
      yourPower: Number(final.you.power || 0),
      opponentPower: Number(final.opponent.power || 0),
      yourNonlands: Number(final.you.nonlands || 0),
      opponentNonlands: Number(final.opponent.nonlands || 0),
      lifeLead: finalLifeLead,
      powerLead: finalPowerLead,
      boardLead: finalBoardLead
    },
    concession,
    detail: blowout
      ? `You never fell behind by Pick 42’s combined life, board, power, and hand-pressure measure; controlled ${Math.round(controlRate * 100)}% of tracked turns; and finished at ${Number(final.you.life || 0)} life to ${Number(final.opponent.life || 0)} with ${Number(final.you.nonlands || 0)} nonland permanents to ${Number(final.opponent.nonlands || 0)}.`
      : 'The win did not cross every conservative wire-to-wire threshold.'
  };
}

function inferredLocalSeatId(review) {
  const winnerSeatId = Number(review?.result?.winnerSeatId || 0);
  if (!winnerSeatId || typeof review?.won !== 'boolean') return 0;
  if (review.won) return winnerSeatId;
  return winnerSeatId === 1 ? 2 : 1;
}

function largestMultiBlock(review) {
  const localSeatId = inferredLocalSeatId(review);
  if (!localSeatId) return null;
  const groups = new Map();
  for (const event of review?.damageEvents || []) {
    const source = event?.sourceCard;
    if (event?.kind !== 'damage'
      || !/Blocking/i.test(String(source?.blockState || ''))
      || Number(source?.ownerSeatId || source?.controllerSeatId || 0) !== localSeatId) continue;
    for (const affectedId of event.affectedIds || []) {
      const key = `${Number(event.turn || 0)}:${affectedId}`;
      const current = groups.get(key) || { turn: Number(event.turn || 0), targetId: affectedId, blockers: new Map() };
      const blockerId = Number(source.stableId || source.instanceId || 0) || source.name;
      current.blockers.set(blockerId, source.name || 'a creature');
      groups.set(key, current);
    }
  }
  const best = [...groups.values()]
    .map((entry) => ({ ...entry, blockerNames: [...entry.blockers.values()], count: entry.blockers.size }))
    .sort((left, right) => right.count - left.count || right.turn - left.turn)[0];
  return best?.count >= 2 ? best : null;
}

function gameShapeAnalysis(review, dominance = dominanceAnalysis(review)) {
  const trajectory = (review?.gameTrajectory || []).filter((snapshot) => snapshot?.you && snapshot?.opponent);
  if (review?.status === 'recording' || trajectory.length < 10) {
    return {
      available: false,
      tier: 'unrated',
      label: 'UNRATED',
      headline: review?.status === 'recording' ? 'Game in progress' : 'Not enough trajectory evidence',
      detail: 'Pick 42 needs a longer board-state timeline before labeling the shape of a game.'
    };
  }

  const eligible = trajectory.filter((snapshot) => Number(snapshot.gameTurn || 0) >= 2);
  const start = Math.floor(eligible.length * 0.45);
  const end = Math.max(start + 1, eligible.length - 2);
  const pressureWindow = eligible.slice(start, end);
  const scores = pressureWindow.map(controlScore);
  const contested = scores.filter((score) => Math.abs(score) <= 4).length;
  const contestedRate = scores.length ? contested / scores.length : 0;
  const meaningfulSides = scores
    .map((score) => score >= 1.5 ? 1 : (score <= -1.5 ? -1 : 0))
    .filter(Boolean);
  const leadChanges = meaningfulSides.reduce((changes, side, index) => (
    index && side !== meaningfulSides[index - 1] ? changes + 1 : changes
  ), 0);
  const minimumScore = scores.length ? Math.min(...scores) : 0;
  const maximumScore = scores.length ? Math.max(...scores) : 0;
  const bothUnderPressure = pressureWindow.some((snapshot) => (
    Number(snapshot.you.life || 0) <= 8 && Number(snapshot.opponent.life || 0) <= 8
  ));
  const close = dominance?.tier !== 'blowout'
    && pressureWindow.length >= 4
    && ((contestedRate >= 0.5 && leadChanges >= 2 && minimumScore <= -2.5 && maximumScore >= 2.5)
      || (contestedRate >= 0.4 && bothUnderPressure && leadChanges >= 1));
  const multiBlock = largestMultiBlock(review);

  if (close) {
    const combatDetail = multiBlock?.count >= 3
      ? ` A ${multiBlock.count}-creature block was recorded on turn ${multiBlock.turn} during that contested stretch.`
      : '';
    return {
      available: true,
      tier: 'close',
      label: 'CLOSE',
      headline: 'Close game before the final swing',
      detail: `Pick 42’s combined life, board, power, and hand-pressure edge changed sides ${leadChanges} times in the middle-to-late game, with ${Math.round(contestedRate * 100)}% of that window staying near even.${combatDetail}`,
      leadChanges,
      contestedRate: Math.round(contestedRate * 100),
      multiBlock: multiBlock ? { turn: multiBlock.turn, count: multiBlock.count, blockerNames: multiBlock.blockerNames } : null
    };
  }

  const tier = dominance?.tier === 'blowout'
    ? 'blowout'
    : (dominance?.tier === 'decisive' ? 'decisive' : 'competitive');
  return {
    available: true,
    tier,
    label: tier === 'blowout' ? 'BLOWOUT' : (tier === 'decisive' ? 'DECISIVE' : 'COMPETITIVE'),
    headline: tier === 'blowout' ? 'The victory was never in doubt' : (tier === 'decisive' ? 'A controlled win' : 'No conservative close-game flag'),
    detail: tier === 'blowout'
      ? dominance.detail
      : `The middle-to-late pressure window changed sides ${leadChanges} time${leadChanges === 1 ? '' : 's'}, with ${Math.round(contestedRate * 100)}% of snapshots near even; that did not cross every close-game threshold.`,
    leadChanges,
    contestedRate: Math.round(contestedRate * 100),
    multiBlock: multiBlock ? { turn: multiBlock.turn, count: multiBlock.count, blockerNames: multiBlock.blockerNames } : null
  };
}

function celebrateBlowout(review, dominance, baseVerdict, series) {
  if (dominance?.tier !== 'blowout') return baseVerdict;
  const seriesScope = Boolean(series?.verdict);
  const context = seriesScope ? `${series.record}, and this one was never close.` : 'That one was never close.';
  const analyticalAction = baseVerdict?.tone === 'change' || baseVerdict?.tone === 'caution'
    ? `Take the victory lap. ${baseVerdict.action}`
    : `Take the victory lap. Keep running this exact build.`;
  const setup = review.onPlay === false
    ? `You did it on the draw${Number(review.mulligans || 0) ? ` after ${review.mulligans} mulligan${review.mulligans === 1 ? '' : 's'}` : ''}. `
    : (Number(review.mulligans || 0) ? `You did it after ${review.mulligans} mulligan${review.mulligans === 1 ? '' : 's'}. ` : '');
  return {
    scope: seriesScope ? 'series' : 'game',
    tone: 'celebration',
    label: 'ABSOLUTE DESTRUCTION',
    title: context,
    summary: `${setup}${dominance.detail} ${review.result?.reason === 'Concede' ? 'The opponent conceded before the final blow.' : 'The game ended with that control intact.'}`,
    action: analyticalAction
  };
}

// A loss conceded within the first few of the player's turns reads as an abandoned
// game (an interruption, a misclick queue), not a test of the deck.
function isEarlyConcession(review) {
  if (review?.won !== false) return false;
  if (!/concede/i.test(String(review.result?.reason || ''))) return false;
  return Number(review.yourTurnsObserved ?? Number.POSITIVE_INFINITY) <= 4;
}

function verdictAnalysis(review, { variance, drawQuality, contributions }) {
  if (review.status === 'recording' || review.won === null || review.won === undefined) {
    return {
      tone: 'neutral',
      label: 'IN PROGRESS',
      title: 'Verdict pending',
      summary: 'Pick 42 will weigh the result, mana variance, IIH draw quality, and observable card contribution when the game ends.',
      action: 'Keep playing.'
    };
  }

  if (isEarlyConcession(review)) {
    return {
      tone: 'retry',
      label: 'LIMITED EVIDENCE',
      title: 'Early concession.',
      summary: 'You conceded within your first few turns, so this game says almost nothing about the deck. The loss still counts toward the event record.',
      action: 'Run it back when you can play a full game.'
    };
  }

  const won = review.won === true;
  const yourVariance = variance?.you || { level: 'LOW', kind: 'stable' };
  const opponentVariance = variance?.opponent || { level: 'LOW', kind: 'stable' };
  const tier = drawQuality?.tier || 'unrated';
  const topEvidence = drawQuality?.topCount
    ? `${drawQuality.topDrawnCount} of ${drawQuality.topCount} top-IIH cards`
    : 'insufficient IIH coverage';
  const drawPhrase = ({
    'near-ceiling': `a near-ceiling draw (${topEvidence})`,
    exceptional: `an exceptional draw (${topEvidence})`,
    strong: `a strong draw (${topEvidence})`,
    average: `an average draw (${topEvidence})`,
    rough: `a rough draw (${topEvidence})`,
    unrated: 'a draw that could not be fully rated'
  })[tier] || 'a draw that could not be fully rated';
  const lvp = contributions?.lvp?.[0] || null;
  const suggestion = review.suggestion;
  const changeAction = suggestion && suggestion.kind !== 'hold'
    ? `${suggestion.title}. Treat it as a one-game test, not a permanent cut.`
    : (lvp ? `Review ${lvp.name}, but collect another game before making a permanent cut.` : 'Run it back before changing the list.');

  const turningPoint = turningPointAnalysis(review);
  if (!won && turningPoint.detected) {
    return {
      tone: 'retry',
      label: 'RUN IT BACK',
      title: 'Loss with a confirmed tactical turning point.',
      summary: `${turningPoint.title}. The recorded action and immediately following lethal line are a stronger explanation for this result than a deck-level conclusion.`,
      action: 'Keep the current build. Treat this game as tactical evidence, not a reason to cut a card.'
    };
  }

  if (!won && ['HIGH', 'MODERATE'].includes(yourVariance.level) && ['flooded', 'starved'].includes(yourVariance.kind)) {
    return {
      tone: 'retry',
      label: 'RUN IT BACK',
      title: `Loss, but your mana was ${yourVariance.kind}.`,
      summary: `You lost with ${drawPhrase}, but your mana crossed Pick 42’s ${yourVariance.level.toLowerCase()} ${yourVariance.kind === 'flooded' ? 'flood' : 'starvation'} threshold. That is the clearest factual distortion in this game.`,
      action: 'Keep the current build and run it back.'
    };
  }

  if (won && opponentVariance.level === 'HIGH' && ['flooded', 'starved'].includes(opponentVariance.kind)) {
    return {
      tone: 'caution',
      label: 'TEMPER EXPECTATIONS',
      title: `Win, but the opponent was ${opponentVariance.kind}.`,
      summary: `You won with ${drawPhrase}. The opponent also crossed Pick 42’s high ${opponentVariance.kind === 'flooded' ? 'flood' : 'mana-starvation'} threshold, so this result likely says less about the build than a normal game would.`,
      action: 'Bank the win, then run it back before changing or celebrating the list.'
    };
  }

  if (won && ['near-ceiling', 'exceptional'].includes(tier)) {
    return {
      tone: 'caution',
      label: 'TEMPER EXPECTATIONS',
      title: `Win with ${tier === 'near-ceiling' ? 'a near-ceiling' : 'an exceptional'} draw.`,
      summary: `You won and saw ${topEvidence}. That is an unusually favorable draw for this deck, so do not assume the same card quality will show up next game.`,
      action: 'Proceed, but run it back before drawing conclusions about the build.'
    };
  }

  if (won && ['HIGH', 'MODERATE'].includes(yourVariance.level) && ['flooded', 'starved'].includes(yourVariance.kind)) {
    return {
      tone: 'positive',
      label: 'RESILIENT WIN',
      title: `Win despite being ${yourVariance.kind}.`,
      summary: `You won with ${drawPhrase} even though your mana crossed Pick 42’s ${yourVariance.level.toLowerCase()} variance threshold.`,
      action: 'Keep the current build and run it back.'
    };
  }

  if (won) {
    return {
      tone: 'positive',
      label: 'RUN IT BACK',
      title: `Win with ${drawPhrase}.`,
      summary: 'No major mana-variance signal undermined the result, and this game did not produce a strong reason to change the deck.',
      action: 'Nice. Keep the current build and run it back.'
    };
  }

  if (['near-ceiling', 'exceptional', 'strong'].includes(tier) && lvp) {
    return {
      tone: 'change',
      label: 'TEST A CHANGE',
      title: `Loss despite ${drawPhrase}.`,
      summary: `${lvp.name} was the clearest supported underperformance signal: ${lvp.detail}`,
      action: changeAction
    };
  }

  if (lvp) {
    return {
      tone: 'change',
      label: 'TEST A CHANGE',
      title: 'Loss with no major variance excuse.',
      summary: `The draw was ${tier === 'unrated' ? 'not fully rated' : tier}, and ${lvp.name} was the clearest supported underperformance signal: ${lvp.detail}`,
      action: changeAction
    };
  }

  return {
    tone: 'retry',
    label: 'RUN IT BACK',
    title: `Loss with ${drawPhrase}.`,
    summary: 'No single card or mana pattern produced enough negative evidence to justify a change after one game.',
    action: 'Keep the current build and run it back once more.'
  };
}

function reviewVersionKey(review) {
  if (!review?.draftId || Number(review.deck?.total || 0) < 35) return null;
  const fingerprint = review.deck?.fingerprint || deckFingerprint(review.deck);
  return `${review.draftId}:${fingerprint}`;
}

function seriesVerdictAnalysis(series) {
  const { games, wins, losses, record } = series;
  const repeatedLvp = series.repeatedLvp;

  if (losses >= 2 && series.varianceLosses >= Math.ceil(losses * 0.67)) {
    return {
      scope: 'series',
      tone: 'retry',
      label: 'RUN IT BACK',
      title: `${record}: the losses were variance-heavy.`,
      summary: `Your mana crossed a flood or starvation threshold in ${series.varianceLosses} of ${losses} losses. Across this deck version, mana variance remains a stronger explanation than any individual card.`,
      action: 'Keep the current build for another game before making a cut.'
    };
  }

  if (repeatedLvp?.count >= 2) {
    return {
      scope: 'series',
      tone: 'change',
      label: 'TEST A CHANGE',
      title: `${repeatedLvp.name} underperformed repeatedly.`,
      summary: `${repeatedLvp.name} was an evidence-backed LVP in ${repeatedLvp.count} of ${games} games without a major mana-variance excuse. That repeat is more actionable than a one-game miss.`,
      action: series.changeSuggestion
        ? `${series.changeSuggestion.title}. This is now a multi-game test, but still reversible.`
        : `Try one game with ${repeatedLvp.name} out of the deck and compare the result.`
    };
  }

  if (wins / games >= 0.67) {
    const favorableWins = series.exceptionalWins + series.opponentVarianceWins;
    if (favorableWins >= Math.max(1, Math.ceil(wins * 0.67))) {
      return {
        scope: 'series',
        tone: 'caution',
        label: 'TEMPER EXPECTATIONS',
        title: `${record}, with unusually favorable conditions.`,
        summary: `${favorableWins} of ${wins} wins included either an exceptional top-IIH draw or high opponent mana variance. The record is good, but the conditions have been friendlier than normal.`,
        action: 'Keep playing this version, but expect the record to normalize.'
      };
    }
    return {
      scope: 'series',
      tone: 'positive',
      label: 'KEEP RUNNING IT',
      title: `${record} with no repeated warning sign.`,
      summary: `This exact deck version has won ${wins} of ${games} games, and no card has produced repeatable negative evidence.`,
      action: 'Stay with the current build.'
    };
  }

  if (losses / games >= 0.67) {
    if (series.strongDrawLosses >= Math.max(1, Math.ceil(losses * 0.67))) {
      return {
        scope: 'series',
        tone: 'caution',
        label: 'DECK UNDER REVIEW',
        title: `${record} despite generally strong draws.`,
        summary: `${series.strongDrawLosses} of ${losses} losses came with strong-or-better IIH draws, but no single card has underperformed repeatedly enough to prescribe a clean swap.`,
        action: 'Play one more game before changing the list; another clean loss would be meaningful.'
      };
    }
    return {
      scope: 'series',
      tone: 'retry',
      label: 'COLLECT ONE MORE',
      title: `${record}, but no clean cause yet.`,
      summary: 'The losses are accumulating, but they do not share a strong mana, draw-quality, or card-specific signal yet.',
      action: 'Run it back once more instead of making a blind cut.'
    };
  }

  return {
    scope: 'series',
    tone: 'neutral',
    label: 'STAY THE COURSE',
    title: `${record} with mixed evidence.`,
    summary: `Across ${games} games, neither the results nor the repeated card signals justify changing this exact deck version yet.`,
    action: 'Keep the current build and collect another game.'
  };
}

function reviewSeriesAnalysis(review, relatedReviews, seventeenLands) {
  const versionKey = reviewVersionKey(review);
  if (!versionKey) return null;
  const unique = new Map();
  for (const candidate of [review, ...(relatedReviews || [])]) {
    if (candidate?.id && reviewVersionKey(candidate) === versionKey) unique.set(candidate.id, candidate);
  }
  const completed = [...unique.values()]
    .filter((candidate) => candidate.status === 'complete' && typeof candidate.won === 'boolean')
    .sort((left, right) => String(left.completedAt || '').localeCompare(String(right.completedAt || '')));
  if (!completed.length) {
    return {
      games: 0,
      wins: 0,
      losses: 0,
      record: '0–0',
      versionKey,
      sameDeckVersion: true,
      verdict: null
    };
  }

  // Early concessions keep their place in the record but contribute no card-level
  // evidence: an abandoned game must not feed repeated-signal conclusions.
  const entries = completed.filter((candidate) => !isEarlyConcession(candidate)).map((candidate) => ({
    review: candidate,
    variance: varianceAnalysis(candidate),
    drawQuality: drawQualityAnalysis(candidate, seventeenLands),
    contributions: contributionAnalysis(candidate),
    turningPoint: turningPointAnalysis(candidate)
  }));
  const wins = completed.filter((candidate) => candidate.won).length;
  const losses = completed.length - wins;
  const lvpCounts = new Map();
  for (const entry of entries) {
    if (entry.variance.you.level !== 'LOW' || entry.turningPoint.detected) continue;
    for (const card of entry.contributions.lvp) {
      const key = normalizeCardName(card.name);
      const current = lvpCounts.get(key) || { name: card.name, count: 0 };
      current.count += 1;
      lvpCounts.set(key, current);
    }
  }
  const repeatedLvp = [...lvpCounts.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))[0] || null;
  const relevantSuggestion = repeatedLvp
    ? completed.slice().reverse().find((candidate) => candidate.suggestion?.kind !== 'hold' && normalizeCardName(candidate.suggestion?.title).includes(normalizeCardName(repeatedLvp.name)))?.suggestion
    : null;
  const summary = {
    games: completed.length,
    wins,
    losses,
    record: `${wins}–${losses}`,
    versionKey,
    sameDeckVersion: true,
    yourManaVarianceGames: entries.filter((entry) => entry.variance.you.level !== 'LOW').length,
    opponentManaVarianceGames: entries.filter((entry) => entry.variance.opponent.level !== 'LOW').length,
    varianceLosses: entries.filter((entry) => !entry.review.won && entry.variance.you.level !== 'LOW').length,
    exceptionalWins: entries.filter((entry) => entry.review.won && ['near-ceiling', 'exceptional'].includes(entry.drawQuality.tier)).length,
    opponentVarianceWins: entries.filter((entry) => entry.review.won && entry.variance.opponent.level === 'HIGH').length,
    tacticalLosses: entries.filter((entry) => !entry.review.won && entry.turningPoint.detected).length,
    strongDrawLosses: entries.filter((entry) => !entry.review.won && !entry.turningPoint.detected && ['near-ceiling', 'exceptional', 'strong'].includes(entry.drawQuality.tier)).length,
    drawTiers: entries.reduce((counts, entry) => ({ ...counts, [entry.drawQuality.tier]: (counts[entry.drawQuality.tier] || 0) + 1 }), {}),
    repeatedLvp: repeatedLvp?.count >= 2 ? repeatedLvp : null,
    abandonedLosses: completed.filter((candidate) => isEarlyConcession(candidate)).length,
    changeSuggestion: relevantSuggestion || null
  };
  return {
    ...summary,
    verdict: completed.length >= 2 ? seriesVerdictAnalysis(summary) : null
  };
}

const BASIC_LAND_NAMES = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']);

// Factual diff between the deck Arena registered and the Pick 42 build that was
// recommended when the review was armed. Reported for context only: a result never
// turns a deviation into evidence by itself.
function buildDeviationAnalysis(deck) {
  const modeled = deck?.modeledBuild;
  if (!modeled?.cards || !Array.isArray(deck?.cards)) return null;
  if (deck.source !== 'Arena course deck') {
    return { comparable: false, differs: false, modeledName: modeled.name, added: [], cut: [], basics: [] };
  }
  const played = {};
  for (const card of [...(deck.cards || []), ...(deck.lands || [])]) {
    played[card.name] = (played[card.name] || 0) + Number(card.quantity || 1);
  }
  const names = new Set([...Object.keys(played), ...Object.keys(modeled.cards)]);
  const added = [];
  const cut = [];
  const basics = [];
  for (const name of names) {
    const delta = (played[name] || 0) - (Number(modeled.cards[name]) || 0);
    if (!delta) continue;
    if (BASIC_LAND_NAMES.has(name)) {
      basics.push({ name, delta });
    } else if (delta > 0) {
      added.push({ name, quantity: delta });
    } else {
      cut.push({ name, quantity: -delta });
    }
  }
  const differs = added.length > 0 || cut.length > 0 || basics.length > 0;
  return { comparable: true, differs, modeledName: modeled.name, modeledScore: modeled.score ?? null, added, cut, basics };
}

function deviationPhrase(deviation) {
  const parts = [];
  if (deviation.added.length) parts.push(`+${deviation.added.map((entry) => `${entry.quantity > 1 ? `${entry.quantity}× ` : ''}${entry.name}`).join(', +')}`);
  if (deviation.cut.length) parts.push(`−${deviation.cut.map((entry) => `${entry.quantity > 1 ? `${entry.quantity}× ` : ''}${entry.name}`).join(', −')}`);
  if (deviation.basics.length) parts.push(deviation.basics.map((entry) => `${entry.delta > 0 ? '+' : ''}${entry.delta} ${entry.name}`).join(', '));
  return parts.join(' · ');
}

function applyDeviationToVerdict(verdict, review, deviation, contributions) {
  if (!deviation?.comparable || !deviation.differs || !verdict) return verdict;
  const next = { ...verdict, deviation: { ...deviation, phrase: deviationPhrase(deviation) } };
  if (review.won !== false || isEarlyConcession(review)) return next;
  const addedNames = new Set(deviation.added.map((entry) => entry.name));
  const lvp = contributions?.lvp?.[0] || null;
  const restore = deviation.cut[0]?.name || null;
  if (lvp && addedNames.has(lvp.name)) {
    // The clearest negative evidence points at a card the player added over the model.
    next.action = `Try one game with ${lvp.name} out${restore ? ` and ${restore} back in` : ''} — that returns you toward the modeled ${deviation.modeledName} build.`;
    next.summary = `${next.summary} ${lvp.name} was also one of your changes to the modeled build.`;
  } else if (deviation.added[0] && restore) {
    next.action = `${next.action} If you want a reversible test, restore ${restore} for ${deviation.added[0].name} to move back toward the modeled ${deviation.modeledName} build — one loss alone is not evidence against your changes.`;
  }
  return next;
}

// Losses that end an Arena limited event, by normalized format.
const EVENT_LOSS_CAPS = { premier: 3, quick: 3, 'pick-two': 2, traditional: null };

// Groups completed reviews into their drafts, numbers games per draft, and derives
// the event record with format-aware trophy and elimination states. Records count
// recorded games only, so a game played while Pick 42 was closed is not invented.
function reviewEventGroups(reviews, { currentDraftId = null, currentFormat = null } = {}) {
  const groups = new Map();
  for (const review of reviews || []) {
    const key = String(review?.draftId || 'unknown-draft');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(review);
  }

  const result = [];
  for (const [draftId, games] of groups.entries()) {
    const ordered = [...games].sort((left, right) => String(left.completedAt || '').localeCompare(String(right.completedAt || '')));
    const isCurrent = Boolean(currentDraftId) && draftId === String(currentDraftId);
    const formatText = ordered.find((game) => game.format)?.format || (isCurrent ? currentFormat : null);
    const format = formatText ? normalizeFormat(formatText) : null;
    const winsTarget = format ? trophyThreshold(format) : null;
    const lossCap = format ? EVENT_LOSS_CAPS[format] ?? null : null;

    let wins;
    let losses;
    if (format === 'traditional') {
      const matches = new Map();
      for (const game of ordered) {
        const matchKey = String(game.matchId || game.id);
        if (!matches.has(matchKey)) matches.set(matchKey, { wins: 0, losses: 0 });
        if (game.won === true) matches.get(matchKey).wins += 1;
        else if (game.won === false) matches.get(matchKey).losses += 1;
      }
      wins = [...matches.values()].filter((match) => match.wins > match.losses).length;
      losses = matches.size - wins;
    } else {
      wins = ordered.filter((game) => game.won === true).length;
      losses = ordered.filter((game) => game.won === false).length;
    }

    const trophy = winsTarget !== null && wins >= winsTarget;
    const eliminated = !trophy && lossCap !== null && losses >= lossCap;
    result.push({
      draftId,
      name: [...ordered].reverse().find((game) => game.deck?.name)?.deck?.name || 'Limited deck',
      format,
      formatLabel: formatText || null,
      wins,
      losses,
      record: `${wins}-${losses}`,
      trophy,
      eliminated,
      status: trophy ? 'trophy' : (eliminated ? 'eliminated' : (isCurrent ? 'live' : 'ended')),
      isCurrent,
      latestAt: ordered.length ? String(ordered[ordered.length - 1].completedAt || '') : '',
      games: ordered.map((game, index) => ({ ...game, draftGameNumber: index + 1, earlyConcession: isEarlyConcession(game) }))
    });
  }

  return result.sort((left, right) => right.latestAt.localeCompare(left.latestAt));
}

function analyzePostGameReview(review, { seventeenLands = [], relatedReviews = [] } = {}) {
  if (!review) return null;
  const variance = varianceAnalysis(review);
  const drawQuality = drawQualityAnalysis(review, seventeenLands);
  const contributions = contributionAnalysis(review);
  const dominance = dominanceAnalysis(review);
  const gameShape = gameShapeAnalysis(review, dominance);
  const turningPoint = turningPointAnalysis(review);
  const buildDeviation = buildDeviationAnalysis(review.deck);
  const series = reviewSeriesAnalysis(review, relatedReviews, seventeenLands);
  const gameVerdict = verdictAnalysis(review, { variance, drawQuality, contributions });
  const baseVerdict = series?.verdict || {
    ...gameVerdict,
    scope: 'game'
  };
  const verdict = applyDeviationToVerdict(celebrateBlowout(review, dominance, baseVerdict, series), review, buildDeviation, contributions);
  return {
    ...review,
    postGame: {
      variance,
      drawQuality,
      contributions,
      dominance,
      gameShape,
      turningPoint,
      buildDeviation,
      gameVerdict,
      series,
      verdict
    }
  };
}

function reviewSuggestion(record, stranded) {
  const colorIssue = stranded.find((entry) => entry.kind === 'color' && entry.turns >= 2 && entry.missingColors.length === 1);
  if (colorIssue && record.deck?.mana?.sources) {
    const missing = colorIssue.missingColors[0];
    const sources = record.deck.mana.sources;
    const targets = record.deck.mana.targets || {};
    const donor = Object.keys(sources)
      .filter((color) => color !== missing && Number(sources[color]) > Number(targets[color] || 0))
      .sort((a, b) => (sources[b] - (targets[b] || 0)) - (sources[a] - (targets[a] || 0)))[0];
    if (donor && COLOR_NAMES[missing] && COLOR_NAMES[donor]) {
      return {
        kind: 'land-swap',
        confidence: 'LOW · ONE GAME',
        title: `Test +1 ${COLOR_NAMES[missing]} / −1 ${COLOR_NAMES[donor]}`,
        detail: `${colorIssue.name} was observed without ${missing} mana across ${colorIssue.turns} of your turns despite enough total mana. The modeled ${donor} base has one source above target.`,
        evidence: `${colorIssue.turns} color-stranded turns · ${sources[missing] || 0} modeled ${missing} sources`
      };
    }
  }

  const curveIssue = stranded.find((entry) => entry.kind === 'curve' && entry.turns >= 3 && entry.manaValue >= 4);
  if (curveIssue) {
    const sources = record.deck?.mana?.sources || {};
    const replacement = [...(record.deck?.cuts || [])]
      .filter((card) => (
        !isLand(card)
        && manaValue(card.manaCost) <= curveIssue.manaValue - 2
        && castableByManaBase(card, sources)
        && Number.isFinite(Number(card.deckValue))
      ))
      .sort((a, b) => Number(b.deckValue) - Number(a.deckValue) || manaValue(a.manaCost) - manaValue(b.manaCost))[0];
    if (replacement) {
      const colors = Object.entries(sources).filter(([, count]) => Number(count) > 0).map(([color]) => color).join('/');
      return {
        kind: 'card-swap',
        confidence: 'LOW · ONE GAME',
        title: `Test ${replacement.name} over ${curveIssue.name}`,
        detail: `${curveIssue.name} remained uncast for ${curveIssue.turns} of your turns while the deck developed mana. ${replacement.name} lowers the curve and is castable from the registered ${colors || 'colorless'} mana base.`,
        evidence: `${curveIssue.turns} curve-stranded turns · ${curveIssue.manaValue} mana value · ${Number(replacement.deckValue).toFixed(1)} deck score`
      };
    }
  }

  return {
    kind: 'hold',
    confidence: 'LOW · ONE GAME',
    title: 'Hold the current build',
    detail: 'This game did not produce a strong, repeatable mana or curve signal. One result is useful evidence, but not enough reason to force a card change.',
    evidence: 'No card was reliably stranded across multiple turns'
  };
}

function reanalyzePersistedReview(review) {
  const next = clone(review);
  if (Number(next.analysisVersion || 0) >= ANALYSIS_VERSION) return next;
  const conditionalNames = new Set((next.deck?.cards || [])
    .filter(hasConditionalCostReduction)
    .map((card) => card.name));
  const excluded = (next.stranded || []).filter((entry) => entry.kind === 'curve' && conditionalNames.has(entry.name));
  next.stranded = (next.stranded || []).filter((entry) => !(entry.kind === 'curve' && conditionalNames.has(entry.name)));
  next.observations = (next.observations || []).filter((fact) => !excluded.some((entry) => fact.includes(entry.name) && /stranded/i.test(fact)));
  for (const entry of excluded) {
    next.observations.push(`${entry.name} was excluded from curve evidence because its conditional cost reduction could not be verified from the recorded state.`);
  }
  next.suggestion = reviewSuggestion({ deck: next.deck }, next.stranded);
  next.analysisVersion = ANALYSIS_VERSION;
  return next;
}

function replaceRebuiltReviewInPlace(reviews, legacy, rebuilt) {
  if (!Array.isArray(reviews) || !legacy?.id || !rebuilt || rebuilt.id !== legacy.id) return reviews;
  return reviews.map((review) => review.id === legacy.id
    ? {
        ...rebuilt,
        startedAt: legacy.startedAt || rebuilt.startedAt,
        completedAt: legacy.completedAt || rebuilt.completedAt
      }
    : review);
}

class GameReviewTracker extends EventEmitter {
  constructor({ maxReviews = 12 } = {}) {
    super();
    this.maxReviews = maxReviews;
    this.reviews = [];
    this.completedKeys = new Set();
    this.armed = false;
    this.context = null;
    this.current = null;
    this.lastIgnored = null;
  }

  hydrate(reviews) {
    this.reviews = Array.isArray(reviews)
      ? reviews
          .filter((review) => !reviewClearlyMismatchesDeck(review))
          .map(reanalyzePersistedReview)
          .sort((left, right) => String(right.completedAt || right.startedAt || '').localeCompare(String(left.completedAt || left.startedAt || '')))
          .slice(0, this.maxReviews)
      : [];
    this.completedKeys = new Set(this.reviews.map((review) => review.id));
    this.#emit();
  }

  arm(context = {}) {
    this.armed = true;
    this.context = clone(context);
    this.current = null;
    this.lastIgnored = null;
    this.#emit();
  }

  disarm() {
    this.armed = false;
    this.current = null;
    this.lastIgnored = null;
    this.#emit();
  }

  ignore(state, context = null, reason = 'This game does not match the registered draft deck.') {
    if (!this.armed || !state?.matchId) return;
    const nextContext = context || this.context || {};
    this.lastIgnored = {
      id: `${state.matchId}:${state.gameNumber ?? 1}`,
      matchId: state.matchId,
      gameNumber: state.gameNumber ?? 1,
      deckName: nextContext.deck?.name || 'Limited deck',
      reason
    };
    this.#emit();
  }

  consume(state, context = null) {
    if (!this.armed || !state?.matchId || state.gameNumber === null || state.gameNumber === undefined) return;
    const nextContext = context || this.context || {};
    if (!this.current && Number(nextContext.deck?.total || 0) < 35) return;
    const id = `${state.matchId}:${state.gameNumber}`;
    if (this.completedKeys.has(id)) return;

    if (!this.current || this.current.id !== id) {
      this.lastIgnored = null;
      this.current = this.#startRecord(state, nextContext);
    }
    this.#updateRecord(this.current, state);
    if (state.complete) this.#completeCurrent();
    else this.#emit();
  }

  snapshot() {
    const active = this.current ? this.#summarize(this.current, false) : null;
    const latest = active || this.reviews[0] || null;
    return {
      armed: this.armed,
      status: active ? 'recording' : (this.reviews.length ? 'ready' : (this.armed ? 'waiting' : 'off')),
      message: active
        ? `Recording game ${active.gameNumber} · turn ${active.turns || 0}`
        : (this.lastIgnored
          ? `Ignored a game that did not match ${this.lastIgnored.deckName}`
          : (this.armed ? 'Ready for your next Arena game' : 'Game review is off while sample data is active')),
      lastIgnored: clone(this.lastIgnored),
      active,
      latest,
      reviews: clone(this.reviews)
    };
  }

  #startRecord(state, context) {
    const localPlayer = state.players?.find((player) => player.seatId === state.localSeatId);
    return {
      id: `${state.matchId}:${state.gameNumber}`,
      matchId: state.matchId,
      gameNumber: state.gameNumber,
      localSeatId: state.localSeatId,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      draftId: context.draftId || null,
      setCode: context.setCode || null,
      format: context.format || null,
      deck: context.deck ? { ...clone(context.deck), fingerprint: deckFingerprint(context.deck) } : null,
      openingHand: [],
      openingHandFrozen: false,
      mulligans: localPlayer?.mulligans ?? null,
      onPlay: null,
      maxTurn: 0,
      cardsSeen: new Map(),
      drawnCards: new Map(),
      playedCards: new Map(),
      opponentCardsSeen: new Map(),
      opponentPlayedCards: new Map(),
      combatChoices: new Map(),
      damageEvents: new Map(),
      processedEventIds: new Set(),
      opponentColors: new Set(),
      turnObservations: new Map(),
      seatTurnObservations: new Map(),
      gameTimeline: new Map(),
      result: null
    };
  }

  #updateRecord(record, state) {
    record.updatedAt = new Date().toISOString();
    record.maxTurn = Math.max(record.maxTurn, Number(state.turn?.number || 0));
    record.result = state.result || record.result;
    const localPlayer = state.players?.find((player) => player.seatId === state.localSeatId);
    if (localPlayer?.mulligans !== null && localPlayer?.mulligans !== undefined) record.mulligans = localPlayer.mulligans;

    if (record.onPlay === null && Number(state.turn?.number) === 1 && state.turn?.activeSeatId) {
      record.onPlay = Number(state.turn.activeSeatId) === Number(state.localSeatId);
    }

    const gameTurn = Number(state.turn?.number || 0);
    if (gameTurn > 0) {
      const opponentSeatId = (state.players || []).find((player) => Number(player.seatId) !== Number(state.localSeatId))?.seatId
        || (Number(state.localSeatId) === 1 ? 2 : 1);
      const boardSnapshot = (seatId) => {
        const cards = (state.battlefield || []).filter((card) => Number(card.controllerSeatId) === Number(seatId));
        const creatures = cards.filter((card) => /\bCreature\b/i.test(String(card.typeLine || '')));
        const zone = (state.zones || []).find((entry) => Number(entry.seatId) === Number(seatId)) || {};
        const player = (state.players || []).find((entry) => Number(entry.seatId) === Number(seatId)) || {};
        return {
          life: player.life ?? null,
          hand: Number(zone.hand || 0),
          lands: cards.filter(isLand).length,
          nonlands: cards.filter((card) => !isLand(card)).length,
          creatures: creatures.length,
          power: creatures.reduce((total, card) => total + Math.max(0, Number(card.power || 0)), 0)
        };
      };
      record.gameTimeline.set(gameTurn, {
        gameTurn,
        activeSeatId: Number(state.turn?.activeSeatId || 0) || null,
        you: boardSnapshot(state.localSeatId),
        opponent: boardSnapshot(opponentSeatId)
      });
    }

    const earlyGame = Number(state.turn?.number || 0) <= 1;
    if (!record.openingHandFrozen && earlyGame && state.hand?.length) {
      record.openingHand = clone(state.hand);
      if (!/Mulligan/i.test(String(state.stage || '')) && Number(state.turn?.number || 0) >= 1) record.openingHandFrozen = true;
    }

    for (const card of state.hand || []) record.drawnCards.set(cardKey(card), clone(card));

    const localCards = [
      ...(state.hand || []),
      ...(state.graveyard || []),
      ...(state.exile || []),
      ...(state.stack || []).filter((card) => Number(card.ownerSeatId) === Number(state.localSeatId)),
      ...(state.battlefield || []).filter((card) => Number(card.ownerSeatId) === Number(state.localSeatId))
    ];
    for (const card of localCards) record.cardsSeen.set(cardKey(card), clone(card));

    const playedNow = [
      ...(state.stack || []).filter((card) => Number(card.ownerSeatId) === Number(state.localSeatId)),
      ...(state.battlefield || []).filter((card) => Number(card.ownerSeatId) === Number(state.localSeatId))
    ].filter((card) => !isLand(card) && (!card.objectType || card.objectType === 'GameObjectType_Card'));
    const battlefieldKeys = new Set((state.battlefield || [])
      .filter((card) => Number(card.ownerSeatId) === Number(state.localSeatId))
      .map(cardKey));
    for (const [key, entry] of record.playedCards) entry.endedOnBattlefield = battlefieldKeys.has(key);
    for (const card of playedNow) {
      const key = cardKey(card);
      const current = record.playedCards.get(key) || {
        card: clone(card),
        firstTurn: Number(state.turn?.number || 0),
        turnsInPlay: new Set(),
        damage: 0,
        playerDamage: 0,
        endedOnBattlefield: false
      };
      current.card = clone(card);
      if (battlefieldKeys.has(key)) current.turnsInPlay.add(Number(state.turn?.number || 0));
      current.endedOnBattlefield = battlefieldKeys.has(key);
      record.playedCards.set(key, current);
    }

    for (const event of state.events || []) {
      if (!event?.id || record.processedEventIds.has(event.id)) continue;
      record.processedEventIds.add(event.id);
      if (event.kind === 'damage') record.damageEvents.set(event.id, clone(event));
      const source = event.sourceCard;
      if (event.kind !== 'damage' || !source || Number(source.ownerSeatId) !== Number(state.localSeatId) || source.objectType === 'GameObjectType_Token' || source.objectType === 'GameObjectType_Ability') continue;
      const key = cardKey(source);
      const current = record.playedCards.get(key) || {
        card: clone(source),
        firstTurn: Number(event.turn || state.turn?.number || 0),
        turnsInPlay: new Set(),
        damage: 0,
        playerDamage: 0,
        endedOnBattlefield: false
      };
      current.damage += Number(event.amount || 0);
      const opponentSeats = (state.players || []).map((player) => Number(player.seatId)).filter((seatId) => seatId && seatId !== Number(state.localSeatId));
      if ((event.affectedIds || []).some((id) => opponentSeats.includes(Number(id)))) current.playerDamage += Number(event.amount || 0);
      record.playedCards.set(key, current);
    }

    for (const choice of state.combatChoices || []) {
      if (choice?.id) record.combatChoices.set(choice.id, clone(choice));
    }

    for (const card of state.visibleOpponentCards || state.knownOpponentCards || []) {
      for (const color of cardColors(card)) record.opponentColors.add(color);
      record.opponentCardsSeen.set(cardKey(card), clone(card));
    }
    for (const card of [
      ...(state.stack || []),
      ...(state.battlefield || [])
    ]) {
      if (Number(card.ownerSeatId) === Number(state.localSeatId) || isLand(card)) continue;
      if (card.objectType && card.objectType !== 'GameObjectType_Card') continue;
      record.opponentPlayedCards.set(cardKey(card), clone(card));
    }

    const activeSeatId = Number(state.turn?.activeSeatId || 0);
    if (activeSeatId && gameTurn > 0) {
      if (!record.seatTurnObservations.has(activeSeatId)) record.seatTurnObservations.set(activeSeatId, new Map());
      const seatTurns = record.seatTurnObservations.get(activeSeatId);
      const lands = (state.battlefield || []).filter((card) => Number(card.controllerSeatId) === activeSeatId && isLand(card));
      const zone = (state.zones || []).find((entry) => Number(entry.seatId) === activeSeatId) || {};
      const visibleNonlands = activeSeatId === Number(state.localSeatId)
        ? record.playedCards.size
        : (state.visibleOpponentCards || []).filter((card) => !isLand(card)).length;
      const previousSeatTurn = seatTurns.get(gameTurn);
      const observation = {
        gameTurn,
        lands: lands.length,
        visibleNonlands,
        hand: Number(zone.hand ?? 0),
        library: Number(zone.library ?? 0),
        graveyard: Number(zone.graveyard ?? 0)
      };
      if (!previousSeatTurn || observation.lands >= previousSeatTurn.lands || observation.visibleNonlands >= previousSeatTurn.visibleNonlands) {
        seatTurns.set(gameTurn, observation);
      }
    }

    const isLocalTurn = Number(state.turn?.number || 0) > 0 && Number(state.turn?.activeSeatId) === Number(state.localSeatId);
    if (!isLocalTurn) return;
    const lands = (state.battlefield || []).filter((card) => Number(card.controllerSeatId) === Number(state.localSeatId) && isLand(card));
    const turn = Number(state.turn.number);
    const previous = record.turnObservations.get(turn);
    const observation = {
      turn,
      hand: clone(state.hand || []),
      lands: clone(lands),
      landCount: lands.length,
      sources: sourceCounts(lands)
    };
    if (!previous || observation.landCount >= previous.landCount) record.turnObservations.set(turn, observation);
  }

  #completeCurrent() {
    const review = this.#summarize(this.current, true);
    this.completedKeys.add(review.id);
    this.reviews.unshift(review);
    this.reviews = this.reviews.slice(0, this.maxReviews);
    this.current = null;
    this.emit('complete', clone(review));
    this.#emit();
  }

  #summarize(record, complete) {
    const observations = [...record.turnObservations.values()].sort((a, b) => a.turn - b.turn);
    const strandedByName = new Map();
    const conditionalNames = new Set();
    observations.forEach((observation, index) => {
      const problemsThisTurn = new Set();
      for (const card of observation.hand) {
        if (hasConditionalCostReduction(card) && observation.lands.length < manaValue(card.manaCost)) {
          conditionalNames.add(card.name);
          continue;
        }
        const problem = castingProblem(card, observation.lands, observation.sources);
        if (!problem) continue;
        const key = `${card.name}|${problem.kind}|${problem.missingColors.join('')}`;
        if (problemsThisTurn.has(key)) continue;
        problemsThisTurn.add(key);
        const current = strandedByName.get(key) || {
          name: card.name,
          manaCost: card.manaCost || '',
          manaValue: problem.manaValue,
          kind: problem.kind,
          missingColors: problem.missingColors,
          turns: 0,
          turnNumbers: []
        };
        current.turns += 1;
        current.turnNumbers.push(index + 1);
        strandedByName.set(key, current);
      }
    });
    const stranded = [...strandedByName.values()].sort((a, b) => b.turns - a.turns || b.manaValue - a.manaValue);
    const drawn = groupedSeenCards(record.drawnCards);
    const seen = drawn.length ? drawn : groupedSeenCards(record.cardsSeen);
    const played = groupedPlayedCards(record.playedCards);
    const opponentColors = [...record.opponentColors];
    const latestMana = observations.at(-1) || { landCount: 0, sources: {} };
    const facts = [];
    if (record.onPlay !== null) facts.push(`You were ${record.onPlay ? 'on the play' : 'on the draw'}.`);
    if (record.openingHand.length) facts.push(`Pick 42 observed ${record.openingHand.length} cards in the starting hand${record.mulligans ? ` after ${record.mulligans} mulligan${record.mulligans === 1 ? '' : 's'}` : ''}.`);
    if (observations.length) facts.push(`Mana developed to ${latestMana.landCount} lands across ${observations.length} of your turns observed.`);
    if (stranded[0]?.turns >= 2) {
      const reason = stranded[0].kind === 'color' ? `missing ${stranded[0].missingColors.join('/')} mana` : 'waiting for enough total mana';
      facts.push(`${stranded[0].name} was stranded across ${stranded[0].turns} of your turns (${reason}).`);
    } else {
      facts.push('No card was repeatedly stranded by the observed mana base.');
    }
    for (const name of conditionalNames) facts.push(`${name} was excluded from curve evidence because its conditional cost reduction could not be verified from the recorded state.`);
    if (opponentColors.length) facts.push(`The opponent revealed ${opponentColors.join('/')} cards.`);

    const seatTimeline = (seatId) => [...(record.seatTurnObservations.get(Number(seatId)) || new Map()).values()]
      .sort((left, right) => left.gameTurn - right.gameTurn)
      .map((entry, index) => ({ ...entry, playerTurn: index + 1 }));
    const opponentSeatId = [...record.seatTurnObservations.keys()].find((seatId) => Number(seatId) !== Number(record.localSeatId))
      || (Number(record.localSeatId) === 1 ? 2 : 1);

    return {
      id: record.id,
      analysisVersion: ANALYSIS_VERSION,
      captureVersion: CAPTURE_VERSION,
      matchId: record.matchId,
      gameNumber: record.gameNumber,
      status: complete ? 'complete' : 'recording',
      startedAt: record.startedAt,
      completedAt: complete ? record.updatedAt : null,
      draftId: record.draftId,
      setCode: record.setCode,
      deck: record.deck,
      result: record.result,
      won: record.result?.won ?? null,
      turns: record.maxTurn,
      yourTurnsObserved: observations.length,
      onPlay: record.onPlay,
      mulligans: record.mulligans,
      openingHand: record.openingHand.map((card) => ({ name: card.name, manaCost: card.manaCost || '' })),
      drawnCards: seen,
      cardsSeen: seen,
      cardsSeenCount: seen.reduce((total, card) => total + card.quantity, 0),
      cardsPlayed: played,
      opponentColors,
      manaTimeline: observations.map((observation, index) => ({
        turn: index + 1,
        gameTurn: observation.turn,
        lands: observation.landCount,
        sources: observation.sources
      })),
      stranded,
      playerMana: {
        you: { timeline: seatTimeline(record.localSeatId) },
        opponent: { timeline: seatTimeline(opponentSeatId) }
      },
      gameTrajectory: [...record.gameTimeline.values()].sort((left, right) => left.gameTurn - right.gameTurn),
      combatChoices: [...record.combatChoices.values()].sort((left, right) => Number(left.turn || 0) - Number(right.turn || 0)),
      damageEvents: [...record.damageEvents.values()].sort((left, right) => Number(left.turn || 0) - Number(right.turn || 0)),
      observations: facts,
      suggestion: reviewSuggestion(record, stranded),
      disclaimer: 'One game can identify a hypothesis, not prove a deck change. Pick 42 never treats the win or loss alone as evidence.'
    };
  }

  #emit() {
    this.emit('state', this.snapshot());
  }
}

module.exports = {
  GameReviewTracker,
  analyzePostGameReview,
  buildDeviationAnalysis,
  castableByManaBase,
  castingProblem,
  deckFingerprint,
  dominanceAnalysis,
  draftDeckMatchDecision,
  gameShapeAnalysis,
  hasConditionalCostReduction,
  isEarlyConcession,
  reanalyzePersistedReview,
  replaceRebuiltReviewInPlace,
  reviewClearlyMismatchesDeck,
  reviewEventGroups,
  reviewDeckIdentity,
  reviewSeriesAnalysis,
  reviewVersionKey,
  seriesVerdictAnalysis,
  sourceCounts,
  turningPointAnalysis,
  verdictAnalysis
};
