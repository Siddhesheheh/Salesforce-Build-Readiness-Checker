import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkRateLimit,
  isRateLimited,
  isRateLimitedInMemory,
  resetRateLimiter,
  ATOMIC_FIXED_WINDOW_LUA,
} from "../lib/rate-limit";

describe("Rate Limiter", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetRateLimiter();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.REQUIRE_DISTRIBUTED_RATE_LIMIT;
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = originalEnv;
  });

  describe("In-Memory Sliding-Window Limiter (Local / Non-Production)", () => {
    it("allows up to 10 requests per hour per IP and blocks the 11th", async () => {
      const ip = "10.0.0.1";
      for (let i = 0; i < 10; i++) {
        const result = await checkRateLimit(ip);
        expect(result.limited).toBe(false);
        expect(result.source).toBe("in_memory");
      }

      // 11th request is blocked
      const blockedResult = await checkRateLimit(ip);
      expect(blockedResult.limited).toBe(true);
      expect(blockedResult.source).toBe("in_memory");
      expect(blockedResult.reason).toBe("rate_limit_exceeded");
    });

    it("tracks different IPs independently in memory", async () => {
      const ip1 = "10.0.0.1";
      const ip2 = "10.0.0.2";

      for (let i = 0; i < 10; i++) {
        await checkRateLimit(ip1);
      }
      expect((await checkRateLimit(ip1)).limited).toBe(true);

      // ip2 is completely independent and still allowed
      const result2 = await checkRateLimit(ip2);
      expect(result2.limited).toBe(false);
    });

    it("resets rate limit history when resetRateLimiter is called", async () => {
      const ip = "10.0.0.1";
      for (let i = 0; i < 10; i++) {
        await checkRateLimit(ip);
      }
      expect((await checkRateLimit(ip)).limited).toBe(true);

      resetRateLimiter();

      expect((await checkRateLimit(ip)).limited).toBe(false);
    });

    it("supports backward-compatible boolean helper isRateLimited", async () => {
      const ip = "10.0.0.5";
      for (let i = 0; i < 10; i++) {
        expect(await isRateLimited(ip)).toBe(false);
      }
      expect(await isRateLimited(ip)).toBe(true);
    });
  });

  describe("Distributed Atomic Fixed-Window Limiter via Upstash Redis REST", () => {
    beforeEach(() => {
      process.env.UPSTASH_REDIS_REST_URL = "https://example-upstash.upstash.io";
      process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
    });

    it("verifies the atomic Lua script executes INCR and guarantees EXPIRE", () => {
      // Must contain atomic INCR
      expect(ATOMIC_FIXED_WINDOW_LUA).toContain("redis.call('INCR', KEYS[1])");
      // Must set EXPIRE on first creation (current == 1)
      expect(ATOMIC_FIXED_WINDOW_LUA).toContain("redis.call('EXPIRE', KEYS[1], ARGV[1])");
      // Must check TTL and heal any key missing an expiration (ttl == -1)
      expect(ATOMIC_FIXED_WINDOW_LUA).toContain("redis.call('TTL', KEYS[1])");
      expect(ATOMIC_FIXED_WINDOW_LUA).toContain("if ttl == -1 then");
    });

    it("sends atomic EVAL payload without leaking requirement text or secrets", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: 3 }),
      } as any);

      const result = await checkRateLimit("192.168.1.50");
      expect(result.limited).toBe(false);
      expect(result.source).toBe("upstash_redis");
      expect(result.currentCount).toBe(3);

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toBe("https://example-upstash.upstash.io");
      expect(fetchCall[1].headers.Authorization).toBe("Bearer fake-token");

      const body = JSON.parse(fetchCall[1].body);
      expect(body[0]).toBe("EVAL");
      expect(body[1]).toBe(ATOMIC_FIXED_WINDOW_LUA);
      expect(body[2]).toBe("1");
      expect(body[3]).toBe("rl:192.168.1.50");
      expect(body[4]).toBe("3600");

      // Verify no sensitive requirement data in body
      expect(fetchCall[1].body).not.toContain("requirement");
      expect(fetchCall[1].body).not.toContain("org_context");
    });

    it("blocks request when Redis counter exceeds limit (>10)", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: 11 }),
      } as any);

      const result = await checkRateLimit("192.168.1.50");
      expect(result.limited).toBe(true);
      expect(result.source).toBe("upstash_redis");
      expect(result.reason).toBe("rate_limit_exceeded");
      expect(result.currentCount).toBe(11);
    });

    it("handles concurrent requests correctly", async () => {
      let counter = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        counter++;
        const currentCount = counter;
        return {
          ok: true,
          json: async () => ({ result: currentCount }),
        };
      });

      // Fire 15 concurrent requests
      const promises = Array.from({ length: 15 }, () => checkRateLimit("192.168.1.50"));
      const results = await Promise.all(promises);

      // First 10 should be allowed
      const allowed = results.filter((r) => !r.limited);
      const blocked = results.filter((r) => r.limited);

      expect(allowed.length).toBe(10);
      expect(blocked.length).toBe(5);
      for (const b of blocked) {
        expect(b.source).toBe("upstash_redis");
        expect(b.reason).toBe("rate_limit_exceeded");
      }
    });

    it("fails closed in production when Upstash returns HTTP 500 error", async () => {
      vi.stubEnv("NODE_ENV", "production");
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Upstash Outage",
      } as any);

      const result = await checkRateLimit("192.168.1.50");
      expect(result.limited).toBe(true);
      expect(result.source).toBe("fail_closed");
      expect(result.reason).toBe("service_unavailable");
      expect(result.error).toContain("500");
    });

    it("fails closed in production when Upstash fetch throws network failure", async () => {
      vi.stubEnv("NODE_ENV", "production");
      global.fetch = vi.fn().mockRejectedValue(new Error("Connection reset by peer"));

      const result = await checkRateLimit("192.168.1.50");
      expect(result.limited).toBe(true);
      expect(result.source).toBe("fail_closed");
      expect(result.reason).toBe("service_unavailable");
      expect(result.error).toContain("Connection reset");
    });

    it("fails closed in production on malformed non-JSON response", async () => {
      vi.stubEnv("NODE_ENV", "production");
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error("Unexpected token < in JSON");
        },
      } as any);

      const result = await checkRateLimit("192.168.1.50");
      expect(result.limited).toBe(true);
      expect(result.source).toBe("fail_closed");
      expect(result.reason).toBe("service_unavailable");
      expect(result.error).toContain("Malformed JSON");
    });

    it("fails closed in production on Redis error payload in JSON", async () => {
      vi.stubEnv("NODE_ENV", "production");
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ error: "ERR syntax error in script" }),
      } as any);

      const result = await checkRateLimit("192.168.1.50");
      expect(result.limited).toBe(true);
      expect(result.source).toBe("fail_closed");
      expect(result.reason).toBe("service_unavailable");
      expect(result.error).toContain("ERR syntax error");
    });

    it("fails closed in production on unexpected result data type", async () => {
      vi.stubEnv("NODE_ENV", "production");
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: "not-a-number" }),
      } as any);

      const result = await checkRateLimit("192.168.1.50");
      expect(result.limited).toBe(true);
      expect(result.source).toBe("fail_closed");
      expect(result.reason).toBe("service_unavailable");
      expect(result.error).toContain("expected number");
    });

    it("fails closed in production when Upstash credentials are completely missing (cannot silently fall back)", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      const result = await checkRateLimit("192.168.1.50");
      expect(result.limited).toBe(true);
      expect(result.source).toBe("fail_closed");
      expect(result.reason).toBe("missing_config");
      expect(result.error).toContain("Missing required distributed rate limiter configuration");
    });

    it("falls back to in-memory in development when Upstash fails without requireDistributed", async () => {
      vi.stubEnv("NODE_ENV", "development");
      global.fetch = vi.fn().mockRejectedValue(new Error("Dev offline"));

      const result = await checkRateLimit("192.168.1.50");
      expect(result.limited).toBe(false);
      expect(result.source).toBe("in_memory");
    });
  });
});
