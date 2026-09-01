'use strict';

const { normalizeCardName } = require('./csv.cjs');

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

function ratingsReadiness(slots = [], { format = 'any', cardNames }) {
  const measured = slots
    .filter((slot) => slot?.data?.length)
    .map((slot) => ({ format: slot.format, label: slot.label, count: slot.data.length, matchRate: rowMatchRate(slot.data, cardNames) }));
  const matching = measured.filter((slot) => slot.matchRate >= MATCH_THRESHOLD);
  const usable = matching.filter((slot) => slot.format === format || slot.format === 'any' || format === 'any');
  const ready = usable.length > 0;
  let detail;
  if (ready) detail = usable.map((slot) => `${slot.format} · ${slot.count} cards`).join(' · ');
  else if (matching.length) detail = `${matching.map((slot) => slot.format).join('/')} slot only · import into ${format} or any`;
  else if (measured.length) detail = 'imported data names another set';
  else detail = 'no export imported yet';
  return { ready, detail, slots: measured };
}

function corpusReadiness(decks = [], { set, format = 'any' }) {
  const setCode = String(set?.displayCode || '').toUpperCase();
  const matching = decks.filter((deck) => String(deck.setCode || '').toUpperCase() === setCode && deck.trophy !== false);
  const formats = [...new Set(matching.map((deck) => deck.format).filter(Boolean))].sort();
  const exact = format === 'any' || formats.includes(format) || formats.includes('any');
  const ready = matching.length > 0;
  const detail = ready
    ? `${matching.length} ${setCode} decks · ${formats.join('/') || 'any'}${exact ? '' : ` · used cross-format for ${format}`}`
    : 'no trophy corpus for this set yet';
  return { ready, detail, count: matching.length, formats };
}

function computeSetReadiness({ set, format = 'any', cardNames = new Set(), sources = {}, corpusDecks = [], images = {} }) {
  const seventeenLands = ratingsReadiness(sources.seventeenLands || [], { format, cardNames });
  const untapped = ratingsReadiness(sources.untapped || [], { format, cardNames });
  const corpus = corpusReadiness(corpusDecks, { set, format });
  const imagesReady = Boolean(images.ready);
  const items = [
    { id: 'seventeenLands', label: '17Lands ratings', ...seventeenLands },
    { id: 'untapped', label: 'Untapped ratings', ...untapped },
    { id: 'corpus', label: 'Trophy corpus', ...corpus },
    { id: 'images', label: 'Card images', ready: imagesReady, detail: images.detail || (imagesReady ? 'Scryfall loaded' : 'loading from Scryfall') }
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
    complete: readyCount === items.length
  };
}

module.exports = { computeSetReadiness, rowMatchRate };
