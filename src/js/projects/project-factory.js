/**
 * src/js/projects/project-factory.js
 *
 * 現場で新規作成する仮案件の案件情報を生成する。
 * 仮番号は yymmdd-連番。端末間の同時発番ロックは行わず、重複は運用で回避する。
 * 枝番は端末内の案件一覧に存在する当日仮案件の最大値+1から決める。
 */

function two(value) {
  return String(value).padStart(2, '0');
}

function localDateCode(date = new Date()) {
  return `${two(date.getFullYear() % 100)}${two(date.getMonth() + 1)}${two(date.getDate())}`;
}

function nextSequence(dateCode, existingProjects = []) {
  const prefix = `${dateCode}-`;
  let max = 0;
  existingProjects.forEach((project) => {
    const projectNo = String(project?.projectNo || '');
    if (!projectNo.startsWith(prefix)) return;
    const suffix = projectNo.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) return;
    max = Math.max(max, Number(suffix));
  });
  return max + 1;
}

export function createTemporaryProject({ projectName, address, existingProjects = [] }) {
  const name = String(projectName || '').trim();
  const normalizedAddress = String(address || '').trim();
  if (!name) throw new Error('案件名を入力してください。');
  if (!normalizedAddress) throw new Error('住所を入力してください。');

  const dateCode = localDateCode();
  const sequence = nextSequence(dateCode, existingProjects);
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
