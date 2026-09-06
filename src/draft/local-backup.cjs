'use strict';
const { parseSeventeenLandsCsv } = require('./sources/seventeenlands.cjs');
const { parseUntappedCsv } = require('./sources/untapped.cjs');
const { GameReviewTracker, analyzePostGameReview, reviewEventGroups } = require('./game-review.cjs');
const { parseArchetypeCorpus, trophyThreshold } = require('./archetype-corpus.cjs');
const clone = (value) => JSON.parse(JSON.stringify(value));
const PREFS = ['activeSetCode', 'prepFormat', 'lanePreference', 'poolExclusions', 'selectedBuildId'];
const formats = ['any', 'premier', 'quick', 'traditional', 'pick-two'];
const portableSettings = (value = {}) => Object.fromEntries(PREFS.filter((key) => key in value).map((key) => [key, value[key]]));
const csvCell = (value) => '"' + String(value ?? '').replaceAll('"', '""') + '"';
const pct = (value) => Number.isFinite(value) ? `${value}%` : '';
function ratingsCsv(source, rows) {
  const headers = source === 'seventeenLands'
    ? ['Name', 'Color', 'Rarity', 'GIH WR', '# GIH', 'GD WR', '# GD', 'GP WR', '# GP', '# GNS', 'GNS WR', 'ALSA', 'ATA', 'IIH', 'OH WR']
    : ['Card', 'In Hand WR', 'In Hand WR Difference', 'In Opening Hand WR', 'Played WR', 'Included WR', 'Avg Last Offered', 'Total Games'];
  return [headers, ...rows.map((row) => {
    const basis = row.winRateBasis || 'GIH';
    return source === 'seventeenLands' ? [row.name, row.color, row.rarity,
      basis === 'GIH' ? pct(row.gihWinRate) : '', basis === 'GIH' ? row.gamesInHand : '',
      basis === 'GD' ? pct(row.gihWinRate) : '', basis === 'GD' ? row.gamesInHand : '',
      basis === 'GP' ? pct(row.gihWinRate) : '', basis === 'GP' ? row.gamesInHand : '',
      row.gamesNotSeen, pct(row.gamesNotSeenWinRate), row.alsa, row.ata,
      pct(row.improvementInHand ?? row.improvementWhenDrawn), pct(row.openingHandWinRate)]
      : [row.name, pct(row.inHandWinRate), pct(row.inHandWinRateDelta), pct(row.openingHandWinRate), pct(row.playedWinRate), pct(row.includedWinRate), row.avgLastOffered, row.games];
  })].map((row) => row.map(csvCell).join(',')).join('\n');
}
function validateRecipes(recipes = {}) {
  if (!recipes || typeof recipes !== 'object' || Array.isArray(recipes)) throw new Error('Invalid recipe progress');
  for (const [key, value] of Object.entries(recipes)) {
    if (!/^pick42\.recipe\.v2\.[a-z0-9]+\.[a-z0-9-]+$/i.test(key) || !value || typeof value !== 'object'
      || !Array.isArray(value.done) || !Array.isArray(value.skipped) || !Array.isArray(value.history)
      || [...value.done, ...value.skipped].some((id) => typeof id !== 'string')
      || value.history.some((entry) => !entry || typeof entry.id !== 'string' || !['done', 'skipped'].includes(entry.status))) throw new Error('Invalid recipe progress');
  }
  return recipes;
}
function validateBackup(value) {
  if (!value || value.product !== 'Pick 42' || value.version !== 1) throw new Error('This is not a supported Pick 42 backup');
  const text = JSON.stringify(value);
  if (text.length > 50 * 1024 * 1024) throw new Error('Backup exceeds the 50 MB limit');
  const safe = JSON.parse(text, (key, entry) => {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Backup contains an unsupported key');
    return entry;
  });
  if (!safe.settings || typeof safe.settings !== 'object' || Array.isArray(safe.settings)) throw new Error('Invalid preferences');
  safe.settings = portableSettings(safe.settings);
  if (safe.settings.activeSetCode != null && !/^[a-z0-9]{1,12}$/i.test(safe.settings.activeSetCode)) throw new Error('Invalid set preference');
  if (safe.settings.prepFormat != null && !formats.includes(safe.settings.prepFormat)) throw new Error('Invalid draft format');
  if (safe.settings.lanePreference != null && (!['lock-no-splash', 'lock-splash', 'stay-open'].includes(safe.settings.lanePreference.mode) || !Array.isArray(safe.settings.lanePreference.colors || []))) throw new Error('Invalid lane preference');
  if (safe.settings.poolExclusions != null && !Array.isArray(safe.settings.poolExclusions.names)) throw new Error('Invalid pool preferences');
  if (safe.settings.selectedBuildId != null && typeof safe.settings.selectedBuildId !== 'string') throw new Error('Invalid build preference');
  if (!Array.isArray(safe.ratings) || !safe.corpus || !Array.isArray(safe.corpus.imported) || !Array.isArray(safe.corpus.manual)) throw new Error('Invalid imported data');
  const slots = new Set();
  for (const entry of safe.ratings) {
    if (!['seventeenLands', 'untapped'].includes(entry.source) || !formats.includes(entry.format)
      || !/^[a-z0-9]{1,12}$/i.test(entry.setCode) || typeof entry.text !== 'string' || typeof entry.label !== 'string') throw new Error('Invalid ratings slot');
    entry.setCode = entry.setCode.toLowerCase();
    const key = `${entry.setCode}:${entry.source}:${entry.format}`;
    if (slots.has(key)) throw new Error('Duplicate ratings slot'); slots.add(key);
    (entry.source === 'seventeenLands' ? parseSeventeenLandsCsv : parseUntappedCsv)(entry.text);
  }
  if (safe.corpus.importedMetadata != null && (typeof safe.corpus.importedMetadata !== 'object' || Array.isArray(safe.corpus.importedMetadata)
      || ['source', 'license', 'generatedAt'].some((key) => safe.corpus.importedMetadata[key] != null && typeof safe.corpus.importedMetadata[key] !== 'string'))) throw new Error('Invalid corpus metadata');
  for (const decks of [safe.corpus.imported, safe.corpus.manual]) {
    if (decks.some((deck) => !deck || typeof deck.id !== 'string' || !Array.isArray(deck.cards) || !deck.cards.length || deck.cards.some((card) => !card || typeof card.name !== 'string' || !Number.isInteger(card.quantity) || card.quantity < 1))) throw new Error('Invalid trophy corpus');
    if (decks.length) parseArchetypeCorpus(JSON.stringify({ decks }));
  }
  for (const deck of safe.corpus.manual) {
    const threshold = trophyThreshold(deck.format);
    if (deck.cards.reduce((total, card) => total + card.quantity, 0) !== 40 || threshold == null || !Number.isInteger(deck.wins) || deck.wins < threshold) throw new Error('Invalid manually recorded trophy deck');
  }
  if (!safe.reviews || !Array.isArray(safe.reviews.reviews) || !safe.reviews.manualRecords || typeof safe.reviews.manualRecords !== 'object'
      || Array.isArray(safe.reviews.manualRecords)) throw new Error('Invalid game reviews');
  for (const review of safe.reviews.reviews) {
    if (!review || typeof review.id !== 'string' || !review.deck || !Array.isArray(review.deck.cards)) throw new Error('Invalid game review record');
  }
  for (const record of Object.values(safe.reviews.manualRecords)) {
    if (!record || !Number.isInteger(record.wins) || !Number.isInteger(record.losses) || record.wins < 0 || record.losses < 0) throw new Error('Invalid manual game record');
  }
  if (safe.decisions?.version !== 1 || !Array.isArray(safe.decisions.records)) throw new Error('Invalid decision history');
  for (const record of safe.decisions.records) {
    if (!record || typeof record.id !== 'string' || typeof record.draftId !== 'string' || record.demo
      || !Array.isArray(record.pack) || !Array.isArray(record.pool) || !Array.isArray(record.actual)
      || !Array.isArray(record.recommendations) || !record.gate) throw new Error('Invalid recorded decision');
  }
  for (const records of [safe.corpus.imported, safe.corpus.manual, safe.reviews.reviews, safe.decisions.records]) {
    if (new Set(records.map((record) => record.id)).size !== records.length) throw new Error('Duplicate record in backup');
  }
  for (const record of safe.decisions.records) {
    if ([...record.pack, ...record.pool, ...record.actual, ...record.recommendations].some((card) => !card || typeof card.name !== 'string')) throw new Error('Invalid decision card');
    if (record.recommended != null && (!Array.isArray(record.recommended) || record.recommended.some((name) => typeof name !== 'string'))) throw new Error('Invalid recorded advice');
  }
  // Exercise the same persisted-review reader before any restore writes occur.
  const tracker = new GameReviewTracker({ maxReviews: Number.MAX_SAFE_INTEGER });
  tracker.hydrate(safe.reviews.reviews);
  if (tracker.snapshot().reviews.length !== safe.reviews.reviews.length) throw new Error('Backup contains a review that does not match its deck');
  const restoredReviews = tracker.snapshot().reviews;
  const analyzed = restoredReviews.map((review) => analyzePostGameReview(review, { seventeenLands: review.sourceEvidence?.seventeenLands || [], relatedReviews: restoredReviews }));
  reviewEventGroups(analyzed, { manualRecords: safe.reviews.manualRecords });
  validateRecipes(safe.recipes);
  return safe;
}
const mergeRecords = (current, incoming) => [...current, ...incoming.filter((entry) => !current.some((existing) => existing.id === entry.id))];
function planRestore(current, incoming) {
  const ratings = incoming.ratings.filter((entry) => !current.ratings.some((old) => old.source === entry.source && old.format === entry.format && old.setCode === entry.setCode));
  const settings = { ...incoming.settings, ...current.settings };
  const recipes = { ...incoming.recipes, ...current.recipes };
  const existingDeckIds = new Set([...current.corpus.imported, ...current.corpus.manual].map((deck) => deck.id));
  const imported = mergeRecords(current.corpus.imported, incoming.corpus.imported.filter((deck) => !existingDeckIds.has(deck.id)));
  const manual = mergeRecords(current.corpus.manual, incoming.corpus.manual.filter((deck) => !existingDeckIds.has(deck.id) && !imported.some((other) => other.id === deck.id)));
  const reviews = { reviews: mergeRecords(current.reviews.reviews, incoming.reviews.reviews), manualRecords: { ...incoming.reviews.manualRecords, ...current.reviews.manualRecords } };
  // Existing drafts retain their place when the ten-draft limit is applied.
  const decisionRecords = [...incoming.decisions.records.filter((record) => !current.decisions.records.some((old) => old.id === record.id)), ...current.decisions.records];
  const retainedDrafts = new Set([...new Set(decisionRecords.map((record) => record.draftId))].slice(-10));
  const decisions = { version: 1, records: decisionRecords.filter((record) => retainedDrafts.has(record.draftId)) };
  return { ratings, settings, recipes, corpus: { imported, manual, importedMetadata: Object.fromEntries(['source', 'license', 'generatedAt'].map((key) => [key, key === 'generatedAt' ? current.corpus.importedMetadata?.[key] || incoming.corpus.importedMetadata?.[key] || null : [...new Set([current.corpus.importedMetadata?.[key], incoming.corpus.importedMetadata?.[key]].filter(Boolean))].join('; ') || null])) }, reviews, decisions,
    summary: { ratings: ratings.length, corpus: imported.length + manual.length - current.corpus.imported.length - current.corpus.manual.length,
      reviews: reviews.reviews.length - current.reviews.reviews.length, manualRecords: Object.keys(reviews.manualRecords).length - Object.keys(current.reviews.manualRecords).length,
      decisions: decisions.records.length - current.decisions.records.length, recipes: Object.keys(recipes).length - Object.keys(current.recipes).length,
      preferences: Object.keys(settings).length - Object.keys(current.settings).length } };
}
module.exports = { ratingsCsv, portableSettings, validateBackup, validateRecipes, planRestore, clone };
