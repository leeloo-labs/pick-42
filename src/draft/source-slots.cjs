'use strict';

const { normalizeFormat } = require('./archetype-corpus.cjs');

// A format-specific import is authoritative, even if empty or mismatched.
// Preparation and live ratings must inspect the same slot; neither silently
// substitutes a different format or bypasses an exact import with bad data.
function resolveRatingsSlot(slots = [], format = 'any') {
  const key = normalizeFormat(format);
  return (key !== 'any' && slots.find((slot) => slot.format === key))
    || slots.find((slot) => slot.format === 'any')
    || null;
}

module.exports = { resolveRatingsSlot };
