/**
 * src/js/output/output-photo-layout.js
 *
 * 出力帳票の写真実寸とキャプション位置を一元化する。
 * 画像は元比率を保って枠内へ収め、建材写真帳のキャプションは
 * 実際に描画された写真の左端・幅へ揃える。
 */

export function fitOutputPhotoImage(img) {
  if (!(img instanceof HTMLImageElement)) return null;
  const frame = img.closest('.output-photo-frame');
  if (!frame || !(img.naturalWidth > 0 && img.naturalHeight > 0)) return null;

  const frameRect = frame.getBoundingClientRect();
  const maxW = frameRect.width;
  const maxH = frameRect.height;
  if (!(maxW > 0 && maxH > 0)) return null;

  const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
  const width = Math.max(1, img.naturalWidth * scale);
  const height = Math.max(1, img.naturalHeight * scale);

  img.style.width = `${width}px`;
  img.style.height = `${height}px`;
  img.style.maxWidth = 'none';
  img.style.maxHeight = 'none';
  img.style.objectFit = 'fill';
  img.style.flex = '0 0 auto';

  const slot = frame.closest('.output-visual-slot');
  const caption = slot?.querySelector('.output-visual-caption');
  if (caption) {
    const offset = Math.max(0, (maxW - width) / 2);
    caption.style.width = `${width}px`;
    caption.style.marginLeft = `${offset}px`;
    caption.style.marginRight = '0';
  }

  return { width, height };
}

export function fitOutputPhotoImages(container) {
  if (!container?.querySelectorAll) return;
  [...container.querySelectorAll('.output-photo-frame img')].forEach((img) => fitOutputPhotoImage(img));
}
