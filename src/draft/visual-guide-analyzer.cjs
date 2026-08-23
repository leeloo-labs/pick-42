'use strict';

const { normalizeCardName } = require('./csv.cjs');

function normalized(value) {
  return normalizeCardName(String(value || '').replace(/[.…]+$/g, '').replace(/\s+\d+[WUBRGC]?$/i, ''));
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + Number(left[leftIndex - 1] !== right[rightIndex - 1])
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function nameSimilarity(observed, candidate) {
  const left = normalized(observed);
  const right = normalized(candidate);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length >= 5 && right.startsWith(left)) return 0.97;
  if (right.length >= 5 && left.startsWith(right)) return 0.94;
  return 1 - editDistance(left, right) / Math.max(left.length, right.length);
}

function bestName(text, names, minimum = 0.78) {
  let result = null;
  for (const name of names) {
    const similarity = nameSimilarity(text, name);
    if (similarity > (result?.similarity || minimum)) result = { name, similarity };
  }
  return result;
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function observationCenterY(observation) {
  return observation.y + observation.height / 2;
}

function targetCards(build) {
  return [...build.mainDeck, ...build.lands].map((card) => ({ ...card, quantity: Number(card.quantity) || 1 }));
}

function quantityMap(cards) {
  return new Map(cards.map((card) => [card.name, Number(card.quantity) || 1]));
}

function uniqueNames(pool, build) {
  return [...new Set([
    ...pool.map((card) => card.name),
    ...targetCards(build).map((card) => card.name),
    'Plains', 'Island', 'Swamp', 'Mountain', 'Forest'
  ].filter(Boolean))];
}

function findDeckCount(observations) {
  for (const observation of observations) {
    const match = String(observation.text).match(/\b(\d{1,2})\s*\/\s*40\s*Cards?\b/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function deckEntries(observations, names) {
  const nameRows = observations
    .filter((observation) => observation.x >= 0.69)
    .map((observation) => ({ observation, match: bestName(observation.text, names) }))
    .filter((entry) => entry.match);
  const quantities = observations
    // Arena right-aligns the quantity column, so narrower values such as `1x`
    // begin a few pixels farther right than `17x`. Keep the lane wide enough
    // for both while the quantity-shaped regex below prevents card names from
    // being admitted.
    .filter((observation) => observation.x >= 0.66 && observation.x < 0.815)
    .map((observation) => ({
      observation,
      // Narrow cropped OCR occasionally joins Arena's right-edge divider to
      // the quantity as a trailing `l`/`I` (for example `11xl`).
      match: String(observation.text).trim().match(/^(\d{1,2})\s*x[lI|]?$/i)
    }))
    .filter((entry) => entry.match);

  const rows = [];
  for (const entry of nameRows) {
    const center = observationCenterY(entry.observation);
    const quantity = quantities
      .map((candidate) => ({ ...candidate, distance: Math.abs(observationCenterY(candidate.observation) - center) }))
      .filter((candidate) => candidate.distance < 0.026)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!quantity) continue;
    const existing = rows.find((row) => row.name === entry.match.name);
    const next = {
      name: entry.match.name,
      quantity: Number(quantity.match[1]),
      similarity: entry.match.similarity,
      observation: entry.observation
    };
    if (!existing || next.similarity > existing.similarity) {
      if (existing) rows.splice(rows.indexOf(existing), 1);
      rows.push(next);
    }
  }
  return rows;
}

function poolEntries(observations, names) {
  const entries = [];
  for (const observation of observations.filter((entry) => entry.x < 0.68)) {
    const match = bestName(observation.text, names);
    if (!match) continue;
    const existing = entries.find((entry) => entry.name === match.name);
    const next = { name: match.name, similarity: match.similarity, observation };
    if (!existing || next.similarity > existing.similarity) {
      if (existing) entries.splice(entries.indexOf(existing), 1);
      entries.push(next);
    }
  }
  return entries;
}

function inferCardRect(entry, poolMatches, imageWidth, imageHeight) {
  const columnXs = [...new Set(poolMatches.map((match) => Math.round(match.observation.x * 1000) / 1000))].sort((a, b) => a - b);
  const differences = columnXs.slice(1).map((x, index) => x - columnXs[index]).filter((value) => value > 0.07 && value < 0.2);
  const step = median(differences) || 0.142;
  const width = Math.min(imageWidth * 0.132, imageWidth * step * 0.88);
  const textTop = (1 - entry.observation.y - entry.observation.height) * imageHeight;
  return {
    x: Math.max(0, entry.observation.x * imageWidth - imageWidth * 0.006),
    y: Math.max(0, textTop - imageHeight * 0.006),
    width,
    height: width * 1.39
  };
}

function inferDeckRowRect(row, rowSpacing, imageWidth, imageHeight) {
  const textTop = (1 - row.observation.y - row.observation.height) * imageHeight;
  const height = Math.max(36, imageHeight * Math.min(0.047, rowSpacing * 0.94));
  return {
    x: imageWidth * 0.718,
    y: Math.max(0, textTop - imageHeight * 0.008),
    width: imageWidth * 0.272,
    height
  };
}

function analyzeVisualGuide({ recognition, pool = [], build }) {
  if (!recognition || !build) return { ready: false, reason: 'No visual frame or target build' };
  const observations = recognition.observations || [];
  const names = uniqueNames(pool, build);
  const deckCount = findDeckCount(observations);
  const rows = deckEntries(observations, names);
  const recognizedDeckCount = rows.reduce((total, row) => total + row.quantity, 0);

  if (deckCount === null) return { ready: false, reason: 'Arena deck count was not recognized' };
  if (recognizedDeckCount !== deckCount) {
    return {
      ready: false,
      reason: `Recognized ${recognizedDeckCount} of ${deckCount} cards in Arena’s deck list`,
      deckCount,
      recognizedDeckCount
    };
  }

  const targets = quantityMap(targetCards(build));
  const current = new Map(rows.map((row) => [row.name, row.quantity]));
  const remainingTargetCount = [...targets.entries()]
    .reduce((total, [name, quantity]) => total + Math.max(0, quantity - (current.get(name) || 0)), 0);
  const poolNames = [...new Set(pool.map((card) => card.name).filter(Boolean))];
  const visiblePool = poolEntries(observations, poolNames);
  const imageWidth = Number(recognition.imageWidth) || 1;
  const imageHeight = Number(recognition.imageHeight) || 1;
  const rowYs = rows.map((row) => observationCenterY(row.observation)).sort((a, b) => b - a);
  const rowSpacing = median(rowYs.slice(1).map((y, index) => y - rowYs[index + 1]).filter((value) => value > 0.02)) || 0.0445;

  const cards = visiblePool.flatMap((entry) => {
    const missing = Math.max(0, (targets.get(entry.name) || 0) - (current.get(entry.name) || 0));
    if (!missing) return [];
    return [{
      kind: 'add',
      name: entry.name,
      quantity: missing,
      confidence: entry.similarity,
      rect: inferCardRect(entry, visiblePool, imageWidth, imageHeight)
    }];
  });

  const deckRows = rows.flatMap((row) => {
    const target = targets.get(row.name) || 0;
    const difference = target - row.quantity;
    if (!difference) return [];
    return [{
      kind: difference > 0 ? 'add' : 'drop',
      name: row.name,
      quantity: Math.abs(difference),
      confidence: row.similarity,
      rect: inferDeckRowRect(row, rowSpacing, imageWidth, imageHeight)
    }];
  });

  return {
    ready: true,
    reason: cards.length || deckRows.length
      ? 'Visual guide aligned'
      : remainingTargetCount > 0
        ? 'Page clear · scroll for more target cards'
        : 'Arena deck matches this build',
    deckCount,
    recognizedDeckCount,
    imageWidth,
    imageHeight,
    annotations: { cards, deckRows },
    recognized: { visiblePool: visiblePool.length, deckRows: rows.length },
    remainingTargetCount
  };
}

module.exports = {
  analyzeVisualGuide,
  bestName,
  editDistance,
  nameSimilarity
};
