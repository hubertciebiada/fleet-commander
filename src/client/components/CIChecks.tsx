import type { CICheck } from '../../shared/types';

// ---------------------------------------------------------------------------
// CI check status icon and color mapping
// ---------------------------------------------------------------------------

function getCheckIcon(conclusion: string | null, status: string): { icon: string; color: string } {
  if (conclusion === 'success') return { icon: '\u2713', color: '#3FB950' };  // green checkmark
  if (conclusion === 'failure') return { icon: '\u2715', color: '#F85149' };  // red X
  if (conclusion === 'cancelled') return { icon: '\u2015', color: '#8B949E' }; // grey dash
  // Pending / in-progress / queued
  if (status === 'in_progress' || status === 'queued' || status === 'pending') {
    return { icon: '\u25CB', color: '#D29922' };  // amber circle
  }
  return { icon: '\u25CB', color: '#8B949E' };  // grey circle for unknown
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CIChecksProps {
  checks: CICheck[];
}

export function CIChecks({ checks }: CIChecksProps) {
  if (checks.length === 0) {
    return (
      <p className="text-dark-muted text-sm">No CI checks available</p>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {checks.map((check, i) => {
        const { icon, color } = getCheckIcon(check.conclusion, check.status);
        const bgColor =
          check.conclusion === 'success'
            ? 'rgba(63, 185, 80, 0.15)'
            : check.conclusion === 'failure'
              ? 'rgba(248, 81, 73, 0.15)'
              : check.conclusion === 'cancelled'
                ? 'rgba(139, 148, 158, 0.15)'
                : 'rgba(210, 153, 34, 0.15)';
        return (
          <span
            key={`${check.name}-${i}`}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full max-w-[10rem]"
            style={{ backgroundColor: bgColor }}
            title={check.name}
          >
            <span className="font-bold leading-none shrink-0" style={{ color }}>
              {icon}
            </span>
            <span className="truncate" style={{ color }}>
              {check.name}
            </span>
          </span>
        );
      })}
    </div>
  );
}
