/**
 * Script to create Apple App Store review account
 * 
 * Email: review@pilotpaytracker.app
 * Password: PilotPay!2026
 * State: trial expired, subscription inactive
 */

import { db } from "../src/db";
import { auth } from "../src/auth";

async function createReviewAccount() {
  const email = "review@pilotpaytracker.app";
  const password = "PilotPay!2026";
  const name = "App Review";

  console.log("🍎 Creating Apple App Store Review Account...");
  console.log(`   Email: ${email}`);
  console.log(`   Password: ${password}`);

  try {
    // Check if user already exists
    const existingUser = await db.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      console.log("⚠️  User already exists, updating profile state...");
      
      // Update profile to trial expired, subscription inactive
      await db.profile.upsert({
        where: { userId: existingUser.id },
        update: {
          trialStatus: "expired",
          trialStartDate: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // 8 days ago
          trialEndDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),   // 1 day ago
          subscriptionStatus: "inactive",
          subscriptionStartDate: null,
          subscriptionEndDate: null,
          onboardingComplete: true,
          onboardingStep: 4,
          firstName: "App",
          lastName: "Review",
          gemsId: "REV-0001",
          position: "CPT",
          base: "SDF",
          airline: "UPS",
          dateOfHire: "2020-01-15",
          dateOfBirth: "1985-06-20",
          hourlyRateCents: 34800,
        },
        create: {
          userId: existingUser.id,
          trialStatus: "expired",
          trialStartDate: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          trialEndDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
          subscriptionStatus: "inactive",
          onboardingComplete: true,
          onboardingStep: 4,
          firstName: "App",
          lastName: "Review",
          gemsId: "REV-0001",
          position: "CPT",
          base: "SDF",
          airline: "UPS",
          dateOfHire: "2020-01-15",
          dateOfBirth: "1985-06-20",
          hourlyRateCents: 34800,
        },
      });

      console.log("✅ Profile updated: trial expired, subscription inactive");

      // Seed a YearPlan so the Benchmarks ↔ Planner integration is visible
      const existingPlan = await db.yearPlan.findFirst({
        where: { userId: existingUser.id, planYear: 2026, isActive: true },
      });
      if (!existingPlan) {
        await db.yearPlan.create({
          data: {
            userId: existingUser.id,
            planYear: 2026,
            targetAnnualIncomeCents: 45000000, // $450,000
            hourlyRateCents: 38137, // CPT Year 7
            monthlyGuaranteeHours: 75,
            jaMultiplier: 1.5,
            includeJA: false,
            includeOpenTime: true,
            planningMode: "BALANCED",
            isActive: true,
          },
        });
        console.log("✅ YearPlan seeded: $450K target for Benchmarks integration");
      }
      return;
    }

    // Create new user via Better Auth's internal API
    // We need to use the auth context to create a proper user
    const ctx = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name,
      },
    });

    if (!ctx || !ctx.user) {
      throw new Error("Failed to create user");
    }

    console.log(`✅ User created with ID: ${ctx.user.id}`);

    // Create profile with trial expired state
    await db.profile.create({
      data: {
        userId: ctx.user.id,
        trialStatus: "expired",
        trialStartDate: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // 8 days ago
        trialEndDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),   // 1 day ago
        subscriptionStatus: "inactive",
        onboardingComplete: true,
        onboardingStep: 4,
        firstName: "App",
        lastName: "Review",
        gemsId: "REV-0001",
        position: "CPT",
        base: "SDF",
        airline: "UPS",
        dateOfHire: "2020-01-15",
        dateOfBirth: "1985-06-20",
        hourlyRateCents: 34800,
      },
    });

    console.log("✅ Profile created: trial expired, subscription inactive");
    console.log("");
    console.log("🎉 Review account ready!");
    console.log("   When this user logs in:");
    console.log("   • Premium features will be locked");
    console.log("   • Subscription paywall will be shown");

  } catch (error) {
    console.error("❌ Error creating review account:", error);
    process.exit(1);
  }
}

createReviewAccount()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
