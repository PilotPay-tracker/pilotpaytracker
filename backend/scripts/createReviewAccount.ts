/**
 * createReviewAccount.ts
 *
 * One-time (idempotent) seed script that creates / refreshes all Apple review
 * and TestFlight tester demo accounts in the production Better Auth database.
 *
 * Run from the backend directory:
 *   bun run scripts/createReviewAccount.ts
 *
 * Safe to run multiple times — every account is fully upserted.
 *
 * Accounts seeded:
 *   review@pilotpaytracker.app     / PilotPay!2026
 *   reviewer@pilotpaytracker.app   / PilotPay!2026
 *   reviewpaid@pilotpaytracker.app / PilotPay!2026
 *   tester@pilotpaytracker.app     / TestFlight2026!
 */

import { hashPassword } from "better-auth/crypto";
import { db } from "../src/db";

// ─── Account definitions ────────────────────────────────────────────────────

const ACCOUNTS = [
  {
    email: "pdavis.ups@outlook.com",
    password: "Parker25",
    name: "Parker Davis",
    firstName: "Parker",
    lastName: "Davis",
    gemsId: "ADMIN-001",
    adminRole: "super_admin" as const,
  },
  {
    email: "review@pilotpaytracker.app",
    password: "PilotPay!2026",
    name: "App Review",
    firstName: "App",
    lastName: "Review",
    gemsId: "REV-0001",
    adminRole: "user" as const,
  },
  {
    email: "reviewer@pilotpaytracker.app",
    password: "PilotPay!2026",
    name: "App Reviewer",
    firstName: "App",
    lastName: "Reviewer",
    gemsId: "REV-0002",
    adminRole: "user" as const,
  },
  {
    email: "reviewpaid@pilotpaytracker.app",
    password: "PilotPay!2026",
    name: "Review Premium",
    firstName: "Jane",
    lastName: "Smith",
    gemsId: "REV-0003",
    adminRole: "user" as const,
  },
  {
    email: "tester@pilotpaytracker.app",
    password: "TestFlight2026!",
    name: "TestFlight Tester",
    firstName: "Test",
    lastName: "Pilot",
    gemsId: "REV-0004",
    adminRole: "user" as const,
  },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 32; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

function log(icon: string, msg: string) {
  console.log(`${icon}  ${msg}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  🍎  PilotPay Tracker — Apple Review Account Seed Script");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Shared subscription window: active through 2030 so the bypass is never needed
  // to unlock premium features — the account genuinely has an active subscription.
  const trialExpired = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
  const subStart = new Date();
  const subEnd = new Date("2030-12-31");

  let successCount = 0;
  let failCount = 0;

  for (const account of ACCOUNTS) {
    console.log(`▶  Processing: ${account.email}`);

    try {
      // ── 1. Upsert user ────────────────────────────────────────────────────
      let user = await db.user.findUnique({ where: { email: account.email } });

      if (!user) {
        const userId = generateId();
        user = await db.user.create({
          data: {
            id: userId,
            email: account.email,
            name: account.name,
            emailVerified: true,     // skip verification gate
          },
        });
        log("✅", `User created  (id: ${user.id})`);
      } else {
        // Ensure emailVerified is set on pre-existing accounts
        if (!user.emailVerified) {
          await db.user.update({
            where: { id: user.id },
            data: { emailVerified: true },
          });
        }
        log("ℹ️ ", `User exists   (id: ${user.id})`);
      }

      // ── 2. Upsert credential (password) ──────────────────────────────────
      // Always re-hash with Better Auth's own hasher so the algorithm matches
      // exactly what Better Auth expects during sign-in verification.
      const hashedPassword = await hashPassword(account.password);

      const existingCred = await db.account.findFirst({
        where: { userId: user.id, providerId: "credential" },
      });

      if (existingCred) {
        await db.account.update({
          where: { id: existingCred.id },
          data: { password: hashedPassword },
        });
        log("🔑", `Password hash refreshed`);
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
        log("🔑", `Credential record created`);
      }

      // ── 3. Upsert complete pilot profile ─────────────────────────────────
      // A complete profile prevents the app from redirecting to profile-setup
      // after login. All required fields are filled with realistic UPS Captain data.
      await db.profile.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          firstName: account.firstName,
          lastName: account.lastName,
          gemsId: account.gemsId,
          position: "CPT",
          base: "SDF",
          airline: "UPS",
          operatorType: "cargo",
          dateOfHire: "2020-01-15",
          dateOfBirth: "1985-06-20",
          hourlyRateCents: 34800,           // CPT Year 7
          onboardingComplete: true,
          onboardingStep: 4,
          contractMappingStatus: "confirmed",
          adminRole: account.adminRole,
          // Subscription: active through 2030 — no paywall shown
          trialStatus: "expired",
          trialStartDate: trialExpired,
          trialEndDate: trialExpired,
          subscriptionStatus: "active",
          subscriptionStartDate: subStart,
          subscriptionEndDate: subEnd,
        },
        update: {
          // Keep name + profile fields fresh on every run
          firstName: account.firstName,
          lastName: account.lastName,
          onboardingComplete: true,
          onboardingStep: 4,
          contractMappingStatus: "confirmed",
          adminRole: account.adminRole,
          trialStatus: "expired",
          trialStartDate: trialExpired,
          trialEndDate: trialExpired,
          subscriptionStatus: "active",
          subscriptionStartDate: subStart,
          subscriptionEndDate: subEnd,
        },
      });
      const roleLabel = (account.adminRole as string) === "super_admin" ? "super_admin 👑" : (account.adminRole as string) === "admin" ? "admin" : "user";
      log("👤", `Profile upserted  (role: ${roleLabel}, active subscription, onboarding complete)`);

      // ── 4. Upsert YearPlan for 2026 ───────────────────────────────────────
      // Required for the Annual Pay Planner + Benchmarks features to be visible.
      const existingPlan = await db.yearPlan.findFirst({
        where: { userId: user.id, planYear: 2026 },
      });

      if (!existingPlan) {
        await db.yearPlan.create({
          data: {
            userId: user.id,
            planYear: 2026,
            targetAnnualIncomeCents: 45000000, // $450,000
            hourlyRateCents: 38137,            // CPT Year 7
            monthlyGuaranteeHours: 75,
            jaMultiplier: 1.5,
            includeJA: false,
            includeOpenTime: true,
            planningMode: "BALANCED",
            isActive: true,
          },
        });
        log("📊", `YearPlan 2026 created  ($450K target)`);
      } else {
        log("📊", `YearPlan 2026 already exists — skipped`);
      }

      successCount++;
      console.log();
    } catch (err) {
      failCount++;
      console.error(`❌  Failed for ${account.email}:`, err);
      console.log();
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Done: ${successCount} succeeded, ${failCount} failed`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  if (successCount > 0) {
    console.log("  Credentials for App Store Connect / TestFlight:\n");
    console.log("  ┌──────────────────────────────────────────┬───────────────────┬─────────┐");
    console.log("  │ Email                                    │ Password          │ Role    │");
    console.log("  ├──────────────────────────────────────────┼───────────────────┼─────────┤");
    console.log("  │ pdavis.ups@outlook.com                   │ Parker25          │ super_admin 👑│");
    console.log("  │ review@pilotpaytracker.app               │ PilotPay!2026     │ user    │");
    console.log("  │ reviewer@pilotpaytracker.app             │ PilotPay!2026     │ user    │");
    console.log("  │ reviewpaid@pilotpaytracker.app           │ PilotPay!2026     │ user    │");
    console.log("  │ tester@pilotpaytracker.app               │ TestFlight2026!   │ user    │");
    console.log("  └──────────────────────────────────────────┴───────────────────┴─────────┘\n");
    console.log("  All accounts have:");
    console.log("    • emailVerified = true");
    console.log("    • subscriptionStatus = active  (expires 2030-12-31)");
    console.log("    • onboardingComplete = true  (skips profile-setup screen)");
    console.log("    • YearPlan 2026 seeded  (Annual Pay Planner visible)\n");
  }

  if (failCount > 0) {
    process.exit(1);
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

run()
  .catch((err) => {
    console.error("❌  Unexpected error:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
