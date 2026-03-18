export function formatResetsAt(isoStr: string | null | undefined): string | null {
  if (!isoStr) return null;
  const diff = new Date(isoStr).getTime() - Date.now();
  if (diff <= 0) return null;
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return `Resets in ${hours}h ${mins}m`;
  return `Resets in ${mins}m`;
}
