/**
 * Firestore上の現地作成案件メタデータを一覧取得する。
 * 案件レコード本体の読込・購読は既存のproject-controller経路へ任せる。
 */
import {
  collection,
  getDocs,
  getFirestore
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { firebaseApp } from '../../config/firebase-config.js';
import { canUseFirestore } from '../sync/sync-status.js';

const db = getFirestore(firebaseApp);

function normalizeProject(item) {
  const data = item.data() || {};
  const projectId = String(data.projectId || item.id || '');
  if (!projectId) return null;
  return {
    projectId,
    projectNo: String(data.projectNo || projectId),
    projectName: String(data.projectName || ''),
    address: String(data.address || ''),
    projectType: String(data.projectType || 'temporary'),
    isTemporary: data.isTemporary !== false,
    isSample: false,
    environment: 'production',
    createdAt: String(data.createdAt || '')
  };
}

export async function readFirestoreProjectList() {
  if (!canUseFirestore()) {
    throw new Error('Firestoreへ接続できません。通信状態またはオフラインモードを確認してください。');
  }

  const snapshot = await getDocs(collection(db, 'projects'));
  return snapshot.docs
    .map(normalizeProject)
    .filter(Boolean)
    .sort((a, b) => String(a.projectNo).localeCompare(String(b.projectNo), 'ja', { numeric: true }));
}
