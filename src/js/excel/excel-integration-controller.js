/**
 * 操作パネルの「Excel連携」共通表示。
 * 個別の業務処理は各Controllerへ委譲し、旧「分析」セクションは残さない。
 */
import { openAnalysisImportPicker } from '../analysis/analysis-import-controller.js';
import { openExcelTransfer } from './excel-transfer-controller.js';
import { openMaterialExcelTransfer } from './material-excel-transfer-controller.js';

let mounted = false;

export function initializeExcelIntegration() {
  if (mounted) return;
  const mount = document.getElementById('excelIntegrationMount');
  if (!mount) return;
  mounted = true;
  mount.innerHTML = `
    <div class="drawer-box" id="excelIntegrationTools">
      <h4>Excel連携</h4>
      <div class="hint">分析依頼・建材リストのExcel転記と、定性速報PDFからの分析結果取込を行います。</div>
      <div class="excel-integration-actions">
        <button type="button" class="btn" data-excel-transfer-open>分析依頼転記</button>
        <button type="button" class="btn" data-material-excel-transfer-open>建材リスト転記</button>
        <button type="button" class="btn" data-analysis-import-open>分析結果取込</button>
      </div>
    </div>`;
  mount.querySelector('[data-excel-transfer-open]').addEventListener('click', openExcelTransfer);
  mount.querySelector('[data-material-excel-transfer-open]').addEventListener('click', openMaterialExcelTransfer);
  mount.querySelector('[data-analysis-import-open]').addEventListener('click', openAnalysisImportPicker);
}
