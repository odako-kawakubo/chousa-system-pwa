/**
 * src/js/device-code.js
 *
 * このブラウザ端末を識別する短い端末コードを1か所で管理する。
 * 撮影端末・最終編集端末・photoId採番で同じコードを使用する。
 * Firebase導入前のため、現在はlocalStorageに端末単位で保持する。
 */

const DEVICE_KEY = 'chousa-device-code';

/**
 * 現在の端末コードを返す。
 * 未発行なら4文字の英数字コードを生成してlocalStorageへ保存する。
 * @returns {string}
 */
export function getDeviceCode() {
  let value = String(localStorage.getItem(DEVICE_KEY) || '').trim();
  if (value) return value;

  value = Math.random().toString(36).slice(2, 6).toUpperCase();
  localStorage.setItem(DEVICE_KEY, value);
  return value;
}
