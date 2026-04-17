/**
 * Stripe Payment Routes
 *
 * Handles subscription checkout and webhooks.
 * All payments go through the website — the app only opens a browser link.
 *
 * Endpoints:
 *  POST /api/stripe/create-checkout  — creates a Stripe Checkout session
 *  POST /api/stripe/webhook          — receives Stripe webhook events
 *  GET  /api/stripe/status           — returns whether Stripe is configured
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AppType } from "../types";
import { db } from "../db";

const stripeRouter = new Hono<AppType>();

// Lazy-load Stripe so the server starts even if STRIPE_SECRET_KEY is not set
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const Stripe = require("stripe");
  return new Stripe(key, { apiVersion: "2025-03-31.basil" });
}

// Price IDs from env
function getPriceIds() {
  return {
    monthly: process.env.STRIPE_MONTHLY_PRICE_ID ?? "",
    yearly: process.env.STRIPE_YEARLY_PRICE_ID ?? "",
  };
}

/**
 * Map a Stripe subscription status to our canonical subscriptionStatus.
 * "trialing" in Stripe means the Stripe trial is active (no payment yet).
 * "active" in Stripe means payment has been collected.
 */
function stripeStatusToEntitlement(stripeStatus: string): string {
  switch (stripeStatus) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "active"; // Still consider active while Stripe retries
    case "canceled":
    case "cancelled":
    case "incomplete_expired":
      return "expired";
    default:
      return "expired";
  }
}

// =============================================================================
// GET /api/stripe/status — is Stripe configured?
// =============================================================================
stripeRouter.get("/status", (c) => {
  const configured = !!process.env.STRIPE_SECRET_KEY;
  const priceIds = getPriceIds();
  return c.json({
    configured,
    hasMonthlyPrice: !!priceIds.monthly,
    hasYearlyPrice: !!priceIds.yearly,
  });
});

// =============================================================================
// POST /api/stripe/create-checkout — create a Checkout Session
// =============================================================================
const createCheckoutSchema = z.object({
  plan: z.enum(["monthly", "yearly"]),
});

stripeRouter.post(
  "/create-checkout",
  zValidator("json", createCheckoutSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const stripe = getStripe();
    if (!stripe) {
      return c.json({ error: "Payments are not configured yet." }, 503);
    }

    const { plan } = c.req.valid("json");
    const priceIds = getPriceIds();
    const priceId = plan === "yearly" ? priceIds.yearly : priceIds.monthly;

    if (!priceId) {
      return c.json({ error: `Price ID for ${plan} plan is not configured.` }, 503);
    }

    const webUrl = process.env.WEB_URL ?? "https://pilotpaytracker.com";
    const successUrl = `${webUrl}/subscribe/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${webUrl}/subscribe/cancel`;

    // Fetch user's profile to get existing Stripe customer ID and trial status
    const profile = await db.profile.findUnique({
      where: { userId: user.id },
      select: {
        stripeCustomerId: true,
        trialStatus: true,
        trialStartDate: true,
      },
    });

    // Trial is only offered via the app's 7-day free trial (not Stripe trial)
    // Stripe checkout never adds its own trial — the app trial is tracked in our DB
    const trialAlreadyUsed = profile?.trialStatus !== "not_started";

    let customerId: string | undefined = profile?.stripeCustomerId ?? undefined;

    if (!customerId) {
      try {
        const existingCustomers = await stripe.customers.list({
          email: user.email ?? undefined,
          limit: 1,
        });
        if (existingCustomers.data.length > 0) {
          customerId = existingCustomers.data[0].id;
        } else {
          const customer = await stripe.customers.create({
            email: user.email ?? undefined,
            metadata: { userId: user.id },
          });
          customerId = customer.id;
        }

        if (customerId) {
          db.profile.updateMany({
            where: { userId: user.id },
            data: { stripeCustomerId: customerId },
          }).catch((err) => console.error("[Stripe] Failed to save customer ID:", err));
        }
      } catch (err) {
        console.error("[Stripe] Customer lookup/create failed:", err);
        return c.json({ error: "Could not start checkout. Please try again." }, 500);
      }
    }

    try {
      const sessionParams: any = {
        customer: customerId,
        customer_email: customerId ? undefined : (user.email ?? undefined),
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { userId: user.id, plan },
        allow_promotion_codes: true,
        subscription_data: {
          metadata: { userId: user.id, plan },
        },
      };

      const session = await stripe.checkout.sessions.create(sessionParams);

      console.log(
        `💳 [Stripe] Checkout session created for user ${user.id}, plan: ${plan}, trialAlreadyUsed: ${trialAlreadyUsed}`
      );
      return c.json({ url: session.url });
    } catch (err: any) {
      console.error("[Stripe] Checkout session creation failed:", err);
      return c.json({ error: "Could not start checkout. Please try again." }, 500);
    }
  }
);

// =============================================================================
// GET /api/stripe/verify-session — verify a checkout session after redirect
// Belt-and-suspenders: also updates the user record if webhook hasn't fired yet
// =============================================================================
stripeRouter.get("/verify-session", async (c) => {
  const stripe = getStripe();
  if (!stripe) return c.json({ error: "Stripe not configured" }, 503);

  const sessionId = c.req.query("session_id");
  if (!sessionId) return c.json({ error: "Missing session_id" }, 400);

  const user = c.get("user");

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });

    console.log(`🔍 [Stripe] verify-session: session=${sessionId}, payment_status=${session.payment_status}, user=${user?.id ?? "unauthenticated"}`);

    // If payment is confirmed and we have an authenticated user, ensure the DB is updated.
    // This is a belt-and-suspenders fallback for webhook delivery delays.
    if (session.payment_status === "paid" && user) {
      const profile = await db.profile.findFirst({
        where: { userId: user.id },
        select: { subscriptionStatus: true, stripeSubscriptionId: true },
      });

      const alreadyActive =
        profile?.subscriptionStatus === "active" ||
        profile?.subscriptionStatus === "active_lifetime" ||
        profile?.subscriptionStatus === "trialing";

      if (!alreadyActive) {
        // Webhook hasn't fired yet — apply the update directly so the app unlocks immediately
        const sub = typeof session.subscription === "object" ? session.subscription : null;
        const subId = typeof session.subscription === "string" ? session.subscription : sub?.id ?? null;
        const currentPeriodEnd = sub && "current_period_end" in sub && sub.current_period_end
          ? new Date((sub.current_period_end as number) * 1000)
          : null;
        const plan = (session.metadata?.plan as string | undefined) ?? null;
        const stripeCustomerId = typeof session.customer === "string" ? session.customer : null;

        await db.profile.updateMany({
          where: { userId: user.id },
          data: {
            subscriptionStatus: "active",
            subscriptionStartDate: new Date(),
            accessActive: true,
            accessType: "stripe",
            ...(currentPeriodEnd && { subscriptionEndDate: currentPeriodEnd, currentPeriodEnd }),
            ...(plan && { plan }),
            ...(stripeCustomerId && { stripeCustomerId }),
            ...(subId && { stripeSubscriptionId: subId }),
          },
        });
        console.log(`✅ [Stripe] verify-session: applied fallback DB update for user ${user.id} (webhook may still fire and is idempotent)`);
      } else {
        console.log(`✅ [Stripe] verify-session: user ${user.id} already has status=${profile?.subscriptionStatus}, no DB update needed`);
      }
    }

    return c.json({
      status: session.payment_status,
      customerEmail: session.customer_details?.email ?? null,
      subscriptionId: typeof session.subscription === "string"
        ? session.subscription
        : (session.subscription as any)?.id ?? null,
    });
  } catch (err: any) {
    console.error("[Stripe] verify-session error:", err.message);
    return c.json({ error: "Could not retrieve session" }, 500);
  }
});

// =============================================================================
// POST /api/stripe/webhook — Stripe sends events here
// =============================================================================
stripeRouter.post("/webhook", async (c) => {
  const stripe = getStripe();
  if (!stripe) {
    return c.json({ error: "Stripe not configured" }, 503);
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return c.json({ error: "Webhook secret not configured" }, 503);
  }

  const sig = c.req.header("stripe-signature");
  if (!sig) return c.json({ error: "Missing signature" }, 400);

  let event: any;
  try {
    const rawBody = await c.req.text();
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error("[Stripe] Webhook signature verification failed:", err.message);
    return c.json({ error: "Invalid signature" }, 400);
  }

  console.log(`📬 [Stripe] Webhook received: ${event.type}`);

  try {
    switch (event.type) {

      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        const plan = session.metadata?.plan ?? null;
        if (!userId) break;

        let stripeCustomerId = typeof session.customer === "string" ? session.customer : null;
        let stripeSubscriptionId = typeof session.subscription === "string" ? session.subscription : null;
        let stripePriceId: string | null = null;
        let currentPeriodEnd: Date | null = null;
        let stripeSubStatus = "active";

        if (stripeSubscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
            stripeSubStatus = sub.status;
            currentPeriodEnd = sub.current_period_end
              ? new Date(sub.current_period_end * 1000)
              : null;
            stripePriceId = sub.items?.data?.[0]?.price?.id ?? null;
          } catch (err) {
            console.error("[Stripe] Failed to retrieve subscription on checkout.session.completed:", err);
          }
        }

        const entitlementStatus = stripeStatusToEntitlement(stripeSubStatus);

        const isAccessActive = entitlementStatus === "active" || entitlementStatus === "trialing";
        await db.profile.updateMany({
          where: { userId },
          data: {
            subscriptionStatus: entitlementStatus,
            subscriptionStartDate: new Date(),
            subscriptionEndDate: currentPeriodEnd,
            plan: plan,
            accessActive: isAccessActive,
            accessType: isAccessActive ? "stripe" : null,
            ...(stripeCustomerId && { stripeCustomerId }),
            ...(stripeSubscriptionId && { stripeSubscriptionId }),
            ...(stripePriceId && { stripePriceId }),
            ...(currentPeriodEnd && { currentPeriodEnd }),
          },
        });

        console.log(`✅ [Stripe] checkout.session.completed — userId=${userId} plan=${plan} stripeStatus=${stripeSubStatus} → entitlement=${entitlementStatus} periodEnd=${currentPeriodEnd?.toISOString() ?? "none"}`);

        // Fire referral reward if applicable
        try {
          const pendingReferral = await db.referral.findFirst({
            where: { referredUserId: userId, status: "signed_up" },
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
                data: { subscriptionEndDate: newEndDate, subscriptionStatus: "active", accessActive: true, accessType: "stripe" },
              });
              await db.referralStats.update({
                where: { userId: pendingReferral.referrerId },
                data: { freeMonthsEarned: { increment: 1 } },
              });
              console.log(`🎁 [Stripe] Free month granted to referrer ${pendingReferral.referrerId}`);
            }
          }
        } catch (refErr) {
          console.error("[Stripe] Referral reward error (non-fatal):", refErr);
        }
        break;
      }

      case "customer.subscription.created": {
        const sub = event.data.object;
        const userId = sub.metadata?.userId;
        const plan = sub.metadata?.plan ?? null;
        if (!userId) break;

        const stripeCustomerId = typeof sub.customer === "string" ? sub.customer : null;
        const stripePriceId = sub.items?.data?.[0]?.price?.id ?? null;
        const currentPeriodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000)
          : null;
        const entitlementStatus = stripeStatusToEntitlement(sub.status);

        const isAccessActiveCreated = entitlementStatus === "active" || entitlementStatus === "trialing";
        await db.profile.updateMany({
          where: { userId },
          data: {
            subscriptionStatus: entitlementStatus,
            subscriptionStartDate: new Date(),
            subscriptionEndDate: currentPeriodEnd,
            plan: plan,
            accessActive: isAccessActiveCreated,
            accessType: isAccessActiveCreated ? "stripe" : null,
            ...(stripeCustomerId && { stripeCustomerId }),
            stripeSubscriptionId: sub.id,
            ...(stripePriceId && { stripePriceId }),
            ...(currentPeriodEnd && { currentPeriodEnd }),
          },
        });

        console.log(`📋 [Stripe] Subscription created for user: ${userId}, status: ${sub.status} → ${entitlementStatus}`);
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;
        const userId = sub.metadata?.userId;
        const plan = sub.metadata?.plan ?? null;
        if (!userId) break;

        const stripePriceId = sub.items?.data?.[0]?.price?.id ?? null;
        const currentPeriodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000)
          : null;
        const entitlementStatus = stripeStatusToEntitlement(sub.status);

        const isAccessActiveUpdated = entitlementStatus === "active" || entitlementStatus === "trialing";
        await db.profile.updateMany({
          where: { userId },
          data: {
            subscriptionStatus: entitlementStatus,
            subscriptionEndDate: currentPeriodEnd,
            stripeSubscriptionId: sub.id,
            accessActive: isAccessActiveUpdated,
            accessType: isAccessActiveUpdated ? "stripe" : null,
            ...(plan && { plan }),
            ...(stripePriceId && { stripePriceId }),
            ...(currentPeriodEnd && { currentPeriodEnd }),
          },
        });

        console.log(`🔄 [Stripe] Subscription updated for user: ${userId}, status: ${sub.status} → ${entitlementStatus}`);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const userId = sub.metadata?.userId;
        if (!userId) break;

        await db.profile.updateMany({
          where: { userId },
          data: {
            subscriptionStatus: "expired",
            subscriptionEndDate: new Date(),
            currentPeriodEnd: new Date(),
            accessActive: false,
            accessType: null,
          },
        });

        console.log(`❌ [Stripe] Subscription expired for user: ${userId}`);
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        if (!subId) break;

        const sub = await stripe.subscriptions.retrieve(subId as string).catch(() => null);
        if (!sub) break;

        const userId = sub.metadata?.userId;
        if (!userId) break;

        const currentPeriodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000)
          : null;
        const stripePriceId = sub.items?.data?.[0]?.price?.id ?? null;

        await db.profile.updateMany({
          where: { userId },
          data: {
            subscriptionStatus: "active",
            subscriptionEndDate: currentPeriodEnd,
            accessActive: true,
            accessType: "stripe",
            ...(currentPeriodEnd && { currentPeriodEnd }),
            ...(stripePriceId && { stripePriceId }),
          },
        });

        console.log(`💵 [Stripe] Invoice paid for user: ${userId}, period end: ${currentPeriodEnd?.toISOString()}`);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const sub = invoice.subscription
          ? await stripe.subscriptions.retrieve(invoice.subscription as string).catch(() => null)
          : null;
        const userId = sub?.metadata?.userId;
        if (userId) {
          console.log(`⚠️ [Stripe] Payment failed for user: ${userId} — Stripe will retry automatically`);
        }
        break;
      }

      default:
        console.log(`[Stripe] Unhandled webhook event: ${event.type}`);
    }
  } catch (err) {
    console.error("[Stripe] Webhook handler error:", err);
    return c.json({ error: "Webhook handler failed" }, 500);
  }

  return c.json({ received: true });
});

export { stripeRouter };
