/**
 * finishChangeLogsの保持判定だけを担当する純粋helper。
 * 端末時計は使わず、syncDevices.lastSeenAtのサーバー時刻とcursorで判定する。
 */

export function timestampToMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
  if (typeof value.seconds === 'number') {
    return (Number(value.seconds) * 1000) + Math.floor(Number(value.nanoseconds || 0) / 1e6);
  }
  return 0;
}

export function normalizeFinishCursor(value) {
  if (!value || typeof value.seconds !== 'number' || !value.changeId) return null;
  return {
    seconds: Number(value.seconds),
    nanoseconds: Number(value.nanoseconds || 0),
    changeId: String(value.changeId)
  };
}

export function compareFinishCursors(a, b) {
  if (Number(a?.seconds || 0) !== Number(b?.seconds || 0)) {
    return Number(a?.seconds || 0) - Number(b?.seconds || 0);
  }
  if (Number(a?.nanoseconds || 0) !== Number(b?.nanoseconds || 0)) {
    return Number(a?.nanoseconds || 0) - Number(b?.nanoseconds || 0);
  }
  return String(a?.changeId || '').localeCompare(String(b?.changeId || ''));
}

export function buildChangeLogRetentionState(devices = [], retentionMs) {
  const serverNowMs = devices.reduce(
    (max, device) => Math.max(max, timestampToMillis(device?.lastSeenAt)),
    0
  );
  if (!serverNowMs) {
    return {
      serverNowMs: 0,
      retentionCutoffMs: 0,
      activeDevices: [],
      oldestActiveCursor: null
    };
  }

  const retentionCutoffMs = serverNowMs - Number(retentionMs || 0);
  const activeDevices = devices.filter(
    (device) => timestampToMillis(device?.lastSeenAt) >= retentionCutoffMs
  );
  const activeCursors = activeDevices
    .map((device) => normalizeFinishCursor(device?.finishChangeCursor))
    .filter(Boolean)
    .sort(compareFinishCursors);

  return {
    serverNowMs,
    retentionCutoffMs,
    activeDevices,
    oldestActiveCursor: activeCursors[0] || null
  };
}

export function canDeleteChangeLogCursor(cursor, oldestActiveCursor) {
  if (!cursor) return false;
  if (!oldestActiveCursor) return true;
  return compareFinishCursors(cursor, oldestActiveCursor) < 0;
}
