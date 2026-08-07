/**
 * src/js/demo/sample-materials.js
 *
 * このファイルの役割：
 *   仕上表タブの簡易リスト・建材カラー表示の動作確認に使う、
 *   20件分の「公式サンプル建材」固定データを保持する。
 *   本処理（正式な建材レコード・正式採番）とは完全に分離した、
 *   確認専用のハードコードされたデータのみを持つ。
 *
 * どこから呼ばれるか：
 *   src/js/finish-table/finish-table-state.js から読み込まれ、
 *   簡易リスト（src/js/materials/simple-list.js）の表示に使われる。
 *
 * 何を取得しているか：
 *   何も取得しない（固定の定数データのみ）。
 *
 * 何を判定しているか：
 *   何も判定しない。
 *
 * どこへ描画しているか：
 *   このファイル自身は描画を行わない。
 *
 * 保存・外部通信について：
 *   一切行わない。写真枚数（photoCount）は目視調査写真件数の仮データであり、
 *   実際の写真ファイルの読込・アップロードは行わない（後続工程）。
 */

/**
 * サンプル建材20件。
 *
 * @typedef {Object} SampleMaterial
 * @property {string} materialId 建材ID（R001〜R020、正式な建材IDの採番形式に合わせた仮ID）
 * @property {number} inputId 入力ID（1〜20、簡易リスト上での識別に使う）
 * @property {number} no 建材No.（1〜20）
 * @property {string} name 建材名称
 * @property {string} color 確認用の建材カラー（HEX）
 * @property {string} note 調査備考
 * @property {number} photoCount 目視調査写真件数（仮データ）
 */

/** @type {SampleMaterial[]} */
export const sampleMaterials = [
  { materialId: 'R001', inputId: 1, no: 1, name: '石こうボードA', color: '#ef4444', note: '天井裏も同一材を確認', photoCount: 3 },
  { materialId: 'R002', inputId: 2, no: 2, name: '仕上塗材A', color: '#f97316', note: '外壁補修部分に使用', photoCount: 0 },
  { materialId: 'R003', inputId: 3, no: 3, name: 'ビニル床タイルA', color: '#eab308', note: '一部剥離箇所あり', photoCount: 0 },
  { materialId: 'R004', inputId: 4, no: 4, name: 'ビニル床シートA', color: '#84cc16', note: '重ね貼りを確認', photoCount: 2 },
  { materialId: 'R005', inputId: 5, no: 5, name: 'ケイカル板A', color: '#22c55e', note: '天井点検口周辺で使用', photoCount: 4 },
  { materialId: 'R006', inputId: 6, no: 6, name: 'スレートボードA', color: '#10b981', note: '屋根材として使用', photoCount: 1 },
  { materialId: 'R007', inputId: 7, no: 7, name: '岩綿吸音板A', color: '#14b8a6', note: '会議室天井に集中して使用', photoCount: 5 },
  { materialId: 'R008', inputId: 8, no: 8, name: 'けい酸カルシウム板A', color: '#06b6d4', note: '耐火間仕切りに使用', photoCount: 0 },
  { materialId: 'R009', inputId: 9, no: 9, name: 'パーライト板A', color: '#0ea5e9', note: '断熱補強箇所あり', photoCount: 2 },
  { materialId: 'R010', inputId: 10, no: 10, name: '押出成形セメント板A', color: '#3b82f6', note: '外壁パネルとして使用', photoCount: 3 },
  { materialId: 'R011', inputId: 11, no: 11, name: 'フレキシブル板A', color: '#6366f1', note: '水回り間仕切りに使用', photoCount: 1 },
  { materialId: 'R012', inputId: 12, no: 12, name: '木毛セメント板A', color: '#8b5cf6', note: '旧仕様の名残と推測', photoCount: 2 },
  { materialId: 'R013', inputId: 13, no: 13, name: 'ソフト巾木A', color: '#a855f7', note: '一部劣化を確認', photoCount: 0 },
  { materialId: 'R014', inputId: 14, no: 14, name: 'モルタルA', color: '#d946ef', note: '下地補修跡あり', photoCount: 1 },
  { materialId: 'R015', inputId: 15, no: 15, name: 'コンクリートA', color: '#ec4899', note: '打放し仕上げ部分', photoCount: 0 },
  { materialId: 'R016', inputId: 16, no: 16, name: 'シーリング材A', color: '#f43f5e', note: '目地の劣化を確認', photoCount: 1 },
  { materialId: 'R017', inputId: 17, no: 17, name: 'ガスケットA', color: '#fb7185', note: '配管接続部に使用', photoCount: 0 },
  { materialId: 'R018', inputId: 18, no: 18, name: 'パッキンA', color: '#fbbf24', note: '設備機器周辺で使用', photoCount: 0 },
  { materialId: 'R019', inputId: 19, no: 19, name: '耐火二層管A', color: '#a3e635', note: '竪穴区画で使用', photoCount: 2 },
  { materialId: 'R020', inputId: 20, no: 20, name: '断熱材A', color: '#2dd4bf', note: '屋根裏に敷き込み', photoCount: 3 }
];
