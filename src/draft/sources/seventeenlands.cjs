'use strict';

const { normalizeCardName, numberValue, parseCsv, percentValue, readColumn } = require('../csv.cjs');

function parseSeventeenLandsCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('The 17Lands CSV is empty.');

  const cards = rows.map((row) => {
    const name = readColumn(row, ['Name', 'Card', 'Card Name']);
    if (!name) return null;
    // Early in a set 17Lands blanks low-sample win-rate cells. Fall back through the
    // nearest available basis so the card still counts as covered; the blend's sample
    // confidence uses the matching game count, so thin data stays appropriately shrunk.
    // "# GP" and "% GP" normalize to the same alias key, so game counts read the raw
    // "#"-prefixed headers directly.
    const bases = [
      { basis: 'GIH', winRate: percentValue(readColumn(row, ['GIH WR', 'Games in Hand Win Rate'])), games: numberValue(row['# GIH']) ?? numberValue(readColumn(row, ['Games in Hand'])) },
      { basis: 'GD', winRate: percentValue(readColumn(row, ['GD WR', 'Games Drawn Win Rate'])), games: numberValue(row['# GD']) ?? numberValue(readColumn(row, ['Games Drawn'])) },
      { basis: 'GP', winRate: percentValue(readColumn(row, ['GP WR', 'Games Played Win Rate'])), games: numberValue(row['# GP']) ?? numberValue(readColumn(row, ['Games Played'])) }
    ];
    const active = bases.find((entry) => entry.winRate !== null) || bases[0];
    const gihWinRate = active.winRate;
    const gamesNotSeenWinRate = percentValue(readColumn(row, ['GNS WR', 'Games Not Seen Win Rate']));
    const exportedImprovement = percentValue(readColumn(row, ['IIH', 'IWD', 'Improvement In Hand', 'Improvement When Drawn', 'Improvement in Hand']));
    const improvementInHand = exportedImprovement ?? (
      active.basis === 'GIH' && gihWinRate !== null && gamesNotSeenWinRate !== null
        ? Math.round((gihWinRate - gamesNotSeenWinRate) * 10) / 10
        : null
    );
    return {
      key: normalizeCardName(name),
      name,
      color: readColumn(row, ['Color', 'Colors']),
      rarity: readColumn(row, ['Rarity']),
      gihWinRate,
      winRateBasis: active.winRate !== null ? active.basis : null,
      gamesInHand: active.winRate !== null ? active.games : numberValue(readColumn(row, ['# GIH', 'GIH', 'Games in Hand'])),
      gamesNotSeen: numberValue(readColumn(row, ['# GNS', 'GNS', 'Games Not Seen'])),
      gamesNotSeenWinRate,
      alsa: numberValue(readColumn(row, ['ALSA', 'Average Last Seen At'])),
      ata: numberValue(readColumn(row, ['ATA', 'Average Taken At'])),
      improvementInHand,
      improvementWhenDrawn: improvementInHand,
      openingHandWinRate: percentValue(readColumn(row, ['OH WR', 'Opening Hand Win Rate'])),
      source: '17lands'
    };
  }).filter(Boolean);

  if (!cards.some((card) => card.gihWinRate !== null)) {
    throw new Error('This does not look like a 17Lands card-data export (GIH WR was not found).');
  }
  return cards;
}

module.exports = { parseSeventeenLandsCsv };
