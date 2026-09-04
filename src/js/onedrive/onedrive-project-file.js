/**
 * OneDrive案件フォルダ内の業務ファイル選定と案件Excel読取。
 * Graph通信そのものはonedrive-clientへ委譲し、この層では案件ファイルの意味だけを扱う。
 * 実運用の.xlsmを含むため、Workbook APIではなくファイル本体を取得してOpen XMLを読む。
 */
import { listDriveChildren, downloadDriveFile } from './onedrive-client.js';
import { readOpenXmlCells } from './openxml-workbook-reader.js';

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
  return Boolean(item?.file) && /\.(?:xlsx|xlsm)$/i.test(String(item?.name || ''));
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
 * 案件番号を含む.xlsx/.xlsmだけを対象にし、通常版を社内依頼用より優先する。
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

  const file = await downloadDriveFile(fileRef(excel, projectFolder?.driveId), { responseType: 'arrayBuffer' });
  const cells = await readOpenXmlCells(file, '入力', ['F2', 'K2', 'L2']);
  const info = {
    projectNo: String(cells.F2 || '').trim(),
    projectName: String(cells.K2 || '').trim(),
    address: String(cells.L2 || '').trim(),
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
