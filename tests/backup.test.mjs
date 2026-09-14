import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackupPart, inspectBackupFiles, packImagePart, parseBackupPart, planBackupParts, planBinaryParts, selectDeltaRecords, unpackImagePart, validateMultipartFiles, validateVolumeFiles } from '../js/backup.js';

function imageGroup(groupId, bytes) {
  return {
    groupId,
    display: { blob: new Blob([new Uint8Array(bytes)], { type: 'image/webp' }), hash: `hash-${groupId}`, width: 100, height: 80 },
    thumbnail: { blob: new Blob([new Uint8Array(Math.ceil(bytes / 10))], { type: 'image/webp' }), width: 50, height: 40 }
  };
}

test('binary planner splits after the 45MB budget without breaking a pair of sizes', () => {
  const parts = planBinaryParts([40 * 1024 * 1024, 10 * 1024 * 1024, 20 * 1024 * 1024], 45 * 1024 * 1024);
  assert.deepEqual(parts.map((part) => part.length), [1, 2]);
});

test('delta export keeps only bookmarks and related creators changed after the last backup', () => {
  const since = '2026-09-14T00:00:00.000Z';
  const selected = selectDeltaRecords({
    since,
    categories: [{ id: 'movies', name: '电影' }],
    creators: [
      { id: 'c1', name: 'A', createdAt: 1, updatedAt: 1 },
      { id: 'c2', name: 'B', createdAt: 2, updatedAt: Date.parse('2026-09-14T12:00:00.000Z') }
    ],
    bookmarks: [
      { id: 'old', title: 'Old', createdAt: 1, updatedAt: 1, creatorId: 'c1' },
      { id: 'new', title: 'New', createdAt: Date.parse('2026-09-14T08:00:00.000Z'), creatorId: 'c1' }
    ]
  });
  assert.deepEqual(selected.bookmarks.map((bookmark) => bookmark.id), ['new']);
  assert.deepEqual(selected.creators.map((creator) => creator.id).sort(), ['c1', 'c2']);
  assert.equal(selected.categories.length, 1);
});

test('mvpart round-trips display and thumbnail blobs without base64', async () => {
  const group = imageGroup('asset-a', 32);
  const packed = await packImagePart([
    { id: 'asset-a:display', groupId: 'asset-a', kind: 'display', hash: 'hash-a', blob: group.display.blob, width: 100, height: 80 },
    { id: 'asset-a:thumbnail', groupId: 'asset-a', kind: 'thumbnail', hash: null, blob: group.thumbnail.blob, width: 50, height: 40 }
  ], { backupId: 'backup-1', partIndex: 1 });
  const file = new File([packed], 'images-001.mvpart');
  const parsed = await unpackImagePart(file, { backupId: 'backup-1' });
  assert.equal(parsed.imageAssets.length, 2);
  assert.equal(parsed.imageAssets[0].blob.type, 'image/webp');
  assert.equal(parsed.imageAssets[0].blob.size, 32);
  assert.equal(parsed.imageAssets[1].kind, 'thumbnail');
});

test('volume validation rejects a changed image part before restore', async () => {
  const group = imageGroup('asset-a', 24);
  const imageBlob = await packImagePart([
    { id: 'asset-a:display', groupId: 'asset-a', kind: 'display', hash: 'hash-a', blob: group.display.blob, width: 100, height: 80 },
    { id: 'asset-a:thumbnail', groupId: 'asset-a', kind: 'thumbnail', hash: null, blob: group.thumbnail.blob, width: 50, height: 40 }
  ], { backupId: 'backup-1', partIndex: 1 });
  const imageFile = new File([imageBlob], 'images-001.mvpart');
  const dataFile = new File([JSON.stringify({ format: 'poster-bookmarks-data', version: 4, backupId: 'backup-1', bookmarks: [], categories: [], creators: [] })], 'data-001.json', { type: 'application/json' });
  const digest = async (file) => {
    const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
  };
  const filesMeta = [
    { filename: dataFile.name, role: 'data', bytes: dataFile.size, sha256: await digest(dataFile) },
    { filename: imageFile.name, role: 'images', bytes: imageFile.size, sha256: await digest(imageFile) }
  ];
  const checksums = new File([JSON.stringify({ format: 'poster-bookmarks-checksums', version: 4, backupId: 'backup-1', files: filesMeta })], 'checksums.json', { type: 'application/json' });
  const manifest = {
    format: 'poster-bookmarks-manifest',
    version: 4,
    backupId: 'backup-1',
    files: [...filesMeta, { filename: checksums.name, role: 'checksums', bytes: checksums.size, sha256: await digest(checksums) }]
  };
  const inspected = await inspectBackupFiles([
    new File([JSON.stringify(manifest)], 'manifest.json', { type: 'application/json' }),
    checksums,
    dataFile,
    imageFile
  ]);
  assert.equal(inspected.kind, 'v4');
  assert.equal(inspected.imageFiles[0].name, imageFile.name);
  const changed = new File(['changed'], imageFile.name);
  await assert.rejects(validateVolumeFiles([
    new File([JSON.stringify(manifest)], 'manifest.json', { type: 'application/json' }),
    checksums,
    dataFile,
    changed
  ], manifest, checksums), /文件校验失败/);
});

test('multipart planner keeps bookmark image groups intact while bounding parts', async () => {
  const bookmarks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const groups = new Map(bookmarks.map((bookmark) => [bookmark.id, [imageGroup(bookmark.id, 700)]]));
  const parts = await planBackupParts(bookmarks, (bookmark) => groups.get(bookmark.id), 1600);
  assert.deepEqual(parts, [['a'], ['b'], ['c']]);
});

test('v3 part round-trips metadata and both image renditions', async () => {
  const manifest = { backupId: 'backup-1', partCount: 1 };
  const part = await createBackupPart({
    backupId: manifest.backupId,
    exportedAt: '2026-09-14T00:00:00.000Z',
    sourceDevice: 'Mac 主库',
    partIndex: 1,
    partCount: 1,
    bookmarks: [{ id: 'a', title: 'A', url: 'https://example.com', category: 'movies', createdAt: 1, imageIds: ['asset-a'] }],
    categories: [{ id: 'movies', name: '电影' }],
    creators: [],
    loadImageGroups: async () => [imageGroup('asset-a', 20)]
  });
  const file = new File([JSON.stringify(part)], 'part-001.json', { type: 'application/json' });
  const parsed = await parseBackupPart(file, manifest);
  assert.equal(parsed.bookmarks[0].imageIds[0], 'asset-a');
  assert.equal(parsed.imageAssets.length, 2);
  assert.equal(parsed.imageAssets[0].blob.type, 'image/webp');
});

test('v3 manifest validation rejects a changed or incomplete part before restore', async () => {
  const part = new File(['known-good'], 'backup-part-001.json', { type: 'application/json' });
  const digest = await crypto.subtle.digest('SHA-256', await part.arrayBuffer());
  const checksum = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  const manifestValue = {
    format: 'poster-bookmarks-manifest',
    version: 3,
    backupId: 'backup-1',
    partCount: 1,
    files: [{ filename: part.name, bytes: part.size, sha256: checksum }]
  };
  const manifest = new File([JSON.stringify(manifestValue)], 'backup-manifest.json', { type: 'application/json' });
  assert.deepEqual((await validateMultipartFiles([manifest, part])).orderedFiles.map((file) => file.name), [part.name]);
  const changed = new File(['changed'], part.name, { type: 'application/json' });
  await assert.rejects(validateMultipartFiles([manifest, changed]), /分卷校验失败/);
  await assert.rejects(validateMultipartFiles([manifest]), /缺少分卷/);
});
