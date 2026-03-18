// =============================================================================
// Fleet Commander — PRBadge Component Tests
// =============================================================================

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PRBadge } from '../../src/client/components/PRBadge';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PRBadge', () => {
  describe('when prNumber is null', () => {
    it('renders an em-dash placeholder', () => {
      const { container } = render(<PRBadge prNumber={null} ciStatus={null} />);
      expect(container.textContent).toContain('\u2014');
    });

    it('does not render a PR number', () => {
      render(<PRBadge prNumber={null} ciStatus={null} />);
      expect(screen.queryByText(/#\d+/)).not.toBeInTheDocument();
    });
  });

  describe('when prNumber is provided', () => {
    it('renders the PR number with a hash prefix', () => {
      render(<PRBadge prNumber={42} ciStatus="passing" />);
      expect(screen.getByText('#42')).toBeInTheDocument();
    });

    it('renders a different PR number correctly', () => {
      render(<PRBadge prNumber={789} ciStatus="pending" />);
      expect(screen.getByText('#789')).toBeInTheDocument();
    });
  });

  describe('CI status icons', () => {
    it('renders a checkmark icon for passing CI', () => {
      const { container } = render(<PRBadge prNumber={1} ciStatus="passing" />);
      // Unicode checkmark: \u2713
      expect(container.textContent).toContain('\u2713');
    });

    it('renders the passing icon with green color (#3FB950)', () => {
      const { container } = render(<PRBadge prNumber={1} ciStatus="passing" />);
      const ciIcon = container.querySelector('.font-bold');
      expect(ciIcon).toHaveStyle({ color: '#3FB950' });
    });

    it('renders a cross icon for failing CI', () => {
      const { container } = render(<PRBadge prNumber={1} ciStatus="failing" />);
      // Unicode cross: \u2715
      expect(container.textContent).toContain('\u2715');
    });

    it('renders the failing icon with red color (#F85149)', () => {
      const { container } = render(<PRBadge prNumber={1} ciStatus="failing" />);
      const ciIcon = container.querySelector('.font-bold');
      expect(ciIcon).toHaveStyle({ color: '#F85149' });
    });

    it('renders a circle icon for pending CI', () => {
      const { container } = render(<PRBadge prNumber={1} ciStatus="pending" />);
      // Unicode circle: \u25CB
      expect(container.textContent).toContain('\u25CB');
    });

    it('renders the pending icon with yellow color (#D29922)', () => {
      const { container } = render(<PRBadge prNumber={1} ciStatus="pending" />);
      const ciIcon = container.querySelector('.font-bold');
      expect(ciIcon).toHaveStyle({ color: '#D29922' });
    });

    it('renders an em-dash icon for none CI status', () => {
      const { container } = render(<PRBadge prNumber={1} ciStatus="none" />);
      // There are two items in the badge: PR number and CI icon
      // The CI icon should be an em-dash
      const spans = container.querySelectorAll('span');
      const ciIcon = spans[spans.length - 1];
      expect(ciIcon.textContent).toBe('\u2014');
    });

    it('renders the none icon with muted color (#8B949E)', () => {
      const { container } = render(<PRBadge prNumber={1} ciStatus="none" />);
      const ciIcon = container.querySelector('.font-bold');
      expect(ciIcon).toHaveStyle({ color: '#8B949E' });
    });

    it('defaults to "none" icon when ciStatus is null', () => {
      const { container } = render(<PRBadge prNumber={1} ciStatus={null} />);
      const ciIcon = container.querySelector('.font-bold');
      expect(ciIcon).toHaveStyle({ color: '#8B949E' });
    });
  });

  describe('merged PR override', () => {
    it('shows purple checkmark when PR is merged with ciStatus "none"', () => {
      const { container } = render(
        <PRBadge prNumber={99} ciStatus="none" prState="merged" />,
      );
      const ciIcon = container.querySelector('.font-bold');
      expect(ciIcon?.textContent).toBe('\u2713');
      expect(ciIcon).toHaveStyle({ color: '#A371F7' });
    });

    it('shows purple checkmark when PR is merged with ciStatus "passing"', () => {
      const { container } = render(
        <PRBadge prNumber={99} ciStatus="passing" prState="merged" />,
      );
      const ciIcon = container.querySelector('.font-bold');
      expect(ciIcon?.textContent).toBe('\u2713');
      expect(ciIcon).toHaveStyle({ color: '#A371F7' });
    });

    it('shows purple checkmark when PR is merged with ciStatus null', () => {
      const { container } = render(
        <PRBadge prNumber={99} ciStatus={null} prState="merged" />,
      );
      const ciIcon = container.querySelector('.font-bold');
      expect(ciIcon?.textContent).toBe('\u2713');
      expect(ciIcon).toHaveStyle({ color: '#A371F7' });
    });

    it('does not override icon for open PRs', () => {
      const { container } = render(
        <PRBadge prNumber={99} ciStatus="failing" prState="open" />,
      );
      const ciIcon = container.querySelector('.font-bold');
      expect(ciIcon?.textContent).toBe('\u2715');
      expect(ciIcon).toHaveStyle({ color: '#F85149' });
    });
  });
});
