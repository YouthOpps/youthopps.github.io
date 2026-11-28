import test from 'node:test';
import assert from 'node:assert/strict';
import { preview } from '../scripts/linkedin-preview.mjs';

const names = { first: 'First source', second: 'Second source' };
const original = { source: 'first', id: 'abc', title: 'Existing opportunity' };
const addition = { source: 'second', id: 'abc' };

test('seed, deterministic retry, and previously announced identities', () => {
  const seed = preview([original], null, names);
  assert.equal(seed.action, 'seed');
  const added = preview([addition, addition], seed.baseline, names);
  assert.equal(added.count, 1);
  assert.deepEqual(added.sources, ['Second source']);
  assert.equal(added.text, '1 new opportunity indexed.\nNew sources: Second source\nhttps://youthopps.org');
  assert.deepEqual(preview([addition], seed.baseline, names), added);
  const restored = preview([{ ...original, title: 'Edited' }, addition], added.baseline, names);
  assert.equal(restored.action, 'skip');
});

test('new opportunity at known source and malformed baseline', () => {
  const previous = preview([original], null, names).baseline;
  assert.deepEqual(preview([{ ...original, id: 'def' }], previous, names, 'tr').sources, []);
  assert.throws(() => preview([addition], { version: 2, seen: [] }, names));
  assert.throws(() => preview([addition], previous, {}));
});
