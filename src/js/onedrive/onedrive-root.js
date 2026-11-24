/**
 * 「04 調査」の業務ルートを共有元フォルダの固定IDで解決する。
 * OneDriveショートカット、共有URL変換、フォルダ名検索には依存しない。
 * Microsoft認証と実アクセス/children検証はonedrive-connection.jsが担当する。
 */
import { microsoftConfig } from '../../config/microsoft-config.js';

let surveyRootCache = null;

function configuredSurveyRoot() {
  const driveId = String(microsoftConfig.surveyRootDriveId || '').trim();
  const itemId = String(microsoftConfig.surveyRootItemId || '').trim();
  if (!driveId || !itemId) {
    const error = new Error('04 調査の接続先IDが設定されていません。');
    error.code = 'SURVEY_ROOT_ID_MISSING';
    throw error;
  }
  return { driveId, itemId, name: microsoftConfig.surveyRootName, rootSource: 'configured-id' };
}

export async function getSurveyRoot({ force = false } = {}) {
  if (force || !surveyRootCache) surveyRootCache = configuredSurveyRoot();
  return { ...surveyRootCache };
}

export function clearSurveyRoot() {
  surveyRootCache = null;
}

export function getCachedSurveyRoot() {
  return surveyRootCache ? { ...surveyRootCache } : null;
}
