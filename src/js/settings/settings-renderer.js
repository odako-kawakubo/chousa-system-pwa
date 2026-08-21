/**
 * src/js/settings/settings-renderer.js
 *
 * v0.1.5.4B 設定タブの描画専用モジュール。
 * 保存・同期処理は行わず、受け取ったViewModelをHTMLへ反映する。
 */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderMaterialRows(rows) {
  return rows.map((item) => `
    <tr data-setting-material-row="${escapeHtml(item.candidateId)}">
      <td><input class="settings-table-input" data-setting-material-field="part" value="${escapeHtml(item.part)}" aria-label="部位"></td>
      <td><input class="settings-table-input" data-setting-material-field="baseName" value="${escapeHtml(item.baseName)}" aria-label="建材名称ベース名"></td>
    </tr>
  `).join('');
}

function renderPartRows(rows) {
  return rows.map((item) => `
    <tr data-setting-part-row="${escapeHtml(item.candidateId)}">
      <td><input class="settings-table-input" data-setting-part-field="name" value="${escapeHtml(item.name)}" aria-label="部位名称"></td>
    </tr>
  `).join('');
}

export function renderSettingsTab(root, viewModel) {
  root.innerHTML = `
    <div class="settings-root">
      <div class="settings-subtabs" role="tablist" aria-label="設定区分">
        <button type="button" class="btn settings-subtab active" data-settings-section="survey">調査システム</button>
        <button type="button" class="btn settings-subtab" data-settings-section="sync">同期システム</button>
      </div>

      <section class="settings-section" data-settings-panel="survey">
        <div class="settings-grid">
          <section class="settings-card settings-project-card">
            <div class="settings-card-head">
              <div>
                <h3>案件情報・電子看板</h3>
                <div class="hint">案件情報を変更すると看板へ即時反映します。左で調整し、右の実看板を見ながら確認できます。</div>
              </div>
              <span class="pill">ローカル</span>
            </div>

            <div class="settings-project-board-layout">
              <div class="settings-project-left-column">
                <section class="settings-project-section" aria-label="案件情報">
                  <h4>案件情報</h4>
                  <div class="settings-form-grid settings-project-fields">
                    <label><span>案件番号</span><input value="${escapeHtml(viewModel.project.projectNo)}" data-setting-project-field="projectNo"></label>
                    <label><span>案件名</span><input value="${escapeHtml(viewModel.project.projectName)}" data-setting-project-field="projectName"></label>
                    <label class="settings-span-2"><span>住所</span><input value="${escapeHtml(viewModel.project.address)}" placeholder="住所" data-setting-project-field="address"></label>
                    <div class="settings-project-survey-row settings-span-2">
                      <label><span>調査日</span><input type="date" value="${escapeHtml(viewModel.project.surveyDate)}" data-setting-project-field="surveyDate"></label>
                      <label><span>調査者</span><input value="${escapeHtml(viewModel.project.surveyor)}" placeholder="調査者" data-setting-project-field="surveyor"></label>
                    </div>
                  </div>
                </section>

                <section class="settings-project-section settings-board-controls" aria-label="看板調整">
                  <h4>看板調整</h4>
                  <label><span>件名 改行</span><textarea rows="2" data-board-setting="subjectText">${escapeHtml(viewModel.board.subjectText)}</textarea></label>
                  <label><span>住所 改行</span><textarea rows="2" data-board-setting="addressText">${escapeHtml(viewModel.board.addressText)}</textarea></label>

                  <div class="settings-board-size-row">
                    <div class="settings-board-font-control">
                      <span>件名文字</span>
                      <div class="settings-board-stepper">
                        <button type="button" class="btn small" data-board-font-adjust="subjectFontSize" data-board-font-delta="-1" aria-label="件名文字を小さく">−</button>
                        <input type="number" min="10" max="34" value="${escapeHtml(viewModel.board.subjectFontSize)}" data-board-setting="subjectFontSize" aria-label="件名文字サイズ">
                        <button type="button" class="btn small" data-board-font-adjust="subjectFontSize" data-board-font-delta="1" aria-label="件名文字を大きく">＋</button>
                      </div>
                    </div>

                    <div class="settings-board-font-control">
                      <span>住所文字</span>
                      <div class="settings-board-stepper">
                        <button type="button" class="btn small" data-board-font-adjust="addressFontSize" data-board-font-delta="-1" aria-label="住所文字を小さく">−</button>
                        <input type="number" min="9" max="30" value="${escapeHtml(viewModel.board.addressFontSize)}" data-board-setting="addressFontSize" aria-label="住所文字サイズ">
                        <button type="button" class="btn small" data-board-font-adjust="addressFontSize" data-board-font-delta="1" aria-label="住所文字を大きく">＋</button>
                      </div>
                    </div>
                  </div>

                  <button type="button" class="btn small settings-board-reset" data-action="reset-board-settings">看板設定をリセット</button>
                </section>
              </div>

              <div class="settings-board-preview-column">
                <div class="settings-board-preview-title">電子看板プレビュー</div>
                <canvas class="settings-board-preview" data-settings-board-preview aria-label="電子看板プレビュー"></canvas>
              </div>
            </div>
          </section>

          <section class="settings-card settings-candidate-card">
            <div class="settings-card-head">
              <div>
                <h3>建材名称候補</h3>
                <div class="hint">ここはデフォルト候補の正本。仕上表では「案件内実名称 → 案件内ベース名 → ここ」の順で候補表示します。</div>
              </div>
              <span class="pill">${viewModel.materialCandidates.length}件</span>
            </div>
            <div class="settings-add-row settings-add-material">
              <input data-setting-add-material-part placeholder="部位">
              <input data-setting-add-material-name placeholder="建材名称（ベース名）">
              <button type="button" class="btn primary" data-action="add-setting-material">追加</button>
            </div>
            <div class="settings-table-wrap">
              <table class="settings-table">
                <thead><tr><th>部位</th><th>建材名称（ベース名）</th></tr></thead>
                <tbody>${renderMaterialRows(viewModel.materialCandidates)}</tbody>
              </table>
            </div>
          </section>

          <section class="settings-card settings-candidate-card">
            <div class="settings-card-head">
              <div>
                <h3>部位名称候補</h3>
                <div class="hint">その他1/2の部位入力候補。案件内で実際に使われた部位を優先し、その後にここを表示します。採取部位候補には使用しません。</div>
              </div>
              <span class="pill">${viewModel.partCandidates.length}件</span>
            </div>
            <div class="settings-add-row settings-add-part">
              <input data-setting-add-part-name placeholder="部位名称">
              <button type="button" class="btn primary" data-action="add-setting-part">追加</button>
            </div>
            <div class="settings-table-wrap settings-part-table-wrap">
              <table class="settings-table">
                <thead><tr><th>部位名称</th></tr></thead>
                <tbody>${renderPartRows(viewModel.partCandidates)}</tbody>
              </table>
            </div>
          </section>
        </div>
      </section>

      <section class="settings-section" data-settings-panel="sync" hidden>
        <div class="settings-grid">
          <section class="settings-card">
            <div class="settings-card-head">
              <div>
                <h3>同期システム設定</h3>
                <div class="hint">Firebase設計時に保存先・同期状態・端末・バックアップ仕様を確定します。</div>
              </div>
              <span class="pill">UIのみ</span>
            </div>
            <div class="settings-sync-placeholder-grid">
              <div class="settings-placeholder-box"><b>Firebase</b><span>接続先・案件正本・差分同期</span></div>
              <div class="settings-placeholder-box"><b>OneDrive</b><span>案件フォルダ・写真・分析結果連携</span></div>
              <div class="settings-placeholder-box"><b>端末</b><span>端末名・端末コード・更新端末管理</span></div>
              <div class="settings-placeholder-box"><b>バックアップ</b><span>手動／自動バックアップ・復元</span></div>
              <div class="settings-placeholder-box"><b>Excel／分析結果</b><span>出力・取込仕様は後続フェーズで接続</span></div>
            </div>
          </section>
        </div>
      </section>
    </div>
  `;
}
