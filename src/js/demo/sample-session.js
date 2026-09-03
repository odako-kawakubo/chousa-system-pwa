/**
 * 公式サンプル案件の初期データを1か所で組み立てる。
 * サンプルは案件一覧用Snapshotとして準備するだけで、起動時の現在案件にはしない。
 */
import { sampleProject } from './sample-project.js';
import { seedInitialMaterials, seedInitialFinishRecords } from '../finish-table/finish-table-actions.js';
import { seedInitialPhotoRecords } from './sample-photos.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { saveProjectSnapshot } from '../projects/project-store.js';

export function initializeSampleProjectSnapshot() {
  finishRecordStore.clearAll();
  materialRecordStore.clearAll();
  photoRecordStore.clearAll();

  seedInitialMaterials();
  seedInitialFinishRecords();
  seedInitialPhotoRecords();

  const snapshot = saveProjectSnapshot({
    project: sampleProject,
    finishRecords: finishRecordStore.exportSnapshot(),
    materialRecords: materialRecordStore.exportSnapshot(),
    photoRecords: photoRecordStore.exportSnapshot(),
    syncMeta: {}
  });

  // 起動時の作業Storeをサンプル状態のまま残さない。
  finishRecordStore.clearAll();
  materialRecordStore.clearAll();
  photoRecordStore.clearAll();
  return snapshot;
}
