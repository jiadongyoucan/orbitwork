import type { FastifyRequest } from 'fastify';
import { rateLimited } from '../domain/errors.js';

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** In-process fixed-window limiter; cheap and contention-free for a single instance. */
export function checkRate(request: FastifyRequest, action: string, limit: number, windowMs: number): void {
  checkRateKey(`${action}:${request.ip}`, limit, windowMs);
}

/** Account/identity-scoped limit that survives IP rotation. */
export function checkRateKey(key: string, limit: number, windowMs: number): void {
  const current = buckets.get(key);
  const timestamp = Date.now();
  if (!current || current.resetAt < timestamp) {
    buckets.set(key, { count: 1, resetAt: timestamp + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (v.resetAt < timestamp) buckets.delete(k);
    }
    return;
  }
  current.count += 1;
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.resetAt < timestamp) buckets.delete(k);
  }
  if (current.count > limit) throw rateLimited();
}

export function clearRateKey(key: string): void {
  buckets.delete(key);
}

export function resetRates(): void {
  buckets.clear();
}
