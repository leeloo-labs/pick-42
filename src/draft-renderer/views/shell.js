'use strict';

// Shell chrome: status bar, view switching, source menus, corpus dialog, and the render orchestrator.

function renderStatus() {
  byId('status-dot').className = `status-dot ${model.status?.kind || ''}`;
  setText('status-message', model.status?.message || 'Ready');
  const gate = model.recommendationGate;
  const draftedTotal = model.poolSummary?.draftedTotal || 0;
  setText('coverage-label', gate.total
    ? `${gate.coveredByBoth} / ${gate.total} draftable cards covered by both sources`
    : (draftedTotal ? `No active pack · ${draftedTotal} cards drafted` : 'Waiting for a draft pack'));

  const source17 = model.sources.seventeenLands;
  const sourceUt = model.sources.untapped;
  const shortFormat = { any: 'all', premier: 'premier', quick: 'quick', traditional: 'trad', 'pick-two': 'pick 2' };
  const sourceLabel = (source) => {
    if (model.status?.kind === 'demo') return 'sample';
    if (source.kind !== 'import') return 'no data';
    return `${source.count} · ${shortFormat[source.activeFormat] || source.activeFormat}`;
  };
  setText('source-17-label', sourceLabel(source17));
  setText('source-ut-label', sourceLabel(sourceUt));
  byId('import-17lands').title = `${source17.label} · click to manage imports per draft type`;
  byId('import-untapped').title = `${sourceUt.label} · click to manage imports per draft type`;
  const arenaLog = model.arenaLog || {};
  setText('source-log-label', arenaLog.source === 'standard' ? 'watching' : (arenaLog.source === 'custom' ? 'custom file' : 'not found'));
  byId('choose-log').title = arenaLog.path ? `Following ${arenaLog.path}` : 'No Arena Player.log found';
  const corpus = model.archetypeCorpus || {};
  const corpusSource = corpus.source || { kind: 'empty', trophyCount: 0, label: 'No corpus' };
  const corpusMatch = corpus.match || { trophyCount: 0, archetypeCount: 0 };
  const corpusLabel = corpusSource.kind === 'empty'
    ? 'Import corpus'
    : (corpusMatch.trophyCount ? `${corpusMatch.trophyCount} match` : `${corpusSource.trophyCount} · no match`);
  setText('source-meta-label', corpusLabel);
  byId('import-archetypes').title = corpusSource.kind === 'empty'
    ? 'Import an authorized trophy-deck corpus (CSV or JSON)'
    : `${corpusSource.label} · ${corpusMatch.trophyCount} matching trophies across ${corpusMatch.archetypeCount} archetypes`;
  byId('restart-demo').hidden = model.status?.kind !== 'demo';
}

function corpusFormatValue(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('quick')) return 'QuickDraft';
  if (normalized.includes('traditional')) return 'TraditionalDraft';
  if (normalized.includes('pick-two') || normalized.includes('picktwo')) return 'PickTwoDraft';
  return 'PremierDraft';
}

function setCorpusEntryMessage(message, kind = '') {
  const node = byId('corpus-entry-message');
  node.textContent = message;
  node.className = `corpus-entry-message ${kind}`;
}

function seedCorpusForm() {
  const defaults = model.archetypeCorpus?.defaults || {};
  if (defaults.setCode) byId('corpus-set-code').placeholder = defaults.setCode;
  if (!byId('corpus-set-code').value) byId('corpus-set-code').value = defaults.setCode || '';
  if (!byId('corpus-event-date').value) byId('corpus-event-date').value = defaults.eventDate || '';
  byId('corpus-format').value = corpusFormatValue(defaults.format);
}

function renderCorpusManager() {
  const corpus = model.archetypeCorpus || {};
  const manualDecks = corpus.manualDecks || [];
  const match = corpus.match || { trophyCount: 0 };
  setText('corpus-library-title', `${manualDecks.length} pasted deck${manualDecks.length === 1 ? '' : 's'}`);
  const matchPill = byId('corpus-match-pill');
  matchPill.textContent = match.trophyCount ? `${match.trophyCount} MATCHING` : 'NO ACTIVE MATCH';
  matchPill.className = `corpus-match-pill ${match.trophyCount ? 'active' : ''}`;

  const list = byId('corpus-manual-list');
  list.replaceChildren();
  for (const deck of [...manualDecks].reverse()) {
    const row = element('article', 'corpus-manual-row');
    const copy = element('div');
    const title = element('div', 'corpus-manual-title');
    title.append(element('strong', '', deck.archetype || 'Unknown archetype'));
    const pips = deckColorPipsElement(deck.colors, deck.splashColors);
    if (pips) title.append(pips);
    copy.append(
      title,
      element('small', '', `${deck.setCode} · ${deck.format} · ${deck.record} · ${deck.total} cards${deck.rank ? ` · ${deck.rank}` : ''}`)
    );
    const remove = element('button');
    remove.type = 'button';
    remove.title = 'Remove pasted deck';
    remove.setAttribute('aria-label', 'Remove pasted deck');
    remove.append(iconElement('trash-2'));
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Remove the ${deck.archetype || deck.setCode} ${deck.record} deck from the local corpus?`)) return;
      await updateFrom(() => window.draftCompanion.removeTrophyDeck(deck.id));
    });
    row.append(copy, remove);
    list.append(row);
  }
  if (!manualDecks.length) list.append(element('p', 'corpus-manual-empty', 'No pasted decks yet. Copy a complete deck from a 17Lands trophy page to begin building the local library.'));
  hydrateIcons(list);
}

function openCorpusManager() {
  seedCorpusForm();
  renderCorpusManager();
  setCorpusEntryMessage('A complete main deck must contain at least 40 cards.');
  const dialog = byId('corpus-dialog');
  if (!dialog.open) dialog.showModal();
  byId('corpus-deck-text').focus();
}

async function savePastedTrophyDeck() {
  const button = byId('corpus-save');
  button.disabled = true;
  setCorpusEntryMessage('Validating deck and trophy record…');
  try {
    const next = await window.draftCompanion.addTrophyDeck({
      setCode: byId('corpus-set-code').value,
      format: byId('corpus-format').value,
      record: byId('corpus-record').value,
      eventDate: byId('corpus-event-date').value,
      archetype: byId('corpus-archetype').value,
      rank: byId('corpus-rank').value,
      sourceUrl: byId('corpus-source-url').value,
      deckText: byId('corpus-deck-text').value
    });
    model = next;
    render();
    byId('corpus-record').value = '';
    byId('corpus-archetype').value = '';
    byId('corpus-rank').value = '';
    byId('corpus-source-url').value = '';
    byId('corpus-deck-text').value = '';
    setCorpusEntryMessage('Trophy deck saved to the local corpus.', 'success');
  } catch (error) {
    setCorpusEntryMessage(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

function renderView() {
  const compact = Boolean(model.arena?.compactBuildMode);
  if (compact && activeView !== 'build') {
    activeView = 'build';
  } else if (!compact && activeView === 'build') {
    activeView = 'decks';
  }
  document.body.classList.toggle('build-mode', compact);
  byId('draft-view').hidden = activeView !== 'draft';
  byId('deck-view').hidden = activeView !== 'decks';
  byId('play-view').hidden = activeView !== 'play';
  byId('build-view').hidden = activeView !== 'build';
  byId('show-draft').classList.toggle('active', activeView === 'draft');
  byId('show-decks').classList.toggle('active', activeView === 'decks');
  byId('show-play').classList.toggle('active', activeView === 'play');
  setText('deck-ready-count', (model.deckBuilds || []).length);
  setText('play-count', (model.review?.reviews || []).length);
}

function render() {
  if (!model) return;
  if (model.selectedBuildId && (model.deckBuilds || []).some((build) => build.id === model.selectedBuildId)) selectedBuildId = model.selectedBuildId;
  if (!viewInitialized) {
    activeView = model.draft.pool.length >= 40 && (model.deckBuilds || []).length ? 'decks' : 'draft';
    viewInitialized = true;
  }
  if (selectedName && !model.recommendations.some((card) => card.name === selectedName)) selectedName = null;
  renderStatus();
  renderSourceMenu();
  renderDecision();
  renderLane();
  renderRankingLens();
  renderHero();
  renderRanking();
  renderPool();
  renderCorpusManager();
  renderDeckBuilder();
  renderReview();
  renderBuildOverlay();
  renderView();
  hydrateIcons();
}

const SOURCE_FORMAT_ROWS = [
  ['any', 'All draft types'],
  ['premier', 'Premier Draft'],
  ['quick', 'Quick Draft'],
  ['traditional', 'Traditional Draft'],
  ['pick-two', 'Pick Two Draft']
];
let sourceMenuOpen = null;

function relativeTime(timestamp) {
  if (!timestamp) return 'nothing yet this session';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function renderLogMenu(menu) {
  const arenaLog = model?.arenaLog || {};
  const heading = element('header');
  heading.append(
    element('strong', '', 'ARENA LOG'),
    element('small', '', 'Pick 42 follows this file live to track your drafts and games. Nothing is uploaded.')
  );
  menu.append(heading);

  const state = element('div', 'source-menu-status');
  const dot = element('span', `log-dot ${arenaLog.source === 'standard' ? '' : (arenaLog.source === 'custom' ? 'custom' : 'none')}`);
  const stateTitle = element('strong');
  stateTitle.append(dot, document.createTextNode(
    arenaLog.source === 'standard'
      ? 'Watching the standard Arena location'
      : (arenaLog.source === 'custom' ? 'Watching a custom file' : 'No log file found')
  ));
  state.append(stateTitle);
  if (arenaLog.path) state.append(element('small', '', arenaLog.path));
  state.append(element('small', '', `Last activity: ${relativeTime(arenaLog.lastActivityAt)}`));
  menu.append(state);

  const standardRow = element('button', 'source-menu-row');
  standardRow.type = 'button';
  const standardCopy = element('span', 'source-menu-copy');
  standardCopy.append(
    element('strong', '', 'Use the standard location'),
    element('small', '', arenaLog.standardAvailable ? 'Re-detect and rescan the default Arena log' : 'No log found in the default location yet')
  );
  standardRow.append(standardCopy, element('span', 'source-menu-action', 'RESCAN'));
  standardRow.addEventListener('click', () => {
    sourceMenuOpen = null;
    renderSourceMenu();
    updateFrom(() => window.draftCompanion.useStandardLog());
  });
  menu.append(standardRow);

  const chooseRow = element('button', 'source-menu-row');
  chooseRow.type = 'button';
  const chooseCopy = element('span', 'source-menu-copy');
  chooseCopy.append(
    element('strong', '', 'Choose a different file…'),
    element('small', '', 'Point Pick 42 at another Player.log')
  );
  chooseRow.append(chooseCopy, element('span', 'source-menu-action', 'BROWSE'));
  chooseRow.addEventListener('click', () => {
    sourceMenuOpen = null;
    renderSourceMenu();
    updateFrom(() => window.draftCompanion.chooseLog());
  });
  menu.append(chooseRow);

  // Finding Player.log is the hardest step of setup: it lives in a hidden
  // folder, and browser file pickers refuse Arena's folder outright. Spell out
  // the working route whenever no log is connected.
  if (!arenaLog.path) {
    const isMac = /Mac/i.test(navigator.platform);
    const isWebShell = document.body.classList.contains('web-shell');
    const logPath = isMac
      ? '~/Library/Logs/Wizards Of The Coast/MTGA/Player.log'
      : '%USERPROFILE%\\AppData\\LocalLow\\Wizards Of The Coast\\MTGA\\Player.log';
    const help = element('div', 'source-menu-help');
    help.append(element('strong', '', 'WHERE IS PLAYER.LOG?'));
    help.append(element('code', 'source-menu-path', logPath));
    if (isWebShell) {
      help.append(element('small', '', isMac
        ? 'The browser’s file picker cannot open this folder (Chrome blocks the Library folder). In Finder press ⇧⌘G, paste the path above, then drag Player.log onto the Pick 42 window.'
        : 'If the picker refuses the AppData folder, open it in Explorer and drag Player.log onto the Pick 42 window.'));
      help.append(element('small', '', 'For real card names in live drafts, also drag arena-card-catalog.json from the desktop app’s data folder (next to its imports).'));
    } else {
      help.append(element('small', '', isMac
        ? 'The Library folder is hidden: press ⇧⌘G in the file picker and paste the path above.'
        : 'Paste the path above into the file picker’s location bar.'));
    }
    const copyPath = element('button', 'source-menu-copy-path', 'COPY PATH');
    copyPath.type = 'button';
    copyPath.addEventListener('click', async (event) => {
      event.stopPropagation();
      await window.draftCompanion.copySearch(logPath);
      copyPath.textContent = 'COPIED';
      setTimeout(() => { copyPath.textContent = 'COPY PATH'; }, 900);
    });
    help.append(copyPath);
    menu.append(help);
  }

  menu.append(element('small', 'source-menu-note', 'Seeing nothing during a draft? In Arena, enable Options → Account → Detailed Logs, then restart Arena.'));
}

function renderSourceMenu() {
  const menu = byId('source-menu');
  if (!sourceMenuOpen) {
    menu.hidden = true;
    menu.replaceChildren();
    return;
  }
  menu.hidden = false;
  menu.replaceChildren();
  if (sourceMenuOpen === 'log') {
    renderLogMenu(menu);
    return;
  }
  const source = sourceMenuOpen;
  const view = model?.sources?.[source];
  const heading = element('header');
  heading.append(
    element('strong', '', source === 'seventeenLands' ? '17LANDS IMPORTS' : 'UNTAPPED IMPORTS'),
    element('small', '', 'Assign each CSV export to the draft type it was filtered for.')
  );
  menu.append(heading);
  for (const [formatId, label] of SOURCE_FORMAT_ROWS) {
    const entry = view?.imports?.[formatId] || null;
    const row = element('button', `source-menu-row ${view?.activeFormat === formatId ? 'active' : ''}`);
    row.type = 'button';
    const copy = element('span', 'source-menu-copy');
    copy.append(
      element('strong', '', label + (view?.activeFormat === formatId ? ' · in use' : '')),
      element('small', '', entry ? `${entry.count} rows · ${entry.label}` : 'No import')
    );
    row.append(copy, element('span', 'source-menu-action', entry ? 'REPLACE' : 'IMPORT'));
    row.addEventListener('click', () => {
      sourceMenuOpen = null;
      renderSourceMenu();
      updateFrom(() => window.draftCompanion.importSource(source, formatId));
    });
    menu.append(row);
  }

  const linkRow = element('button', 'source-menu-row source-menu-link');
  linkRow.type = 'button';
  const linkCopy = element('span', 'source-menu-copy');
  linkCopy.append(
    element('strong', '', source === 'seventeenLands' ? 'Get a fresh export' : 'Get a fresh export'),
    element('small', '', source === 'seventeenLands' ? '17lands.com · Card Data · export CSV' : 'mtga.untapped.gg · Limited card data · export CSV')
  );
  const linkAction = element('span', 'source-menu-action');
  linkAction.append(iconElement('external-link'));
  linkRow.append(linkCopy, linkAction);
  linkRow.addEventListener('click', () => {
    window.draftCompanion.openLink(source === 'seventeenLands' ? 'seventeenLandsCardData' : 'untappedCardData');
  });
  menu.append(linkRow);
  hydrateIcons(menu);
}

function toggleSourceMenu(source, event) {
  event.stopPropagation();
  sourceMenuOpen = sourceMenuOpen === source ? null : source;
  renderSourceMenu();
}
