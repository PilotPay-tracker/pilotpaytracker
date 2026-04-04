/**
 * PHASE 7 — PREMIUM CODES ROUTES
 *
 * Provides:
 * - List all premium codes
 * - Get premium code by ID or code
 * - Seed premium codes
 * - Calculate premium pay
 * - Auto-suggest premiums based on change type
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { type AppType } from '../types';
import { db } from '../db';
import {
  seedPremiumCodes,
  calculateFixedPremiumPay,
  calculateMultiplierPremiumPay,
  ALL_PREMIUM_CODES,
} from '../lib/premium-codes-seed';

const premiumCodesRouter = new Hono<AppType>();

// ============================================
// GET /api/premium-codes - List all premium codes
// ============================================
premiumCodesRouter.get('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const premiumType = c.req.query('type'); // 'fixed_minutes' | 'multiplier'

  const codes = await db.premiumCode.findMany({
    where: {
      isActive: true,
      ...(premiumType ? { premiumType } : {}),
    },
    orderBy: { sortOrder: 'asc' },
  });

  return c.json({ premiumCodes: codes });
});

// ============================================
// GET /api/premium-codes/seed - Seed premium codes
// ============================================
premiumCodesRouter.get('/seed', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const result = await seedPremiumCodes();

  return c.json({
    success: true,
    ...result,
    message: `Seeded ${result.created} new codes, updated ${result.updated} existing codes`,
  });
});

// ============================================
// GET /api/premium-codes/:code - Get premium code by code
// ============================================
premiumCodesRouter.get('/:code', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const code = c.req.param('code').toUpperCase();

  const premiumCode = await db.premiumCode.findFirst({
    where: {
      code,
      isActive: true,
    },
  });

  if (!premiumCode) {
    return c.json({ error: 'Premium code not found' }, 404);
  }

  return c.json({ premiumCode });
});

// ============================================
// POST /api/premium-codes/calculate - Calculate premium pay
// ============================================
const calculatePremiumSchema = z.object({
  code: z.string(),
  // For fixed premiums
  customMinutes: z.number().optional(), // If user wants custom minutes instead of default
  hourlyRateCents: z.number(),
  // For multiplier premiums (late arrival)
  scheduledEndISO: z.string().optional(),
  actualArrivalISO: z.string().optional(),
  useVariant: z.boolean().optional(), // Use variant minutes if available
});

premiumCodesRouter.post('/calculate', zValidator('json', calculatePremiumSchema), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const body = c.req.valid('json');

  // Find the premium code
  const premiumCode = await db.premiumCode.findFirst({
    where: {
      code: body.code.toUpperCase(),
      isActive: true,
    },
  });

  if (!premiumCode) {
    return c.json({ error: 'Premium code not found' }, 404);
  }

  // Handle both old 'fixed_minutes' and new 'minutes' type
  if (premiumCode.premiumType === 'fixed_minutes' || premiumCode.premiumType === 'minutes') {
    // Fixed minutes premium calculation
    let minutes = body.customMinutes;

    if (minutes === undefined) {
      // Use variant or default minutes
      if (body.useVariant && premiumCode.hasVariants && premiumCode.variantMinutes) {
        minutes = premiumCode.variantMinutes;
      } else {
        minutes = premiumCode.premiumMinutes ?? 0;
      }
    }

    const premiumPayCents = calculateFixedPremiumPay(minutes, body.hourlyRateCents);

    return c.json({
      code: premiumCode.code,
      title: premiumCode.title,
      name: premiumCode.name ?? premiumCode.title, // Backwards compatibility
      premiumType: premiumCode.premiumType,
      premiumMinutes: minutes,
      premiumPayCents,
      formattedPremium: `+${Math.floor(minutes / 60)}:${(minutes % 60).toString().padStart(2, '0')}`,
      formattedPay: `$${(premiumPayCents / 100).toFixed(2)}`,
      contractRef: premiumCode.contractRef,
      notes: premiumCode.notes,
    });
  }

  if (premiumCode.premiumType === 'multiplier') {
    // Multiplier premium calculation (late arrival)
    if (!body.scheduledEndISO || !body.actualArrivalISO) {
      return c.json({ error: 'scheduledEndISO and actualArrivalISO required for multiplier premiums' }, 400);
    }

    const calculation = calculateMultiplierPremiumPay({
      scheduledEndISO: body.scheduledEndISO,
      actualArrivalISO: body.actualArrivalISO,
      hourlyRateCents: body.hourlyRateCents,
      multiplier: premiumCode.premiumMultiplier ?? 1.5,
    });

    return c.json({
      code: premiumCode.code,
      title: premiumCode.title,
      name: premiumCode.name ?? premiumCode.title, // Backwards compatibility
      premiumType: 'multiplier',
      multiplier: premiumCode.premiumMultiplier,
      lateMinutes: calculation.lateMinutes,
      formattedLateTime: `${Math.floor(calculation.lateMinutes / 60)}:${(calculation.lateMinutes % 60).toString().padStart(2, '0')}`,
      basePayCents: calculation.basePayCents,
      premiumPayCents: calculation.premiumPayCents,
      totalPayCents: calculation.totalPayCents,
      formattedBasePay: `$${(calculation.basePayCents / 100).toFixed(2)}`,
      formattedPremiumPay: `$${(calculation.premiumPayCents / 100).toFixed(2)}`,
      formattedTotalPay: `$${(calculation.totalPayCents / 100).toFixed(2)}`,
      contractRef: premiumCode.contractRef,
      notes: premiumCode.notes,
    });
  }

  // Handle 'manual' type - return code info without calculation
  if (premiumCode.premiumType === 'manual') {
    return c.json({
      code: premiumCode.code,
      title: premiumCode.title,
      name: premiumCode.name ?? premiumCode.title,
      premiumType: 'manual',
      requiresInputs: premiumCode.requiresInputsJson ? JSON.parse(premiumCode.requiresInputsJson) : [],
      message: 'Manual entry required - premium varies based on specifics',
      contractRef: premiumCode.contractRef,
      notes: premiumCode.notes,
    });
  }

  return c.json({ error: 'Unknown premium type' }, 400);
});

// ============================================
// POST /api/premium-codes/suggest - Auto-suggest premiums
// Based on detected change type and context
// ============================================
const suggestPremiumsSchema = z.object({
  changeType: z.string(), // e.g., 'layover_shortened', 'leg_added', 'late_arrival', etc.
  context: z.object({
    // Optional context for better suggestions
    tripId: z.string().optional(),
    originalLayoverMinutes: z.number().optional(),
    newLayoverMinutes: z.number().optional(),
    legsAdded: z.number().optional(),
    legsRemoved: z.number().optional(),
    scheduledEndISO: z.string().optional(),
    actualArrivalISO: z.string().optional(),
    hourlyRateCents: z.number().optional(),
  }).optional(),
});

premiumCodesRouter.post('/suggest', zValidator('json', suggestPremiumsSchema), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const body = c.req.valid('json');

  // Get all active premium codes
  const codes = await db.premiumCode.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });

  // Map change types to contexts
  const CHANGE_TYPE_CONTEXTS: Record<string, string[]> = {
    layover_shortened: ['layover_change', 'layover_shortened'],
    layover_extended: ['layover_change', 'layover_extended'],
    leg_added: ['leg_added', 'segment_added'],
    leg_removed: ['schedule_change'],
    route_change: ['trip_substituted', 'reroute'],
    timing_change: ['timing_change', 'early_start'],
    duty_extension: ['duty_extension', 'late_arrival'],
    late_arrival: ['late_arrival'],
    trip_canceled: ['trip_canceled'],
    trip_substituted: ['trip_substituted', 'reroute'],
    reserve_callout: ['reserve', 'cq', 'turned_out'],
    jumpseat: ['jumpseat', 'assignment'],
    credit_reduced: ['schedule_change', 'pay_protection'],
  };

  // Get matching contexts
  const matchingContexts = CHANGE_TYPE_CONTEXTS[body.changeType] ?? [body.changeType];

  // Find matching premium codes
  const suggestions: Array<{
    code: string;
    title: string;
    description: string | null;
    category: string;
    premiumType: string;
    premiumMinutes: number | null;
    premiumMultiplier: number | null;
    eligibility: string | null;
    tripType: string | null;
    contractRef: string | null;
    notes: string | null;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
    estimatedPayCents?: number;
  }> = [];

  for (const code of codes) {
    let applicableContexts: string[] = [];
    try {
      applicableContexts = code.applicableContext ? JSON.parse(code.applicableContext) : [];
    } catch {
      applicableContexts = [];
    }

    // Check if any context matches
    const matchFound = applicableContexts.some((ctx: string) => matchingContexts.includes(ctx));

    if (matchFound) {
      // Determine confidence based on match quality
      let confidence: 'high' | 'medium' | 'low' = 'medium';
      let reason = `Matches ${body.changeType} context`;

      // High confidence for exact context matches
      if (applicableContexts.includes(body.changeType)) {
        confidence = 'high';
        reason = `Direct match for ${body.changeType}`;
      }

      // Calculate estimated pay if context provides enough info
      let estimatedPayCents: number | undefined;
      if ((code.premiumType === 'minutes' || code.premiumType === 'fixed_minutes') && code.premiumMinutes && body.context?.hourlyRateCents) {
        estimatedPayCents = calculateFixedPremiumPay(code.premiumMinutes, body.context.hourlyRateCents);
      }

      suggestions.push({
        code: code.code,
        title: code.title,
        description: code.description,
        category: code.category,
        premiumType: code.premiumType,
        premiumMinutes: code.premiumMinutes,
        premiumMultiplier: code.premiumMultiplier,
        eligibility: code.eligibility,
        tripType: code.tripType,
        contractRef: code.contractRef,
        notes: code.notes,
        confidence,
        reason,
        estimatedPayCents,
      });
    }
  }

  // Sort by confidence (high first), then by sort order
  suggestions.sort((a, b) => {
    const confidenceOrder = { high: 0, medium: 1, low: 2 };
    if (confidenceOrder[a.confidence] !== confidenceOrder[b.confidence]) {
      return confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
    }
    return 0;
  });

  return c.json({
    changeType: body.changeType,
    suggestions,
    suggestedCount: suggestions.length,
  });
});

export { premiumCodesRouter };
