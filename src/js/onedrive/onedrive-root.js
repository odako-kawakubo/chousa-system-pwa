/**
 * 「04 調査」業務ルートを固定IDで解決・キャッシュする。
 * 棟や案件とは独立したOneDrive業務設定。各利用者のショートカットや
 * 名前検索には依存しない。接続の可否とアクセス権限はonedrive-connectionで確認する。
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
export function clearSurveyRoot() { surveyRootCache = null; }
export function getCachedSurveyRoot() { return surveyRootCache ? { ...surveyRootCache } : null; }
