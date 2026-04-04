/**
 * Referral System Routes
 *
 * Handles crew referrals - users can share their code with other pilots
 * who get 50% off their first payment. Each user can only be referred once.
 */

import { Hono } from "hono";
import { db } from "../db";
import { type AppType } from "../types";

const referralsRouter = new Hono<AppType>();

// Generate a unique referral code for a user (e.g., PILOT-A7B3)
function generateReferralCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Exclude confusing characters
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `PILOT-${code}`;
}

/**
 * GET /api/referrals/my-code
 * Get or create the current user's referral code
 */
referralsRouter.get("/my-code", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    // Check if user already has a referral code
    let referral = await db.referral.findFirst({
      where: {
        referrerId: user.id,
        referredUserId: null, // Find their "master" referral entry (unused)
      },
    });

    // If no code exists, create one
    if (!referral) {
      // Generate unique code with retry
      let code = generateReferralCode();
      let attempts = 0;
      while (attempts < 10) {
        const existing = await db.referral.findUnique({
          where: { referrerCode: code },
        });
        if (!existing) break;
        code = generateReferralCode();
        attempts++;
      }

      referral = await db.referral.create({
        data: {
          referrerId: user.id,
          referrerCode: code,
          status: "pending",
          discountPercent: 50,
        },
      });

      // Initialize stats for this user
      await db.referralStats.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id },
      });
    }

    return c.json({
      code: referral.referrerCode,
      discountPercent: referral.discountPercent,
    });
  } catch (error) {
    console.error("[Referrals] Error getting/creating referral code:", error);
    return c.json({ error: "Failed to get referral code" }, 500);
  }
});

/**
 * GET /api/referrals/stats
 * Get referral statistics for the current user
 */
referralsRouter.get("/stats", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    // Get or create stats
    const stats = await db.referralStats.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });

    // Get detailed referrals
    const referrals = await db.referral.findMany({
      where: {
        referrerId: user.id,
        referredUserId: { not: null }, // Only actual referrals (not the code holder)
      },
      orderBy: { createdAt: "desc" },
    });

    return c.json({
      stats: {
        totalReferrals: stats.totalReferrals,
        successfulReferrals: stats.successfulReferrals,
        pendingReferrals: stats.pendingReferrals,
        totalRewardsCents: stats.totalRewardsCents,
        freeMonthsEarned: stats.freeMonthsEarned,
      },
      referrals: referrals.map((r) => ({
        id: r.id,
        status: r.status,
        signedUpAt: r.signedUpAt,
        subscribedAt: r.subscribedAt,
        discountPercent: r.discountPercent,
      })),
    });
  } catch (error) {
    console.error("[Referrals] Error getting stats:", error);
    return c.json({ error: "Failed to get referral stats" }, 500);
  }
});

/**
 * POST /api/referrals/validate
 * Validate a referral code (used during sign-up)
 */
referralsRouter.post("/validate", async (c) => {
  const body = await c.req.json();
  const { code } = body as { code?: string };

  if (!code) {
    return c.json({ error: "Referral code is required" }, 400);
  }

  try {
    // Find the referral code
    const referral = await db.referral.findUnique({
      where: { referrerCode: code.toUpperCase() },
    });

    if (!referral) {
      return c.json({
        valid: false,
        error: "Invalid referral code",
      });
    }

    // Code is valid - return discount info
    return c.json({
      valid: true,
      discountPercent: referral.discountPercent,
      message: `You'll get ${referral.discountPercent}% off your first payment!`,
    });
  } catch (error) {
    console.error("[Referrals] Error validating code:", error);
    return c.json({ error: "Failed to validate referral code" }, 500);
  }
});

/**
 * POST /api/referrals/apply
 * Apply a referral code to a newly signed up user
 * This is called after the user creates an account
 */
referralsRouter.post("/apply", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json();
  const { code } = body as { code?: string };

  if (!code) {
    return c.json({ error: "Referral code is required" }, 400);
  }

  try {
    // Check if user has already been referred
    const existingReferral = await db.referral.findFirst({
      where: { referredUserId: user.id },
    });

    if (existingReferral) {
      return c.json({
        success: false,
        error: "You have already used a referral code",
      });
    }

    // Find the referral code
    const referral = await db.referral.findUnique({
      where: { referrerCode: code.toUpperCase() },
    });

    if (!referral) {
      return c.json({
        success: false,
        error: "Invalid referral code",
      });
    }

    // Don't let users refer themselves
    if (referral.referrerId === user.id) {
      return c.json({
        success: false,
        error: "You cannot use your own referral code",
      });
    }

    // Create a new referral entry for this referred user
    await db.referral.create({
      data: {
        referrerId: referral.referrerId,
        referrerCode: `${referral.referrerCode}-${user.id.slice(0, 6)}`, // Unique per referral
        referredUserId: user.id,
        status: "signed_up",
        signedUpAt: new Date(),
        discountPercent: referral.discountPercent,
      },
    });

    // Update referrer's stats
    await db.referralStats.update({
      where: { userId: referral.referrerId },
      data: {
        totalReferrals: { increment: 1 },
        pendingReferrals: { increment: 1 },
      },
    });

    return c.json({
      success: true,
      discountPercent: referral.discountPercent,
      message: `Referral applied! You'll get ${referral.discountPercent}% off your first payment.`,
    });
  } catch (error) {
    console.error("[Referrals] Error applying referral:", error);
    return c.json({ error: "Failed to apply referral code" }, 500);
  }
});

/**
 * GET /api/referrals/my-discount
 * Check if the current user has a referral discount available
 */
referralsRouter.get("/my-discount", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    // Find if user was referred
    const referral = await db.referral.findFirst({
      where: {
        referredUserId: user.id,
        status: "signed_up", // Not yet subscribed
      },
    });

    if (!referral) {
      return c.json({
        hasDiscount: false,
      });
    }

    return c.json({
      hasDiscount: true,
      discountPercent: referral.discountPercent,
      message: `You have ${referral.discountPercent}% off your first payment!`,
    });
  } catch (error) {
    console.error("[Referrals] Error checking discount:", error);
    return c.json({ error: "Failed to check discount" }, 500);
  }
});

/**
 * POST /api/referrals/mark-subscribed
 * Called when a referred user subscribes (triggered from sync-revenuecat)
 * Marks the referral as successful and grants 1 free month per every 3 successful referrals
 * by extending the referrer's subscriptionEndDate by 30 days.
 */
referralsRouter.post("/mark-subscribed", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    // Find the referral for this user (the person who just subscribed)
    const referral = await db.referral.findFirst({
      where: {
        referredUserId: user.id,
        status: "signed_up",
      },
    });

    if (!referral) {
      return c.json({ success: true, message: "No pending referral" });
    }

    // Mark this referral as subscribed
    await db.referral.update({
      where: { id: referral.id },
      data: {
        status: "subscribed",
        subscribedAt: new Date(),
        rewardAppliedAt: new Date(),
      },
    });

    // Increment referrer's successful referral count
    const updatedStats = await db.referralStats.update({
      where: { userId: referral.referrerId },
      data: {
        successfulReferrals: { increment: 1 },
        pendingReferrals: { decrement: 1 },
      },
    });

    // Check if referrer earns a free month (every 3 successful referrals)
    const totalSuccessful = updatedStats.successfulReferrals;
    const freeMonthsOwed = Math.floor(totalSuccessful / 3);
    const freeMonthsAlreadyEarned = updatedStats.freeMonthsEarned;

    if (freeMonthsOwed > freeMonthsAlreadyEarned) {
      // Grant 1 free month: extend referrer's subscriptionEndDate by 30 days
      const referrerProfile = await db.profile.findFirst({
        where: { userId: referral.referrerId },
        select: { subscriptionEndDate: true, subscriptionStatus: true },
      });

      if (referrerProfile) {
        const baseDate =
          referrerProfile.subscriptionEndDate &&
          referrerProfile.subscriptionEndDate > new Date()
            ? referrerProfile.subscriptionEndDate
            : new Date();

        const newEndDate = new Date(baseDate);
        newEndDate.setDate(newEndDate.getDate() + 30);

        await db.profile.updateMany({
          where: { userId: referral.referrerId },
          data: {
            subscriptionEndDate: newEndDate,
            // Ensure subscription is active if it wasn't already
            subscriptionStatus: "active",
          },
        });
      }

      // Update stats to reflect new free month
      await db.referralStats.update({
        where: { userId: referral.referrerId },
        data: {
          freeMonthsEarned: { increment: 1 },
        },
      });

      console.log(
        `🎁 [Referrals] Granted 1 free month to referrer ${referral.referrerId} (${totalSuccessful} successful referrals)`
      );
    }

    return c.json({
      success: true,
      message: "Referral marked as successful",
      freeMonthGranted: freeMonthsOwed > freeMonthsAlreadyEarned,
    });
  } catch (error) {
    console.error("[Referrals] Error marking subscribed:", error);
    return c.json({ error: "Failed to mark subscription" }, 500);
  }
});

/**
 * GET /api/referrals/check-referred
 * Check if user signed up with a referral code (for showing discount on paywall)
 */
referralsRouter.get("/check-referred", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const referral = await db.referral.findFirst({
      where: {
        referredUserId: user.id,
        status: { in: ["signed_up", "subscribed"] },
      },
    });

    return c.json({
      wasReferred: !!referral,
      discountPercent: referral?.discountPercent ?? 0,
      status: referral?.status ?? null,
    });
  } catch (error) {
    console.error("[Referrals] Error checking referred status:", error);
    return c.json({ error: "Failed to check referred status" }, 500);
  }
});

export { referralsRouter };
