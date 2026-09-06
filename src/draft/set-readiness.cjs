'use strict';

const { normalizeCardName } = require('./csv.cjs');
const { MIN_ARCHETYPE_DECKS, normalizeFormat } = require('./archetype-corpus.cjs');
const { resolveRatingsSlot } = require('./source-slots.cjs');

// How ready the imported data is for drafting a given set and draft type.
// Everything here is measured, never assumed: a ratings slot only counts when
// most of its rows name cards from the set, the corpus only counts decks
// recorded for the set, and card images only count once the set's Scryfall
// payload is loaded. The result drives the SET PREP checklist.

const MATCH_THRESHOLD = 0.5;

function rowMatchRate(rows = [], cardNames = new Set()) {
  if (!rows.length || !cardNames.size) return 0;
  const matched = rows.filter((row) => cardNames.has(row.key || normalizeCardName(row.name))).length;
  return matched / rows.length;
}

function ratingsReadiness(slots = [], { format = 'any', cardNames, metric }) {
  const measured = slots.map((slot) => {
    const rows = slot.data || [];
    const matched = rows.filter((row) => cardNames.has(row.key || normalizeCardName(row.name)));
    return {
      format: slot.format, label: slot.label, legacy: Boolean(slot.legacy), count: rows.length,
      matchRate: rowMatchRate(rows, cardNames), matchedCount: matched.length,
      usableCount: matched.filter((row) => Number.isFinite(row[metric])).length
    };
  });
  const matching = measured.filter((slot) => slot.matchRate >= MATCH_THRESHOLD);
  const selected = resolveRatingsSlot(measured, format);
  const ready = Boolean(selected && selected.matchRate >= MATCH_THRESHOLD && selected.usableCount > 0);
  let detail;
  if (selected) {
    const prefix = `${selected.format} · ${selected.label || 'import'}${selected.legacy ? ' · legacy import, set not assigned' : ''}`;
    if (!selected.count) detail = `${prefix} · no ratings rows`;
    else if (!cardNames.size) detail = `${prefix} · set verification pending`;
    else if (selected.matchRate < MATCH_THRESHOLD) detail = `${prefix} · imported data names another set`;
    else if (!selected.usableCount) detail = `${prefix} · matching cards have no usable win rates`;
    else detail = `${prefix} · ${selected.usableCount}/${selected.matchedCount} matching cards rated`;
  } else if (matching.length) detail = `${matching.map((slot) => slot.format).join('/')} slot only · import into ${format === 'any' ? 'any' : `${format} or any`}`;
  else if (measured.length) detail = `no ${format} or all-types import selected`;
  else detail = 'no export imported yet';
  return { ready, detail, activeFormat: selected?.format || null, usableCount: selected?.usableCount || 0, slots: measured };
}

function corpusReadiness(decks = [], { set, format = 'any' }) {
  const setCode = String(set?.displayCode || '').toUpperCase();
  const matching = decks.filter((deck) => String(deck.setCode || '').toUpperCase() === setCode && deck.trophy !== false);
  const formats = [...new Set(matching.map((deck) => deck.format).filter(Boolean))].sort();
  const target = normalizeFormat(format);
  const exact = matching.filter((deck) => target === 'any' || normalizeFormat(deck.format) === target || normalizeFormat(deck.format) === 'any');
  const largestGroup = (decks) => {
    const counts = new Map();
    for (const deck of decks) if (deck.archetype) counts.set(deck.archetype, (counts.get(deck.archetype) || 0) + 1);
    return Math.max(0, ...counts.values());
  };
  const exactCount = largestGroup(exact);
  const crossFormat = target !== 'any' && exactCount < MIN_ARCHETYPE_DECKS && largestGroup(matching) >= MIN_ARCHETYPE_DECKS;
  const groupCount = crossFormat ? largestGroup(matching) : exactCount;
  const ready = groupCount >= MIN_ARCHETYPE_DECKS;
  const detail = matching.length
    ? `${matching.length} ${setCode} decks stored · ${formats.join('/') || 'any'} · ${groupCount}/${MIN_ARCHETYPE_DECKS} in the largest ${crossFormat ? 'cross-format' : 'matching'} archetype group${crossFormat ? ` · available cross-format for ${target}` : ''}${ready ? ' · advice also needs two distinguishing pool cards' : ' · more matching trophies needed'}`
    : 'no trophy corpus for this set yet';
  return { ready, detail, count: matching.length, formats, groupCount, crossFormat };

}

function computeSetReadiness({ set, format = 'any', cardNames = new Set(), sources = {}, corpusDecks = [], images = {} }) {
  const seventeenLands = ratingsReadiness(sources.seventeenLands || [], { format, cardNames, metric: 'gihWinRate' });
  const untapped = ratingsReadiness(sources.untapped || [], { format, cardNames, metric: 'inHandWinRate' });
  const corpus = corpusReadiness(corpusDecks, { set, format });
  const imagesReady = Boolean(images.ready);
  const items = [
    { id: 'seventeenLands', label: '17Lands ratings', ...seventeenLands },
    { id: 'untapped', label: 'Untapped ratings', ...untapped },
    { id: 'corpus', label: 'Trophy corpus · optional', ...corpus },
    { id: 'images', label: 'Card images · optional', ready: imagesReady, detail: images.detail || (imagesReady ? 'Scryfall loaded' : 'loading from Scryfall') }
  ];
  const readyCount = items.filter((item) => item.ready).length;
  const rankingsReady = seventeenLands.ready && untapped.ready;
  return {
    setCode: set?.code || null,
    displayCode: set?.displayCode || null,
    setName: set?.name || null,
    format,
    items,
    readyCount,
    total: items.length,
    percent: Math.round((readyCount / items.length) * 100),
    rankingsReady,
    ratingsStatus: rankingsReady ? 'full' : (seventeenLands.ready || untapped.ready ? 'partial' : 'none'),
    complete: readyCount === items.length
  };
}

module.exports = { computeSetReadiness, rowMatchRate };
