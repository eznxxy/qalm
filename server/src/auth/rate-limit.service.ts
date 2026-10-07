import { Injectable } from '@nestjs/common';

/**
 * In-memory login rate limit, docs/api-auth.md § login:
 * 10 failed attempts per (email + IP) in 15 minutes -> 429 with Retry-After.
 *
 * Deliberately per-process (contract: "in-memory is acceptable for MVP") and
 * failure-counting only: successful logins reset the counter. The map is
 * bounded — expired keys are swept whenever it grows past SWEEP_THRESHOLD.
 */
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const RATE_LIMIT_MAX_FAILURES = 10;

const SWEEP_THRESHOLD = 10_000;

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the oldest failure leaves the window; set when blocked. */
  retryAfterSeconds?: number;
}

@Injectable()
export class RateLimitService {
  /** key -> timestamps (ms) of failed attempts inside the window */
  private failures = new Map<string, number[]>();

  check(key: string, now = Date.now()): RateLimitDecision {
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    const stamps = this.prune(this.failures.get(key) ?? [], windowStart);
    if (stamps.length >= RATE_LIMIT_MAX_FAILURES) {
      const oldest = stamps[0];
      if (oldest === undefined) {
        return { allowed: true };
      }
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000)),
      };
    }
    return { allowed: true };
  }

  registerFailure(key: string, now = Date.now()): void {
    if (this.failures.size > SWEEP_THRESHOLD) {
      this.sweep(now);
    }
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    const stamps = this.prune(this.failures.get(key) ?? [], windowStart);
    stamps.push(now);
    this.failures.set(key, stamps);
  }

  /** Successful authentication clears the counter for that key. */
  clear(key: string): void {
    this.failures.delete(key);
  }

  /** Test/ops hook: forget everything. */
  reset(): void {
    this.failures.clear();
  }

  private prune(stamps: number[], windowStart: number): number[] {
    const kept = stamps.filter((t) => t > windowStart);
    return kept;
  }

  private sweep(now: number): void {
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    for (const [key, stamps] of this.failures) {
      if (!stamps.some((t) => t > windowStart)) {
        this.failures.delete(key);
      }
    }
  }
}

/** Builds the limiter key: lowercased email + client IP (contract: email+IP). */
export function rateLimitKey(email: string, ip: string): string {
  return `${email.trim().toLowerCase()}|${ip}`;
}
