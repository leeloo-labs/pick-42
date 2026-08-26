'use strict';

// Build view: the compact Recipe overlay and its persisted checklist.

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function checklistStorageKey(build) {
  const pool = model.draft.pool
    .map((card) => String(card.grpId || `${card.name}|${card.manaCost || ''}`))
    .sort()
    .join(',');
  const draft = model.draft.draftId || model.draft.setCode || 'limited';
  return `pick42.recipe.v2.${hashString(`${draft}|${pool}`)}.${build.id}`;
}

function readRecipe(build) {
  try {
    const saved = JSON.parse(localStorage.getItem(checklistStorageKey(build)) || '{}');
    return {
      done: new Set(Array.isArray(saved.done) ? saved.done : []),
      skipped: new Set(Array.isArray(saved.skipped) ? saved.skipped : []),
      history: Array.isArray(saved.history) ? saved.history.filter((entry) => entry?.id && entry?.status) : []
    };
  } catch {
    return { done: new Set(), skipped: new Set(), history: [] };
  }
}

function writeRecipe(build, recipe) {
  localStorage.setItem(checklistStorageKey(build), JSON.stringify({
    done: [...recipe.done],
    skipped: [...recipe.skipped],
    history: recipe.history.slice(-200)
  }));
}

function currentRecipe(build) {
  const tasks = recipeTasks(build);
  const state = readRecipe(build);
  return { tasks, state, ...recipeProgress(tasks, state.done, state.skipped) };
}

function recipeDetail(task) {
  if (task.kind === 'cut') return `Drafted ${task.card.quantity || 1}× · remove every copy from Arena`;
  if (task.card.land) {
    const colors = (task.card.colors || []).join('/');
    return task.card.basic ? 'Basic land · set the final quantity' : `Drafted land${colors ? ` · ${colors}` : ''}`;
  }
  return `${compactMana(task.card.manaCost)} · ${task.card.typeLine || 'SPELL'}`;
}

function recipeQueueRow(task, state, index, current) {
  const status = state.done.has(task.id) ? 'done' : state.skipped.has(task.id) ? 'skipped' : task.id === current?.id ? 'current' : '';
  const row = element('article', `recipe-queue-row ${task.kind} ${status}`);
  const marker = element('span', 'recipe-queue-index');
  if (status === 'done') marker.append(iconElement('check'));
  else if (status === 'skipped') marker.append(iconElement('skip-forward'));
  else marker.textContent = String(index + 1).padStart(2, '0');
  row.append(marker);
  const copy = element('span', 'recipe-queue-copy');
  copy.append(element('b', '', task.card.name), element('small', '', `${task.phase} · ${task.kind === 'cut' ? '0' : task.target} TARGET`));
  row.append(copy, element('strong', 'recipe-queue-target', task.kind === 'cut' ? 'REMOVE' : `${task.target}×`));
  return row;
}

async function copyRecipeSearch(task) {
  if (!task) return;
  await window.draftCompanion.copySearch(task.card.name);
  const label = byId('recipe-copy-label');
  label.textContent = 'COPIED';
  clearTimeout(recipeCopyTimer);
  recipeCopyTimer = setTimeout(() => { label.textContent = 'COPY SEARCH'; }, 900);
}

async function advanceRecipe(status = 'done') {
  const build = chosenBuild();
  if (!build) return;
  const recipe = currentRecipe(build);
  if (!recipe.current) return;
  recipe.state.done.delete(recipe.current.id);
  recipe.state.skipped.delete(recipe.current.id);
  recipe.state[status === 'skipped' ? 'skipped' : 'done'].add(recipe.current.id);
  recipe.state.history.push({ id: recipe.current.id, status: status === 'skipped' ? 'skipped' : 'done' });
  writeRecipe(build, recipe.state);
  renderBuildOverlay();
  const next = currentRecipe(build).current;
  if (next) await copyRecipeSearch(next);
}

async function undoRecipe() {
  const build = chosenBuild();
  if (!build) return;
  const recipe = currentRecipe(build);
  const previous = recipe.state.history.pop();
  if (!previous) return;
  recipe.state.done.delete(previous.id);
  recipe.state.skipped.delete(previous.id);
  writeRecipe(build, recipe.state);
  renderBuildOverlay();
  const restored = recipeTasks(build).find((task) => task.id === previous.id);
  if (restored) await copyRecipeSearch(restored);
}

function renderBuildOverlay() {
  const builds = model.deckBuilds || [];
  const build = chosenBuild();
  byId('build-empty').hidden = Boolean(build);
  byId('build-content').hidden = !build;
  setText('build-scene-pill', model.arena?.inDeckBuilder ? 'DECK BUILDER' : 'MANUAL');

  const tabs = byId('build-archetype-tabs');
  tabs.replaceChildren();
  for (const entry of builds) {
    const tab = element('button', entry.id === build?.id ? 'active' : '');
    tab.type = 'button';
    tab.append(element('strong', '', entry.name), element('span', '', entry.score === null ? '—' : entry.score.toFixed(1)));
    tab.addEventListener('click', () => {
      selectedBuildId = entry.id;
      renderDeckBuilder();
      renderBuildOverlay();
      updateFrom(() => window.draftCompanion.selectBuild(entry.id));
    });
    tabs.append(tab);
  }
  if (!build) return;

  setText('build-name', build.name);
  setText('build-label', build.label);
  setText('build-stability', build.mana.stability);
  byId('build-stability').className = `build-stability ${build.mana.warnings.length ? 'warning' : ''}`;
  setText('build-spell-count', build.summary.spells);
  setText('build-land-count', build.summary.lands);
  setText('build-creature-count', build.summary.creatures);
  setText('build-interaction-count', build.summary.interaction);

  const recipe = currentRecipe(build);
  const total = recipe.tasks.length;
  const remaining = total - recipe.completed;
  setText('build-progress-value', `${recipe.completed}/${total}`);
  setText('build-progress-copy', remaining ? `${remaining} recipe steps left` : 'Recipe complete · verify 40 cards');
  byId('build-progress-bar').style.width = `${total ? (recipe.completed / total) * 100 : 0}%`;
  setText('recipe-step-count', `${recipe.completed} / ${total}`);

  const currentPanel = byId('recipe-current');
  const completePanel = byId('recipe-complete');
  currentPanel.hidden = !recipe.current;
  completePanel.hidden = Boolean(recipe.current);
  byId('recipe-undo').disabled = recipe.state.history.length === 0;
  if (recipe.current) {
    const position = recipe.tasks.findIndex((task) => task.id === recipe.current.id) + 1;
    setText('recipe-phase', recipe.current.phase);
    byId('recipe-phase').className = `recipe-phase ${recipe.current.kind}`;
    setText('recipe-position', `STEP ${position} OF ${total}`);
    setText('recipe-action', 'SET TO');
    setText('recipe-quantity', recipe.current.target);
    setText('recipe-card-name', recipe.current.card.name);
    setText('recipe-card-detail', recipeDetail(recipe.current));
    setText('recipe-next-label', remaining === 1 ? 'DONE' : 'DONE + NEXT');
  } else {
    const skipped = recipe.tasks.filter((task) => recipe.state.skipped.has(task.id)).length;
    byId('recipe-complete').querySelector('p').textContent = skipped
      ? `${skipped} step${skipped === 1 ? ' was' : 's were'} skipped. Review those quantities, then confirm Arena shows 40 cards.`
      : 'Every target quantity has been confirmed. Check Arena shows 40 cards before continuing.';
  }

  const list = byId('recipe-queue-list');
  list.replaceChildren();
  recipe.tasks.forEach((task, index) => list.append(recipeQueueRow(task, recipe.state, index, recipe.current)));
  hydrateIcons(list);
}
