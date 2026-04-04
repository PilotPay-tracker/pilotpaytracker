/**
 * Rate Limiting Middleware
 * Protects against abuse by limiting requests per user/IP
 */

import { type Context, type Next } from 'hono';
import { type AppType } from '../types';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store for rate limits (for SQLite/single-server deployment)
// In production with multiple servers, use Redis
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clear all entries on startup to avoid stale blocks from previous sessions
rateLimitStore.clear();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

interface RateLimitOptions {
  /** Maximum requests allowed in the window */
  max: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Key generator - defaults to user ID or IP */
  keyGenerator?: (c: Context<AppType>) => string;
  /** Message to return when rate limited */
  message?: string;
}

/**
 * Create a rate limiting middleware
 */
export function rateLimit(options: RateLimitOptions) {
  const {
    max,
    windowMs,
    keyGenerator = defaultKeyGenerator,
    message = 'Too many requests, please try again later',
  } = options;

  return async (c: Context<AppType>, next: Next) => {
    const key = keyGenerator(c);
    const now = Date.now();

    let entry = rateLimitStore.get(key);

    if (!entry || entry.resetAt < now) {
      // New window
      entry = { count: 1, resetAt: now + windowMs };
      rateLimitStore.set(key, entry);
    } else {
      // Existing window - increment
      entry.count++;
    }

    // Set rate limit headers
    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      c.header('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return c.json({ error: message }, 429);
    }

    return next();
  };
}

/**
 * Default key generator - uses user ID if authenticated, otherwise IP
 */
function defaultKeyGenerator(c: Context<AppType>): string {
  const user = c.get('user');
  if (user?.id) {
    return `user:${user.id}`;
  }

  // Fall back to IP address
  const forwarded = c.req.header('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
  return `ip:${ip}`;
}

// Pre-configured rate limiters for common use cases

/** Standard API rate limit: 600 requests per minute */
export const standardRateLimit = rateLimit({
  max: 600,
  windowMs: 60 * 1000,
});

/** Auth rate limit: 50 attempts per 15 minutes (increased for development) */
export const authRateLimit = rateLimit({
  max: 50,
  windowMs: 15 * 60 * 1000,
  message: 'Too many authentication attempts, please try again in 15 minutes',
});

/** Upload rate limit: 100 uploads per hour (increased for development) */
export const uploadRateLimit = rateLimit({
  max: 100,
  windowMs: 60 * 60 * 1000,
  message: 'Upload limit reached, please try again later',
});

/** AI/expensive operations: 30 requests per hour */
export const aiRateLimit = rateLimit({
  max: 30,
  windowMs: 60 * 60 * 1000,
  message: 'AI processing limit reached, please try again later',
});
