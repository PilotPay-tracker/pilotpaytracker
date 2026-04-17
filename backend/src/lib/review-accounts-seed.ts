/**
 * Auto-seeds review accounts at server startup so they always exist in production.
 * Uses the same credential format as Better Auth email/password sign-in.
 */
import { hashPassword } from "better-auth/crypto";
import { db } from "../db";

/**
 * Owner/admin accounts — password is refreshed and adminRole is enforced on every deploy.
 */
const OWNER_ACCOUNTS = [
  { email: "pdavis.ups@outlook.com", password: "Parker25", adminRole: "super_admin" },
];

const REVIEW_ACCOUNTS = [
  {
    email: "review@pilotpaytracker.app",
    password: "PilotPay!2026",
    name: "App Review",
    firstName: "App",
    lastName: "Review",
    trialStatus: "expired" as const,
    subscriptionStatus: "active" as const,
    subscriptionStartDate: new Date(),
    subscriptionEndDate: new Date("2030-12-31"),
  },
  {
    email: "reviewpaid@pilotpaytracker.app",
    password: "PilotPay!2026",
    name: "Review Premium",
    firstName: "Jane",
    lastName: "Smith",
    trialStatus: "expired" as const,
    subscriptionStatus: "active" as const,
    subscriptionStartDate: new Date(),
    subscriptionEndDate: new Date("2030-12-31"),
  },
  {
    email: "reviewer@pilotpaytracker.app",
    password: "PilotPay!2026",
    name: "App Reviewer",
    firstName: "App",
    lastName: "Reviewer",
    trialStatus: "expired" as const,
    subscriptionStatus: "active" as const,
    subscriptionStartDate: new Date(),
    subscriptionEndDate: new Date("2030-12-31"),
  },
  {
    email: "tester@pilotpaytracker.app",
    password: "TestFlight2026!",
    name: "TestFlight Tester",
    firstName: "Test",
    lastName: "Pilot",
    trialStatus: "expired" as const,
    subscriptionStatus: "active" as const,
    subscriptionStartDate: new Date(),
    subscriptionEndDate: new Date("2030-12-31"),
  },
];

function generateId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 32; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

export async function seedReviewAccounts(): Promise<void> {
  // Seed owner accounts — refresh password + enforce adminRole on every deploy
  for (const owner of OWNER_ACCOUNTS) {
    try {
      const user = await db.user.findUnique({ where: { email: owner.email } });
      if (!user) continue; // Owner must have signed up manually first
      const hashedPassword = await hashPassword(owner.password);
      const existing = await db.account.findFirst({
        where: { userId: user.id, providerId: "credential" },
      });
      if (existing) {
        await db.account.update({
          where: { id: existing.id },
          data: { password: hashedPassword },
        });
        console.log(`🔑 [OwnerAccounts] Password synced for: ${owner.email}`);
      } else {
        await db.account.create({
          data: {
            id: generateId(),
            accountId: user.id,
            providerId: "credential",
            userId: user.id,
            password: hashedPassword,
          },
        });
        console.log(`🔑 [OwnerAccounts] Credential created for: ${owner.email}`);
      }
      // Ensure adminRole is set on the profile (non-destructive update)
      const profile = await db.profile.findUnique({ where: { userId: user.id } });
      if (profile && profile.adminRole !== owner.adminRole) {
        await db.profile.update({
          where: { userId: user.id },
          data: { adminRole: owner.adminRole },
        });
        console.log(`👑 [OwnerAccounts] adminRole set to "${owner.adminRole}" for: ${owner.email}`);
      }
    } catch (err) {
      console.error(`⚠️ [OwnerAccounts] Failed for ${owner.email}:`, err);
    }
  }

  // Seed review/tester accounts
  for (const account of REVIEW_ACCOUNTS) {
    try {
      let user = await db.user.findUnique({ where: { email: account.email } });

      if (!user) {
        const userId = generateId();
        const hashedPassword = await hashPassword(account.password);

        user = await db.user.create({
          data: {
            id: userId,
            email: account.email,
            name: account.name,
            emailVerified: true,
          },
        });

        await db.account.create({
          data: {
            id: generateId(),
            accountId: userId,
            providerId: "credential",
            userId: userId,
            password: hashedPassword,
          },
        });

        console.log(`✅ [ReviewAccounts] Created: ${account.email}`);
      } else {
        // Ensure account (password) record exists
        const existingAccount = await db.account.findFirst({
          where: { userId: user.id, providerId: "credential" },
        });
        const hashedPassword = await hashPassword(account.password);
        if (!existingAccount) {
          await db.account.create({
            data: {
              id: generateId(),
              accountId: user.id,
              providerId: "credential",
              userId: user.id,
              password: hashedPassword,
            },
          });
          console.log(`✅ [ReviewAccounts] Restored credentials for: ${account.email}`);
        } else {
          // Always re-hash to ensure the hash algorithm matches Better Auth's expectation
          await db.account.update({
            where: { id: existingAccount.id },
            data: { password: hashedPassword },
          });
          console.log(`🔄 [ReviewAccounts] Updated password hash for: ${account.email}`);
        }
      }

      const expiredDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

      // Upsert profile with correct subscription state
      await db.profile.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          firstName: account.firstName,
          lastName: account.lastName,
          gemsId: "REV-0001",
          position: "CPT",
          base: "SDF",
          airline: "UPS",
          operatorType: "cargo",
          dateOfHire: "2020-01-15",
          dateOfBirth: "1985-06-20",
          hourlyRateCents: 34800,
          onboardingComplete: true,
          onboardingStep: 4,
          contractMappingStatus: "confirmed",
          payRuleDefaultsApplied: true,
          trialStatus: account.trialStatus,
          trialStartDate: expiredDate,
          trialEndDate: expiredDate,
          subscriptionStatus: account.subscriptionStatus,
          subscriptionStartDate: account.subscriptionStartDate,
          subscriptionEndDate: account.subscriptionEndDate,
        },
        update: {
          // Always refresh profile completeness fields so reviewers are never stuck in onboarding
          firstName: account.firstName,
          lastName: account.lastName,
          gemsId: "REV-0001",
          position: "CPT",
          base: "SDF",
          airline: "UPS",
          operatorType: "cargo",
          dateOfHire: "2020-01-15",
          dateOfBirth: "1985-06-20",
          hourlyRateCents: 34800,
          onboardingComplete: true,
          onboardingStep: 4,
          contractMappingStatus: "confirmed",
          payRuleDefaultsApplied: true,
          trialStatus: account.trialStatus,
          trialStartDate: expiredDate,
          trialEndDate: expiredDate,
          subscriptionStatus: account.subscriptionStatus,
          subscriptionStartDate: account.subscriptionStartDate,
          subscriptionEndDate: account.subscriptionEndDate,
        },
      });
    } catch (err) {
      console.error(`⚠️ [ReviewAccounts] Failed for ${account.email}:`, err);
    }
  }
}
