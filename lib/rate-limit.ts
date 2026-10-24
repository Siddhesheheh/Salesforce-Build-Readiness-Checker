// In-memory best-effort per-IP rate limiter (10 requests per hour per SPEC Section 10)
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = process.env.RATE_LIMIT_MAX_REQUESTS
  ? parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10)
  : 10;

const ipRequestHistory = new Map<string, number[]>();

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = ipRequestHistory.get(ip) || [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }

  recent.push(now);
  ipRequestHistory.set(ip, recent);
  return false;
}

export function resetRateLimiter(): void {
  ipRequestHistory.clear();
}
