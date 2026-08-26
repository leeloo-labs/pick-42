'use strict';

const { generateSamplePack } = require('../draft/sample-draft.cjs');

const DEMO_ROUNDS = { premier: 14, 'pick-two': 7 };
const DEMO_PICKS = { premier: 1, 'pick-two': 2 };

// Drives the sample draft by feeding synthetic Arena log lines through the real
// parser, so demo mode exercises the same pipeline as a live draft.
function createDemoDriver({ parser, catalog, setDisplayCode, choosePickNames, onBeforeStart, onStatus }) {
  let mode = 'premier';
  let draft = null;

  const eventName = () => {
    const eventKind = draft?.mode === 'pick-two' ? 'PickTwoDraft' : 'PremierDraft';
    return `${eventKind}_${setDisplayCode}_20260811`;
  };

  const feedPack = () => {
    const ids = generateSamplePack({ catalog, round: draft.round, picksPerRound: DEMO_PICKS[draft.mode] });
    parser.feed(`${JSON.stringify({ draftId: 'sample-draft-session', SelfPick: draft.round, SelfPack: draft.packNumber, PackCards: ids.join(',') })}\n`);
  };

  const start = (requestedMode = mode) => {
    mode = DEMO_ROUNDS[requestedMode] ? requestedMode : 'premier';
    onBeforeStart();
    parser.reset();
    draft = { mode, packNumber: 1, round: 1, done: false };
    parser.feed(`${JSON.stringify({
      Courses: [{ CourseId: 'sample-draft-course', InternalEventName: eventName(), CurrentModule: 'PlayerDraft', ModulePayload: '', CardPool: [], DraftId: 'sample-draft-session' }]
    })}\n`);
    feedPack();
    onStatus({
      kind: 'demo',
      message: mode === 'pick-two'
        ? 'Sample Pick Two draft · three random packs · Next pick follows the recommendation'
        : 'Sample draft · three random packs · Next pick follows the recommendation'
    });
  };

  const pickIds = () => {
    const packCards = parser.snapshot().pack;
    const count = Math.min(DEMO_PICKS[draft.mode], packCards.length);
    const names = choosePickNames(count);
    const chosen = [];
    for (const name of names) {
      const match = packCards.find((card) => card.name === name && !chosen.includes(card.grpId));
      if (match) chosen.push(match.grpId);
    }
    for (const card of packCards) {
      if (chosen.length >= count) break;
      if (!chosen.includes(card.grpId)) chosen.push(card.grpId);
    }
    return chosen.slice(0, count);
  };

  const advance = () => {
    if (!draft || draft.done) return start(draft?.mode);
    const snapshot = parser.snapshot();
    if (snapshot.waitingForPack || !snapshot.packCardIds.length) {
      draft.round += 1;
      if (draft.round > DEMO_ROUNDS[draft.mode]) {
        draft.packNumber += 1;
        draft.round = 1;
      }
      if (draft.packNumber > 3) {
        draft.done = true;
        parser.feed(`${JSON.stringify({
          Courses: [{ CourseId: 'sample-draft-course', InternalEventName: eventName(), CurrentModule: 'CreateMatch', ModulePayload: '', CardPool: [...snapshot.pickedCardIds], DraftId: 'sample-draft-session' }]
        })}\n`);
        onStatus({ kind: 'demo', message: `Sample draft complete · ${snapshot.pickedCardIds.length} cards drafted · open DECKS · Next pick restarts` });
        return;
      }
      feedPack();
      onStatus({ kind: 'demo', message: `Sample pack ${draft.packNumber}, pick ${draft.round} · Next pick follows the recommendation` });
      return;
    }
    const ids = pickIds();
    if (!ids.length) return;
    parser.feed(`${JSON.stringify({ DraftId: 'sample-draft-session', GrpIds: ids, Pack: draft.packNumber, Pick: draft.round })}\n`);
    onStatus({ kind: 'demo', message: 'Pick locked in · Next pick deals the next pack' });
  };

  return {
    start,
    advance,
    state: () => (draft ? { mode: draft.mode, packNumber: draft.packNumber, round: draft.round, done: draft.done } : null)
  };
}

module.exports = { createDemoDriver };
