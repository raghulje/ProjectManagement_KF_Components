/**
 * Kissflow popup open helpers — User Hub only.
 * UserHubProjectsProject: Popup_Xrl9X_fXTJ (CaseID)
 * UserHubTasksProject:   Popup_8POjXW0UE8 (ActivityID, InstanceID)
 */

const USER_HUB_POPUP_IDS = {
  project: 'Popup_Xrl9X_fXTJ',
  task: 'Popup_8POjXW0UE8',
};

const POPUP_SIZE = {
  width: 960,
  height: 720,
  popupWidth: '960px',
  popupHeight: '720px',
};

function resolveKfSdk(kfInstance) {
  return kfInstance ?? (typeof window !== 'undefined' ? window.kf : null);
}

/** Case item id for project popup (CaseID param). */
export function resolveUserHubProjectCaseId(row) {
  const raw = row?.raw ?? row ?? {};
  return String(
    raw?._id
      ?? raw?._item_id
      ?? row?.CaseID
      ?? row?.caseId
      ?? row?.InstanceID
      ?? row?.id
      ?? '',
  ).trim();
}

/** Task popup ids — ActivityID + InstanceID. */
export function resolveUserHubTaskPopupIds(row) {
  const raw = row?.raw ?? row ?? {};
  const instanceId =
    raw?._id ?? row?.InstanceID ?? row?.InstanceId ?? row?.instanceId ?? row?.id ?? '';
  const activityInstance =
    raw?._activity_instance_id ?? row?.ActivityID ?? row?.ActivityId ?? row?.activityId ?? '';
  const activityId = Array.isArray(activityInstance) ? (activityInstance[0] ?? '') : activityInstance;
  return {
    instanceId: String(instanceId || '').trim(),
    activityId: String(activityId || '').trim(),
  };
}

export function openUserHubProjectPopup(kfInstance, row) {
  const sdk = resolveKfSdk(kfInstance);
  const caseId = resolveUserHubProjectCaseId(row);
  if (typeof sdk?.app?.page?.openPopup !== 'function') {
    console.warn('UserHub project popup: openPopup not available');
    return false;
  }
  if (!caseId) {
    sdk?.client?.showInfo?.('Missing CaseID for this project.');
    return false;
  }
  try {
    const p = sdk.app.page.openPopup(USER_HUB_POPUP_IDS.project, {
      CaseID: caseId,
      ...POPUP_SIZE,
    });
    if (p && typeof p.catch === 'function') {
      p.catch((err) => console.warn('UserHub project popup failed:', err));
    }
    return true;
  } catch (err) {
    console.warn('UserHub project popup threw', err);
    return false;
  }
}

/** Open project create popup (no row params). */
export function openUserHubProjectCreatePopup(kfInstance) {
  const sdk = resolveKfSdk(kfInstance);
  if (typeof sdk?.app?.page?.openPopup !== 'function') {
    console.warn('UserHub project create popup: openPopup not available');
    return false;
  }
  try {
    const p = sdk.app.page.openPopup(USER_HUB_POPUP_IDS.project, { ...POPUP_SIZE });
    if (p && typeof p.catch === 'function') {
      p.catch((err) => console.warn('UserHub project create popup failed:', err));
    }
    return true;
  } catch (err) {
    console.warn('UserHub project create popup threw', err);
    return false;
  }
}

/** Open task create popup (no row params). */
export function openUserHubTaskCreatePopup(kfInstance) {
  const sdk = resolveKfSdk(kfInstance);
  if (typeof sdk?.app?.page?.openPopup !== 'function') {
    console.warn('UserHub task create popup: openPopup not available');
    return false;
  }
  try {
    const p = sdk.app.page.openPopup(USER_HUB_POPUP_IDS.task, { ...POPUP_SIZE });
    if (p && typeof p.catch === 'function') {
      p.catch((err) => console.warn('UserHub task create popup failed:', err));
    }
    return true;
  } catch (err) {
    console.warn('UserHub task create popup threw', err);
    return false;
  }
}

export function openUserHubTaskPopup(kfInstance, row) {
  const sdk = resolveKfSdk(kfInstance);
  const { instanceId, activityId } = resolveUserHubTaskPopupIds(row);
  if (typeof sdk?.app?.page?.openPopup !== 'function') {
    console.warn('UserHub task popup: openPopup not available');
    return false;
  }
  if (!instanceId || !activityId) {
    sdk?.client?.showInfo?.('Missing InstanceID or ActivityID for this task.');
    return false;
  }
  try {
    const p = sdk.app.page.openPopup(USER_HUB_POPUP_IDS.task, {
      InstanceID: instanceId,
      ActivityID: activityId,
      ...POPUP_SIZE,
    });
    if (p && typeof p.catch === 'function') {
      p.catch((err) => console.warn('UserHub task popup failed:', err));
    }
    return true;
  } catch (err) {
    console.warn('UserHub task popup threw', err);
    return false;
  }
}
