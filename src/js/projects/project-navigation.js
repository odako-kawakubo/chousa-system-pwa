/**
 * トップ画面と案件画面のページ境界を管理する。
 * 案件選択は sessionStorage に projectId だけを渡し、案件データ本体は project-store / Firestore が正本。
 */
const OPEN_PROJECT_KEY = 'shirabe-open-project-id';

export function setOpenProjectId(projectId) {
  const id = String(projectId || '').trim();
  if (!id) return false;
  try {
    sessionStorage.setItem(OPEN_PROJECT_KEY, id);
    return true;
  } catch {
    return false;
  }
}

export function getOpenProjectId() {
  try {
    return String(sessionStorage.getItem(OPEN_PROJECT_KEY) || '');
  } catch {
    return '';
  }
}

export function clearOpenProjectId() {
  try {
    sessionStorage.removeItem(OPEN_PROJECT_KEY);
  } catch {
    // 保存領域が利用できなくても画面遷移は行う。
  }
}

export function openProjectPage(projectId) {
  if (!setOpenProjectId(projectId)) return false;
  window.location.assign('./app.html');
  return true;
}

export function openHomePage({ replace = false } = {}) {
  clearOpenProjectId();
  if (replace) window.location.replace('./');
  else window.location.assign('./');
}
