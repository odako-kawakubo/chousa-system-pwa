/**
 * Microsoft Graph / OneDrive の低レベル共通処理。
 *
 * v0.1.6.5C:
 * - /me/drive/root 決め打ちをやめ、共有フォルダの driveId / itemId を解決して扱う。
 * - 個人Drive・共有Driveのどちらでも同じAPIで子要素取得／作成／移動を行う。
 * - 旧版で実績のあった「共有アイテム→remoteItem.parentReference.driveId」解決を復活。
 */
import { getGraphAccessToken } from '../auth/microsoft-auth.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

function graphToken() {
  const token = getGraphAccessToken();
  if (!token) {
    const error = new Error('Microsoft Graphトークンがありません。Microsoftへ再ログインしてください。');
    error.code = 'GRAPH_TOKEN_MISSING';
    throw error;
  }
  return token;
}

async function graphRequest(path, { method = 'GET', body = null, headers = {}, expectJson = true } = {}) {
  const requestHeaders = { Authorization: `Bearer ${graphToken()}`, ...headers };
  const options = { method, headers: requestHeaders };
  if (body !== null && body !== undefined) options.body = body;

  const response = await fetch(`${GRAPH_BASE}${path}`, options);
  if (!response.ok) {
    let detail = '';
    let graphCode = '';
    try {
      const payload = await response.json();
      detail = payload?.error?.message || '';
      graphCode = payload?.error?.code || '';
    } catch {
      detail = await response.text().catch(() => '');
    }
    const error = new Error(detail || `OneDrive通信に失敗しました (${response.status})`);
    error.status = response.status;
    error.graphCode = graphCode;
    error.code = response.status === 401 ? 'GRAPH_UNAUTHORIZED'
      : response.status === 403 ? 'GRAPH_FORBIDDEN'
        : 'GRAPH_REQUEST_FAILED';
    throw error;
  }
  if (!expectJson || response.status === 204) return null;
  return response.json();
}

async function listPaged(path) {
  const items = [];
  let nextPath = path;
  while (nextPath) {
    const payload = await graphRequest(nextPath);
    items.push(...(payload?.value || []));
    const nextLink = payload?.['@odata.nextLink'] || '';
    nextPath = nextLink.startsWith(GRAPH_BASE) ? nextLink.slice(GRAPH_BASE.length) : '';
  }
  return items;
}

function normalizeRef(value = 'root') {
  if (value && typeof value === 'object') {
    return {
      driveId: String(value.driveId || ''),
      itemId: String(value.itemId || value.id || 'root')
    };
  }
  return { driveId: '', itemId: String(value || 'root') };
}

function refForItem(item, fallbackDriveId = '') {
  const remote = item?.remoteItem || null;
  const source = remote || item || {};
  return {
    driveId: String(source?.parentReference?.driveId || item?.parentReference?.driveId || fallbackDriveId || ''),
    itemId: String(source?.id || item?.id || ''),
    id: String(source?.id || item?.id || ''),
    name: String(source?.name || item?.name || ''),
    folder: source?.folder || item?.folder || null,
    file: source?.file || item?.file || null,
    parentReference: source?.parentReference || item?.parentReference || null,
    webUrl: source?.webUrl || item?.webUrl || '',
    remoteItem: remote
  };
}

function itemBasePath(value) {
  const ref = normalizeRef(value);
  if (ref.itemId === 'root') {
    return ref.driveId
      ? `/drives/${encodeURIComponent(ref.driveId)}/root`
      : '/me/drive/root';
  }
  return ref.driveId
    ? `/drives/${encodeURIComponent(ref.driveId)}/items/${encodeURIComponent(ref.itemId)}`
    : `/me/drive/items/${encodeURIComponent(ref.itemId)}`;
}

function childrenPath(value) {
  return `${itemBasePath(value)}/children`;
}

function quoteSearch(value) {
  return String(value || '').replace(/'/g, "''");
}

export async function listDriveChildren(parentRef = 'root') {
  const ref = normalizeRef(parentRef);
  const path = `${childrenPath(ref)}?$select=id,name,folder,file,parentReference,webUrl,remoteItem&$top=200`;
  const items = await listPaged(path);
  return items.map((item) => refForItem(item, ref.driveId));
}

export async function getDriveItem(itemRef) {
  const ref = normalizeRef(itemRef);
  if (!ref.itemId || ref.itemId === 'root') return null;
  const item = await graphRequest(`${itemBasePath(ref)}?$select=id,name,folder,file,parentReference,webUrl,remoteItem`);
  return refForItem(item, ref.driveId);
}

export async function findChildFolder(parentRef, name) {
  const target = String(name || '').trim();
  if (!target) return null;
  const children = await listDriveChildren(parentRef);
  return children.find((item) => item.folder && item.name === target) || null;
}

export async function createDriveFolder(parentRef, name) {
  const folderName = String(name || '').trim();
  if (!folderName) throw new Error('作成するOneDriveフォルダ名が空です。');
  const ref = normalizeRef(parentRef);
  const item = await graphRequest(childrenPath(ref), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' })
  });
  return refForItem(item, ref.driveId);
}

export async function ensureDriveFolder(parentRef, name) {
  return (await findChildFolder(parentRef, name)) || createDriveFolder(parentRef, name);
}

export async function moveDriveItem(itemRef, targetParentRef) {
  const source = normalizeRef(itemRef);
  const target = normalizeRef(targetParentRef);
  if (source.driveId && target.driveId && source.driveId !== target.driveId) {
    throw new Error('異なるOneDrive間の自動移動には対応していません。');
  }
  const item = await graphRequest(itemBasePath(source), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentReference: { id: target.itemId } })
  });
  return refForItem(item, source.driveId || target.driveId);
}

export async function deleteDriveItem(itemRef) {
  await graphRequest(itemBasePath(itemRef), { method: 'DELETE', expectJson: false });
}

export async function uploadDriveFile(parentRef, fileName, content, contentType = 'application/octet-stream') {
  const encodedName = encodeURIComponent(String(fileName || ''));
  if (!encodedName) throw new Error('保存するファイル名が空です。');
  const ref = normalizeRef(parentRef);
  const item = await graphRequest(`${itemBasePath(ref)}:/${encodedName}:/content`, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: content
  });
  return refForItem(item, ref.driveId);
}

async function searchMyDriveExactFolder(folderName) {
  const q = encodeURIComponent(quoteSearch(folderName));
  const items = await listPaged(`/me/drive/root/search(q='${q}')?$select=id,name,folder,parentReference,webUrl,remoteItem&$top=200`);
  const match = items
    .map((item) => refForItem(item))
    .find((item) => item.folder && item.name === folderName);
  return match || null;
}

async function sharedWithMeItems() {
  const items = await listPaged('/me/drive/sharedWithMe?$select=id,name,folder,parentReference,webUrl,remoteItem&$top=200');
  return items.map((item) => refForItem(item));
}

/**
 * 利用者がアクセス可能な「04 調査」等の共有ルートを driveId / itemId 付きで解決する。
 * 順序:
 * 1. 自分のOneDrive直下
 * 2. 自分のOneDrive内検索（ショートカット／追加済み共有項目を含む）
 * 3. sharedWithMe の共有項目そのもの
 * 4. sharedWithMe の共有フォルダ直下
 */
export async function resolveSharedRoot(folderName) {
  const target = String(folderName || '').trim();
  if (!target) throw new Error('OneDrive共有ルート名が空です。');

  const direct = await findChildFolder('root', target).catch(() => null);
  if (direct) return direct;

  const searched = await searchMyDriveExactFolder(target).catch(() => null);
  if (searched) return searched;

  const sharedItems = await sharedWithMeItems();
  const directShared = sharedItems.find((item) => item.folder && item.name === target);
  if (directShared) return directShared;

  for (const shared of sharedItems.filter((item) => item.folder && item.itemId && item.driveId)) {
    try {
      const child = await findChildFolder(shared, target);
      if (child) return child;
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) continue;
      throw error;
    }
  }

  const error = new Error(`アクセス可能なOneDrive内に「${target}」が見つかりません。`);
  error.code = 'SHARED_ROOT_NOT_FOUND';
  throw error;
}
