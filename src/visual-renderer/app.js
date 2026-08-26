'use strict';

const guide = document.getElementById('guide');

function annotationNode(annotation, source, type) {
  const node = document.createElement('div');
  node.className = `visual-annotation ${type} ${annotation.kind}`;
  node.style.left = `${annotation.rect.x / source.width * 100}%`;
  node.style.top = `${annotation.rect.y / source.height * 100}%`;
  node.style.width = `${annotation.rect.width / source.width * 100}%`;
  node.style.height = `${annotation.rect.height / source.height * 100}%`;
  const label = document.createElement('span');
  label.textContent = `${annotation.kind === 'drop' ? 'DROP' : 'ADD'} ${annotation.quantity}`;
  node.append(label);
  node.setAttribute('aria-label', `${label.textContent} ${annotation.name}`);
  return node;
}

function badgeNode(badge) {
  const node = document.createElement('div');
  node.className = `guide-badge ${badge.variant || 'clear'}`;
  node.textContent = badge.label;
  node.setAttribute('role', 'status');
  return node;
}

window.pick42VisualGuide.onState((state) => {
  guide.replaceChildren();
  for (const annotation of state.annotations.cards) guide.append(annotationNode(annotation, state.source, 'card'));
  for (const annotation of state.annotations.deckRows) guide.append(annotationNode(annotation, state.source, 'deck-row'));
  if (state.badge) guide.append(badgeNode(state.badge));
});
