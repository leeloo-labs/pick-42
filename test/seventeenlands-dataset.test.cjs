'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const {
  extractTrophyDecksFromGameData,
  isSeventeenLandsGameData
} = require('../src/draft/seventeenlands-dataset.cjs');
const { parseArchetypeCorpus } = require('../src/draft/archetype-corpus.cjs');

// Mirrors the public game_data_public.{SET}.{FORMAT}.csv layout: lead metadata
// columns, then opening_hand_/drawn_/tutored_/deck_/sideboard_ groups per card.
const CARDS = ['Dori, Bearer of Friends', 'Dwarven Mattock', 'Pinecone Strike', 'Plains', 'Mountain', 'Island'];

const DECK_V1 = { 'Dori, Bearer of Friends': 4, 'Dwarven Mattock': 4, 'Pinecone Strike': 15, Plains: 8, Mountain: 9 };
const DECK_V2 = { 'Dori, Bearer of Friends': 4, 'Dwarven Mattock': 5, 'Pinecone Strike': 14, Plains: 8, Mountain: 9 };
const DECK_SHORT = { Plains: 8, Mountain: 9 };

function quoted(name) {
  return name.includes(',') ? `"${name}"` : name;
}

function buildHeader() {
  const lead = ['expansion', 'event_type', 'draft_id', 'draft_time', 'game_time', 'build_index', 'match_number', 'game_number', 'rank', 'opp_rank', 'main_colors', 'splash_colors', 'on_play', 'num_mulligans', 'opp_num_mulligans', 'opp_colors', 'num_turns', 'won'];
  const cardColumns = CARDS.flatMap((name) => ['opening_hand_', 'drawn_', 'tutored_', 'deck_', 'sideboard_'].map((prefix) => quoted(`${prefix}${name}`)));
  return [...lead, ...cardColumns].join(',');
}

function gameRow({ eventType, draftId, draftTime, buildIndex = 0, matchNumber, gameNumber = 1, won, deck }) {
  const lead = ['HOB', eventType, draftId, draftTime, draftTime, buildIndex, matchNumber, gameNumber, 'platinum', 'gold', 'WR', '', 'True', '0', '0', 'UB', '9', won ? 'True' : 'False'];
  const cardFields = CARDS.flatMap((name) => ['0', '0', '0', String(deck[name] || 0), '0']);
  return [...lead, ...cardFields].join(',');
}

function premierCsv() {
  const rows = [buildHeader()];
  // Draft A: 7-2 trophy across two builds; the final game uses DECK_V2.
  for (let match = 1; match <= 9; match += 1) {
    rows.push(gameRow({
      eventType: 'PremierDraft',
      draftId: 'draft-a',
      draftTime: '2026-08-20 10:00:00',
      buildIndex: match <= 2 ? 0 : 1,
      matchNumber: match,
      won: match !== 3 && match !== 6,
      deck: match <= 2 ? DECK_V1 : DECK_V2
    }));
  }
  // Draft B: 3-3, not a trophy.
  for (let match = 1; match <= 6; match += 1) {
    rows.push(gameRow({ eventType: 'PremierDraft', draftId: 'draft-b', draftTime: '2026-08-21 10:00:00', matchNumber: match, won: match % 2 === 0, deck: DECK_V1 }));
  }
  // Draft D: malformed 7-3 run, skipped by the loss guard.
  for (let match = 1; match <= 10; match += 1) {
    rows.push(gameRow({ eventType: 'PremierDraft', draftId: 'draft-d', draftTime: '2026-08-22 10:00:00', matchNumber: match, won: match <= 7, deck: DECK_V1 }));
  }
  // Draft E: newer 7-1 trophy.
  for (let match = 1; match <= 8; match += 1) {
    rows.push(gameRow({ eventType: 'PremierDraft', draftId: 'draft-e', draftTime: '2026-08-23 10:00:00', matchNumber: match, won: match !== 4, deck: DECK_V1 }));
  }
  return `${rows.join('\n')}\n`;
}

function shortDeckCsv() {
  const rows = [buildHeader()];
  for (let match = 1; match <= 7; match += 1) {
    rows.push(gameRow({ eventType: 'PremierDraft', draftId: 'draft-s', draftTime: '2026-08-20 10:00:00', matchNumber: match, won: true, deck: DECK_SHORT }));
  }
  return `${rows.join('\n')}\n`;
}

function traditionalCsv() {
  const rows = [buildHeader()];
  const games = [
    [1, 1, true], [1, 2, true],
    [2, 1, true], [2, 2, false], [2, 3, true],
    [3, 1, false], [3, 2, true], [3, 3, true]
  ];
  for (const [matchNumber, gameNumber, won] of games) {
    rows.push(gameRow({ eventType: 'TradDraft', draftId: 'draft-c', draftTime: '2026-08-19 10:00:00', matchNumber, gameNumber, won, deck: DECK_V1 }));
  }
  return `${rows.join('\n')}\n`;
}

function writeTemp(name, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p42-dataset-'));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, contents);
  return filePath;
}

test('recognizes 17Lands game-data files and rejects normalized corpora', async () => {
  assert.equal(await isSeventeenLandsGameData(writeTemp('games.csv', premierCsv())), true);
  assert.equal(await isSeventeenLandsGameData(writeTemp('corpus.json', '{"decks": []}')), false);
  assert.equal(await isSeventeenLandsGameData(writeTemp('missing.csv.gz', 'not gzip')), false);
});

test('derives premier trophy records and keeps only the final build', async () => {
  const result = await extractTrophyDecksFromGameData(writeTemp('games.csv', premierCsv()));
  assert.equal(result.setCode, 'HOB');
  assert.equal(result.format, 'premier');
  assert.equal(result.scanned.drafts, 4);
  assert.equal(result.scanned.trophies, 2);
  assert.deepEqual(result.decks.map((deck) => deck.id), ['17lands-draft-e', '17lands-draft-a']);
  const deck = result.decks.find((entry) => entry.id === '17lands-draft-a');
  assert.equal(deck.record, '7-2');
  assert.equal(deck.rank, 'Platinum');
  assert.equal(deck.eventDate, '2026-08-20');
  assert.equal(deck.trophy, true);
  assert.equal(deck.cards['Dwarven Mattock'], 5);
  assert.equal(deck.cards['Dori, Bearer of Friends'], 4);
  assert.equal(Object.values(deck.cards).reduce((sum, quantity) => sum + quantity, 0), 40);
});

test('derives traditional trophies from match results', async () => {
  const result = await extractTrophyDecksFromGameData(writeTemp('games.csv', traditionalCsv()));
  assert.equal(result.format, 'traditional');
  assert.equal(result.decks.length, 1);
  assert.equal(result.decks[0].record, '3-0');
});

test('honors the trophy limit by recency', async () => {
  const result = await extractTrophyDecksFromGameData(writeTemp('games.csv', premierCsv()), { limit: 1 });
  assert.equal(result.scanned.trophies, 2);
  assert.equal(result.scanned.kept, 1);
  assert.deepEqual(result.decks.map((deck) => deck.id), ['17lands-draft-e']);
  assert.equal(result.decks[0].record, '7-1');
});

test('fails closed when no complete trophy deck can be reconstructed', async () => {
  await assert.rejects(
    () => extractTrophyDecksFromGameData(writeTemp('games.csv', shortDeckCsv())),
    /No complete trophy decks/
  );
});

test('reads gzip-compressed exports', async () => {
  const filePath = writeTemp('games.csv.gz', zlib.gzipSync(premierCsv()));
  const result = await extractTrophyDecksFromGameData(filePath);
  assert.equal(result.decks.length, 2);
  assert.equal(result.decks.find((deck) => deck.id === '17lands-draft-a').record, '7-2');
});

test('produces decks the archetype corpus parser accepts', async () => {
  const result = await extractTrophyDecksFromGameData(writeTemp('games.csv', premierCsv()));
  const corpus = parseArchetypeCorpus(JSON.stringify({ source: 'test', decks: result.decks }), { fileName: 'trophy.json' });
  assert.equal(corpus.decks.length, 2);
  const [deck] = corpus.decks;
  assert.equal(deck.trophy, true);
  assert.equal(deck.setCode, 'HOB');
  assert.equal(deck.format, 'premier');
  assert.deepEqual(deck.colors, ['W', 'R']);
  assert.ok(deck.archetype);
});

test('accepts an injected line source in place of a file path', async () => {
  const lines = premierCsv().split('\n');
  let opened = 0;
  const source = {
    openLines() {
      opened += 1;
      return {
        async *[Symbol.asyncIterator]() {
          yield* lines;
        }
      };
    }
  };

  assert.equal(await isSeventeenLandsGameData(source), true);
  const result = await extractTrophyDecksFromGameData(source);
  assert.equal(result.setCode, 'HOB');
  assert.equal(result.decks.length, 2);
  assert.ok(opened >= 3, 'header check plus two extraction passes each open a fresh line stream');
});
