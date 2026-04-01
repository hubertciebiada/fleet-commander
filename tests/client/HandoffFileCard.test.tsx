// =============================================================================
// Fleet Commander — HandoffFileCard Component Tests
// =============================================================================

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { HandoffFileCard } from '../../src/client/components/HandoffFileCard';
import type { HandoffFile } from '../../src/shared/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFile(overrides?: Partial<HandoffFile>): HandoffFile {
  return {
    id: 1,
    teamId: 1,
    fileType: 'plan.md',
    content: '# Plan\n\nThis is the implementation plan.',
    agentName: 'planner',
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HandoffFileCard', () => {
  it('should render the file type badge', () => {
    render(<HandoffFileCard file={makeFile()} />);
    expect(screen.getByText('Plan')).toBeInTheDocument();
  });

  it('should render the file name', () => {
    render(<HandoffFileCard file={makeFile()} />);
    expect(screen.getByText('plan.md')).toBeInTheDocument();
  });

  it('should render the agent name when present', () => {
    render(<HandoffFileCard file={makeFile({ agentName: 'dev' })} />);
    expect(screen.getByText('dev')).toBeInTheDocument();
  });

  it('should not render agent name when null', () => {
    render(<HandoffFileCard file={makeFile({ agentName: null })} />);
    expect(screen.queryByText('planner')).not.toBeInTheDocument();
  });

  it('should show content when expanded by default', () => {
    render(<HandoffFileCard file={makeFile()} defaultExpanded={true} />);
    expect(screen.getByText(/This is the implementation plan/)).toBeInTheDocument();
  });

  it('should hide content when collapsed by default', () => {
    render(<HandoffFileCard file={makeFile()} defaultExpanded={false} />);
    expect(screen.queryByText(/This is the implementation plan/)).not.toBeInTheDocument();
  });

  it('should toggle content visibility on header click', () => {
    render(<HandoffFileCard file={makeFile()} defaultExpanded={false} />);

    // Content should be hidden initially
    expect(screen.queryByText(/This is the implementation plan/)).not.toBeInTheDocument();

    // Click the header button to expand
    const header = screen.getByText('plan.md').closest('button');
    expect(header).toBeTruthy();
    fireEvent.click(header!);

    // Content should now be visible
    expect(screen.getByText(/This is the implementation plan/)).toBeInTheDocument();
  });

  it('should render correct badge label for changes.md', () => {
    render(<HandoffFileCard file={makeFile({ fileType: 'changes.md' })} />);
    expect(screen.getByText('Changes')).toBeInTheDocument();
  });

  it('should render correct badge label for review.md', () => {
    render(<HandoffFileCard file={makeFile({ fileType: 'review.md' })} />);
    expect(screen.getByText('Review')).toBeInTheDocument();
  });

  it('should show Copy button when expanded', () => {
    render(<HandoffFileCard file={makeFile()} defaultExpanded={true} />);
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });
});
