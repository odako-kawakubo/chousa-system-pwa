/**
 * src/js/records/photo-record.js
 *
 * photoRecordの型定義のみを持つファイル。
 * Storeへの登録・購読・CRUD処理はv0.1.5.3で実装するため、今回はここに
 * 何も実装しない（型（JSDoc）だけを先に置き、参照元・実装時期を明記する）。
 *
 * 正式仕様書34〜41章で定義される、目視調査写真・採取写真それぞれの主要項目を
 * 反映する。
 */

/**
 * @typedef {object} PhotoRecordCommon
 * @property {string} photoId          写真ID
 * @property {'visual'|'sampling'} kind 目視調査写真／採取写真の区分
 * @property {string} finishId         紐づくfinishRecordのID（該当する場合）
 * @property {string} materialId       紐づくmaterialRecordのID
 * @property {string} status           状態（有効／削除）
 * @property {string} storagePath      保存先（OneDrive等。v0.1.5.1時点では未使用）
 * @property {string} systemMemo       システムメモ
 * @property {string} updatedDevice    更新端末
 * @property {string} updatedAt        更新日時（ISO日時文字列）
 */

/**
 * 目視調査写真（正式仕様書34〜37章）に固有の項目。
 * @typedef {PhotoRecordCommon & {
 *   kind: 'visual',
 *   caption: string,
 *   takenAt: string
 * }} VisualPhotoRecord
 */

/**
 * 採取写真（正式仕様書38〜41章）に固有の項目。
 * @typedef {PhotoRecordCommon & {
 *   kind: 'sampling',
 *   sampleName: string,
 *   sampleLocation: string,
 *   takenAt: string
 * }} SamplingPhotoRecord
 */

/**
 * @typedef {VisualPhotoRecord|SamplingPhotoRecord} PhotoRecord
 */

export {};
