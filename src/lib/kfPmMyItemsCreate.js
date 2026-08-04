/**
 * Create a Kissflow process draft, then open popup with InstanceID / ActivityInstanceID.
 * Same pattern as ProjectDashboardPage createTaskInstance → openPopup.
 */

import { kfMutateJson, resolveKissflowAccountId } from './kfRuntime.js'
import { resolvePmPopupId } from './kfPmMyItemsPaths.js'

function unwrapKfCreateResponse(resp) {
  const layer1 = resp?.data ?? resp ?? {}
  const layer2 = layer1?.data ?? layer1
  return layer2 && typeof layer2 === 'object' ? layer2 : layer1
}

export function parseProcessCreateIds(resp) {
  const data = unwrapKfCreateResponse(resp)
  const instanceId = String(data?._id || '').trim()
  const activityRaw = data?._activity_instance_id ?? data?.activityInstanceId ?? data?.ActivityInstanceID
  const activityInstanceId = Array.isArray(activityRaw)
    ? String(activityRaw[0] || '').trim()
    : String(activityRaw || '').trim()
  return { instanceId, activityInstanceId, raw: data }
}

/** POST /process/2/{account}/{processId} → { instanceId, activityInstanceId } */
export async function createPmProcessDraft(kfInstance, entity, body = {}) {
  if (!entity?.processId) throw new Error('Missing processId for draft create')
  const accountId = resolveKissflowAccountId(kfInstance, entity.accountFallback)
  if (!accountId) throw new Error('Kissflow account not ready')

  const path = `/process/2/${accountId}/${entity.processId}`
  const raw = await kfMutateJson(kfInstance, path, {
    method: 'POST',
    body: body && typeof body === 'object' ? body : {},
    preferSessionAuth: true,
  })

  const { instanceId, activityInstanceId, raw: parsedRaw } = parseProcessCreateIds(raw)

  if (parsedRaw?.status === 'error' || parsedRaw?.error_code) {
    throw new Error(parsedRaw.en_message || parsedRaw.message || 'Kissflow create failed')
  }
  if (!instanceId || !activityInstanceId) {
    throw new Error(`${entity.labels?.entitySingular || 'Item'} create API did not return InstanceID and ActivityInstanceID`)
  }

  return { instanceId, activityInstanceId, raw: parsedRaw }
}

/** Row open / view details — InstanceID + ActivityInstanceID (+ size). */
export function buildPmPopupParams(entity, instanceId, activityInstanceId, extra = {}) {
  const instanceKey = entity?.popupParamKeys?.instanceId || 'InstanceID'
  const activityKey = entity?.popupParamKeys?.activityInstanceId || 'ActivityInstanceID'
  const id = String(instanceId || '').trim()
  const aid = String(activityInstanceId || '').trim()
  return {
    [instanceKey]: id,
    [activityKey]: aid,
    InstanceID: id,
    ActivityInstanceID: aid,
    width: 960,
    height: 720,
    popupWidth: '960px',
    popupHeight: '720px',
    ...extra,
  }
}

/**
 * New Task / New Subtask button:
 * 1) POST draft on entity.processId
 * 2) openPopup(entity.popupId, { InstanceID, ActivityInstanceID })
 *    — Tasks: Popup_bEJJgrdutd · Subtasks: Popup_QTJQAyhxOR
 */
export async function openPmNewItemPopup(kfInstance, entity) {
  const popupId = resolvePmPopupId(entity)
  if (!popupId) throw new Error('Missing popup id')
  if (typeof kfInstance?.app?.page?.openPopup !== 'function') {
    throw new Error('openPopup is not available on this page')
  }
  if (entity?.kind !== 'process' || !entity?.processId) {
    throw new Error('openPmNewItemPopup requires a process entity')
  }

  const created = await createPmProcessDraft(kfInstance, entity, entity.createDraftBody || {})
  const instanceKey = entity?.popupParamKeys?.instanceId || 'InstanceID'
  const activityKey = entity?.popupParamKeys?.activityInstanceId || 'ActivityInstanceID'
  const params = {
    [instanceKey]: created.instanceId,
    [activityKey]: created.activityInstanceId,
  }

  const p = kfInstance.app.page.openPopup(popupId, params)
  // Fire-and-forget: awaiting hangs after popup close in some Kissflow hosts.
  if (p && typeof p.catch === 'function') {
    p.catch((err) => console.warn('openPmNewItemPopup failed:', err))
  }
  return { ...created, popupId }
}
