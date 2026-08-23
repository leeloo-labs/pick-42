'use strict';

(function exposeRecipeQueue(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ArcaneRecipe = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function taskId(kind, card) {
    return `${kind}|${card.name}|${card.manaCost || ''}|${card.typeLine || ''}|${card.quantity || 1}`;
  }

  function byName(left, right) {
    return String(left.name || '').localeCompare(String(right.name || ''));
  }

  function buildRecipeTasks(build = {}) {
    const cuts = (build.excluded || build.cuts || [])
      .map((card) => ({ ...card, land: /\bLand\b/i.test(card.typeLine || '') }))
      .sort(byName);
    const spells = (build.mainDeck || [])
      .map((card) => ({ ...card, land: false }))
      .sort((left, right) => (Number(left.manaValue) || 0) - (Number(right.manaValue) || 0) || byName(left, right));
    const lands = build.lands || [];
    const draftedLands = lands.filter((card) => !card.basic).map((card) => ({ ...card, land: true })).sort(byName);
    const basics = lands.filter((card) => card.basic).map((card) => ({ ...card, land: true })).sort(byName);

    return [
      ...cuts.map((card) => ({ id: taskId('cut', card), kind: 'cut', phase: 'REMOVE EXTRAS', target: 0, card })),
      ...spells.map((card) => ({ id: taskId('add', card), kind: 'add', phase: 'SET SPELLS', target: card.quantity, card })),
      ...draftedLands.map((card) => ({ id: taskId('add', card), kind: 'add', phase: 'SET DRAFTED LANDS', target: card.quantity, card })),
      ...basics.map((card) => ({ id: taskId('add', card), kind: 'add', phase: 'SET BASICS', target: card.quantity, card }))
    ];
  }

  function recipeProgress(tasks, done = new Set(), skipped = new Set()) {
    const current = tasks.find((task) => !done.has(task.id) && !skipped.has(task.id)) || null;
    const completed = tasks.filter((task) => done.has(task.id) || skipped.has(task.id)).length;
    return { current, completed, remaining: tasks.length - completed };
  }

  return { buildRecipeTasks, recipeProgress, taskId };
}));
