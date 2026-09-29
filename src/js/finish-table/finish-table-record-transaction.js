/**
 * finish / material / photo の複数Store更新を1操作としてまとめる。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';

export function runRecordTransaction(mutate) {
  finishRecordStore.batch(() => {
    materialRecordStore.batch(() => {
      photoRecordStore.batch(() => mutate());
    });
  });
}
