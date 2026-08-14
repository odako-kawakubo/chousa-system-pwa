/**
 * src/js/photos/photo-renderer.js
 *
 * v0.1.5.3D 写真タブDOM描画。
 * v0.15.10基準の写真タブUIを維持しつつ、Dで確定した文言・配置へ整理する。
 *
 * 重要：
 * - データ取得やRecord更新はここで行わない。
 * - 採取数 / 採取場所 / 採取部位はPhoto ViewModelが建材レコードから取得済みの値を描画するだけ。
 * - 目視の部位 / 使用建材はPhoto ViewModelが仕上表レコードを起点に組み立てた値を描画するだけ。
 */

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function roomTitle(room) {
  const no = String(room?.roomNo || '-').trim();
  const name = String(room?.roomName || '').trim();
  return name && name !== no ? `${no}　${name}` : no;
}

function floorLabel(room) {
  if (!room) return 'その他';
  if (room.areaCode === 'B') return `地下${room.floor || ''}階`;
  if (room.areaCode === 'I') return `${room.floor || ''}階`;
  if (room.areaCode === 'S') return '階段';
  if (room.areaCode === 'R') return '屋上';
  return 'その他';
}

/**
 * 写真サムネイル。
 * 画像本体のURLはphotoRecordへ重複保存しないため、ここではメタ情報サムネイルを表示する。
 * 実画像がローカルで選択された場合はPhotoViewer側の一時URLでプレビューする。
 */
function photoThumb(photo, { compact = false, extra = false } = {}) {
  if (!photo) {
    return `<div class="photo-thumb-card photo-thumb-empty ${compact ? 'compact' : ''} ${extra ? 'extra' : ''}"><span>未撮影</span></div>`;
  }
  return `<div class="photo-thumb-card ${compact ? 'compact' : ''} ${extra ? 'extra' : ''}" title="${esc(photo.fileName || photo.photoId)}">
    <span class="photo-thumb-icon">📷</span>
    <span class="photo-thumb-file">${esc(photo.fileName || photo.photoId)}</span>
    <button class="photo-expand-btn" type="button" data-photo-expand="${esc(photo.photoId)}" aria-label="写真を拡大">拡大</button>
  </div>`;
}

function renderOtherPhotoRows(photos) {
  if (!photos.length) return '';
  return `<div class="photo-extra-strip">${photos.map((photo) => `
    <div class="photo-extra-item">
      ${photoThumb(photo, { compact: true, extra: true })}
      <div class="photo-extra-actions">
        ${photo.isRepresentative ? '<span class="pill">代表</span>' : `<button class="btn small" type="button" data-photo-representative="${esc(photo.photoId)}">代表</button>`}
        <button class="btn small danger" type="button" data-photo-delete="${esc(photo.photoId)}">削除</button>
      </div>
    </div>`).join('')}</div>`;
}

/** 目視1部位分のカード。 */
function renderVisualTarget(target, openKeys) {
  const isOpen = openKeys.has(target.key);
  const others = target.photos.filter((photo) => photo.photoId !== target.representative?.photoId);
  const hasInput = target.materials.length > 0;

  // v0.1.5.3D:
  // 入力済み → 「部位：○○　使用建材：【1】○○」
  // 未入力   → 「未入力」だけ
  const infoLine = hasInput
    ? `<div class="visual-info-line">
        <span><span class="label">部位：</span><b>${esc(target.part)}</b></span>
        <span class="visual-material-line"><span class="label">使用建材：</span>${esc(target.materialText)}</span>
      </div>`
    : '<div class="visual-info-line visual-unentered"><b>未入力</b></div>';

  return `<article class="photo-frame-card visual-compact ${hasInput ? 'visual-has-input' : 'visual-empty'}" data-photo-target-key="${esc(target.key)}">
    ${infoLine}

    <div class="visual-compact-actions">
      ${target.representative
        ? `<div class="visual-representative">${photoThumb(target.representative)}</div>`
        : '<div class="photo-thumb-card photo-thumb-empty"><b>代表写真</b><span>未撮影</span></div>'}
      <button class="btn visual-add-btn" type="button" data-photo-add-visual="${esc(target.key)}" title="写真を追加">＋</button>
      <button class="btn small primary visual-camera-btn" type="button" data-photo-camera-visual="${esc(target.key)}">カメラ起動</button>
    </div>

    ${target.photoCount > 1 ? `<div class="visual-expand-row">
      <button class="visual-expand-toggle ${isOpen ? 'is-open' : ''}" type="button" data-photo-toggle="${esc(target.key)}">${isOpen ? '▼' : '▶'} 他の写真（${target.photoCount - 1}）</button>
    </div>` : ''}

    ${isOpen ? `<div class="visual-expanded-row">${renderOtherPhotoRows(others)}</div>` : ''}
  </article>`;
}

function renderRoomItems(rooms, activeRoomUid) {
  return rooms.map((room) => `
    <button class="photo-target-item grouped ${activeRoomUid === room.roomUid ? 'active' : ''}" type="button" data-photo-room="${esc(room.roomUid)}">
      <b>${esc(roomTitle(room))}</b>
      <span class="meta">写真 ${room.photoCount}枚</span>
    </button>`).join('');
}

function renderVisualRoomList(rooms, activeRoomUid, collapsedGroups) {
  const external = rooms.filter((room) => room.areaCode === 'E');
  const internal = rooms.filter((room) => room.areaCode !== 'E');
  const sections = [];

  if (external.length) {
    const key = 'visual-group:external';
    const collapsed = collapsedGroups.has(key);
    sections.push(`<div class="photo-location-group">
      <button class="photo-group-head photo-group-toggle" type="button" data-photo-list-group="${key}">
        <span><span class="mark">${collapsed ? '▶' : '▼'}</span> 外部</span>
        <span class="group-meta">${external.length}箇所</span>
      </button>
      ${collapsed ? '' : renderRoomItems(external, activeRoomUid)}
    </div>`);
  }

  if (internal.length) {
    const parentKey = 'visual-group:internal';
    const parentCollapsed = collapsedGroups.has(parentKey);
    const floorGroups = new Map();

    internal.forEach((room) => {
      const label = floorLabel(room);
      if (!floorGroups.has(label)) floorGroups.set(label, []);
      floorGroups.get(label).push(room);
    });

    sections.push(`<div class="photo-location-group">
      <button class="photo-group-head photo-group-toggle" type="button" data-photo-list-group="${parentKey}">
        <span><span class="mark">${parentCollapsed ? '▶' : '▼'}</span> 内部</span>
        <span class="group-meta">${internal.length}部屋</span>
      </button>
      ${parentCollapsed ? '' : [...floorGroups.entries()].map(([label, groupRooms]) => {
        const subKey = `visual-subgroup:${label}`;
        const collapsed = collapsedGroups.has(subKey);
        return `<div class="photo-subgroup">
          <button class="photo-subgroup-head photo-group-toggle" type="button" data-photo-list-group="${esc(subKey)}">
            <span><span class="mark">${collapsed ? '▶' : '▼'}</span> ${esc(label)}</span>
            <span class="group-meta">${groupRooms.length}</span>
          </button>
          ${collapsed ? '' : renderRoomItems(groupRooms, activeRoomUid)}
        </div>`;
      }).join('')}
    </div>`);
  }

  return sections.join('');
}

export function renderPhotoShell(container, mode) {
  container.innerHTML = `<div class="panel photo-panel">
    <div class="photo-mode-sticky">
      <div class="photo-action-row photo-action-main">
        <div class="left photo-mode-tabs">
          <button class="photo-mode-tab ${mode === 'visual' ? 'active' : ''}" type="button" data-photo-mode="visual">目視調査</button>
          <button class="photo-mode-tab ${mode === 'sampling' ? 'active' : ''}" type="button" data-photo-mode="sampling">建材採取</button>
        </div>
        <div class="right photo-top-actions">
          <button class="btn small" type="button" data-photo-picker>写真選択</button>
          <button class="btn small primary" type="button" data-photo-camera-global>カメラ起動</button>
        </div>
      </div>
      <div class="photo-action-row photo-hint-row"><span class="hint" id="photoModeHint"></span></div>
    </div>
    <div class="photo-body" id="photoModeBody"></div>
    <input id="photoFilePicker" type="file" accept="image/*" hidden />
  </div>`;
}

export function renderVisualView(container, view, state) {
  const hint = document.getElementById('photoModeHint');
  if (hint) hint.textContent = '部屋ごとの目視写真。左から調査場所を選び、右で部位ごとの代表写真と追加写真を確認します。';

  if (!view.rooms.length) {
    container.innerHTML = '<div class="photo-empty">部屋がありません。</div>';
    return;
  }

  const room = view.activeRoom;
  const cards = view.targets.map((target) => renderVisualTarget(target, state.openVisualKeys)).join('');

  container.innerHTML = `<div class="photo-target-layout">
    <aside class="photo-target-list">
      <div class="photo-target-list-head">調査場所</div>
      ${renderVisualRoomList(view.rooms, room?.roomUid || '', state.collapsedLocationGroups)}
    </aside>
    <section class="photo-review-panel">
      <div class="photo-review-panel-head">
        <h4>${esc(roomTitle(room))}</h4>
        <span class="hint">部屋位置 ${esc(room.roomPosition)}</span>
      </div>
      <div class="photo-detail-body">${cards || '<div class="photo-empty">表示できる調査部位がありません。</div>'}</div>
    </section>
  </div>`;
}

/**
 * 採取の1撮影区分（施工前 / 施工中 / 施工後 / 断面）。
 * Dでは区分名を写真枠の外ではなく、写真が入る枠の中へ配置する。
 */
function renderStageColumn(point, stage, isOpen) {
  const representative = stage.representative;
  const extras = stage.photos.filter((photo) => photo.photoId !== representative?.photoId);

  const stageContent = representative
    ? `<div class="sample-stage-representative">
        ${photoThumb(representative)}
        <span class="sample-stage-overlay-label">${esc(stage.label)}</span>
      </div>`
    : `<div class="sample-stage-empty-copy"><b>${esc(stage.label)}</b><span>未撮影</span></div>`;

  return `<div class="sample-stage-column">
    <div class="photo-stage-tile ${stage.count ? 'done' : 'missing'} ${point.nextStage === stage.label ? 'next' : ''}">
      ${stageContent}
      <button class="photo-stage-add" type="button" data-photo-add-sampling="${esc(point.key)}" data-photo-stage="${esc(stage.shootingType)}" aria-label="${esc(stage.label)}へ写真追加">＋</button>
    </div>
    ${isOpen && extras.length ? `<div class="sample-extra-stack">${extras.map((photo) => `
      <div class="sample-extra-item">
        ${photoThumb(photo, { compact: true, extra: true })}
        <div class="sample-extra-actions">
          <button class="btn small" type="button" data-photo-representative="${esc(photo.photoId)}">代表</button>
          <button class="btn small danger" type="button" data-photo-delete="${esc(photo.photoId)}">削除</button>
        </div>
      </div>`).join('')}</div>` : ''}
  </div>`;
}

function renderSamplePoint(point, openKeys) {
  const isOpen = openKeys.has(point.key);
  const extraCount = point.stages.reduce((sum, stage) => sum + Math.max(0, stage.count - (stage.representative ? 1 : 0)), 0);

  return `<article class="sample-point-block sample-compact">
    <div class="sample-compact-head">
      <div class="sample-compact-info">
        <span><span class="label">試料No.：</span><b>${esc(point.sampleNo || '-')}</b></span>
        <span><span class="label">採取場所：</span>${esc(point.samplingPlace || '-')}</span>
        <span><span class="label">採取部位：</span>${esc(point.part || '-')}</span>
      </div>
      <span class="sample-next">次：${esc(point.nextStage)}</span>
    </div>

    <div class="sample-stage-grid">
      ${point.stages.map((stage) => renderStageColumn(point, stage, isOpen)).join('')}
      <div class="sample-block-camera"><button class="btn small primary" type="button" data-photo-camera-sampling="${esc(point.key)}">カメラ起動</button></div>
    </div>

    ${extraCount > 0 ? `<div class="sample-expand-row">
      <button class="sample-expand-toggle ${isOpen ? 'is-open' : ''}" type="button" data-photo-toggle-sampling="${esc(point.key)}">${isOpen ? '▼' : '▶'} 他の写真（${extraCount}）</button>
    </div>` : ''}
  </article>`;
}

export function renderSamplingView(container, view, state) {
  const hint = document.getElementById('photoModeHint');
  if (hint) hint.textContent = '建材レコードの採取数・採取場所1〜3・採取部位をそのまま反映します。撮影区分は施工前・施工中・施工後・断面です。';

  if (!view.materials.length) {
    container.innerHTML = '<div class="photo-empty">採取試料がありません。</div>';
    return;
  }

  // 左リストの試料名称に使う部位は、使用部位(material.part)ではなく
  // 建材レコードで選択した採取部位(material.samplePart)を正本として表示する。
  // 例：1　建材No.2　壁、天井　石こうボードA
  const materialList = view.materials.map((material) => `
    <button class="photo-target-item ${view.activeMaterial?.materialId === material.materialId ? 'active' : ''}" type="button" data-photo-material="${esc(material.materialId)}">
      <b>${esc(material.sampleNo)}　建材No.${esc(material.materialNo)}　${esc(material.samplePart || '-')}　${esc(material.name || '-')}</b>
      <span class="meta">採取数：${esc(material.sampleCount)}</span>
      <span class="meta">写真 ${material.photoCount}枚</span>
    </button>`).join('');

  const active = view.activeMaterial;
  container.innerHTML = `<div class="photo-target-layout">
    <aside class="photo-target-list">
      <div class="photo-target-list-head">採取試料</div>
      ${materialList}
    </aside>
    <section class="photo-review-panel">
      <div class="photo-review-panel-head">
        <h4>建材No.${esc(active.materialNo)}　${esc(active.name || '-')}</h4>
        <span class="hint">採取数 ${esc(active.sampleCount)}</span>
      </div>
      <div class="photo-detail-body sample-points">${active.points.map((point) => renderSamplePoint(point, state.openSamplingKeys)).join('')}</div>
    </section>
  </div>`;
}
