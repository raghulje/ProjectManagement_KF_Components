/**
 * Shared nested-subtask row for task accordions across dashboards.
 * Shows SubTask_Summary + Assignee_1 + Created by (never Kissflow Name / Pk id).
 */

export function formatSubtaskDisplayFields(sub) {
  const raw = sub?.raw && typeof sub.raw === 'object' ? sub.raw : {};
  const summary = String(
    sub?.summary ||
      raw?.SubTask_Summary ||
      sub?.taskName ||
      sub?.name ||
      sub?.subtaskName ||
      '',
  ).trim();
  const assignee = String(
    sub?.assignedTo ||
      sub?.assigneeName ||
      raw?.Assignee_1?.Name ||
      sub?.people?.[0]?.name ||
      '',
  ).trim() || '—';
  const createdBy = String(
    sub?.createdBy ||
      raw?._created_by?.Name ||
      '',
  ).trim() || '—';

  return {
    summary: summary || 'Untitled subtask',
    assignee,
    createdBy,
    status: sub?.status || raw?._status || '—',
  };
}

export default function SubtaskAccordionRow({
  sub,
  onClick,
  statusSlot = null,
  compact = false,
  className = '',
}) {
  const { summary, assignee, createdBy } = formatSubtaskDisplayFields(sub);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white text-left transition hover:bg-slate-50 ${
        compact ? 'px-2.5 py-2' : 'px-3 py-2.5'
      } ${className}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <i className={`ri-node-tree shrink-0 text-[#FB8C00] ${compact ? 'text-sm' : 'text-sm'}`} aria-hidden />
        <div className="min-w-0">
          <p className={`truncate font-medium text-[#2C3E50] ${compact ? 'text-[11px]' : 'text-[12px] sm:text-sm'}`}>
            {summary}
          </p>
          <p className={`truncate text-[#7F8C8D] ${compact ? 'text-[10px]' : 'text-[10px] sm:text-xs'}`}>
            Assignee {assignee}
            <span className="text-slate-300"> · </span>
            Created by {createdBy}
          </p>
        </div>
      </div>
      {statusSlot}
    </button>
  );
}
