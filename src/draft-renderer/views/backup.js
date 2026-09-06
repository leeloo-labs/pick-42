'use strict';

let backupPreview = null;
let backupRequest = 0;
function backupRecipes() {
  const keys = new Set([...recipeMemory.keys()]);
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('pick42.recipe.v2.')) keys.add(key);
  }
  return Object.fromEntries([...keys].map((key) => [key, JSON.parse(recipeMemory.get(key) ?? localStorage.getItem(key))]));
}
function backupMessage(message, error = false) {
  setText('backup-message', message);
  byId('backup-message').dataset.error = String(error);
}
byId('backup-export').addEventListener('click', async () => {
  byId('backup-export').disabled = true;
  try {
    const result = await window.draftCompanion.exportBackup(backupRecipes());
    backupMessage(result.canceled ? 'Export canceled.' : result.saved ? 'Backup saved.' : 'Backup download requested. Check your downloads for the file.');
  } catch (error) { backupMessage(`Backup was not exported: ${error.message}`, true); }
  finally { byId('backup-export').disabled = false; }
});
byId('backup-choose').addEventListener('click', () => byId('backup-file').click());
byId('backup-file').addEventListener('change', async () => {
  const request = ++backupRequest;
  backupPreview = null;
  byId('backup-restore').hidden = true;
  const file = byId('backup-file').files[0];
  byId('backup-file').value = '';
  if (!file) return;
  backupMessage('Checking backup…');
  try {
    if (file.size > 50 * 1024 * 1024) throw new Error('Backup exceeds the 50 MB limit');
    const preview = await window.draftCompanion.previewBackup(await file.text(), backupRecipes());
    if (request !== backupRequest) return;
    backupPreview = preview;
    const s = preview.summary;
    backupMessage(`Ready to add ${s.ratings} ratings slots, ${s.corpus} trophy-library decks, ${s.reviews} reviews, ${s.manualRecords} manual event records, ${s.decisions} decisions, ${s.recipes} recipes and ${s.preferences} preferences. Existing entries win on conflicts. Normal history limits apply.`);
    byId('backup-restore').hidden = false;
  } catch (error) {
    if (request === backupRequest) backupMessage(`Backup was not loaded: ${error.message}`, true);
  }
});
byId('backup-restore').addEventListener('click', async () => {
  if (!backupPreview) return;
  byId('backup-restore').disabled = true;
  byId('backup-choose').disabled = true;
  try {
    const current = backupRecipes();
    const result = await window.draftCompanion.restoreBackup(backupPreview.token, current);
    const latest = backupRecipes();
    for (const [key, recipe] of Object.entries(result.recipes)) {
      if (Object.hasOwn(latest, key)) continue;
      const text = JSON.stringify(recipe);
      recipeMemory.set(key, text);
      recipeSaveQueue.save(key, 'recipe progress', () => localStorage.setItem(key, text));
    }
    model = result.model;
    render();
    backupPreview = null;
    byId('backup-restore').hidden = true;
    const unsaved = [...(model.persistence?.unsaved || []), ...recipeSaveQueue.labels()];
    backupMessage(unsaved.length ? 'Backup added to this session. Some data is not yet saved; use RETRY SAVES before closing Pick 42.' : 'Backup merged and saved locally. Existing entries kept.');
  } catch (error) { backupMessage(`Restore did not finish: ${error.message}. Existing entries are kept; you can retry.`, true); }
  finally { byId('backup-restore').disabled = false; byId('backup-choose').disabled = false; }
});
