/**
 * src/js/projects/project-factory.js
 *
 * 案件情報の生成だけを担当する。
 * - 現場新規: yymmdd-連番の仮案件
 * - OneDrive既存案件: 既存の正式案件番号をそのまま正本キーにする
 */

function two(value) {
  return String(value).padStart(2, '0');
}

export function temporaryDateCode(date = new Date()) {
  return `${two(date.getFullYear() % 100)}${two(date.getMonth() + 1)}${two(date.getDate())}`;
}

function nextSequence(dateCode, existingProjects = [], existingProjectNos = []) {
  const prefix = `${dateCode}-`;
  let max = 0;
  const projectNos = [
    ...existingProjects.map((project) => project?.projectNo || project?.projectId || ''),
    ...existingProjectNos
  ];
  projectNos.forEach((value) => {
    const projectNo = String(value || '');
    if (!projectNo.startsWith(prefix)) return;
    const suffix = projectNo.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) return;
    max = Math.max(max, Number(suffix));
  });
  return max + 1;
}

export function createTemporaryProject({ projectName, address, existingProjects = [], existingProjectNos = [] }) {
  const name = String(projectName || '').trim();
  const normalizedAddress = String(address || '').trim();
  if (!name) throw new Error('案件名を入力してください。');
  if (!normalizedAddress) throw new Error('住所を入力してください。');

  const dateCode = temporaryDateCode();
  const sequence = nextSequence(dateCode, existingProjects, existingProjectNos);
  const projectNo = `${dateCode}-${two(sequence)}`;

  return {
    projectId: projectNo,
    projectNo,
    projectName: name,
    address: normalizedAddress,
    surveyDate: '',
    projectType: 'temporary',
    isTemporary: true,
    isSample: false,
    environment: 'production',
    createdAt: new Date().toISOString()
  };
}

export function createFormalProjectFromOneDrive({ projectNo, projectName, address = '' }) {
  const no = String(projectNo || '').trim();
  const name = String(projectName || '').trim();
  if (!no) throw new Error('OneDrive案件番号を取得できません。');
  if (!name) throw new Error('OneDrive案件名を取得できません。');

  return {
    projectId: no,
    projectNo: no,
    projectName: name,
    address: String(address || '').trim(),
    surveyDate: '',
    projectType: 'formal',
    isTemporary: false,
    isSample: false,
    environment: 'production',
    createdAt: new Date().toISOString()
  };
}
