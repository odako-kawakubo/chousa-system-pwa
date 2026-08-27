/**
 * src/js/projects/project-factory.js
 *
 * 現場で新規作成する仮案件の案件情報を生成する。
 * 仮番号は yymmdd-連番。Cでは端末内案件一覧＋Firestore既存番号を見て最大+1を採番する。
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
    createdAt: new Date().toISOString()
  };
}
