import { kfGetJson, resolveKissflowAccountId, KF_ADMIN_PAGE_SIZE, runWithConcurrency } from './kfRuntime.js';

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
  const s = String(status || '').trim().toLowerCase();
  return s.includes('complete') || s.includes('closed') || s.includes('done');
}

/**
 * Display title for a subtask row.
 * Prefer form field Sub_task_Name; SubTask_Summary is free text; Kissflow `Name`
 * is often a system label like "Sub-Task Process from …".
 */
export function resolveSubtaskDisplayName(source, fallback = 'Untitled subtask') {
  const row = source && typeof source === 'object' ? source : {};
  const raw = row.raw && typeof row.raw === 'object' ? row.raw : {};

  const isPlaceholder = (s) => {
    const t = String(s || '').trim().toLowerCase();
    return !t || t === '—' || t === '-' || t === 'untitled' || t === 'untitled subtask' || t === 'untitled task';
  };
  const isProcessLabel = (s) => /^sub[-\s]?task process from\b/i.test(String(s || '').trim());
  const isPkId = (s) => /^Pk[A-Za-z0-9]+$/.test(String(s || '').trim());

  const pick = (...vals) => {
    for (const v of vals) {
      const s = String(v ?? '').trim();
      if (isPlaceholder(s) || isProcessLabel(s) || isPkId(s)) continue;
      return s;
    }
    return '';
  };

  const named = pick(
    row.Sub_task_Name,
    raw.Sub_task_Name,
    row.Sub_Task_Name,
    raw.Sub_Task_Name,
    row.Subtask_Name,
    raw.Subtask_Name,
    row.subtaskName,
    row.taskName,
    // mapSubtaskRow / hub rows often expose the title as `name` only
    row.name,
  );
  if (named) return named;

  const summary = pick(row.SubTask_Summary, raw.SubTask_Summary, row.summary, raw.summary);
  if (summary) return summary;

  const loose = pick(row.name, raw.Name, row.Name);
  if (loose) return loose;

  return fallback;
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
    return String(
      ref?.Subtaxk_id ||
        ref?.Task_ID_Formulated ||
        ref?.Task_ID_Hidden ||
        ref?.Project_Task_ID ||
        ref?.Project_ID_1 ||
        '',
    ).trim();
  }
  if (typeof ref === 'string' && ref.trim()) return ref.trim();
  return String(r?.Project_Task_ID ?? '').trim();
}

function resolveParentTaskName(r) {
  const ref = r?.Task_ID;
  if (ref && typeof ref === 'object') {
    // Parent is Project_Sub_Task_A01 — display name lives on Sub_Task_Name (Name is often empty).
    const name = String(
      ref?.Sub_Task_Name ||
        ref?.Task_Name ||
        ref?.Name ||
        ref?.Subject ||
        ref?.title ||
        '',
    ).trim();
    if (name) return name;
  }
  // Prefer business id over a blank dash when the Task ID lookup is present.
  const id = resolveParentTaskId(r);
  return id || '—';
}

function personNameFromRef(value) {
  if (value == null || value === '') return '';
  if (Array.isArray(value)) {
    for (const entry of value) {
      const name = personNameFromRef(entry);
      if (name) return name;
    }
    return '';
  }
  if (typeof value === 'object') {
    return String(value?.Name || value?.name || value?.DisplayName || '').trim();
  }
  return String(value).trim();
}

/** Prefer process Assignee_1, then Assigned_To / current assignees, then creator. */
function resolveAssigneeName(r) {
  const fromFields = [
    personNameFromRef(r?.Assignee_1),
    personNameFromRef(r?.Assigned_To),
    personNameFromRef(r?._current_assigned_to),
    personNameFromRef(r?.Assignee),
  ].find(Boolean);
  if (fromFields) return fromFields;
  return personNameFromRef(r?._created_by) || '';
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

  const assigneeName = resolveAssigneeName(r);
  // Form field is Sub_task_Name; Name is often a system copy of it.
  const named = resolveSubtaskDisplayName(r, '');
  const summary = String(r?.SubTask_Summary ?? '').trim();
  const subtaskName = named || summary || 'Untitled subtask';
  // Table status uses form select TStatus (e.g. Open), not workflow _status.
  const status = String(r?.TStatus ?? r?._status ?? '—').trim() || '—';
  const parentTaskId = resolveParentTaskId(r);
  const parentTaskName = resolveParentTaskName(r);
  const priority = String(r?.Sub_task_Priority ?? r?.Sub_Task_Priority ?? '—').trim() || '—';

  const activityRaw = r?._activity_instance_id;
  const activityId = Array.isArray(activityRaw) ? (activityRaw[0] ?? '') : (activityRaw ?? '');

  const row = {
    id: String(r?._id ?? `SUB-${idx + 1}`).trim(),
    subtaskName,
    summary: summary || named || '—',
    parentTaskName,
    parentTaskId: parentTaskId || '—',
    parentTaskBusinessId: parentTaskId || '',
    projectId: String(r?.Project_ID ?? '—').trim() || '—',
    projectTaskId: String(r?.Project_Task_ID ?? '—').trim() || '—',
    boardId: String(r?.Board_ID ?? '—').trim() || '—',
    processId: String(r?.Process_ID ?? '—').trim() || '—',
    assignedTo: assigneeName || '—',
    // Keep initials in sync with displayed name (avoids "RJ" badge next to a "—" name).
    assigneeAvatar: toInitials(assigneeName),
    createdBy: String(r?._created_by?.Name ?? '—').trim() || '—',
    createdDate: fmtDate(created) || '—',
    agingDays,
    priority,
    status,
    workflowStatus: String(r?._status ?? '').trim() || '—',
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

function unwrapSubtaskDetail(response) {
  if (!response || typeof response !== 'object') return null;
  if (response.Data && typeof response.Data === 'object' && !Array.isArray(response.Data)) {
    return response.Data;
  }
  if (response.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
    return response.data;
  }
  return response;
}

function activityInstanceIdOfSubtask(row) {
  const raw =
    row?._activity_instance_id ??
    row?.ActivityID ??
    row?.activityInstanceId ??
    row?._entity_id;
  if (Array.isArray(raw)) return String(raw[0] || '').trim();
  return String(raw || '').trim();
}

/** Pending/myitems list rows often omit Task_ID, TStatus, Sub_task_Priority, Sub_task_Name. */
export function rawSubtaskRowNeedsDetailEnrichment(row) {
  if (!row || typeof row !== 'object') return false;
  const hasTaskId = Boolean(row.Task_ID || row.Task_ID_Hidden);
  const hasTStatus = Boolean(String(row.TStatus || '').trim());
  const hasPriority = Boolean(String(row.Sub_task_Priority || row.Sub_Task_Priority || '').trim());
  const hasTitle = Boolean(resolveSubtaskDisplayName(row, ''));
  return !hasTaskId || !hasTStatus || !hasPriority || !hasTitle;
}

/**
 * Merge admin item detail onto slim pending/myitems rows so the table can show
 * Parent task (Task_ID.Sub_Task_Name), Priority (Sub_task_Priority), Status (TStatus).
 */
export async function enrichRawSubtaskRowsWithInstanceDetail(kfInstance, rows, options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length || !kfInstance) return list;

  const accountId = resolveKissflowAccountId(kfInstance, DEFAULT_ACCOUNT_ID);
  const maxRows = Math.max(0, Number(options.maxRows) || 80);
  const concurrency = Math.max(1, Number(options.concurrency) || 6);
  const needIdx = [];
  list.forEach((row, idx) => {
    if (maxRows && needIdx.length >= maxRows) return;
    const id = String(row?._id || row?._item_id || row?.InstanceID || '').trim();
    if (id && rawSubtaskRowNeedsDetailEnrichment(row)) needIdx.push(idx);
  });
  if (!needIdx.length) return list;

  const details = await runWithConcurrency(needIdx, concurrency, async (idx) => {
    const row = list[idx];
    const id = String(row?._id || row?._item_id || row?.InstanceID || '').trim();
    const act = activityInstanceIdOfSubtask(row);
    const adminPath =
      `/process/2/${accountId}/admin/${SUBTASK_PROCESS_ID}/${encodeURIComponent(id)}` +
      `?_application_id=Project_Management_A01`;
    const tryPaths = [adminPath];
    if (act) {
      tryPaths.push(
        `/process/2/${accountId}/${SUBTASK_PROCESS_ID}/${encodeURIComponent(id)}/${encodeURIComponent(act)}`,
      );
    }
    tryPaths.push(`/process/2/${accountId}/${SUBTASK_PROCESS_ID}/${encodeURIComponent(id)}`);

    for (const path of tryPaths) {
      try {
        const response = await kfGetJson(kfInstance, path);
        const detail = unwrapSubtaskDetail(response);
        if (
          detail &&
          (detail._id ||
            detail.Task_ID ||
            detail.TStatus ||
            detail.Sub_task_Name ||
            detail.Sub_task_Priority)
        ) {
          return { idx, detail };
        }
      } catch {
        // try next
      }
    }
    return { idx, detail: null };
  });

  const out = list.slice();
  for (const entry of details) {
    if (!entry?.detail) continue;
    const listRow = out[entry.idx];
    out[entry.idx] = {
      ...listRow,
      ...entry.detail,
      // Keep list activity id if detail omits it (common on admin GET).
      _id: listRow?._id || entry.detail._id,
      _activity_instance_id:
        listRow?._activity_instance_id || entry.detail._activity_instance_id || undefined,
    };
  }
  return out;
}

/** Full admin detail for one Sub_Task_Process_A00 instance (popup fields). */
export async function fetchSubtaskAdminDetailById(kfInstance, instanceId) {
  const id = String(instanceId || '').trim();
  if (!id) throw new Error('Missing subtask instance id');
  if (!kfInstance?.api) {
    throw new Error('Kissflow SDK not ready — open this page inside Kissflow.');
  }
  const accountId = resolveKissflowAccountId(kfInstance, DEFAULT_ACCOUNT_ID);
  const path =
    `/process/2/${accountId}/admin/${SUBTASK_PROCESS_ID}/${encodeURIComponent(id)}` +
    `?_application_id=Project_Management_A01`;
  return kfGetJson(kfInstance, path);
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
