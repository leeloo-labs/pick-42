'use strict';

const { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, screen, shell } = require('electron');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const {
  CONTEXTUAL_PHILOSOPHY,
  inferDraftLane,
  scoreDraftPack
} = require('./draft/blend-engine.cjs');
const { normalizeCardName } = require('./draft/csv.cjs');
const { exclusionKeysForDraft, filterActivePool, updatePoolExclusion } = require('./draft/pool-plan.cjs');
const { buildLimitedDecks, landColors } = require('./draft/deck-builder.cjs');
const {
  createArchetypeDeck,
  isGenericArchetypeLabel,
  parseArenaDeckText,
  parseArchetypeCorpus,
  summarizeArchetypeCorpus,
  trophyThreshold
} = require('./draft/archetype-corpus.cjs');
const { DraftLogParser } = require('./draft/draft-log-parser.cjs');
const { GameReviewTracker, analyzePostGameReview, deckFingerprint, draftDeckMatchDecision, replaceRebuiltReviewInPlace, reviewDeckIdentity } = require('./draft/game-review.cjs');
const { buildScryfallIndex, findScryfallCard, loadScryfallSet, readScryfallCache } = require('./draft/scryfall.cjs');
const { parseSeventeenLandsCsv } = require('./draft/sources/seventeenlands.cjs');
const { parseUntappedCsv } = require('./draft/sources/untapped.cjs');
const { loadArenaCardCatalog } = require('./core/card-catalog.cjs');
const { ArenaLogParser } = require('./core/arena-log-parser.cjs');
const { ArenaSceneTracker } = require('./core/arena-scene-tracker.cjs');
const { LogTailer } = require('./core/log-tailer.cjs');
const { VisualGuideController } = require('./draft/visual-guide-controller.cjs');

// Preserve prototype settings and imports while presenting the new product name.
const legacyUserDataPath = path.join(app.getPath('appData'), 'arcane-arena-companion');
app.setName('Pick 42');
app.setPath('userData', legacyUserDataPath);

const projectRoot = path.resolve(__dirname, '..');
const fixturePath = (...parts) => path.join(projectRoot, 'fixtures', ...parts);
const demoCatalog = JSON.parse(fs.readFileSync(fixturePath('demo-draft-cards.json'), 'utf8'));
const arenaCatalogResult = loadArenaCardCatalog();
// Keep demo cards as a fallback, but preserve Arena's richer localized rules text in live drafts.
const catalog = { ...demoCatalog, ...arenaCatalogResult.catalog };
const parser = new DraftLogParser({ catalog });
const matchParser = new ArenaLogParser({ catalog });
const reviewTracker = new GameReviewTracker();
const sceneTracker = new ArenaSceneTracker();
const tailer = new LogTailer();

let draftWindow;
let normalWindowBounds = null;
let compactBuildMode = false;
let buildModeSource = null;
let suppressAutomaticBuildMode = false;
let selectedBuildId = null;
let visualGuideController = null;
let visualGuideState = {
  enabled: false,
  status: 'off',
  message: 'Visual guide off',
  permission: 'not-determined',
  annotationCount: 0
};
let draftState = parser.snapshot();
let reviewState = reviewTracker.snapshot();
let reviewArmed = false;
const reviewMatchDecisions = new Map();
let status = { kind: 'demo', message: 'Sample HOB pack · import current exports when ready' };
let philosophy = { ...CONTEXTUAL_PHILOSOPHY };
let lanePreference = null;
let poolExclusionPreference = null;
let sourceData = { seventeenLands: [], untapped: [] };
let archetypeCorpus = null;
let importedArchetypeCorpus = null;
let importedArchetypeCorpusPath = null;
let manualArchetypeDecks = [];
let archetypeCorpusSource = { label: 'No corpus', kind: 'empty', count: 0, trophyCount: 0 };
let sources = {
  seventeenLands: { label: '17Lands sample', kind: 'sample', count: 0 },
  untapped: { label: 'Untapped sample', kind: 'sample', count: 0 }
};
let scryfallIndex = {};
let scryfallState = {
  kind: 'loading',
  setCode: 'hob',
  setName: 'The Hobbit',
  count: 0,
  fetchedAt: null,
  source: null,
  message: 'Loading Scryfall card images'
};
let demoEntries = [];
let demoIndex = 0;

function defaultLogCandidates() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return [path.join(process.env.USERPROFILE || home, 'AppData', 'LocalLow', 'Wizards Of The Coast', 'MTGA', 'Player.log')];
  }
  if (process.platform === 'darwin') {
    return [
      path.join(home, 'Library', 'Logs', 'Wizards Of The Coast', 'MTGA', 'Player.log'),
      path.join(home, 'Library', 'Application Support', 'com.wizards.mtga', 'Player.log')
    ];
  }
  return [path.join(home, '.local', 'share', 'Steam', 'steamapps', 'compatdata', '2141910', 'pfx', 'drive_c', 'users', 'steamuser', 'AppData', 'LocalLow', 'Wizards Of The Coast', 'MTGA', 'Player.log')];
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'draft-settings.json');
}

function scryfallCachePath() {
  return path.join(app.getPath('userData'), 'scryfall-hob.json');
}

function gameReviewsPath() {
  return path.join(app.getPath('userData'), 'game-reviews.json');
}

function manualArchetypeCorpusPath() {
  return path.join(app.getPath('userData'), 'manual-archetype-corpus.json');
}

function rebuildArchetypeCorpus() {
  const byId = new Map();
  for (const deck of importedArchetypeCorpus?.decks || []) byId.set(`import:${deck.id}`, deck);
  for (const deck of manualArchetypeDecks) byId.set(`manual:${deck.id}`, deck);
  const decks = [...byId.values()];
  archetypeCorpus = decks.length ? { version: 1, decks } : null;
  const summary = summarizeArchetypeCorpus(archetypeCorpus);
  const importedCount = importedArchetypeCorpus?.decks?.length || 0;
  const manualCount = manualArchetypeDecks.length;
  const kind = importedCount && manualCount ? 'combined' : (importedCount ? 'import' : (manualCount ? 'manual' : 'empty'));
  archetypeCorpusSource = {
    label: kind === 'combined'
      ? `${path.basename(importedArchetypeCorpusPath)} + manual entries`
      : (kind === 'import' ? path.basename(importedArchetypeCorpusPath) : (kind === 'manual' ? 'Pasted trophy decks' : 'No corpus')),
    kind,
    count: summary.deckCount,
    trophyCount: summary.trophyCount,
    archetypeCount: summary.archetypeCount,
    manualCount,
    importedCount,
    path: importedArchetypeCorpusPath
  };
}

function loadArchetypeCorpus(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const corpus = parseArchetypeCorpus(text, { catalog, fileName: filePath });
  importedArchetypeCorpus = corpus;
  importedArchetypeCorpusPath = filePath;
  rebuildArchetypeCorpus();
  return corpus;
}

function readManualArchetypeCorpus() {
  let migrated = false;
  try {
    const payload = JSON.parse(fs.readFileSync(manualArchetypeCorpusPath(), 'utf8'));
    manualArchetypeDecks = (Array.isArray(payload?.decks) ? payload.decks : [])
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
    manualArchetypeDecks = [];
  }
  if (migrated) {
    try { writeManualArchetypeCorpus(); } catch { /* Keep the in-memory migration if local persistence is temporarily unavailable. */ }
  }
  rebuildArchetypeCorpus();
}

function writeManualArchetypeCorpus() {
  fs.mkdirSync(path.dirname(manualArchetypeCorpusPath()), { recursive: true });
  fs.writeFileSync(manualArchetypeCorpusPath(), JSON.stringify({
    version: 1,
    source: 'Manually pasted trophy deck lists',
    generatedAt: new Date().toISOString(),
    decks: manualArchetypeDecks
  }, null, 2));
}

function manualDeckId(value, cards) {
  const signature = JSON.stringify({
    setCode: value.setCode,
    format: value.format,
    record: value.record,
    sourceUrl: value.sourceUrl,
    cards: cards.map((card) => [card.key, card.quantity]).sort((a, b) => a[0].localeCompare(b[0]))
  });
  return `manual-${crypto.createHash('sha256').update(signature).digest('hex').slice(0, 16)}`;
}

function addManualArchetypeDeck(value) {
  const parsed = parseArenaDeckText(value?.deckText);
  const setCode = String(value?.setCode || draftState.setCode || '').trim().toUpperCase();
  const format = String(value?.format || draftState.format || '').trim();
  const record = String(value?.record || '').trim();
  if (!setCode) throw new Error('Enter the set code shown by 17Lands, such as HOB.');
  if (!format) throw new Error('Choose the draft format for this trophy deck.');
  if (!record) throw new Error('Enter the final record shown by 17Lands, such as 7-2.');
  const id = manualDeckId({ setCode, format, record, sourceUrl: value?.sourceUrl }, parsed.cards);
  if (manualArchetypeDecks.some((deck) => deck.id === id)) throw new Error('That trophy deck is already in the manual corpus.');
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
  manualArchetypeDecks.push(deck);
  writeManualArchetypeCorpus();
  rebuildArchetypeCorpus();
  return deck;
}

function removeManualArchetypeDeck(deckId) {
  const before = manualArchetypeDecks.length;
  manualArchetypeDecks = manualArchetypeDecks.filter((deck) => deck.id !== deckId);
  if (manualArchetypeDecks.length !== before) {
    writeManualArchetypeCorpus();
    rebuildArchetypeCorpus();
  }
}

function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { return {}; }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
}

function readGameReviews() {
  try { return JSON.parse(fs.readFileSync(gameReviewsPath(), 'utf8')); } catch { return []; }
}

function writeGameReviews(reviews) {
  fs.mkdirSync(path.dirname(gameReviewsPath()), { recursive: true });
  fs.writeFileSync(gameReviewsPath(), JSON.stringify(reviews, null, 2));
}

function loadCsv(source, filePath, kind = 'import') {
  const text = fs.readFileSync(filePath, 'utf8');
  const data = source === 'seventeenLands' ? parseSeventeenLandsCsv(text) : parseUntappedCsv(text);
  sourceData[source] = data;
  sources[source] = { label: path.basename(filePath), kind, count: data.length, path: kind === 'import' ? filePath : null };
  return data;
}

function loadSampleSources() {
  loadCsv('seventeenLands', fixturePath('sample-17lands-hob.csv'), 'sample');
  loadCsv('untapped', fixturePath('sample-untapped-hob.csv'), 'sample');
}

function poolSummary(pool) {
  const curve = { '1': 0, '2': 0, '3': 0, '4': 0, '5+': 0 };
  const colors = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  let creatures = 0;
  for (const card of pool) {
    const symbols = String(card.manaCost || '').match(/[WUBRG]/g) || [];
    for (const color of new Set(symbols)) colors[color] += 1;
    const generic = Number(String(card.manaCost || '').match(/\{(\d+)\}/)?.[1] || 0);
    const manaValue = generic + symbols.length;
    const bucket = manaValue >= 5 ? '5+' : String(Math.max(1, manaValue));
    curve[bucket] = (curve[bucket] || 0) + 1;
    if (/Creature/i.test(card.typeLine || '')) creatures += 1;
  }
  return { curve, colors, creatures, total: pool.length };
}

function activeSourceData() {
  const samplesAllowed = status.kind === 'demo';
  return {
    seventeenLands: samplesAllowed || sources.seventeenLands.kind === 'import' ? sourceData.seventeenLands : [],
    untapped: samplesAllowed || sources.untapped.kind === 'import' ? sourceData.untapped : []
  };
}

function draftScopeId() {
  return String(draftState.draftId || (status.kind === 'demo' ? 'demo-hob' : 'unidentified-draft'));
}

function activePoolExclusions() {
  return exclusionKeysForDraft(poolExclusionPreference, draftScopeId());
}

function activeDraftPool() {
  return filterActivePool(draftState.pool, poolExclusionPreference, draftScopeId());
}

function currentDraftLane(preference = lanePreference) {
  const activeSources = activeSourceData();
  return inferDraftLane({
    pool: activeDraftPool(),
    seventeenLands: activeSources.seventeenLands,
    untapped: activeSources.untapped,
    archetypeCorpus,
    setCode: draftState.setCode,
    format: draftState.format,
    packNumber: draftState.packNumber,
    pickNumber: draftState.pickNumber,
    draftId: draftScopeId(),
    preference
  });
}

function currentDeckBuilds(preferredLane = currentDraftLane()) {
  const activeSources = activeSourceData();
  return buildLimitedDecks({
    pool: activeDraftPool(),
    seventeenLands: activeSources.seventeenLands,
    untapped: activeSources.untapped,
    philosophy,
    preferredLane
  });
}

function colorsForLand(card) {
  const basics = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
  return basics[card.name] ? [basics[card.name]] : landColors(card);
}

function reviewDeckSnapshot() {
  const builds = currentDeckBuilds();
  const build = builds.find((entry) => entry.id === selectedBuildId) || builds[0] || null;
  const arenaMain = draftState.arenaDeck?.mainDeck || [];
  const arenaSideboard = draftState.arenaDeck?.sideboard || [];
  const arenaTotal = arenaMain.reduce((total, card) => total + Number(card.quantity || 1), 0);
  const exact = arenaTotal >= 35;
  const main = exact
    ? arenaMain
    : [...(build?.mainDeck || []), ...(build?.lands || [])];
  const identity = reviewDeckIdentity({ selectedBuild: build, selectedBuildId });
  const scoredCandidates = [...(build?.mainDeck || []), ...(build?.cuts || []), ...(build?.excluded || [])];
  const candidateById = new Map(scoredCandidates.filter((card) => card.grpId).map((card) => [Number(card.grpId), card]));
  const candidateByName = new Map(scoredCandidates.map((card) => [String(card.name || '').toLowerCase(), card]));
  const enrichCandidate = (card) => {
    const scored = candidateById.get(Number(card.grpId)) || candidateByName.get(String(card.name || '').toLowerCase());
    return scored ? { ...scored, ...card, deckValue: scored.deckValue } : card;
  };
  const cards = main.filter((card) => !/\bLand\b/i.test(String(card.typeLine || ''))).map(enrichCandidate);
  const lands = main.filter((card) => /\bLand\b/i.test(String(card.typeLine || '')))
    .map((card) => ({ ...enrichCandidate(card), colors: card.colors?.length ? card.colors : colorsForLand(card) }));
  const sources = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const land of lands) {
    for (const color of land.colors || []) sources[color] += Number(land.quantity || 1);
  }
  return {
    source: exact ? 'Arena course deck' : 'Selected Pick 42 recipe',
    buildId: identity.buildId,
    name: identity.name,
    cards,
    lands,
    cuts: arenaSideboard.length ? arenaSideboard.map(enrichCandidate) : [...(build?.cuts || []), ...(build?.excluded || [])],
    total: main.reduce((total, card) => total + Number(card.quantity || 1), 0),
    mana: {
      sources,
      targets: build?.mana?.targets || {}
    }
  };
}

function reviewContext() {
  return {
    draftId: draftState.draftId,
    setCode: draftState.setCode,
    deck: reviewDeckSnapshot()
  };
}

function presentedReviewState() {
  const activeSources = activeSourceData();
  const completed = reviewState.reviews || [];
  const activeRelated = reviewState.active ? [reviewState.active, ...completed] : completed;
  return {
    ...reviewState,
    active: analyzePostGameReview(reviewState.active, { seventeenLands: activeSources.seventeenLands, relatedReviews: activeRelated }),
    latest: analyzePostGameReview(reviewState.latest, { seventeenLands: activeSources.seventeenLands, relatedReviews: activeRelated }),
    reviews: completed.map((review) => analyzePostGameReview(review, { seventeenLands: activeSources.seventeenLands, relatedReviews: completed }))
  };
}

function rebuildLatestLegacyReview(logPath) {
  const reviews = reviewTracker.snapshot().reviews || [];
  const legacy = reviews.find((review) => Number(review.captureVersion || 0) < 4 && review.matchId && review.deck?.total >= 35);
  if (!legacy) return false;
  const replayParser = new ArenaLogParser({ catalog, maxEvents: 240 });
  const replayTracker = new GameReviewTracker({ maxReviews: 1 });
  const context = { draftId: legacy.draftId, setCode: legacy.setCode, deck: legacy.deck };
  replayTracker.arm(context);
  replayParser.on('state', (state) => {
    if (state.matchId === legacy.matchId) replayTracker.consume(state, context);
  });
  try {
    replayParser.feed(fs.readFileSync(logPath, 'utf8'));
  } catch {
    return false;
  }
  const rebuilt = replayTracker.snapshot().reviews.find((review) => review.id === legacy.id);
  if (!rebuilt) return false;
  const next = replaceRebuiltReviewInPlace(reviews, legacy, rebuilt);
  reviewTracker.hydrate(next);
  writeGameReviews(reviewTracker.snapshot().reviews);
  return true;
}

function recommendationGate(recommendations) {
  const draftable = recommendations.filter((card) => !card.isBasicLand);
  const coveredByBoth = draftable.filter((card) => card.sourceCoverage === 2).length;
  const coverage = draftable.length ? coveredByBoth / draftable.length : 0;

  if (!draftable.length) {
    return { ready: false, kind: 'waiting', message: 'Waiting for a draft pack', coveredByBoth, total: draftable.length };
  }
  if (status.kind === 'demo') {
    return { ready: true, kind: 'demo', message: 'Sample data is active for the sample draft only', coveredByBoth, total: draftable.length };
  }
  const importedBoth = sources.seventeenLands.kind === 'import' && sources.untapped.kind === 'import';
  if (!importedBoth) {
    return {
      ready: false,
      kind: 'missing-sources',
      message: `Recommendations paused · import full 17Lands and Untapped exports for ${draftState.setCode || 'this set'}`,
      coveredByBoth,
      total: draftable.length
    };
  }
  if (coverage < 0.9) {
    return {
      ready: false,
      kind: 'low-coverage',
      message: `Recommendations paused · only ${coveredByBoth}/${draftable.length} draftable cards match both imports`,
      coveredByBoth,
      total: draftable.length
    };
  }
  return { ready: true, kind: 'ready', message: 'Both sources cover the live pack', coveredByBoth, total: draftable.length };
}

function applyScryfallPayload(payload, source = payload?.source || 'cache') {
  if (!payload?.cards?.length) return;
  scryfallIndex = buildScryfallIndex(payload.cards);
  scryfallState = {
    kind: 'ready',
    setCode: payload.setCode || 'hob',
    setName: payload.setName || 'The Hobbit',
    count: payload.cards.length,
    fetchedAt: payload.fetchedAt || null,
    source,
    message: `${payload.cards.length} Scryfall cards · ${source}`
  };
}

async function initializeScryfall() {
  const cachePath = scryfallCachePath();
  const cached = readScryfallCache(cachePath);
  if (cached?.cards?.length) {
    applyScryfallPayload(cached, 'cache');
    sendState();
  }

  try {
    if (!cached) {
      scryfallState = { ...scryfallState, kind: 'loading', message: 'Downloading The Hobbit card images from Scryfall' };
      sendState();
    }
    const payload = await loadScryfallSet({ cachePath, setCode: 'hob' });
    applyScryfallPayload(payload, payload.source);
  } catch (error) {
    scryfallState = {
      ...scryfallState,
      kind: cached ? 'ready' : 'offline',
      message: cached ? 'Using cached Scryfall images' : `Scryfall unavailable · ${error.message}`
    };
  }
  sendState();
}

function scryfallCardsForView(recommendations, deckBuilds) {
  const names = new Set([
    ...draftState.pack.map((card) => card.name),
    ...draftState.pool.map((card) => card.name),
    ...recommendations.map((card) => card.name),
    ...deckBuilds.flatMap((build) => [...build.mainDeck, ...build.lands, ...build.cuts].map((card) => card.name))
  ].filter(Boolean));
  const cards = {};
  for (const name of names) {
    const matched = findScryfallCard(scryfallIndex, name);
    if (matched) cards[name] = matched;
  }
  return cards;
}

function viewModel() {
  const activeSources = activeSourceData();
  const modelingPool = activeDraftPool();
  const excludedNames = [...activePoolExclusions()];
  const draftLane = currentDraftLane();
  const recommendations = scoreDraftPack({
    cards: draftState.pack,
    seventeenLands: activeSources.seventeenLands,
    untapped: activeSources.untapped,
    archetypeCorpus,
    pool: modelingPool,
    excludedPoolNames: excludedNames,
    packNumber: draftState.packNumber,
    pickNumber: draftState.pickNumber,
    draftId: draftScopeId(),
    setCode: draftState.setCode,
    format: draftState.format,
    lane: draftLane,
    philosophy
  });
  const deckBuilds = currentDeckBuilds(draftLane);
  const corpusMatch = archetypeCorpus
    ? summarizeArchetypeCorpus(archetypeCorpus, { setCode: draftState.setCode, format: draftState.format })
    : { deckCount: 0, trophyCount: 0, archetypeCount: 0, archetypes: [], setCodes: [], formats: [] };
  return {
    draft: draftState,
    recommendations,
    deckBuilds,
    selectedBuildId,
    recommendationGate: recommendationGate(recommendations),
    poolSummary: {
      ...poolSummary(modelingPool),
      draftedTotal: draftState.pool.length,
      excludedTotal: draftState.pool.length - modelingPool.length
    },
    poolPlan: { excludedNames },
    sources,
    archetypeCorpus: {
      source: archetypeCorpusSource,
      match: corpusMatch,
      defaults: {
        setCode: draftState.setCode || 'HOB',
        format: draftState.format || 'Player Draft',
        eventDate: new Date().toISOString().slice(0, 10)
      },
      manualDecks: manualArchetypeDecks.map((deck) => ({
        id: deck.id,
        setCode: deck.setCode,
        format: deck.formatLabel,
        record: deck.wins === null ? 'Trophy' : `${deck.wins}-${deck.losses ?? 0}`,
        archetype: deck.archetype,
        colors: deck.colors,
        splashColors: deck.splashColors,
        eventDate: deck.eventDate,
        rank: deck.rank,
        total: deck.cards.reduce((sum, card) => sum + card.quantity, 0)
      }))
    },
    philosophy,
    draftLane,
    status,
    arena: {
      ...sceneTracker.snapshot(),
      compactBuildMode,
      buildModeSource
    },
    visualGuide: visualGuideState,
    review: {
      ...presentedReviewState(),
      pendingDeck: (() => {
        const deck = reviewDeckSnapshot();
        return { ...deck, fingerprint: deckFingerprint(deck) };
      })()
    },
    scryfall: {
      ...scryfallState,
      cards: scryfallCardsForView(recommendations, deckBuilds)
    },
    catalog: { count: arenaCatalogResult.count, source: arenaCatalogResult.source },
    demo: { index: demoIndex, total: demoEntries.length }
  };
}

function sendState() {
  if (draftWindow && !draftWindow.isDestroyed() && !draftWindow.webContents.isLoading()) {
    draftWindow.webContents.send('draft:state', viewModel());
  }
}

function setStatus(next) {
  status = next;
  sendState();
}

function startDemo() {
  tailer.stop();
  reviewArmed = false;
  matchParser.reset();
  reviewMatchDecisions.clear();
  reviewTracker.disarm();
  parser.reset();
  demoEntries = fs.readFileSync(fixturePath('demo-draft.log'), 'utf8').split('\n').filter(Boolean);
  demoIndex = 0;
  parser.feed(`${demoEntries[demoIndex]}\n`);
  demoIndex += 1;
  setStatus({ kind: 'demo', message: 'Sample HOB pack · use Next pick to see philosophy adapt' });
}

function advanceDemo() {
  if (demoIndex >= demoEntries.length) return startDemo();
  const entry = demoEntries[demoIndex];
  parser.feed(`${entry}\n`);
  demoIndex += 1;
  if (/MakePick|DraftPick/i.test(entry) && demoIndex < demoEntries.length && /Draft\.Notify|DraftStatus/i.test(demoEntries[demoIndex])) {
    parser.feed(`${demoEntries[demoIndex]}\n`);
    demoIndex += 1;
  }
  setStatus({ kind: 'demo', message: demoIndex >= demoEntries.length ? 'Sample complete · Next pick restarts it' : 'Sample draft advanced' });
}

async function watchLog(logPath) {
  reviewArmed = false;
  matchParser.reset();
  reviewMatchDecisions.clear();
  parser.reset();
  sceneTracker.reset();
  draftState = parser.snapshot();
  writeSettings({ logPath });
  setStatus({ kind: 'loading', message: 'Scanning Arena draft events', path: logPath });
  await tailer.start(logPath);
  migrateLegacyDraftPreferences(draftState);
  if (selectedBuildId && !currentDeckBuilds().some((build) => build.id === selectedBuildId)) {
    selectedBuildId = null;
    writeSettings({ selectedBuildId: null });
  }
  rebuildLatestLegacyReview(logPath);
  matchParser.reset();
  reviewMatchDecisions.clear();
  reviewTracker.arm(reviewContext());
  reviewArmed = true;
}

function createWindow() {
  const display = screen.getPrimaryDisplay().workArea;
  const windowWidth = Math.max(780, Math.min(1280, display.width - 36));
  const windowHeight = Math.max(620, Math.min(840, display.height - 36));
  draftWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: Math.min(1020, windowWidth),
    minHeight: 620,
    frame: false,
    transparent: false,
    backgroundColor: '#bebbb5',
    alwaysOnTop: false,
    resizable: true,
    title: 'Pick 42 Draft Companion',
    webPreferences: {
      preload: path.join(__dirname, 'draft-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  draftWindow.setPosition(Math.max(display.x, display.x + display.width - windowWidth - 18), Math.max(display.y, display.y + 18));
  normalWindowBounds = draftWindow.getBounds();
  draftWindow.loadFile(path.join(__dirname, 'draft-renderer', 'index.html'));
  draftWindow.webContents.on('did-finish-load', sendState);
}

function setCompactBuildMode(enabled, source = null) {
  if (!draftWindow || draftWindow.isDestroyed()) return;
  const next = Boolean(enabled);
  if (next === compactBuildMode && (!next || source === buildModeSource)) {
    sendState();
    return;
  }

  if (next) {
    if (!compactBuildMode) normalWindowBounds = draftWindow.getBounds();
    const workArea = screen.getDisplayMatching(draftWindow.getBounds()).workArea;
    const width = Math.min(400, Math.max(350, workArea.width - 36));
    const height = Math.min(780, Math.max(540, workArea.height - 36));
    draftWindow.setMinimumSize(340, 500);
    draftWindow.setBounds({
      x: workArea.x + workArea.width - width - 18,
      y: workArea.y + 18,
      width,
      height
    }, true);
    draftWindow.showInactive();
  } else {
    const fallback = screen.getPrimaryDisplay().workArea;
    const fallbackWidth = Math.max(780, Math.min(1280, fallback.width - 36));
    const fallbackHeight = Math.max(620, Math.min(840, fallback.height - 36));
    const bounds = normalWindowBounds || {
      x: Math.max(fallback.x, fallback.x + fallback.width - fallbackWidth - 18),
      y: fallback.y + 18,
      width: fallbackWidth,
      height: fallbackHeight
    };
    draftWindow.setBounds(bounds, true);
    draftWindow.setMinimumSize(780, 620);
  }

  compactBuildMode = next;
  buildModeSource = next ? source : null;
  sendState();
}

function registerIpc() {
  ipcMain.handle('draft:bootstrap', () => viewModel());
  ipcMain.handle('draft:import-source', async (_event, source) => {
    if (!['seventeenLands', 'untapped'].includes(source)) throw new Error('Unknown draft data source.');
    const result = await dialog.showOpenDialog(draftWindow, {
      title: `Import ${source === 'seventeenLands' ? '17Lands' : 'Untapped'} CSV`,
      properties: ['openFile'],
      filters: [{ name: 'CSV export', extensions: ['csv'] }]
    });
    if (result.canceled || !result.filePaths[0]) return viewModel();
    try {
      loadCsv(source, result.filePaths[0]);
      writeSettings({ [`${source}Path`]: result.filePaths[0] });
      setStatus({ kind: 'live', message: `${sources[source].label} imported` });
    } catch (error) {
      setStatus({ kind: 'error', message: error.message });
    }
    return viewModel();
  });
  ipcMain.handle('draft:import-archetype-corpus', async () => {
    const result = await dialog.showOpenDialog(draftWindow, {
      title: 'Import authorized archetype corpus',
      properties: ['openFile'],
      filters: [
        { name: 'Archetype corpus', extensions: ['csv', 'json'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths[0]) return viewModel();
    try {
      loadArchetypeCorpus(result.filePaths[0]);
      writeSettings({ archetypeCorpusPath: result.filePaths[0] });
      setStatus({ kind: 'live', message: `${archetypeCorpusSource.trophyCount} trophy exemplars imported` });
    } catch (error) {
      setStatus({ kind: 'error', message: error.message });
    }
    return viewModel();
  });
  ipcMain.handle('draft:add-trophy-deck', (_event, value) => {
    try {
      const deck = addManualArchetypeDeck(value);
      setStatus({ kind: 'live', message: `${deck.archetype} ${deck.record || `${deck.wins}-${deck.losses ?? 0}`} trophy deck saved locally` });
    } catch (error) {
      setStatus({ kind: 'error', message: error.message });
      throw error;
    }
    return viewModel();
  });
  ipcMain.handle('draft:remove-trophy-deck', (_event, deckId) => {
    removeManualArchetypeDeck(String(deckId || ''));
    setStatus({ kind: 'live', message: `${manualArchetypeDecks.length} manually pasted trophy decks saved` });
    return viewModel();
  });
  ipcMain.handle('draft:read-clipboard', () => ({ text: clipboard.readText() }));
  ipcMain.handle('draft:choose-log', async () => {
    const result = await dialog.showOpenDialog(draftWindow, {
      title: 'Choose MTG Arena Player.log',
      properties: ['openFile'],
      filters: [{ name: 'Arena log', extensions: ['log', 'txt'] }]
    });
    if (!result.canceled && result.filePaths[0]) await watchLog(result.filePaths[0]);
    return viewModel();
  });
  ipcMain.handle('draft:set-lane-preference', (_event, requestedMode) => {
    const mode = String(requestedMode || 'auto');
    if (mode === 'auto') {
      lanePreference = null;
    } else if (['lock-no-splash', 'lock-splash', 'stay-open'].includes(mode)) {
      const automatic = currentDraftLane(null);
      lanePreference = {
        mode,
        draftId: draftScopeId(),
        colors: automatic.colors,
        label: automatic.label
      };
    } else {
      return viewModel();
    }
    writeSettings({ lanePreference });
    visualGuideController?.contextChanged();
    sendState();
    return viewModel();
  });
  ipcMain.handle('draft:set-pool-card-excluded', (_event, cardName, excluded) => {
    const key = normalizeCardName(cardName);
    if (!key || !draftState.pool.some((card) => normalizeCardName(card.name) === key)) return viewModel();
    poolExclusionPreference = updatePoolExclusion(poolExclusionPreference, draftScopeId(), key, excluded);
    writeSettings({ poolExclusions: poolExclusionPreference });
    visualGuideController?.contextChanged();
    sendState();
    return viewModel();
  });
  ipcMain.handle('draft:start-demo', () => { startDemo(); return viewModel(); });
  ipcMain.handle('draft:advance-demo', () => { advanceDemo(); return viewModel(); });
  ipcMain.handle('draft:select-build', (_event, buildId) => {
    const available = new Set((viewModel().deckBuilds || []).map((build) => build.id));
    if (available.has(buildId)) {
      selectedBuildId = buildId;
      writeSettings({ selectedBuildId });
      visualGuideController?.contextChanged();
      sendState();
    }
    return viewModel();
  });
  ipcMain.handle('draft:copy-search', (_event, text) => {
    const value = String(text || '').trim().slice(0, 200);
    if (value) clipboard.writeText(value);
    return { copied: value };
  });
  ipcMain.handle('draft:toggle-visual-guide', async () => {
    const enabled = !visualGuideState.enabled;
    writeSettings({ visualGuideEnabled: enabled });
    await visualGuideController?.setEnabled(enabled);
    return viewModel();
  });
  ipcMain.handle('draft:scan-visual-guide', async () => {
    await visualGuideController?.scan({ forceFull: true });
    return viewModel();
  });
  ipcMain.handle('draft:open-screen-settings', () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'));
  ipcMain.handle('draft:enter-build-mode', () => {
    suppressAutomaticBuildMode = false;
    setCompactBuildMode(true, 'manual');
    return viewModel();
  });
  ipcMain.handle('draft:exit-build-mode', () => {
    suppressAutomaticBuildMode = sceneTracker.snapshot().inDeckBuilder;
    setCompactBuildMode(false);
    return viewModel();
  });
  ipcMain.handle('draft:minimize', () => draftWindow.minimize());
  ipcMain.handle('draft:close', () => app.quit());
}

function migrateLegacyDraftPreferences(nextState) {
  if (!nextState.courseId || !nextState.eventName || nextState.courseId === nextState.eventName) return;
  const patch = {};
  if (lanePreference?.draftId === nextState.eventName) {
    lanePreference = { ...lanePreference, draftId: nextState.courseId };
    patch.lanePreference = lanePreference;
  }
  if (poolExclusionPreference?.draftId === nextState.eventName) {
    poolExclusionPreference = { ...poolExclusionPreference, draftId: nextState.courseId };
    patch.poolExclusions = poolExclusionPreference;
  }
  if (Object.keys(patch).length) writeSettings(patch);
}

parser.on('state', (nextState) => {
  const previousDraftId = draftState.draftId;
  draftState = nextState;
  if (previousDraftId && nextState.draftId && previousDraftId !== nextState.draftId) {
    selectedBuildId = null;
    writeSettings({ selectedBuildId: null });
  }
  visualGuideController?.contextChanged();
  sendState();
});
matchParser.on('state', (nextState) => {
  if (!reviewArmed || !nextState?.matchId || nextState.gameNumber === null || nextState.gameNumber === undefined) return;
  const context = reviewContext();
  const matchKey = `${nextState.matchId}:${nextState.gameNumber}`;
  let decision = reviewMatchDecisions.get(matchKey);
  if (!decision || decision.status === 'pending') {
    decision = draftDeckMatchDecision(nextState, context.deck);
    reviewMatchDecisions.set(matchKey, decision);
  }
  if (decision.status === 'accepted') reviewTracker.consume(nextState, context);
  else if (decision.status === 'rejected' && !decision.reported) {
    reviewTracker.ignore(nextState, context, decision.reason);
    reviewMatchDecisions.set(matchKey, { ...decision, reported: true });
  }
});
reviewTracker.on('state', (nextState) => {
  reviewState = nextState;
  sendState();
});
reviewTracker.on('complete', () => writeGameReviews(reviewTracker.snapshot().reviews));
sceneTracker.on('scene', (nextScene) => {
  if (nextScene.inDeckBuilder) {
    if (!suppressAutomaticBuildMode && buildModeSource !== 'manual') setCompactBuildMode(true, 'automatic');
  } else {
    suppressAutomaticBuildMode = false;
    if (buildModeSource === 'automatic') setCompactBuildMode(false);
  }
  visualGuideController?.contextChanged();
  sendState();
});
tailer.on('data', (chunk) => {
  parser.feed(chunk);
  sceneTracker.feed(chunk);
  if (reviewArmed) matchParser.feed(chunk);
});
tailer.on('rotate', () => {
  parser.reset();
  matchParser.reset();
  reviewMatchDecisions.clear();
  reviewTracker.arm(reviewContext());
  sceneTracker.reset();
  draftState = parser.snapshot();
  if (buildModeSource === 'automatic') setCompactBuildMode(false);
  setStatus({ kind: 'loading', message: 'Arena started a new log session' });
});
tailer.on('status', (next) => setStatus(next));

app.whenReady().then(async () => {
  loadSampleSources();
  readManualArchetypeCorpus();
  reviewTracker.hydrate(readGameReviews());
  writeGameReviews(reviewTracker.snapshot().reviews);
  const saved = readSettings();
  philosophy = {
    ...CONTEXTUAL_PHILOSOPHY,
    sourceBalance: Number.isFinite(Number(saved.philosophy?.sourceBalance)) ? Number(saved.philosophy.sourceBalance) : CONTEXTUAL_PHILOSOPHY.sourceBalance,
    cardOverrides: saved.philosophy?.cardOverrides || CONTEXTUAL_PHILOSOPHY.cardOverrides
  };
  lanePreference = saved.lanePreference && ['lock-no-splash', 'lock-splash', 'stay-open'].includes(saved.lanePreference.mode)
    ? saved.lanePreference
    : null;
  poolExclusionPreference = saved.poolExclusions && Array.isArray(saved.poolExclusions.names)
    ? saved.poolExclusions
    : null;
  selectedBuildId = String(saved.selectedBuildId || '').trim() || null;
  if (saved.archetypeCorpusPath && fs.existsSync(saved.archetypeCorpusPath)) {
    try { loadArchetypeCorpus(saved.archetypeCorpusPath); } catch { /* Keep drafting if an old corpus moved or changed. */ }
  }
  for (const source of ['seventeenLands', 'untapped']) {
    const savedPath = saved[`${source}Path`];
    if (savedPath && fs.existsSync(savedPath)) {
      try { loadCsv(source, savedPath); } catch { /* Keep the bundled sample if an old export moved or changed. */ }
    }
  }
  visualGuideController = new VisualGuideController({
    projectRoot,
    preloadPath: path.join(__dirname, 'visual-preload.cjs'),
    rendererPath: path.join(__dirname, 'visual-renderer', 'index.html'),
    context: () => {
      const current = viewModel();
      return {
        inDeckBuilder: Boolean(current.arena.inDeckBuilder),
        pool: current.draft.pool,
        build: current.deckBuilds.find((build) => build.id === selectedBuildId) || current.deckBuilds[0] || null
      };
    },
    onState: (next) => {
      visualGuideState = next;
      sendState();
    }
  });
  visualGuideState = visualGuideController.snapshot();
  registerIpc();
  createWindow();
  void initializeScryfall();
  globalShortcut.register('CommandOrControl+Shift+D', () => {
    if (draftWindow.isVisible()) draftWindow.hide(); else draftWindow.showInactive();
  });
  const sendRecipeCommand = (command) => {
    if (draftWindow && !draftWindow.isDestroyed()) draftWindow.webContents.send('draft:recipe-command', command);
  };
  globalShortcut.register('CommandOrControl+Shift+C', () => sendRecipeCommand('copy'));
  globalShortcut.register('CommandOrControl+Shift+Right', () => sendRecipeCommand('next'));
  globalShortcut.register('CommandOrControl+Shift+Left', () => sendRecipeCommand('undo'));

  const candidate = [saved.logPath, ...defaultLogCandidates()].find((entry) => entry && fs.existsSync(entry));
  if (candidate) await watchLog(candidate);
  else startDemo();
  // Positional OCR tracking is retained only as an experimental implementation.
  // Recipe Mode is the default and does not start screen capture automatically.
  if (saved.visualGuideEnabled) writeSettings({ visualGuideEnabled: false });
});

app.on('will-quit', () => {
  tailer.stop();
  visualGuideController?.dispose();
  globalShortcut.unregisterAll();
});
app.on('window-all-closed', () => app.quit());
