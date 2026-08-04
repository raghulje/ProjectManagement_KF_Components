import { kfGetJson, resolveKissflowAccountId, KF_ADMIN_PAGE_SIZE } from './kfRuntime.js';

const DEFAULT_ACCOUNT_ID = 'AcCMptp3yqcn';
export const SUBTASK_PROCESS_ID = 'Sub_Task_Process_A00';

export function toInitials(name) {
  const txt = String(name || '').trim();
  if (!txt) return 'NA';
  const parts = txt.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || 'NA';
}

export function parseKfDate(dateLike) {
  if (!dateLike) return null;
  const cleaned = String(dateLike).replace(/\s+[A-Za-z_/]+$/, '');
  const d = new Date(cleaned);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(d) {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

export function isSubtaskCompleted(status) {
  const s = String(status || '').toLowerCase();
  return s.includes('complete') || s.includes('closed') || s.includes('done');
}

function extractApiRows(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.Data)) return payload.Data;
  if (Array.isArray(payload?.data?.Data)) return payload.data.Data;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function resolveParentTaskId(r) {
  const hidden = String(r?.Task_ID_Hidden ?? '').trim();
  if (hidden) return hidden;

  const ref = r?.Task_ID;
  if (ref && typeof ref === 'object') {
    return String(ref?.Subtaxk_id || ref?.Task_ID_Formulated || ref?.Project_ID_1 || '').trim();
  }
  return String(r?.Project_Task_ID ?? '').trim();
}

function resolveParentTaskName(r) {
  const ref = r?.Task_ID;
  if (ref && typeof ref === 'object') {
    const name = String(ref?.Name ?? '').trim();
    if (name) return name;
  }
  return '—';
}

/** RAG for subtask rows based on status and age. */
export function mapSubtaskRag(row) {
  const status = String(row?.status ?? '').toLowerCase();
  if (isSubtaskCompleted(status)) return 'Green';
  if ((row?.agingDays ?? 0) > 21) return 'Red';
  if (status.includes('progress') || status.includes('open') || status.includes('pending')) return 'Amber';
  return 'Amber';
}

export function mapAdminSubtaskRow(r, idx = 0) {
  const now = new Date();
  const created = parseKfDate(r?._created_at);
  const agingDays = created
    ? Math.max(0, Math.ceil((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

  const assignee = r?.Assignee_1;
  const assigneeName = String(assignee?.Name || '—').trim() || '—';
  const summary = String(r?.SubTask_Summary ?? '').trim();
  const subtaskName = summary || 'Untitled subtask';
  const status = String(r?._status ?? '—').trim() || '—';
  const parentTaskId = resolveParentTaskId(r);
  const parentTaskName = resolveParentTaskName(r);

  const activityRaw = r?._activity_instance_id;
  const activityId = Array.isArray(activityRaw) ? (activityRaw[0] ?? '') : (activityRaw ?? '');

  const row = {
    id: String(r?._id ?? `SUB-${idx + 1}`).trim(),
    subtaskName,
    summary: summary || '—',
    parentTaskName,
    parentTaskId: parentTaskId || '—',
    projectId: String(r?.Project_ID ?? '—').trim() || '—',
    projectTaskId: String(r?.Project_Task_ID ?? '—').trim() || '—',
    boardId: String(r?.Board_ID ?? '—').trim() || '—',
    processId: String(r?.Process_ID ?? '—').trim() || '—',
    assignedTo: assigneeName,
    assigneeAvatar: toInitials(assigneeName !== '—' ? assigneeName : String(r?._created_by?.Name || '')),
    createdBy: String(r?._created_by?.Name ?? '—').trim() || '—',
    createdDate: fmtDate(created) || '—',
    agingDays,
    status,
    InstanceID: String(r?._id ?? '').trim(),
    ActivityID: activityId,
    _id: r?._id,
    _activity_instance_id: activityRaw,
    raw: r,
  };

  return { ...row, rag: mapSubtaskRag(row) };
}

async function fetchAdminSubtaskRows(kfInstance, applyPreference, pageSize = KF_ADMIN_PAGE_SIZE) {
  const accountId = resolveKissflowAccountId(kfInstance, DEFAULT_ACCOUNT_ID);
  const pref =
    applyPreference === undefined
      ? ''
      : `&apply_preference=${applyPreference ? '1' : '0'}`;
  const path =
    `/process/2/${accountId}/admin/${SUBTASK_PROCESS_ID}/item?page_number=1&page_size=${pageSize}${pref}`;
  const payload = await kfGetJson(kfInstance, path);
  return extractApiRows(payload);
}

/**
 * Loads subtasks from Sub_Task_Process_A00 admin API (with preference fallbacks).
 */
export async function fetchSubtaskProcessData(kfInstance) {
  if (!kfInstance?.api) {
    throw new Error('Kissflow SDK not ready — open this page inside Kissflow.');
  }

  const attempts = [];
  let rawRows = [];

  for (const pref of [true, false, undefined]) {
    const label = `admin:apply_preference=${pref === undefined ? 'omit' : pref}`;
    try {
      const rows = await fetchAdminSubtaskRows(kfInstance, pref);
      attempts.push({ label, count: rows.length });
      if (rows.length > 0) {
        rawRows = rows;
        break;
      }
    } catch (error) {
      attempts.push({ label, error: error?.message || String(error) });
    }
  }

  if (rawRows.length === 0) {
    console.warn('[fetchSubtaskProcessData] No rows from admin API', attempts);
    return [];
  }

  return rawRows.map((r, idx) => mapAdminSubtaskRow(r, idx));
}

export function computeSubtaskKpiMetrics(subtasks) {
  const list = Array.isArray(subtasks) ? subtasks : [];
  const total = list.length;
  const completed = list.filter((s) => isSubtaskCompleted(s.status)).length;
  const open = list.filter((s) => !isSubtaskCompleted(s.status)).length;
  const stale = list.filter((s) => !isSubtaskCompleted(s.status) && (s.agingDays ?? 0) > 21).length;
  const denom = Math.max(total, 1);

  return {
    totalSubtasks: total,
    openSubtasks: open,
    completedSubtasks: completed,
    staleSubtasks: stale,
    openPct: Math.round((open / denom) * 100),
    completedPct: Math.round((completed / denom) * 100),
    stalePct: Math.round((stale / denom) * 100),
  };
}
