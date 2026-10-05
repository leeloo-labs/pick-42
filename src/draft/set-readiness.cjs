'use strict';

const { normalizeCardName } = require('./csv.cjs');
const { MIN_ARCHETYPE_DECKS, normalizeFormat } = require('./archetype-corpus.cjs');
const { SOURCE_FORMAT_LABELS, resolveRatingsSlot } = require('./source-slots.cjs');

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
    const useLabel = selected.format === 'any' && format !== 'any'
      ? `Shared fallback used for ${SOURCE_FORMAT_LABELS[format] || format}`
      : SOURCE_FORMAT_LABELS[selected.format] || selected.format;
    const prefix = `${useLabel} · ${selected.label || 'import'}${selected.legacy ? ' · legacy import, set not assigned' : ''}`;
    if (!selected.count) detail = `${prefix} · no ratings rows`;
    else if (!cardNames.size) detail = `${prefix} · set verification pending`;
    else if (selected.matchRate < MATCH_THRESHOLD) detail = `${prefix} · imported data names another set`;
    else if (!selected.usableCount) detail = `${prefix} · matching cards have no usable win rates`;
    else detail = `${prefix} · ${selected.usableCount}/${selected.matchedCount} matching cards rated`;
  } else if (matching.length) detail = `${matching.map((slot) => SOURCE_FORMAT_LABELS[slot.format] || slot.format).join(', ')} ratings stored · ${format === 'any' ? 'select that draft type to view them, or import shared fallback ratings' : `import ${SOURCE_FORMAT_LABELS[format] || format} or shared fallback ratings`}`;
  else if (measured.length) detail = format === 'any' ? 'No shared fallback ratings imported' : `No ${SOURCE_FORMAT_LABELS[format] || format} or shared fallback ratings imported`;
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
  const formatLabels = formats.map((value) => normalizeFormat(value) === 'any' ? 'Unspecified draft type' : SOURCE_FORMAT_LABELS[normalizeFormat(value)] || value);
  const detail = matching.length
    ? `${matching.length} ${setCode} trophy deck${matching.length === 1 ? '' : 's'} imported · ${formatLabels.join(', ') || 'Unspecified draft type'}. Largest ${crossFormat ? 'cross-format' : 'matching'} archetype group: ${groupCount} decks (minimum ${MIN_ARCHETYPE_DECKS}).${crossFormat ? ` Cross-format advice for ${SOURCE_FORMAT_LABELS[target] || target} has reduced influence.` : ''}${ready ? ' Trophy advice activates when your drafted pool supports a matching archetype.' : ' More trophy decks sharing an archetype are needed.'}`
    : `No trophy decks imported for ${setCode} yet.`;
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
