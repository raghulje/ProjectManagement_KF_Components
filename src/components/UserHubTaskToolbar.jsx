/** LeadsManagementPage-style task toolbar for User Hub tasks page. */

function PrimaryTab({ active, onClick, label, count }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`min-h-[44px] rounded-xl px-3 text-sm font-semibold transition-all duration-200 touch-manipulation sm:min-h-[36px] sm:text-xs inline-flex items-center justify-center gap-2 ${
        active
          ? 'bg-white text-slate-800 shadow-md ring-1 ring-slate-300/80'
          : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
      }`}
    >
      <span className="leading-tight">{label}</span>
      {count != null && count > 0 ? (
        <span
          className={`inline-flex h-5 min-w-[1.375rem] items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums ${
            active
              ? 'bg-slate-100 text-slate-700'
              : 'border border-slate-200 bg-slate-50 text-slate-600'
          }`}
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </button>
  );
}

function StatusChip({ active, onClick, label, count }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[36px] shrink-0 rounded-xl border-2 px-2.5 py-1.5 text-xs font-medium transition-all duration-200 touch-manipulation inline-flex items-center gap-2 sm:min-h-[40px] sm:px-3 sm:text-sm ${
        active
          ? 'border-[#1E88E5] bg-[#1E88E5]/10 text-[#1E88E5]'
          : 'border-slate-300/80 bg-white/80 text-slate-700 hover:bg-white'
      }`}
    >
      <span className="max-w-[10rem] truncate">{label}</span>
      <span
        className={`shrink-0 rounded-lg px-1.5 py-0 text-[11px] font-bold tabular-nums sm:text-xs ${
          active ? 'bg-[#1E88E5]/15 text-[#1E88E5]' : 'bg-slate-100 text-slate-700'
        }`}
      >
        {count ?? 0}
      </span>
    </button>
  );
}

export default function UserHubTaskToolbar({
  taskScope,
  onTaskScopeChange,
  createdTotal,
  assignedTotal,
  createdStatusFilter,
  onCreatedStatusChange,
  statusCounts,
  assignedStatus,
  onAssignedStatusChange,
  assignedOpenCount,
  assignedClosedCount,
  showDeleteDrafts,
  selectedDraftCount,
  deletingDrafts,
  onDeleteDrafts,
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="grid w-full grid-cols-2 gap-1 rounded-2xl border border-slate-300/70 bg-white/70 p-1 shadow-sm sm:max-w-xl"
          role="tablist"
          aria-label="Task ownership"
        >
          <PrimaryTab
            active={taskScope === 'assigned'}
            onClick={() => onTaskScopeChange('assigned')}
            label="Tasks Assigned to me"
            count={assignedTotal}
          />
          <PrimaryTab
            active={taskScope === 'created'}
            onClick={() => onTaskScopeChange('created')}
            label="Tasks Created by Me"
            count={createdTotal}
          />
        </div>

        {showDeleteDrafts && selectedDraftCount > 0 ? (
          <button
            type="button"
            onClick={onDeleteDrafts}
            disabled={deletingDrafts}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[40px]"
          >
            <i className="ri-delete-bin-6-line shrink-0" aria-hidden />
            {deletingDrafts ? 'Deleting…' : `Delete (${selectedDraftCount})`}
          </button>
        ) : null}
      </div>

      {taskScope === 'created' ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:hidden">
            {['Draft', 'In progress', 'Completed', 'Withdrawn', 'Rejected'].map((status) => (
              <StatusChip
                key={status}
                active={createdStatusFilter === status}
                onClick={() => onCreatedStatusChange(status)}
                label={status}
                count={statusCounts?.[status] ?? 0}
              />
            ))}
          </div>
          <div className="hidden min-w-0 items-center gap-2 overflow-x-auto pr-1 sm:flex [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {['Draft', 'In progress', 'Completed', 'Withdrawn', 'Rejected'].map((status) => (
              <StatusChip
                key={status}
                active={createdStatusFilter === status}
                onClick={() => onCreatedStatusChange(status)}
                label={status}
                count={statusCounts?.[status] ?? 0}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusChip
            active={assignedStatus === 'open'}
            onClick={() => onAssignedStatusChange('open')}
            label="Open"
            count={assignedOpenCount}
          />
          <StatusChip
            active={assignedStatus === 'closed'}
            onClick={() => onAssignedStatusChange('closed')}
            label="Closed"
            count={assignedClosedCount}
          />
        </div>
      )}
    </div>
  );
}
