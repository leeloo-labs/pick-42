'use strict';

const { normalizeFormat } = require('./archetype-corpus.cjs');

const SOURCE_FORMAT_LABELS = Object.freeze({
  any: 'Shared ratings (fallback)', premier: 'Premier Draft', quick: 'Quick Draft',
  traditional: 'Traditional Draft', 'pick-two': 'Pick Two Draft'
});

// A format-specific import is authoritative, even if empty or mismatched.
// Preparation and live ratings must inspect the same slot; neither silently
// substitutes a different format or bypasses an exact import with bad data.
function resolveRatingsSlot(slots = [], format = 'any') {
  const key = normalizeFormat(format);
  return (key !== 'any' && slots.find((slot) => slot.format === key))
    || slots.find((slot) => slot.format === 'any')
    || null;
}

module.exports = { SOURCE_FORMAT_LABELS, resolveRatingsSlot };
