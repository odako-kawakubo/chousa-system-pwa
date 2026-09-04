/**
 * .xlsx / .xlsm のOpen XMLパッケージから固定セルを読む最小リーダー。
 * Excelを実行・編集せず、ZIP内XMLを読み取り専用で解析する。
 * 外部ライブラリを持ち込まず、ブラウザ標準のDecompressionStreamを使用する。
 */

const decoder = new TextDecoder('utf-8');

function findEndOfCentralDirectory(view) {
  const signature = 0x06054b50;
  const min = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let offset = view.byteLength - 22; offset >= min; offset -= 1) {
    if (view.getUint32(offset, true) === signature) return offset;
  }
  throw new Error('ExcelファイルのZIP構造を確認できません。');
}

function readZipDirectory(buffer) {
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map();

  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('ExcelファイルのZIP一覧を確認できません。');
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nameBytes = new Uint8Array(buffer, offset + 46, fileNameLength);
    const name = decoder.decode(nameBytes);

    entries.set(name, { name, method, compressedSize, localOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    const error = new Error('この端末ではExcelファイルを展開できません。OS / Safariを更新してください。');
    error.code = 'OPENXML_DECOMPRESSION_UNSUPPORTED';
    throw error;
  }
  let stream;
  try {
    stream = new DecompressionStream('deflate-raw');
  } catch (cause) {
    const error = new Error('この端末ではExcelファイルを展開できません。OS / Safariを更新してください。');
    error.code = 'OPENXML_DECOMPRESSION_UNSUPPORTED';
    error.cause = cause;
    throw error;
  }
  const response = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await response.arrayBuffer());
}

async function readZipEntry(buffer, entry) {
  if (!entry) return null;
  const view = new DataView(buffer);
  const offset = entry.localOffset;
  if (view.getUint32(offset, true) !== 0x04034b50) {
    throw new Error(`Excel内部ファイルを取得できません: ${entry.name}`);
  }
  const fileNameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataOffset = offset + 30 + fileNameLength + extraLength;
  const compressed = new Uint8Array(buffer, dataOffset, entry.compressedSize);

  if (entry.method === 0) return compressed.slice();
  if (entry.method === 8) return inflateRaw(compressed);
  throw new Error(`未対応のExcel圧縮形式です: ${entry.method}`);
}

async function readZipText(buffer, entries, name, required = true) {
  const entry = entries.get(name);
  if (!entry) {
    if (!required) return '';
    throw new Error(`Excel内部ファイルが見つかりません: ${name}`);
  }
  return decoder.decode(await readZipEntry(buffer, entry));
}

function parseXml(text, label) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error(`${label}を解析できません。`);
  return doc;
}

function normalizePackagePath(base, target) {
  const parts = `${base}/${target}`.replace(/\\/g, '/').split('/');
  const stack = [];
  parts.forEach((part) => {
    if (!part || part === '.') return;
    if (part === '..') stack.pop();
    else stack.push(part);
  });
  return stack.join('/');
}

function findWorksheetPath(workbookDoc, relsDoc, worksheetName) {
  const sheet = Array.from(workbookDoc.getElementsByTagNameNS('*', 'sheet'))
    .find((node) => node.getAttribute('name') === worksheetName);
  if (!sheet) throw new Error(`Excelに「${worksheetName}」シートがありません。`);

  const relationId = sheet.getAttribute('r:id')
    || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  if (!relationId) throw new Error(`「${worksheetName}」シートの参照先を確認できません。`);

  const relation = Array.from(relsDoc.getElementsByTagNameNS('*', 'Relationship'))
    .find((node) => node.getAttribute('Id') === relationId);
  const target = relation?.getAttribute('Target') || '';
  if (!target) throw new Error(`「${worksheetName}」シートの内部ファイルを確認できません。`);
  return normalizePackagePath('xl', target);
}

function readSharedStrings(doc) {
  if (!doc) return [];
  return Array.from(doc.getElementsByTagNameNS('*', 'si')).map((si) => (
    Array.from(si.getElementsByTagNameNS('*', 't')).map((node) => node.textContent || '').join('')
  ));
}

function worksheetCellValue(sheetDoc, address, sharedStrings) {
  const cell = Array.from(sheetDoc.getElementsByTagNameNS('*', 'c'))
    .find((node) => String(node.getAttribute('r') || '').toUpperCase() === address.toUpperCase());
  if (!cell) return '';

  const type = cell.getAttribute('t') || '';
  if (type === 'inlineStr') {
    return Array.from(cell.getElementsByTagNameNS('*', 't')).map((node) => node.textContent || '').join('').trim();
  }

  const raw = cell.getElementsByTagNameNS('*', 'v')[0]?.textContent ?? '';
  if (type === 's') {
    const index = Number.parseInt(raw, 10);
    return Number.isInteger(index) ? String(sharedStrings[index] ?? '').trim() : '';
  }
  return String(raw).trim();
}

/**
 * Open XMLブックから指定シート・指定セルだけを読む。
 * 戻り値: { F2: '...', K2: '...', L2: '...' }
 */
export async function readOpenXmlCells(arrayBuffer, worksheetName, addresses) {
  if (!(arrayBuffer instanceof ArrayBuffer)) throw new Error('Excelファイル本体を取得できませんでした。');
  const entries = readZipDirectory(arrayBuffer);
  const workbookDoc = parseXml(await readZipText(arrayBuffer, entries, 'xl/workbook.xml'), 'Excelブック情報');
  const relsDoc = parseXml(await readZipText(arrayBuffer, entries, 'xl/_rels/workbook.xml.rels'), 'Excelシート参照情報');
  const worksheetPath = findWorksheetPath(workbookDoc, relsDoc, worksheetName);
  const sheetDoc = parseXml(await readZipText(arrayBuffer, entries, worksheetPath), `Excel「${worksheetName}」シート`);

  const sharedText = await readZipText(arrayBuffer, entries, 'xl/sharedStrings.xml', false);
  const sharedStrings = sharedText ? readSharedStrings(parseXml(sharedText, 'Excel共有文字列')) : [];

  return Object.fromEntries((addresses || []).map((address) => [
    address,
    worksheetCellValue(sheetDoc, address, sharedStrings)
  ]));
}
