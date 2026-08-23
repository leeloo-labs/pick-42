'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function filesMatching(directory, expression) {
  try {
    return fs.readdirSync(directory)
      .filter((name) => expression.test(name))
      .map((name) => path.join(directory, name));
  } catch {
    return [];
  }
}

function cardDatabaseCandidates() {
  const home = os.homedir();
  const directories = [];

  if (process.platform === 'darwin') {
    directories.push(
      path.join(home, 'Library', 'Application Support', 'Steam', 'steamapps', 'common', 'MTGA', 'MTGA_Data', 'Downloads', 'Raw'),
      path.join(home, 'Library', 'Application Support', 'com.wizards.mtga', 'Downloads', 'Raw')
    );
  } else if (process.platform === 'win32') {
    directories.push(
      path.join(process.env['ProgramFiles(x86)'] || '', 'Steam', 'steamapps', 'common', 'MTGA', 'MTGA_Data', 'Downloads', 'Raw'),
      path.join(process.env.ProgramFiles || '', 'Wizards of the Coast', 'MTGA', 'MTGA_Data', 'Downloads', 'Raw')
    );
  } else {
    directories.push(
      path.join(home, '.local', 'share', 'Steam', 'steamapps', 'common', 'MTGA', 'MTGA_Data', 'Downloads', 'Raw')
    );
  }

  return directories
    .flatMap((directory) => filesMatching(directory, /^Raw_CardDatabase_.+\.mtga$/))
    .map((file) => ({ file, modified: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.modified - a.modified)
    .map((entry) => entry.file);
}

function manaCost(oldSchoolManaText) {
  if (!oldSchoolManaText) return '';
  return String(oldSchoolManaText)
    .replace(/o([0-9]+|[WUBRGCXYZSP])/gi, '{$1}')
    .replaceAll('o', '');
}

function abilityLocalizationIds(abilityIds) {
  return String(abilityIds || '')
    .split(',')
    .map((entry) => Number(entry.split(':').at(-1)))
    .filter(Number.isFinite);
}

function plainRulesText(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\{o([^}]+)\}/gi, '{$1}')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .trim();
}

function loadArenaCardCatalog(databasePath = cardDatabaseCandidates()[0]) {
  if (!databasePath) return { catalog: {}, source: null, count: 0 };

  try {
    const { DatabaseSync } = require('node:sqlite');
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const enumRows = database.prepare(`
      SELECT e.Type AS Type, e.Value AS Value, MAX(l.Loc) AS Label
      FROM Enums e
      LEFT JOIN Localizations_enUS l ON l.LocId = e.LocId
      GROUP BY e.Type, e.Value
    `).all();
    const enums = new Map(enumRows.map((row) => [`${row.Type}:${row.Value}`, row.Label]));

    const cards = database.prepare(`
      SELECT
        c.GrpId AS GrpId,
        COALESCE(plain.Loc, formatted.Loc) AS Name,
        c.OldSchoolManaText AS Mana,
        c.Power AS Power,
        c.Toughness AS Toughness,
        c.Types AS Types,
        c.Subtypes AS Subtypes,
        c.Supertypes AS Supertypes,
        c.AbilityIds AS AbilityIds,
        c.IsToken AS IsToken
      FROM Cards c
      LEFT JOIN Localizations_enUS plain
        ON plain.LocId = c.TitleId AND plain.Formatted = 0
      LEFT JOIN Localizations_enUS formatted
        ON formatted.LocId = c.TitleId AND formatted.Formatted = 1
    `).all();
    const wantedAbilityText = new Set(cards.flatMap((card) => abilityLocalizationIds(card.AbilityIds)));
    const abilityText = new Map();
    const formatPriority = new Map([[0, 3], [2, 2], [1, 1]]);
    for (const row of database.prepare('SELECT LocId, Formatted, Loc FROM Localizations_enUS').iterate()) {
      if (!wantedAbilityText.has(Number(row.LocId)) || !row.Loc) continue;
      const priority = formatPriority.get(Number(row.Formatted)) || 0;
      const existing = abilityText.get(Number(row.LocId));
      if (!existing || priority > existing.priority) abilityText.set(Number(row.LocId), { priority, text: plainRulesText(row.Loc) });
    }
    database.close();

    const labels = (type, csv) => String(csv || '')
      .split(',')
      .filter(Boolean)
      .map((value) => enums.get(`${type}:${value}`))
      .filter(Boolean);

    const catalog = {};
    for (const card of cards) {
      const supertypes = labels('SuperType', card.Supertypes);
      const types = labels('CardType', card.Types);
      const subtypes = labels('SubType', card.Subtypes);
      const typeLine = [...supertypes, ...types].join(' ') + (subtypes.length ? ` — ${subtypes.join(' ')}` : '');
      catalog[String(card.GrpId)] = {
        name: card.Name || `Arena card ${card.GrpId}`,
        manaCost: manaCost(card.Mana),
        typeLine,
        rulesText: abilityLocalizationIds(card.AbilityIds)
          .map((locId) => abilityText.get(locId)?.text)
          .filter(Boolean)
          .join('\n'),
        printedPower: card.Power || null,
        printedToughness: card.Toughness || null,
        isToken: Boolean(card.IsToken)
      };
    }

    return { catalog, source: databasePath, count: cards.length };
  } catch (error) {
    return { catalog: {}, source: databasePath, count: 0, error: error.message };
  }
}

module.exports = { abilityLocalizationIds, cardDatabaseCandidates, loadArenaCardCatalog, manaCost, plainRulesText };
