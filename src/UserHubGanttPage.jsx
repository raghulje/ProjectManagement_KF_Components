/**
 * User Hub — Gantt timeline page.
 * Same ownership scope as UserHubProjectsPage:
 * Project Owner, Business Owner, Sponsor, COS Owner, Developer, or creator.
 */
import { useCallback } from 'react';
import GanttChart from './GanttChart.jsx';
import { useUserHubSession } from './lib/useUserHubSession.js';
import {
  openGanttProjectPopup,
  openGanttTaskPopup,
  openGanttSubtaskPopup,
} from './lib/kfGanttPopups.js';

export default function UserHubGanttPage() {
  const { kfInstance } = useUserHubSession();

  const handleOpenProject = useCallback(
    (row) => openGanttProjectPopup(kfInstance, row),
    [kfInstance],
  );
  const handleOpenTask = useCallback(
    (row) => openGanttTaskPopup(kfInstance, row),
    [kfInstance],
  );
  const handleOpenSubtask = useCallback(
    (row) => openGanttSubtaskPopup(kfInstance, row),
    [kfInstance],
  );

  return (
    <GanttChart
      kfInstance={kfInstance}
      scopeToCurrentUser
      onOpenProject={handleOpenProject}
      onOpenTask={handleOpenTask}
      onOpenSubtask={handleOpenSubtask}
    />
  );
}
