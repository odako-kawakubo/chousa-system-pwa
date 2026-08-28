/**
 * src/js/device-code.js
 *
 * 端末コードと利用者向け端末名を端末単位で保持する。
 * 端末コードはrecordのupdatedDevice等に使用し、端末名はヘッダー／設定表示用。
 */

const DEVICE_KEY = 'chousa-device-code';
const DEVICE_NAME_KEY = 'chousa-device-name';
const listeners = [];

export function getDeviceCode() {
  let value = String(localStorage.getItem(DEVICE_KEY) || '').trim();
  if (value) return value;

  value = Math.random().toString(36).slice(2, 6).toUpperCase();
  localStorage.setItem(DEVICE_KEY, value);
  return value;
}

export function getDeviceName() {
  return String(localStorage.getItem(DEVICE_NAME_KEY) || '').trim();
}

export function getDeviceDisplayName() {
  return getDeviceName() || `端末-${getDeviceCode()}`;
}

export function setDeviceName(value) {
  const next = String(value || '').trim();
  if (!next) return false;
  localStorage.setItem(DEVICE_NAME_KEY, next);
  listeners.slice().forEach((callback) => callback(getDeviceDisplayName()));
  return true;
}

export function initializeDeviceIdentity() {
  getDeviceCode();
  if (getDeviceName()) return;
  const fallback = `端末-${getDeviceCode()}`;
  const entered = window.prompt('この端末の名前を入力してください。\nあとから「設定 ＞ 同期システム」で変更できます。', fallback);
  setDeviceName(entered === null ? fallback : (entered.trim() || fallback));
}

export function subscribeDeviceName(callback) {
  listeners.push(callback);
  callback(getDeviceDisplayName());
  return () => {
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  };
}
