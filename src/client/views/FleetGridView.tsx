import { useMemo } from 'react';
import { useFleet } from '../context/FleetContext';
import { FleetGrid } from '../components/FleetGrid';
import type { TeamDashboardRow, TeamStatus } from '../../shared/types';

// ---------------------------------------------------------------------------
// Status priority: lower number = higher priority (sorted first)
// stuck > running > idle > launching > failed > done
// ---------------------------------------------------------------------------

const STATUS_PRIORITY: Record<TeamStatus, number> = {
  stuck: 0,
  running: 1,
  idle: 2,
  launching: 3,
  failed: 4,
  done: 5,
};

/** Sort teams by status priority, then by duration descending within same status */
function sortTeams(teams: TeamDashboardRow[]): TeamDashboardRow[] {
  return [...teams].sort((a, b) => {
    const aPri = STATUS_PRIORITY[a.status] ?? 99;
    const bPri = STATUS_PRIORITY[b.status] ?? 99;
    if (aPri !== bPri) return aPri - bPri;
    // Within same status: sort by duration descending (longest first)
    return (b.durationMin ?? 0) - (a.durationMin ?? 0);
  });
}

export function FleetGridView() {
  const { teams, selectedTeamId, setSelectedTeamId } = useFleet();

  const sortedTeams = useMemo(() => sortTeams(teams), [teams]);

  // Empty state
  if (sortedTeams.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <svg className="w-12 h-12 text-dark-muted/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
        </svg>
        <p className="text-dark-muted text-lg">No teams running</p>
        <p className="text-dark-muted/60 text-sm">Launch a team to get started</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <FleetGrid
        teams={sortedTeams}
        selectedTeamId={selectedTeamId}
        onSelectTeam={setSelectedTeamId}
      />
    </div>
  );
}
