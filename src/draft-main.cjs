'use strict';

const { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {
  inferDraftLane,
  recommendPickTwoPair,
  scoreDraftPack
} = require('./draft/blend-engine.cjs');
const { normalizeCardName } = require('./draft/csv.cjs');
const { DEFAULT_SET_CODE, scryfallCacheFileName, setDefinition, untappedCardDataUrl } = require('./draft/set-definitions.cjs');
const { exclusionKeysForDraft, filterActivePool, updatePoolExclusion } = require('./draft/pool-plan.cjs');
const { createLocalStore, defaultLogCandidates, writeFileAtomic, writeJsonAtomic } = require('./draft-app/local-store.cjs');
const { SOURCE_FORMATS, SOURCE_FORMAT_LABELS, createSourceImportStore } = require('./draft-app/source-imports.cjs');
const { createCorpusStore } = require('./draft-app/corpus-store.cjs');
const { createDemoDriver } = require('./draft-app/demo-driver.cjs');
const { evaluateRecommendationGate } = require('./draft/coverage-gate.cjs');
const { buildLimitedDecks, landColors } = require('./draft/deck-builder.cjs');
const { normalizeFormat, summarizeArchetypeCorpus } = require('./draft/archetype-corpus.cjs');
const { DraftLogParser } = require('./draft/draft-log-parser.cjs');
const { GameReviewTracker, analyzePostGameReview, deckFingerprint, draftDeckMatchDecision, eventWrapUpVerdict, replaceRebuiltReviewInPlace, reviewDeckIdentity, reviewEventGroups } = require('./draft/game-review.cjs');
const { buildScryfallIndex, findScryfallCard, loadScryfallSet, readScryfallCache } = require('./draft/scryfall.cjs');
const { extractTrophyDecksFromGameData, isSeventeenLandsGameData } = require('./draft/seventeenlands-dataset.cjs');
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
let watchedLogPath = null;
let lastLogActivityAt = null;
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
const ACTIVE_SET = setDefinition(DEFAULT_SET_CODE);
let status = { kind: 'demo', message: `Sample ${ACTIVE_SET.displayCode} pack · import current exports when ready` };
let lanePreference = null;
let poolExclusionPreference = null;
const sourceStore = createSourceImportStore();
let scryfallIndex = {};
let scryfallState = {
  kind: 'loading',
  setCode: ACTIVE_SET.code,
  setName: ACTIVE_SET.name,
  count: 0,
  fetchedAt: null,
  source: null,
  message: 'Loading Scryfall card images'
};

const store = createLocalStore(app.getPath('userData'));
const { readSettings, writeSettings, readGameReviews, writeGameReviews, manualArchetypeCorpusPath } = store;
const scryfallCachePath = () => store.scryfallCachePath(scryfallCacheFileName(ACTIVE_SET.code));
// Imports are copied into the app's own storage so they keep working after the
// original download is moved, deleted, or blocked by macOS folder permissions.
const importedCsvStoragePath = store.importedCsvStoragePath;
const corpusStore = createCorpusStore({ catalog, manualStoragePath: manualArchetypeCorpusPath, setCodeExample: ACTIVE_SET.displayCode });
const loadArchetypeCorpus = corpusStore.loadImported;
const readManualArchetypeCorpus = corpusStore.readManual;

const parseSourceCsv = sourceStore.parse;
const rememberSourceCsv = sourceStore.remember;
const loadCsv = sourceStore.loadCsv;
const sourceImportPathsForSettings = sourceStore.settingsPayload;
const loadSampleSources = () => sourceStore.loadSamples({
  seventeenLands: fixturePath(ACTIVE_SET.sampleFixtures.seventeenLands),
  untapped: fixturePath(ACTIVE_SET.sampleFixtures.untapped)
});
const resolveSourceImport = (source, format = draftState.format) => sourceStore.resolve(source, format);
const sourceViewState = (source) => sourceStore.viewState(source, { demo: status.kind === 'demo', format: draftState.format });

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

const activeSourceData = () => sourceStore.activeData({ demo: status.kind === 'demo', format: draftState.format });

function draftScopeId() {
  return String(draftState.draftId || (status.kind === 'demo' ? `demo-${ACTIVE_SET.code}` : 'unidentified-draft'));
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
    archetypeCorpus: corpusStore.corpus(),
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
  const modeledCards = {};
  for (const card of [...(build?.mainDeck || []), ...(build?.lands || [])]) {
    modeledCards[card.name] = (modeledCards[card.name] || 0) + Number(card.quantity || 1);
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
    },
    // Snapshot of the recommendation at review time, so the report can note how the
    // registered deck deviated from the modeled build.
    modeledBuild: build ? { id: build.id, name: build.name, label: build.label, score: build.score, cards: modeledCards } : null
  };
}

function reviewSourceEvidence(deck) {
  const activeSources = activeSourceData();
  const deckNames = new Set([...(deck?.cards || []), ...(deck?.lands || [])]
    .map((card) => normalizeCardName(card.name))
    .filter(Boolean));
  const resolved = status.kind === 'demo' ? null : resolveSourceImport('seventeenLands');
  return {
    setCode: draftState.setCode || null,
    format: draftState.format || null,
    sourceLabel: resolved?.label || (status.kind === 'demo' ? '17Lands sample' : null),
    seventeenLands: activeSources.seventeenLands
      .filter((row) => deckNames.has(row.key || normalizeCardName(row.name)))
      .map((row) => ({ ...row }))
  };
}

function reviewContext() {
  const deck = reviewDeckSnapshot();
  return {
    draftId: draftState.draftId,
    setCode: draftState.setCode,
    format: draftState.format,
    deck,
    // Preserve the exact rows that informed IIH analysis. Historical reviews must
    // not change when the user later imports a different set or event format.
    sourceEvidence: reviewSourceEvidence(deck)
  };
}

function seventeenLandsForReview(review) {
  if (Array.isArray(review?.sourceEvidence?.seventeenLands)) return review.sourceEvidence.seventeenLands;
  if (review?.format) return resolveSourceImport('seventeenLands', review.format)?.data || [];
  // Legacy reviews did not retain their format. Preserve their old best-effort
  // behavior until a future migration can recover it from Arena history.
  return activeSourceData().seventeenLands;
}

function presentedReviewState() {
  const completed = reviewState.reviews || [];
  const activeRelated = reviewState.active ? [reviewState.active, ...completed] : completed;
  const analyze = (review, relatedReviews) => analyzePostGameReview(review, {
    seventeenLands: seventeenLandsForReview(review),
    relatedReviews
  });
  const analyzed = completed.map((review) => analyze(review, completed));
  const eventGroups = reviewEventGroups(analyzed, { currentDraftId: draftState.draftId, currentFormat: draftState.format });
  const latest = analyze(reviewState.latest, activeRelated);
  // The final game of a decided event carries the draft wrap-up instead of advice
  // about a deck that has no next game.
  for (const group of eventGroups) {
    const wrapUp = eventWrapUpVerdict(group);
    if (!wrapUp) continue;
    const finalGameId = group.games[group.games.length - 1]?.id;
    for (const target of [analyzed.find((review) => review.id === finalGameId), latest?.id === finalGameId ? latest : null]) {
      if (target?.postGame) target.postGame.verdict = { ...wrapUp, deviation: target.postGame.verdict?.deviation };
    }
  }
  return {
    ...reviewState,
    active: analyze(reviewState.active, activeRelated),
    latest,
    reviews: analyzed,
    eventGroups
  };
}

function rebuildLatestLegacyReview(logPath) {
  const reviews = reviewTracker.snapshot().reviews || [];
  const legacy = reviews.find((review) => Number(review.captureVersion || 0) < 4 && review.matchId && review.deck?.total >= 35);
  if (!legacy) return false;
  const replayParser = new ArenaLogParser({ catalog, maxEvents: 240 });
  const replayTracker = new GameReviewTracker({ maxReviews: 1 });
  const context = {
    draftId: legacy.draftId,
    setCode: legacy.setCode,
    format: legacy.format,
    deck: legacy.deck,
    sourceEvidence: legacy.sourceEvidence
  };
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
  return evaluateRecommendationGate({
    recommendations,
    demo: status.kind === 'demo',
    hasSeventeenLands: Boolean(resolveSourceImport('seventeenLands')),
    hasUntapped: Boolean(resolveSourceImport('untapped')),
    contextLabel: [draftState.setCode, draftState.format].filter(Boolean).join(' ') || 'this set'
  });
}

function applyScryfallPayload(payload, source = payload?.source || 'cache') {
  if (!payload?.cards?.length) return;
  scryfallIndex = buildScryfallIndex(payload.cards);
  scryfallState = {
    kind: 'ready',
    setCode: payload.setCode || ACTIVE_SET.code,
    setName: payload.setName || ACTIVE_SET.name,
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
      scryfallState = { ...scryfallState, kind: 'loading', message: `Downloading ${ACTIVE_SET.name} card images from Scryfall` };
      sendState();
    }
    const payload = await loadScryfallSet({ cachePath, setCode: ACTIVE_SET.scryfallSetCode });
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

function pickPairScoringArgs() {
  const activeSources = activeSourceData();
  return {
    seventeenLands: activeSources.seventeenLands,
    untapped: activeSources.untapped,
    archetypeCorpus: corpusStore.corpus(),
    pool: activeDraftPool(),
    excludedPoolNames: [...activePoolExclusions()],
    packNumber: draftState.packNumber,
    pickNumber: draftState.pickNumber,
    draftId: draftScopeId(),
    setCode: draftState.setCode,
    format: draftState.format,
    lane: currentDraftLane()
  };
}

// Answers "if I take this card first, what pairs with it?" for the live Pick Two pack.
function pickPairFor(firstName) {
  if (normalizeFormat(draftState.format) !== 'pick-two') return null;
  const args = pickPairScoringArgs();
  const recommendations = scoreDraftPack({ cards: draftState.pack, ...args });
  if (!recommendationGate(recommendations).ready) return null;
  return recommendPickTwoPair({ recommendations, cards: draftState.pack, firstName, ...args });
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
    archetypeCorpus: corpusStore.corpus(),
    pool: modelingPool,
    excludedPoolNames: excludedNames,
    packNumber: draftState.packNumber,
    pickNumber: draftState.pickNumber,
    draftId: draftScopeId(),
    setCode: draftState.setCode,
    format: draftState.format,
    lane: draftLane
  });
  const deckBuilds = currentDeckBuilds(draftLane);
  const activeCorpus = corpusStore.corpus();
  const corpusMatch = activeCorpus
    ? summarizeArchetypeCorpus(activeCorpus, { setCode: draftState.setCode, format: draftState.format })
    : { deckCount: 0, trophyCount: 0, archetypeCount: 0, archetypes: [], setCodes: [], formats: [] };
  const gate = recommendationGate(recommendations);
  const pickPair = gate.ready && normalizeFormat(draftState.format) === 'pick-two'
    ? recommendPickTwoPair({
        recommendations,
        cards: draftState.pack,
        seventeenLands: activeSources.seventeenLands,
        untapped: activeSources.untapped,
        archetypeCorpus: corpusStore.corpus(),
        pool: modelingPool,
        excludedPoolNames: excludedNames,
        packNumber: draftState.packNumber,
        pickNumber: draftState.pickNumber,
        draftId: draftScopeId(),
        setCode: draftState.setCode,
        format: draftState.format,
        lane: draftLane
      })
    : null;
  return {
    draft: draftState,
    recommendations,
    deckBuilds,
    selectedBuildId,
    pickPair,
    recommendationGate: gate,
    poolSummary: {
      ...poolSummary(modelingPool),
      draftedTotal: draftState.pool.length,
      excludedTotal: draftState.pool.length - modelingPool.length
    },
    poolPlan: { excludedNames },
    sources: {
      seventeenLands: sourceViewState('seventeenLands'),
      untapped: sourceViewState('untapped')
    },
    archetypeCorpus: {
      source: corpusStore.sourceInfo(),
      match: corpusMatch,
      defaults: {
        setCode: draftState.setCode || ACTIVE_SET.displayCode,
        format: draftState.format || 'Player Draft',
        eventDate: new Date().toISOString().slice(0, 10)
      },
      manualDecks: corpusStore.manualDecks().map((deck) => ({
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
    draftLane,
    status,
    arenaLog: {
      path: watchedLogPath,
      source: watchedLogPath ? (defaultLogCandidates().includes(watchedLogPath) ? 'standard' : 'custom') : 'none',
      lastActivityAt: lastLogActivityAt,
      standardAvailable: defaultLogCandidates().some((entry) => fs.existsSync(entry))
    },
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
    demo: demoDriver.state()
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

const demoDriver = createDemoDriver({
  parser,
  catalog: demoCatalog,
  setDisplayCode: ACTIVE_SET.displayCode,
  onStatus: (next) => setStatus(next),
  onBeforeStart: () => {
    tailer.stop();
    reviewArmed = false;
    matchParser.reset();
    reviewMatchDecisions.clear();
    reviewTracker.disarm();
  },
  choosePickNames: (count) => {
    if (count === 2) {
      const pair = pickPairFor(null);
      return pair ? [pair.first.name, pair.second.name] : [];
    }
    const recommendations = scoreDraftPack({ cards: draftState.pack, ...pickPairScoringArgs() });
    const top = recommendations.find((card) => card.eligible) || recommendations[0];
    return top ? [top.name] : [];
  }
});
const startDemo = demoDriver.start;
const advanceDemo = demoDriver.advance;

async function watchLog(logPath) {
  watchedLogPath = logPath;
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
    // The panel may be shrunk by hand but never dragged wider; returning to the
    // full app is the expand button's job.
    draftWindow.setMaximumSize(width, 100000);
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
    draftWindow.setMaximumSize(100000, 100000);
    draftWindow.setBounds(bounds, true);
    draftWindow.setMinimumSize(780, 620);
  }

  compactBuildMode = next;
  buildModeSource = next ? source : null;
  sendState();
}

function registerIpc() {
  ipcMain.handle('draft:bootstrap', () => viewModel());
  ipcMain.handle('draft:import-source', async (_event, source, format) => {
    if (!['seventeenLands', 'untapped'].includes(source)) throw new Error('Unknown draft data source.');
    const formatKey = SOURCE_FORMATS.includes(format) ? format : 'any';
    const sourceName = source === 'seventeenLands' ? '17Lands' : 'Untapped';
    const result = await dialog.showOpenDialog(draftWindow, {
      title: `Import ${sourceName} CSV for ${SOURCE_FORMAT_LABELS[formatKey]}`,
      properties: ['openFile'],
      filters: [{ name: 'CSV export', extensions: ['csv'] }]
    });
    if (result.canceled || !result.filePaths[0]) return viewModel();
    try {
      // Copy the chosen export into the app's own storage: the dialog grants read
      // access now, and the stored copy stays loadable after the original moves.
      const chosenPath = result.filePaths[0];
      const storagePath = importedCsvStoragePath(source, formatKey);
      const contents = fs.readFileSync(chosenPath, 'utf8');
      // Validate before replacing the app-owned copy. A bad replacement must not
      // destroy the last working import on the next restart.
      const data = parseSourceCsv(source, contents);
      writeFileAtomic(storagePath, contents);
      rememberSourceCsv(source, storagePath, formatKey, path.basename(chosenPath), data);
      writeSettings({ sourceImportPaths: sourceImportPathsForSettings() });
      setStatus({ kind: 'live', message: `${sourceName} · ${SOURCE_FORMAT_LABELS[formatKey]} · ${data.length} rows imported` });
    } catch (error) {
      setStatus({ kind: 'error', message: error.message });
    }
    return viewModel();
  });
  ipcMain.handle('draft:import-archetype-corpus', async () => {
    const result = await dialog.showOpenDialog(draftWindow, {
      title: 'Import a normalized corpus or a 17Lands game-data export',
      properties: ['openFile'],
      filters: [
        { name: 'Corpus or 17Lands game data', extensions: ['csv', 'json', 'gz'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths[0]) return viewModel();
    const filePath = result.filePaths[0];
    try {
      if (await isSeventeenLandsGameData(filePath)) {
        setStatus({ kind: 'live', message: 'Processing 17Lands game data · deriving event records' });
        const extraction = await extractTrophyDecksFromGameData(filePath, {
          onProgress: ({ phase, games }) => setStatus({
            kind: 'live',
            message: phase === 'records'
              ? `Processing 17Lands game data · ${games.toLocaleString()} games scanned`
              : 'Processing 17Lands game data · reconstructing trophy decks'
          })
        });
        const corpusPath = path.join(app.getPath('userData'), `trophy-corpus-${extraction.setCode}-${extraction.format}.json`);
        writeJsonAtomic(corpusPath, {
          source: `17Lands public dataset · ${path.basename(filePath)}`,
          license: 'Processed offline from the 17Lands public datasets (17lands.com/public_datasets)',
          generatedAt: new Date().toISOString(),
          decks: extraction.decks
        });
        loadArchetypeCorpus(corpusPath);
        writeSettings({ archetypeCorpusPath: corpusPath });
        setStatus({
          kind: 'live',
          message: `${extraction.decks.length} ${extraction.setCode} trophy decks derived from ${extraction.scanned.games.toLocaleString()} games`
        });
      } else {
        loadArchetypeCorpus(filePath);
        writeSettings({ archetypeCorpusPath: filePath });
        setStatus({ kind: 'live', message: `${corpusStore.sourceInfo().trophyCount} trophy exemplars imported` });
      }
    } catch (error) {
      setStatus({ kind: 'error', message: error.message });
    }
    return viewModel();
  });
  ipcMain.handle('draft:add-trophy-deck', (_event, value) => {
    try {
      const deck = corpusStore.addManual(value, { setCode: draftState.setCode, format: draftState.format });
      setStatus({ kind: 'live', message: `${deck.archetype} ${deck.record || `${deck.wins}-${deck.losses ?? 0}`} trophy deck saved locally` });
    } catch (error) {
      setStatus({ kind: 'error', message: error.message });
      throw error;
    }
    return viewModel();
  });
  ipcMain.handle('draft:remove-trophy-deck', (_event, deckId) => {
    corpusStore.removeManual(String(deckId || ''));
    setStatus({ kind: 'live', message: `${corpusStore.manualDecks().length} manually pasted trophy decks saved` });
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
  ipcMain.handle('draft:use-standard-log', async () => {
    const candidate = defaultLogCandidates().find((entry) => fs.existsSync(entry));
    if (!candidate) {
      setStatus({ kind: 'error', message: 'No Arena Player.log was found in the standard location. Choose the file manually.' });
      return viewModel();
    }
    await watchLog(candidate);
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
  ipcMain.handle('draft:start-demo', (_event, mode) => { startDemo(mode); return viewModel(); });
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
  ipcMain.handle('draft:pick-pair-for', (_event, cardName) => pickPairFor(String(cardName || '')));
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
  const EXTERNAL_LINKS = {
    seventeenLandsCardData: 'https://www.17lands.com/card_data',
    seventeenLandsTrophies: 'https://www.17lands.com/trophy_decks',
    // Untapped's limited card data is per-set; the slug lives in set-definitions.
    untappedCardData: untappedCardDataUrl(ACTIVE_SET.code)
  };
  ipcMain.handle('draft:open-link', (_event, key) => {
    const url = EXTERNAL_LINKS[String(key || '')];
    if (url) shell.openExternal(url);
    return Boolean(url);
  });
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
  lastLogActivityAt = Date.now();
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
  const savedSourceImports = saved.sourceImportPaths || {};
  for (const source of ['seventeenLands', 'untapped']) {
    for (const [format, savedEntry] of Object.entries(savedSourceImports[source] || {})) {
      const savedPath = typeof savedEntry === 'string' ? savedEntry : savedEntry?.path;
      const savedLabel = typeof savedEntry === 'string' ? null : savedEntry?.label;
      if (SOURCE_FORMATS.includes(format) && savedPath && fs.existsSync(savedPath)) {
        try { loadCsv(source, savedPath, format, savedLabel); } catch { /* Skip an export that moved or changed. */ }
      }
    }
    // Legacy single-path settings become the all-formats slot.
    const legacyPath = saved[`${source}Path`];
    if (!sourceStore.has(source, 'any') && legacyPath && fs.existsSync(legacyPath)) {
      try { loadCsv(source, legacyPath, 'any'); } catch { /* Keep the bundled sample if an old export moved or changed. */ }
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
