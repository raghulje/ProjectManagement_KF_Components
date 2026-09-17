/** Export one project accordion (project + tasks + subtasks) as CSV or PNG. */

function csvEscape(value) {
  const s = value == null || value === '—' ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function sanitizeFilename(name) {
  return String(name || 'project')
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'project';
}

function todayStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function text(value) {
  if (value == null || value === '') return '—';
  return String(value);
}

export function collectProjectExportRows(project, tasks, processSubtasks, filterSubtasksForTask, resolveTaskId) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const subPool = Array.isArray(processSubtasks) ? processSubtasks : [];

  const taskRows = taskList.map((task) => {
    const children = typeof filterSubtasksForTask === 'function'
      ? filterSubtasksForTask(subPool, resolveTaskId?.(task) || task?.taskId || task?.id)
      : [];
    return { task, subtasks: Array.isArray(children) ? children : [] };
  });

  return {
    project,
    taskRows,
    filenameBase: sanitizeFilename(
      `${project?.name || 'project'}-${project?.displayId || project?.id || ''}`.trim(),
    ),
  };
}

export function buildProjectExportCsv(bundle) {
  const p = bundle.project || {};
  const lines = [];

  lines.push('PROJECT');
  lines.push(['Field', 'Value'].map(csvEscape).join(','));
  const projectFields = [
    ['Project name', p.name],
    ['Project ID', p.displayId || p.id],
    ['Owner', p.owner],
    ['Business owner', p.businessOwner],
    ['Company', p.companyName],
    ['Business function', p.lineOfBusiness],
    ['Function type', p.functionType],
    ['Status', p.status],
    ['RAG', p.rag],
    ['Priority', p.priority],
    ['Start date', p.startDate],
    ['End date', p.originalEndDate || p.plannedEndDate],
    ['Revised end date', p.revisedEndDate],
    ['Progress %', p.progress],
    ['Delay days', p.delayDays],
    ['Created', p.createdAt],
    ['Closed', p.closedAt],
  ];
  for (const [k, v] of projectFields) lines.push([k, text(v)].map(csvEscape).join(','));

  lines.push('');
  lines.push('TASKS');
  lines.push(
    ['Task name', 'Task ID', 'Assignee', 'Start date', 'End date', 'Revised', 'Status', 'Priority', 'Delay days', 'Project']
      .map(csvEscape)
      .join(','),
  );
  for (const { task } of bundle.taskRows) {
    lines.push(
      [
        task.taskName,
        task.taskId || task.id,
        task.assignedTo,
        task.startDate,
        task.endDate,
        task.revisedCount ? `${task.revisedCount}x` : '',
        task.status,
        task.priority,
        task.delayDays,
        task.projectName,
      ].map((v) => csvEscape(text(v))).join(','),
    );
  }

  lines.push('');
  lines.push('SUBTASKS');
  lines.push(
    ['Parent task', 'Subtask', 'Assignee', 'Created by', 'Status', 'End date', 'Parent task ID']
      .map(csvEscape)
      .join(','),
  );
  for (const { task, subtasks } of bundle.taskRows) {
    for (const sub of subtasks) {
      lines.push(
        [
          task.taskName,
          sub.subtaskName || sub.taskName || sub.name,
          sub.assignedTo || sub.assignee,
          sub.createdBy,
          sub.status,
          sub.endDate,
          task.taskId || task.id,
        ].map((v) => csvEscape(text(v))).join(','),
      );
    }
  }

  return `${lines.join('\r\n')}\r\n`;
}

export function downloadProjectExportCsv(bundle) {
  const csv = buildProjectExportCsv(bundle);
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  downloadBlob(`${bundle.filenameBase}-${todayStamp()}.csv`, blob);
}

function formatExportDate(value) {
  const raw = text(value);
  if (raw === '—') return '—';
  const cleaned = raw.replace(/\s+[A-Za-z_/]+$/, '').replace(/,/g, '');
  const d = new Date(cleaned);
  if (Number.isNaN(d.getTime())) {
    const m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : raw;
  }
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('');
}

function ragTone(rag) {
  const s = String(rag || '').toLowerCase();
  if (s.includes('red') || s.includes('delay')) return { bg: '#FEE2E2', fg: '#B91C1C', label: 'Delayed', bar: '#E53935' };
  if (s.includes('amber') || s.includes('risk')) return { bg: '#FFEDD5', fg: '#C2410C', label: 'At risk', bar: '#FB8C00' };
  return { bg: '#DCFCE7', fg: '#15803D', label: 'On track', bar: '#43A047' };
}

function statusTone(status) {
  const s = String(status || '').toLowerCase();
  if (s.includes('complete') || s.includes('closed') || s === 'done') {
    return { bg: '#DCFCE7', fg: '#15803D' };
  }
  if (s.includes('progress') || s.includes('review')) {
    return { bg: '#DBEAFE', fg: '#1D4ED8' };
  }
  if (s.includes('overdue') || s.includes('delay')) {
    return { bg: '#FEE2E2', fg: '#B91C1C' };
  }
  if (s.includes('hold') || s.includes('block')) {
    return { bg: '#FFEDD5', fg: '#C2410C' };
  }
  return { bg: '#E0E7FF', fg: '#3730A3' };
}

function delayTone(days) {
  const n = Number(days) || 0;
  if (n > 0) return { bg: '#FEE2E2', fg: '#B91C1C', label: `+${n}d delay` };
  return { bg: '#ECFDF5', fg: '#047857', label: 'On time' };
}

function ellipsize(ctx, value, maxWidth) {
  const raw = text(value);
  if (ctx.measureText(raw).width <= maxWidth) return raw;
  let out = raw;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, w, h, r, fill) {
  ctx.fillStyle = fill;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
}

function strokeRoundRect(ctx, x, y, w, h, r, stroke, lineWidth = 1) {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  roundRect(ctx, x, y, w, h, r);
  ctx.stroke();
}

function drawBadge(ctx, x, y, label, tone) {
  ctx.font = '600 11px Segoe UI, Arial, sans-serif';
  const padX = 10;
  const w = Math.ceil(ctx.measureText(label).width) + padX * 2;
  const h = 22;
  fillRoundRect(ctx, x, y, w, h, 11, tone.bg);
  ctx.fillStyle = tone.fg;
  ctx.fillText(label, x + padX, y + 15);
  return w;
}

function drawAvatar(ctx, x, y, name) {
  const initials = initialsOf(name);
  ctx.beginPath();
  ctx.arc(x + 11, y + 11, 11, 0, Math.PI * 2);
  ctx.fillStyle = '#1E62F0';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 9px Segoe UI, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(initials, x + 11, y + 14);
  ctx.textAlign = 'left';
}

function drawProgress(ctx, x, y, w, pct) {
  const value = Math.max(0, Math.min(100, Number(pct) || 0));
  fillRoundRect(ctx, x, y, w, 8, 4, '#E2E8F0');
  if (value > 0) fillRoundRect(ctx, x, y, Math.max(8, (w * value) / 100), 8, 4, '#1E88E5');
}

/** Browser canvas limits — Chrome area ~16M px; keep headroom for encoding. */
const PNG_MAX_CANVAS_AREA = 14_000_000;
const PNG_MAX_DIMENSION = 8192;
const PNG_WIDTH = 1400;
const PNG_PAGE_PAD = 36;
const PNG_TASK_BODY = 92;
const PNG_SUB_HEADER = 36;
const PNG_SUB_ROW = 44;
const PNG_CARD_GAP = 14;
const PNG_FOOTER = 48;
const PNG_FIRST_HEADER = 380;
const PNG_CONT_HEADER = 96;

function measureTaskCardHeight(subCount) {
  const n = Math.max(0, Number(subCount) || 0);
  return PNG_TASK_BODY + (n > 0 ? PNG_SUB_HEADER + n * PNG_SUB_ROW : 0);
}

function pickPngScale(cssHeight) {
  for (const scale of [2, 1.5, 1]) {
    const w = Math.ceil(PNG_WIDTH * scale);
    const h = Math.ceil(cssHeight * scale);
    if (w <= PNG_MAX_DIMENSION && h <= PNG_MAX_DIMENSION && w * h <= PNG_MAX_CANVAS_AREA) {
      return scale;
    }
  }
  return 1;
}

function maxCssPageHeight(scale) {
  const canvasW = Math.ceil(PNG_WIDTH * scale);
  const byArea = Math.floor(PNG_MAX_CANVAS_AREA / canvasW);
  const byDim = Math.floor(PNG_MAX_DIMENSION / scale);
  return Math.max(900, Math.min(byArea, byDim) - 8);
}

/**
 * Split tasks into page chunks that fit browser canvas limits.
 * Oversized task cards (many subtasks) are split across pages.
 */
function buildPngPages(taskRows) {
  const pages = [];
  let pageIndex = 0;
  let blocks = [];
  let used = PNG_FIRST_HEADER;

  const maxFor = (isFirst) => {
    // Prefer scale 2 when possible; page packing uses scale-1 budget so pages stay safe.
    const scale = pickPngScale(isFirst ? PNG_FIRST_HEADER + 400 : PNG_CONT_HEADER + 400);
    return maxCssPageHeight(scale) - PNG_FOOTER - (isFirst ? PNG_FIRST_HEADER : PNG_CONT_HEADER);
  };

  const pushPage = () => {
    if (!blocks.length) return;
    pages.push({ isFirst: pageIndex === 0, blocks });
    pageIndex += 1;
    blocks = [];
    used = PNG_CONT_HEADER;
  };

  taskRows.forEach((row, taskIndex) => {
    const task = row.task || {};
    const subs = Array.isArray(row.subtasks) ? row.subtasks : [];
    let subOffset = 0;

    while (subOffset <= subs.length) {
      const isFirstPage = pages.length === 0 && blocks.length === 0;
      const budget = maxFor(isFirstPage);
      const remaining = Math.max(180, budget - used);

      const headerOnly = measureTaskCardHeight(0);
      const roomForSubs =
        remaining <= headerOnly
          ? 0
          : Math.max(0, Math.floor((remaining - PNG_TASK_BODY - PNG_SUB_HEADER) / PNG_SUB_ROW));

      let take = 0;
      if (subs.length === 0 && subOffset === 0) {
        take = 0;
      } else if (subOffset === 0 && remaining < headerOnly + PNG_CARD_GAP) {
        pushPage();
        continue;
      } else if (subOffset === 0) {
        take = Math.min(subs.length, roomForSubs);
        // If card still won't fit even with 0 subs, force a new page once.
        if (take === 0 && subs.length > 0 && remaining < headerOnly + PNG_SUB_HEADER + PNG_SUB_ROW) {
          if (blocks.length) {
            pushPage();
            continue;
          }
          take = Math.min(subs.length, Math.max(1, roomForSubs || 1));
        }
      } else {
        // Continuation of subtasks for same task — need at least one row if possible.
        if (remaining < headerOnly + PNG_SUB_HEADER + PNG_SUB_ROW && blocks.length) {
          pushPage();
          continue;
        }
        const contRoom = Math.max(
          1,
          Math.floor((remaining - PNG_TASK_BODY - PNG_SUB_HEADER) / PNG_SUB_ROW),
        );
        take = Math.min(subs.length - subOffset, contRoom);
      }

      const slice = subs.slice(subOffset, subOffset + take);
      const cardH = measureTaskCardHeight(slice.length);
      if (used + cardH + PNG_CARD_GAP > budget && blocks.length) {
        pushPage();
        continue;
      }

      blocks.push({
        task,
        taskIndex,
        subtasks: slice,
        subOffset,
        subTotal: subs.length,
        continued: subOffset > 0,
      });
      used += cardH + PNG_CARD_GAP;
      subOffset += take;

      if (subOffset >= subs.length) break;
      // More subtasks remain — next loop iteration starts a new chunk (often new page).
      if (blocks.length && used + headerOnly + PNG_SUB_HEADER + PNG_SUB_ROW > budget) {
        pushPage();
      }
    }
  });

  pushPage();
  if (!pages.length) {
    pages.push({ isFirst: true, blocks: [] });
  }
  return pages;
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    if (!canvas || typeof canvas.toBlob !== 'function') {
      reject(new Error('Could not create PNG — canvas unavailable'));
      return;
    }
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(
            new Error(
              'Could not create PNG — image too large for this browser. Try Excel (CSV) for full data.',
            ),
          );
          return;
        }
        resolve(blob);
      }, 'image/png');
    } catch (err) {
      reject(
        new Error(
          err?.message ||
            'Could not create PNG — image too large for this browser. Try Excel (CSV) for full data.',
        ),
      );
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function drawPngPage(bundle, page, pageNumber, pageCount) {
  const p = bundle.project || {};
  const taskRows = Array.isArray(bundle.taskRows) ? bundle.taskRows : [];
  const totalSubs = taskRows.reduce((n, row) => n + (row.subtasks?.length || 0), 0);
  const width = PNG_WIDTH;
  const pagePad = PNG_PAGE_PAD;
  const contentW = width - pagePad * 2;
  const rag = ragTone(p.rag);
  const status = statusTone(p.status);
  const delay = delayTone(p.delayDays);
  const progress = Math.max(0, Math.min(100, Number(p.progress) || 0));

  let contentH = page.isFirst ? PNG_FIRST_HEADER : PNG_CONT_HEADER;
  for (const block of page.blocks) {
    contentH += measureTaskCardHeight(block.subtasks.length) + PNG_CARD_GAP;
  }
  contentH += PNG_FOOTER;
  const height = Math.max(page.isFirst ? 720 : 520, contentH + pagePad);
  const scale = pickPngScale(height);

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error(
      'Could not create PNG — canvas limit reached. Try Excel (CSV) for full data.',
    );
  }
  ctx.scale(scale, scale);
  ctx.textBaseline = 'alphabetic';

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, '#EEF3FF');
  bg.addColorStop(0.18, '#F8FAFF');
  bg.addColorStop(1, '#F1F5F9');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  fillRoundRect(ctx, 0, 0, width, 8, 0, '#1E62F0');

  let y = pagePad;

  ctx.fillStyle = '#64748B';
  ctx.font = '700 11px Segoe UI, Arial, sans-serif';
  ctx.fillText('PROJECT HEALTH REPORT', pagePad, y + 12);
  ctx.textAlign = 'right';
  ctx.font = '500 11px Segoe UI, Arial, sans-serif';
  const pageLabel =
    pageCount > 1 ? `Page ${pageNumber} of ${pageCount}  ·  Exported ${todayStamp()}` : `Exported ${todayStamp()}`;
  ctx.fillText(pageLabel, width - pagePad, y + 12);
  ctx.textAlign = 'left';
  y += 28;

  if (page.isFirst) {
    ctx.fillStyle = '#0F172A';
    ctx.font = '700 30px Segoe UI, Arial, sans-serif';
    ctx.fillText(ellipsize(ctx, p.name, contentW - 280), pagePad, y + 26);
    let badgeX = width - pagePad;
    const badges = [
      { label: text(p.status), tone: status },
      { label: rag.label, tone: rag },
      { label: delay.label, tone: delay },
    ];
    for (let i = badges.length - 1; i >= 0; i -= 1) {
      ctx.font = '600 11px Segoe UI, Arial, sans-serif';
      const w = Math.ceil(ctx.measureText(badges[i].label).width) + 20;
      badgeX -= w;
      drawBadge(ctx, badgeX, y + 4, badges[i].label, badges[i].tone);
      badgeX -= 8;
    }
    y += 40;

    ctx.fillStyle = '#64748B';
    ctx.font = '500 13px Segoe UI, Arial, sans-serif';
    ctx.fillText(text(p.displayId || p.id), pagePad, y + 8);
    y += 28;

    fillRoundRect(ctx, pagePad, y, contentW, 148, 18, '#FFFFFF');
    strokeRoundRect(ctx, pagePad, y, contentW, 148, 18, '#E2E8F0');

    const metrics = [
      { label: 'OWNER', value: text(p.owner), person: true },
      { label: 'START', value: formatExportDate(p.startDate) },
      { label: 'END DATE', value: formatExportDate(p.originalEndDate || p.plannedEndDate) },
      { label: 'REVISED', value: formatExportDate(p.revisedEndDate) },
      { label: 'PRIORITY', value: text(p.priority) },
      { label: 'COMPANY', value: text(p.companyName) },
      { label: 'FUNCTION', value: text(p.lineOfBusiness) },
      { label: 'CREATED', value: formatExportDate(p.createdAt) },
    ];
    const colW = contentW / 4;
    metrics.forEach((item, idx) => {
      const col = idx % 4;
      const row = Math.floor(idx / 4);
      const mx = pagePad + 18 + col * colW;
      const my = y + 18 + row * 64;
      ctx.fillStyle = '#94A3B8';
      ctx.font = '700 10px Segoe UI, Arial, sans-serif';
      ctx.fillText(item.label, mx, my + 10);
      if (item.person) {
        drawAvatar(ctx, mx, my + 18, item.value);
        ctx.fillStyle = '#0F172A';
        ctx.font = '600 14px Segoe UI, Arial, sans-serif';
        ctx.fillText(ellipsize(ctx, item.value, colW - 54), mx + 30, my + 34);
      } else {
        ctx.fillStyle = '#0F172A';
        ctx.font = '600 14px Segoe UI, Arial, sans-serif';
        ctx.fillText(ellipsize(ctx, item.value, colW - 28), mx, my + 34);
      }
    });
    y += 164;

    fillRoundRect(ctx, pagePad, y, contentW, 44, 14, '#FFFFFF');
    strokeRoundRect(ctx, pagePad, y, contentW, 44, 14, '#E2E8F0');
    ctx.fillStyle = '#64748B';
    ctx.font = '700 10px Segoe UI, Arial, sans-serif';
    ctx.fillText('PROGRESS', pagePad + 18, y + 16);
    ctx.fillStyle = '#0F172A';
    ctx.font = '700 13px Segoe UI, Arial, sans-serif';
    ctx.fillText(`${progress}%`, pagePad + 18, y + 34);
    drawProgress(ctx, pagePad + 90, y + 18, contentW - 320, progress);
    ctx.fillStyle = '#64748B';
    ctx.font = '500 12px Segoe UI, Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(
      `${taskRows.length} tasks  ·  ${totalSubs} subtasks`,
      width - pagePad - 18,
      y + 28,
    );
    ctx.textAlign = 'left';
    y += 64;

    ctx.fillStyle = '#0F172A';
    ctx.font = '700 16px Segoe UI, Arial, sans-serif';
    ctx.fillText('Task & subtask breakdown', pagePad, y + 8);
    ctx.fillStyle = '#64748B';
    ctx.font = '500 12px Segoe UI, Arial, sans-serif';
    ctx.fillText('Every assigned task with nested subtask details', pagePad + 260, y + 8);
    y += 24;
  } else {
    ctx.fillStyle = '#0F172A';
    ctx.font = '700 20px Segoe UI, Arial, sans-serif';
    ctx.fillText(ellipsize(ctx, p.name, contentW - 200), pagePad, y + 18);
    ctx.fillStyle = '#64748B';
    ctx.font = '500 12px Segoe UI, Arial, sans-serif';
    ctx.fillText(`${text(p.displayId || p.id)}  ·  continued`, pagePad, y + 40);
    y += 56;
  }

  page.blocks.forEach((block) => {
    const task = block.task || {};
    const subs = Array.isArray(block.subtasks) ? block.subtasks : [];
    const cardH = measureTaskCardHeight(subs.length);
    fillRoundRect(ctx, pagePad, y, contentW, cardH, 16, '#FFFFFF');
    strokeRoundRect(ctx, pagePad, y, contentW, cardH, 16, '#E2E8F0');
    fillRoundRect(ctx, pagePad, y, 6, cardH, 16, '#1E88E5');

    const num = String((block.taskIndex || 0) + 1).padStart(2, '0');
    fillRoundRect(ctx, pagePad + 20, y + 16, 34, 24, 8, '#E8F0FE');
    ctx.fillStyle = '#1E62F0';
    ctx.font = '700 12px Segoe UI, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(num, pagePad + 37, y + 32);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#0F172A';
    ctx.font = '700 15px Segoe UI, Arial, sans-serif';
    const titleSuffix = block.continued ? ' (continued)' : '';
    ctx.fillText(ellipsize(ctx, `${task.taskName || '—'}${titleSuffix}`, contentW - 360), pagePad + 64, y + 33);

    ctx.fillStyle = '#64748B';
    ctx.font = '500 11px Segoe UI, Arial, sans-serif';
    ctx.fillText(text(task.taskId || task.id), pagePad + 64, y + 52);

    drawAvatar(ctx, pagePad + 64, y + 62, task.assignedTo);
    ctx.fillStyle = '#334155';
    ctx.font = '600 12px Segoe UI, Arial, sans-serif';
    ctx.fillText(ellipsize(ctx, task.assignedTo, 180), pagePad + 94, y + 78);

    ctx.fillStyle = '#64748B';
    ctx.font = '500 12px Segoe UI, Arial, sans-serif';
    ctx.fillText(
      `${formatExportDate(task.startDate)}  →  ${formatExportDate(task.endDate)}`,
      pagePad + 300,
      y + 78,
    );

    let rightX = width - pagePad - 18;
    const taskBadges = [
      { label: delayTone(task.delayDays).label, tone: delayTone(task.delayDays) },
      { label: text(task.status), tone: statusTone(task.status) },
    ];
    for (const item of taskBadges) {
      ctx.font = '600 11px Segoe UI, Arial, sans-serif';
      const w = Math.ceil(ctx.measureText(item.label).width) + 20;
      rightX -= w;
      drawBadge(ctx, rightX, y + 16, item.label, item.tone);
      rightX -= 8;
    }

    if (subs.length || block.subTotal > 0) {
      const listY = y + 96;
      ctx.fillStyle = '#94A3B8';
      ctx.font = '700 10px Segoe UI, Arial, sans-serif';
      const rangeLabel =
        block.subTotal > subs.length
          ? `SUBTASKS · ${block.subOffset + 1}–${block.subOffset + subs.length} of ${block.subTotal}`
          : `SUBTASKS · ${subs.length}`;
      ctx.fillText(rangeLabel, pagePad + 64, listY - 6);

      subs.forEach((sub, subIdx) => {
        const sy = listY + 6 + subIdx * PNG_SUB_ROW;
        fillRoundRect(ctx, pagePad + 64, sy, contentW - 92, 38, 10, '#F8FAFC');
        ctx.fillStyle = '#FB8C00';
        ctx.font = '700 12px Segoe UI, Arial, sans-serif';
        ctx.fillText('↳', pagePad + 76, sy + 24);
        ctx.fillStyle = '#0F172A';
        ctx.font = '600 13px Segoe UI, Arial, sans-serif';
        const subName = sub.subtaskName || sub.taskName || sub.name;
        ctx.fillText(ellipsize(ctx, subName, contentW - 520), pagePad + 96, sy + 24);

        ctx.fillStyle = '#64748B';
        ctx.font = '500 11px Segoe UI, Arial, sans-serif';
        ctx.fillText(
          `${text(sub.assignedTo || sub.assignee)}  ·  ${formatExportDate(sub.endDate || sub.startDate)}`,
          pagePad + 520,
          sy + 24,
        );

        ctx.font = '600 11px Segoe UI, Arial, sans-serif';
        const subLabel = text(sub.status);
        const sw = Math.ceil(ctx.measureText(subLabel).width) + 20;
        drawBadge(ctx, width - pagePad - 30 - sw, sy + 8, subLabel, statusTone(sub.status));
      });
    }

    y += cardH + PNG_CARD_GAP;
  });

  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 11px Segoe UI, Arial, sans-serif';
  ctx.fillText(
    pageCount > 1
      ? `Project Tracker  ·  Confidential  ·  Page ${pageNumber}/${pageCount}`
      : 'Project Tracker  ·  Confidential  ·  Generated from the project accordion',
    pagePad,
    height - 18,
  );

  return canvas;
}

export async function downloadProjectExportPng(bundle) {
  const taskRows = Array.isArray(bundle.taskRows) ? bundle.taskRows : [];
  const pages = buildPngPages(taskRows);
  const pageCount = pages.length;
  const stamp = todayStamp();
  const base = bundle.filenameBase || 'project';

  for (let i = 0; i < pageCount; i += 1) {
    const canvas = drawPngPage(bundle, pages[i], i + 1, pageCount);
    const blob = await canvasToPngBlob(canvas);
    const name =
      pageCount === 1
        ? `${base}-${stamp}.png`
        : `${base}-${stamp}-page-${String(i + 1).padStart(2, '0')}-of-${String(pageCount).padStart(2, '0')}.png`;
    downloadBlob(name, blob);
    // Let the browser finish each download before starting the next.
    if (i < pageCount - 1) await sleep(350);
  }

  return { pageCount };
}

export async function exportProjectAccordion(kind, bundle) {
  if (kind === 'csv') {
    downloadProjectExportCsv(bundle);
    return { kind: 'csv' };
  }
  const result = await downloadProjectExportPng(bundle);
  return { kind: 'png', ...result };
}
