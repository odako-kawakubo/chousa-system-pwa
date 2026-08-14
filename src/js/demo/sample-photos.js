/**
 * src/js/demo/sample-photos.js
 *
 * v0.1.5.3BのphotoRecord / photoRecordStore確認用データ。
 * 写真タブUIとレコード確認UIで、目視・採取・代表・編集・削除状態を
 * 確認できる最小限のサンプルを投入する。
 */

import { createPhotoRecord } from '../records/photo-record.js';
import * as photoRecordStore from '../store/photo-record-store.js';

const BASE_TIME = '2026-08-13T08:00:00.000Z';

function demoImage(label, hue = 205) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue} 32% 83%)"/><stop offset="1" stop-color="hsl(${hue} 22% 58%)"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><rect x="100" y="120" width="1000" height="560" rx="24" fill="rgba(255,255,255,.28)" stroke="rgba(255,255,255,.65)" stroke-width="8"/><text x="600" y="380" text-anchor="middle" font-family="sans-serif" font-size="72" font-weight="700" fill="#0f172a">${label}</text><text x="600" y="455" text-anchor="middle" font-family="sans-serif" font-size="32" fill="#334155">比較UI確認用デモ写真</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function seedInitialPhotoRecords() {
  const samples = [
    createPhotoRecord({
      photoId: 'DEMO-PHOTO-001',
      photoType: 'visual',
      fileName: 'visual_101_wall_01.jpg',
      roomPosition: '101',
      part: '壁',
      isRepresentative: true,
      capturedDevice: 'iPad-demo',
      capturedAt: BASE_TIME,
      oneDrivePath: demoImage('101 / 壁', 205)
    }),
    createPhotoRecord({
      photoId: 'DEMO-PHOTO-002',
      photoType: 'visual',
      fileName: 'visual_101_wall_02.jpg',
      roomPosition: '101',
      part: '壁',
      capturedDevice: 'iPad-demo',
      capturedAt: '2026-08-13T08:01:00.000Z',
      isEdited: true,
      lastEditedDevice: 'iPad-demo',
      lastEditedAt: '2026-08-13T08:02:00.000Z',
      oneDrivePath: demoImage('101 / 壁 2枚目', 210)
    }),
    createPhotoRecord({
      photoId: 'DEMO-PHOTO-021',
      photoType: 'visual',
      fileName: 'visual_102_wall_01.jpg',
      roomPosition: '102',
      part: '壁',
      isRepresentative: true,
      oneDrivePath: demoImage('102 / 壁', 32),
      capturedDevice: 'iPad-demo',
      capturedAt: '2026-08-13T08:03:00.000Z'
    }),
    createPhotoRecord({
      photoId: 'DEMO-PHOTO-022',
      photoType: 'visual',
      fileName: 'visual_103_floor_01.jpg',
      roomPosition: '103',
      part: '床',
      isRepresentative: true,
      oneDrivePath: demoImage('103 / 床', 120),
      capturedDevice: 'iPad-demo',
      capturedAt: '2026-08-13T08:04:00.000Z'
    }),
    createPhotoRecord({
      photoId: 'DEMO-PHOTO-023',
      photoType: 'visual',
      fileName: 'visual_101_floor_01.jpg',
      roomPosition: '101',
      part: '床',
      isRepresentative: true,
      oneDrivePath: demoImage('1-1 / 床', 165),
      capturedDevice: 'iPad-demo',
      capturedAt: '2026-08-13T08:04:20.000Z'
    }),
    createPhotoRecord({
      photoId: 'DEMO-PHOTO-024',
      photoType: 'visual',
      fileName: 'visual_105_floor_01.jpg',
      roomPosition: '105',
      part: '床',
      isRepresentative: true,
      oneDrivePath: demoImage('1-5 / 床', 285),
      capturedDevice: 'iPad-demo',
      capturedAt: '2026-08-13T08:04:40.000Z'
    }),
    createPhotoRecord({
      photoId: 'DEMO-PHOTO-003',
      photoType: 'sampling',
      fileName: 'sampling_R001_1_before.jpg',
      materialId: 'R001',
      samplingPlace: '1-1',
      samplingBranch: 1,
      sampleNo: '1',
      part: '壁',
      shootingType: 'before',
      isRepresentative: true,
      capturedDevice: 'iPad-demo',
      capturedAt: '2026-08-13T08:05:00.000Z'
    }),
    createPhotoRecord({
      photoId: 'DEMO-PHOTO-004',
      photoType: 'sampling',
      fileName: 'sampling_R001_1_during.jpg',
      materialId: 'R001',
      samplingPlace: '1-1',
      samplingBranch: 1,
      sampleNo: '1',
      part: '壁',
      shootingType: 'during',
      capturedDevice: 'iPad-demo',
      capturedAt: '2026-08-13T08:06:00.000Z'
    }),
    createPhotoRecord({
      photoId: 'DEMO-PHOTO-005',
      photoType: 'sampling',
      fileName: 'sampling_R001_1_after.jpg',
      materialId: 'R001',
      samplingPlace: '1-1',
      samplingBranch: 1,
      sampleNo: '1',
      part: '壁',
      shootingType: 'after',
      capturedDevice: 'iPad-demo',
      capturedAt: '2026-08-13T08:07:00.000Z'
    }),
    createPhotoRecord({
      photoId: 'DEMO-PHOTO-006',
      photoType: 'sampling',
      fileName: 'sampling_R001_1_section.jpg',
      materialId: 'R001',
      samplingPlace: '1-1',
      samplingBranch: 1,
      sampleNo: '1',
      part: '壁',
      shootingType: 'section',
      capturedDevice: 'iPad-demo',
      capturedAt: '2026-08-13T08:08:00.000Z',
      deleted: true
    })
  ];

  photoRecordStore.replaceAll(samples, { notify: false });
}
