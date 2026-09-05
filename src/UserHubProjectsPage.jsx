/**
 * User Hub — projects page only.
 * Shows projects where the user is Project Owner, Business Owner, Sponsor,
 * COS Owner, Developer, or creator.
 */
import { useCallback } from 'react';
import ProjectDashboardPage from './ProjectDashboardPage.jsx';
import { useUserHubSession } from './lib/useUserHubSession.js';
import { openUserHubProjectCreatePopup, openUserHubProjectPopup } from './lib/kfUserHubPopups.js';

export default function UserHubProjectsPage({ useLayout = false }) {
  const { kfInstance, scopeUser, firstName, displayRole, greeting } = useUserHubSession();

  const handleOpenProjectRow = useCallback(
    (row) => openUserHubProjectPopup(kfInstance, row),
    [kfInstance],
  );

  const handleCreateProject = useCallback(
    () => openUserHubProjectCreatePopup(kfInstance),
    [kfInstance],
  );

  return (
    <div className="min-h-screen overflow-x-clip bg-gradient-to-b from-[#edf1ff] via-[#f6f8ff] to-[#f2ecff]">
      <div className="mx-auto min-w-0 max-w-[1800px] p-3 pb-6 sm:p-6">
        <ProjectDashboardPage
          useLayout={useLayout}
          scopeToCurrentUser
          scopeUser={scopeUser}
          projectsScopeOwnerOnly
          contentView="projects"
          hideUserScopeToggle
          hideWelcomeHeader
          embeddedInHub
          hubWelcome={{
            greeting,
            firstName,
            displayRole,
            email: scopeUser?.Email,
            subtitle: `Your projects · ${displayRole}`,
          }}
          onCreateProjectRecord={handleCreateProject}
          onOpenProjectRow={handleOpenProjectRow}
        />
      </div>
    </div>
  );
}
