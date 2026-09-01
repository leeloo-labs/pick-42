'use strict';

const {
  inferDraftLane,
  recommendPickTwoPair,
  scoreDraftPack
} = require('../draft/blend-engine.cjs');
const { normalizeCardName } = require('../draft/csv.cjs');
const { exclusionKeysForDraft, filterActivePool, updatePoolExclusion } = require('../draft/pool-plan.cjs');
const { evaluateRecommendationGate } = require('../draft/coverage-gate.cjs');
const { buildLimitedDecks, landColors } = require('../draft/deck-builder.cjs');
const { normalizeFormat, summarizeArchetypeCorpus } = require('../draft/archetype-corpus.cjs');
const { DraftLogParser } = require('../draft/draft-log-parser.cjs');
const {
  GameReviewTracker,
  analyzePostGameReview,
  clampManualRecord,
  deckFingerprint,
  draftDeckMatchDecision,
  eventWrapUpVerdict,
  replaceRebuiltReviewInPlace,
  reviewDeckIdentity,
  reviewEventGroups
} = require('../draft/game-review.cjs');
const { buildScryfallIndex, findScryfallCard } = require('../draft/scryfall.cjs');
const { computeSetReadiness } = require('../draft/set-readiness.cjs');
const { knownSetDefinitions, setDefinition } = require('../draft/set-definitions.cjs');
const { SOURCE_FORMATS } = require('./source-imports.cjs');
const { ArenaLogParser } = require('../core/arena-log-parser.cjs');
const { ArenaSceneTracker } = require('../core/arena-scene-tracker.cjs');
const { SAMPLE_COURSE_ID, createDemoDriver } = require('./demo-driver.cjs');

// The platform-agnostic draft session. Everything Pick 42 computes — draft
// state, rankings, deck builds, reviews, the full renderer view model — lives
// here; shells (Electron, web) supply persistence, file access, the log
// transport, and window concerns through the adapters below, and expose the
// companion's methods to the renderer as window.draftCompanion.
function createDraftCompanion({
  catalog,
  demoCatalog,
  catalogInfo = { count: 0, source: null },
  activeSet,
  sourceStore,
  corpusStore,
  settings,
  reviews,
  scryfall = null,
  describeLog = () => ({ path: null, source: 'none', lastActivityAt: null, standardAvailable: false }),
  readLogText = () => null,
  arenaExtras = () => ({ compactBuildMode: false, buildModeSource: null }),
  visualGuideView = () => ({ enabled: false, status: 'off', message: 'Visual guide off', permission: 'not-determined', annotationCount: 0 }),
  onState = () => {},
  onScene = () => {},
  onContextChanged = () => {},
  onDemoStart = () => {}
}) {
  const parser = new DraftLogParser({ catalog });
  const matchParser = new ArenaLogParser({ catalog });
  const reviewTracker = new GameReviewTracker();
  const sceneTracker = new ArenaSceneTracker();

  let draftState = parser.snapshot();
  let reviewState = reviewTracker.snapshot();
  // The set whose Scryfall images, external links, and readiness checks are
  // active. It follows live drafts and the SET PREP picker; the demo sample
  // universe stays pinned to the boot set, which ships fixtures.
  let currentSet = activeSet;
  let prepFormat = 'any';
  let scryfallLoadToken = 0;
  // Wins and losses entered by hand for games played away from this machine
  // (Arena on a phone writes no log here). Keyed by draftId, persisted with
  // the reviews, counted in event records, never used as game evidence.
  let manualRecords = {};
  const persistReviews = () => reviews.write({ reviews: reviewTracker.snapshot().reviews, manualRecords });
  let reviewArmed = false;
  const reviewMatchDecisions = new Map();
  let status = { kind: 'demo', message: `Sample ${activeSet.displayCode} pack · import current exports when ready` };
  let lanePreference = null;
  let poolExclusionPreference = null;
  let selectedBuildId = null;
  let scryfallIndex = {};
  let scryfallState = {
    kind: 'loading',
    setCode: currentSet.code,
    setName: currentSet.name,
    count: 0,
    fetchedAt: null,
    source: null,
    message: 'Loading Scryfall card images'
  };

  const notify = () => onState();

  function setStatus(next) {
    status = next;
    notify();
  }

  function applySetChange(setCode, { persist = true } = {}) {
    const next = setDefinition(setCode);
    if (!next.code || next.code === currentSet.code) return false;
    currentSet = next;
    if (persist) settings.write({ activeSetCode: next.code });
    scryfallIndex = {};
    scryfallState = {
      kind: 'loading',
      setCode: next.code,
      setName: next.name,
      count: 0,
      fetchedAt: null,
      source: null,
      message: `Loading ${next.name} card images`
    };
    void initializeScryfall();
    onContextChanged();
    return true;
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

  const activeSourceData = () => sourceStore.activeData({ demo: status.kind === 'demo', format: draftState.format });
  const resolveSourceImport = (source, format = draftState.format) => sourceStore.resolve(source, format);

  function draftScopeId() {
    return String(draftState.draftId || (status.kind === 'demo' ? `demo-${activeSet.code}` : 'unidentified-draft'));
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
    const liveDraftId = draftState.draftId === SAMPLE_COURSE_ID ? null : draftState.draftId;
    const eventGroups = reviewEventGroups(analyzed, { currentDraftId: liveDraftId, currentFormat: draftState.format, manualRecords });
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

  function rebuildLatestLegacyReview() {
    const stored = reviewTracker.snapshot().reviews || [];
    const legacy = stored.find((review) => Number(review.captureVersion || 0) < 5 && review.matchId && review.deck?.total >= 35);
    if (!legacy) return false;
    const logText = readLogText();
    if (!logText) return false;
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
      replayParser.feed(logText);
    } catch {
      return false;
    }
    const rebuilt = replayTracker.snapshot().reviews.find((review) => review.id === legacy.id);
    if (!rebuilt) return false;
    const next = replaceRebuiltReviewInPlace(stored, legacy, rebuilt);
    reviewTracker.hydrate(next);
    persistReviews();
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
      setCode: payload.setCode || currentSet.code,
      setName: payload.setName || currentSet.name,
      count: payload.cards.length,
      fetchedAt: payload.fetchedAt || null,
      source,
      message: `${payload.cards.length} Scryfall cards · ${source}`
    };
  }

  async function initializeScryfall() {
    if (!scryfall) return;
    const token = ++scryfallLoadToken;
    const forSet = currentSet;
    const cached = await scryfall.readCache(forSet);
    if (token !== scryfallLoadToken) return;
    if (cached?.cards?.length) {
      applyScryfallPayload(cached, 'cache');
      notify();
    }

    try {
      if (!cached) {
        scryfallState = { ...scryfallState, kind: 'loading', message: `Downloading ${forSet.name} card images from Scryfall` };
        notify();
      }
      const payload = await scryfall.load(forSet);
      if (token !== scryfallLoadToken) return;
      applyScryfallPayload(payload, payload.source);
    } catch (error) {
      if (token !== scryfallLoadToken) return;
      scryfallState = {
        ...scryfallState,
        kind: cached ? 'ready' : 'offline',
        message: cached ? 'Using cached Scryfall images' : `Scryfall unavailable · ${error.message}`
      };
    }
    notify();
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
        seventeenLands: sourceStore.viewState('seventeenLands', { demo: status.kind === 'demo', format: draftState.format }),
        untapped: sourceStore.viewState('untapped', { demo: status.kind === 'demo', format: draftState.format })
      },
      archetypeCorpus: {
        source: corpusStore.sourceInfo(),
        match: corpusMatch,
        defaults: {
          setCode: draftState.setCode || currentSet.displayCode,
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
      arenaLog: describeLog(),
      arena: {
        ...sceneTracker.snapshot(),
        ...arenaExtras()
      },
      visualGuide: visualGuideView(),
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
      catalog: catalogInfo,
      setPrep: buildSetPrep(),
      demo: demoDriver.state()
    };
  }

  function buildSetPrep() {
    const scryfallReady = scryfallState.kind === 'ready'
      && String(scryfallState.setCode || '').toLowerCase() === currentSet.code;
    return {
      ...computeSetReadiness({
        set: currentSet,
        format: prepFormat,
        cardNames: scryfallReady ? new Set(Object.keys(scryfallIndex)) : new Set(),
        sources: {
          seventeenLands: sourceStore.slotEntries('seventeenLands'),
          untapped: sourceStore.slotEntries('untapped')
        },
        corpusDecks: corpusStore.corpus()?.decks || [],
        images: { ready: scryfallReady, detail: scryfallState.message }
      }),
      availableSets: knownSetDefinitions().map((entry) => ({
        code: entry.code,
        displayCode: entry.displayCode,
        name: entry.name,
        active: entry.code === currentSet.code
      })),
      formats: SOURCE_FORMATS
    };
  }

  const demoDriver = createDemoDriver({
    parser,
    catalog: demoCatalog,
    setDisplayCode: activeSet.displayCode,
    onStatus: (next) => setStatus(next),
    onBeforeStart: () => {
      onDemoStart();
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
    if (Object.keys(patch).length) settings.write(patch);
  }

  parser.on('state', (nextState) => {
    const previousDraftId = draftState.draftId;
    draftState = nextState;
    if (previousDraftId && nextState.draftId && previousDraftId !== nextState.draftId) {
      selectedBuildId = null;
      settings.write({ selectedBuildId: null });
    }
    // A live draft names its own set; follow it so images, links, and
    // readiness all point at what is actually being drafted.
    const liveSetCode = String(nextState.setCode || '').trim().toLowerCase();
    if (liveSetCode && status.kind !== 'demo' && liveSetCode !== currentSet.code) applySetChange(liveSetCode);
    onContextChanged();
    notify();
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
    notify();
  });
  reviewTracker.on('complete', () => persistReviews());
  sceneTracker.on('scene', (nextScene) => {
    onScene(nextScene);
    onContextChanged();
    notify();
  });

  // Log-session lifecycle. The shell owns the transport (fs tailer, browser
  // file polling); the companion owns what the bytes mean.
  function beginLogSession() {
    reviewArmed = false;
    matchParser.reset();
    reviewMatchDecisions.clear();
    parser.reset();
    sceneTracker.reset();
    draftState = parser.snapshot();
  }

  function feedLog(chunk) {
    parser.feed(chunk);
    sceneTracker.feed(chunk);
    if (reviewArmed) matchParser.feed(chunk);
  }

  // Called once the transport finishes its initial historical scan: only games
  // played from here on count, so an old match is never mistaken for a new one.
  function completeLogScan() {
    migrateLegacyDraftPreferences(draftState);
    if (selectedBuildId && !currentDeckBuilds().some((build) => build.id === selectedBuildId)) {
      selectedBuildId = null;
      settings.write({ selectedBuildId: null });
    }
    rebuildLatestLegacyReview();
    matchParser.reset();
    reviewMatchDecisions.clear();
    reviewTracker.arm(reviewContext());
    reviewArmed = true;
  }

  function logRotated() {
    parser.reset();
    matchParser.reset();
    reviewMatchDecisions.clear();
    reviewTracker.arm(reviewContext());
    sceneTracker.reset();
    draftState = parser.snapshot();
    setStatus({ kind: 'loading', message: 'Arena started a new log session' });
  }

  // Restore persisted preferences and completed reviews.
  function hydrate() {
    // The store was once the bare reviews array; both shapes stay readable.
    const stored = reviews.read();
    reviewTracker.hydrate(Array.isArray(stored) ? stored : stored?.reviews || []);
    manualRecords = (stored && !Array.isArray(stored) && typeof stored.manualRecords === 'object' && stored.manualRecords) || {};
    delete manualRecords[SAMPLE_COURSE_ID];
    persistReviews();
    const saved = settings.read();
    lanePreference = saved.lanePreference && ['lock-no-splash', 'lock-splash', 'stay-open'].includes(saved.lanePreference.mode)
      ? saved.lanePreference
      : null;
    poolExclusionPreference = saved.poolExclusions && Array.isArray(saved.poolExclusions.names)
      ? saved.poolExclusions
      : null;
    selectedBuildId = String(saved.selectedBuildId || '').trim() || null;
    if (saved.activeSetCode) {
      const restored = setDefinition(saved.activeSetCode);
      if (restored.code !== currentSet.code) {
        currentSet = restored;
        scryfallState = { ...scryfallState, setCode: restored.code, setName: restored.name };
      }
    }
    prepFormat = SOURCE_FORMATS.includes(saved.prepFormat) ? saved.prepFormat : 'any';
    return saved;
  }

  // Cards discovered at runtime (e.g., built from Scryfall arena ids on the
  // web) fill catalog gaps in place so the live parsers see them immediately.
  function augmentCatalog(entries, info = null) {
    let added = 0;
    for (const [grpId, card] of Object.entries(entries || {})) {
      if (!catalog[grpId]) {
        catalog[grpId] = card;
        added += 1;
      }
    }
    if (info) Object.assign(catalogInfo, info);
    return added;
  }

  return {
    viewModel,
    hydrate,
    notify,
    setStatus,
    status: () => status,
    draftState: () => draftState,
    draftScopeId,
    currentDraftLane,
    beginLogSession,
    feedLog,
    completeLogScan,
    logRotated,
    initializeScryfall,
    augmentCatalog,
    startDemo: (mode) => demoDriver.start(mode),
    advanceDemo: () => demoDriver.advance(),
    sceneSnapshot: () => sceneTracker.snapshot(),
    setLanePreference(requestedMode) {
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
      settings.write({ lanePreference });
      onContextChanged();
      notify();
      return viewModel();
    },
    setActiveSet(setCode) {
      applySetChange(setCode);
      notify();
      return viewModel();
    },
    setPrepFormat(format) {
      const key = String(format || 'any');
      prepFormat = SOURCE_FORMATS.includes(key) ? key : 'any';
      settings.write({ prepFormat });
      notify();
      return viewModel();
    },
    activeSetInfo: () => currentSet,
    setManualRecord(record = {}) {
      const draftId = String(record.draftId || draftState.draftId || '');
      if (!draftId || draftId === SAMPLE_COURSE_ID) return viewModel();
      const isCurrent = draftId === String(draftState.draftId || '');
      const format = record.format
        || (isCurrent ? draftState.format : null)
        || reviewTracker.snapshot().reviews.find((review) => String(review.draftId) === draftId)?.format
        || manualRecords[draftId]?.format
        || null;
      const clamped = clampManualRecord(format, record);
      if (!clamped.wins && !clamped.losses) {
        delete manualRecords[draftId];
      } else {
        const deckName = manualRecords[draftId]?.deckName || record.deckName
          || (isCurrent ? reviewDeckSnapshot()?.name : null) || null;
        manualRecords[draftId] = { ...clamped, format: format || null, deckName, updatedAt: new Date().toISOString() };
      }
      persistReviews();
      notify();
      return viewModel();
    },
    setPoolCardExcluded(cardName, excluded) {
      const key = normalizeCardName(cardName);
      if (!key || !draftState.pool.some((card) => normalizeCardName(card.name) === key)) return viewModel();
      poolExclusionPreference = updatePoolExclusion(poolExclusionPreference, draftScopeId(), key, Boolean(excluded));
      settings.write({ poolExclusions: poolExclusionPreference });
      onContextChanged();
      notify();
      return viewModel();
    },
    selectBuild(buildId) {
      const available = new Set(currentDeckBuilds().map((build) => build.id));
      if (available.has(buildId)) {
        selectedBuildId = buildId;
        settings.write({ selectedBuildId });
        onContextChanged();
        notify();
      }
      return viewModel();
    },
    selectedBuildId: () => selectedBuildId,
    pickPairFor: (cardName) => pickPairFor(String(cardName || '')),
    addTrophyDeck(payload) {
      const value = payload && typeof payload === 'object' ? payload : {};
      const deck = corpusStore.addManual(value, { setCode: draftState.setCode, format: draftState.format });
      setStatus({ kind: 'live', message: `${deck.archetype} ${deck.record || `${deck.wins}-${deck.losses ?? 0}`} trophy deck saved locally` });
      return deck;
    },
    removeTrophyDeck(deckId) {
      corpusStore.removeManual(String(deckId || ''));
      setStatus({ kind: 'live', message: `${corpusStore.manualDecks().length} manually pasted trophy decks saved` });
    }
  };
}

module.exports = { createDraftCompanion };
