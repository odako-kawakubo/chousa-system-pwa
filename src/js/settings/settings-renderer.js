/**
 * src/js/settings/settings-renderer.js
 *
 * 設定タブの描画専用モジュール。
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

function formatSyncTime(value) {
  const time = Number(value || 0);
  if (!time) return '未同期';
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return '未同期';
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(date);
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
        <div class="settings-grid settings-sync-grid">
          <section class="settings-card">
            <div class="settings-card-head">
              <div>
                <h3>同期状態</h3>
                <div class="hint">現在開いている案件のFirestore同期状態です。</div>
              </div>
              <span class="pill settings-sync-state-pill" data-settings-sync-status>${escapeHtml(viewModel.sync.text)}</span>
            </div>
            <div class="settings-status-list">
              <div><span>Firestore</span><b data-settings-sync-firestore>${escapeHtml(viewModel.sync.text)}</b></div>
              <div><span>最終同期</span><b data-settings-sync-time>${escapeHtml(formatSyncTime(viewModel.sync.lastSyncedAt))}</b></div>
              <div><span>未送信</span><b data-settings-sync-unsent>${escapeHtml(viewModel.sync.unsentCount)}件</b></div>
            </div>
            <div class="settings-action-row">
              <button type="button" class="btn" disabled title="後続フェーズで接続">今すぐ同期</button>
            </div>
          </section>

          <section class="settings-card">
            <div class="settings-card-head">
              <div>
                <h3>オフラインモード</h3>
                <div class="hint">ONの間はFirestoreとの送受信を停止し、端末内へ保存します。</div>
              </div>
              <button type="button" class="btn small${viewModel.sync.manualOffline ? ' active' : ''}" data-action="toggle-manual-offline" data-settings-offline-toggle aria-pressed="${viewModel.sync.manualOffline ? 'true' : 'false'}">${viewModel.sync.manualOffline ? 'ON' : 'OFF'}</button>
            </div>
          </section>

          <section class="settings-card">
            <div class="settings-card-head">
              <div>
                <h3>端末</h3>
                <div class="hint">この端末の表示名はここから変更できます。</div>
              </div>
              <span class="pill">${escapeHtml(viewModel.device.code)}</span>
            </div>
            <div class="settings-device-editor">
              <label><span>端末名</span><input value="${escapeHtml(viewModel.device.name)}" data-setting-device-name></label>
              <button type="button" class="btn" data-action="save-device-name">変更</button>
            </div>
          </section>

          <section class="settings-card">
            <div class="settings-card-head">
              <div>
                <h3>Microsoft / OneDrive</h3>
                <div class="hint">OneDriveは共有保存先「04 調査」へ実アクセスできた時だけ接続済みと表示します。</div>
              </div>
              <span class="pill${viewModel.auth.loggedIn ? ' ok' : ''}">${viewModel.auth.loggedIn ? 'ログイン済み' : '未ログイン'}</span>
            </div>
            <div class="settings-status-list">
              <div><span>ユーザー</span><b data-settings-auth-user>${escapeHtml(viewModel.auth.displayName || '未ログイン')}</b></div>
              <div><span>Graphトークン</span><b data-settings-graph-state>${viewModel.auth.graphTokenReady ? '取得済み' : '未取得'}</b></div>
              <div><span>OneDrive</span><b data-settings-onedrive-state title="${escapeHtml(viewModel.oneDrive.error || '')}">${escapeHtml(viewModel.oneDrive.text)}</b></div>
              <div><span>保存先</span><b data-settings-onedrive-root>${escapeHtml(viewModel.oneDrive.connected ? (viewModel.oneDrive.root?.name || '04 調査') : '-')}</b></div>
            </div>
          </section>

          <section class="settings-card settings-sync-wide settings-sync-diagnostic-log-card">
            <div class="settings-card-head">
              <div>
                <h3>同期診断ログ</h3>
                <div class="hint">Firestoreの読み書きに関係するアプリ処理とlistenerの発火を端末内へ記録します。診断用ログ自体はFirestore通信を行いません。</div>
              </div>
              <span class="pill">診断用</span>
            </div>
            <textarea class="settings-sync-diagnostic-log-output" data-settings-sync-diagnostic-log readonly spellcheck="false" aria-label="同期診断ログ"></textarea>
            <div class="settings-action-row">
              <button type="button" class="btn small" data-action="copy-sync-diagnostic-log">ログをコピー</button>
              <button type="button" class="btn small" data-action="download-sync-diagnostic-log">診断ログを保存</button>
              <button type="button" class="btn small" data-action="clear-sync-diagnostic-log">ログをクリア</button>
            </div>
          </section>

          <section class="settings-card settings-sync-wide">
            <div class="settings-card-head">
              <div>
                <h3>バックアップ</h3>
                <div class="hint">OneDriveへの写真保存・完全バックアップは後続フェーズで接続します。</div>
              </div>
              <span class="pill">未接続</span>
            </div>
            <div class="settings-status-list">
              <div><span>最終バックアップ</span><b>未実行</b></div>
              <div><span>自動バックアップ</span><b>30分ごと（後続接続）</b></div>
            </div>
            <div class="settings-action-row">
              <button type="button" class="btn" disabled title="OneDrive接続後に有効化">今すぐバックアップ</button>
            </div>
          </section>
        </div>
      </section>
    </div>
  `;
}
