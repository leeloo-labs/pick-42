'use strict';

// Random sample boosters for demo drafts. A fresh pack mirrors a real booster's
// rarity slots: one rare (upgraded to mythic one time in eight), three uncommons,
// and commons for the rest. Wheeled packs (later rounds) shrink by the picks
// already taken and draw from decayed rarity odds, since other drafters take the
// best cards first. No card appears twice in one pack.

function shuffle(list, rng) {
  const items = [...list];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [items[index], items[swap]] = [items[swap], items[index]];
  }
  return items;
}

function generateSamplePack({ catalog, round = 1, picksPerRound = 2, rng = Math.random }) {
  const pools = { C: [], U: [], R: [], M: [] };
  for (const [grpId, card] of Object.entries(catalog || {})) {
    (pools[card.rarity] || pools.C).push(Number(grpId));
  }
  const size = Math.max(picksPerRound, 14 - picksPerRound * (Math.max(1, round) - 1));
  const taken = new Set();
  const ids = [];
  const take = (rarity) => {
    const order = { M: ['M', 'R', 'U', 'C'], R: ['R', 'M', 'U', 'C'], U: ['U', 'C', 'R', 'M'], C: ['C', 'U', 'R', 'M'] }[rarity];
    for (const tier of order) {
      const available = pools[tier].filter((id) => !taken.has(id));
      if (!available.length) continue;
      const id = available[Math.floor(rng() * available.length)];
      taken.add(id);
      ids.push(id);
      return;
    }
  };

  if (round <= 1) {
    take(rng() < 1 / 8 ? 'M' : 'R');
    for (let slot = 0; slot < 3; slot += 1) take('U');
    while (ids.length < size) take('C');
  } else {
    while (ids.length < size) {
      const roll = rng();
      take(roll < 0.015 ? 'M' : (roll < 0.075 ? 'R' : (roll < 0.27 ? 'U' : 'C')));
    }
  }
  return shuffle(ids, rng);
}

module.exports = { generateSamplePack };
