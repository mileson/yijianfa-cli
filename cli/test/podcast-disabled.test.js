import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInput } from '../src/index.js';
import { CONTENT_TYPES } from '../src/constants.js';
test('podcast is unavailable in CLI and rejected before dispatch', () => {
  assert.equal(CONTENT_TYPES.includes('podcast'), false);
  assert.throws(() => normalizeInput({ type: 'podcast', platforms: ['spotify'], data: { title: 'Audio' } }));
});
