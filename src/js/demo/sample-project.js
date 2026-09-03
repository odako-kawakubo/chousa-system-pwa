/**
 * 公式サンプル案件の固定データと表示名ルール。
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

export function formatSampleProjectName(project) {
  return `${samplePrefix()}${project?.projectName || ''}`;
}

export function formatProjectDisplayName(project) {
  if (!project) return '';
  return project.isSample ? formatSampleProjectName(project) : project.projectName;
}
