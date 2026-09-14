const IMAGE_PART_TARGET = 45 * 1024 * 1024;
const MVPT_MAGIC = new Uint8Array([0x4D, 0x56, 0x50, 0x54]);

function blobToDataUrl(blob) {
  if (typeof FileReader === 'undefined') {
    return blob.arrayBuffer().then((buffer) => `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function sha256(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function dataUrlToBlob(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    throw new Error('备份中包含无效图片');
  }
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/^data:([^;]+);base64$/)?.[1];
  if (!mime || !base64) throw new Error('备份中的图片格式无效');
  const bytes = atob(base64);
  const buffer = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) buffer[index] = bytes.charCodeAt(index);
  return new Blob([buffer], { type: mime });
}

function fileByName(files, filename) {
  const lower = filename.toLowerCase();
  return files.find((file) => file.name === filename)
    || files.find((file) => file.name.toLowerCase() === lower)
    || files.find((file) => file.name.toLowerCase().endsWith(`-${lower}`))
    || files.find((file) => file.name.toLowerCase().endsWith(lower));
}

function groupAssetRecords(group) {
  return [
    { id: `${group.groupId}:display`, groupId: group.groupId, kind: 'display', hash: group.display.hash, blob: group.display.blob, width: group.display.width, height: group.display.height },
    { id: `${group.groupId}:thumbnail`, groupId: group.groupId, kind: 'thumbnail', hash: group.thumbnail.hash || null, blob: group.thumbnail.blob, width: group.thumbnail.width, height: group.thumbnail.height }
  ];
}

export function planBinaryParts(sizes, targetBytes = IMAGE_PART_TARGET) {
  const parts = [];
  let current = [];
  let bytes = 0;
  for (const size of sizes) {
    if (current.length && bytes + size > targetBytes) {
      parts.push(current);
      current = [];
      bytes = 0;
    }
    current.push(size);
    bytes += size;
  }
  if (current.length) parts.push(current);
  return parts;
}

export async function packImagePart(assets, { backupId, partIndex }) {
  const items = [];
  const chunks = [];
  for (const asset of assets) {
    const buffer = await asset.blob.arrayBuffer();
    items.push({
      id: asset.id,
      groupId: asset.groupId,
      kind: asset.kind,
      type: asset.blob.type || 'application/octet-stream',
      hash: asset.hash || null,
      width: asset.width || 0,
      height: asset.height || 0,
      bytes: buffer.byteLength
    });
    chunks.push(buffer);
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify({
    format: 'poster-bookmarks-images',
    version: 1,
    backupId,
    partIndex,
    items
  }));
  const prefix = new ArrayBuffer(12);
  const view = new DataView(prefix);
  new Uint8Array(prefix).set(MVPT_MAGIC);
  view.setUint32(4, 1, true);
  view.setUint32(8, headerBytes.length, true);
  return new Blob([prefix, headerBytes, ...chunks], { type: 'application/octet-stream' });
}

export async function unpackImagePart(file, expected = {}) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 0x4D || bytes[1] !== 0x56 || bytes[2] !== 0x50 || bytes[3] !== 0x54) {
    throw new Error(`图片分卷格式不正确：${file.name}`);
  }
  const view = new DataView(buffer);
  const headerLength = view.getUint32(8, true);
  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + headerLength)));
  } catch {
    throw new Error(`无法读取图片分卷目录：${file.name}`);
  }
  if (header?.format !== 'poster-bookmarks-images' || (expected.backupId && header.backupId !== expected.backupId)) {
    throw new Error(`图片分卷不属于这组备份：${file.name}`);
  }
  let offset = 12 + headerLength;
  const imageAssets = [];
  for (const item of header.items || []) {
    if (!item?.id || !item.groupId || !item.bytes) throw new Error(`图片分卷记录不完整：${file.name}`);
    const slice = buffer.slice(offset, offset + item.bytes);
    offset += item.bytes;
    imageAssets.push({
      id: item.id,
      groupId: item.groupId,
      kind: item.kind,
      hash: item.hash,
      blob: new Blob([slice], { type: item.type || 'application/octet-stream' }),
      width: item.width,
      height: item.height,
      createdAt: Date.now()
    });
  }
  return { imageAssets, partIndex: header.partIndex, backupId: header.backupId };
}

export function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function serializeCreators(creators) {
  return Promise.all(creators.map(async (creator) => ({
    ...creator,
    avatar: creator.avatar ? await blobToDataUrl(creator.avatar) : null
  })));
}

export async function exportVolumeBackup({ bookmarks, categories, creators, loadImageGroups, sourceDevice = 'Mac 主库', targetBytes = IMAGE_PART_TARGET, onProgress }) {
  const backupId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const exportedAt = new Date().toISOString();
  const date = exportedAt.slice(0, 10);
  const prefix = `my-collection-backup-${date}-${backupId.slice(0, 8)}`;
  const seenGroups = new Set();
  const imageFiles = [];
  let currentAssets = [];
  let currentBytes = 0;
  let imagePartIndex = 0;

  const flushImagePart = async () => {
    if (!currentAssets.length) return;
    imagePartIndex += 1;
    onProgress?.({ phase: 'images', current: imagePartIndex, total: imagePartIndex });
    const filename = `${prefix}-images-${String(imagePartIndex).padStart(3, '0')}.mvpart`;
    const blob = await packImagePart(currentAssets, { backupId, partIndex: imagePartIndex });
    imageFiles.push({ filename, role: 'images', bytes: blob.size, sha256: await sha256(blob) });
    downloadFile(blob, filename);
    currentAssets = [];
    currentBytes = 0;
    await new Promise((resolve) => setTimeout(resolve, 180));
  };

  for (const bookmark of bookmarks) {
    const groups = await loadImageGroups(bookmark);
    if ((bookmark.imageIds?.length || 0) && groups.length !== bookmark.imageIds.length) {
      throw new Error(`收藏“${bookmark.title}”缺少图片，无法导出完整备份`);
    }
    for (const group of groups) {
      if (!group?.groupId || seenGroups.has(group.groupId)) continue;
      seenGroups.add(group.groupId);
      const assets = groupAssetRecords(group);
      const size = assets.reduce((total, asset) => total + asset.blob.size, 0);
      if (currentAssets.length && currentBytes + size > targetBytes) await flushImagePart();
      currentAssets.push(...assets);
      currentBytes += size;
    }
  }
  await flushImagePart();

  onProgress?.({ phase: 'data', current: 1, total: 1 });
  const dataFilename = `${prefix}-data-001.json`;
  const dataPayload = {
    format: 'poster-bookmarks-data',
    version: 4,
    backupId,
    exportedAt,
    sourceDevice,
    partIndex: 1,
    partCount: 1,
    categories,
    creators: await serializeCreators(creators),
    bookmarks: bookmarks.map(({ image, gallery, legacyImageCount, imageCount, ...metadata }) => ({
      ...metadata,
      imageIds: metadata.imageIds || [],
      assetVersion: 1
    }))
  };
  const dataBlob = new Blob([JSON.stringify(dataPayload)], { type: 'application/json' });
  const dataFile = { filename: dataFilename, role: 'data', bytes: dataBlob.size, sha256: await sha256(dataBlob) };
  downloadFile(dataBlob, dataFilename);
  await new Promise((resolve) => setTimeout(resolve, 180));

  const checksumsPayload = {
    format: 'poster-bookmarks-checksums',
    version: 4,
    backupId,
    files: [dataFile, ...imageFiles]
  };
  const checksumsFilename = `${prefix}-checksums.json`;
  const checksumsBlob = new Blob([JSON.stringify(checksumsPayload, null, 2)], { type: 'application/json' });
  const checksumsFile = { filename: checksumsFilename, role: 'checksums', bytes: checksumsBlob.size, sha256: await sha256(checksumsBlob) };
  downloadFile(checksumsBlob, checksumsFilename);
  await new Promise((resolve) => setTimeout(resolve, 180));

  const manifest = {
    format: 'poster-bookmarks-manifest',
    version: 4,
    packaging: 'volume',
    backupId,
    exportedAt,
    sourceDevice,
    bookmarkCount: bookmarks.length,
    categoryCount: categories.length,
    creatorCount: creators.length,
    imageCount: seenGroups.size,
    dataPartCount: 1,
    imagePartCount: imageFiles.length,
    files: [dataFile, ...imageFiles, checksumsFile]
  };
  const manifestFilename = `${prefix}-manifest.json`;
  downloadFile(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), manifestFilename);
  onProgress?.({ phase: 'complete', current: imageFiles.length, total: imageFiles.length });
  return { ...manifest, filename: manifestFilename };
}

async function readJsonFile(file) {
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error(`无法读取 ${file.name}`);
  }
}

async function findManifest(fileList) {
  for (const file of fileList) {
    if (!file.name.toLowerCase().includes('manifest')) continue;
    try {
      const candidate = JSON.parse(await file.text());
      if (candidate?.format === 'poster-bookmarks-manifest' && candidate.backupId) return { file, manifest: candidate };
    } catch {
      // Keep scanning other selected files.
    }
  }
  return null;
}

export async function validateVolumeFiles(files, manifest, checksumsFile) {
  if (!manifest?.backupId || manifest.version !== 4) throw new Error('请选择同一备份的有效 manifest 和全部分卷文件');
  const checksums = await readJsonFile(checksumsFile);
  if (checksums.format !== 'poster-bookmarks-checksums' || checksums.backupId !== manifest.backupId || !Array.isArray(checksums.files)) {
    throw new Error('checksums.json 不属于这组备份');
  }
  const listed = manifest.files.filter((entry) => entry.role !== 'checksums' && entry.role !== 'manifest');
  if (listed.length !== checksums.files.length) throw new Error('备份清单与校验文件不一致');
  const dataFiles = [];
  const imageFiles = [];
  for (const entry of checksums.files) {
    const manifestEntry = listed.find((item) => item.filename === entry.filename);
    if (!manifestEntry || manifestEntry.sha256 !== entry.sha256 || manifestEntry.bytes !== entry.bytes) {
      throw new Error(`校验信息不匹配：${entry.filename}`);
    }
    const file = fileByName(files, entry.filename);
    if (!file) throw new Error(`缺少文件：${entry.filename}`);
    if (file.size !== entry.bytes || await sha256(file) !== entry.sha256) throw new Error(`文件校验失败：${entry.filename}`);
    if (entry.role === 'data' || entry.filename.includes('data-')) dataFiles.push(file);
    else imageFiles.push(file);
  }
  if (!dataFiles.length) throw new Error('缺少 data-001.json');
  return { manifest, dataFiles, imageFiles, checksums };
}

export async function parseDataPart(file, expected = {}) {
  const part = await readJsonFile(file);
  if (part?.format !== 'poster-bookmarks-data' || part.version !== 4 || (expected.backupId && part.backupId !== expected.backupId)) {
    throw new Error(`数据分卷格式不正确：${file.name}`);
  }
  if (!Array.isArray(part.bookmarks) || !Array.isArray(part.categories) || !Array.isArray(part.creators)) {
    throw new Error(`数据分卷记录不完整：${file.name}`);
  }
  part.bookmarks.forEach((bookmark) => {
    if (!bookmark?.id || !bookmark.title || !bookmark.url || !bookmark.category || !bookmark.createdAt || !Array.isArray(bookmark.imageIds)) {
      throw new Error(`数据分卷收藏记录不完整：${file.name}`);
    }
  });
  const creators = part.creators.map((creator) => {
    if (!creator?.id || !creator.name || !creator.createdAt) throw new Error(`数据分卷博主记录不完整：${file.name}`);
    return { ...creator, avatar: creator.avatar ? dataUrlToBlob(creator.avatar) : null };
  });
  return {
    bookmarks: part.bookmarks,
    categories: part.categories,
    creators,
    partIndex: part.partIndex
  };
}

export async function inspectBackupFiles(files) {
  const fileList = [...files];
  if (!fileList.length) throw new Error('请选择备份文件');
  const found = await findManifest(fileList);
  if (!found) {
    if (fileList.length === 1) return { kind: 'legacy', files: fileList };
    throw new Error('请选择同一备份的 manifest、checksums 和全部分卷');
  }
  const { file: manifestFile, manifest } = found;
  if (manifest.version === 4 || manifest.packaging === 'volume') {
    const checksumsFile = fileByName(fileList.filter((file) => file !== manifestFile), 'checksums.json')
      || fileList.find((file) => file !== manifestFile && file.name.toLowerCase().includes('checksums'));
    if (!checksumsFile) throw new Error('缺少 checksums.json');
    const volume = await validateVolumeFiles(fileList, manifest, checksumsFile);
    return { kind: 'v4', ...volume };
  }
  if (manifest.version === 3) {
    const validated = await validateMultipartFiles(fileList);
    return { kind: 'v3', ...validated };
  }
  throw new Error('不支持的备份版本');
}

export async function planBackupParts(bookmarks, loadImageGroups, targetBytes = 42 * 1024 * 1024) {
  const parts = [];
  let current = [];
  let estimatedBytes = 0;
  for (const bookmark of bookmarks) {
    const groups = await loadImageGroups(bookmark);
    const rawBytes = groups.reduce((total, group) => total + group.display.blob.size + group.thumbnail.blob.size, 0);
    const itemBytes = Math.ceil(rawBytes * 4 / 3) + 4096;
    if (current.length && estimatedBytes + itemBytes > targetBytes) {
      parts.push(current);
      current = [];
      estimatedBytes = 0;
    }
    current.push(bookmark.id);
    estimatedBytes += itemBytes;
  }
  if (current.length || !parts.length) parts.push(current);
  return parts;
}

async function serializeImageGroup(group) {
  return {
    groupId: group.groupId,
    hash: group.display.hash,
    width: group.display.width,
    height: group.display.height,
    thumbnailWidth: group.thumbnail.width,
    thumbnailHeight: group.thumbnail.height,
    display: await blobToDataUrl(group.display.blob),
    thumbnail: await blobToDataUrl(group.thumbnail.blob)
  };
}

export async function createBackupPart({ backupId, exportedAt, sourceDevice, partIndex, partCount, bookmarks, categories, creators, loadImageGroups }) {
  const imageAssets = [];
  const serializedBookmarks = [];
  for (const bookmark of bookmarks) {
    const groups = await loadImageGroups(bookmark);
    imageAssets.push(...await Promise.all(groups.map(serializeImageGroup)));
    const { image, gallery, legacyImageCount, imageCount, ...metadata } = bookmark;
    serializedBookmarks.push({ ...metadata, imageIds: groups.map((group) => group.groupId), assetVersion: 1 });
  }
  return {
    format: 'poster-bookmarks-part',
    version: 3,
    backupId,
    exportedAt,
    sourceDevice,
    partIndex,
    partCount,
    categories: partIndex === 1 ? categories : [],
    creators: partIndex === 1 ? await serializeCreators(creators) : [],
    bookmarks: serializedBookmarks,
    imageAssets
  };
}

export async function exportMultipartBackup(options) {
  return exportVolumeBackup(options);
}

export async function validateMultipartFiles(files) {
  const fileList = [...files];
  let manifest;
  let manifestFile;
  for (const file of fileList) {
    if (!file.name.includes('manifest')) continue;
    const candidate = JSON.parse(await file.text());
    if (candidate?.format === 'poster-bookmarks-manifest' && candidate.version === 3) {
      manifest = candidate;
      manifestFile = file;
      break;
    }
  }
  if (!manifest || !manifest.backupId || !Number.isInteger(manifest.partCount) || manifest.partCount < 1 || !Array.isArray(manifest.files)) {
    throw new Error('请选择同一备份的有效 manifest 和全部分卷文件');
  }
  const supplied = new Map(fileList.filter((file) => file !== manifestFile).map((file) => [file.name, file]));
  if (manifest.files.length !== manifest.partCount) throw new Error('备份清单中的分卷数量不正确');
  const orderedFiles = [];
  for (const entry of manifest.files) {
    const file = supplied.get(entry.filename) || fileByName(fileList, entry.filename);
    if (!file) throw new Error(`缺少分卷：${entry.filename}`);
    if (file.size !== entry.bytes || await sha256(file) !== entry.sha256) throw new Error(`分卷校验失败：${entry.filename}`);
    orderedFiles.push(file);
  }
  return { manifest, orderedFiles };
}

export async function parseBackupPart(file, expectedManifest) {
  const part = JSON.parse(await file.text());
  if (part?.format !== 'poster-bookmarks-part' || part.version !== 3 || part.backupId !== expectedManifest.backupId || part.partCount !== expectedManifest.partCount || !Number.isInteger(part.partIndex) || !Array.isArray(part.bookmarks) || !Array.isArray(part.categories) || !Array.isArray(part.creators) || !Array.isArray(part.imageAssets)) {
    throw new Error(`分卷格式不正确：${file.name}`);
  }
  part.bookmarks.forEach((bookmark) => {
    if (!bookmark?.id || !bookmark.title || !bookmark.url || !bookmark.category || !bookmark.createdAt || !Array.isArray(bookmark.imageIds)) {
      throw new Error(`分卷收藏记录不完整：${file.name}`);
    }
  });
  part.categories.forEach((category) => {
    if (!category?.id || typeof category.name !== 'string') throw new Error(`分卷分类记录不完整：${file.name}`);
  });
  const imageAssets = part.imageAssets.flatMap((asset) => {
    if (!asset.groupId || !asset.display || !asset.thumbnail) throw new Error(`分卷图片记录不完整：${file.name}`);
    return [
      { id: `${asset.groupId}:display`, groupId: asset.groupId, kind: 'display', hash: asset.hash, blob: dataUrlToBlob(asset.display), width: asset.width, height: asset.height, createdAt: Date.now() },
      { id: `${asset.groupId}:thumbnail`, groupId: asset.groupId, kind: 'thumbnail', hash: null, blob: dataUrlToBlob(asset.thumbnail), width: asset.thumbnailWidth, height: asset.thumbnailHeight, createdAt: Date.now() }
    ];
  });
  const availableGroups = new Set(part.imageAssets.map((asset) => asset.groupId));
  if (part.bookmarks.some((bookmark) => bookmark.imageIds.some((groupId) => !availableGroups.has(groupId)))) {
    throw new Error(`分卷缺少收藏引用的图片：${file.name}`);
  }
  const creators = part.creators.map((creator) => {
    if (!creator?.id || !creator.name || !creator.createdAt) throw new Error(`分卷博主记录不完整：${file.name}`);
    return { ...creator, avatar: creator.avatar ? dataUrlToBlob(creator.avatar) : null };
  });
  return { bookmarks: part.bookmarks, categories: part.categories, creators, imageAssets, partIndex: part.partIndex };
}

export async function createBackup(bookmarks, categories, creators = []) {
  const serializedBookmarks = await Promise.all(bookmarks.map(async (bookmark) => ({
    ...bookmark,
    image: bookmark.image ? await blobToDataUrl(bookmark.image) : null,
    gallery: await Promise.all((bookmark.gallery || []).map(blobToDataUrl))
  })));
  return {
    format: 'poster-bookmarks',
    version: 2,
    exportedAt: new Date().toISOString(),
    categories,
    creators: await serializeCreators(creators),
    bookmarks: serializedBookmarks
  };
}

export function downloadBackup(backup) {
  downloadFile(new Blob([JSON.stringify(backup)], { type: 'application/json' }), `my-collection-backup-${new Date().toISOString().slice(0, 10)}.json`);
}

export async function parseBackup(file) {
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    throw new Error('无法读取这个 JSON 备份文件');
  }
  if (backup?.format !== 'poster-bookmarks' || ![1, 2].includes(backup.version) || !Array.isArray(backup.bookmarks) || !Array.isArray(backup.categories)) {
    throw new Error('这不是有效的 My Collection 备份');
  }
  const bookmarks = backup.bookmarks.map((bookmark) => {
    if (!bookmark.id || !bookmark.title || !bookmark.url || !bookmark.category || !bookmark.createdAt) {
      throw new Error('备份中有不完整的收藏项目');
    }
    return {
      ...bookmark,
      image: bookmark.image ? dataUrlToBlob(bookmark.image) : null,
      gallery: Array.isArray(bookmark.gallery) ? bookmark.gallery.map(dataUrlToBlob) : []
    };
  });
  const categories = backup.categories.filter((category) => category?.id && category?.name);
  const creators = (Array.isArray(backup.creators) ? backup.creators : []).map((creator) => {
    if (!creator?.id || !creator?.name || !creator?.createdAt) throw new Error('备份中有不完整的博主资料');
    return { ...creator, avatar: creator.avatar ? dataUrlToBlob(creator.avatar) : null };
  });
  return { bookmarks, categories, creators };
}
