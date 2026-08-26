'use strict';

// Renderer state shared by every view, plus the generic DOM helpers.
//
// The renderer's source of truth is the `model` pushed from the main process
// plus the explicit view-state variables below and in each view file. render()
// redraws every view from that state alone; the DOM is never read back as
// state, except for uncontrolled form inputs collected at submit time.

let model = null;
let selectedName = null;
let selectedBuildId = null;
let activeView = 'draft';
let viewInitialized = false;
let rankingMode = 'contextual';
let recipeCopyTimer = null;
let previewCopyTimer = null;
let previewedCardName = null;
let selectedReviewId = null;
let deckBoardResizeFrame = null;
let deckBoardResizeObserver = null;
let laneMenuOpen = false;

const MANA_ACCENTS = Object.freeze({ W: '#d8cda9', U: '#4d9fc9', B: '#28252d', R: '#c85b48', G: '#4c925d' });

const byId = (id) => document.getElementById(id);
const { buildRecipeTasks: recipeTasks, recipeProgress } = window.Pick42Recipe;
const { manaPresentation, manaTokens, sortArenaCards } = window.Pick42ArenaSort;

function setText(id, value) {
  byId(id).textContent = value;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconElement(name, className = '') {
  const node = element('i', className);
  node.dataset.lucide = name;
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function hydrateIcons(root = document) {
  if (!window.lucide?.createIcons) return;
  window.lucide.createIcons({
    root,
    attrs: {
      'aria-hidden': 'true',
      focusable: 'false',
      'stroke-width': 1.8
    }
  });
}

function setIcon(node, name) {
  node.replaceChildren(iconElement(name));
  hydrateIcons(node.parentElement || document);
}

function percent(value) {
  return value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`;
}

function signed(value) {
  if (value === null || value === undefined) return '—';
  return `${value >= 0 ? '+' : ''}${Number(value).toFixed(1)}`;
}

function compactMana(value) {
  return String(value || '—').replace(/[{}]/g, '');
}

function deckColorPipsElement(colors, splashColors = []) {
  const main = (colors || []).filter((color) => /^[WUBRG]$/.test(color));
  const splash = (splashColors || []).filter((color) => /^[WUBRG]$/.test(color) && !main.includes(color));
  if (!main.length && !splash.length) return null;
  const pips = element('span', 'mana-pips');
  pips.setAttribute('role', 'img');
  pips.setAttribute('aria-label', `Colors ${main.join('')}${splash.length ? ` splashing ${splash.join('')}` : ''}`);
  for (const color of main) pips.append(element('i', `mana-pip pip-${color}`, color));
  for (const color of splash) {
    const pip = element('i', `mana-pip pip-${color} pip-splash`, color);
    pip.title = `${color} splash`;
    pips.append(pip);
  }
  return pips;
}

function manaPipsElement(manaCost) {
  const tokens = manaTokens({ manaCost });
  if (!tokens.length) return null;
  const pips = element('span', 'mana-pips');
  pips.setAttribute('role', 'img');
  pips.setAttribute('aria-label', `Mana cost ${compactMana(manaCost)}`);
  for (const token of tokens) {
    if (/^[WUBRG]$/.test(token)) {
      pips.append(element('i', `mana-pip pip-${token}`, token));
    } else if (/^[WUBRG]\/[WUBRG]$/.test(token)) {
      const [left, right] = token.split('/');
      const pip = element('i', 'mana-pip pip-hybrid', `${left}${right}`);
      pip.style.setProperty('--pip-a', MANA_ACCENTS[left]);
      pip.style.setProperty('--pip-b', MANA_ACCENTS[right]);
      pips.append(pip);
    } else {
      pips.append(element('i', 'mana-pip pip-generic', token));
    }
  }
  return pips;
}

function configureImpactFlag(node, card, compact = false) {
  const flag = card?.metrics?.impactFlag;
  node.hidden = !flag;
  node.className = `impact-flag ${flag?.kind || ''} ${flag?.severity || ''}`;
  if (!flag) {
    node.textContent = '';
    node.removeAttribute('title');
    return;
  }
  const value = signed(card.metrics.drawImpact);
  node.textContent = compact ? `${flag.label} ${value}pp` : `${flag.label} · ${value}pp IIH`;
  node.title = `${flag.detail}. Confidence ${card.metrics.drawImpactConfidence}%.`;
}

function configureOutlookFlag(node, card, compact = false) {
  const outlook = rankingMode === 'contextual' ? card?.pickOutlook : null;
  node.hidden = !outlook;
  node.className = `outlook-flag ${outlook?.kind || ''}`;
  if (!outlook) {
    node.textContent = '';
    node.removeAttribute('title');
    return;
  }
  node.textContent = compact && outlook.fallback ? 'LIKELY OUT' : outlook.label;
  node.title = outlook.detail;
}

function chosenBuild() {
  const builds = model.deckBuilds || [];
  return builds.find((build) => build.id === selectedBuildId) || builds[0] || null;
}

async function updateFrom(action) {
  try {
    const next = await action();
    if (next) { model = next; render(); }
  } catch (error) {
    setText('status-message', error.message);
    byId('status-dot').className = 'status-dot error';
  }
}
