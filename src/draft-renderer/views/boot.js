'use strict';

// Event wiring and bootstrap. Loads last; every view is defined by now.

byId('show-decision-history').addEventListener('click', () => { byId('decision-history-dialog').showModal(); renderDecisionHistory(); });
byId('history-close').addEventListener('click', () => byId('decision-history-dialog').close());
byId('history-bookmarks-only').addEventListener('change', renderDecisionHistory);

const openSetPrep = () => { renderSetPrep(); byId('prep-dialog').showModal(); };
byId('show-prep').addEventListener('click', openSetPrep);
byId('empty-prep').addEventListener('click', openSetPrep);
byId('prep-close').addEventListener('click', () => byId('prep-dialog').close());

byId('retry-local-saves').addEventListener('click', async () => {
  await recipeSaveQueue.retry();
  if (window.draftCompanion.retryLocalSaves) await updateFrom(() => window.draftCompanion.retryLocalSaves());
  renderBuildOverlay();
  renderLocalSaveStatus();
});

byId('import-17lands').addEventListener('click', (event) => toggleSourceMenu('seventeenLands', event));
document.addEventListener('click', (event) => {
  if (sourceMenuOpen && !byId('source-menu').contains(event.target)) {
    sourceMenuOpen = null;
    renderSourceMenu();
  }
});
byId('ranking-contextual').addEventListener('click', () => {
  rankingMode = 'contextual';
  renderRankingLens();
  renderHero();
  renderRanking();
});
byId('ranking-raw').addEventListener('click', () => {
  rankingMode = 'raw';
  renderRankingLens();
  renderHero();
  renderRanking();
});
byId('lane-summary').addEventListener('click', () => {
  laneMenuOpen = !laneMenuOpen;
  renderLane();
});
for (const option of document.querySelectorAll('[data-lane-mode]')) {
  option.addEventListener('click', () => {
    laneMenuOpen = false;
    updateFrom(() => window.draftCompanion.setLanePreference(option.dataset.laneMode));
  });
}
byId('lane-resume-auto').addEventListener('click', () => {
  laneMenuOpen = false;
  updateFrom(() => window.draftCompanion.setLanePreference('auto'));
});
byId('import-untapped').addEventListener('click', (event) => toggleSourceMenu('untapped', event));
byId('import-archetypes').addEventListener('click', openCorpusManager);
byId('corpus-close').addEventListener('click', () => byId('corpus-dialog').close());
byId('corpus-open-trophies').addEventListener('click', () => window.draftCompanion.openLink('seventeenLandsTrophies'));
byId('corpus-paste').addEventListener('click', async () => {
  const button = byId('corpus-paste');
  button.disabled = true;
  try {
    const result = await window.draftCompanion.readClipboard();
    byId('corpus-deck-text').value = result?.text || '';
    setCorpusEntryMessage(result?.text ? 'Deck list pasted from the clipboard.' : 'The clipboard is empty.', result?.text ? 'success' : 'error');
  } catch {
    setCorpusEntryMessage('Clipboard access was denied. Paste the deck list into the text box.', 'error');
  } finally {
    button.disabled = false;
  }
});
byId('corpus-save').addEventListener('click', savePastedTrophyDeck);
byId('corpus-deck-text').addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') savePastedTrophyDeck();
});
byId('corpus-import-file').addEventListener('click', () => updateFrom(() => window.draftCompanion.importArchetypeCorpus()));
byId('choose-log').addEventListener('click', (event) => toggleSourceMenu('log', event));
byId('restart-demo').addEventListener('click', () => updateFrom(() => window.draftCompanion.startDemo()));
byId('empty-demo').addEventListener('click', () => updateFrom(() => window.draftCompanion.startDemo('premier')));
byId('empty-demo-pick-two').addEventListener('click', () => updateFrom(() => window.draftCompanion.startDemo('pick-two')));
byId('next-demo').addEventListener('click', () => updateFrom(() => window.draftCompanion.advanceDemo()));
byId('show-draft').addEventListener('click', () => { activeView = 'draft'; renderView(); });
byId('show-decks').addEventListener('click', () => { activeView = 'decks'; renderView(); });
byId('show-play').addEventListener('click', () => { activeView = 'play'; renderView(); });
byId('build-expand').addEventListener('click', () => updateFrom(() => window.draftCompanion.exitBuildMode()));
byId('build-empty-expand').addEventListener('click', () => updateFrom(() => window.draftCompanion.exitBuildMode()));
byId('build-minimize').addEventListener('click', () => window.draftCompanion.minimize());
byId('deck-side-panel-button').addEventListener('click', () => {
  updateFrom(() => window.draftCompanion.enterBuildMode());
});
byId('build-reset').addEventListener('click', () => {
  const build = chosenBuild();
  if (!build) return;
  writeRecipe(build, { done: new Set(), skipped: new Set(), history: [] });
  renderBuildOverlay();
});
byId('recipe-copy').addEventListener('click', () => {
  const build = chosenBuild();
  if (build) copyRecipeSearch(currentRecipe(build).current);
});
byId('recipe-next').addEventListener('click', () => advanceRecipe('done'));
byId('recipe-skip').addEventListener('click', () => advanceRecipe('skipped'));
byId('recipe-undo').addEventListener('click', () => undoRecipe());
byId('preview-copy-name').addEventListener('click', async () => {
  if (!previewedCardName) return;
  await copyWithFeedback(previewedCardName, 'preview-copy-name-label', 'COPY NAME');
});
byId('minimize-button').addEventListener('click', () => window.draftCompanion.minimize());
byId('close-button').addEventListener('click', () => window.draftCompanion.close());
byId('build-close').addEventListener('click', () => window.draftCompanion.close());

window.draftCompanion.onRecipeCommand((command) => {
  if (!model || activeView !== 'build') return;
  const build = chosenBuild();
  if (!build) return;
  if (command === 'copy') copyRecipeSearch(currentRecipe(build).current);
  if (command === 'next') advanceRecipe('done');
  if (command === 'undo') undoRecipe();
});

window.draftCompanion.bootstrap().then((initial) => {
  model = initial;
  render();
  deckBoardResizeObserver = new ResizeObserver(resizeDeckBoardCards);
  deckBoardResizeObserver.observe(byId('deck-columns'));
  window.draftCompanion.onState((next) => { model = next; render(); });
});
