/**
 * Setup Review Accounts Script
 *
 * Creates and configures the Apple/Google review accounts
 * for App Store submission.
 *
 * Run with: cd backend && bun run scripts/setup-review-accounts.ts
 */

import { db } from "../src/db";
import * as bcrypt from "bcryptjs";

// Review account credentials
const REVIEW_ACCOUNTS = [
  {
    email: "review@pilotpaytracker.app",
    password: "PilotPay!2026",
    name: "App Review",
    firstName: "John",
    lastName: "Doe",
    trialStatus: "expired",        // Trial expired
    subscriptionStatus: "inactive", // No subscription
    isPremium: false,
  },
  {
    email: "reviewpaid@pilotpaytracker.app",
    password: "PilotPay!2026",
    name: "Review Premium",
    firstName: "Jane",
    lastName: "Smith",
    trialStatus: "expired",        // Trial used
    subscriptionStatus: "active",   // Active subscription
    isPremium: true,
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

async function setupReviewAccounts() {
  console.log("Setting up review accounts for App Store submission...\n");

  for (const account of REVIEW_ACCOUNTS) {
    console.log(`Processing: ${account.email}`);

    // Check if user exists
    let user = await db.user.findUnique({
      where: { email: account.email },
    });

    if (!user) {
      console.log(`  Creating user...`);
      const userId = generateId();
      const hashedPassword = await bcrypt.hash(account.password, 10);

      // Create user
      user = await db.user.create({
        data: {
          id: userId,
          email: account.email,
          name: account.name,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Create credential account
      await db.account.create({
        data: {
          id: generateId(),
          accountId: userId,
          providerId: "credential",
          userId: userId,
          password: hashedPassword,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      console.log(`  User created with ID: ${user.id}`);
    } else {
      console.log(`  User exists with ID: ${user.id}`);
    }

    // Set up profile with subscription settings
    const expiredTrialDate = new Date();
    expiredTrialDate.setDate(expiredTrialDate.getDate() - 1);

    // Set subscription dates if premium
    const subscriptionStart = account.isPremium ? new Date() : null;
    const subscriptionEnd = account.isPremium
      ? new Date(new Date().setFullYear(new Date().getFullYear() + 1))
      : null;

    await db.profile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        firstName: account.firstName,
        lastName: account.lastName,
        trialStatus: account.trialStatus,
        trialStartDate: expiredTrialDate,
        trialEndDate: expiredTrialDate,
        subscriptionStatus: account.subscriptionStatus,
        subscriptionStartDate: subscriptionStart,
        subscriptionEndDate: subscriptionEnd,
        gemsId: account.isPremium ? "REV001" : "REV002",
        position: "CPT",
        base: "SDF",
        dateOfHire: "2020-01-15",
        dateOfBirth: "1985-06-20",
        hourlyRateCents: 32500,
        onboardingComplete: true,
        onboardingStep: 4,
        contractMappingStatus: "confirmed",
      },
      update: {
        firstName: account.firstName,
        lastName: account.lastName,
        trialStatus: account.trialStatus,
        trialStartDate: expiredTrialDate,
        trialEndDate: expiredTrialDate,
        subscriptionStatus: account.subscriptionStatus,
        subscriptionStartDate: subscriptionStart,
        subscriptionEndDate: subscriptionEnd,
        gemsId: account.isPremium ? "REV001" : "REV002",
        position: "CPT",
        base: "SDF",
        dateOfHire: "2020-01-15",
        dateOfBirth: "1985-06-20",
        hourlyRateCents: 32500,
        onboardingComplete: true,
        onboardingStep: 4,
        contractMappingStatus: "confirmed",
      },
    });

    console.log(`  Profile configured:`);
    console.log(`    - Trial Status: ${account.trialStatus}`);
    console.log(`    - Subscription Status: ${account.subscriptionStatus}`);
    console.log(`    - Premium Access: ${account.isPremium}`);
    console.log("");
  }

  console.log("Review account setup complete!\n");
  console.log("Credentials for App Store Reviewers:");
  console.log("=====================================");
  console.log("Trial Expired Account (shows paywall):");
  console.log("  Email: review@pilotpaytracker.app");
  console.log("  Password: PilotPay!2026");
  console.log("");
  console.log("Premium Account (full access):");
  console.log("  Email: reviewpaid@pilotpaytracker.app");
  console.log("  Password: PilotPay!2026");
  console.log("=====================================");
}

setupReviewAccounts()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error setting up review accounts:", error);
    process.exit(1);
  });
