'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ArenaLogParser } = require('../src/core/arena-log-parser.cjs');

const projectRoot = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(projectRoot, 'fixtures', 'demo-cards.json'), 'utf8'));

test('reconstructs a match from full and diff game-state messages', () => {
  const parser = new ArenaLogParser({ catalog });
  parser.feed(fs.readFileSync(path.join(projectRoot, 'fixtures', 'demo-match.log'), 'utf8'));
  const state = parser.snapshot();

  assert.equal(state.matchId, 'demo-match');
  assert.equal(state.localSeatId, 1);
  assert.deepEqual(state.turn, {
    number: 6,
    phase: 'Combat',
    step: 'Declare attackers',
    activeSeatId: 1,
    prioritySeatId: 1,
    decisionSeatId: 1
  });
  assert.equal(state.players.find((player) => player.seatId === 2).life, 6);
  assert.deepEqual(state.hand.map((card) => card.name), ['Monstrous Rage']);
  assert.equal(state.zones.find((zone) => zone.seatId === 1).graveyard, 1);
  assert.equal(state.zones.find((zone) => zone.seatId === 2).hand, 4);
  assert.equal(state.availableActions[0].card.name, 'Charming Scoundrel');
  assert.equal(state.availableActions[0].card.power, 2);
  assert.ok(state.events.some((event) => event.title === 'Opponent lost 3 life'));
  assert.ok(state.events.some((event) => event.title === '3 damage dealt'));
});

test('parses game-state JSON nested in Arena Payload strings', () => {
  const parser = new ArenaLogParser();
  const nestedMessage = {
    greToClientMessages: [{
      type: 'GREMessageType_GameStateMessage',
      systemSeatIds: [2],
      gameStateMessage: {
        gameInfo: { matchID: 'nested-match', gameNumber: 1 },
        players: [
          { systemSeatNumber: 1, lifeTotal: 20 },
          { systemSeatNumber: 2, lifeTotal: 19 }
        ]
      }
    }]
  };
  parser.feed(JSON.stringify({ Payload: JSON.stringify(nestedMessage) }));
  const state = parser.snapshot();

  assert.equal(state.matchId, 'nested-match');
  assert.equal(state.localSeatId, 2);
  assert.equal(state.players.find((player) => player.seatId === 2).label, 'You');
});

test('does not invent identities for hidden opponent hand objects', () => {
  const parser = new ArenaLogParser({ catalog });
  parser.feed(fs.readFileSync(path.join(projectRoot, 'fixtures', 'demo-match.log'), 'utf8'));
  const state = parser.snapshot();

  assert.equal(state.zones.find((zone) => zone.seatId === 2).hand, 4);
  assert.deepEqual(state.knownOpponentCards.map((card) => card.name).sort(), ['Hamlet Glutton', 'Rootrider Faun']);
});

test('clears known cards and match-scoped state when a new game begins', () => {
  const parser = new ArenaLogParser({
    catalog: {
      3001: { name: 'Game One Card', typeLine: 'Creature' },
      3002: { name: 'Game Two Card', typeLine: 'Creature' }
    }
  });

  const gameState = (gameNumber, instanceId, grpId) => JSON.stringify({
    greToClientMessages: [{
      type: 'GREMessageType_GameStateMessage',
      systemSeatIds: [1],
      gameStateMessage: {
        type: 'GameStateType_Full',
        gameInfo: { matchID: 'best-of-three-match', gameNumber },
        players: [
          { systemSeatNumber: 1, lifeTotal: 20 },
          { systemSeatNumber: 2, lifeTotal: 20 }
        ],
        gameObjects: [{
          instanceId,
          grpId,
          type: 'GameObjectType_Card',
          ownerSeatId: 2,
          controllerSeatId: 2
        }],
        zones: [{
          zoneId: gameNumber * 100,
          type: 'ZoneType_Battlefield',
          ownerSeatId: 2,
          objectInstanceIds: [instanceId]
        }]
      }
    }]
  });

  parser.feed(gameState(1, 401, 3001));
  assert.deepEqual(parser.snapshot().knownOpponentCards.map((card) => card.name), ['Game One Card']);

  parser.feed(gameState(2, 501, 3002));
  const secondGame = parser.snapshot();
  assert.equal(secondGame.gameNumber, 2);
  assert.deepEqual(secondGame.knownOpponentCards.map((card) => card.name), ['Game Two Card']);
  assert.equal(secondGame.battlefield.length, 1);
});
