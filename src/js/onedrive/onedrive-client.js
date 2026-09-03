/**
 * Microsoft Graph / OneDrive の低レベル共通処理。
 * 写真・バックアップ・案件統合はこの層を共有し、Graph APIの呼び方を重複させない。
 */
import { getGraphAccessToken } from '../auth/microsoft-auth.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

function graphToken() {
  const token = getGraphAccessToken();
  if (!token) throw new Error('Microsoft Graphトークンがありません。Microsoftへ再ログインしてください。');
  return token;
}

async function graphRequest(path, { method = 'GET', body = null, headers = {}, expectJson = true } = {}) {
  const requestHeaders = { Authorization: `Bearer ${graphToken()}`, ...headers };
  const options = { method, headers: requestHeaders };
  if (body !== null && body !== undefined) options.body = body;

  const response = await fetch(`${GRAPH_BASE}${path}`, options);
  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json();
      detail = payload?.error?.message || '';
    } catch {
      detail = await response.text().catch(() => '');
    }
    const error = new Error(detail || `OneDrive通信に失敗しました (${response.status})`);
    error.status = response.status;
    throw error;
  }
  if (!expectJson || response.status === 204) return null;
  return response.json();
}

function childrenPath(parentId) {
  return parentId === 'root'
    ? '/me/drive/root/children'
    : `/me/drive/items/${encodeURIComponent(parentId)}/children`;
}

export async function listDriveChildren(parentId = 'root') {
  const items = [];
  let path = `${childrenPath(parentId)}?$select=id,name,folder,file,parentReference,webUrl&$top=200`;
  while (path) {
    const payload = await graphRequest(path);
    items.push(...(payload?.value || []));
    const nextLink = payload?.['@odata.nextLink'] || '';
    path = nextLink.startsWith(GRAPH_BASE) ? nextLink.slice(GRAPH_BASE.length) : '';
  }
  return items;
}

export async function getDriveItem(itemId) {
  if (!itemId) return null;
  return graphRequest(`/me/drive/items/${encodeURIComponent(itemId)}?$select=id,name,folder,file,parentReference,webUrl`);
}

export async function findChildFolder(parentId, name) {
  const target = String(name || '');
  if (!target) return null;
  const children = await listDriveChildren(parentId);
  return children.find((item) => item.folder && item.name === target) || null;
}

export async function createDriveFolder(parentId, name) {
  const folderName = String(name || '').trim();
  if (!folderName) throw new Error('作成するOneDriveフォルダ名が空です。');
  return graphRequest(childrenPath(parentId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' })
  });
}

export async function ensureDriveFolder(parentId, name) {
  return (await findChildFolder(parentId, name)) || createDriveFolder(parentId, name);
}

export async function moveDriveItem(itemId, targetParentId) {
  return graphRequest(`/me/drive/items/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentReference: { id: targetParentId } })
  });
}

export async function deleteDriveItem(itemId) {
  await graphRequest(`/me/drive/items/${encodeURIComponent(itemId)}`, { method: 'DELETE', expectJson: false });
}

export async function uploadDriveFile(parentId, fileName, content, contentType = 'application/octet-stream') {
  const encodedName = encodeURIComponent(String(fileName || ''));
  if (!encodedName) throw new Error('保存するファイル名が空です。');
  return graphRequest(`/me/drive/items/${encodeURIComponent(parentId)}:/${encodedName}:/content`, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: content
  });
}
