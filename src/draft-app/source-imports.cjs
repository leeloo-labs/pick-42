'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizeFormat } = require('../draft/archetype-corpus.cjs');
const { parseSeventeenLandsCsv } = require('../draft/sources/seventeenlands.cjs');
const { parseUntappedCsv } = require('../draft/sources/untapped.cjs');

const SOURCE_FORMATS = ['any', 'premier', 'quick', 'traditional', 'pick-two'];
const SOURCE_FORMAT_LABELS = { any: 'all draft types', premier: 'Premier Draft', quick: 'Quick Draft', traditional: 'Traditional Draft', 'pick-two': 'Pick Two Draft' };

// Holds every imported 17Lands/Untapped CSV by draft-type slot plus the bundled
// sample rows, and answers which data feeds a given live format.
function createSourceImportStore() {
  const imports = { seventeenLands: {}, untapped: {} };
  let samples = { seventeenLands: [], untapped: [] };

  const parse = (source, text) => (source === 'seventeenLands' ? parseSeventeenLandsCsv(text) : parseUntappedCsv(text));

  const remember = (source, filePath, format, label, data) => {
    imports[source][format] = { label: label || path.basename(filePath), count: data.length, path: filePath, data };
    return data;
  };

  const loadCsv = (source, filePath, format = 'any', label = null) =>
    remember(source, filePath, format, label, parse(source, fs.readFileSync(filePath, 'utf8')));

  const loadSamples = (fixturePaths) => {
    samples = {
      seventeenLands: parseSeventeenLandsCsv(fs.readFileSync(fixturePaths.seventeenLands, 'utf8')),
      untapped: parseUntappedCsv(fs.readFileSync(fixturePaths.untapped, 'utf8'))
    };
  };

  // The live draft's format selects its matching import; the all-formats slot backs it up.
  const resolve = (source, format) => {
    const entries = imports[source] || {};
    const key = normalizeFormat(format);
    if (key !== 'any' && entries[key]) return { format: key, ...entries[key] };
    if (entries.any) return { format: 'any', ...entries.any };
    return null;
  };

  const inventory = (source) => {
    const result = {};
    for (const format of SOURCE_FORMATS) {
      const entry = imports[source][format];
      result[format] = entry ? { label: entry.label, count: entry.count } : null;
    }
    return result;
  };

  const viewState = (source, { demo, format }) => {
    const sampleLabel = source === 'seventeenLands' ? '17Lands sample' : 'Untapped sample';
    if (demo) {
      return { kind: 'sample', label: sampleLabel, count: samples[source].length, activeFormat: null, imports: inventory(source) };
    }
    const resolved = resolve(source, format);
    return {
      kind: resolved ? 'import' : 'none',
      label: resolved ? resolved.label : sampleLabel,
      count: resolved ? resolved.count : 0,
      activeFormat: resolved ? resolved.format : null,
      imports: inventory(source)
    };
  };

  const settingsPayload = () => {
    const payload = {};
    for (const source of ['seventeenLands', 'untapped']) {
      payload[source] = {};
      for (const [format, entry] of Object.entries(imports[source])) {
        if (entry?.path) payload[source][format] = { path: entry.path, label: entry.label };
      }
    }
    return payload;
  };

  const activeData = ({ demo, format }) => {
    if (demo) return { ...samples };
    return {
      seventeenLands: resolve('seventeenLands', format)?.data || [],
      untapped: resolve('untapped', format)?.data || []
    };
  };

  return {
    parse,
    remember,
    loadCsv,
    loadSamples,
    resolve,
    has: (source, format) => Boolean(imports[source][format]),
    inventory,
    viewState,
    settingsPayload,
    activeData
  };
}

module.exports = { SOURCE_FORMATS, SOURCE_FORMAT_LABELS, createSourceImportStore };
