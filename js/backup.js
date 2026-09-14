function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
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
    creators: await Promise.all(creators.map(async (creator) => ({
      ...creator,
      avatar: creator.avatar ? await blobToDataUrl(creator.avatar) : null
    }))),
    bookmarks: serializedBookmarks
  };
}

export function downloadBackup(backup) {
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `my-collection-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
