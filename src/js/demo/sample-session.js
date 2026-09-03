/**
 * 公式サンプル案件の初期データを1か所で組み立てる。
 *
 * 仕上表・建材・写真の各Controllerはサンプル投入を行わず、
 * アプリ起動時にこの入口だけが3つの正式Storeへサンプルデータを投入し、
 * project-storeへ1案件分のSnapshotとして登録する。
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

  return saveProjectSnapshot({
    project: sampleProject,
    finishRecords: finishRecordStore.exportSnapshot(),
    materialRecords: materialRecordStore.exportSnapshot(),
    photoRecords: photoRecordStore.exportSnapshot(),
    syncMeta: {}
  });
}
