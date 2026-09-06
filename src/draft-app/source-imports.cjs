'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveRatingsSlot } = require('../draft/source-slots.cjs');
const { parseSeventeenLandsCsv } = require('../draft/sources/seventeenlands.cjs');
const { parseUntappedCsv } = require('../draft/sources/untapped.cjs');

const SOURCE_FORMATS = ['any', 'premier', 'quick', 'traditional', 'pick-two'];
const SOURCE_FORMAT_LABELS = { any: 'all draft types', premier: 'Premier Draft', quick: 'Quick Draft', traditional: 'Traditional Draft', 'pick-two': 'Pick Two Draft' };

// Holds every imported 17Lands/Untapped CSV by draft-type slot plus the bundled
// sample rows, and answers which data feeds a given live format.
function createSourceImportStore() {
  const profiles = Object.create(null);
  const profileKey = (setCode) => /^[a-z0-9]{1,12}$/.test(String(setCode || '').toLowerCase()) ? String(setCode).toLowerCase() : 'legacy';
  const profile = (setCode) => profiles[profileKey(setCode)] ||= { seventeenLands: {}, untapped: {} };
  const selectedImports = (source, setCode) => {
    const selected = profile(setCode)[source];
    return Object.keys(selected).length ? selected : profile('legacy')[source];
  };
  let samples = { seventeenLands: [], untapped: [] };

  const parse = (source, text) => (source === 'seventeenLands' ? parseSeventeenLandsCsv(text) : parseUntappedCsv(text));

  const remember = (source, filePath, format, label, data, setCode = 'legacy') => {
    if (!['seventeenLands', 'untapped'].includes(source) || !SOURCE_FORMATS.includes(format)) throw new Error('Unknown ratings slot');
    profile(setCode)[source][format] = { label: label || path.basename(filePath), count: data.length, path: filePath, data, setCode: profileKey(setCode), legacy: profileKey(setCode) === 'legacy' };
    return data;
  };

  const loadCsv = (source, filePath, format = 'any', label = null, setCode = 'legacy') =>
    remember(source, filePath, format, label, parse(source, fs.readFileSync(filePath, 'utf8')), setCode);

  const setSamples = (rows) => {
    samples = {
      seventeenLands: rows.seventeenLands || [],
      untapped: rows.untapped || []
    };
  };

  const loadSamples = (fixturePaths) => {
    setSamples({
      seventeenLands: parseSeventeenLandsCsv(fs.readFileSync(fixturePaths.seventeenLands, 'utf8')),
      untapped: parseUntappedCsv(fs.readFileSync(fixturePaths.untapped, 'utf8'))
    });
  };

  // The live draft's format selects its matching import; the all-formats slot backs it up.
  const resolve = (source, format, setCode = 'legacy') => resolveRatingsSlot(slotEntries(source, setCode), format);

  // Every real import with its parsed rows, for set-readiness measurement.
  const slotEntries = (source, setCode = 'legacy') => {
    const imports = selectedImports(source, setCode);
    return SOURCE_FORMATS.filter((format) => imports[format]).map((format) => ({ format, ...imports[format] }));
  };

  const inventory = (source, setCode = 'legacy') => {
    const imports = selectedImports(source, setCode);
    const result = {};
    for (const format of SOURCE_FORMATS) {
      const entry = imports[format];
      result[format] = entry ? { label: entry.label, count: entry.count, legacy: entry.legacy, setCode: entry.setCode } : null;
    }
    return result;
  };

  const viewState = (source, { demo, format, setCode = 'legacy' }) => {
    const sampleLabel = source === 'seventeenLands' ? '17Lands sample' : 'Untapped sample';
    if (demo) {
      return { kind: 'sample', label: sampleLabel, count: samples[source].length, activeFormat: null, imports: inventory(source, setCode) };
    }
    const resolved = resolve(source, format, setCode);
    return {
      kind: resolved ? 'import' : 'none',
      legacy: Boolean(resolved?.legacy),
      setCode: profileKey(setCode),
      label: resolved ? `${resolved.label}${resolved.legacy ? ' · legacy import' : ''}` : `No ${source === 'seventeenLands' ? '17Lands' : 'Untapped'} import for this draft type`,
      count: resolved ? resolved.count : 0,
      activeFormat: resolved ? resolved.format : null,
      imports: inventory(source, setCode)
    };
  };

  const settingsPayload = (existing = {}) => {
    const payload = JSON.parse(JSON.stringify(existing));
    for (const [setCode, imports] of Object.entries(profiles)) {
      payload[setCode] ||= {};
      for (const source of ['seventeenLands', 'untapped']) {
        payload[setCode][source] ||= {};
        for (const [format, entry] of Object.entries(imports[source])) {
          if (entry?.path) payload[setCode][source][format] = { path: entry.path, label: entry.label };
        }
      }
    }
    return payload;
  };

  const activeData = ({ demo, format, setCode = 'legacy' }) => {
    if (demo) return { ...samples };
    return {
      seventeenLands: resolve('seventeenLands', format, setCode)?.data || [],
      untapped: resolve('untapped', format, setCode)?.data || []
    };
  };

  return {
    parse,
    remember,
    loadCsv,
    loadSamples,
    setSamples,
    resolve,
    has: (source, format, setCode = 'legacy') => Boolean(profile(setCode)[source]?.[format]),
    inventory,
    slotEntries,
    viewState,
    settingsPayload,
    activeData
  };
}

module.exports = { SOURCE_FORMATS, SOURCE_FORMAT_LABELS, createSourceImportStore };
