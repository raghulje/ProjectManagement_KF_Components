/**
 * User Hub — tasks page only.
 * Data model mirrors mis-table-kf (same Kissflow endpoints, renamed labels):
 * - Tasks Created by Me  = My Items      → myitems/status/count + myitems/{draft|inprogress|…}
 * - Tasks Assigned to me = My Tasks      → pending/activity/count + pending/{activityId} (Open)
 *                          + Participated → participated/activity/count + list (Closed)
 * Light load: status/activity counts + one page of the active view (no per-row enrich).
 * Heavy project/task report APIs are skipped via ProjectDashboardPage lightHubTasksMode.
 *
 * After Kissflow popup Save/Submit, `context.watchParams` bumps refreshTick so lists + counts reload.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import ProjectDashboardPage from './ProjectDashboardPage.jsx';
import UserHubTaskToolbar from './components/UserHubTaskToolbar.jsx';
import { useUserHubSession } from './lib/useUserHubSession.js';
import {
  deleteTaskDraftRecords,
  fetchAssignedClosedProcessTasks,
  fetchAssignedOpenProcessTasks,
  fetchMyCreatedTasksByStatus,
  fetchUserHubTaskCounts,
  resolveTaskDraftDeleteId,
  unwrapTaskPageResult,
  HUB_TASK_PAGE_SIZE,
} from './lib/kfPmTaskProcessItems.js';
import {
  openUserHubSubtaskPopup,
  openUserHubTaskCreatePopup,
  openUserHubTaskPopup,
} from './lib/kfUserHubPopups.js';

const EMPTY_STATUS_COUNTS = {
  Draft: 0,
  'In progress': 0,
  Completed: 0,
  Withdrawn: 0,
  Rejected: 0,
};

export default function UserHubTasksPage({ useLayout = false }) {
  const { kfInstance, scopeUser, firstName, displayRole, greeting } = useUserHubSession();

  const [taskScope, setTaskScope] = useState('assigned');
  const [createdStatusFilter, setCreatedStatusFilter] = useState('Draft');
  const [assignedStatus, setAssignedStatus] = useState('open');

  const [processTasks, setProcessTasks] = useState([]);
  const [processTasksLoading, setProcessTasksLoading] = useState(false);
  const [taskCounts, setTaskCounts] = useState({ created: 0, assignedOpen: 0, assignedClosed: 0 });
  const [statusCounts, setStatusCounts] = useState(EMPTY_STATUS_COUNTS);

  const [selectedDraftIds, setSelectedDraftIds] = useState(() => new Set());
  const [deletingDrafts, setDeletingDrafts] = useState(false);
  /** Bumped when Kissflow popup closes / page params change — refreshes table + counts. */
  const [refreshTick, setRefreshTick] = useState(0);

  const loadStatusCounts = useCallback(async () => {
    if (!kfInstance?.api) return null;
    try {
      const hubCounts = await fetchUserHubTaskCounts(kfInstance);
      setTaskCounts({
        created: hubCounts.created,
        assignedOpen: hubCounts.assignedOpen,
        assignedClosed: hubCounts.assignedClosed,
      });
      if (hubCounts.statusCounts) setStatusCounts(hubCounts.statusCounts);
      return hubCounts;
    } catch {
      setTaskCounts({ created: 0, assignedOpen: 0, assignedClosed: 0 });
      return null;
    }
  }, [kfInstance]);

  const loadProcessTasks = useCallback(async () => {
    if (!kfInstance?.api) return;
    setProcessTasksLoading(true);
    try {
      // Counts first (cached) so Open/Closed list reuses activity steps.
      await loadStatusCounts();

      let result;
      if (taskScope === 'created') {
        result = await fetchMyCreatedTasksByStatus(kfInstance, createdStatusFilter, {
          page: 1,
          pageSize: HUB_TASK_PAGE_SIZE,
        });
      } else if (assignedStatus === 'open') {
        result = await fetchAssignedOpenProcessTasks(kfInstance, {
          page: 1,
          pageSize: HUB_TASK_PAGE_SIZE,
        });
      } else {
        result = await fetchAssignedClosedProcessTasks(kfInstance, {
          page: 1,
          pageSize: HUB_TASK_PAGE_SIZE,
        });
      }
      const { rows } = unwrapTaskPageResult(result);
      setProcessTasks(rows);
    } catch (e) {
      console.warn('UserHub tasks: fetch failed', e?.message || e);
      setProcessTasks([]);
    } finally {
      setProcessTasksLoading(false);
    }
  }, [kfInstance, taskScope, createdStatusFilter, assignedStatus, loadStatusCounts]);

  useEffect(() => {
    loadProcessTasks();
  }, [loadProcessTasks, refreshTick]);

  /** Kissflow fires watchParams when a popup action closes and updates page context. */
  useEffect(() => {
    if (!kfInstance?.context?.watchParams) return undefined;
    let timer = null;
    const unsub = kfInstance.context.watchParams(() => {
      // Short delay so submit has time to commit before we re-fetch.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setRefreshTick((n) => n + 1);
      }, 300);
    });
    return () => {
      if (timer) clearTimeout(timer);
      if (typeof unsub === 'function') unsub();
    };
  }, [kfInstance]);

  useEffect(() => {
    setSelectedDraftIds(new Set());
  }, [taskScope, createdStatusFilter, assignedStatus]);

  const handleTaskScopeChange = useCallback((scope) => {
    setTaskScope(scope);
    if (scope === 'assigned') setAssignedStatus('open');
    if (scope === 'created') setCreatedStatusFilter('Draft');
  }, []);

  const handleToggleRowSelect = useCallback((id) => {
    if (!id) return;
    setSelectedDraftIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleAllRowsSelect = useCallback((checked, pageRowIds) => {
    setSelectedDraftIds((prev) => {
      const next = new Set(prev);
      (pageRowIds || []).forEach((id) => {
        if (checked) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  }, []);

  const handleDeleteDrafts = useCallback(async () => {
    const ids = Array.from(selectedDraftIds).filter(Boolean);
    if (!ids.length || !kfInstance) return;
    const confirmed = window.confirm(`Delete ${ids.length} selected draft task(s)? This cannot be undone.`);
    if (!confirmed) return;

    setDeletingDrafts(true);
    try {
      const { successIds, failed } = await deleteTaskDraftRecords(kfInstance, ids);
      if (successIds.length) {
        setProcessTasks((prev) =>
          prev.filter((row) => !successIds.includes(resolveTaskDraftDeleteId(row))),
        );
        setSelectedDraftIds((prev) => {
          const next = new Set(prev);
          successIds.forEach((id) => next.delete(id));
          return next;
        });
        setStatusCounts((prev) => ({
          ...prev,
          Draft: Math.max(0, (prev.Draft || 0) - successIds.length),
        }));
        setTaskCounts((prev) => ({
          ...prev,
          created: Math.max(0, prev.created - successIds.length),
        }));
      }
      if (failed > 0) {
        window.alert(`${successIds.length} draft(s) deleted, ${failed} failed.`);
      } else if (successIds.length) {
        window.alert(`${successIds.length} draft(s) deleted successfully.`);
      }
    } catch (e) {
      console.warn('UserHub draft delete failed:', e?.message || e);
      window.alert('Delete failed. Please try again.');
    } finally {
      setDeletingDrafts(false);
    }
  }, [kfInstance, selectedDraftIds]);

  const showDraftBulkSelect = taskScope === 'created' && createdStatusFilter === 'Draft';

  const taskTableToolbar = useMemo(
    () => (
      <UserHubTaskToolbar
        taskScope={taskScope}
        onTaskScopeChange={handleTaskScopeChange}
        createdTotal={taskCounts.created}
        assignedTotal={taskCounts.assignedOpen + taskCounts.assignedClosed}
        createdStatusFilter={createdStatusFilter}
        onCreatedStatusChange={setCreatedStatusFilter}
        statusCounts={statusCounts}
        assignedStatus={assignedStatus}
        onAssignedStatusChange={setAssignedStatus}
        assignedOpenCount={taskCounts.assignedOpen}
        assignedClosedCount={taskCounts.assignedClosed}
        showDeleteDrafts={showDraftBulkSelect}
        selectedDraftCount={selectedDraftIds.size}
        deletingDrafts={deletingDrafts}
        onDeleteDrafts={handleDeleteDrafts}
      />
    ),
    [
      taskScope,
      handleTaskScopeChange,
      taskCounts,
      createdStatusFilter,
      statusCounts,
      assignedStatus,
      showDraftBulkSelect,
      selectedDraftIds.size,
      deletingDrafts,
      handleDeleteDrafts,
    ],
  );

  const scheduleRefreshAfterPopup = useCallback(() => {
    // Fallback when openPopup promise does settle (watchParams is primary).
    setTimeout(() => setRefreshTick((n) => n + 1), 300);
  }, []);

  const handleOpenTaskRow = useCallback(
    (row) => openUserHubTaskPopup(kfInstance, row, { onClosed: scheduleRefreshAfterPopup }),
    [kfInstance, scheduleRefreshAfterPopup],
  );

  /** Nested subtask create/open — Popup_WbcLURdUXx (UserHubTasks only). */
  const handleOpenSubtaskRow = useCallback(
    (row) => {
      openUserHubSubtaskPopup(kfInstance, row, { onClosed: scheduleRefreshAfterPopup });
    },
    [kfInstance, scheduleRefreshAfterPopup],
  );

  const handleCreateTask = useCallback(() => {
    openUserHubTaskCreatePopup(kfInstance, { onClosed: scheduleRefreshAfterPopup });
  }, [kfInstance, scheduleRefreshAfterPopup]);

  return (
    <div className="min-h-screen overflow-x-clip bg-gradient-to-b from-[#edf1ff] via-[#f6f8ff] to-[#f2ecff]">
      <div className="mx-auto min-w-0 max-w-[1800px] p-3 pb-6 sm:p-6">
        <ProjectDashboardPage
          useLayout={useLayout}
          scopeToCurrentUser
          scopeUser={scopeUser}
          contentView="tasks"
          overrideTasks={processTasks}
          overrideTasksLoading={processTasksLoading}
          overrideTasksForMetrics={processTasks}
          overrideTasksForMetricsLoading={processTasksLoading}
          hideUserScopeToggle
          hideWelcomeHeader
          embeddedInHub
          // Company / Business Functions filters are parked for now.
          // Comment out the line below to bring them back.
          hideCompanyFunctionFilters
          hubWelcome={{
            greeting,
            firstName,
            displayRole,
            email: scopeUser?.Email,
            subtitle: `Your tasks · ${displayRole}`,
          }}
          onCreateTaskRecord={handleCreateTask}
          taskTableToolbar={taskTableToolbar}
          onOpenTaskRow={handleOpenTaskRow}
          onOpenSubtaskRow={handleOpenSubtaskRow}
          taskBulkSelectEnabled={showDraftBulkSelect}
          taskSelectedRowIds={selectedDraftIds}
          onTaskToggleRowSelect={handleToggleRowSelect}
          onTaskToggleAllRowsSelect={handleToggleAllRowsSelect}
          getTaskRowSelectId={resolveTaskDraftDeleteId}
        />
      </div>
    </div>
  );
}
