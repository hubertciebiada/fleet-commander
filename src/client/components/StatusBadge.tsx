import type { TeamStatus } from '../../shared/types';
import { STATUS_COLORS } from '../utils/constants';

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
  retryCount?: number;
  maxRetries?: number;
}

export function StatusBadge({ status, retryCount, maxRetries }: StatusBadgeProps) {
  const color = STATUS_COLORS[status] ?? '#8B949E';
  const label = STATUS_LABELS[status] ?? status;

  // Determine animation class based on status
  let animationClass = '';
  if (status === 'stuck') {
    animationClass = 'animate-pulse-stuck';
  } else if (status === 'launching') {
    animationClass = 'animate-blink';
  }

  // Retry annotation for failed teams
  let retryAnnotation: string | null = null;
  if (status === 'failed' && retryCount !== undefined && retryCount > 0) {
    if (maxRetries !== undefined && retryCount >= maxRetries) {
      retryAnnotation = '(permanent)';
    } else {
      retryAnnotation = `(retry ${retryCount})`;
    }
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
      {retryAnnotation && (
        <span className="text-xs text-dark-muted">
          {retryAnnotation}
        </span>
      )}
    </span>
  );
}
