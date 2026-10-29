export function formatAgo(updatedAt: string | null, now: number): string {
  if (!updatedAt) return "no report yet";
  const then = Date.parse(updatedAt);
  if (Number.isNaN(then)) return "no report yet";
  const sec = Math.max(0, Math.floor((now - then) / 1000));
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
