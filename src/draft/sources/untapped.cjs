'use strict';

const { normalizeCardName, numberValue, parseCsv, percentValue, readColumn } = require('../csv.cjs');

function parseUntappedCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('The Untapped CSV is empty.');

  const cards = rows.map((row) => {
    const name = readColumn(row, ['Card', 'Name', 'Card Name']);
    if (!name) return null;
    const inHandWinRateDelta = percentValue(readColumn(row, ['In Hand WR Difference', 'In Hand Win Rate Difference', 'IWD', 'IIH']));
    return {
      key: normalizeCardName(name),
      name,
      inHandWinRate: percentValue(readColumn(row, ['In Hand WR', 'In Hand Win Rate', 'GIH WR'])),
      inHandWinRateDelta,
      improvementInHand: inHandWinRateDelta,
      openingHandWinRate: percentValue(readColumn(row, ['In Opening Hand WR', 'Opening Hand WR'])),
      playedWinRate: percentValue(readColumn(row, ['Played WR', 'Played Win Rate'])),
      includedWinRate: percentValue(readColumn(row, ['Included WR', 'Included Win Rate'])),
      avgLastOffered: numberValue(readColumn(row, ['Avg Last Offered', 'Average Last Offered', 'ALSA'])),
      games: numberValue(readColumn(row, ['Total Games', 'Games', '# Games'])),
      source: 'untapped'
    };
  }).filter(Boolean);

  if (!cards.some((card) => card.inHandWinRate !== null)) {
    throw new Error('This does not look like an Untapped card-data export (In Hand WR was not found).');
  }
  return cards;
}

module.exports = { parseUntappedCsv };
