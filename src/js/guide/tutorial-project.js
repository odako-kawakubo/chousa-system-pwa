/**
 * src/js/guide/tutorial-project.js
 *
 * チュートリアル専用のローカル練習案件を生成する。
 * 実案件・公式サンプル案件とは分離し、Firestore/OneDriveへ送らない isSample 案件として扱う。
 * 「最初から」を選んだ時は常に同じ最小構成へ戻せるよう、Record Storeを経由せず
 * 純粋なseed生成関数からSnapshotを直接組み立てる。
 */
import { buildFloorRoomSeed, buildFlatRoomSeed } from '../finish-table/finish-table-structure-actions.js';
import { getProject, saveProjectSnapshot } from '../projects/project-store.js';

export const TUTORIAL_PROJECT_ID = 'TUTORIAL-001';
const TUTORIAL_START_KEY = 'shirabe-start-basic-tutorial';

export const tutorialProject = {
  projectId: TUTORIAL_PROJECT_ID,
  projectNo: 'TUTORIAL',
  projectName: '操作チュートリアル',
  projectType: 'tutorial',
  isSample: true,
  isTutorial: true
};

function buildTutorialFinishRecords() {
  const records = [];

  // 基本操作を短時間で練習できるよう、内部は1F・5部屋だけから開始する。
  for (let index = 1; index <= 5; index += 1) {
    records.push(...buildFloorRoomSeed('I', 1, index));
  }

  // 外部・階段・屋上の画面構成も確認できる最低限の枠は残す。
  records.push(...buildFlatRoomSeed('S', 1));
  records.push(...buildFlatRoomSeed('R', 1));
  ['東面', '西面', '南面', '北面'].forEach((name, index) => {
    records.push(...buildFlatRoomSeed('E', index + 1, name));
  });

  return records;
}

/**
 * 起動時に練習案件が未登録なら追加する。既に操作途中のSnapshotがある場合は上書きしない。
 */
export function initializeTutorialProjectSnapshot() {
  return getProject(TUTORIAL_PROJECT_ID) || resetTutorialProjectSnapshot();
}

/**
 * 練習案件を初期状態へ戻す。
 * 建材・写真・分析結果は空、仕上表だけを1F・5部屋の最小構成で持つ。
 */
export function resetTutorialProjectSnapshot() {
  return saveProjectSnapshot({
    project: tutorialProject,
    finishRecords: buildTutorialFinishRecords(),
    materialRecords: [],
    photoRecords: [],
    syncMeta: {},
    source: 'tutorial-reset'
  });
}


/** トップページから案件画面へ遷移した直後に基本チュートリアルを開始するための一回限りフラグ。 */
export function requestTutorialAutoStart() {
  try {
    sessionStorage.setItem(TUTORIAL_START_KEY, '1');
  } catch {
    // sessionStorageが使えなくても、案件自体は通常どおり開ける。
  }
}

export function consumeTutorialAutoStart() {
  try {
    const requested = sessionStorage.getItem(TUTORIAL_START_KEY) === '1';
    sessionStorage.removeItem(TUTORIAL_START_KEY);
    return requested;
  } catch {
    return false;
  }
}
