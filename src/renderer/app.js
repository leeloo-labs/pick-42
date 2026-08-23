'use strict';

let state = null;
let status = { kind: 'starting', message: 'Starting companion' };
let activeTab = 'live';
let collapsed = false;
let clickThrough = false;

const byId = (id) => document.getElementById(id);

function setText(id, value) {
  byId(id).textContent = value;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function localPlayer() {
  return state?.players?.find((player) => player.seatId === state.localSeatId);
}

function opponentPlayer() {
  return state?.players?.find((player) => player.seatId !== state.localSeatId);
}

function renderStatus() {
  const dot = byId('status-dot');
  dot.className = `status-dot ${status.kind || ''}`;
  setText('status-message', status.message || 'Ready');
}

function renderTurn() {
  if (!state?.matchId) {
    setText('turn-label', 'WAITING FOR ARENA');
    setText('phase-label', 'No active match');
    setText('priority-pill', 'IDLE');
    byId('priority-pill').className = 'priority-pill muted';
    return;
  }

  if (state.complete) {
    setText('priority-pill', 'COMPLETE');
    byId('priority-pill').className = 'priority-pill muted';
    return;
  }

  setText('turn-label', `GAME ${state.gameNumber || 1} · TURN ${state.turn.number || '—'}`);
  setText('phase-label', state.turn.step || state.turn.phase || 'In progress');
  const isLocalPriority = state.turn.prioritySeatId === state.localSeatId;
  const hasPriority = Boolean(state.turn.prioritySeatId);
  setText('priority-pill', hasPriority ? (isLocalPriority ? 'YOUR PRIORITY' : 'OPPONENT') : 'RESOLVING');
  byId('priority-pill').className = `priority-pill ${hasPriority && !isLocalPriority ? 'opponent' : ''}`;
}

function renderLife() {
  setText('local-life', localPlayer()?.life ?? '—');
  setText('opponent-life', opponentPlayer()?.life ?? '—');
}

function currentContext() {
  if (!state?.matchId) {
    return ['Waiting for game state', 'Choose Player.log or replay the built-in sample match.'];
  }
  const latest = state.events?.[0];
  if (latest?.kind === 'result') return [latest.title, latest.detail];
  if (state.stack?.length) {
    const top = state.stack.at(-1);
    return ['A spell or ability is on the stack', `${top.name} is waiting to resolve.`];
  }
  if (state.turn.decisionSeatId === state.localSeatId) {
    const count = state.availableActions?.length || 0;
    return ['Arena is waiting for you', count ? `${count} logged action${count === 1 ? '' : 's'} available in this decision.` : 'You currently have a game decision.'];
  }
  if (latest) return [latest.title, latest.detail];
  return [`${state.turn.phase} phase`, state.turn.prioritySeatId === state.localSeatId ? 'You have priority.' : 'Watching the visible game state.'];
}

function renderContext() {
  const [title, detail] = currentContext();
  setText('context-title', title);
  setText('context-detail', detail);
}

function renderActions() {
  const container = byId('actions-list');
  const actions = state?.availableActions || [];
  container.replaceChildren();
  setText('action-count', actions.length);

  if (!actions.length) {
    container.className = 'chip-list empty-copy';
    container.textContent = 'No player decision is currently logged.';
    return;
  }

  container.className = 'chip-list';
  for (const action of actions.slice(0, 8)) {
    const chip = element('div', 'action-chip');
    chip.append(element('b', '', action.type));
    if (action.card) chip.append(document.createTextNode(action.card.name));
    container.append(chip);
  }
}

function eventGlyph(kind) {
  return { damage: '↓', gain: '+', phase: '›', graveyard: '×', result: '★', move: '↗' }[kind] || '·';
}

function renderEvents() {
  const list = byId('event-list');
  const events = state?.events || [];
  list.replaceChildren();
  byId('timeline-empty').hidden = events.length > 0;

  for (const event of events.slice(0, 12)) {
    const item = element('li', `event-item ${event.kind || ''}`);
    item.append(element('div', 'event-marker', eventGlyph(event.kind)));
    const copy = element('div', 'event-copy');
    const title = element('strong', '', event.title);
    if (event.turn) title.append(element('span', 'event-turn', `T${event.turn}`));
    copy.append(title, element('span', '', event.detail || ''));
    item.append(copy);
    list.append(item);
  }
}

function zoneCard(zone) {
  const card = element('article', 'zone-card');
  card.append(element('span', '', zone.label));
  const stats = element('div', 'zone-stats');
  for (const [label, key] of [['HAND', 'hand'], ['LIBRARY', 'library'], ['GRAVE', 'graveyard'], ['EXILE', 'exile']]) {
    const stat = element('div', 'zone-stat');
    stat.append(element('strong', '', String(zone[key] ?? 0)), element('small', '', label));
    stats.append(stat);
  }
  card.append(stats);
  return card;
}

function renderZones() {
  const grid = byId('zone-grid');
  grid.replaceChildren();
  for (const zone of state?.zones || []) grid.append(zoneCard(zone));
  if (!grid.children.length) grid.append(element('p', 'empty-copy', 'Zone counts will appear during a match.'));
}

function compactManaCost(manaCost) {
  return manaCost ? manaCost.replaceAll('{', '').replaceAll('}', '') : '—';
}

function miniCard(card) {
  const row = element('article', 'mini-card');
  row.append(element('div', 'mana-orb', compactManaCost(card.manaCost)));
  const copy = element('div', 'mini-card-copy');
  copy.append(element('strong', '', card.name), element('span', '', card.typeLine || `Arena ID ${card.grpId || 'hidden'}`));
  row.append(copy);
  if (card.power !== null && card.toughness !== null) row.append(element('span', 'mini-card-stats', `${card.power}/${card.toughness}`));
  return row;
}

function renderCardList(containerId, cards, emptyText) {
  const container = byId(containerId);
  container.replaceChildren();
  if (!cards.length) {
    container.className = 'card-list empty-copy';
    container.textContent = emptyText;
    return;
  }
  container.className = 'card-list';
  for (const card of cards) container.append(miniCard(card));
}

function renderCards() {
  const known = state?.knownOpponentCards || [];
  const hand = state?.hand || [];
  setText('known-count', known.length);
  setText('hand-count', hand.length);
  renderCardList('known-list', known, 'No opponent cards have been revealed.');
  renderCardList('hand-list', hand, 'Your visible hand will appear here.');
}

function render() {
  renderStatus();
  renderTurn();
  renderLife();
  renderContext();
  renderActions();
  renderEvents();
  renderZones();
  renderCards();
}

function setTab(tabName) {
  activeTab = tabName;
  for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('active', tab.dataset.tab === activeTab);
  for (const panel of document.querySelectorAll('.tab-panel')) panel.classList.toggle('active', panel.id === `${activeTab}-panel`);
}

function explainLatest() {
  const latest = state?.events?.[0];
  if (!latest) return;
  const explanations = {
    damage: 'Arena reported a life-total change and a damage annotation. Pick 42 only attributes a source when that source is visible.',
    graveyard: 'The game object moved between visible zones. This records the move without inferring why it happened.',
    phase: 'The rules engine advanced the active turn, phase, or combat step.',
    move: 'A visible game object changed zones.',
    result: 'Arena recorded the game result in the current match state.'
  };
  setText('context-title', latest.title);
  setText('context-detail', explanations[latest.kind] || latest.detail);
  byId('context-card').animate(
    [{ borderColor: 'rgba(107, 216, 223, .6)' }, { borderColor: 'rgba(157, 124, 255, .19)' }],
    { duration: 650, easing: 'ease-out' }
  );
}

async function bootstrap() {
  const initial = await window.companion.bootstrap();
  state = initial.state;
  status = initial.status || status;
  clickThrough = initial.clickThrough;
  render();

  window.companion.onState((nextState) => {
    state = nextState;
    render();
  });
  window.companion.onStatus((nextStatus) => {
    status = nextStatus;
    renderStatus();
  });
  window.companion.onInteraction((interaction) => {
    clickThrough = interaction.clickThrough;
    byId('click-through-button').classList.toggle('active', clickThrough);
  });
}

for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => setTab(tab.dataset.tab));
byId('choose-log-button').addEventListener('click', () => window.companion.chooseLog());
byId('demo-button').addEventListener('click', () => window.companion.startDemo());
byId('explain-button').addEventListener('click', explainLatest);
byId('click-through-button').addEventListener('click', () => window.companion.setClickThrough(!clickThrough));
byId('collapse-button').addEventListener('click', () => {
  collapsed = !collapsed;
  document.body.classList.toggle('collapsed', collapsed);
  byId('collapse-button').textContent = collapsed ? '+' : '—';
  window.companion.collapse(collapsed);
});
byId('close-button').addEventListener('click', () => window.companion.close());

bootstrap();
