/**
 * User dashboard — same ProjectDashboardPage UI (insights, health monitors, tables),
 * scoped with Me / My Team toggle (My Team uses the same reports as UserSpecificPT).
 */
import ProjectDashboardPage from './ProjectDashboardPage.jsx';

export default function UserDashboardPage({ useLayout = false }) {
  return <ProjectDashboardPage useLayout={useLayout} scopeToCurrentUser />;
}
