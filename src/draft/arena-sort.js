'use strict';

(function exposeArenaSort(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Pick42ArenaSort = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const COLOR_ORDER = Object.freeze({ W: 0, U: 1, B: 2, R: 3, G: 4 });
  const BASIC_LAND_ORDER = Object.freeze({ Plains: 0, Island: 1, Swamp: 2, Mountain: 3, Forest: 4 });
  const nameCollator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

  function manaTokens(card) {
    const manaCost = String(card.manaCost || '');
    // Arena's local catalog writes hybrid symbols with parentheses, e.g. {1}(B/R).
    const grouped = [...manaCost.matchAll(/[{(]([^})]+)[})]/g)].map((match) => match[1].toUpperCase());
    if (grouped.length) return grouped;
    return manaCost.toUpperCase().match(/\d+|[WUBRG](?:\/[WUBRG])?|[XYZ]/g) || [];
  }

  function manaColors(card) {
    return [...new Set(manaTokens(card).join('').match(/[WUBRG]/g) || [])]
      .sort((left, right) => COLOR_ORDER[left] - COLOR_ORDER[right]);
  }

  function manaPresentation(card) {
    const tokens = manaTokens(card);
    const colors = manaColors(card);
    const fixedColors = [...new Set(tokens.filter((token) => /^[WUBRG]$/.test(token)))]
      .sort((left, right) => COLOR_ORDER[left] - COLOR_ORDER[right]);
    const hybridGroups = tokens
      .filter((token) => /^[WUBRG]\/[WUBRG]$/.test(token))
      .map((token) => token.split('/').sort((left, right) => COLOR_ORDER[left] - COLOR_ORDER[right]));
    const genericSymbols = tokens.filter((token) => !/[WUBRG]/.test(token)).join('');

    let mode = colors.length > 1 ? 'mixed' : (colors.length ? 'mono' : 'colorless');
    if (hybridGroups.length && !fixedColors.length) mode = 'hybrid';
    else if (fixedColors.length > 1) mode = 'gold';

    return {
      colors,
      fixedColors,
      genericSymbols,
      hybridGroups,
      mode,
      sourceColors: mode === 'gold' ? fixedColors : colors
    };
  }

  function colorGroup(card) {
    const colors = manaColors(card);
    if (!colors.length) return 6;
    if (colors.length > 1) return 5;
    return COLOR_ORDER[colors[0]];
  }

  function coloredPipCount(card) {
    return manaTokens(card).filter((token) => /[WUBRG]/.test(token)).length;
  }

  function colorSignature(card) {
    return manaColors(card).map((color) => COLOR_ORDER[color]).join('');
  }

  function byName(left, right) {
    return nameCollator.compare(String(left.name || ''), String(right.name || ''));
  }

  function compareArenaSpells(left, right) {
    const groupDifference = colorGroup(left) - colorGroup(right);
    if (groupDifference) return groupDifference;

    const signatureDifference = colorSignature(left).localeCompare(colorSignature(right));
    if (signatureDifference) return signatureDifference;

    const pipDifference = coloredPipCount(left) - coloredPipCount(right);
    if (pipDifference) return pipDifference;

    return byName(left, right);
  }

  function compareArenaLands(left, right) {
    const leftRank = BASIC_LAND_ORDER[left.name] ?? 5;
    const rightRank = BASIC_LAND_ORDER[right.name] ?? 5;
    return leftRank - rightRank || byName(left, right);
  }

  function sortArenaCards(cards = [], { lands = false } = {}) {
    return [...cards].sort(lands ? compareArenaLands : compareArenaSpells);
  }

  return { colorGroup, compareArenaLands, compareArenaSpells, manaColors, manaPresentation, manaTokens, sortArenaCards };
}));
