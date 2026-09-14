export const IMAGE_POLICY = Object.freeze({
  displayMaxEdge: 1800,
  displayQuality: 0.9,
  thumbnailMaxEdge: 480,
  thumbnailQuality: 0.76
});

export function scaledDimensions(width, height, maxEdge) {
  const largest = Math.max(width, height);
  if (!largest || largest <= maxEdge) return { width, height };
  const scale = maxEdge / largest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function shouldUseLossless(blob, options = {}) {
  if (options.lossless) return true;
  const name = options.name || blob.name || '';
  return /截图|screenshot|screen\s*shot|qrcode|qr-?code|二维码|界面/i.test(name);
}

export function chooseDisplayFormat(blob, options = {}) {
  if (blob.type === 'image/gif') return { mime: 'image/gif', keepOriginal: true, lossless: false };
  if (shouldUseLossless(blob, options)) return { mime: 'image/png', keepOriginal: false, lossless: true };
  return { mime: 'image/webp', keepOriginal: false, lossless: false, quality: options.displayQuality ?? IMAGE_POLICY.displayQuality };
}

export async function hashBlob(blob) {
  const bytes = await blob.arrayBuffer();
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }
  const view = new Uint8Array(bytes);
  let first = 2166136261;
  let second = 16777619;
  for (const value of view) {
    first = Math.imul(first ^ value, 16777619);
    second = Math.imul(second ^ value, 2166136261);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}-${view.length}`;
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取这张图片')); };
    image.src = url;
  });
}

function canvasBlob(image, dimensions, mime, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  canvas.getContext('2d', { alpha: true }).drawImage(image, 0, 0, dimensions.width, dimensions.height);
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

export async function prepareImage(blob, policy = IMAGE_POLICY, options = {}) {
  const hash = await hashBlob(blob);
  const image = await loadImage(blob);
  const displaySize = scaledDimensions(image.naturalWidth, image.naturalHeight, policy.displayMaxEdge);
  const thumbnailSize = scaledDimensions(image.naturalWidth, image.naturalHeight, policy.thumbnailMaxEdge);
  const format = chooseDisplayFormat(blob, { ...options, displayQuality: policy.displayQuality });

  if (format.keepOriginal || (format.lossless && blob.type === 'image/png' && image.naturalWidth <= policy.displayMaxEdge && image.naturalHeight <= policy.displayMaxEdge)) {
    const thumbnail = await canvasBlob(image, thumbnailSize, 'image/webp', policy.thumbnailQuality);
    return {
      hash,
      display: blob,
      thumbnail: thumbnail || blob,
      width: image.naturalWidth,
      height: image.naturalHeight,
      thumbnailWidth: thumbnailSize.width,
      thumbnailHeight: thumbnailSize.height,
      lossless: format.lossless || blob.type === 'image/gif'
    };
  }

  const displayMime = format.mime;
  const displayQuality = format.lossless ? undefined : format.quality;
  const [display, thumbnail] = await Promise.all([
    canvasBlob(image, displaySize, displayMime, displayQuality),
    canvasBlob(image, thumbnailSize, 'image/webp', policy.thumbnailQuality)
  ]);
  if (!display || !thumbnail) throw new Error(displayMime === 'image/webp' ? '当前浏览器无法生成 WebP 图片' : '当前浏览器无法保存这张图片');
  return {
    hash,
    display,
    thumbnail,
    width: displaySize.width,
    height: displaySize.height,
    thumbnailWidth: thumbnailSize.width,
    thumbnailHeight: thumbnailSize.height,
    lossless: Boolean(format.lossless)
  };
}
