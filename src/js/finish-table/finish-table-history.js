/**
 * src/js/finish-table/finish-table-history.js
 *
 * 仕上表全体に対する「戻る／進む」（Undo/Redo）専用の
 * 履歴スタックだけを持つモジュール。
 *
 * 何を取得しているか：
 *   何も取得しない。呼び出し側（finish-table-controller.js）が渡す
 *   スナップショット（finish-table-state.jsのgetUndoableSnapshot()の戻り値）
 *   を積み下ろしするだけで、状態の中身は一切解釈しない。
 *
 * 何を判定しているか：
 *   履歴が積めるか（canUndo/canRedo）だけ。
 *
 * どこへ書き込んでいるか：
 *   このモジュール内のメモリ上の配列（past/future）のみ。保存・外部通信は行わない。
 *
 * 他の状態との関係（重要）：
 *   ・コピー専用の「戻す」（finish-table-state.jsのroomCopy.done/backups）とは
 *     別物。「戻す」＝コピー機能専用のUndo、「戻る／進む」＝仕上表全体の
 *     操作履歴、という役割分担を維持する（このファイルはroomCopyの中身を
 *     直接は触らない。スナップショットにroomCopyが含まれていても、
 *     中身を見ずにまるごと保存・復元するだけ）。
 *   ・selectedRoomKey等の入力選択状態、collapsedFloors（階の折りたたみ）とは
 *     完全に独立しており、このファイルはそれらの存在を知らない
 *     （finish-table-state.js側のgetUndoableSnapshot()が、何を対象に含めるかを決める）。
 *   ・階の折りたたみ開閉・内部外部切替・カラー表示・チップ入力ON/OFF・
 *     簡易リスト開閉は、この履歴の対象に含めない
 *     （finish-table-controller.js側が、これらの操作ではrecordHistory()を
 *     呼ばないことで対象外にしている）。
 */

/** @type {any[]} 戻る用スタック（末尾が直近）。 */
const past = [];

/** @type {any[]} 進む用スタック（末尾が直近にUndoしたもの）。 */
const future = [];

/**
 * 対象操作の直前に呼ぶ。操作前のスナップショットをpast側へ積み、
 * 新しい操作が発生したのでredo履歴（future）は破棄する。
 *
 * @param {any} beforeSnapshot 操作前の状態（finish-table-state.jsのgetUndoableSnapshot()）
 */
export function recordHistory(beforeSnapshot) {
  past.push(beforeSnapshot);
  future.length = 0;
}

/** @returns {boolean} 戻る操作が可能か。 */
export function canUndo() {
  return past.length > 0;
}

/** @returns {boolean} 進む操作が可能か。 */
export function canRedo() {
  return future.length > 0;
}

/**
 * 戻る。現在のスナップショット（呼び出し側が渡す）をredo用に積み、
 * 直前に保存しておいた「操作前スナップショット」を返す。
 * 履歴が無ければ何もせずnullを返す。
 *
 * @param {any} currentSnapshot 戻る操作時点の「現在の状態」
 * @returns {any|null} 復元すべきスナップショット
 */
export function popUndo(currentSnapshot) {
  if (!past.length) return null;
  const snapshot = past.pop();
  future.push(currentSnapshot);
  return snapshot;
}

/**
 * 進む。popUndoの逆方向。
 *
 * @param {any} currentSnapshot 進む操作時点の「現在の状態」
 * @returns {any|null} 復元すべきスナップショット
 */
export function popRedo(currentSnapshot) {
  if (!future.length) return null;
  const snapshot = future.pop();
  past.push(currentSnapshot);
  return snapshot;
}

/** 初期化時に呼ぶ。履歴を空にする（サンプル案件の再読込時など）。 */
export function resetHistory() {
  past.length = 0;
  future.length = 0;
}
