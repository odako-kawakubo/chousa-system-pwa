/** ヘッダーの端末表示を端末設定へ接続する。 */
import { subscribeDeviceName } from '../device-code.js';

let unsubscribe = null;

export function bindDeviceUi() {
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribeDeviceName((name) => {
    const pill = document.getElementById('devicePill');
    if (pill) {
      pill.textContent = name;
      pill.title = `端末：${name}`;
    }
  });
}
