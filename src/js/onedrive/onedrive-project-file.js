/**
 * OneDrive案件フォルダ内の業務ファイル選定と案件Excel読取。
 * Graph通信そのものはonedrive-clientへ委譲し、この層では案件ファイルの意味だけを扱う。
 */
import { listDriveChildren, readDriveWorkbookRange } from './onedrive-client.js';

function itemId(item) {
  return String(item?.itemId || item?.id || '');
}

function fileRef(item, fallbackDriveId = '') {
  return {
    driveId: String(item?.driveId || fallbackDriveId || ''),
    itemId: itemId(item)
  };
}

function normalizeProjectNo(value) {
  return String(value ?? '').trim();
}

function isExcelFile(item) {
  return Boolean(item?.file) && /\.xlsx$/i.test(String(item?.name || ''));
}

function isInternalRequestFile(name) {
  return /^社内依頼用[\s　]/.test(String(name || '').trim());
}

function scoreCandidate(item, projectNo) {
  const name = String(item?.name || '').trim();
  if (!name.includes(projectNo)) return -1;
  return isInternalRequestFile(name) ? 1 : 2;
}

/**
 * 案件番号を含むxlsxだけを対象にし、通常版を社内依頼用より優先する。
 */
export async function findProjectExcelFile(projectFolder, projectNo) {
  const no = normalizeProjectNo(projectNo);
  if (!no) throw new Error('案件番号を確認できません。');

  const children = await listDriveChildren(projectFolder);
  const candidates = children
    .filter(isExcelFile)
    .map((item) => ({ item, score: scoreCandidate(item, no) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score || String(a.item.name || '').localeCompare(String(b.item.name || ''), 'ja'));

  return candidates[0]?.item || null;
}

function cellValue(row, index) {
  const value = row?.[index];
  return value === null || value === undefined ? '' : String(value).trim();
}

/**
 * 「入力」シートの固定セルから案件情報を読む。
 * F2=案件番号 / K2=案件名 / L2=住所。
 */
export async function readProjectExcelInfo(projectFolder, projectNo) {
  const excel = await findProjectExcelFile(projectFolder, projectNo);
  if (!excel) {
    const error = new Error(`案件番号 ${projectNo} の案件Excelが見つかりません。`);
    error.code = 'PROJECT_EXCEL_NOT_FOUND';
    throw error;
  }

  const range = await readDriveWorkbookRange(fileRef(excel, projectFolder?.driveId), '入力', 'F2:L2');
  const row = Array.isArray(range?.values?.[0]) ? range.values[0] : [];
  const info = {
    projectNo: cellValue(row, 0),
    projectName: cellValue(row, 5),
    address: cellValue(row, 6),
    excelFileId: itemId(excel),
    excelFileName: String(excel?.name || ''),
    excelFileWebUrl: String(excel?.webUrl || '')
  };

  if (!info.projectNo) {
    const error = new Error('案件Excelの入力!F2（案件番号）が空です。');
    error.code = 'PROJECT_EXCEL_PROJECT_NO_EMPTY';
    throw error;
  }
  if (!info.projectName) {
    const error = new Error('案件Excelの入力!K2（案件名）が空です。');
    error.code = 'PROJECT_EXCEL_PROJECT_NAME_EMPTY';
    throw error;
  }

  return info;
}
