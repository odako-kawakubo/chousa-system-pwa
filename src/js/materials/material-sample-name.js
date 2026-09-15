/**
 * 分析依頼・写真タブ・分析結果取込で共用する試料名称。
 * 例: 建材No.3　壁、天井　吹付材A
 */
import { samplePartsToText } from '../records/material-record.js';

export function buildMaterialSampleName(material = {}) {
  const materialNo = String(material.materialNo || material.inputId || '').trim();
  const part = samplePartsToText(material.samplePart) || String(material.part || '').trim();
  const name = String(material.name || '').trim();
  const pieces = [];
  if (materialNo) pieces.push(`建材No.${materialNo}`);
  if (part) pieces.push(part);
  if (name) pieces.push(name);
  return pieces.join('　');
}

/** 照合用。意味は変えず空白表記だけ吸収する。 */
export function normalizeMaterialSampleName(value) {
  return String(value ?? '')
    .replace(/\u3000/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}
