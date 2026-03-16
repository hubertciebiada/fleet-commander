import type { TeamStatus } from '../../shared/types';

/** Status color map from PRD */
const STATUS_COLORS: Record<TeamStatus, string> = {
  queued: '#8B949E',
  running: '#3FB950',
  stuck: '#F85149',
  idle: '#D29922',
  done: '#56D4DD',
  failed: '#F85149',
  launching: '#58A6FF',
};

/** Human-readable status labels */
const STATUS_LABELS: Record<TeamStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  stuck: 'Stuck',
  idle: 'Idle',
  done: 'Done',
  failed: 'Failed',
  launching: 'Launching',
};

interface StatusBadgeProps {
  status: TeamStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const color = STATUS_COLORS[status] ?? '#8B949E';
  const label = STATUS_LABELS[status] ?? status;

  // Determine animation class based on status
  let animationClass = '';
  if (status === 'stuck') {
    animationClass = 'animate-pulse-stuck';
  } else if (status === 'launching') {
    animationClass = 'animate-blink';
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${animationClass}`}
        style={{ backgroundColor: color }}
      />
      <span
        className="text-sm font-medium"
        style={{ color }}
      >
        {label}
      </span>
    </span>
  );
}
