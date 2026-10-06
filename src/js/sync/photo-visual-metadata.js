/**
 * 旧目視photoRecordのroomNo / partをfinishRecordから補完する純粋helper。
 * areaCode + roomPosition + partSlotは写真所属キーとして維持し、既存値は上書きしない。
 */
import { PHOTO_TYPES, createPhotoRecord } from '../records/photo-record.js';
import { touchFieldEditedAt } from './field-edit-meta.js';

function partSlotFromFinish(record) {
  return Math.floor(Number(record?.position || 0) / 100);
}

export function resolveVisualPhotoMetadata(photo, finishRecords = []) {
  if (!photo || photo.photoType !== PHOTO_TYPES.VISUAL) {
    return { record: photo, changedFields: [] };
  }

  const areaCode = String(photo.areaCode || '');
  const roomPosition = String(photo.roomPosition || '');
  const partSlot = Number(photo.partSlot || 0);
  if (!areaCode || !roomPosition || !partSlot) {
    return { record: photo, changedFields: [] };
  }

  const roomRecords = (finishRecords || []).filter((record) =>
    record?.status === 'active'
    && String(record.areaCode || '') === areaCode
    && String(record.roomPosition || '') === roomPosition
  );
  if (!roomRecords.length) return { record: photo, changedFields: [] };

  const slotRecords = roomRecords.filter((record) => partSlotFromFinish(record) === partSlot);
  const resolvedRoomNo = String(roomRecords.find((record) => String(record.roomNo || '').trim())?.roomNo || '').trim();
  const resolvedPart = String(slotRecords.find((record) => String(record.part || '').trim())?.part || '').trim();

  const patch = {};
  const changedFields = [];
  if (!String(photo.roomNo || '').trim() && resolvedRoomNo) {
    patch.roomNo = resolvedRoomNo;
    changedFields.push('roomNo');
  }
  if (!String(photo.part || '').trim() && resolvedPart) {
    patch.part = resolvedPart;
    changedFields.push('part');
  }
  if (!changedFields.length) return { record: photo, changedFields };

  const confirmedAt = Date.now();
  return {
    record: createPhotoRecord({
      ...photo,
      ...patch,
      fieldEditedAt: touchFieldEditedAt(photo.fieldEditedAt, changedFields, confirmedAt)
    }),
    changedFields
  };
}
