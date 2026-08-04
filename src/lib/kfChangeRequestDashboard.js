import { kfGetJson, resolveKissflowAccountId, KF_ADMIN_PAGE_SIZE } from './kfRuntime.js';
import {
  toInitials,
  parseKfDate,
  fmtDate,
  mapRag,
} from './kfProjectDashboard.js';

const DEFAULT_ACCOUNT_ID = 'AcCMptp3yqcn';
export const CHANGE_REQUEST_PROCESS_ID = 'Change_Request_A01';

function extractApiRows(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.Data)) return payload.Data;
  if (Array.isArray(payload?.data?.Data)) return payload.data.Data;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function resolveLinkedProjectRef(row) {
  return row?.Project_ID || row?.Project_Details || row?.Datelookup || {};
}

function resolveLinkedProjectBusinessId(row, projectRef) {
  return String(
    row?.Project_ID_Hidden ||
      row?.Project_ID_1 ||
      row?.Project_ID__Reference ||
      row?.Project_ID_Details ||
      projectRef?.Project_ID ||
      '',
  ).trim();
}

function resolveChangeRequestId(row) {
  return String(row?.Subtaxk_id || row?.Task_ID_Formulated || '').trim();
}

function mapCrStatus(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'Open';
  return s;
}

export function mapChangeRequestRow(r, idx = 0) {
  const now = new Date();
  const id = String(r?._id ?? `CR-${idx + 1}`).trim();
  const projectRef = resolveLinkedProjectRef(r);
  const linkedProjectBusinessId = resolveLinkedProjectBusinessId(r, projectRef);
  const linkedProjectId = String(projectRef?._item_id || projectRef?._id || '').trim();
  const changeRequestId = resolveChangeRequestId(r);
  const ownerName = String(r?.Assigned_To?.Name || r?._created_by?.Name || 'Unassigned').trim() || 'Unassigned';
  const status = mapCrStatus(r?.Task_Status || r?.Approval_Status || r?._status);
  const startDate = parseKfDate(r?.Start_Date || r?.fetch_start_date || r?._created_at);
  const endDate = parseKfDate(r?.End_Date || r?.fetch_End_date || r?.Actual_End_Date_1);
  const delayDays =
    r?.Delay_Days != null && r?.Delay_Days !== ''
      ? Number(r.Delay_Days)
      : status.toLowerCase().includes('complete')
        ? 0
        : endDate && endDate < now
          ? Math.ceil((now.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24))
          : 0;
  const completed = status.toLowerCase().includes('complete');
  const progress = completed ? 100 : delayDays > 0 ? 40 : 55;

  return {
    id,
    displayId: changeRequestId || linkedProjectBusinessId || id,
    name: String(r?.Name || r?.Sub_Task_Name || `Change Request ${idx + 1}`).trim(),
    owner: ownerName,
    ownerId: String(r?.Assigned_To?._id || r?._created_by?._id || '').trim(),
    ownerEmail: '',
    ownerAvatar: toInitials(ownerName),
    lineOfBusiness: String(r?.Application_Name || 'Change Request').trim(),
    department: 'N/A',
    priority: String(r?.Task_Priority || 'Low').trim(),
    startDate: fmtDate(startDate),
    originalEndDate: fmtDate(endDate),
    revisedEndDate: fmtDate(parseKfDate(r?.Actual_End_Date_1)),
    revisedCount: 0,
    progress,
    rag: mapRag(null, delayDays),
    status,
    delayDays: Number.isFinite(delayDays) ? delayDays : 0,
    totalTasks: 0,
    completedTasks: 0,
    risk: 'N/A',
    governanceFrequency: String(r?.Approval_Status || 'N/A').trim(),
    entity: String(r?.Entity || 'N/A').trim(),
    aiUsage: false,
    subtasks: [],
    revisionHistory: [],
    activityHistory: [],
    linkedProjectId,
    linkedProjectBusinessId,
    projectName: String(projectRef?.Project_Name || projectRef?.Name || '').trim() || '—',
    description: String(r?.Sub_Task_Name || '').trim() || '—',
    changeRequestId: changeRequestId || '—',
    raw: r,
  };
}

async function fetchAdminChangeRequestRows(kfInstance, applyPreference, pageSize = KF_ADMIN_PAGE_SIZE) {
  const accountId = resolveKissflowAccountId(kfInstance, DEFAULT_ACCOUNT_ID);
  const pref =
    applyPreference === undefined
      ? ''
      : `&apply_preference=${applyPreference ? '1' : '0'}`;
  const path =
    `/process/2/${accountId}/admin/${CHANGE_REQUEST_PROCESS_ID}/item?page_number=1&page_size=${pageSize}${pref}`;
  const payload = await kfGetJson(kfInstance, path);
  return extractApiRows(payload);
}

/** Loads change-request rows from Change_Request_A01 admin API (project-row compatible shape). */
export async function fetchChangeRequestDashboardData(kfInstance) {
  if (!kfInstance?.api) {
    throw new Error('Kissflow SDK not ready — open this page inside Kissflow.');
  }

  const attempts = [];
  let rawRows = [];

  for (const pref of [true, false, undefined]) {
    const label = `admin:apply_preference=${pref === undefined ? 'omit' : pref}`;
    try {
      const rows = await fetchAdminChangeRequestRows(kfInstance, pref);
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
    console.warn('[fetchChangeRequestDashboardData] No rows from admin API', attempts);
    return { rows: [], subtasks: [] };
  }

  const rows = rawRows.map((r, idx) => mapChangeRequestRow(r, idx));
  return { rows, subtasks: [] };
}
