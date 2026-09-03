/**
 * Microsoft Graph / OneDrive の低レベルAPI。
 * Graph認証はgraph-session、業務ルートの選定・保持はonedrive-connectionが担当する。
 */
import { getGraphAccessToken } from '../auth/graph-session.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

async function graphRequest(path, { method = 'GET', body = null, headers = {}, expectJson = true } = {}) {
  const accessToken = await getGraphAccessToken();
  const options = {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, ...headers }
  };
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
        : response.status === 404 ? 'GRAPH_NOT_FOUND'
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
    return ref.driveId ? `/drives/${encodeURIComponent(ref.driveId)}/root` : '/me/drive/root';
  }
  return ref.driveId
    ? `/drives/${encodeURIComponent(ref.driveId)}/items/${encodeURIComponent(ref.itemId)}`
    : `/me/drive/items/${encodeURIComponent(ref.itemId)}`;
}

function childrenPath(value) {
  return `${itemBasePath(value)}/children`;
}

function base64UrlEncodeUtf8(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function sharedLinkId(url) {
  return `u!${base64UrlEncodeUtf8(url)}`;
}

/** 固定共有URLをGraph上のdriveId/itemIdへ変換する。業務上のフォールバック判断はここでは行わない。 */
export async function resolveSharedUrl(sharedUrl) {
  const url = String(sharedUrl || '').trim();
  if (!url) {
    const error = new Error('OneDrive共有URLが設定されていません。');
    error.code = 'SHARED_URL_MISSING';
    throw error;
  }
  const shareId = sharedLinkId(url);
  const item = await graphRequest(`/shares/${encodeURIComponent(shareId)}/driveItem?$select=id,name,folder,file,parentReference,webUrl,remoteItem`);
  const ref = refForItem(item);
  if (!ref.driveId || !ref.itemId || !ref.folder) {
    const error = new Error('共有URLからフォルダのdriveId/itemIdを取得できませんでした。');
    error.code = 'SHARED_URL_RESOLVE_FAILED';
    throw error;
  }
  return ref;
}

/**
 * v0.14系で利用していたOneDrive内検索の低レベルAPI。
 * どの候補を業務ルートとして採用するかはonedrive-connection側だけが判断する。
 */
export async function searchDriveFolders(keyword) {
  const query = String(keyword || '').trim();
  if (!query) return [];
  const safe = query.replace(/'/g, "''");
  const items = await listPaged(`/me/drive/root/search(q='${encodeURIComponent(safe)}')?$select=id,name,folder,webUrl,parentReference,remoteItem&$top=200`);
  return items
    .map((item) => refForItem(item))
    .filter((item) => item.folder && item.driveId && item.itemId);
}

export async function listDriveChildren(parentRef = 'root') {
  const ref = normalizeRef(parentRef);
  const items = await listPaged(`${childrenPath(ref)}?$select=id,name,folder,file,parentReference,webUrl,remoteItem&$top=200`);
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