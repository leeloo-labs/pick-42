'use strict';

const { normalizeCardName, numberValue, parseCsv, percentValue, readColumn } = require('../csv.cjs');

function parseSeventeenLandsCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('The 17Lands CSV is empty.');

  const cards = rows.map((row) => {
    const name = readColumn(row, ['Name', 'Card', 'Card Name']);
    if (!name) return null;
    const gihWinRate = percentValue(readColumn(row, ['GIH WR', 'Games in Hand Win Rate']));
    const gamesNotSeenWinRate = percentValue(readColumn(row, ['GNS WR', 'Games Not Seen Win Rate']));
    const exportedImprovement = percentValue(readColumn(row, ['IIH', 'IWD', 'Improvement In Hand', 'Improvement When Drawn', 'Improvement in Hand']));
    const improvementInHand = exportedImprovement ?? (
      gihWinRate !== null && gamesNotSeenWinRate !== null
        ? Math.round((gihWinRate - gamesNotSeenWinRate) * 10) / 10
        : null
    );
    return {
      key: normalizeCardName(name),
      name,
      color: readColumn(row, ['Color', 'Colors']),
      rarity: readColumn(row, ['Rarity']),
      gihWinRate,
      gamesInHand: numberValue(readColumn(row, ['# GIH', 'GIH', 'Games in Hand'])),
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
