/**
 * src/js/demo/sample-project.js
 *
 * 公式サンプル案件の固定データ。
 */

import { appConfig } from '../../config/app-config.js';

export const sampleProject = {
  projectId: 'SAMPLE-001',
  projectNo: 'SAMPLE-001',
  projectName: 'サンプル案件',
  projectType: 'sample',
  isSample: true
};

function samplePrefix() {
  return /[A-Z]$/.test(String(appConfig.version || '')) ? '［レビュー］' : '［サンプル］';
}

export function formatProjectDisplayName(project) {
  if (!project) return '';
  return project.isSample ? `${samplePrefix()}${project.projectName}` : project.projectName;
}
