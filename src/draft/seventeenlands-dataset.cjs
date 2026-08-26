'use strict';

// Offline processing of 17Lands public game-data exports (17lands.com/public_datasets).
// The user downloads the per-set, per-format game_data CSV themselves; nothing here
// touches the network or the 17Lands API. The file has one row per recorded game with
// lead metadata columns followed by per-card opening_hand_/drawn_/tutored_/deck_/
// sideboard_ count columns. There is no event-record column, so the final record is
// derived by grouping the games of each draft_id.

const { normalizeFormat, trophyThreshold } = require('./archetype-corpus.cjs');

const DEFAULT_TROPHY_LIMIT = 200;
const REQUIRED_LEAD_COLUMNS = ['expansion', 'event_type', 'draft_id', 'draft_time', 'match_number', 'game_number', 'won'];
const HEADER_SIGNATURE = /^expansion,event_type,draft_id,draft_time,/;

// A dataset source is anything with openLines(): a fresh async iterable of
// lines per call (the extraction reads the file twice). A plain string is
// treated as a filesystem path and read through fs + zlib; browser shells pass
// their own source built on File streams and DecompressionStream.
function resolveLineSource(source) {
  if (source && typeof source.openLines === 'function') return source;
  const filePath = String(source);
  const fs = require('node:fs');
  const zlib = require('node:zlib');
  const readline = require('node:readline');
  return {
    openLines() {
      const raw = fs.createReadStream(filePath);
      let stream = raw;
      if (/\.gz$/i.test(filePath)) {
        const gunzip = zlib.createGunzip();
        raw.on('error', (error) => gunzip.destroy(error));
        stream = raw.pipe(gunzip);
      }
      const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
      return {
        async *[Symbol.asyncIterator]() {
          try {
            yield* lines;
          } finally {
            lines.close();
            stream.destroy();
          }
        }
      };
    }
  };
}

async function readDatasetHeaderLine(source) {
  for await (const line of resolveLineSource(source).openLines()) {
    return line.replace(/^\uFEFF/, '');
  }
  return '';
}

async function isSeventeenLandsGameData(source) {
  try {
    return HEADER_SIGNATURE.test(await readDatasetHeaderLine(source));
  } catch {
    return false;
  }
}

// Quote-aware split of one CSV line into raw field strings. Card-name columns are
// quoted when the name contains a comma; everything else is plain.
function splitCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      fields.push(field);
      field = '';
    } else if (character !== '\r') {
      field += character;
    }
  }
  fields.push(field);
  return fields;
}

// The lead metadata columns never contain quotes or embedded commas, so the first
// `count` fields can be split without a full quote-aware parse of the ~250KB row.
function splitLeadFields(line, count) {
  const fields = [];
  let start = 0;
  for (let taken = 0; taken < count; taken += 1) {
    const comma = line.indexOf(',', start);
    if (comma === -1) {
      fields.push(line.slice(start));
      return fields;
    }
    fields.push(line.slice(start, comma));
    start = comma + 1;
  }
  return fields;
}

function parseHeader(headerLine) {
  const columns = splitCsvLine(headerLine.replace(/^\uFEFF/, '')).map((name) => name.trim());
  const indexOf = {};
  columns.forEach((name, index) => { indexOf[name] = index; });
  for (const required of REQUIRED_LEAD_COLUMNS) {
    if (indexOf[required] === undefined) {
      throw new Error(`This file is missing the 17Lands game-data column "${required}".`);
    }
  }
  const deckColumns = [];
  let firstCardColumn = columns.length;
  columns.forEach((name, index) => {
    if (/^(?:opening_hand|drawn|tutored|deck|sideboard)_/.test(name)) firstCardColumn = Math.min(firstCardColumn, index);
    if (name.startsWith('deck_')) deckColumns.push({ index, name: name.slice(5).trim() });
  });
  if (!deckColumns.length) throw new Error('This file has no deck_ card columns; choose a 17Lands game-data export.');
  const leadCount = Math.min(firstCardColumn, columns.length);
  for (const required of REQUIRED_LEAD_COLUMNS) {
    if (indexOf[required] >= leadCount) throw new Error(`Column "${required}" appears after the card columns; this layout is not supported.`);
  }
  return { columns, indexOf, deckColumns, leadCount };
}

function titleCase(value) {
  const text = String(value || '').trim();
  return text ? text[0].toUpperCase() + text.slice(1).toLowerCase() : null;
}

// String#slice keeps the (large) source line alive in V8; retained metadata must be
// copied so a million parsed rows do not pin gigabytes of line buffers. The
// encode/decode round-trip is the browser-safe equivalent of the Buffer copy.
const utf8Encoder = typeof Buffer === 'undefined' ? new TextEncoder() : null;
const utf8Decoder = typeof Buffer === 'undefined' ? new TextDecoder() : null;
function detachedString(value) {
  const text = String(value || '');
  if (utf8Encoder) return utf8Decoder.decode(utf8Encoder.encode(text));
  return Buffer.from(text, 'utf8').toString('utf8');
}

function gameKey(matchNumber, gameNumber) {
  return (Number(matchNumber) || 0) * 1000 + (Number(gameNumber) || 0);
}

function finishTrophies(drafts, format) {
  const threshold = trophyThreshold(format);
  if (threshold === null) return [];
  const trophies = [];
  for (const draft of drafts.values()) {
    let wins;
    let losses;
    if (format === 'traditional') {
      let matchWins = 0;
      let matchLosses = 0;
      for (const match of draft.matches.values()) {
        if (match.wins > match.losses) matchWins += 1;
        else matchLosses += 1;
      }
      wins = matchWins;
      losses = matchLosses;
      if (wins !== threshold || losses !== 0) continue;
    } else {
      wins = draft.wins;
      losses = draft.losses;
      if (wins < threshold) continue;
      // A Bo1 event ends at three losses, so a qualifying run keeps at most two.
      if ((format === 'premier' || format === 'quick') && losses > 2) continue;
    }
    trophies.push({ ...draft, recordWins: wins, recordLosses: losses });
  }
  return trophies.sort((left, right) => String(right.draftTime || '').localeCompare(String(left.draftTime || '')));
}

async function extractTrophyDecksFromGameData(source, { limit = DEFAULT_TROPHY_LIMIT, onProgress = null } = {}) {
  const lineSource = resolveLineSource(source);
  // Pass 1: derive each draft's record from its game rows.
  let header = null;
  const drafts = new Map();
  let games = 0;
  let format = null;
  let setCode = null;
  {
    for await (const line of lineSource.openLines()) {
      if (!header) {
        header = parseHeader(line);
        continue;
      }
      if (!line) continue;
      const lead = splitLeadFields(line, header.leadCount);
      const draftId = lead[header.indexOf.draft_id];
      if (!draftId) continue;
      games += 1;
      const rowFormat = normalizeFormat(lead[header.indexOf.event_type]);
      if (!format) {
        format = detachedString(normalizeFormat(lead[header.indexOf.event_type]));
        setCode = detachedString(String(lead[header.indexOf.expansion] || '').trim().toUpperCase());
      }
      let draft = drafts.get(draftId);
      if (!draft) {
        draft = {
          draftId: detachedString(draftId),
          draftTime: detachedString(lead[header.indexOf.draft_time] || ''),
          rank: detachedString(header.indexOf.rank !== undefined ? lead[header.indexOf.rank] : ''),
          wins: 0,
          losses: 0,
          matches: rowFormat === 'traditional' ? new Map() : null,
          finalKey: -1
        };
        drafts.set(draft.draftId, draft);
      }
      const won = String(lead[header.indexOf.won] || '').toLowerCase() === 'true';
      if (won) draft.wins += 1;
      else draft.losses += 1;
      if (draft.matches) {
        const matchNumber = Number(lead[header.indexOf.match_number]) || 0;
        let match = draft.matches.get(matchNumber);
        if (!match) {
          match = { wins: 0, losses: 0 };
          draft.matches.set(matchNumber, match);
        }
        if (won) match.wins += 1;
        else match.losses += 1;
      }
      const key = gameKey(lead[header.indexOf.match_number], lead[header.indexOf.game_number]);
      if (key >= draft.finalKey) draft.finalKey = key;
      if (onProgress && games % 200000 === 0) onProgress({ phase: 'records', games });
    }
  }
  if (!header) throw new Error('The 17Lands game-data file is empty.');

  const allTrophies = finishTrophies(drafts, format);
  const trophies = allTrophies.slice(0, Math.max(1, limit));
  const pending = new Map(trophies.map((draft) => [draft.draftId, draft]));
  if (!pending.size) {
    throw new Error(`No completed trophy events were found among ${drafts.size} drafts in this file.`);
  }

  // Pass 2: capture the final-build main deck for the selected trophy drafts only.
  const decksByDraft = new Map();
  {
    let first = true;
    let scanned = 0;
    for await (const line of lineSource.openLines()) {
      if (first) {
        first = false;
        continue;
      }
      if (!line) continue;
      scanned += 1;
      const lead = splitLeadFields(line, header.leadCount);
      const draft = pending.get(lead[header.indexOf.draft_id]);
      if (!draft) continue;
      if (gameKey(lead[header.indexOf.match_number], lead[header.indexOf.game_number]) !== draft.finalKey) continue;
      const fields = splitCsvLine(line);
      const cards = {};
      let total = 0;
      for (const column of header.deckColumns) {
        const quantity = Number(fields[column.index]);
        if (Number.isFinite(quantity) && quantity > 0) {
          cards[column.name] = quantity;
          total += quantity;
        }
      }
      pending.delete(draft.draftId);
      if (total >= 40) decksByDraft.set(draft.draftId, { draft, cards });
      if (onProgress && scanned % 200000 === 0) onProgress({ phase: 'decks', games: scanned, remaining: pending.size });
      if (!pending.size) break;
    }
  }

  const decks = trophies
    .filter((draft) => decksByDraft.has(draft.draftId))
    .map((draft) => {
      const entry = decksByDraft.get(draft.draftId);
      return {
        id: `17lands-${draft.draftId}`,
        setCode,
        format,
        eventDate: String(draft.draftTime || '').slice(0, 10) || null,
        record: `${draft.recordWins}-${draft.recordLosses}`,
        rank: titleCase(draft.rank),
        trophy: true,
        cards: entry.cards
      };
    });
  if (!decks.length) throw new Error('No complete trophy decks could be reconstructed from this file.');

  return {
    setCode,
    format,
    decks,
    scanned: { games, drafts: drafts.size, trophies: allTrophies.length, kept: decks.length }
  };
}

module.exports = {
  DEFAULT_TROPHY_LIMIT,
  extractTrophyDecksFromGameData,
  isSeventeenLandsGameData,
  readDatasetHeaderLine
};
