-- Add accessActive and accessType to profile for explicit entitlement storage
ALTER TABLE "profile" ADD COLUMN "accessActive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "profile" ADD COLUMN "accessType" TEXT;

-- Backfill: mark existing active/trialing users
UPDATE "profile" SET "accessActive" = true, "accessType" = 'stripe'
WHERE "subscriptionStatus" IN ('active') AND "stripeSubscriptionId" IS NOT NULL;

UPDATE "profile" SET "accessActive" = true, "accessType" = 'lifetime'
WHERE "subscriptionStatus" = 'active_lifetime';

UPDATE "profile" SET "accessActive" = true, "accessType" = 'trial'
WHERE "subscriptionStatus" = 'trialing';

UPDATE "profile" SET "accessActive" = true, "accessType" = 'revenuecat'
WHERE "subscriptionStatus" = 'active' AND "stripeSubscriptionId" IS NULL AND "revenuecatCustomerId" IS NOT NULL;
