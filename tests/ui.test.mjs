import assert from 'node:assert/strict';
import test from 'node:test';
import { HOME_ROW_BATCH, HOME_ROW_INITIAL, nextRowCount } from '../js/ui.js';

test('home rows first show a short window then append the next batch', () => {
  assert.equal(HOME_ROW_INITIAL, 8);
  assert.equal(HOME_ROW_BATCH, 8);
  assert.equal(nextRowCount(HOME_ROW_INITIAL, 40), HOME_ROW_INITIAL + HOME_ROW_BATCH);
  assert.equal(nextRowCount(38, 40), 40);
  assert.equal(nextRowCount(40, 40), 40);
});
