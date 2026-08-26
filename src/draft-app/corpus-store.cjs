'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { writeJsonAtomic } = require('./local-store.cjs');
const {
  createArchetypeDeck,
  isGenericArchetypeLabel,
  parseArchetypeCorpus,
  parseArenaDeckText,
  summarizeArchetypeCorpus,
  trophyThreshold
} = require('../draft/archetype-corpus.cjs');

// Combines the imported trophy corpus with manually pasted deck lists, owns the
// manual list's local persistence, and summarizes what feeds lane inference.
function createCorpusStore({ catalog, manualStoragePath, setCodeExample }) {
  let importedCorpus = null;
  let importedPath = null;
  let manualDecks = [];
  let combined = null;
  let sourceInfo = { label: 'No corpus', kind: 'empty', count: 0, trophyCount: 0 };

  const rebuild = () => {
    const byId = new Map();
    for (const deck of importedCorpus?.decks || []) byId.set(`import:${deck.id}`, deck);
    for (const deck of manualDecks) byId.set(`manual:${deck.id}`, deck);
    const decks = [...byId.values()];
    combined = decks.length ? { version: 1, decks } : null;
    const summary = summarizeArchetypeCorpus(combined);
    const importedCount = importedCorpus?.decks?.length || 0;
    const manualCount = manualDecks.length;
    const kind = importedCount && manualCount ? 'combined' : (importedCount ? 'import' : (manualCount ? 'manual' : 'empty'));
    sourceInfo = {
      label: kind === 'combined'
        ? `${path.basename(importedPath)} + manual entries`
        : (kind === 'import' ? path.basename(importedPath) : (kind === 'manual' ? 'Pasted trophy decks' : 'No corpus')),
      kind,
      count: summary.deckCount,
      trophyCount: summary.trophyCount,
      archetypeCount: summary.archetypeCount,
      manualCount,
      importedCount,
      path: importedPath
    };
  };

  const writeManual = () => {
    writeJsonAtomic(manualStoragePath(), {
      version: 1,
      source: 'Manually pasted trophy deck lists',
      generatedAt: new Date().toISOString(),
      decks: manualDecks
    });
  };

  const manualDeckId = (value, cards) => {
    const signature = JSON.stringify({
      setCode: value.setCode,
      format: value.format,
      record: value.record,
      sourceUrl: value.sourceUrl,
      cards: cards.map((card) => [card.key, card.quantity]).sort((a, b) => a[0].localeCompare(b[0]))
    });
    return `manual-${crypto.createHash('sha256').update(signature).digest('hex').slice(0, 16)}`;
  };

  const loadImported = (filePath) => {
    const text = fs.readFileSync(filePath, 'utf8');
    const corpus = parseArchetypeCorpus(text, { catalog, fileName: filePath });
    importedCorpus = corpus;
    importedPath = filePath;
    rebuild();
    return corpus;
  };

  const readManual = () => {
    let migrated = false;
    try {
      const payload = JSON.parse(fs.readFileSync(manualStoragePath(), 'utf8'));
      manualDecks = (Array.isArray(payload?.decks) ? payload.decks : [])
        .map((deck, index) => {
          const autoArchetype = deck.archetypeSource === 'auto'
            || (!deck.archetypeSource && isGenericArchetypeLabel(deck.archetype, deck.colors));
          const normalized = {
            ...createArchetypeDeck(deck, {
              catalog,
              fallbackId: `manual-${index + 1}`,
              reclassifyColors: true,
              reclassifyArchetype: autoArchetype
            }),
            archetypeSource: autoArchetype ? 'auto' : 'custom',
            origin: 'manual'
          };
          if (JSON.stringify({
            archetype: deck.archetype,
            archetypeSource: deck.archetypeSource,
            colors: deck.colors,
            splashColors: deck.splashColors,
            colorIdentity: deck.colorIdentity
          }) !== JSON.stringify({
            archetype: normalized.archetype,
            archetypeSource: normalized.archetypeSource,
            colors: normalized.colors,
            splashColors: normalized.splashColors,
            colorIdentity: normalized.colorIdentity
          })) migrated = true;
          return normalized;
        })
        .filter((deck) => deck.trophy && deck.cards.length);
    } catch {
      manualDecks = [];
    }
    if (migrated) {
      try { writeManual(); } catch { /* Keep the in-memory migration if local persistence is temporarily unavailable. */ }
    }
    rebuild();
  };

  const addManual = (value, defaults = {}) => {
    const parsed = parseArenaDeckText(value?.deckText);
    const setCode = String(value?.setCode || defaults.setCode || '').trim().toUpperCase();
    const format = String(value?.format || defaults.format || '').trim();
    const record = String(value?.record || '').trim();
    if (!setCode) throw new Error(`Enter the set code shown by 17Lands, such as ${setCodeExample}.`);
    if (!format) throw new Error('Choose the draft format for this trophy deck.');
    if (!record) throw new Error('Enter the final record shown by 17Lands, such as 7-2.');
    const id = manualDeckId({ setCode, format, record, sourceUrl: value?.sourceUrl }, parsed.cards);
    if (manualDecks.some((deck) => deck.id === id)) throw new Error('That trophy deck is already in the manual corpus.');
    const deck = {
      ...createArchetypeDeck({
        id,
        setCode,
        format,
        record,
        eventDate: value?.eventDate,
        rank: value?.rank,
        archetype: value?.archetype,
        colors: value?.colors,
        sourceUrl: value?.sourceUrl,
        cards: parsed.cards
      }, { catalog, fallbackId: id }),
      origin: 'manual'
    };
    if (!deck.trophy) {
      const threshold = trophyThreshold(deck.format);
      throw new Error(threshold
        ? `${record} is not a trophy record for ${deck.formatLabel}; this format requires ${threshold} wins.`
        : 'Pick 42 could not verify the trophy threshold for that format.');
    }
    manualDecks.push(deck);
    writeManual();
    rebuild();
    return deck;
  };

  const removeManual = (deckId) => {
    const before = manualDecks.length;
    manualDecks = manualDecks.filter((deck) => deck.id !== deckId);
    if (manualDecks.length !== before) {
      writeManual();
      rebuild();
    }
  };

  return {
    loadImported,
    readManual,
    addManual,
    removeManual,
    corpus: () => combined,
    sourceInfo: () => sourceInfo,
    manualDecks: () => manualDecks,
    importedPath: () => importedPath
  };
}

module.exports = { createCorpusStore };
