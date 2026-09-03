/**
 * 「04 調査」業務ルートの解決・キャッシュだけを担当する。
 *
 * v0.14系 MicrosoftPhotoUpload.resolveSharedRoot/getUploadFolder の順序を維持する:
 * 1. 固定共有URLを /shares/{shareId}/driveItem で解決
 * 2. 失敗した場合だけ OneDrive root search へフォールバック
 * 3. 検索候補の表示名で「04 調査」を選ぶ
 * 4. remoteItem がある場合は remoteItem の driveId/itemId を採用
 *
 * 接続状態の表示、案件一覧、案件フォルダ作成はここでは扱わない。
 */
import { resolveSharedUrl, searchDriveFolders } from './onedrive-client.js';
import { microsoftConfig } from '../../config/microsoft-config.js';

let surveyRootCache = null;

function cloneRoot(root) {
  return root ? { ...root } : null;
}

async function resolveLegacyCompatibleRoot() {
  const expectedName = String(microsoftConfig.surveyRootName || '').trim();
  let sharedError = null;

  // v0.14系と同じ第一経路: 固定共有URL。
  try {
    const root = await resolveSharedUrl(microsoftConfig.surveyRootUrl);
    return { ...root, rootSource: 'fixed-share' };
  } catch (error) {
    sharedError = error;
    console.warn('共有URL解決失敗。OneDrive内の共有追加フォルダを検索します', error);
  }

  // v0.14系と同じ検索語: 先頭の数字+空白を除いた名称。04 調査 -> 調査
  const keyword = expectedName.replace(/^\d+\s*/, '').trim() || expectedName;
  const found = await searchDriveFolders(keyword);

  // v0.14系と同じ候補選定順。
  const candidates = found.filter((item) => String(item?.name || '').includes(expectedName));
  const candidate = candidates[0]
    || found.find((item) => String(item?.name || '').includes(keyword))
    || null;

  if (!candidate?.driveId || !candidate?.itemId) {
    const error = new Error(`${expectedName || '共有フォルダ'}のdriveId/itemIdを取得できませんでした`);
    error.code = 'SURVEY_ROOT_RESOLVE_FAILED';
    error.sharedUrlError = sharedError;
    throw error;
  }

  return { ...candidate, rootSource: 'legacy-search' };
}

/** v0.14系 getUploadFolder 相当。 */
export async function getSurveyRoot({ force = false } = {}) {
  if (!force && surveyRootCache?.driveId && surveyRootCache?.itemId) {
    return cloneRoot(surveyRootCache);
  }
  surveyRootCache = await resolveLegacyCompatibleRoot();
  return cloneRoot(surveyRootCache);
}

export function clearSurveyRoot() {
  surveyRootCache = null;
}

export function getCachedSurveyRoot() {
  return cloneRoot(surveyRootCache);
}
