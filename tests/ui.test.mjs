import assert from 'node:assert/strict';
import test from 'node:test';
import { HOME_ROW_BATCH, HOME_ROW_INITIAL, bookmarksForView, nextRowCount } from '../js/ui.js';

test('home rows first show a short window then append the next batch', () => {
  assert.equal(HOME_ROW_INITIAL, 8);
  assert.equal(HOME_ROW_BATCH, 8);
  assert.equal(nextRowCount(HOME_ROW_INITIAL, 40), HOME_ROW_INITIAL + HOME_ROW_BATCH);
  assert.equal(nextRowCount(38, 40), 40);
  assert.equal(nextRowCount(40, 40), 40);
});

test('bookmark counts use the current category and search scope', () => {
  const bookmarks = [
    { id: 'a', title: 'Arrival', category: 'films' },
    { id: 'b', title: 'Astro City', category: 'films' },
    { id: 'c', title: 'Architecture', category: 'reading' },
    { id: 'd', title: 'A site', category: 'websites' }
  ];
  const categories = [
    { id: 'films', name: '电影' },
    { id: 'reading', name: '阅读' },
    { id: 'websites', name: '网站' }
  ];

  assert.equal(bookmarksForView(bookmarks, categories, 'films').length, 2);
  assert.equal(bookmarksForView(bookmarks, categories, 'all', 'astro').length, 1);
  assert.equal(bookmarksForView(bookmarks, categories, 'home').length, 3);
});
