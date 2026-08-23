'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizeCardName } = require('./csv.cjs');

const CACHE_VERSION = 1;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SEARCH_DELAY_MS = 500;
const REQUEST_HEADERS = Object.freeze({
  Accept: 'application/json',
  'User-Agent': 'Pick42ArenaCompanion/0.1'
});

function compactImageUris(imageUris = {}) {
  return {
    artCrop: imageUris.art_crop || imageUris.art || null,
    normal: imageUris.normal || imageUris.display || imageUris.large || null,
    small: imageUris.small || imageUris.grid || imageUris.thumb || null
  };
}

function compactFace(face = {}, card = {}) {
  return {
    name: face.name || card.name || '',
    manaCost: face.mana_cost || card.mana_cost || '',
    typeLine: face.type_line || card.type_line || '',
    oracleText: face.oracle_text || card.oracle_text || '',
    power: face.power ?? card.power ?? null,
    toughness: face.toughness ?? card.toughness ?? null,
    colors: face.colors || card.colors || [],
    imageUris: compactImageUris(face.image_uris || card.image_uris),
    artist: face.artist || card.artist || null
  };
}

function compactCard(card = {}) {
  const cardFaces = (card.card_faces || []).map((face) => compactFace(face, card));
  return {
    ...compactFace(card, card),
    id: card.id || null,
    layout: card.layout || 'normal',
    setCode: card.set || null,
    collectorNumber: card.collector_number || null,
    rarity: card.rarity || null,
    scryfallUri: card.scryfall_uri || null,
    cardFaces
  };
}

function buildScryfallIndex(cards = []) {
  const index = {};
  for (const sourceCard of cards) {
    const card = sourceCard.imageUris ? sourceCard : compactCard(sourceCard);
    if (card.name) index[normalizeCardName(card.name)] = card;
    for (const face of card.cardFaces || []) {
      if (!face.name) continue;
      index[normalizeCardName(face.name)] = {
        ...card,
        ...face,
        name: face.name,
        cardFaces: card.cardFaces
      };
    }
  }
  return index;
}

function findScryfallCard(index, name) {
  return index?.[normalizeCardName(name)] || null;
}

function readScryfallCache(cachePath) {
  try {
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (cache.version !== CACHE_VERSION || !Array.isArray(cache.cards) || !cache.fetchedAt) return null;
    return cache;
  } catch {
    return null;
  }
}

function writeScryfallCache(cachePath, payload) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(payload));
}

async function requestJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: REQUEST_HEADERS });
  if (!response.ok) throw new Error(`Scryfall request failed (${response.status})`);
  return response.json();
}

async function fetchScryfallSet({
  setCode = 'hob',
  fetchImpl = globalThis.fetch,
  pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  cachePath = null,
  now = Date.now()
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Scryfall requires an available fetch implementation');
  const normalizedSet = String(setCode || '').trim().toLowerCase();
  const set = await requestJson(`https://api.scryfall.com/sets/${encodeURIComponent(normalizedSet)}`, fetchImpl);
  let nextPage = `https://api.scryfall.com/cards/search?order=set&q=${encodeURIComponent(`e:${normalizedSet}`)}&unique=cards`;
  const cards = [];
  let pageNumber = 0;

  while (nextPage) {
    if (pageNumber > 0) await pause(SEARCH_DELAY_MS);
    const page = await requestJson(nextPage, fetchImpl);
    cards.push(...(page.data || []).map(compactCard));
    nextPage = page.has_more ? page.next_page : null;
    pageNumber += 1;
  }

  const payload = {
    version: CACHE_VERSION,
    setCode: normalizedSet,
    setName: set.name || normalizedSet.toUpperCase(),
    fetchedAt: now,
    cards
  };
  if (cachePath) writeScryfallCache(cachePath, payload);
  return payload;
}

async function loadScryfallSet({ cachePath, setCode = 'hob', now = Date.now(), ...options } = {}) {
  const cached = cachePath ? readScryfallCache(cachePath) : null;
  const matchesSet = cached?.setCode === String(setCode).toLowerCase();
  if (matchesSet && now - cached.fetchedAt < CACHE_TTL_MS) return { ...cached, source: 'cache' };
  return { ...(await fetchScryfallSet({ cachePath, setCode, now, ...options })), source: 'network' };
}

module.exports = {
  CACHE_TTL_MS,
  REQUEST_HEADERS,
  SEARCH_DELAY_MS,
  buildScryfallIndex,
  compactCard,
  fetchScryfallSet,
  findScryfallCard,
  loadScryfallSet,
  readScryfallCache,
  writeScryfallCache
};
