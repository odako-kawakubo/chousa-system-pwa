import { objectPercentStyle } from './survey-map-geometry.js';

function escapeHtml(value){
  return String(value??'').replace(/[&<>"']/g,(m)=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));
}

export function drawingObjectsHtml(records = [], drawing, selectedObjectId = '') {
  return records
    .filter((record)=>record && record.visible !== false && !record.deleted)
    .map((record)=>{
      const selected = String(record.objectId) === String(selectedObjectId);
      const style = objectPercentStyle(record, drawing);
      const label = record.type === 'shape' ? '図形' : String(record.type || 'オブジェクト');
      return `
        <div
          class="survey-map-object survey-map-object-${escapeHtml(record.type)} ${selected?'selected':''}"
          data-survey-object-id="${escapeHtml(record.objectId)}"
          style="${style}"
          role="button"
          aria-label="${escapeHtml(label)}"
        >
          <div class="survey-map-object-visual"></div>
          ${selected ? `
            <button type="button" class="survey-map-object-handle survey-map-object-resize-handle" data-survey-handle="resize" aria-label="サイズ変更"></button>
            <button type="button" class="survey-map-object-handle survey-map-object-rotate-handle" data-survey-handle="rotate" aria-label="回転"></button>
          ` : ''}
        </div>
      `;
    }).join('');
}
