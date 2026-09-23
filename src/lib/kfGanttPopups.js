/**
 * Kissflow popups for UserHubGanttProject / GanttChart.
 *
 * Same param contract as UserSpecificPT:
 *   Project → CaseID
 *   Task    → ActivityID, ActivityInstanceID, InstanceID
 *   Subtask → ActivityID, ActivityInstanceID, InstanceID
 *
 * Popup page component IDs (Gantt-specific):
 *   Project → Popup_fQKw5K_Lkw
 *   Task    → Popup_J_fsiGC-J6
 *   Subtask → Popup_RyuGJ3mUzN
 */

import {
  openUserHubProjectPopup,
  resolveUserHubProjectCaseId,
} from './kfUserHubPopups.js';
import { fetchTaskAdminItemDetail } from './kfTaskTracker.js';
import { fetchSubtaskAdminDetailById } from './kfSubtaskTracker.js';

export const GANTT_POPUP_IDS = {
  project: 'Popup_fQKw5K_Lkw',
  task: 'Popup_J_fsiGC-J6',
  subtask: 'Popup_RyuGJ3mUzN',
};

/** Same size keys as UserSpecificPT. */
const POPUP_SIZE = {
  width: 960,
  height: 720,
  popupWidth: '960px',
  popupHeight: '720px',
};

function resolveKfSdk(kfInstance) {
  return kfInstance ?? (typeof window !== 'undefined' ? window.kf : null);
}

function resolveHostOpenPopupSdk(kfInstance) {
  if (typeof window !== 'undefined' && typeof window.kf?.app?.page?.openPopup === 'function') {
    return window.kf;
  }
  const sdk = resolveKfSdk(kfInstance);
  if (typeof sdk?.app?.page?.openPopup === 'function') return sdk;
  return null;
}

function unwrapDetail(response) {
  if (!response || typeof response !== 'object') return null;
  if (response.Data && typeof response.Data === 'object' && !Array.isArray(response.Data)) {
    return response.Data;
  }
  if (response.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
    return response.data;
  }
  return response;
}

function isBusinessTaskOrSubtaskId(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  return /^Task[-_]/i.test(s) || /^Sub[-_\s]?Task/i.test(s) || /^PRJ[-_]/i.test(s);
}

/**
 * Same resolution order as UserSpecificPT.resolveRowPopupIds,
 * but never use Task-PRJ-… business codes as InstanceID.
 */
export function resolveGanttRowPopupIds(row) {
  const raw = row?.raw && typeof row.raw === 'object' ? row.raw : row?.raw ?? row ?? {};
  const instanceCandidates = [
    raw?._id,
    raw?._item_id,
    row?.InstanceID,
    row?.InstanceId,
    row?.instanceId,
    row?._id,
    row?.id,
  ];
  let instanceId = '';
  for (const c of instanceCandidates) {
    const s = String(c || '').trim();
    if (s && !isBusinessTaskOrSubtaskId(s)) {
      instanceId = s;
      break;
    }
  }

  const activityInstance =
    raw?._activity_instance_id
    ?? row?._activity_instance_id
    ?? row?.ActivityID
    ?? row?.ActivityId
    ?? row?.activityId
    ?? '';
  const activityId = Array.isArray(activityInstance)
    ? String(activityInstance[0] ?? '').trim()
    : String(activityInstance || '').trim();

  return { instanceId, activityId };
}

/** Exact UserSpecificPT openPopup params for task / subtask. */
function buildUsptStyleProcessParams(instanceId, activityId) {
  return {
    ActivityID: String(activityId || '').trim(),
    ActivityInstanceID: String(activityId || '').trim(),
    InstanceID: String(instanceId || '').trim(),
    ...POPUP_SIZE,
  };
}

function attachPopupClose(promise, onClosed) {
  if (!onClosed || !promise || typeof promise.then !== 'function') return;
  const run = () => {
    try {
      onClosed();
    } catch (err) {
      console.warn('Gantt popup onClosed failed:', err);
    }
  };
  if (typeof promise.finally === 'function') {
    promise.finally(run);
    return;
  }
  promise.then(run, run);
}

async function resolveLiveTaskOpenIds(kfInstance, row) {
  let { instanceId, activityId } = resolveGanttRowPopupIds(row);
  // List rows already carry Pk ids — skip admin detail GET (rate-limit friendly).
  if (instanceId && activityId) return { instanceId, activityId };
  if (!instanceId || !kfInstance) return { instanceId, activityId };

  try {
    const detail = unwrapDetail(await fetchTaskAdminItemDetail(kfInstance, instanceId));
    if (detail) {
      const detailId = String(detail._id || detail._item_id || '').trim();
      if (detailId && !isBusinessTaskOrSubtaskId(detailId)) instanceId = detailId;
      const acts = detail._activity_instance_id;
      const fromDetail = Array.isArray(acts)
        ? String(acts[0] ?? '').trim()
        : String(acts || '').trim();
      if (fromDetail) activityId = fromDetail;
    }
  } catch (err) {
    console.warn('Gantt task: live activity refresh failed', err?.message || err);
  }
  return { instanceId, activityId };
}

async function resolveLiveSubtaskOpenIds(kfInstance, row) {
  let { instanceId, activityId } = resolveGanttRowPopupIds(row);
  if (instanceId && activityId) return { instanceId, activityId };
  if (!instanceId || !kfInstance) return { instanceId, activityId };

  try {
    const detail = unwrapDetail(await fetchSubtaskAdminDetailById(kfInstance, instanceId));
    if (detail) {
      const detailId = String(detail._id || detail._item_id || '').trim();
      if (detailId && !isBusinessTaskOrSubtaskId(detailId)) instanceId = detailId;
      const acts = detail._activity_instance_id;
      const fromDetail = Array.isArray(acts)
        ? String(acts[0] ?? '').trim()
        : String(acts || '').trim();
      if (fromDetail) activityId = fromDetail;
    }
  } catch (err) {
    console.warn('Gantt subtask: live activity refresh failed', err?.message || err);
  }
  return { instanceId, activityId };
}

/** Project — CaseID only (same as UserSpecificPT). */
export function openGanttProjectPopup(kfInstance, row, options = {}) {
  return openUserHubProjectPopup(kfInstance, row, {
    ...options,
    popupId: options.popupId || GANTT_POPUP_IDS.project,
  });
}

/** Task — ActivityID, ActivityInstanceID, InstanceID (UserSpecificPT shape). */
export async function openGanttTaskPopup(kfInstance, row, options = {}) {
  const apiSdk = resolveKfSdk(kfInstance);
  const hostSdk = resolveHostOpenPopupSdk(kfInstance);
  const popupId = String(options.popupId || GANTT_POPUP_IDS.task).trim();
  if (!hostSdk) {
    console.warn('Gantt task popup: openPopup not available');
    return false;
  }

  const { instanceId, activityId } = await resolveLiveTaskOpenIds(apiSdk, row);
  if (!instanceId || !activityId) {
    console.warn('Gantt task popup: missing ids', { popupId, instanceId, activityId });
    hostSdk.client?.showInfo?.('Missing InstanceID or ActivityID for this task.');
    return false;
  }

  try {
    const params = buildUsptStyleProcessParams(instanceId, activityId);
    console.info('[Gantt task popup]', popupId, {
      InstanceID: params.InstanceID,
      ActivityID: params.ActivityID,
      ActivityInstanceID: params.ActivityInstanceID,
    });
    const p = hostSdk.app.page.openPopup(popupId, params);
    attachPopupClose(p, options.onClosed);
    if (p && typeof p.catch === 'function') {
      p.catch((err) => console.warn('Gantt task popup failed:', err));
    }
    return true;
  } catch (err) {
    console.warn('Gantt task popup threw', err);
    return false;
  }
}

/** Subtask — ActivityID, ActivityInstanceID, InstanceID (UserSpecificPT shape). */
export async function openGanttSubtaskPopup(kfInstance, row, options = {}) {
  const apiSdk = resolveKfSdk(kfInstance);
  const hostSdk = resolveHostOpenPopupSdk(kfInstance);
  const popupId = String(options.popupId || GANTT_POPUP_IDS.subtask).trim();
  if (!hostSdk) {
    console.warn('Gantt subtask popup: openPopup not available');
    return false;
  }

  const { instanceId, activityId } = await resolveLiveSubtaskOpenIds(apiSdk, row);
  if (!instanceId || !activityId) {
    console.warn('Gantt subtask popup: missing ids', { popupId, instanceId, activityId });
    hostSdk.client?.showInfo?.('Missing InstanceID or ActivityID for this subtask.');
    return false;
  }

  try {
    const params = buildUsptStyleProcessParams(instanceId, activityId);
    console.info('[Gantt subtask popup]', popupId, {
      InstanceID: params.InstanceID,
      ActivityID: params.ActivityID,
      ActivityInstanceID: params.ActivityInstanceID,
    });
    const p = hostSdk.app.page.openPopup(popupId, params);
    attachPopupClose(p, options.onClosed);
    if (p && typeof p.catch === 'function') {
      p.catch((err) => console.warn('Gantt subtask popup failed:', err));
    }
    return true;
  } catch (err) {
    console.warn('Gantt subtask popup threw', err);
    return false;
  }
}

export { resolveUserHubProjectCaseId as resolveGanttProjectCaseId };
