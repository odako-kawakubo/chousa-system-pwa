/**
 * Microsoft Graph / OneDrive の低レベル共通処理。
 *
 * v0.1.6.5D:
 * - v0.14.13で実機利用していた共有URL解決を第一経路へ戻す。
 * - 「04 調査」は名前検索を正本にせず、共有URLからdriveId / itemIdを直接解決する。
 * - 解決済み共有ルートは同一セッション中キャッシュし、各機能で同じ実体を参照する。
 * - 名前検索は共有URL解決に失敗した場合のフォールバックだけにする。
 */
import { getGraphAccessToken } from '../auth/microsoft-auth.js';
import { microsoftConfig } from '../../config/microsoft-config.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const sharedRootCache = new Map();

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

function base64UrlEncodeUtf8(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary)
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function sharedLinkId(url) {
  return `u!${base64UrlEncodeUtf8(url)}`;
}

async function resolveSharedUrl(sharedUrl) {
  const url = String(sharedUrl || '').trim();
  if (!url) return null;
  const shareId = sharedLinkId(url);
  const item = await graphRequest(`/shares/${encodeURIComponent(shareId)}/driveItem?$select=id,name,folder,file,parentReference,webUrl,remoteItem`);
  const ref = refForItem(item);
  if (!ref.driveId || !ref.itemId || !ref.folder) {
    const error = new Error('共有URLからOneDriveフォルダのdriveId/itemIdを取得できませんでした。');
    error.code = 'SHARED_URL_RESOLVE_FAILED';
    throw error;
  }
  return ref;
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

async function resolveByNameFallback(folderName) {
  const direct = await findChildFolder('root', folderName).catch(() => null);
  if (direct) return direct;

  const searched = await searchMyDriveExactFolder(folderName).catch(() => null);
  if (searched) return searched;

  const sharedItems = await sharedWithMeItems();
  const directShared = sharedItems.find((item) => item.folder && item.name === folderName);
  if (directShared) return directShared;

  for (const shared of sharedItems.filter((item) => item.folder && item.itemId && item.driveId)) {
    try {
      const child = await findChildFolder(shared, folderName);
      if (child) return child;
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) continue;
      throw error;
    }
  }
  return null;
}

/**
 * 利用者がアクセス可能な共有ルートをdriveId / itemId付きで解決する。
 * 「04 調査」は設定済み共有URLを第一経路とし、名前検索は予備経路だけにする。
 */
export async function resolveSharedRoot(folderName = microsoftConfig.surveyRootName) {
  const target = String(folderName || '').trim();
  if (!target) throw new Error('OneDrive共有ルート名が空です。');

  const cached = sharedRootCache.get(target);
  if (cached?.driveId && cached?.itemId) return { ...cached };

  let sharedUrlError = null;
  if (target === microsoftConfig.surveyRootName && microsoftConfig.surveyRootUrl) {
    try {
      const resolved = await resolveSharedUrl(microsoftConfig.surveyRootUrl);
      const verified = await getDriveItem(resolved);
      if (verified?.folder) {
        sharedRootCache.set(target, verified);
        return { ...verified };
      }
    } catch (error) {
      sharedUrlError = error;
    }
  }

  const fallback = await resolveByNameFallback(target);
  if (fallback) {
    sharedRootCache.set(target, fallback);
    return { ...fallback };
  }

  const error = new Error(
    sharedUrlError?.message
      ? `共有URLから「${target}」へ接続できませんでした。${sharedUrlError.message}`
      : `アクセス可能なOneDrive内に「${target}」が見つかりません。`
  );
  error.code = sharedUrlError?.code || 'SHARED_ROOT_NOT_FOUND';
  error.cause = sharedUrlError || null;
  throw error;
}

export function clearSharedRootCache(folderName = '') {
  const target = String(folderName || '').trim();
  if (target) sharedRootCache.delete(target);
  else sharedRootCache.clear();
}
