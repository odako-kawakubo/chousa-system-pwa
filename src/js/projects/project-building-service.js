/**
 * 案件内の棟追加を確定する業務入口。
 * Firestoreで採番が成功した後、現在の端末の案件Snapshotと初期仕上表へ反映する。
 * 仕上表UIやレビュー公開の責務は持たない。
 */
import { getCurrentProject, getProject, updateProjectFields } from './project-store.js';
import { saveCurrentProjectSession } from './project-session.js';
import { normalizeProjectBuildings } from './project-buildings.js';
import { reserveNextBuildingForProject } from '../sync/project-record-persistence.js';
import { createDefaultFinishRecords } from '../default/default-finish-data.js';
import * as finishRecordStore from '../store/finish-record-store.js';

export function ensureDeclaredBuildingFinishRecords(project, { notify = false } = {}) {
  const buildings = normalizeProjectBuildings(project?.buildings);
  let added = 0;
  finishRecordStore.batch(() => {
    for (const buildingId of Object.keys(buildings)) {
      for (const record of createDefaultFinishRecords(buildingId)) {
        if (finishRecordStore.get(record.finishId)) continue;
        finishRecordStore.set(record);
        added += 1;
      }
    }
  });
  return added;
}

export async function addBuildingForCurrentProject(name = '') {
  const project = getCurrentProject();
  if (!project?.projectId || project.isSample) return { ok: false, reason: 'project-not-available' };
  const reserved = await reserveNextBuildingForProject(project, name);
  if (!reserved.ok) return reserved;

  // トランザクションが並行端末の変更を確定した場合も、既知の棟を消さない。
  const latest = getProject(project.projectId)?.project || project;
  const buildings = {
    ...normalizeProjectBuildings(latest.buildings),
    [reserved.buildingId]: reserved.definition
  };
  updateProjectFields(project.projectId, { buildings });
  ensureDeclaredBuildingFinishRecords({ buildings });
  saveCurrentProjectSession();

  return { ok: true, buildingId: reserved.buildingId, definition: reserved.definition };
}
