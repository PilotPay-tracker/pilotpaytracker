/**
 * Sick Time Tracker API Routes
 *
 * IMPORTANT: This is for PERSONAL RECORD-KEEPING ONLY
 * Does NOT submit, modify, validate, or sync with payroll, scheduling, or company systems
 * All values are user-entered or estimated for reference
 */

import { Hono } from 'hono';
import { db } from '../db';
import { type AppType } from '../types';

const app = new Hono<AppType>();

// ============================================================
// PHASE 1: SICK BANK SETUP
// ============================================================

/**
 * GET /api/sick-tracker/bank
 * Get user's sick bank (creates if doesn't exist)
 */
app.get('/bank', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  try {
    // Get or create sick bank
    let sickBank = await db.sickBank.findUnique({
      where: { userId: user.id },
    });

    if (!sickBank) {
      // Get hourly rate from profile if available
      const profile = await db.profile.findUnique({
        where: { userId: user.id },
        select: { hourlyRateCents: true },
      });

      sickBank = await db.sickBank.create({
        data: {
          userId: user.id,
          balanceHours: 0,
          capHours: 1200,
          capReached: false,
          accrualRateHours: 5.5,
          hourlyRateCentsOverride: profile?.hourlyRateCents ?? null,
        },
      });
    }

    // Calculate payout estimator
    const hourlyRateCents = sickBank.hourlyRateCentsOverride ?? 32500; // Default $325/hr
    const eligibleHours = Math.max(0, sickBank.balanceHours - 75);
    const estimatedPayoutCents = Math.round(eligibleHours * hourlyRateCents);

    return c.json({
      ...sickBank,
      payoutEstimate: {
        eligibleHours,
        estimatedPayoutCents,
        hourlyRateCents,
        note: 'Estimate only — personal reference',
      },
    });
  } catch (error) {
    console.error('[SickTracker] Error fetching bank:', error);
    return c.json({ error: 'Failed to fetch sick bank' }, 500);
  }
});

/**
 * PUT /api/sick-tracker/bank
 * Update sick bank balance or settings
 */
app.put('/bank', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const body = await c.req.json();
    const { balanceHours, accrualRateHours, hourlyRateCentsOverride, capHours } = body;

    // Build update object
    const updateData: Record<string, unknown> = {};

    if (typeof balanceHours === 'number') {
      updateData.balanceHours = Math.max(0, balanceHours);
      // Check if cap is reached
      const cap = typeof capHours === 'number' ? capHours : 1200;
      updateData.capReached = balanceHours >= cap;
    }

    if (typeof accrualRateHours === 'number') {
      updateData.accrualRateHours = Math.max(0, accrualRateHours);
    }

    if (typeof hourlyRateCentsOverride === 'number' || hourlyRateCentsOverride === null) {
      updateData.hourlyRateCentsOverride = hourlyRateCentsOverride;
    }

    if (typeof capHours === 'number') {
      updateData.capHours = Math.max(0, capHours);
      // Recalculate cap reached if balance is provided
      if (typeof balanceHours === 'number') {
        updateData.capReached = balanceHours >= capHours;
      }
    }

    // Upsert sick bank
    const sickBank = await db.sickBank.upsert({
      where: { userId: user.id },
      update: updateData,
      create: {
        userId: user.id,
        balanceHours: typeof balanceHours === 'number' ? balanceHours : 0,
        capHours: typeof capHours === 'number' ? capHours : 1200,
        capReached: typeof balanceHours === 'number' && typeof capHours === 'number' ? balanceHours >= capHours : false,
        accrualRateHours: typeof accrualRateHours === 'number' ? accrualRateHours : 5.5,
        hourlyRateCentsOverride: typeof hourlyRateCentsOverride === 'number' ? hourlyRateCentsOverride : null,
      },
    });

    // Calculate payout estimator
    const hourlyRateCents = sickBank.hourlyRateCentsOverride ?? 32500;
    const eligibleHours = Math.max(0, sickBank.balanceHours - 75);
    const estimatedPayoutCents = Math.round(eligibleHours * hourlyRateCents);

    return c.json({
      ...sickBank,
      payoutEstimate: {
        eligibleHours,
        estimatedPayoutCents,
        hourlyRateCents,
        note: 'Estimate only — personal reference',
      },
    });
  } catch (error) {
    console.error('[SickTracker] Error updating bank:', error);
    return c.json({ error: 'Failed to update sick bank' }, 500);
  }
});

// ============================================================
// PHASE 2: ACCRUAL LOGIC
// ============================================================

/**
 * GET /api/sick-tracker/accruals
 * Get accrual history
 */
app.get('/accruals', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const accruals = await db.sickAccrualLog.findMany({
      where: { userId: user.id },
      orderBy: { periodMonth: 'desc' },
      take: 24, // Last 24 months
    });

    return c.json({ accruals });
  } catch (error) {
    console.error('[SickTracker] Error fetching accruals:', error);
    return c.json({ error: 'Failed to fetch accruals' }, 500);
  }
});

/**
 * POST /api/sick-tracker/accruals
 * Record an accrual (manual or automatic)
 */
app.post('/accruals', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const body = await c.req.json();
    const { periodMonth, accruedHours, notes } = body;

    if (!periodMonth || typeof accruedHours !== 'number') {
      return c.json({ error: 'periodMonth and accruedHours are required' }, 400);
    }

    // Get current sick bank
    const sickBank = await db.sickBank.findUnique({
      where: { userId: user.id },
    });

    if (!sickBank) {
      return c.json({ error: 'Sick bank not set up. Please set up your sick bank first.' }, 400);
    }

    // Check if cap would be reached
    const blockedByCap = sickBank.balanceHours >= sickBank.capHours;
    const actualAccrual = blockedByCap ? 0 : Math.min(accruedHours, sickBank.capHours - sickBank.balanceHours);
    const finalBalance = sickBank.balanceHours + actualAccrual;

    // Calculate YTD
    const year = periodMonth.slice(0, 4);
    const ytdAccruals = await db.sickAccrualLog.findMany({
      where: {
        userId: user.id,
        periodMonth: {
          startsWith: year,
        },
      },
    });
    const ytdPreviousTotal = ytdAccruals.reduce((sum, a) => sum + a.accruedHours, 0);
    const ytdTotalHours = ytdPreviousTotal + actualAccrual;

    // Upsert accrual log
    const accrual = await db.sickAccrualLog.upsert({
      where: {
        userId_periodMonth: { userId: user.id, periodMonth },
      },
      update: {
        accruedHours: actualAccrual,
        ytdTotalHours,
        balanceAfter: finalBalance,
        blockedByCap,
        notes,
      },
      create: {
        userId: user.id,
        periodMonth,
        accruedHours: actualAccrual,
        ytdTotalHours,
        balanceAfter: finalBalance,
        blockedByCap,
        notes,
      },
    });

    // Update sick bank balance
    await db.sickBank.update({
      where: { userId: user.id },
      data: {
        balanceHours: finalBalance,
        capReached: finalBalance >= sickBank.capHours,
      },
    });

    return c.json({
      accrual,
      sickBank: {
        balanceHours: finalBalance,
        capReached: finalBalance >= sickBank.capHours,
      },
    });
  } catch (error) {
    console.error('[SickTracker] Error recording accrual:', error);
    return c.json({ error: 'Failed to record accrual' }, 500);
  }
});

// ============================================================
// PHASE 3-4: SICK USAGE LOGGING
// ============================================================

/**
 * GET /api/sick-tracker/usage
 * Get sick usage history
 */
app.get('/usage', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const usage = await db.sickUsageLog.findMany({
      where: { userId: user.id, status: 'active' },
      orderBy: { startDate: 'desc' },
      include: {
        attachments: true,
      },
    });

    return c.json({ usage });
  } catch (error) {
    console.error('[SickTracker] Error fetching usage:', error);
    return c.json({ error: 'Failed to fetch usage' }, 500);
  }
});

/**
 * POST /api/sick-tracker/usage
 * Record sick usage (deduction)
 */
app.post('/usage', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const body = await c.req.json();
    const {
      startDate,
      endDate,
      hoursUsed,
      tripId,
      tripNumber,
      continuousCallId,
      userNotes,
      autoSummary,
    } = body;

    if (!startDate || !endDate || typeof hoursUsed !== 'number') {
      return c.json({ error: 'startDate, endDate, and hoursUsed are required' }, 400);
    }

    // Get current sick bank
    const sickBank = await db.sickBank.findUnique({
      where: { userId: user.id },
    });

    if (!sickBank) {
      return c.json({ error: 'Sick bank not set up. Please set up your sick bank first.' }, 400);
    }

    const balanceBefore = sickBank.balanceHours;
    const balanceAfter = Math.max(0, balanceBefore - hoursUsed);

    // Determine coverage status
    let coverageStatus = 'FULL';
    if (balanceBefore < hoursUsed) {
      coverageStatus = balanceBefore <= 0 ? 'NONE' : 'PARTIAL';
    }

    // Create usage log (immutable record)
    const usageLog = await db.sickUsageLog.create({
      data: {
        userId: user.id,
        startDate,
        endDate,
        hoursUsed,
        tripId,
        tripNumber,
        coverageStatus,
        balanceBefore,
        balanceAfter,
        continuousCallId: continuousCallId || `call_${Date.now()}`,
        userNotes,
        autoSummary: autoSummary || `Sick time used: ${hoursUsed} hours (${startDate} to ${endDate})`,
        status: 'active',
      },
    });

    // Update sick bank balance
    await db.sickBank.update({
      where: { userId: user.id },
      data: {
        balanceHours: balanceAfter,
        capReached: balanceAfter >= sickBank.capHours,
      },
    });

    return c.json({
      usageLog,
      sickBank: {
        balanceHours: balanceAfter,
        balanceBefore,
        capReached: balanceAfter >= sickBank.capHours,
      },
    });
  } catch (error) {
    console.error('[SickTracker] Error recording usage:', error);
    return c.json({ error: 'Failed to record usage' }, 500);
  }
});

// ============================================================
// PHASE 5: ROLLING 12-MONTH SUMMARY
// ============================================================

/**
 * GET /api/sick-tracker/summary
 * Get rolling 12-month sick summary
 */
app.get('/summary', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  try {
    // Get date 365 days ago
    const oneYearAgo = new Date();
    oneYearAgo.setDate(oneYearAgo.getDate() - 365);
    const oneYearAgoStr = oneYearAgo.toISOString().slice(0, 10);

    // Get usage in rolling 12-month window
    const usage = await db.sickUsageLog.findMany({
      where: {
        userId: user.id,
        status: 'active',
        startDate: { gte: oneYearAgoStr },
      },
      orderBy: { startDate: 'desc' },
    });

    // Count unique continuous calls (one continuous sick call = one event)
    const uniqueCallIds = new Set(usage.map(u => u.continuousCallId));
    const eventCount = uniqueCallIds.size;

    // Total hours used
    const totalHoursUsed = usage.reduce((sum, u) => sum + u.hoursUsed, 0);

    // Average hours per event
    const avgHoursPerEvent = eventCount > 0 ? totalHoursUsed / eventCount : 0;

    // Get sick bank for current balance
    const sickBank = await db.sickBank.findUnique({
      where: { userId: user.id },
    });

    return c.json({
      rolling12Month: {
        eventCount,
        totalHoursUsed: Math.round(totalHoursUsed * 10) / 10,
        avgHoursPerEvent: Math.round(avgHoursPerEvent * 10) / 10,
        windowStartDate: oneYearAgoStr,
        windowEndDate: new Date().toISOString().slice(0, 10),
      },
      currentBalance: sickBank?.balanceHours ?? 0,
      capReached: sickBank?.capReached ?? false,
      recentEvents: usage.slice(0, 5).map(u => ({
        id: u.id,
        startDate: u.startDate,
        endDate: u.endDate,
        hoursUsed: u.hoursUsed,
        coverageStatus: u.coverageStatus,
        tripNumber: u.tripNumber,
      })),
    });
  } catch (error) {
    console.error('[SickTracker] Error fetching summary:', error);
    return c.json({ error: 'Failed to fetch summary' }, 500);
  }
});

// ============================================================
// PHASE 7: ATTACHMENTS
// ============================================================

/**
 * POST /api/sick-tracker/usage/:usageId/attachments
 * Add attachment to sick usage event
 */
app.post('/usage/:usageId/attachments', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const { usageId } = c.req.param();
    const body = await c.req.json();
    const { fileName, fileUrl, mimeType, fileSize, description } = body;

    if (!fileName || !fileUrl) {
      return c.json({ error: 'fileName and fileUrl are required' }, 400);
    }

    // Verify usage belongs to user
    const usage = await db.sickUsageLog.findFirst({
      where: { id: usageId, userId: user.id },
    });

    if (!usage) {
      return c.json({ error: 'Sick usage event not found' }, 404);
    }

    const attachment = await db.sickUsageAttachment.create({
      data: {
        sickUsageId: usageId,
        fileName,
        fileUrl,
        mimeType: mimeType || 'application/octet-stream',
        fileSize: fileSize || 0,
        description,
      },
    });

    return c.json({ attachment });
  } catch (error) {
    console.error('[SickTracker] Error adding attachment:', error);
    return c.json({ error: 'Failed to add attachment' }, 500);
  }
});

/**
 * DELETE /api/sick-tracker/usage/:usageId/attachments/:attachmentId
 * Remove attachment
 */
app.delete('/usage/:usageId/attachments/:attachmentId', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const { usageId, attachmentId } = c.req.param();

    // Verify usage belongs to user
    const usage = await db.sickUsageLog.findFirst({
      where: { id: usageId, userId: user.id },
    });

    if (!usage) {
      return c.json({ error: 'Sick usage event not found' }, 404);
    }

    await db.sickUsageAttachment.delete({
      where: { id: attachmentId },
    });

    return c.json({ success: true });
  } catch (error) {
    console.error('[SickTracker] Error deleting attachment:', error);
    return c.json({ error: 'Failed to delete attachment' }, 500);
  }
});

export default app;
