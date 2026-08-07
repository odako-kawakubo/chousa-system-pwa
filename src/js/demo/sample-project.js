/**
 * src/js/demo/sample-project.js
 *
 * このファイルの役割：
 *   仕上表タブの動作確認に使う「公式サンプル案件」の固定データを保持する。
 *   使い捨てのテストデータではなく、今後も仕上表・建材・写真・同期などの
 *   確認に継続して使う案件情報として、本処理のデータとは別モジュールに分離する。
 *
 * どこから呼ばれるか：
 *   src/js/finish-table/finish-table-state.js から読み込まれ、
 *   仕上表タブの初期表示（案件名バナー）に使われる。
 *
 * 何を取得しているか：
 *   何も取得しない（固定の定数データのみを持つ）。
 *
 * 何を判定しているか：
 *   何も判定しない。
 *
 * どこへ描画しているか：
 *   このファイル自身は描画を行わない。表示用の文字列を組み立てる
 *   ヘルパー関数（formatProjectDisplayName）のみ提供する。
 *
 * 保存・外部通信について：
 *   一切行わない。Firestoreの正式案件データとは無関係の、画面確認専用の
 *   ハードコードされた値のみを持つ。
 */

export const sampleProject = {
  projectId: 'SAMPLE-001',
  projectNo: 'SAMPLE-001',
  projectName: '仕上表UI確認用テスト案件',
  projectType: 'sample',
  isSample: true
};

/**
 * 案件名の画面表示用文字列を組み立てる。
 * サンプル案件の場合は先頭に「［サンプル］」を付ける。
 *
 * @param {{projectName: string, isSample?: boolean}} project
 * @returns {string}
 */
export function formatProjectDisplayName(project) {
  if (!project) return '';
  return project.isSample ? `［サンプル］${project.projectName}` : project.projectName;
}
