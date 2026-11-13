/**
 * 「04 調査」業務ルートを実体IDで解決・キャッシュする。
 * 利用者ごとのOneDriveショートカット、共有URL変換、名前検索には依存しない。
 * Graph認証と実フォルダ・childrenアクセスの検証はonedrive-connectionが行う。
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

/** getUsableSurveyRootを唯一の実アクセス確認入口とする。 */
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
