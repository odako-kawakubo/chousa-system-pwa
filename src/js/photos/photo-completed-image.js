/**
 * src/js/photos/photo-completed-image.js
 *
 * 看板合成後の「完成画像」だけを軽量化する。
 * original はこのモジュールでは触らない。
 */

export const COMPLETED_PHOTO_MAX_LONG_EDGE = 1500;
export const COMPLETED_PHOTO_JPEG_QUALITY = 0.82;

async function blobToImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToJpegBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('完成画像を圧縮できませんでした。')),
      'image/jpeg',
      COMPLETED_PHOTO_JPEG_QUALITY
    );
  });
}

/**
 * locally generated completed画像だけを、長辺1500pxへ縮小してJPEG化する。
 * 1500px以下でもPNG等はJPEGへ揃える。JPEGかつ1500px以下なら再圧縮しない。
 */
export async function normalizeCompletedPhotoBlob(blob) {
  if (!(blob instanceof Blob)) throw new Error('完成画像Blobがありません。');

  const image = await blobToImage(blob);
  const sourceWidth = Math.max(1, Number(image.naturalWidth || image.width || 0));
  const sourceHeight = Math.max(1, Number(image.naturalHeight || image.height || 0));
  const longEdge = Math.max(sourceWidth, sourceHeight);

  if (longEdge <= COMPLETED_PHOTO_MAX_LONG_EDGE && /^image\/jpe?g$/i.test(blob.type || '')) {
    return blob;
  }

  const scale = Math.min(1, COMPLETED_PHOTO_MAX_LONG_EDGE / longEdge);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('完成画像の圧縮Canvasを作成できませんでした。');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  return canvasToJpegBlob(canvas);
}
