import type { CIStatus } from '../../shared/types';

/** CI status icon and color map */
const CI_ICONS: Record<string, { icon: string; color: string }> = {
  passing: { icon: '\u2713', color: '#3FB950' },
  failing: { icon: '\u2715', color: '#F85149' },
  pending: { icon: '\u25CB', color: '#D29922' },
  none: { icon: '\u2014', color: '#8B949E' },
};

interface PRBadgeProps {
  prNumber: number | null;
  ciStatus: string | null;
}

export function PRBadge({ prNumber, ciStatus }: PRBadgeProps) {
  if (prNumber == null) {
    return <span className="text-dark-muted text-sm">{'\u2014'}</span>;
  }

  const ci = CI_ICONS[(ciStatus as CIStatus) ?? 'none'] ?? CI_ICONS.none;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-sm text-dark-accent">#{prNumber}</span>
      <span className="text-sm font-bold" style={{ color: ci.color }}>
        {ci.icon}
      </span>
    </span>
  );
}
