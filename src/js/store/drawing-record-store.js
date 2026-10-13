import { createDrawingRecord } from '../records/drawing-record.js';

let records = new Map();
const listeners = [];
let batchDepth = 0;
let pendingNotify = false;

function notify(){ if(batchDepth>0){ pendingNotify=true; return; } listeners.slice().forEach((fn)=>fn()); }
function clone(record){ return createDrawingRecord(record); }

export function subscribe(callback){ listeners.push(callback); return ()=>{ const i=listeners.indexOf(callback); if(i>=0) listeners.splice(i,1); }; }
export function getAll(){ return Array.from(records.values()); }
export function get(drawingId){ return records.get(String(drawingId||'')); }
export function getActive(){ return getAll().filter((record)=>!record.deleted).sort((a,b)=>(a.order-b.order)||String(a.drawingId).localeCompare(String(b.drawingId))); }
export function set(fields){ const record=clone(fields); if(!record.drawingId) throw new Error('drawingIdは必須です。'); records.set(record.drawingId,record); notify(); return record; }
export function exportSnapshot(){ return getAll().map((record)=>clone(record)); }
export function replaceAll(snapshot=[],options={}){ records=new Map((snapshot||[]).map((record)=>{ const next=clone(record); return [next.drawingId,next]; }).filter(([id])=>id)); if(options.notify!==false) notify(); }
export function batch(callback){ batchDepth+=1; try{ callback(); } finally { batchDepth-=1; if(batchDepth===0&&pendingNotify){ pendingNotify=false; notify(); } } }
export function clearAll(){ records=new Map(); }
