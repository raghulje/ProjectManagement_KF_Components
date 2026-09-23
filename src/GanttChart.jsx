import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { KissflowSDKContext, kf } from './sdk/index.js';
import {
  fetchProjectDashboardData,
  parseKfDate,
  isClosedProjectStatus,
  enrichProjectScheduleHealth,
  projectOwnedOrStewardedByUser,
} from './lib/kfProjectDashboard.js';
import {
  fetchTaskTrackerData,
  isTaskCompleted,
  resolveTaskBusinessIdFromRow,
  mapProcessSubtaskItem,
} from './lib/kfTaskTracker.js';
import { fetchAllSubtasks, filterSubtasksForTask } from './lib/kfProjectTrackerKarthika.js';
import {
  openGanttProjectPopup,
  openGanttTaskPopup,
  openGanttSubtaskPopup,
} from './lib/kfGanttPopups.js';
import {
  createAccessKeyKfClient,
  hasKissflowAccessKeys,
} from './lib/kfRuntime.js';
import { useUserHubSession } from './lib/useUserHubSession.js';
import UserHubWelcome from './components/UserHubWelcome.jsx';
import DashboardDetailModal from './components/DashboardDetailModal.jsx';
import {
  PT_BRAND,
  vmsPageClass,
  vmsPageInnerClass,
  vmsSectionShellClass,
  vmsSectionHeaderClass,
  vmsSectionTitleClass,
  vmsSectionSubtitleClass,
  vmsSearchInputClass,
  vmsGhostBtnClass,
} from './pm/ptTheme.js';

/** Completed work — emerald */
const COLOR_DONE = {
  solid: '#22C55E',
  soft: 'rgba(34, 197, 94, 0.14)',
  bar: 'linear-gradient(90deg, #34D399 0%, #22C55E 55%, #16A34A 100%)',
  ring: 'ring-emerald-500/25',
  text: 'text-[#16A34A]',
  chip: 'bg-emerald-50 text-[#16A34A] ring-1 ring-emerald-500/20',
};

/** Open / in-progress work — brand blue */
const COLOR_OPEN = {
  solid: PT_BRAND.DEFAULT,
  soft: 'rgba(30, 136, 229, 0.12)',
  bar: 'linear-gradient(90deg, #64B5F6 0%, #1E88E5 55%, #1565C0 100%)',
  ring: 'ring-[#1E88E5]/25',
  text: 'text-[#1565C0]',
  chip: 'bg-blue-50 text-[#1565C0] ring-1 ring-[#1E88E5]/20',
};

const RAG_STYLE = {
  Green: { label: 'On Track', className: 'bg-green-50 text-[#43A047] ring-1 ring-green-500/20' },
  Amber: { label: 'At Risk', className: 'bg-orange-50 text-[#FB8C00] ring-1 ring-orange-500/25' },
  Red: { label: 'Delayed', className: 'bg-red-50 text-[#E53935] ring-1 ring-red-500/20' },
};

const DAY_MS = 24 * 60 * 60 * 1000;
const LABEL_COL_PX = 240;

const SCALE_OPTIONS = [
  { id: 'day', label: 'Day', short: 'D', icon: 'ri-calendar-event-line' },
  { id: 'week', label: 'Week', short: 'W', icon: 'ri-calendar-check-line' },
  { id: 'month', label: 'Month', short: 'M', icon: 'ri-calendar-2-line' },
  { id: 'quarter', label: 'Quarter', short: 'Q', icon: 'ri-calendar-todo-line' },
  { id: 'half', label: 'Half', short: 'H', icon: 'ri-calendar-schedule-line' },
  { id: 'fy', label: 'FY', short: 'FY', icon: 'ri-calendar-line' },
];

const COL_PX = {
  day: 40,
  week: 72,
  month: 96,
  quarter: 120,
  half: 140,
  fy: 168,
};

const MAX_PERIODS = {
  day: 120,
  week: 78,
  month: 48,
  quarter: 24,
  half: 16,
  fy: 12,
};

const DEFAULT_SPAN_DAYS = {
  day: 28,
  week: 84,
  month: 180,
  quarter: 365,
  half: 540,
  fy: 730,
};

/**
 * Same ownership model as UserHubProjectsProject:
 * Project Owner, Business Owner, Sponsor, COS Owner, Developer, or creator.
 * Tasks/subtasks = all work linked to those projects.
 */
function scopeGanttToCurrentUser(projects, tasks, processSubtasks, user) {
  if (!user) {
    return { projects: [], tasks: [], processSubtasks: [] };
  }
  const myProjects = (Array.isArray(projects) ? projects : []).filter((p) =>
    projectOwnedOrStewardedByUser(user, p),
  );
  const seen = new Set();
  const myTasks = [];
  for (const project of myProjects) {
    for (const task of getTasksLinkedToProject(project, tasks)) {
      const key = resolveTaskBusinessIdFromRow(task) || String(task?.id ?? '').trim();
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      myTasks.push(task);
    }
  }
  const taskKeys = new Set(myTasks.map((t) => resolveTaskBusinessIdFromRow(t)).filter(Boolean));
  const myProcessSubtasks = (Array.isArray(processSubtasks) ? processSubtasks : []).filter((sub) => {
    const parentId = String(sub?.parentTaskBusinessId || '').trim();
    return parentId && taskKeys.has(parentId);
  });
  return {
    projects: myProjects,
    tasks: myTasks,
    processSubtasks: myProcessSubtasks,
  };
}

function resolveKf(kfInstance) {
  return (
    kfInstance ??
    (typeof window !== 'undefined' ? window.kf : null) ??
    (typeof kf !== 'undefined' ? kf : null)
  );
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function addMonths(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** India FY starts 1 Apr. */
function indiaFyStartYear(d) {
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

function startOfIndiaFy(startYear) {
  return new Date(startYear, 3, 1);
}

function endOfIndiaFy(startYear) {
  return new Date(startYear + 1, 2, 31);
}

function startOfIndiaHalf(d) {
  const fy = indiaFyStartYear(d);
  if (d.getMonth() >= 3 && d.getMonth() <= 8) return new Date(fy, 3, 1);
  if (d.getMonth() >= 9) return new Date(fy, 9, 1);
  return new Date(fy, 9, 1);
}

function endOfIndiaHalf(start) {
  if (start.getMonth() === 3) return new Date(start.getFullYear(), 8, 30);
  return new Date(start.getFullYear() + 1, 2, 31);
}

function startOfQuarter(d) {
  const q = Math.floor(d.getMonth() / 3) * 3;
  return new Date(d.getFullYear(), q, 1);
}

function endOfQuarter(start) {
  return addDays(addMonths(start, 3), -1);
}

function padRangeForMode(rangeStart, rangeEnd, mode) {
  let start = startOfDay(rangeStart);
  let end = startOfDay(rangeEnd);
  if (end < start) end = addDays(start, DEFAULT_SPAN_DAYS[mode] || 60);

  if (mode === 'day') {
    start = addDays(start, -2);
    end = addDays(end, 2);
  } else if (mode === 'week') {
    start = addDays(start, -3);
    end = addDays(end, 3);
  } else if (mode === 'month') {
    start = new Date(start.getFullYear(), start.getMonth(), 1);
    end = addDays(addMonths(new Date(end.getFullYear(), end.getMonth(), 1), 1), -1);
  } else if (mode === 'quarter') {
    start = startOfQuarter(start);
    end = endOfQuarter(startOfQuarter(end));
  } else if (mode === 'half') {
    start = startOfIndiaHalf(start);
    end = endOfIndiaHalf(startOfIndiaHalf(end));
  } else if (mode === 'fy') {
    start = startOfIndiaFy(indiaFyStartYear(start));
    end = endOfIndiaFy(indiaFyStartYear(end));
  }
  return { rangeStart: start, rangeEnd: end };
}

function collectDateRange(items, getStart, getEnd, mode) {
  const starts = [];
  const ends = [];
  for (const item of items) {
    const s = getStart(item);
    const e = getEnd(item);
    if (s) starts.push(s);
    if (e) ends.push(e);
  }
  let rangeStart = starts.length
    ? startOfDay(new Date(Math.min(...starts.map((d) => d.getTime()))))
    : startOfDay(new Date());
  let rangeEnd = ends.length
    ? startOfDay(new Date(Math.max(...ends.map((d) => d.getTime()))))
    : addDays(rangeStart, DEFAULT_SPAN_DAYS[mode] || 60);
  return padRangeForMode(rangeStart, rangeEnd, mode);
}

/** Build D1 / W1 / M1 / Q1 / H1 / FY periods covering [rangeStart, rangeEnd]. */
function buildTimelinePeriods(rangeStart, rangeEnd, mode) {
  const start = startOfDay(rangeStart);
  const end = startOfDay(rangeEnd);
  const max = MAX_PERIODS[mode] || 52;
  const periods = [];
  const shortMap = { day: 'D', week: 'W', month: 'M', quarter: 'Q', half: 'H', fy: 'FY' };
  const short = shortMap[mode] || 'P';

  if (!(start instanceof Date) || Number.isNaN(start.getTime())) return [];
  if (!(end instanceof Date) || Number.isNaN(end.getTime()) || end < start) {
    return [{ key: 'p1', label: `${short}1`, start, end: addDays(start, 6) }];
  }

  if (mode === 'day') {
    let cursor = new Date(start);
    let i = 1;
    while (cursor <= end && i <= max) {
      periods.push({
        key: `d${i}`,
        label: `D${i}`,
        subLabel: `${cursor.getDate()}/${cursor.getMonth() + 1}`,
        start: new Date(cursor),
        end: new Date(cursor),
      });
      cursor = addDays(cursor, 1);
      i += 1;
    }
  } else if (mode === 'week') {
    let cursor = new Date(start);
    let i = 1;
    while (cursor <= end && i <= max) {
      const periodEnd = addDays(cursor, 6);
      periods.push({
        key: `w${i}`,
        label: `W${i}`,
        subLabel: `${cursor.getDate()}/${cursor.getMonth() + 1}`,
        start: new Date(cursor),
        end: periodEnd > end ? end : periodEnd,
      });
      cursor = addDays(cursor, 7);
      i += 1;
    }
  } else if (mode === 'month') {
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    let i = 1;
    while (cursor <= end && i <= max) {
      const next = addMonths(cursor, 1);
      const periodEnd = addDays(next, -1);
      periods.push({
        key: `m${i}`,
        label: `M${i}`,
        subLabel: cursor.toLocaleString(undefined, { month: 'short', year: '2-digit' }),
        start: new Date(cursor),
        end: periodEnd > end ? end : periodEnd,
      });
      cursor = next;
      i += 1;
    }
  } else if (mode === 'quarter') {
    let cursor = startOfQuarter(start);
    let i = 1;
    while (cursor <= end && i <= max) {
      const periodEnd = endOfQuarter(cursor);
      const qNum = Math.floor(cursor.getMonth() / 3) + 1;
      periods.push({
        key: `q${i}`,
        label: `Q${i}`,
        subLabel: `Q${qNum} '${String(cursor.getFullYear()).slice(-2)}`,
        start: new Date(cursor),
        end: periodEnd > end ? end : periodEnd,
      });
      cursor = addMonths(cursor, 3);
      i += 1;
    }
  } else if (mode === 'half') {
    let cursor = startOfIndiaHalf(start);
    let i = 1;
    while (cursor <= end && i <= max) {
      const periodEnd = endOfIndiaHalf(cursor);
      const halfLabel = cursor.getMonth() === 3 ? 'H1' : 'H2';
      const fy = indiaFyStartYear(cursor);
      periods.push({
        key: `h${i}`,
        label: `H${i}`,
        subLabel: `${halfLabel} FY${String(fy).slice(-2)}`,
        start: new Date(cursor),
        end: periodEnd > end ? end : periodEnd,
      });
      cursor =
        cursor.getMonth() === 3
          ? new Date(cursor.getFullYear(), 9, 1)
          : new Date(cursor.getFullYear() + 1, 3, 1);
      i += 1;
    }
  } else {
    let fy = indiaFyStartYear(start);
    let i = 1;
    while (i <= max) {
      const fyStart = startOfIndiaFy(fy);
      const fyEnd = endOfIndiaFy(fy);
      if (fyStart > end) break;
      periods.push({
        key: `fy${i}`,
        label: `FY${i}`,
        subLabel: `FY${String(fy).slice(-2)}-${String(fy + 1).slice(-2)}`,
        start: fyStart < start ? start : fyStart,
        end: fyEnd > end ? end : fyEnd,
      });
      if (fyEnd >= end) break;
      fy += 1;
      i += 1;
    }
  }

  return periods;
}

function safeParseDate(value) {
  if (!value || value === '—') return null;
  return parseKfDate(value);
}

function projectEndDate(project) {
  return (
    safeParseDate(project?.revisedEndDate) ||
    safeParseDate(project?.previousEndDate) ||
    safeParseDate(project?.originalEndDate) ||
    safeParseDate(project?.plannedEndDate) ||
    null
  );
}

function projectStartDate(project) {
  return safeParseDate(project?.startDate) || null;
}

function taskStartDate(task) {
  return safeParseDate(task?.startDate) || safeParseDate(task?.raw?.Start_Date) || null;
}

function taskEndDate(task) {
  return (
    safeParseDate(task?.revisedEndDate) ||
    safeParseDate(task?.endDate) ||
    safeParseDate(task?.originalEndDate) ||
    safeParseDate(task?.raw?.End_Date) ||
    null
  );
}

function isWorkCompleted(item) {
  return isTaskCompleted(item?.status);
}

function getTasksLinkedToProject(project, allTasks) {
  const rows = Array.isArray(allTasks) ? allTasks : [];
  const pid = String(project?.id ?? '').trim();
  const pref = String(project?.displayId ?? '').trim();
  const pname = String(project?.name ?? '').trim();
  if (!pid && !pref && !pname) return [];

  return rows.filter((t) => {
    const tPid = String(
      t?.projectId ??
        t?.raw?.Project_ID?._item_id ??
        t?.raw?.Project_Lookup?._item_id ??
        '',
    ).trim();
    const tPref = String(
      t?.raw?.Project_ID?.Project_ID ??
        t?.raw?.Project_Lookup?.Project_ID ??
        t?.raw?.Project_ID_Details ??
        t?.projectRef ??
        '',
    ).trim();
    const tName = String(t?.projectName ?? '').trim();
    return (
      (tPid && pid && tPid === pid) ||
      (pref && tPref && tPref === pref) ||
      (pname && tName && tName === pname)
    );
  });
}

function computeWorkProgress(project, tasks, processSubtasks) {
  const linkedTasks = getTasksLinkedToProject(project, tasks);
  const subs = [];
  for (const task of linkedTasks) {
    const biz = resolveTaskBusinessIdFromRow(task);
    const nested = filterSubtasksForTask(processSubtasks, biz).map((s) =>
      s.taskName ? s : mapProcessSubtaskItem(s),
    );
    for (const sub of nested) subs.push(sub);
  }

  const workItems = [...linkedTasks, ...subs];
  const total = workItems.length;
  const completed = workItems.filter((w) => isWorkCompleted(w)).length;
  const open = Math.max(0, total - completed);

  if (isClosedProjectStatus(project?.status)) {
    return {
      progress: 100,
      total,
      completed: total || completed,
      open: 0,
      tasks: linkedTasks,
      subtasks: subs,
      workItems,
    };
  }
  if (total === 0) {
    return { progress: 0, total: 0, completed: 0, open: 0, tasks: linkedTasks, subtasks: subs, workItems };
  }
  return {
    progress: Math.round((completed / total) * 100),
    total,
    completed,
    open,
    tasks: linkedTasks,
    subtasks: subs,
    workItems,
  };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function dateToPercent(date, rangeStart, rangeEnd) {
  if (!date) return null;
  const a = rangeStart.getTime();
  const b = Math.max(a + DAY_MS, rangeEnd.getTime());
  return clamp(((startOfDay(date).getTime() - a) / (b - a)) * 100, 0, 100);
}

function barGeometry(itemStart, itemEnd, rangeStart, rangeEnd) {
  let s = itemStart || itemEnd;
  let e = itemEnd || itemStart;
  if (!s && !e) return null;
  if (s && e && e < s) {
    const tmp = s;
    s = e;
    e = tmp;
  }
  if (!e) e = addDays(s, 6);
  if (!s) s = addDays(e, -6);

  const left = dateToPercent(s, rangeStart, rangeEnd);
  const right = dateToPercent(e, rangeStart, rangeEnd);
  if (left == null || right == null) return null;
  const width = Math.max(1.8, right - left);
  return { left, width, start: s, end: e };
}

function formatShortDate(d) {
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function DualProgressTrack({ completed, open, total }) {
  const donePct = total > 0 ? (completed / total) * 100 : 0;
  const openPct = total > 0 ? (open / total) * 100 : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/80">
      <div className="flex h-full w-full">
        <div
          className="h-full transition-all duration-500"
          style={{ width: `${donePct}%`, background: COLOR_DONE.bar }}
          title={`${completed} completed`}
        />
        <div
          className="h-full transition-all duration-500"
          style={{ width: `${openPct}%`, background: COLOR_OPEN.bar }}
          title={`${open} open`}
        />
      </div>
    </div>
  );
}

function SegmentToggle({ value, onChange }) {
  return (
    <div className="inline-flex max-w-full flex-wrap items-stretch gap-0.5 overflow-hidden rounded-xl border border-slate-200 bg-slate-100/80 p-0.5">
      {SCALE_OPTIONS.map((opt) => {
        const selected = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            title={opt.label}
            className={`inline-flex items-center justify-center gap-1 rounded-[0.65rem] px-2 py-1.5 text-[10px] font-semibold leading-none transition sm:px-2.5 sm:text-[11px] ${
              selected
                ? 'bg-white text-[#1E62F0] shadow-sm'
                : 'text-slate-500 hover:bg-white/70 hover:text-slate-700'
            }`}
          >
            <i className={`${opt.icon} hidden sm:inline`} aria-hidden />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function PeriodHeader({ periods, colPx, label }) {
  return (
    <div className="sticky top-0 z-20 flex border-b border-slate-100 bg-slate-50/95 backdrop-blur-sm">
      <div
        className="sticky left-0 z-30 flex shrink-0 items-center border-r border-slate-200 bg-slate-50/95 px-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500"
        style={{ width: LABEL_COL_PX }}
      >
        {label}
      </div>
      <div className="relative flex" style={{ width: periods.length * colPx }}>
        {periods.map((p, idx) => (
          <div
            key={p.key}
            className={`flex flex-col items-center justify-center border-r border-slate-100 px-0.5 py-2 ${
              idx % 2 === 0 ? 'bg-white/40' : 'bg-blue-50/30'
            }`}
            style={{ width: colPx }}
          >
            <span className="text-[10px] font-bold tabular-nums text-[#1565C0] sm:text-[11px]">{p.label}</span>
            {p.subLabel ? (
              <span className="max-w-full truncate px-0.5 text-[8px] font-medium text-slate-400 sm:text-[9px]">
                {p.subLabel}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function PeriodGridBg({ periods, colPx }) {
  return periods.map((p, idx) => (
    <div
      key={`grid-${p.key}`}
      className={`absolute inset-y-0 border-r border-slate-100/80 ${idx % 2 === 0 ? '' : 'bg-blue-50/15'}`}
      style={{ left: idx * colPx, width: colPx }}
    />
  ));
}

function GanttBar({ item, kind, geometry, onClick, labelOverride }) {
  const done = kind === 'project' ? false : isWorkCompleted(item);
  const palette = kind === 'project' ? COLOR_OPEN : done ? COLOR_DONE : COLOR_OPEN;
  const name =
    labelOverride ||
    (kind === 'subtask'
      ? item.subtaskName || item.taskName || item.name || 'Subtask'
      : kind === 'project'
        ? item.name || 'Project'
        : item.taskName || item.name || 'Task');

  if (!geometry) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex max-w-full items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-semibold ring-1 ${palette.chip}`}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: palette.solid }} />
        <span className="truncate">{name}</span>
        <span className="opacity-70">· no dates</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${name} · ${formatShortDate(geometry.start)} → ${formatShortDate(geometry.end)}`}
      className={`absolute top-1/2 z-[1] flex h-8 -translate-y-1/2 items-center overflow-hidden rounded-lg px-2 text-left shadow-sm ring-1 transition hover:-translate-y-[55%] hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E88E5] ${palette.ring}`}
      style={{
        left: `${geometry.left}%`,
        width: `${geometry.width}%`,
        minWidth: 48,
        background: palette.bar,
      }}
    >
      <span className="truncate text-[10px] font-semibold text-white drop-shadow-sm">{name}</span>
    </button>
  );
}

function ProjectProgressBar({ project, stats, geometry, onClick }) {
  if (!geometry) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex max-w-full items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-semibold ring-1 ${COLOR_OPEN.chip}`}
      >
        {project.name || 'Project'} · no dates — click for tasks
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${project.name} · ${stats.progress}% · click for tasks & subtasks`}
      className="absolute top-1/2 z-[1] h-8 -translate-y-1/2 overflow-hidden rounded-xl text-left shadow-sm ring-1 ring-[#2B5AED]/25 transition hover:-translate-y-[55%] hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E88E5]"
      style={{
        left: `${geometry.left}%`,
        width: `${geometry.width}%`,
        minWidth: 64,
        background: 'linear-gradient(90deg, #93C5FD 0%, #2B5AED 100%)',
      }}
    >
      <div
        className="h-full"
        style={{ width: `${stats.progress}%`, background: COLOR_DONE.bar, opacity: 0.95 }}
      />
      <span className="pointer-events-none absolute inset-0 flex items-center gap-1.5 px-2 text-[10px] font-bold text-white drop-shadow">
        <span className="truncate">{project.name}</span>
        <span className="shrink-0 tabular-nums opacity-90">{stats.progress}%</span>
      </span>
    </button>
  );
}

/** Portfolio view — every project as a Gantt row. Click → drill into tasks/subtasks. */
function PortfolioGantt({ cards, scaleMode, onSelectProject, onOpenProject }) {
  const timeline = useMemo(() => {
    const range = collectDateRange(
      cards.map((c) => c.project),
      projectStartDate,
      projectEndDate,
      scaleMode,
    );
    const periods = buildTimelinePeriods(range.rangeStart, range.rangeEnd, scaleMode);
    return { ...range, periods };
  }, [cards, scaleMode]);

  const colPx = COL_PX[scaleMode] || 72;
  const gridWidth = Math.max(timeline.periods.length * colPx, 480);
  const scaleLabel = SCALE_OPTIONS.find((s) => s.id === scaleMode)?.label || scaleMode;

  return (
    <motion.div
      key="portfolio-gantt"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className={vmsSectionShellClass()}
    >
      <div className={vmsSectionHeaderClass('brand')}>
        <div className="min-w-0">
          <p className={vmsSectionSubtitleClass()}>Portfolio timeline</p>
          <h2 className={vmsSectionTitleClass()}>All projects</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Click a project bar or name to open its tasks &amp; subtasks · {scaleLabel}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold">
          <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 ${COLOR_DONE.chip}`}>
            <span className="h-2 w-2 rounded-sm" style={{ background: COLOR_DONE.solid }} />
            Completed share
          </span>
          <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 ${COLOR_OPEN.chip}`}>
            <span className="h-2 w-2 rounded-sm" style={{ background: COLOR_OPEN.solid }} />
            Open / remaining
          </span>
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <p className="text-sm font-semibold text-slate-700">No projects found</p>
          <p className="mt-1 text-xs text-slate-500">Try clearing search or refreshing data.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div style={{ minWidth: LABEL_COL_PX + gridWidth }}>
            <PeriodHeader periods={timeline.periods} colPx={colPx} label="Project" />
            {cards.map(({ project, stats }, rowIdx) => {
              const ragCfg = RAG_STYLE[project.rag] || RAG_STYLE.Green;
              const geo = barGeometry(
                projectStartDate(project),
                projectEndDate(project),
                timeline.rangeStart,
                timeline.rangeEnd,
              );
              return (
                <div
                  key={project.id || project.displayId || project.name}
                  className={`flex border-b border-slate-50 ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}
                >
                  <div
                    className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-slate-200 bg-inherit px-3 py-2.5"
                    style={{ width: LABEL_COL_PX }}
                  >
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => onSelectProject(project)}
                        className="block w-full truncate text-left text-[11px] font-semibold text-slate-800 hover:text-[#1E88E5] hover:underline"
                        title={`Open ${project.name}`}
                      >
                        {project.name || 'Untitled project'}
                      </button>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span className={`rounded px-1 py-px text-[9px] font-semibold ${ragCfg.className}`}>
                          {ragCfg.label}
                        </span>
                        <span className="text-[9px] tabular-nums text-slate-400">
                          {stats.completed}/{stats.total} · {stats.progress}%
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      title="Open in Kissflow"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenProject(project);
                      }}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-[#1E88E5]/40 hover:text-[#1E88E5]"
                    >
                      <i className="ri-external-link-line text-xs" aria-hidden />
                    </button>
                  </div>
                  <div className="relative h-14" style={{ width: gridWidth }}>
                    <PeriodGridBg periods={timeline.periods} colPx={colPx} />
                    <ProjectProgressBar
                      project={project}
                      stats={stats}
                      geometry={geo}
                      onClick={() => onSelectProject(project)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
}

/** Drill-down — tasks & nested subtasks for one project. */
function GanttTimeline({
  project,
  stats,
  scaleMode,
  onBack,
  onOpenProject,
  onOpenTask,
  onOpenSubtask,
}) {
  const timeline = useMemo(() => {
    const dated = [
      { s: projectStartDate(project), e: projectEndDate(project) },
      ...stats.tasks.map((t) => ({ s: taskStartDate(t), e: taskEndDate(t) })),
      ...stats.subtasks.map((s) => {
        const e = taskEndDate(s);
        return { s: e ? addDays(e, -5) : null, e };
      }),
    ];
    const range = collectDateRange(
      dated,
      (x) => x.s,
      (x) => x.e,
      scaleMode,
    );
    return { ...range, periods: buildTimelinePeriods(range.rangeStart, range.rangeEnd, scaleMode) };
  }, [project, stats, scaleMode]);

  const colPx = COL_PX[scaleMode] || 72;
  const gridWidth = Math.max(timeline.periods.length * colPx, 480);
  const scaleLabel = SCALE_OPTIONS.find((s) => s.id === scaleMode)?.label || scaleMode;

  const rows = useMemo(() => {
    const out = [];
    for (const task of stats.tasks) {
      const biz = resolveTaskBusinessIdFromRow(task);
      const nested = stats.subtasks.filter(
        (s) => String(s.parentTaskBusinessId || '').trim() === String(biz || '').trim(),
      );
      out.push({ kind: 'task', item: task, depth: 0 });
      for (const sub of nested) out.push({ kind: 'subtask', item: sub, depth: 1 });
    }
    return out;
  }, [stats]);

  return (
    <motion.div
      key={`gantt-${project.id}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.28 }}
      className={vmsSectionShellClass()}
    >
      <div className={vmsSectionHeaderClass('brand')}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <button type="button" onClick={onBack} className={vmsGhostBtnClass()} title="Back to portfolio">
              <i className="ri-arrow-left-line" aria-hidden />
              All projects
            </button>
            <div className="min-w-0">
              <p className={vmsSectionSubtitleClass()}>Tasks &amp; subtasks</p>
              <h2 className={`${vmsSectionTitleClass()} truncate`}>{project.name || 'Untitled project'}</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {project.displayId ? `${project.displayId} · ` : ''}
                {stats.completed}/{stats.total} completed · {stats.progress}% · {scaleLabel}
              </p>
            </div>
          </div>
          <button type="button" className={vmsGhostBtnClass()} onClick={() => onOpenProject(project)}>
            <i className="ri-external-link-line" aria-hidden />
            Open project
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="min-w-[12rem] flex-1">
            <DualProgressTrack completed={stats.completed} open={stats.open} total={stats.total} />
          </div>
          <div className="flex flex-wrap gap-2 text-[10px] font-semibold">
            <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 ${COLOR_DONE.chip}`}>
              <span className="h-2 w-2 rounded-sm" style={{ background: COLOR_DONE.solid }} />
              Completed
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 ${COLOR_OPEN.chip}`}>
              <span className="h-2 w-2 rounded-sm" style={{ background: COLOR_OPEN.solid }} />
              Open
            </span>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 text-[#1E88E5] ring-1 ring-slate-200">
            <i className="ri-task-line text-2xl" aria-hidden />
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-700">No tasks or subtasks yet</p>
          <p className="mt-1 text-xs text-slate-500">
            Progress will appear here once work items are linked to this project.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div style={{ minWidth: LABEL_COL_PX + gridWidth }}>
            <PeriodHeader periods={timeline.periods} colPx={colPx} label="Work item" />

            <div className="flex border-b border-slate-100 bg-gradient-to-r from-indigo-50/50 to-white">
              <div
                className="sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-0.5 border-r border-slate-200 bg-gradient-to-r from-indigo-50/80 to-white px-3 py-3"
                style={{ width: LABEL_COL_PX }}
              >
                <button
                  type="button"
                  onClick={() => onOpenProject(project)}
                  className="truncate text-left text-xs font-semibold text-[#2C3E50] hover:text-[#1E88E5] hover:underline"
                >
                  {project.name}
                </button>
                <span className="text-[10px] text-slate-500">{stats.progress}% complete</span>
              </div>
              <div className="relative h-14" style={{ width: gridWidth }}>
                <PeriodGridBg periods={timeline.periods} colPx={colPx} />
                <ProjectProgressBar
                  project={project}
                  stats={stats}
                  geometry={barGeometry(
                    projectStartDate(project),
                    projectEndDate(project),
                    timeline.rangeStart,
                    timeline.rangeEnd,
                  )}
                  onClick={() => onOpenProject(project)}
                />
              </div>
            </div>

            {rows.map(({ kind, item, depth }, rowIdx) => {
              const name =
                kind === 'subtask'
                  ? item.subtaskName || item.taskName || item.name || 'Subtask'
                  : item.taskName || item.name || 'Task';
              const done = isWorkCompleted(item);
              const palette = done ? COLOR_DONE : COLOR_OPEN;
              const geo = barGeometry(
                kind === 'subtask'
                  ? taskEndDate(item) && addDays(taskEndDate(item), -5)
                  : taskStartDate(item),
                taskEndDate(item),
                timeline.rangeStart,
                timeline.rangeEnd,
              );

              return (
                <div
                  key={`${kind}-${item.id || name}-${rowIdx}`}
                  className={`flex border-b border-slate-50 ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}
                >
                  <div
                    className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-slate-200 bg-inherit px-3 py-2.5"
                    style={{ width: LABEL_COL_PX, paddingLeft: 12 + depth * 14 }}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: palette.solid }}
                      aria-hidden
                    />
                    <button
                      type="button"
                      onClick={() => (kind === 'subtask' ? onOpenSubtask(item) : onOpenTask(item))}
                      className="min-w-0 truncate text-left text-[11px] font-semibold text-slate-700 hover:text-[#1E88E5] hover:underline"
                      title={name}
                    >
                      {depth > 0 ? <span className="mr-1 text-slate-300">└</span> : null}
                      {name}
                    </button>
                  </div>
                  <div className="relative h-12" style={{ width: gridWidth }}>
                    <PeriodGridBg periods={timeline.periods} colPx={colPx} />
                    <GanttBar
                      item={item}
                      kind={kind}
                      geometry={geo}
                      onClick={() => (kind === 'subtask' ? onOpenSubtask(item) : onOpenTask(item))}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
}

/**
 * GanttChart — user-scoped like UserHubProjectsProject
 * (owner / business owner / sponsor / COS / developer / creator).
 * Scale: Day / Week / Month / Quarter / Half / FY. Popups = Gantt-specific IDs.
 */
export default function GanttChart({
  kfInstance: kfProp = null,
  projects: projectsProp = null,
  tasks: tasksProp = null,
  processSubtasks: processSubtasksProp = null,
  onOpenProject: onOpenProjectProp = null,
  onOpenTask: onOpenTaskProp = null,
  onOpenSubtask: onOpenSubtaskProp = null,
  scopeToCurrentUser = true,
  hideWelcomeHeader = false,
}) {
  const { kfInstance: sessionFromHub, scopeUser, firstName, displayRole, greeting } = useUserHubSession();
  const { kf: kfFromContext } = useContext(KissflowSDKContext);
  const sessionKf = resolveKf(kfProp ?? sessionFromHub ?? kfFromContext);

  /** Same tenant credentials + account as ProjectDashboardPage (`kfAccessKeys` / AcCMptp3yqcn). */
  const kfInstance = useMemo(() => {
    if (sessionKf?.api && sessionKf?.account?._id) return sessionKf;
    if (hasKissflowAccessKeys(sessionKf)) {
      return createAccessKeyKfClient(sessionKf);
    }
    return sessionKf;
  }, [sessionKf]);

  const scopingUser = scopeUser || kfInstance?.user || null;

  const [loading, setLoading] = useState(!projectsProp);
  const [error, setError] = useState(null);
  const [apiProjects, setApiProjects] = useState([]);
  const [apiTasks, setApiTasks] = useState([]);
  const [apiProcessSubtasks, setApiProcessSubtasks] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [scaleMode, setScaleMode] = useState('month');
  const [detailModal, setDetailModal] = useState(null);

  const load = useCallback(async () => {
    if (projectsProp) return;

    if (!kfInstance?.api) {
      setLoading(false);
      setError('Kissflow SDK not available.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Same portfolio pipeline as ProjectDashboardPage.reloadDashboardData
      const [projectsRes, tasksRes, subsRes] = await Promise.allSettled([
        fetchProjectDashboardData(kfInstance),
        fetchTaskTrackerData(kfInstance, { enrichDetails: false }),
        fetchAllSubtasks(kfInstance, { enrichDetails: false }),
      ]);

      if (projectsRes.status === 'rejected') {
        console.warn('Gantt projects fetch failed:', projectsRes.reason);
      }
      if (tasksRes.status === 'rejected') {
        console.warn('Gantt tasks fetch failed:', tasksRes.reason);
      }
      if (subsRes.status === 'rejected') {
        console.warn('Gantt subtasks fetch failed:', subsRes.reason);
      }

      const rows =
        projectsRes.status === 'fulfilled'
          ? (projectsRes.value?.rows ?? []).map((p) => enrichProjectScheduleHealth(p))
          : [];
      const tasks = tasksRes.status === 'fulfilled' ? tasksRes.value ?? [] : [];
      const processSubtasks =
        subsRes.status === 'fulfilled'
          ? (subsRes.value?.items ?? []).map(mapProcessSubtaskItem)
          : [];

      setApiProjects(rows);
      setApiTasks(tasks);
      setApiProcessSubtasks(processSubtasks);

      if (projectsRes.status === 'rejected' && rows.length === 0) {
        setError(projectsRes.reason?.message || 'Failed to load projects.');
      }
    } catch (err) {
      console.warn('GanttChart load failed:', err);
      setError(err?.message || 'Failed to load timeline data.');
    } finally {
      setLoading(false);
    }
  }, [kfInstance, projectsProp]);

  useEffect(() => {
    void load();
  }, [load]);

  const projectsAll = projectsProp ?? apiProjects;
  const tasksAll = tasksProp ?? apiTasks;
  const processSubtasksAll = processSubtasksProp ?? apiProcessSubtasks;

  const scopedPortfolio = useMemo(() => {
    if (!scopeToCurrentUser) {
      return {
        projects: projectsAll,
        tasks: tasksAll,
        processSubtasks: processSubtasksAll,
      };
    }
    return scopeGanttToCurrentUser(projectsAll, tasksAll, processSubtasksAll, scopingUser);
  }, [scopeToCurrentUser, projectsAll, tasksAll, processSubtasksAll, scopingUser]);

  const projects = scopedPortfolio.projects;
  const tasks = scopedPortfolio.tasks;
  const processSubtasks = scopedPortfolio.processSubtasks;

  const enrichedCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (Array.isArray(projects) ? projects : [])
      .map((project) => {
        const stats = computeWorkProgress(project, tasks, processSubtasks);
        return { project, stats };
      })
      .filter(({ project }) => {
        if (!q) return true;
        const hay = `${project.name || ''} ${project.displayId || ''} ${project.owner || ''}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => String(a.project.name || '').localeCompare(String(b.project.name || '')));
  }, [projects, tasks, processSubtasks, search]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return enrichedCards.find((c) => String(c.project.id) === String(selectedId)) || null;
  }, [enrichedCards, selectedId]);

  const openProject = useCallback(
    async (row) => {
      if (!row) return;
      if (typeof onOpenProjectProp === 'function') {
        const result = await onOpenProjectProp(row, kfInstance);
        if (result !== false) return;
      } else if (openGanttProjectPopup(kfInstance, row)) {
        return;
      }
      setDetailModal({ type: 'project', row });
    },
    [onOpenProjectProp, kfInstance],
  );

  const openTask = useCallback(
    async (row) => {
      if (!row) return;
      if (typeof onOpenTaskProp === 'function') {
        const result = await onOpenTaskProp(row, kfInstance);
        if (result !== false) return;
      } else {
        const opened = await openGanttTaskPopup(kfInstance, row);
        if (opened) return;
      }
      setDetailModal({ type: 'task', row });
    },
    [onOpenTaskProp, kfInstance],
  );

  const openSubtask = useCallback(
    async (row) => {
      if (!row) return;
      if (typeof onOpenSubtaskProp === 'function') {
        const result = await onOpenSubtaskProp(row, kfInstance);
        if (result !== false) return;
      } else {
        const opened = await openGanttSubtaskPopup(kfInstance, row);
        if (opened) return;
      }
      setDetailModal({ type: 'subtask', row });
    },
    [onOpenSubtaskProp, kfInstance],
  );

  const totals = useMemo(() => {
    let completed = 0;
    let open = 0;
    for (const { stats } of enrichedCards) {
      completed += stats.completed;
      open += stats.open;
    }
    return { completed, open, projects: enrichedCards.length };
  }, [enrichedCards]);

  return (
    <div className={vmsPageClass}>
      <div className={vmsPageInnerClass}>
        {!hideWelcomeHeader ? (
          <div className="mb-3 sm:mb-4">
            <UserHubWelcome
              greeting={greeting}
              firstName={firstName}
              displayRole={displayRole}
              email={scopeUser?.Email || kfInstance?.user?.Email}
              subtitle={`Your projects timeline · ${displayRole || 'User'}`}
            />
          </div>
        ) : null}

        <header className="mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1E88E5]">
              Timeline
            </p>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-[#2C3E50] sm:text-2xl">
              My Project Gantt
            </h1>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Scale
              </span>
              <SegmentToggle value={scaleMode} onChange={setScaleMode} />
            </label>
            <div className="relative min-w-[12rem] flex-1 sm:flex-none sm:w-56">
              <i className="ri-search-line absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-[#7F8C8D]" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects…"
                className={vmsSearchInputClass()}
              />
            </div>
            <button type="button" className={vmsGhostBtnClass()} onClick={() => void load()} disabled={loading}>
              <i className={`ri-refresh-line ${loading ? 'animate-spin' : ''}`} aria-hidden />
              Refresh
            </button>
          </div>
        </header>

        {/* Legend / summary strip */}
        <div className={`${vmsSectionShellClass()} mb-4 px-4 py-3 sm:px-5`}>
          <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <i className="ri-folder-3-line text-[#1E88E5]" aria-hidden />
              {totals.projects} projects
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 ${COLOR_DONE.chip}`}>
              <span className="h-2 w-2 rounded-sm" style={{ background: COLOR_DONE.solid }} />
              {totals.completed} completed
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 ${COLOR_OPEN.chip}`}>
              <span className="h-2 w-2 rounded-sm" style={{ background: COLOR_OPEN.solid }} />
              {totals.open} open
            </span>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {loading && !projectsProp ? (
          <div className={`${vmsSectionShellClass()} h-72 animate-pulse bg-white/80`} />
        ) : (
          <AnimatePresence mode="wait">
            {selected ? (
              <GanttTimeline
                key="timeline"
                project={selected.project}
                stats={selected.stats}
                scaleMode={scaleMode}
                onBack={() => setSelectedId(null)}
                onOpenProject={openProject}
                onOpenTask={openTask}
                onOpenSubtask={openSubtask}
              />
            ) : (
              <PortfolioGantt
                key="portfolio"
                cards={enrichedCards}
                scaleMode={scaleMode}
                onSelectProject={(p) => setSelectedId(p.id)}
                onOpenProject={openProject}
              />
            )}
          </AnimatePresence>
        )}
      </div>

      <DashboardDetailModal
        detail={detailModal}
        onClose={() => setDetailModal(null)}
        viewerName={kfInstance?.user?.Name || 'User'}
      />
    </div>
  );
}
