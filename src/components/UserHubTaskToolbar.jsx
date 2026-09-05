/** LeadsManagementPage-style task toolbar for User Hub tasks page. */

/** "Tasks Assigned to me" → "Assigned to me" (mobile keeps tabs on one line). */
function toShortLabel(label) {
  const short = String(label || '').replace(/^(sub)?tasks\s+/i, '');
  if (!short) return label;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

function PrimaryTab({ active, onClick, label, count }) {
  const shortLabel = toShortLabel(label);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`min-h-[40px] rounded-xl px-2 text-xs font-semibold transition-all duration-200 touch-manipulation sm:min-h-[36px] sm:px-3 inline-flex min-w-0 items-center justify-center gap-1.5 sm:gap-2 ${
        active
          ? 'bg-white text-slate-800 shadow-md ring-1 ring-slate-300/80'
          : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
      }`}
    >
      <span className="min-w-0 truncate leading-tight sm:hidden">{shortLabel}</span>
      <span className="hidden min-w-0 truncate leading-tight sm:inline">{label}</span>
      {count != null && count > 0 ? (
        <span
          className={`inline-flex h-5 min-w-[1.375rem] shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums sm:text-[11px] ${
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
      className={`min-h-[38px] min-w-0 shrink-0 rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition-all duration-200 touch-manipulation inline-flex items-center justify-center gap-1.5 sm:min-h-[40px] sm:border-2 sm:px-3 sm:text-sm ${
        active
          ? 'border-[#1E88E5] bg-[#1E88E5]/10 text-[#1E88E5]'
          : 'border-slate-300/80 bg-white/80 text-slate-700 hover:bg-white'
      }`}
    >
      <span className="min-w-0 max-w-[10rem] truncate">{label}</span>
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
  assignedLabel = 'Tasks Assigned to me',
  createdLabel = 'Tasks Created by Me',
  ownershipAriaLabel = 'Task ownership',
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div
          className="grid w-full min-w-0 grid-cols-2 gap-1 rounded-xl border border-slate-300/70 bg-white/70 p-1 shadow-sm sm:max-w-xl sm:rounded-2xl"
          role="tablist"
          aria-label={ownershipAriaLabel}
        >
          <PrimaryTab
            active={taskScope === 'assigned'}
            onClick={() => onTaskScopeChange('assigned')}
            label={assignedLabel}
            count={assignedTotal}
          />
          <PrimaryTab
            active={taskScope === 'created'}
            onClick={() => onTaskScopeChange('created')}
            label={createdLabel}
            count={createdTotal}
          />
        </div>

        {showDeleteDrafts && selectedDraftCount > 0 ? (
          <button
            type="button"
            onClick={onDeleteDrafts}
            disabled={deletingDrafts}
            className="inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:text-sm"
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
