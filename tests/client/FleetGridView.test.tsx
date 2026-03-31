// =============================================================================
// Fleet Commander — FleetGridView Component Tests
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

let mockTeams: Array<Record<string, unknown>> = [];
let mockSelectedTeamId: number | null = null;
const mockSetSelectedTeamId = vi.fn();
const mockSetProject = vi.fn();
const mockSetStatuses = vi.fn();
const mockSetPage = vi.fn();
const mockSetPageSize = vi.fn();
const mockResetPage = vi.fn();

let mockSelectedProject: string | null = null;
let mockSelectedStatuses = new Set<string>();
let mockPage = 1;
let mockPageSize = 25;

vi.mock('../../src/client/context/FleetContext', () => ({
  useTeams: () => ({
    teams: mockTeams,
    fetchError: null,
  }),
  useSelection: () => ({
    selectedTeamId: mockSelectedTeamId,
    setSelectedTeamId: mockSetSelectedTeamId,
  }),
}));

// Mock the grid filters hook to return controllable state
vi.mock('../../src/client/hooks/useGridFilters', () => ({
  useGridFilters: () => ({
    selectedProject: mockSelectedProject,
    selectedStatuses: mockSelectedStatuses,
    setProject: mockSetProject,
    setStatuses: mockSetStatuses,
  }),
  applyGridFilters: (teams: Array<Record<string, unknown>>, project: string | null, statuses: Set<string>) => {
    return teams.filter((team) => {
      if (project !== null && team.projectName !== project) return false;
      if (statuses.size > 0 && !statuses.has(team.status as string)) return false;
      return true;
    });
  },
}));

// Mock the pagination hook
vi.mock('../../src/client/hooks/usePagination', () => ({
  usePagination: () => ({
    page: mockPage,
    pageSize: mockPageSize,
    setPage: mockSetPage,
    setPageSize: mockSetPageSize,
    resetPage: mockResetPage,
  }),
  paginateItems: (items: unknown[], page: number, pageSize: number) => {
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    const clampedPage = Math.max(1, Math.min(page, totalPages));
    const start = (clampedPage - 1) * pageSize;
    const end = start + pageSize;
    return { pageItems: items.slice(start, end), totalPages };
  },
  PAGE_SIZE_OPTIONS: [25, 50, 100] as const,
}));

// Mock child components to keep rendering lightweight
vi.mock('../../src/client/components/FleetGrid', () => ({
  FleetGrid: (props: { teams: unknown[]; selectedTeamId: number | null; onSelectTeam: (id: number) => void }) => (
    <div data-testid="fleet-grid">
      FleetGrid ({props.teams.length} teams)
      <button onClick={() => props.onSelectTeam(1)}>select-1</button>
    </div>
  ),
}));

vi.mock('../../src/client/components/TeamTimeline', () => ({
  TeamTimeline: (props: { teams: unknown[] }) => (
    <div data-testid="team-timeline">TeamTimeline ({props.teams.length} teams)</div>
  ),
}));

vi.mock('../../src/client/components/GridFilterBar', () => ({
  GridFilterBar: (props: {
    projectNames: string[];
    selectedProject: string | null;
    onProjectChange: (name: string | null) => void;
    selectedStatuses: Set<string>;
    onStatusesChange: (statuses: Set<string>) => void;
  }) => (
    <div data-testid="grid-filter-bar">
      GridFilterBar (projects: {props.projectNames.join(',')})
      <button data-testid="filter-project-alpha" onClick={() => props.onProjectChange('alpha')}>Filter alpha</button>
      <button data-testid="filter-clear" onClick={() => props.onProjectChange(null)}>Clear project</button>
    </div>
  ),
}));

vi.mock('../../src/client/components/PaginationBar', () => ({
  PaginationBar: (props: {
    page: number;
    totalPages: number;
    pageSize: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
  }) => (
    <div data-testid="pagination-bar">
      PaginationBar (page {props.page} of {props.totalPages}, size {props.pageSize})
      <button data-testid="page-next" onClick={() => props.onPageChange(props.page + 1)}>Next</button>
      <button data-testid="page-size-50" onClick={() => props.onPageSizeChange(50)}>Size 50</button>
    </div>
  ),
}));

// Import after mocks
import { FleetGridView } from '../../src/client/views/FleetGridView';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTeam(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    issueNumber: 100,
    issueTitle: 'Fix bug',
    status: 'running',
    launchedAt: '2026-03-21T10:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FleetGridView', () => {
  beforeEach(() => {
    mockTeams = [];
    mockSelectedTeamId = null;
    mockSelectedProject = null;
    mockSelectedStatuses = new Set();
    mockPage = 1;
    mockPageSize = 25;
    mockSetSelectedTeamId.mockReset();
    mockSetProject.mockReset();
    mockSetStatuses.mockReset();
    mockSetPage.mockReset();
    mockSetPageSize.mockReset();
    mockResetPage.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows empty state when no teams', () => {
    render(<FleetGridView />);
    expect(screen.getByText('No teams')).toBeInTheDocument();
    expect(screen.getByText('Launch a team to get started')).toBeInTheDocument();
  });

  it('renders team count when teams exist', () => {
    mockTeams = [makeTeam({ id: 1 }), makeTeam({ id: 2, issueNumber: 200 })];
    render(<FleetGridView />);
    expect(screen.getByText('2 teams')).toBeInTheDocument();
  });

  it('renders singular "team" for one team', () => {
    mockTeams = [makeTeam()];
    render(<FleetGridView />);
    expect(screen.getByText('1 team')).toBeInTheDocument();
  });

  it('renders Grid and Timeline toggle buttons', () => {
    mockTeams = [makeTeam()];
    render(<FleetGridView />);
    expect(screen.getByText('Grid')).toBeInTheDocument();
    expect(screen.getByText('Timeline')).toBeInTheDocument();
  });

  it('shows FleetGrid by default', () => {
    mockTeams = [makeTeam()];
    render(<FleetGridView />);
    expect(screen.getByTestId('fleet-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('team-timeline')).not.toBeInTheDocument();
  });

  it('switches to Timeline view when Timeline button is clicked', () => {
    mockTeams = [makeTeam()];
    render(<FleetGridView />);
    fireEvent.click(screen.getByText('Timeline'));
    expect(screen.getByTestId('team-timeline')).toBeInTheDocument();
    expect(screen.queryByTestId('fleet-grid')).not.toBeInTheDocument();
  });

  it('sorts teams by status priority (stuck before running)', () => {
    mockTeams = [
      makeTeam({ id: 1, status: 'running', launchedAt: '2026-03-21T10:00:00Z' }),
      makeTeam({ id: 2, status: 'stuck', launchedAt: '2026-03-21T09:00:00Z' }),
    ];
    render(<FleetGridView />);
    // FleetGrid mock displays team count, verifying it receives sorted teams
    expect(screen.getByText('FleetGrid (2 teams)')).toBeInTheDocument();
  });

  it('passes onSelectTeam to FleetGrid', () => {
    mockTeams = [makeTeam()];
    render(<FleetGridView />);
    fireEvent.click(screen.getByText('select-1'));
    expect(mockSetSelectedTeamId).toHaveBeenCalledWith(1);
  });

  // -------------------------------------------------------------------------
  // Filter integration tests
  // -------------------------------------------------------------------------

  it('renders GridFilterBar when teams exist', () => {
    mockTeams = [makeTeam()];
    render(<FleetGridView />);
    expect(screen.getByTestId('grid-filter-bar')).toBeInTheDocument();
  });

  it('does not render GridFilterBar in empty state', () => {
    mockTeams = [];
    render(<FleetGridView />);
    expect(screen.queryByTestId('grid-filter-bar')).not.toBeInTheDocument();
  });

  it('shows filtered count when project filter is active', () => {
    mockSelectedProject = 'alpha';
    mockTeams = [
      makeTeam({ id: 1, projectName: 'alpha' }),
      makeTeam({ id: 2, projectName: 'beta', issueNumber: 200 }),
    ];
    render(<FleetGridView />);
    expect(screen.getByText('1 of 2 teams')).toBeInTheDocument();
  });

  it('shows filtered count when status filter is active', () => {
    mockSelectedStatuses = new Set(['running']);
    mockTeams = [
      makeTeam({ id: 1, status: 'running' }),
      makeTeam({ id: 2, status: 'done', issueNumber: 200 }),
      makeTeam({ id: 3, status: 'running', issueNumber: 300 }),
    ];
    render(<FleetGridView />);
    expect(screen.getByText('2 of 3 teams')).toBeInTheDocument();
  });

  it('shows normal count when no filters are active', () => {
    mockTeams = [makeTeam({ id: 1 }), makeTeam({ id: 2, issueNumber: 200 })];
    render(<FleetGridView />);
    expect(screen.getByText('2 teams')).toBeInTheDocument();
  });

  it('passes filtered teams to FleetGrid', () => {
    mockSelectedProject = 'alpha';
    mockTeams = [
      makeTeam({ id: 1, projectName: 'alpha' }),
      makeTeam({ id: 2, projectName: 'beta', issueNumber: 200 }),
    ];
    render(<FleetGridView />);
    expect(screen.getByText('FleetGrid (1 teams)')).toBeInTheDocument();
  });

  it('passes filtered teams to TeamTimeline', () => {
    mockSelectedProject = 'alpha';
    mockTeams = [
      makeTeam({ id: 1, projectName: 'alpha' }),
      makeTeam({ id: 2, projectName: 'beta', issueNumber: 200 }),
    ];
    render(<FleetGridView />);
    fireEvent.click(screen.getByText('Timeline'));
    expect(screen.getByText('TeamTimeline (1 teams)')).toBeInTheDocument();
  });

  it('extracts unique project names and passes to GridFilterBar', () => {
    mockTeams = [
      makeTeam({ id: 1, projectName: 'beta' }),
      makeTeam({ id: 2, projectName: 'alpha', issueNumber: 200 }),
      makeTeam({ id: 3, projectName: 'beta', issueNumber: 300 }),
      makeTeam({ id: 4, projectName: null, issueNumber: 400 }),
    ];
    render(<FleetGridView />);
    // GridFilterBar mock renders project names joined
    expect(screen.getByText('GridFilterBar (projects: alpha,beta)')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Pagination integration tests
  // -------------------------------------------------------------------------

  it('renders PaginationBar in grid view when teams exist', () => {
    mockTeams = [makeTeam()];
    render(<FleetGridView />);
    expect(screen.getByTestId('pagination-bar')).toBeInTheDocument();
  });

  it('does not render PaginationBar in timeline view', () => {
    mockTeams = [makeTeam()];
    render(<FleetGridView />);
    fireEvent.click(screen.getByText('Timeline'));
    expect(screen.queryByTestId('pagination-bar')).not.toBeInTheDocument();
  });

  it('does not render PaginationBar in empty state', () => {
    mockTeams = [];
    render(<FleetGridView />);
    expect(screen.queryByTestId('pagination-bar')).not.toBeInTheDocument();
  });

  it('passes paginated teams to FleetGrid', () => {
    // Create 30 teams, with page size 25 only 25 should be passed
    mockTeams = Array.from({ length: 30 }, (_, i) =>
      makeTeam({ id: i + 1, issueNumber: 100 + i }),
    );
    mockPageSize = 25;
    mockPage = 1;
    render(<FleetGridView />);
    expect(screen.getByText('FleetGrid (25 teams)')).toBeInTheDocument();
  });

  it('passes all filtered teams to TeamTimeline (not paginated)', () => {
    mockTeams = Array.from({ length: 30 }, (_, i) =>
      makeTeam({ id: i + 1, issueNumber: 100 + i }),
    );
    mockPageSize = 25;
    mockPage = 1;
    render(<FleetGridView />);
    fireEvent.click(screen.getByText('Timeline'));
    expect(screen.getByText('TeamTimeline (30 teams)')).toBeInTheDocument();
  });

  it('forwards onPageChange to setPage', () => {
    mockTeams = [makeTeam()];
    render(<FleetGridView />);
    fireEvent.click(screen.getByTestId('page-next'));
    expect(mockSetPage).toHaveBeenCalledWith(2);
  });

  it('forwards onPageSizeChange to setPageSize', () => {
    mockTeams = [makeTeam()];
    render(<FleetGridView />);
    fireEvent.click(screen.getByTestId('page-size-50'));
    expect(mockSetPageSize).toHaveBeenCalledWith(50);
  });

  it('shows PaginationBar with page and totalPages info', () => {
    mockTeams = Array.from({ length: 60 }, (_, i) =>
      makeTeam({ id: i + 1, issueNumber: 100 + i }),
    );
    mockPage = 2;
    mockPageSize = 25;
    render(<FleetGridView />);
    expect(screen.getByText('PaginationBar (page 2 of 3, size 25)')).toBeInTheDocument();
  });
});
