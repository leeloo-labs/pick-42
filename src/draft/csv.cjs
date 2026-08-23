'use strict';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field.trim());
      field = '';
    } else if (character === '\n') {
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else if (character !== '\r') {
      field += character;
    }
  }

  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (!rows.length) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function normalizedHeader(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[%#]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function readColumn(row, aliases) {
  const entries = new Map(Object.entries(row).map(([key, value]) => [normalizedHeader(key), value]));
  for (const alias of aliases) {
    const value = entries.get(normalizedHeader(alias));
    if (value !== undefined && value !== '') return value;
  }
  return null;
}

function numberValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).replace(/[%,$]/g, '').replace(/,/g, '').trim();
  const numericPart = normalized.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/)?.[0];
  const parsed = Number(numericPart);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentValue(value) {
  const parsed = numberValue(value);
  if (parsed === null) return null;
  if (/%|pp\b|pts?\b/i.test(String(value))) return parsed;
  return parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
}

function normalizeCardName(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[’‘]/g, "'")
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

module.exports = { normalizeCardName, numberValue, parseCsv, percentValue, readColumn };
