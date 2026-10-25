/**
 * Per-IP rate limiter (10 requests per hour per SPEC Section 10).
 *
 * Operational Architecture:
 * 1. Local/Development: In-memory sliding-window log using request timestamps.
 * 2. Production: Distributed atomic fixed-window counter via Upstash Redis REST API
 *    executing an atomic Lua script (zero extra npm dependencies).
 *
 * Atomicity & Expiration:
 * - Uses a Redis Lua script ('EVAL') to atomically execute INCR and EXPIRE in a single
 *   uninterrupted step on the Redis server.
 * - Guarantees every counter key receives a valid TTL (3600 seconds) upon creation
 *   and heals any unexpired keys (TTL == -1).
 *
 * Security & Privacy:
 * - Only the client IP is tracked in Redis (key format: `rl:<sanitized_ip>`).
 * - Never logs or stores requirement text, org context, or clarification answers.
 * - Fails closed in production if Upstash Redis credentials are missing, or if
 *   the upstream Redis provider fails or returns malformed responses.
 */

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour for local sliding window
const RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 hour for Redis fixed window

function getMaxRequests(): number {
  return process.env.RATE_LIMIT_MAX_REQUESTS
    ? parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10)
    : 10;
}

// In-memory sliding-window timestamp store for local development/testing
const ipRequestHistory = new Map<string, number[]>();

export function isRateLimitedInMemory(ip: string): boolean {
  const now = Date.now();
  const maxRequests = getMaxRequests();
  const timestamps = ipRequestHistory.get(ip) || [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= maxRequests) {
    return true;
  }

  recent.push(now);
  ipRequestHistory.set(ip, recent);
  return false;
}

export function resetRateLimiter(): void {
  ipRequestHistory.clear();
}

export interface RateLimitResult {
  limited: boolean;
  source: "in_memory" | "upstash_redis" | "fail_closed";
  reason?: "rate_limit_exceeded" | "service_unavailable" | "missing_config";
  currentCount?: number;
  error?: string;
}

/**
 * Atomic Redis Lua script for fixed-window rate limiting.
 * - Atomically executes INCR and sets TTL if newly created.
 * - Checks TTL and heals any key that lacks an expiration (ttl == -1).
 * - Returns the updated counter value as an integer.
 */
export const ATOMIC_FIXED_WINDOW_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
if ttl == -1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`.trim();

/**
 * Checks whether an IP has exceeded the allowed request limit.
 * Asynchronous to support remote Redis lookup in serverless environments.
 */
export async function checkRateLimit(ip: string): Promise<RateLimitResult> {
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const isProduction = process.env.NODE_ENV === "production";
  const requireDistributed = process.env.REQUIRE_DISTRIBUTED_RATE_LIMIT === "true";

  const hasDistributedConfig = Boolean(upstashUrl && upstashToken);

  // In production (or when explicitly required), missing configuration MUST fail closed.
  // Production CANNOT silently fall back to an in-memory limiter.
  if ((isProduction || requireDistributed) && !hasDistributedConfig) {
    console.error(
      "[rate-limit] Distributed rate limiting is required in production (or REQUIRE_DISTRIBUTED_RATE_LIMIT=true), but UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is missing. Failing closed."
    );
    return {
      limited: true,
      source: "fail_closed",
      reason: "missing_config",
      error: "Missing required distributed rate limiter configuration in production",
    };
  }

  // If distributed rate limiter credentials are provided, use Upstash Redis REST
  if (hasDistributedConfig) {
    try {
      // Validate URL format
      new URL(upstashUrl!);

      const maxRequests = getMaxRequests();
      // Sanitize key name to prevent command injection; never include requirements or secrets
      const safeIp = ip.replace(/[^a-zA-Z0-9_.:-]/g, "");
      const redisKey = `rl:${safeIp}`;

      // Atomic execution via Upstash Redis REST using EVAL command
      const endpoint = upstashUrl!.replace(/\/$/, "");
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${upstashToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          "EVAL",
          ATOMIC_FIXED_WINDOW_LUA,
          "1",
          redisKey,
          RATE_LIMIT_WINDOW_SECONDS.toString(),
        ]),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Upstash Redis HTTP ${response.status}: ${errText}`);
      }

      let data: any;
      try {
        data = await response.json();
      } catch (parseErr: any) {
        throw new Error(`Malformed JSON response from Upstash Redis: ${parseErr?.message}`);
      }

      if (data?.error) {
        throw new Error(`Upstash Redis returned error: ${data.error}`);
      }

      const incrResult = data?.result;
      if (typeof incrResult !== "number") {
        throw new Error(`Malformed Upstash Redis result: expected number, got ${typeof incrResult}`);
      }

      const limited = incrResult > maxRequests;
      return {
        limited,
        source: "upstash_redis",
        reason: limited ? "rate_limit_exceeded" : undefined,
        currentCount: incrResult,
      };
    } catch (err: any) {
      console.error(
        `[rate-limit] Distributed rate limiter error: ${err?.message || "Unknown error"}`
      );

      // In production or when strictly required, fail closed to protect upstream API costs
      if (isProduction || requireDistributed) {
        console.warn(
          "[rate-limit] Failing closed: blocking request because distributed rate limiter is required/configured but unavailable."
        );
        return {
          limited: true,
          source: "fail_closed",
          reason: "service_unavailable",
          error: err?.message,
        };
      }

      // In non-production, log warning and safely fall back to in-memory rate limiter
      console.warn(
        "[rate-limit] Distributed rate limiter unavailable; falling back to in-memory limiter in non-production."
      );
      const memLimited = isRateLimitedInMemory(ip);
      return {
        limited: memLimited,
        source: "in_memory",
        reason: memLimited ? "rate_limit_exceeded" : undefined,
      };
    }
  }

  // Local / Development fallback (when NODE_ENV !== "production")
  const memLimited = isRateLimitedInMemory(ip);
  return {
    limited: memLimited,
    source: "in_memory",
    reason: memLimited ? "rate_limit_exceeded" : undefined,
  };
}

/**
 * Backward-compatible helper returning a boolean promise.
 */
export async function isRateLimited(ip: string): Promise<boolean> {
  const result = await checkRateLimit(ip);
  return result.limited;
}
