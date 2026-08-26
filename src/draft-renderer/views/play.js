'use strict';

// Play view: post-game reviews, event history, and verdicts.

function renderReviewImpactList(id, cards, emptyText, formatter = null) {
  const list = byId(id);
  list.replaceChildren();
  if (!cards?.length) {
    list.append(element('span', 'review-list-empty', emptyText));
    return;
  }
  for (const card of cards) {
    const display = formatter ? formatter(card) : { label: card.label || '', detail: card.detail || '' };
    const row = element('article', `review-impact-row${display.className ? ` ${display.className}` : ''}`);
    const heading = element('div');
    const name = element('strong', '', card.name);
    if (display.icon) {
      const marker = element('span', 'review-impact-marker');
      marker.append(iconElement(display.icon));
      name.prepend(marker);
    }
    heading.append(name, element('span', '', display.label));
    row.append(heading, element('p', '', display.detail));
    list.append(row);
  }
  hydrateIcons(list);
}

function varianceLabel(entry) {
  if (!entry || entry.level === 'LOW') return 'STABLE';
  return `${entry.level} · ${String(entry.kind || '').toUpperCase()}`;
}

let expandedEventId = null;

function reviewEventGroupCard(group, displayed, latest) {
  const section = element('div', `review-event-group ${group.status}`);
  const heading = element('div', 'review-event-heading');
  const title = element('div', 'review-event-title');
  if (group.trophy) {
    const icon = element('span', 'review-event-trophy');
    icon.append(iconElement('trophy'));
    title.append(icon);
  }
  title.append(element('strong', '', group.name));
  if (group.formatLabel) title.append(element('small', '', group.formatLabel));
  const record = element('span', `review-event-record ${group.status}`);
  record.textContent = group.trophy
    ? `TROPHY · ${group.record}`
    : (group.status === 'eliminated'
      ? `${group.record} · ENDED`
      : (group.status === 'live' ? `${group.record} · LIVE` : group.record));
  heading.append(title, record);
  const chips = element('div', 'review-event-games');
  for (const entry of group.games) {
    const resultClass = entry.won === true ? 'won' : (entry.won === false ? 'lost' : '');
    const chip = element('button', `review-game-chip ${resultClass} ${displayed && entry.id === displayed.id ? 'selected' : ''}`);
    chip.type = 'button';
    const concedeNote = entry.earlyConcession ? ' · conceded early' : (/concede/i.test(String(entry.result?.reason || '')) ? ' · concede' : '');
    chip.append(
      element('strong', '', `G${entry.draftGameNumber} · ${entry.won === true ? 'WIN' : (entry.won === false ? 'LOSS' : '—')}`),
      element('small', '', `${entry.turns ? `${entry.turns} turns` : '—'}${concedeNote}`)
    );
    if (entry.completedAt) chip.title = new Date(entry.completedAt).toLocaleString();
    chip.addEventListener('click', () => {
      selectedReviewId = latest && entry.id === latest.id ? null : entry.id;
      renderReview();
    });
    chips.append(chip);
  }
  section.append(heading, chips);
  return section;
}

function renderReviewGameStrip(groups, displayed, latest) {
  const strip = byId('review-game-strip');
  strip.replaceChildren();
  const totalGames = groups.reduce((sum, group) => sum + group.games.length, 0);
  const hidden = totalGames < 1;
  strip.hidden = hidden;
  if (hidden) return;

  const featured = [];
  let past = [];
  for (const group of groups) (group.isCurrent ? featured : past).push(group);
  if (!featured.length && past.length) featured.push(past.shift());

  for (const group of featured) strip.append(reviewEventGroupCard(group, displayed, latest));

  if (past.length) {
    const bar = element('div', 'review-past-events');
    bar.append(element('span', 'review-past-label', `PREVIOUS EVENTS · ${past.length}`));
    const holdsSelection = displayed ? past.find((group) => group.games.some((entry) => entry.id === displayed.id)) : null;
    const openId = expandedEventId || holdsSelection?.draftId || null;
    for (const group of past) {
      const pill = element('button', `review-past-pill ${group.status} ${openId === group.draftId ? 'open' : ''}`);
      pill.type = 'button';
      if (group.trophy) {
        const icon = element('span', 'review-event-trophy');
        icon.append(iconElement('trophy'));
        pill.append(icon);
      }
      pill.append(element('strong', '', group.name), element('span', '', group.record));
      pill.title = `${group.name}${group.formatLabel ? ` · ${group.formatLabel}` : ''} · ${group.games.length} recorded game${group.games.length === 1 ? '' : 's'}`;
      pill.addEventListener('click', () => {
        expandedEventId = expandedEventId === group.draftId ? null : group.draftId;
        renderReview();
      });
      bar.append(pill);
    }
    strip.append(bar);
    const open = past.find((group) => group.draftId === openId);
    if (open) strip.append(reviewEventGroupCard(open, displayed, latest));
  }
  hydrateIcons(strip);
}

function renderReview() {
  const reviewState = model.review || { status: 'off', reviews: [] };
  const reviews = [...(reviewState.reviews || [])]
    .sort((left, right) => String(left.completedAt || '').localeCompare(String(right.completedAt || '')));
  const latest = reviewState.latest;
  if (selectedReviewId && latest && selectedReviewId === latest.id) selectedReviewId = null;
  const selected = selectedReviewId ? reviews.find((entry) => entry.id === selectedReviewId) || null : null;
  if (selectedReviewId && !selected) selectedReviewId = null;
  const review = selected || latest;
  const followingLatest = !selected;
  const recording = followingLatest && review?.status === 'recording';
  const ignored = Boolean(reviewState.lastIgnored) && !recording && followingLatest;
  renderReviewGameStrip(reviewState.eventGroups || [], review, latest);
  const content = byId('review-content');
  byId('review-empty').hidden = Boolean(review);
  content.hidden = !review;

  const pill = byId('review-status-pill');
  pill.className = `review-status-pill ${recording ? 'recording' : (ignored ? 'waiting' : (review ? 'complete' : 'waiting'))}`;
  pill.textContent = recording ? 'RECORDING' : (ignored ? 'IGNORED' : (review ? 'COMPLETE' : 'WAITING'));

  if (!review) {
    setText('review-title', reviewState.message || 'Ready for your next Arena game');
    setText('review-subtitle', reviewState.lastIgnored
      ? `${reviewState.lastIgnored.reason} Pick 42 is still waiting for the registered draft deck.`
      : reviewState.armed
        ? 'Keep Pick 42 running while you play. Recording begins when Arena starts the next game.'
      : 'Choose your Arena log to arm post-game review.');
    return;
  }

  const result = recording ? 'IN PROGRESS' : (review.won === true ? 'WIN' : (review.won === false ? 'LOSS' : 'COMPLETE'));
  setText('review-title', recording ? `Recording game ${review.gameNumber}` : `${result} · ${review.deck?.name || 'Limited deck'}`);
  const playedAt = review.completedAt
    ? new Date(review.completedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;
  setText('review-subtitle', recording
    ? 'Evidence is updating live. The final report will use only facts Arena exposes.'
    : (ignored
      ? `${reviewState.lastIgnored.reason} Showing the most recent matching draft game instead.`
      : `${followingLatest || !playedAt ? '' : `Game from ${playedAt} · `}${review.cardsSeenCount} cards were observed across ${review.yourTurnsObserved} of your turns. Hidden opponent cards are excluded.`));
  setText('review-result', result);
  setText('review-turns', review.turns || '—');
  setText('review-seat', review.onPlay === null ? '—' : (review.onPlay ? 'ON THE PLAY' : 'ON THE DRAW'));
  setText('review-mulligans', review.mulligans === null || review.mulligans === undefined ? '—' : review.mulligans);

  const analysis = review.postGame || {};
  const gameShape = analysis.gameShape || {};
  const shapeStat = byId('review-shape-stat');
  setText('review-shape', recording ? 'LIVE' : (gameShape.label || 'UNRATED'));
  shapeStat.className = `review-shape-stat ${recording ? 'live' : (gameShape.tier || 'unrated')}`;
  shapeStat.title = gameShape.detail || '';
  const turningPoint = analysis.turningPoint || {};
  const turningPointCard = byId('review-turning-point-card');
  turningPointCard.hidden = !turningPoint.detected;
  if (turningPoint.detected) {
    setText('review-turning-point-label', turningPoint.label || 'TACTICAL EXPOSURE');
    setText('review-turning-point-title', turningPoint.title || 'A tactical exposure changed the game');
    setText('review-turning-point-confidence', turningPoint.confidence || 'HIGH · ACTION AND LETHAL LINE CONFIRMED');
    setText('review-turning-point-summary', turningPoint.summary || 'The recorded combat action directly opened the immediately following lethal line.');
    setText('review-turning-point-action', turningPoint.action || 'Treat this as tactical evidence, not proof that the deck failed.');
  }
  const variance = analysis.variance || {};
  const varianceLevel = String(variance.level || 'LOW').toLowerCase();
  setText('review-variance-title', variance.headline || 'Collecting mana evidence');
  setText('review-variance-summary', variance.summary || 'Waiting for both players to complete turns.');
  const variancePill = byId('review-variance-level');
  variancePill.className = `review-variance-level ${varianceLevel}`;
  variancePill.textContent = String(variance.level || 'LOW').toUpperCase();
  setText('review-you-variance', varianceLabel(variance.you));
  setText('review-you-variance-detail', variance.you?.detail || 'No reliable mana record yet.');
  setText('review-opponent-variance', varianceLabel(variance.opponent));
  setText('review-opponent-variance-detail', variance.opponent?.detail || 'No reliable opponent mana record yet.');

  const drawQuality = analysis.drawQuality || {};
  setText('review-iih-summary', drawQuality.summary || 'Waiting for matching 17Lands IIH data.');
  setText('review-iih-note', drawQuality.note || 'IIH is historical correlation, not causal credit.');
  renderReviewImpactList('review-iih-cards', drawQuality.cards, 'No reliable IIH comparison was available.', (card) => {
    const className = String(card.category || '').includes('NOT DRAWN')
      ? 'not-drawn'
      : (String(card.category || '').includes('LIABILITY') ? 'liability' : 'drawn');
    return {
      label: `${card.iih > 0 ? '+' : ''}${Number(card.iih).toFixed(1)}pp IIH`,
      detail: `${card.category} · ${card.quantity ? `${card.quantity} cop${card.quantity === 1 ? 'y' : 'ies'} observed · ` : ''}${Number(card.gamesInHand || 0).toLocaleString()} games in hand`,
      className,
      icon: className === 'not-drawn' ? 'circle-dashed' : (className === 'liability' ? 'triangle-alert' : 'circle-check-big')
    };
  });

  const contributions = analysis.contributions || {};
  const deviation = analysis.buildDeviation || null;
  const buildCard = byId('review-build-card');
  buildCard.hidden = !deviation || !deviation.comparable;
  if (deviation && deviation.comparable) {
    setText('review-build-label', (deviation.modeledName || 'MODEL').toUpperCase());
    const diff = byId('review-build-diff');
    diff.replaceChildren();
    if (!deviation.differs) {
      setText('review-build-title', 'Matches the modeled build');
      setText('review-build-summary', `The registered 40 is exactly the modeled ${deviation.modeledName} build.`);
    } else {
      const changeCount = deviation.added.length + deviation.cut.length + deviation.basics.length;
      setText('review-build-title', 'Differs from the modeled build');
      setText('review-build-summary', `You made ${changeCount} change${changeCount === 1 ? '' : 's'} to the modeled ${deviation.modeledName} build before playing this game.`);
      for (const entry of deviation.added) diff.append(element('span', 'build-diff-chip added', `+${entry.quantity > 1 ? `${entry.quantity}× ` : ''}${entry.name}`));
      for (const entry of deviation.cut) diff.append(element('span', 'build-diff-chip cut', `−${entry.quantity > 1 ? `${entry.quantity}× ` : ''}${entry.name}`));
      for (const entry of deviation.basics) diff.append(element('span', 'build-diff-chip basics', `${entry.delta > 0 ? '+' : ''}${entry.delta} ${entry.name}`));
    }
  }

  renderReviewImpactList('review-mvp-list', contributions.mvp, contributions.mvpEmpty || 'No evidence-backed MVP yet.');
  renderReviewImpactList('review-lvp-list', contributions.lvp, contributions.lvpEmpty || 'No evidence-backed LVP.');
  const verdict = analysis.verdict || {};
  const series = analysis.series || {};
  const verdictCard = byId('review-verdict-card');
  verdictCard.className = `review-card review-verdict-card ${verdict.tone || 'neutral'}`;
  setText('review-verdict-eyebrow', verdict.scope === 'event' ? 'DRAFT WRAP-UP' : (verdict.scope === 'series' ? 'SERIES VERDICT' : 'GAME VERDICT'));
  setText('review-verdict-label', verdict.label || 'PENDING');
  setText('review-verdict-title', verdict.title || 'Verdict pending');
  setText('review-verdict-evidence', verdict.scope === 'event'
    ? (verdict.evidence || 'EVENT COMPLETE')
    : (verdict.scope === 'series'
      ? `${series.games} GAMES · ${series.record} · SAME DECK VERSION`
      : (recording && series.games ? `GAME IN PROGRESS · ${series.games} PRIOR MATCHING GAME${series.games === 1 ? '' : 'S'}` : '1 GAME · CURRENT DECK VERSION')));
  setText('review-verdict-summary', verdict.summary || 'Waiting for enough evidence.');
  const verdictDeviation = byId('review-verdict-deviation');
  verdictDeviation.hidden = !verdict.deviation;
  if (verdict.deviation) {
    setText('review-verdict-deviation', `Played with changes to the modeled ${verdict.deviation.modeledName} build: ${verdict.deviation.phrase}`);
  }
  setText('review-verdict-action', verdict.action || 'Keep playing.');
  byId('review-disclaimer').replaceChildren(
    iconElement('shield-check'),
    element('span', '', 'Pick 42 reports observable evidence and does not assign causal credit from one game.')
  );
}
