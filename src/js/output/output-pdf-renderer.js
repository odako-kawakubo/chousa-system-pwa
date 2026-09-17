/**
 * src/js/output/output-pdf-renderer.js
 * PDF専用ベクターレンダラー。
 * 文字・罫線はベクター、写真だけ画像として配置する。
 */
import { getOutputSettings, normalizeOutputSettings } from './output-settings-store.js';
import { formatSamplingCode, formatPartDisplay } from './output-format.js';

const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
const FONT_CACHE = 'chousa-pdf-fonts-bizudp-v1';
const FONT_FAMILY = 'BIZUDPGothic';
const FONT_FILES = Object.freeze({
  normal:{ name:'BIZUDPGothic-Regular.ttf', url:'https://raw.githubusercontent.com/googlefonts/morisawa-biz-ud-gothic/main/fonts/ttf/BIZUDPGothic-Regular.ttf' },
  bold:{ name:'BIZUDPGothic-Bold.ttf', url:'https://raw.githubusercontent.com/googlefonts/morisawa-biz-ud-gothic/main/fonts/ttf/BIZUDPGothic-Bold.ttf' }
});

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 10;
const RED = [192,0,0];
const BLACK = [17,17,17];
const HEADER_FILL = [230,230,230];
const VISUAL_ITEMS_PER_PAGE = 8;
const LIST_START_Y = 27;
const MATERIAL_BASE_ROW_H = 6.8;
const ROOM_BASE_ROW_H = 8;
const FOOTNOTE_GAP = 3;
const FOOTNOTE_BOTTOM = 8;
const MATERIAL_WIDTHS = Object.freeze([6,33,12,42,6,19,19,53]);
const ROOM_WIDTHS = Object.freeze([10,12,22,12,6,38,35,6,19,30]);

let fontBase64Promise = null;

function loadScript(src, globalName) {
  if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
  const existing = document.querySelector(`script[data-output-pdf-lib="${src}"]`);
  if (existing) return new Promise((resolve, reject) => {
    existing.addEventListener('load', () => resolve(globalName ? window[globalName] : true), { once:true });
    existing.addEventListener('error', reject, { once:true });
  });
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.outputPdfLib = src;
    script.onload = () => resolve(globalName ? window[globalName] : true);
    script.onerror = () => reject(new Error(`PDFライブラリを読み込めませんでした: ${src}`));
    document.head.appendChild(script);
  });
}

async function fetchFontResponse(url) {
  if ('caches' in window) {
    const cache = await caches.open(FONT_CACHE);
    const cached = await cache.match(url);
    if (cached) return cached;
    const response = await fetch(url, { mode:'cors' });
    if (!response.ok) throw new Error(`PDFフォントを取得できませんでした (${response.status})`);
    await cache.put(url, response.clone());
    return response;
  }
  const response = await fetch(url, { mode:'cors' });
  if (!response.ok) throw new Error(`PDFフォントを取得できませんでした (${response.status})`);
  return response;
}
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunk, bytes.length)));
  return btoa(binary);
}
async function fontBase64Files() {
  if (!fontBase64Promise) {
    fontBase64Promise = Promise.all(Object.entries(FONT_FILES).map(async ([style,file]) => {
      const response = await fetchFontResponse(file.url);
      return [style,file,arrayBufferToBase64(await response.arrayBuffer())];
    }));
  }
  return fontBase64Promise;
}
async function registerFonts(pdf) {
  const files = await fontBase64Files();
  files.forEach(([style,file,base64]) => {
    pdf.addFileToVFS(file.name,base64);
    pdf.addFont(file.name,FONT_FAMILY,style);
  });
}

function chunkRows(rows,size) {
  if (!rows.length) return [[]];
  const result=[];
  for(let index=0;index<rows.length;index+=size) result.push(rows.slice(index,index+size));
  return result;
}
function isPositive(value) {
  const text=String(value??'').trim();
  if(!text)return false;
  if(text==='有')return true;
  if(text.includes('無')||text.includes('なし')||text==='-')return false;
  return text.includes('含有');
}
function setFont(pdf,size,style='normal',color=BLACK) {
  pdf.setFont(FONT_FAMILY,style);
  pdf.setFontSize(size);
  pdf.setTextColor(...color);
}
function textLines(pdf,value,width) {
  const text=String(value??'');
  return text?pdf.splitTextToSize(text,Math.max(1,width)):[];
}
function roomNoTokens(value) {
  return String(value??'').split(/[、，,]+/).map((token)=>token.trim()).filter(Boolean);
}
function wrapRoomNoLines(pdf,value,width,size) {
  const tokens=roomNoTokens(value);
  if(!tokens.length)return [];
  setFont(pdf,size,'normal');
  const lines=[];
  let current='';
  tokens.forEach((token)=>{
    const next=current?`${current}、${token}`:token;
    if(!current||pdf.getTextWidth(next)<=width)current=next;
    else{lines.push(current);current=token;}
  });
  if(current)lines.push(current);
  return lines;
}
function lineBlockHeight(size,count,lineHeight=1.12,paddingY=1.2) {
  return count?count*size*.352778*lineHeight+paddingY*2:0;
}
function requiredTextHeight(pdf,value,width,options={}) {
  const {size=7.5,lineHeight=1.12,paddingX=.8,paddingY=1.2,roomTokens=false,lines=null}=options;
  setFont(pdf,size,'normal');
  const usable=Math.max(1,width-paddingX*2);
  const actualLines=Array.isArray(lines)?lines:(roomTokens?wrapRoomNoLines(pdf,value,usable,size):textLines(pdf,value,usable));
  return lineBlockHeight(size,actualLines.length,lineHeight,paddingY);
}
function drawCellText(pdf,value,x,y,width,height,options={}) {
  const {align='left',size=8,style='normal',color=BLACK,paddingX=1.1,maxLines=Infinity,lineHeight=1.12,roomTokens=false}=options;
  setFont(pdf,size,style,color);
  const usable=Math.max(1,width-paddingX*2);
  let lines=Array.isArray(value)?value.map(String):(roomTokens?wrapRoomNoLines(pdf,value,usable,size):textLines(pdf,value,usable));
  if(Number.isFinite(maxLines))lines=lines.slice(0,Math.max(0,maxLines));
  if(!lines.length)return;
  const mmPerPt=.352778;
  const step=size*mmPerPt*lineHeight;
  const total=step*lines.length;
  let baseline=y+(height-total)/2+size*mmPerPt*.82;
  lines.forEach((line)=>{
    let tx=x+paddingX;
    if(align==='center')tx=x+width/2;
    else if(align==='right')tx=x+width-paddingX;
    pdf.text(String(line),tx,baseline,{align});
    baseline+=step;
  });
}
function drawSingleLineFit(pdf,value,x,y,width,height,options={}) {
  const {size=9,minSize=6.5,style='bold',color=BLACK,align='left',paddingX=0}=options;
  const text=String(value??'');
  if(!text)return;
  let fontSize=size;
  setFont(pdf,fontSize,style,color);
  const usable=Math.max(1,width-paddingX*2);
  while(fontSize>minSize&&pdf.getTextWidth(text)>usable){fontSize=Math.max(minSize,fontSize-.25);setFont(pdf,fontSize,style,color);}
  const baseline=y+height/2+fontSize*.352778*.33;
  const tx=align==='right'?x+width-paddingX:align==='center'?x+width/2:x+paddingX;
  pdf.text(text,tx,baseline,{align});
}
function drawPartCell(pdf,value,x,y,width,height,{size,color=BLACK}={}) {
  const display=formatPartDisplay(value);
  if(!display.text)return;
  if(display.split){
    drawCellText(pdf,display.lines,x,y,width,height,{align:'center',size,color,paddingX:.35,lineHeight:1.02});
    return;
  }
  const minSize=display.text.length>=4?Math.max(5.8,size-1.5):size;
  drawSingleLineFit(pdf,display.text,x,y,width,height,{align:'center',size,minSize,style:'normal',color,paddingX:.3});
}
function partRequiredHeight(pdf,value,width,size) {
  const display=formatPartDisplay(value);
  if(!display.split)return 0;
  return requiredTextHeight(pdf,'',width,{size,paddingX:.35,paddingY:.9,lines:display.lines,lineHeight:1.02});
}
function drawRect(pdf,x,y,width,height,{fill=null,line=BLACK,lineWidth=.2}={}) {
  pdf.setLineWidth(lineWidth);
  pdf.setDrawColor(...line);
  if(fill){pdf.setFillColor(...fill);pdf.rect(x,y,width,height,'FD');}
  else pdf.rect(x,y,width,height,'S');
}
function titleText(base,suffix) {
  const extra=String(suffix??'').trim();
  return extra?`${base}　${extra}`:base;
}
function drawTitle(pdf,title,settings,centered=false) {
  setFont(pdf,settings.titleSize,'bold');
  pdf.text(title,centered?PAGE_W/2:MARGIN_X,19,{align:centered?'center':'left'});
}
function addPage(pdf,state) {
  if(state.pageCount>0)pdf.addPage('a4','portrait');
  state.pageCount+=1;
}
function footnoteLines(pdf,settings) {
  setFont(pdf,settings.noteSize,'normal');
  const lines=[];
  String(settings.noteText||'').split('\n').forEach((paragraph)=>lines.push(...pdf.splitTextToSize(paragraph,190)));
  return lines;
}
function footnoteHeight(pdf,settings) {
  return footnoteLines(pdf,settings).length*settings.noteSize*.352778*1.25;
}
function listTableBottom(pdf,settings) {
  return PAGE_H-FOOTNOTE_BOTTOM-footnoteHeight(pdf,settings)-FOOTNOTE_GAP;
}
function drawListFootnote(pdf,settings,tableEndY) {
  const lines=footnoteLines(pdf,settings);
  if(!lines.length)return;
  setFont(pdf,settings.noteSize,'normal');
  pdf.text(lines,MARGIN_X,tableEndY+FOOTNOTE_GAP+settings.noteSize*.352778,{lineHeightFactor:1.25});
}

function drawMaterialHeader(pdf,x,y,widths,height,settings) {
  const labels=[['建材','No.'],['建材名'],['部位'],null,['建材','Lv.'],['分析の要否'],['石綿含有','の有無'],['調査備考']];
  let cx=x;
  widths.forEach((width,index)=>{
    drawRect(pdf,cx,y,width,height,{fill:HEADER_FILL});
    if(index===3){
      const topH=height*.38;
      pdf.setDrawColor(...BLACK);pdf.setLineWidth(.2);pdf.line(cx,y+topH,cx+width,y+topH);
      drawCellText(pdf,'施工範囲',cx,y,width,topH,{align:'center',size:Math.max(6.5,settings.materialHeaderSize-.5),style:'bold',paddingX:.3,lineHeight:1});
      drawCellText(pdf,'部屋No.',cx,y+topH,width,height-topH,{align:'center',size:settings.materialHeaderSize,style:'bold',paddingX:.3,lineHeight:1});
    }else drawCellText(pdf,labels[index],cx,y,width,height,{align:'center',size:settings.materialHeaderSize,style:'bold',paddingX:.25,lineHeight:1});
    cx+=width;
  });
}
function materialRowHeight(pdf,row,widths,settings) {
  const values=[row.materialNo,row.name,row.part,row.usageLocation,row.level,row.analysisRequired,row.analysisResult,row.note];
  let height=MATERIAL_BASE_ROW_H;
  values.forEach((value,index)=>{
    if(index===2){height=Math.max(height,partRequiredHeight(pdf,value,widths[index],settings.materialBodySize));return;}
    height=Math.max(height,requiredTextHeight(pdf,value,widths[index],{size:settings.materialBodySize,roomTokens:index===3,paddingX:.8,paddingY:.9}));
  });
  return Math.min(30,height);
}
function paginateRows(rows,heights,availableHeight) {
  const pages=[];let currentRows=[];let currentHeights=[];let used=0;
  rows.forEach((row,index)=>{
    const h=heights[index];
    if(currentRows.length&&used+h>availableHeight){pages.push({rows:currentRows,heights:currentHeights});currentRows=[];currentHeights=[];used=0;}
    currentRows.push(row);currentHeights.push(h);used+=h;
  });
  if(currentRows.length||!pages.length)pages.push({rows:currentRows,heights:currentHeights});
  return pages;
}
function drawMaterialBodyRow(pdf,row,y,rowH,widths,settings) {
  const color=isPositive(row.analysisResult)?RED:BLACK;
  const values=[row.materialNo,row.name,row.part,row.usageLocation,row.level,row.analysisRequired,row.analysisResult,row.note];
  let cx=MARGIN_X;
  widths.forEach((width,colIndex)=>{
    drawRect(pdf,cx,y,width,rowH);
    if(colIndex===2)drawPartCell(pdf,values[colIndex],cx,y,width,rowH,{size:settings.materialBodySize,color});
    else drawCellText(pdf,values[colIndex],cx,y,width,rowH,{align:[0,4,5,6].includes(colIndex)?'center':'left',size:settings.materialBodySize,color,paddingX:.8,roomTokens:colIndex===3});
    cx+=width;
  });
}
function renderMaterialPages(pdf,vm,state,settings) {
  const widths=[...MATERIAL_WIDTHS];
  const rows=vm.materialRows||[];
  const heights=rows.map((row)=>materialRowHeight(pdf,row,widths,settings));
  const headerH=settings.materialHeaderHeight;
  const pages=paginateRows(rows,heights,listTableBottom(pdf,settings)-(LIST_START_Y+headerH));
  pages.forEach((page)=>{
    addPage(pdf,state);
    drawTitle(pdf,titleText('調査対象建材リスト',settings.materialTitleSuffix),settings);
    drawMaterialHeader(pdf,MARGIN_X,LIST_START_Y,widths,headerH,settings);
    let y=LIST_START_Y+headerH;
    page.rows.forEach((row,index)=>{const h=page.heights[index];drawMaterialBodyRow(pdf,row,y,h,widths,settings);y+=h;});
    drawListFootnote(pdf,settings,y);
  });
}

function drawRoomHeader(pdf,x,y,widths,height,settings) {
  const labels=[['階'],['部屋No.'],['部屋名'],['部位'],['建材','No.'],['建材名称'],['調査備考'],['建材','Lv.'],['分析結果'],['部屋備考']];
  let cx=x;
  widths.forEach((width,index)=>{drawRect(pdf,cx,y,width,height,{fill:HEADER_FILL});drawCellText(pdf,labels[index],cx,y,width,height,{align:'center',size:settings.roomHeaderSize,style:'bold',paddingX:.25,lineHeight:1});cx+=width;});
}
function roomRowBaseHeight(pdf,row,widths,settings) {
  const values=[{col:3,value:row.part},{col:4,value:row.materialNo},{col:5,value:row.materialName},{col:6,value:row.note},{col:7,value:row.level},{col:8,value:row.analysisResult}];
  let height=ROOM_BASE_ROW_H;
  values.forEach(({col,value})=>{
    if(col===3){height=Math.max(height,partRequiredHeight(pdf,value,widths[col],settings.roomBodySize));return;}
    height=Math.max(height,requiredTextHeight(pdf,value,widths[col],{size:settings.roomBodySize,paddingX:.8,paddingY:.9}));
  });
  return Math.min(30,height);
}
function groupRanges(rows,keyFn) {
  const ranges=[];let start=0;
  while(start<rows.length){const key=keyFn(rows[start]);let end=start+1;while(end<rows.length&&keyFn(rows[end])===key)end+=1;ranges.push({start,end,key});start=end;}
  return ranges;
}
function ensureGroupedCellHeight(pdf,heights,range,value,width,options={}) {
  const needed=requiredTextHeight(pdf,value,width,options);
  const current=heights.slice(range.start,range.end).reduce((sum,h)=>sum+h,0);
  if(needed>current)heights[range.end-1]+=needed-current;
}
function calculateRoomHeights(pdf,rows,widths,settings) {
  const heights=rows.map((row)=>roomRowBaseHeight(pdf,row,widths,settings));
  groupRanges(rows,(row)=>String(row.floor??'')).forEach((range)=>ensureGroupedCellHeight(pdf,heights,range,rows[range.start]?.floor,widths[0],{size:settings.roomBodySize,paddingX:.4,paddingY:.9}));
  groupRanges(rows,(row)=>`${row.floor}\u0000${row.roomNo}`).forEach((range)=>{
    const first=rows[range.start]||{};
    ensureGroupedCellHeight(pdf,heights,range,first.roomNo,widths[1],{size:settings.roomBodySize,paddingX:.6,paddingY:.9,roomTokens:true});
    ensureGroupedCellHeight(pdf,heights,range,first.roomName,widths[2],{size:settings.roomBodySize,paddingX:.8,paddingY:.9});
    ensureGroupedCellHeight(pdf,heights,range,first.roomNote,widths[9],{size:settings.roomBodySize,paddingX:.8,paddingY:.9});
  });
  return heights;
}
function paginateRoomGroups(rows,heights,availableHeight) {
  const groups=groupRanges(rows,(row)=>`${row.floor}\u0000${row.roomNo}`);
  const pages=[];let pageRows=[];let pageHeights=[];let used=0;
  groups.forEach((group)=>{
    const groupRows=rows.slice(group.start,group.end);
    const groupHeights=heights.slice(group.start,group.end);
    const groupHeight=groupHeights.reduce((sum,h)=>sum+h,0);
    if(groupHeight<=availableHeight){
      if(pageRows.length&&used+groupHeight>availableHeight){pages.push({rows:pageRows,heights:pageHeights});pageRows=[];pageHeights=[];used=0;}
      pageRows.push(...groupRows);pageHeights.push(...groupHeights);used+=groupHeight;return;
    }
    if(pageRows.length){pages.push({rows:pageRows,heights:pageHeights});pageRows=[];pageHeights=[];used=0;}
    const split=paginateRows(groupRows,groupHeights,availableHeight);
    split.forEach((part,index)=>{if(index<split.length-1)pages.push(part);else{pageRows=part.rows;pageHeights=part.heights;used=part.heights.reduce((sum,h)=>sum+h,0);}});
  });
  if(pageRows.length||!pages.length)pages.push({rows:pageRows,heights:pageHeights});
  return pages;
}
function pageSpan(rows,index,keyFn){const key=keyFn(rows[index]);let count=1;for(let i=index+1;i<rows.length;i+=1){if(keyFn(rows[i])!==key)break;count+=1;}return count;}
function precedingSame(rows,index,keyFn){return index>0&&keyFn(rows[index-1])===keyFn(rows[index]);}
function spanHeight(heights,index,span){return heights.slice(index,index+span).reduce((sum,value)=>sum+value,0);}
function renderRoomPageBody(pdf,rows,heights,widths,settings) {
  const xs=[MARGIN_X];widths.forEach((width)=>xs.push(xs[xs.length-1]+width));
  let y=LIST_START_Y+settings.roomHeaderHeight;
  rows.forEach((row,index)=>{
    const rowH=heights[index];const color=isPositive(row.analysisResult)?RED:BLACK;
    [{col:3,value:row.part,part:true},{col:4,value:row.materialNo,center:true},{col:5,value:row.materialName},{col:6,value:row.note},{col:7,value:row.level,center:true},{col:8,value:row.analysisResult,center:true}].forEach((cell)=>{
      drawRect(pdf,xs[cell.col],y,widths[cell.col],rowH);
      if(cell.part)drawPartCell(pdf,cell.value,xs[cell.col],y,widths[cell.col],rowH,{size:settings.roomBodySize,color});
      else drawCellText(pdf,cell.value,xs[cell.col],y,widths[cell.col],rowH,{align:cell.center?'center':'left',size:settings.roomBodySize,color,paddingX:.8});
    });
    const floorKey=(item)=>String(item.floor??'');
    if(!precedingSame(rows,index,floorKey)){const span=pageSpan(rows,index,floorKey);const h=spanHeight(heights,index,span);drawRect(pdf,xs[0],y,widths[0],h);drawCellText(pdf,row.floor,xs[0],y,widths[0],h,{align:'center',size:settings.roomBodySize,color,paddingX:.4});}
    const roomKey=(item)=>`${item.floor}\u0000${item.roomNo}`;
    if(!precedingSame(rows,index,roomKey)){
      const span=pageSpan(rows,index,roomKey);const h=spanHeight(heights,index,span);
      [{col:1,value:row.roomNo,center:true,roomTokens:true},{col:2,value:row.roomName,center:true},{col:9,value:row.roomNote,center:false}].forEach((cell)=>{drawRect(pdf,xs[cell.col],y,widths[cell.col],h);drawCellText(pdf,cell.value,xs[cell.col],y,widths[cell.col],h,{align:cell.center?'center':'left',size:settings.roomBodySize,color,paddingX:.8,roomTokens:cell.roomTokens});});
    }
    y+=rowH;
  });
  return y;
}
function renderRoomPages(pdf,vm,state,settings) {
  const widths=[...ROOM_WIDTHS];
  const rows=vm.roomRows||[];
  const heights=calculateRoomHeights(pdf,rows,widths,settings);
  const pages=paginateRoomGroups(rows,heights,listTableBottom(pdf,settings)-(LIST_START_Y+settings.roomHeaderHeight));
  pages.forEach((page)=>{
    addPage(pdf,state);
    drawTitle(pdf,titleText('部屋別調査対象建材リスト',settings.roomTitleSuffix),settings);
    drawRoomHeader(pdf,MARGIN_X,LIST_START_Y,widths,settings.roomHeaderHeight,settings);
    const endY=renderRoomPageBody(pdf,page.rows,page.heights,widths,settings);
    drawListFootnote(pdf,settings,endY);
  });
}

function imageFormat(dataUrl){return /^data:image\/png/i.test(String(dataUrl||''))?'PNG':'JPEG';}
function addContainedImage(pdf,dataUrl,x,y,width,height) {
  if(!dataUrl)return null;
  try{
    const props=pdf.getImageProperties(dataUrl);
    const iw=Number(props?.width||1);const ih=Number(props?.height||1);
    const scale=Math.min(width/iw,height/ih);
    const dw=iw*scale;const dh=ih*scale;
    const dx=x+(width-dw)/2;const dy=y+(height-dh)/2;
    pdf.addImage(dataUrl,imageFormat(dataUrl),dx,dy,dw,dh,undefined,'FAST');
    return {x:dx,y:dy,width:dw,height:dh};
  }catch(error){console.warn('PDF写真配置に失敗しました',error);return null;}
}
function renderVisualCaption(pdf,item,x,y,width,height,settings) {
  if(settings.visualCaptionLayout==='two-line'){
    const lineH=height/2;
    drawSingleLineFit(pdf,`建材No. ${item.materialNo}　部位 ${item.part||''}`,x,y,width,lineH,{size:settings.visualCaptionSize,minSize:6.5,style:'bold'});
    drawSingleLineFit(pdf,`建材名称　${item.name||''}`,x,y+lineH,width,lineH,{size:settings.visualCaptionSize,minSize:6.5,style:'bold'});
    return;
  }
  const caption=[`建材No.${item.materialNo}`,item.part,item.name].filter((value)=>String(value??'').trim()).join('　');
  drawSingleLineFit(pdf,caption,x,y,width,height,{size:settings.visualCaptionSize,minSize:6.5,style:'bold'});
}
function renderVisualPhotoPages(pdf,vm,photoSources,state,settings) {
  const pages=chunkRows(vm.visualPhotoItems||[],VISUAL_ITEMS_PER_PAGE);
  const left=10;const top=31;const gapX=5;const gapY=4;const slotW=(190-gapX)/2;const slotH=(252-gapY*3)/4;const captionH=settings.visualCaptionLayout==='two-line'?11:8;
  pages.forEach((items)=>{
    addPage(pdf,state);drawTitle(pdf,'調査対象建材写真帳',settings);
    for(let index=0;index<VISUAL_ITEMS_PER_PAGE;index+=1){
      const item=items[index];if(!item)continue;
      const col=index%2;const row=Math.floor(index/2);const slotX=left+col*(slotW+gapX);const slotY=top+row*(slotH+gapY);const photoH=slotH-captionH;
      const source=photoSources?.get?.(String(item.photoId||''))||'';
      const imageBox=addContainedImage(pdf,source,slotX,slotY,slotW,photoH);
      const captionX=imageBox?.x??slotX;
      const captionW=imageBox?.width??slotW;
      renderVisualCaption(pdf,item,captionX,slotY+photoH,captionW,captionH,settings);
    }
  });
}

function renderSamplingPages(pdf,vm,photoSources,state,settings) {
  const pages=vm.samplingPhotoPages?.length?vm.samplingPhotoPages:[{projectName:'',projectNo:'',sampleNo:'',branch:'',sampleName:'',samplingPlace:'',capturedDate:'',stages:[]}];
  pages.forEach((item)=>{
    addPage(pdf,state);drawTitle(pdf,'試料採取写真',settings,true);
    const leftX=10;const metaY=32;const lineH=8.5;const labelW=15;const rightEdge=190;
    [['件名：',item.projectName],['試料：',item.sampleName],['場所：',item.samplingPlace?`部屋No.${item.samplingPlace}`:'']].forEach(([label,value],index)=>{setFont(pdf,settings.samplingMetaSize,'bold');pdf.text(label,leftX,metaY+index*lineH);setFont(pdf,settings.samplingMetaSize,'normal');pdf.text(String(value||''),leftX+labelW,metaY+index*lineH);});
    setFont(pdf,settings.samplingMetaSize,'normal');pdf.text(formatSamplingCode(item),rightEdge,metaY,{align:'right'});
    setFont(pdf,settings.samplingMetaSize,'bold');pdf.text('採取日：',138,metaY+lineH);setFont(pdf,settings.samplingMetaSize,'normal');pdf.text(String(item.capturedDate||''),rightEdge,metaY+lineH,{align:'right'});
    const stageMap=new Map((item.stages||[]).map((stage)=>[stage.type,stage]));
    [['before','施工前'],['during','施工中'],['after','施工後']].forEach(([type,label],index)=>{
      const stage=stageMap.get(type)||{label,photoId:'',memo:''};const y=57+index*72;const photoX=38;const photoW=92;const photoH=69.5;const memoX=133;const memoW=53;const source=photoSources?.get?.(String(stage.photoId||''))||'';
      addContainedImage(pdf,source,photoX,y,photoW,photoH);
      drawCellText(pdf,`撮影状況：${stage.label||label}`,memoX,y,memoW,7,{size:settings.samplingStatusSize,style:'bold',maxLines:1,paddingX:0});
      const memoTop=y+7;const memoH=62;const lh=memoH/9;const memoLines=String(stage.memo||'').split('\n').slice(0,9);
      for(let line=0;line<9;line+=1){const ly=memoTop+line*lh;pdf.setDrawColor(70,70,70);pdf.setLineDashPattern([.6,.6],0);pdf.line(memoX,ly+lh,memoX+memoW,ly+lh);pdf.setLineDashPattern([],0);drawCellText(pdf,memoLines[line]||'',memoX,ly,memoW,lh,{size:settings.samplingMemoSize,maxLines:1,paddingX:.4});}
    });
  });
}

function renderTarget(pdf,target,vm,photoSources,state,settings) {
  if(target==='materials')renderMaterialPages(pdf,vm,state,settings);
  else if(target==='rooms')renderRoomPages(pdf,vm,state,settings);
  else if(target==='visual-photos')renderVisualPhotoPages(pdf,vm,photoSources,state,settings);
  else if(target==='sampling-photos')renderSamplingPages(pdf,vm,photoSources,state,settings);
}
async function buildVectorPdf({targets,vm,photoSources,onProgress=null,settings=null}) {
  await loadScript(JSPDF_URL,'jspdf');
  const {jsPDF}=window.jspdf||{};
  if(!jsPDF)throw new Error('PDF生成ライブラリを初期化できませんでした。');
  const outputSettings=normalizeOutputSettings(settings||getOutputSettings());
  onProgress?.('PDFフォントを準備しています…',.05);
  const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});
  await registerFonts(pdf);
  const state={pageCount:0};const list=Array.isArray(targets)?targets:[];
  list.forEach((target,index)=>{onProgress?.(`PDFを作成中 ${index+1} / ${list.length}`,(index+1)/Math.max(1,list.length));renderTarget(pdf,target,vm,photoSources,state,outputSettings);});
  if(!state.pageCount){addPage(pdf,state);setFont(pdf,10,'normal');pdf.text('出力対象がありません。',10,20);}
  if(pdf.getNumberOfPages()>state.pageCount)pdf.deletePage(1);
  return pdf;
}

export async function createVectorPdfPreview({targets,vm,photoSources,onProgress=null,settings=null}) {
  const pdf=await buildVectorPdf({targets,vm,photoSources,onProgress,settings});
  return {blob:pdf.output('blob'),pageCount:pdf.getNumberOfPages()};
}
export async function createVectorPdfBlob({targets,vm,photoSources,onProgress=null,settings=null}) {
  const pdf=await buildVectorPdf({targets,vm,photoSources,onProgress,settings});
  return pdf.output('blob');
}
export async function exportVectorPdf({targets,vm,photoSources,filename,onProgress=null,settings=null}) {
  const pdf=await buildVectorPdf({targets,vm,photoSources,onProgress,settings});
  pdf.save(filename);
}
