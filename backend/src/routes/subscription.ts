import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AppType } from "../types";
import { db } from "../db";

const subscriptionRouter = new Hono<AppType>();

// Trial duration in days
const TRIAL_DAYS = 7;

// Apple Review account emails — always grant premium access
const APPLE_REVIEW_EMAILS = [
  "review@pilotpaytracker.app",
  "reviewer@pilotpaytracker.app",
  "reviewpaid@pilotpaytracker.app",
];

// ============================================
// Helper Functions
// ============================================

function getTrialEndDate(): Date {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + TRIAL_DAYS);
  return endDate;
}

function isTrialExpired(trialEndDate: Date | null): boolean {
  if (!trialEndDate) return false;
  return new Date() > trialEndDate;
}

/**
 * Normalise the raw DB fields into one of 4 canonical entitlement states:
 *   free      — never started a trial, no subscription
 *   trialing  — inside the 7-day free trial window
 *   active    — paid Stripe subscription is active
 *   expired   — trial ended AND no active subscription
 */
function computeEntitlementStatus(opts: {
  trialStatus: string;
  trialEndDate: Date | null;
  subscriptionStatus: string;
}): "free" | "trialing" | "active" | "expired" {
  const { trialStatus, trialEndDate, subscriptionStatus } = opts;

  // Active paid subscription wins
  if (subscriptionStatus === "active" || subscriptionStatus === "active_lifetime") {
    return "active";
  }

  // DB already stores "trialing" (set on start-trial)
  if (subscriptionStatus === "trialing") {
    // But make sure the trial window hasn't passed
    if (trialEndDate && !isTrialExpired(trialEndDate)) return "trialing";
    return "expired";
  }

  // Legacy: trialStatus field was used before subscriptionStatus="trialing" was introduced
  if (trialStatus === "active") {
    if (trialEndDate && !isTrialExpired(trialEndDate)) return "trialing";
    return "expired";
  }

  if (trialStatus === "expired") return "expired";

  // Cancelled / inactive with a used trial → expired
  if (
    (subscriptionStatus === "cancelled" || subscriptionStatus === "expired") &&
    trialStatus !== "not_started"
  ) {
    return "expired";
  }

  // Never used trial, never subscribed
  if (trialStatus === "not_started") return "free";

  return "expired";
}

// ============================================
// GET /api/subscription/status - Get subscription status
// ============================================
subscriptionRouter.get("/status", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const profile = await db.profile.findUnique({
    where: { userId: user.id },
    select: {
      trialStatus: true,
      trialStartDate: true,
      trialEndDate: true,
      subscriptionStatus: true,
      subscriptionStartDate: true,
      subscriptionEndDate: true,
      revenuecatCustomerId: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      stripePriceId: true,
      currentPeriodEnd: true,
      plan: true,
    },
  });

  if (!profile) {
    return c.json({
      subscriptionStatus: "free",
      trialStatus: "not_started",
      trialStartedAt: null,
      trialEndsAt: null,
      accessExpiresAt: null,
      plan: null,
      hasPremiumAccess: false,
      trialDaysRemaining: null,
      // legacy fields kept for backward compat
      trialStartDate: null,
      trialEndDate: null,
      subscriptionStartDate: null,
      subscriptionEndDate: null,
    });
  }

  // Apple Review accounts always get premium access
  const isReviewAccount = APPLE_REVIEW_EMAILS.some(
    (e) => user.email?.toLowerCase() === e.toLowerCase()
  );
  if (isReviewAccount) {
    if (profile.subscriptionStatus !== "active" && profile.subscriptionStatus !== "active_lifetime") {
      db.profile.update({
        where: { userId: user.id },
        data: { subscriptionStatus: "active", subscriptionStartDate: new Date(), subscriptionEndDate: new Date("2030-12-31") },
      }).catch(console.error);
    }
    return c.json({
      subscriptionStatus: "active",
      trialStatus: "expired",
      trialStartedAt: null,
      trialEndsAt: null,
      accessExpiresAt: "2030-12-31T00:00:00.000Z",
      plan: profile.plan ?? null,
      hasPremiumAccess: true,
      trialDaysRemaining: null,
      // legacy
      trialStartDate: null,
      trialEndDate: null,
      subscriptionStartDate: profile.subscriptionStartDate?.toISOString() ?? new Date().toISOString(),
      subscriptionEndDate: "2030-12-31T00:00:00.000Z",
      revenuecatCustomerId: profile.revenuecatCustomerId,
      stripeCustomerId: profile.stripeCustomerId ?? null,
      stripeSubscriptionId: profile.stripeSubscriptionId ?? null,
      stripePriceId: profile.stripePriceId ?? null,
      currentPeriodEnd: profile.currentPeriodEnd?.toISOString() ?? null,
    });
  }

  // Super admin always gets lifetime premium — auto-grant on status check
  const SUPER_ADMIN_EMAIL = "pdavis.ups@outlook.com";
  if (user.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) {
    if (profile.subscriptionStatus !== "active_lifetime") {
      db.profile.update({
        where: { userId: user.id },
        data: {
          subscriptionStatus: "active_lifetime",
          subscriptionStartDate: new Date(),
          subscriptionEndDate: null,
          adminRole: "super_admin",
        },
      }).catch(console.error);
    }
    return c.json({
      subscriptionStatus: "active",
      trialStatus: "not_started",
      trialStartedAt: null,
      trialEndsAt: null,
      accessExpiresAt: null,
      plan: profile.plan ?? "lifetime",
      hasPremiumAccess: true,
      trialDaysRemaining: null,
      // legacy
      trialStartDate: null,
      trialEndDate: null,
      subscriptionStartDate: profile.subscriptionStartDate?.toISOString() ?? new Date().toISOString(),
      subscriptionEndDate: null,
      revenuecatCustomerId: profile.revenuecatCustomerId,
      stripeCustomerId: profile.stripeCustomerId ?? null,
      stripeSubscriptionId: profile.stripeSubscriptionId ?? null,
      stripePriceId: profile.stripePriceId ?? null,
      currentPeriodEnd: null,
    });
  }

  // Compute canonical entitlement status
  const entitlementStatus = computeEntitlementStatus({
    trialStatus: profile.trialStatus,
    trialEndDate: profile.trialEndDate,
    subscriptionStatus: profile.subscriptionStatus,
  });

  // If trial just expired in DB but hasn't been updated yet, persist the change
  if (
    profile.trialStatus === "active" &&
    profile.trialEndDate &&
    isTrialExpired(profile.trialEndDate) &&
    entitlementStatus === "expired"
  ) {
    db.profile.update({
      where: { userId: user.id },
      data: {
        trialStatus: "expired",
        subscriptionStatus: "expired",
      },
    }).catch(console.error);
  }

  // Calculate trial days remaining
  let trialDaysRemaining: number | null = null;
  if (entitlementStatus === "trialing" && profile.trialEndDate) {
    const now = new Date();
    const diffTime = profile.trialEndDate.getTime() - now.getTime();
    trialDaysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
  }

  // Determine premium access
  const hasPremiumAccess = entitlementStatus === "trialing" || entitlementStatus === "active";

  console.log(
    `[Subscription] user=${user.id} dbStatus=${profile.subscriptionStatus} trialStatus=${profile.trialStatus} → entitlement=${entitlementStatus} hasPremiumAccess=${hasPremiumAccess} plan=${profile.plan ?? "none"}`
  );

  // Derive accessExpiresAt
  let accessExpiresAt: string | null = null;
  if (entitlementStatus === "trialing" && profile.trialEndDate) {
    accessExpiresAt = profile.trialEndDate.toISOString();
  } else if (entitlementStatus === "active") {
    accessExpiresAt = profile.subscriptionEndDate?.toISOString() ??
      profile.currentPeriodEnd?.toISOString() ?? null;
  }

  return c.json({
    subscriptionStatus: entitlementStatus,
    trialStatus: profile.trialStatus === "active" && isTrialExpired(profile.trialEndDate)
      ? "expired"
      : profile.trialStatus,
    trialStartedAt: profile.trialStartDate?.toISOString() ?? null,
    trialEndsAt: profile.trialEndDate?.toISOString() ?? null,
    accessExpiresAt,
    plan: profile.plan ?? null,
    hasPremiumAccess,
    trialDaysRemaining,
    // legacy fields kept for backward compat with older app versions
    trialStartDate: profile.trialStartDate?.toISOString() ?? null,
    trialEndDate: profile.trialEndDate?.toISOString() ?? null,
    subscriptionStartDate: profile.subscriptionStartDate?.toISOString() ?? null,
    subscriptionEndDate: profile.subscriptionEndDate?.toISOString() ?? null,
    revenuecatCustomerId: profile.revenuecatCustomerId,
    stripeCustomerId: profile.stripeCustomerId ?? null,
    stripeSubscriptionId: profile.stripeSubscriptionId ?? null,
    stripePriceId: profile.stripePriceId ?? null,
    currentPeriodEnd: profile.currentPeriodEnd?.toISOString() ?? null,
  });
});

// ============================================
// POST /api/subscription/start-trial - Start free trial
// ============================================
subscriptionRouter.post("/start-trial", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const profile = await db.profile.findUnique({
    where: { userId: user.id },
  });

  if (!profile) {
    return c.json({ error: "Profile not found" }, 404);
  }

  // Check if trial was already used
  if (profile.trialStatus !== "not_started") {
    return c.json(
      { error: "Trial already used or active" },
      400
    );
  }

  const now = new Date();
  const trialEndDate = getTrialEndDate();

  await db.profile.update({
    where: { userId: user.id },
    data: {
      trialStatus: "active",
      trialStartDate: now,
      trialEndDate: trialEndDate,
      // Use trialing as the canonical subscription status during the free trial
      subscriptionStatus: "trialing",
    },
  });

  console.log(`🎉 [Subscription] Started trial for user: ${user.id}, ends: ${trialEndDate.toISOString()}`);

  return c.json({
    success: true,
    subscriptionStatus: "trialing",
    trialStatus: "active",
    trialStartedAt: now.toISOString(),
    trialEndsAt: trialEndDate.toISOString(),
    // legacy
    trialStartDate: now.toISOString(),
    trialEndDate: trialEndDate.toISOString(),
    trialDaysRemaining: TRIAL_DAYS,
  });
});

// ============================================
// POST /api/subscription/sync-revenuecat - Sync with RevenueCat
// Called after purchase or restore to sync subscription status
// ============================================
const syncRevenueCatSchema = z.object({
  revenuecatCustomerId: z.string().optional(),
  isActive: z.boolean(),
  expirationDate: z.string().optional(),
  productIdentifier: z.string().optional(),
});

subscriptionRouter.post(
  "/sync-revenuecat",
  zValidator("json", syncRevenueCatSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = c.req.valid("json");

    const updateData: Record<string, unknown> = {
      subscriptionStatus: body.isActive ? "active" : "expired",
      subscriptionStartDate: body.isActive ? new Date() : null,
    };

    if (body.revenuecatCustomerId) {
      updateData.revenuecatCustomerId = body.revenuecatCustomerId;
    }

    if (body.expirationDate) {
      updateData.subscriptionEndDate = new Date(body.expirationDate);
    }

    await db.profile.update({
      where: { userId: user.id },
      data: updateData,
    });

    // If subscription just became active, check if this user was referred
    if (body.isActive) {
      try {
        const pendingReferral = await db.referral.findFirst({
          where: { referredUserId: user.id, status: "signed_up" },
        });
        if (pendingReferral) {
          await db.referral.update({
            where: { id: pendingReferral.id },
            data: { status: "subscribed", subscribedAt: new Date(), rewardAppliedAt: new Date() },
          });
          const updatedStats = await db.referralStats.update({
            where: { userId: pendingReferral.referrerId },
            data: { successfulReferrals: { increment: 1 }, pendingReferrals: { decrement: 1 } },
          });
          const freeMonthsOwed = Math.floor(updatedStats.successfulReferrals / 3);
          if (freeMonthsOwed > updatedStats.freeMonthsEarned) {
            const referrerProfile = await db.profile.findFirst({
              where: { userId: pendingReferral.referrerId },
              select: { subscriptionEndDate: true },
            });
            const baseDate =
              referrerProfile?.subscriptionEndDate &&
              referrerProfile.subscriptionEndDate > new Date()
                ? referrerProfile.subscriptionEndDate
                : new Date();
            const newEndDate = new Date(baseDate);
            newEndDate.setDate(newEndDate.getDate() + 30);
            await db.profile.updateMany({
              where: { userId: pendingReferral.referrerId },
              data: { subscriptionEndDate: newEndDate, subscriptionStatus: "active" },
            });
            await db.referralStats.update({
              where: { userId: pendingReferral.referrerId },
              data: { freeMonthsEarned: { increment: 1 } },
            });
            console.log(`🎁 [Subscription] Free month granted to referrer ${pendingReferral.referrerId}`);
          }
        }
      } catch (refErr) {
        console.error("[Subscription] Referral reward error (non-fatal):", refErr);
      }
    }

    console.log(
      `💳 [Subscription] Synced RevenueCat for user: ${user.id}, active: ${body.isActive}`
    );

    return c.json({
      success: true,
      subscriptionStatus: body.isActive ? "active" : "expired",
    });
  }
);

// ============================================
// POST /api/subscription/admin/set-status - Admin endpoint to set subscription status
// ============================================
const setStatusSchema = z.object({
  userId: z.string(),
  trialStatus: z.enum(["not_started", "active", "expired"]).optional(),
  subscriptionStatus: z.enum(["free", "trialing", "inactive", "active", "cancelled", "expired"]).optional(),
  trialEndDate: z.string().optional(),
  subscriptionEndDate: z.string().optional(),
});

subscriptionRouter.post(
  "/admin/set-status",
  zValidator("json", setStatusSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const adminEmails = ["adam@adamwohlwender.com", "review@pilotpaytracker.app", "pdavis.ups@outlook.com"];
    if (!adminEmails.includes(user.email ?? "")) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const body = c.req.valid("json");
    const updateData: Record<string, unknown> = {};

    if (body.trialStatus !== undefined) {
      updateData.trialStatus = body.trialStatus;
      if (body.trialStatus === "active") {
        updateData.trialStartDate = new Date();
        updateData.trialEndDate = body.trialEndDate
          ? new Date(body.trialEndDate)
          : getTrialEndDate();
        updateData.subscriptionStatus = "trialing";
      } else if (body.trialStatus === "expired") {
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 1);
        updateData.trialEndDate = pastDate;
        updateData.subscriptionStatus = "expired";
      }
    }

    if (body.subscriptionStatus !== undefined) {
      updateData.subscriptionStatus = body.subscriptionStatus;
      if (body.subscriptionStatus === "active") {
        updateData.subscriptionStartDate = new Date();
        if (body.subscriptionEndDate) {
          updateData.subscriptionEndDate = new Date(body.subscriptionEndDate);
        } else {
          const endDate = new Date();
          endDate.setFullYear(endDate.getFullYear() + 1);
          updateData.subscriptionEndDate = endDate;
        }
      }
    }

    await db.profile.update({
      where: { userId: body.userId },
      data: updateData,
    });

    console.log(
      `🔧 [Subscription] Admin set status for user: ${body.userId}, trial: ${body.trialStatus}, subscription: ${body.subscriptionStatus}`
    );

    return c.json({ success: true });
  }
);

export { subscriptionRouter };
