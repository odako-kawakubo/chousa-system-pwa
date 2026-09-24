/**
 * camera-photo-id.js
 * カメラ撮影時のphotoId採番だけを担当する。
 */
import { getDeviceCode } from '../device-code.js';
import { PHOTO_TYPES } from '../records/photo-record.js';

const COUNTER_KEY = 'chousa-photo-counter';

export function nextPhotoId(photoType) {
  const key = `${COUNTER_KEY}:${photoType}`;
  const next = Number(localStorage.getItem(key) || 0) + 1;
  localStorage.setItem(key, String(next));
  return `${photoType === PHOTO_TYPES.SAMPLING ? 'S' : 'V'}-${getDeviceCode()}-${String(next).padStart(4, '0')}`;
}
