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
      capturedAt: BASE_TIME
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
      lastEditedAt: '2026-08-13T08:02:00.000Z'
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
