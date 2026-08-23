'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JsonEntryStream } = require('../src/core/json-entry-stream.cjs');

test('extracts JSON split across arbitrary chunks', () => {
  const documents = [];
  const stream = new JsonEntryStream((document) => documents.push(document));

  stream.push('[Arena] prefix {"alpha":1,"nested":');
  stream.push('{"text":"a } brace and an escaped \\\" quote"}} trailing\n');
  stream.push('[Arena] {"beta":2}\n');

  assert.deepEqual(documents, [
    { alpha: 1, nested: { text: 'a } brace and an escaped " quote' } },
    { beta: 2 }
  ]);
});

test('ignores non-JSON log lines', () => {
  const documents = [];
  const stream = new JsonEntryStream((document) => documents.push(document));
  stream.push('Unity warning\nstack trace without structured data\n');
  assert.deepEqual(documents, []);
});
