import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AppType } from "../types";
import { db } from "../db";
import { ensureUserExists } from "../utils/ensureUser";
import { applyYTDGuaranteeFloorSimple, resolveGuaranteeMinutes } from "../lib/guarantee-engine";

const profileRouter = new Hono<AppType>();

// ============================================
// Constants
// ============================================

// UPS is the only supported airline - locked at product level
const UPS_AIRLINE = "UPS";

// Apple Review account emails - auto-populate profile so reviewers never see profile-setup
const APPLE_REVIEW_EMAILS = [
  "review@pilotpaytracker.app",
  "reviewer@pilotpaytracker.app",
  "reviewpaid@pilotpaytracker.app",
  "tester@pilotpaytracker.app",
];

function isAppleReviewEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return APPLE_REVIEW_EMAILS.some(r => email.toLowerCase() === r.toLowerCase());
}

// Auto-fill data for review accounts — realistic UPS Captain demo data
const REVIEW_PROFILE_DEFAULTS = {
  firstName: "App",
  lastName: "Review",
  gemsId: "REV-0001",
  position: "CPT",
  base: "SDF",
  airline: UPS_AIRLINE,
  dateOfHire: "2020-01-15",
  dateOfBirth: "1985-06-20",
  hourlyRateCents: 34800, // ~$348/hr realistic CPT rate
  onboardingComplete: true,
  onboardingStep: 4,
  operatorType: "cargo",
  trialStatus: "expired" as const,
  trialStartDate: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
  trialEndDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
  // Active subscription through 2030 so reviewers always have full access
  subscriptionStatus: "active" as const,
  subscriptionStartDate: new Date(),
  subscriptionEndDate: new Date("2030-12-31"),
};

// ============================================
// Helper Functions
// ============================================

function isProfileComplete(profile: {
  firstName: string | null;
  lastName: string | null;
  gemsId: string | null;
  position: string | null;
  base: string | null;
  dateOfHire: string | null;
  dateOfBirth: string | null;
  hourlyRateCents: number;
}): boolean {
  return !!(
    profile.firstName &&
    profile.lastName &&
    profile.gemsId &&
    profile.position &&
    profile.base &&
    profile.dateOfHire &&
    profile.dateOfBirth &&
    profile.hourlyRateCents > 0
  );
}

// ============================================
// Validation Schemas
// ============================================

const updateProfileSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  gemsId: z.string().optional(),
  position: z.string().optional(),
  base: z.string().optional(),
  dateOfHire: z.string().optional(),
  dateOfBirth: z.string().optional(),
  hourlyRateCents: z.number().optional(),
  airline: z.string().optional(),
  // Onboarding fields
  onboardingComplete: z.boolean().optional(),
  onboardingStep: z.number().optional(),
  aliasPackVersion: z.string().optional(),
  operatorType: z.string().optional(),
  contractMappingStatus: z.enum(["none", "suggested", "confirmed"]).optional(),
  payRuleDefaultsApplied: z.boolean().optional(),
  calendarSyncConnected: z.boolean().optional(),
  payYear: z.number().int().min(1).max(15).optional(),
  hourlyRateSource: z.enum(["contract", "manual"]).optional(),
  // Credit Cap Preferences
  creditCapPeriodType: z.string().optional(),
  creditCapAwardedLineCredit: z.number().optional(),
  creditCapIsRDGLine: z.boolean().optional(),
  creditCapAssignmentType: z.string().optional(),
  creditCapExclusionVacation: z.number().optional(),
  creditCapExclusionTraining: z.number().optional(),
  creditCapExclusionJuniorManning: z.number().optional(),
  creditCapExclusionCRAF: z.number().optional(),
  creditCapExclusionSick: z.number().optional(),
  creditCapAllowTripCompletion: z.boolean().optional(),
  creditCapTripCompletionOvercap: z.number().optional(),
  creditCapEnableVacationRelief: z.boolean().optional(),
  creditCapDroppedTripsCredit: z.number().optional(),
  creditCapHasVacationInPeriod: z.boolean().optional(),
});

// ============================================
// GET /api/profile - Get user profile
// ============================================
profileRouter.get("/", async (c) => {
  const user = c.get("user");
  if (!user) {
    console.log("❌ [Profile] GET failed: No user in context (unauthorized)");
    return c.json({ error: "Unauthorized" }, 401);
  }

  console.log(`👤 [Profile] Fetching profile for user: ${user.id}, email: ${user.email}`);

  try {
    // Ensure user exists in local database (Supabase auth migration)
    console.log(`👤 [Profile] Ensuring user exists in local database...`);
    await ensureUserExists(user, "Profile GET");
    console.log(`✅ [Profile] User exists check passed`);

    let profile = await db.profile.findUnique({
      where: { userId: user.id },
    });

    if (!profile) {
      console.log(`👤 [Profile] No profile found, creating default profile for user: ${user.id}`);
      const createData: any = {
        userId: user.id,
        airline: UPS_AIRLINE,
        operatorType: "cargo",
        // No trial auto-start — users must subscribe via Stripe
        trialStatus: "not_started",
      };

      // Auto-populate full profile for review accounts so they never hit profile-setup
      if (isAppleReviewEmail(user.email)) {
        console.log(`🍎 [Profile] Apple review account — auto-populating complete profile`);
        Object.assign(createData, REVIEW_PROFILE_DEFAULTS);
      }

      try {
        profile = await db.profile.create({ data: createData });
        console.log(`✅ [Profile] Created default profile: ${profile.id}`);
      } catch (e: any) {
        // If multiple concurrent requests try to auto-create, one may win and the other will hit P2002.
        if (e?.code === "P2002") {
          console.log(`⚠️ [Profile] Profile create raced (P2002). Fetching existing profile for user: ${user.id}`);
          profile = await db.profile.findUnique({ where: { userId: user.id } });
          if (!profile) throw e;
        } else {
          throw e;
        }
      }
    } else {
      // If review account has an incomplete profile, patch it silently
      // Also always ensure subscription is active for review accounts
      if (isAppleReviewEmail(user.email)) {
        const needsUpdate = !isProfileComplete(profile) || profile.subscriptionStatus !== "active";
        if (needsUpdate) {
          console.log(`🍎 [Profile] Apple review account — ensuring complete profile and active subscription`);
          profile = await db.profile.update({
            where: { userId: user.id },
            data: {
              firstName: profile.firstName || REVIEW_PROFILE_DEFAULTS.firstName,
              lastName: profile.lastName || REVIEW_PROFILE_DEFAULTS.lastName,
              gemsId: profile.gemsId || REVIEW_PROFILE_DEFAULTS.gemsId,
              position: profile.position || REVIEW_PROFILE_DEFAULTS.position,
              base: profile.base || REVIEW_PROFILE_DEFAULTS.base,
              dateOfHire: profile.dateOfHire || REVIEW_PROFILE_DEFAULTS.dateOfHire,
              dateOfBirth: profile.dateOfBirth || REVIEW_PROFILE_DEFAULTS.dateOfBirth,
              hourlyRateCents: profile.hourlyRateCents > 0 ? profile.hourlyRateCents : REVIEW_PROFILE_DEFAULTS.hourlyRateCents,
              onboardingComplete: true,
              trialStatus: "expired",
              trialStartDate: REVIEW_PROFILE_DEFAULTS.trialStartDate,
              trialEndDate: REVIEW_PROFILE_DEFAULTS.trialEndDate,
              subscriptionStatus: "active",
              subscriptionStartDate: REVIEW_PROFILE_DEFAULTS.subscriptionStartDate,
              subscriptionEndDate: REVIEW_PROFILE_DEFAULTS.subscriptionEndDate,
            },
          });
        }
      }
console.log(`✅ [Profile] Found existing profile: ${profile.id}`);
    }

    const profileData = {
      id: profile.id,
      firstName: profile.firstName,
      lastName: profile.lastName,
      gemsId: profile.gemsId,
      position: profile.position,
      base: profile.base,
      dateOfHire: profile.dateOfHire,
      dateOfBirth: profile.dateOfBirth,
      hourlyRateCents: profile.hourlyRateCents,
      airline: profile.airline,
      // Onboarding fields
      onboardingComplete: profile.onboardingComplete,
      onboardingStep: profile.onboardingStep,
      aliasPackVersion: profile.aliasPackVersion,
      operatorType: profile.operatorType,
      contractMappingStatus: profile.contractMappingStatus,
      payRuleDefaultsApplied: profile.payRuleDefaultsApplied,
      calendarSyncConnected: profile.calendarSyncConnected,
      // Subscription fields
      trialStatus: profile.trialStatus,
      trialStartDate: profile.trialStartDate?.toISOString() ?? null,
      trialEndDate: profile.trialEndDate?.toISOString() ?? null,
      subscriptionStatus: profile.subscriptionStatus,
      subscriptionStartDate: profile.subscriptionStartDate?.toISOString() ?? null,
      subscriptionEndDate: profile.subscriptionEndDate?.toISOString() ?? null,
      // Credit Cap Preferences
      creditCapPeriodType: profile.creditCapPeriodType,
      creditCapAwardedLineCredit: profile.creditCapAwardedLineCredit,
      creditCapIsRDGLine: profile.creditCapIsRDGLine,
      creditCapAssignmentType: profile.creditCapAssignmentType,
      creditCapExclusionVacation: profile.creditCapExclusionVacation,
      creditCapExclusionTraining: profile.creditCapExclusionTraining,
      creditCapExclusionJuniorManning: profile.creditCapExclusionJuniorManning,
      creditCapExclusionCRAF: profile.creditCapExclusionCRAF,
      creditCapExclusionSick: profile.creditCapExclusionSick,
      creditCapAllowTripCompletion: profile.creditCapAllowTripCompletion,
      creditCapTripCompletionOvercap: profile.creditCapTripCompletionOvercap,
      creditCapEnableVacationRelief: profile.creditCapEnableVacationRelief,
      creditCapDroppedTripsCredit: profile.creditCapDroppedTripsCredit,
      creditCapHasVacationInPeriod: profile.creditCapHasVacationInPeriod,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };

    return c.json({
      profile: profileData,
      isComplete: isProfileComplete(profile),
    });
  } catch (error: any) {
    console.error(`❌ [Profile] GET failed for user ${user.id}:`, {
      errorMessage: error?.message,
      errorCode: error?.code,
      errorMeta: error?.meta,
      errorStack: error?.stack?.split('\n').slice(0, 5).join('\n'),
    });

    return c.json({
      error: "Failed to load profile",
      code: error?.code,
      message: error?.message,
    }, 500);
  }
});

// ============================================
// PUT /api/profile - Update user profile
// ============================================
profileRouter.put("/", zValidator("json", updateProfileSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    console.log("❌ [Profile] PUT failed: No user in context (unauthorized)");
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = c.req.valid("json");
  console.log(`👤 [Profile] Updating profile for user: ${user.id}`);
  console.log(`👤 [Profile] Request body:`, JSON.stringify(body, null, 2));

  try {
    // Ensure user exists in local database (Supabase auth migration)
    console.log(`👤 [Profile] Ensuring user exists in local database...`);
    await ensureUserExists(user, "Profile");
    console.log(`✅ [Profile] User exists check passed`);

    // Always force UPS airline - ignore any airline value from client
    const safeAirline = UPS_AIRLINE;

    console.log(`👤 [Profile] Running profile upsert...`);
    const profile = await db.profile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        firstName: body.firstName ?? null,
        lastName: body.lastName ?? null,
        gemsId: body.gemsId ?? null,
        position: body.position ?? null,
        base: body.base ?? null,
        dateOfHire: body.dateOfHire ?? null,
        dateOfBirth: body.dateOfBirth ?? null,
        hourlyRateCents: body.hourlyRateCents ?? 32500,
        airline: safeAirline, // Always UPS
        onboardingComplete: body.onboardingComplete ?? false,
        onboardingStep: body.onboardingStep ?? 0,
        aliasPackVersion: body.aliasPackVersion ?? null,
        operatorType: body.operatorType ?? "cargo", // UPS is cargo
        contractMappingStatus: body.contractMappingStatus ?? "none",
        payRuleDefaultsApplied: body.payRuleDefaultsApplied ?? false,
        calendarSyncConnected: body.calendarSyncConnected ?? false,
      },
      update: {
        ...(body.firstName !== undefined && { firstName: body.firstName }),
        ...(body.lastName !== undefined && { lastName: body.lastName }),
        ...(body.gemsId !== undefined && { gemsId: body.gemsId }),
        ...(body.position !== undefined && { position: body.position }),
        ...(body.base !== undefined && { base: body.base }),
        ...(body.dateOfHire !== undefined && { dateOfHire: body.dateOfHire }),
        ...(body.dateOfBirth !== undefined && { dateOfBirth: body.dateOfBirth }),
        ...(body.hourlyRateCents !== undefined && {
          hourlyRateCents: body.hourlyRateCents,
        }),
        // Always force UPS airline on update
        airline: safeAirline,
        ...(body.onboardingComplete !== undefined && { onboardingComplete: body.onboardingComplete }),
        ...(body.onboardingStep !== undefined && { onboardingStep: body.onboardingStep }),
        ...(body.aliasPackVersion !== undefined && { aliasPackVersion: body.aliasPackVersion }),
        ...(body.operatorType !== undefined && { operatorType: body.operatorType }),
        ...(body.contractMappingStatus !== undefined && { contractMappingStatus: body.contractMappingStatus }),
        ...(body.payRuleDefaultsApplied !== undefined && { payRuleDefaultsApplied: body.payRuleDefaultsApplied }),
        ...(body.calendarSyncConnected !== undefined && { calendarSyncConnected: body.calendarSyncConnected }),
        // Credit Cap Preferences
        ...(body.creditCapPeriodType !== undefined && { creditCapPeriodType: body.creditCapPeriodType }),
        ...(body.creditCapAwardedLineCredit !== undefined && { creditCapAwardedLineCredit: body.creditCapAwardedLineCredit }),
        ...(body.creditCapIsRDGLine !== undefined && { creditCapIsRDGLine: body.creditCapIsRDGLine }),
        ...(body.creditCapAssignmentType !== undefined && { creditCapAssignmentType: body.creditCapAssignmentType }),
        ...(body.creditCapExclusionVacation !== undefined && { creditCapExclusionVacation: body.creditCapExclusionVacation }),
        ...(body.creditCapExclusionTraining !== undefined && { creditCapExclusionTraining: body.creditCapExclusionTraining }),
        ...(body.creditCapExclusionJuniorManning !== undefined && { creditCapExclusionJuniorManning: body.creditCapExclusionJuniorManning }),
        ...(body.creditCapExclusionCRAF !== undefined && { creditCapExclusionCRAF: body.creditCapExclusionCRAF }),
        ...(body.creditCapExclusionSick !== undefined && { creditCapExclusionSick: body.creditCapExclusionSick }),
        ...(body.creditCapAllowTripCompletion !== undefined && { creditCapAllowTripCompletion: body.creditCapAllowTripCompletion }),
        ...(body.creditCapTripCompletionOvercap !== undefined && { creditCapTripCompletionOvercap: body.creditCapTripCompletionOvercap }),
        ...(body.creditCapEnableVacationRelief !== undefined && { creditCapEnableVacationRelief: body.creditCapEnableVacationRelief }),
        ...(body.creditCapDroppedTripsCredit !== undefined && { creditCapDroppedTripsCredit: body.creditCapDroppedTripsCredit }),
        ...(body.creditCapHasVacationInPeriod !== undefined && { creditCapHasVacationInPeriod: body.creditCapHasVacationInPeriod }),
      },
    });

    console.log(`✅ [Profile] Updated profile for user: ${user.id}`);

    return c.json({
      success: true,
      profile: {
        id: profile.id,
        firstName: profile.firstName,
        lastName: profile.lastName,
        gemsId: profile.gemsId,
        position: profile.position,
        base: profile.base,
        dateOfHire: profile.dateOfHire,
        dateOfBirth: profile.dateOfBirth,
        hourlyRateCents: profile.hourlyRateCents,
        airline: profile.airline,
        // Onboarding fields
        onboardingComplete: profile.onboardingComplete,
        onboardingStep: profile.onboardingStep,
        aliasPackVersion: profile.aliasPackVersion,
        operatorType: profile.operatorType,
        contractMappingStatus: profile.contractMappingStatus,
        payRuleDefaultsApplied: profile.payRuleDefaultsApplied,
        calendarSyncConnected: profile.calendarSyncConnected,
        // Credit Cap Preferences
        creditCapPeriodType: profile.creditCapPeriodType,
        creditCapAwardedLineCredit: profile.creditCapAwardedLineCredit,
        creditCapIsRDGLine: profile.creditCapIsRDGLine,
        creditCapAssignmentType: profile.creditCapAssignmentType,
        creditCapExclusionVacation: profile.creditCapExclusionVacation,
        creditCapExclusionTraining: profile.creditCapExclusionTraining,
        creditCapExclusionJuniorManning: profile.creditCapExclusionJuniorManning,
        creditCapExclusionCRAF: profile.creditCapExclusionCRAF,
        creditCapExclusionSick: profile.creditCapExclusionSick,
        creditCapAllowTripCompletion: profile.creditCapAllowTripCompletion,
        creditCapTripCompletionOvercap: profile.creditCapTripCompletionOvercap,
        creditCapEnableVacationRelief: profile.creditCapEnableVacationRelief,
        creditCapDroppedTripsCredit: profile.creditCapDroppedTripsCredit,
        creditCapHasVacationInPeriod: profile.creditCapHasVacationInPeriod,
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
      },
      isComplete: isProfileComplete(profile),
    });
  } catch (error: any) {
    // Log detailed error information
    console.error(`❌ [Profile] PUT failed for user ${user.id}:`, {
      errorMessage: error?.message,
      errorCode: error?.code,
      errorMeta: error?.meta,
      errorStack: error?.stack?.split('\n').slice(0, 5).join('\n'),
    });

    // Return more detailed error to client for debugging
    return c.json({
      error: "Failed to save profile",
      code: error?.code,
      message: error?.message,
      details: error?.meta,
    }, 500);
  }
});

// ============================================
// DELETE /api/profile - Reset user profile
// ============================================
profileRouter.delete("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  console.log(`🗑️ [Profile] Deleting profile for user: ${user.id}`);

  // Delete the profile - will be recreated on next fetch
  await db.profile.deleteMany({
    where: { userId: user.id },
  });

  // Also delete all related data
  await db.flightEntry.deleteMany({
    where: { userId: user.id },
  });

  await db.trip.deleteMany({
    where: { userId: user.id },
  });

  console.log(`✅ [Profile] Deleted all data for user: ${user.id}`);

  return c.json({ success: true });
});

// ============================================
// DELETE /api/account - Permanently delete user account and all data
// ============================================
profileRouter.delete("/account", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  console.log(`🗑️ [Account] Permanently deleting account for user: ${user.id}`);

  // Delete all user data in dependency order
  await db.calendarPendingChange.deleteMany({ where: { userId: user.id } });
  await db.calendarConnection.deleteMany({ where: { userId: user.id } });
  await db.premiumEventSuggestion.deleteMany({ where: { userId: user.id } });
  await db.userCustomTerm.deleteMany({ where: { userId: user.id } });
  await db.userHotelDirectory.deleteMany({ where: { userId: user.id } });
  await db.userNotificationSettings.deleteMany({ where: { userId: user.id } });
  await db.payrollProfile.deleteMany({ where: { userId: user.id } });
  await db.payEvent.deleteMany({ where: { userId: user.id } });
  await db.flightEntry.deleteMany({ where: { userId: user.id } });
  await db.trip.deleteMany({ where: { userId: user.id } });
  await db.profile.deleteMany({ where: { userId: user.id } });

  // Delete the auth user record (cascades to sessions, accounts, passkeys)
  await db.user.delete({ where: { id: user.id } });

  console.log(`✅ [Account] Permanently deleted account: ${user.id}`);

  return c.json({ success: true });
});

// ============================================
// GET /api/profile/stats - Get user statistics
// Calculates pay from credit minutes * hourly rate (like dashboard)
// ============================================
profileRouter.get("/stats", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  // Get user profile for hourly rate
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
    select: { hourlyRateCents: true, creditCapPeriodType: true },
  });

  const hourlyRateCents = profile?.hourlyRateCents ?? 32500;
  const creditCapPeriodType = profile?.creditCapPeriodType ?? null;

  const currentYear = new Date().getFullYear();
  const yearStart = `${currentYear}-01-01`;
  const yearEnd = `${currentYear}-12-31`;

  const today = new Date();
  const monthStart = `${currentYear}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const nextMonth = new Date(currentYear, today.getMonth() + 1, 0);
  const monthEnd = `${currentYear}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(nextMonth.getDate()).padStart(2, "0")}`;

  // Get legacy flight entry stats (for backward compatibility)
  const allFlights = await db.flightEntry.aggregate({
    where: { userId: user.id },
    _sum: {
      blockMinutes: true,
      creditMinutes: true,
      totalPayCents: true,
    },
    _count: true,
  });

  // Get user-entered lifetime earnings for prior years (not current year — that's covered by trips/flight entries)
  const priorYearLifetimeEarnings = await db.lifetimeEarningsYear.findMany({
    where: { userId: user.id, year: { lt: currentYear } },
    select: { grossEarningsCents: true },
  });
  const priorYearsEarningsCents = priorYearLifetimeEarnings.reduce(
    (sum, y) => sum + y.grossEarningsCents,
    0
  );

  const yearFlights = await db.flightEntry.aggregate({
    where: {
      userId: user.id,
      dateISO: { gte: yearStart, lte: yearEnd },
    },
    _sum: {
      blockMinutes: true,
      creditMinutes: true,
      totalPayCents: true,
    },
    _count: true,
  });

  const monthFlights = await db.flightEntry.aggregate({
    where: {
      userId: user.id,
      dateISO: { gte: monthStart, lte: monthEnd },
    },
    _sum: {
      blockMinutes: true,
      creditMinutes: true,
      totalPayCents: true,
    },
    _count: true,
  });

  // Get stats from trips/legs (schedule sync data)
  // Exclude cancelled and override trips (override trips are visible but shouldn't count toward pay)
  const allTrips = await db.trip.findMany({
    where: {
      userId: user.id,
      status: { notIn: ["cancelled", "override"] },
    },
    include: {
      dutyDays: {
        include: { legs: true },
      },
    },
  });

  // Calculate totals from trips
  // IMPORTANT: Calculate pay from credit minutes * hourly rate (not stored totalPayCents)
  // This matches the dashboard calculation logic
  let allTimeTripBlock = 0;
  let allTimeTripCredit = 0;
  let allTimeLegCount = 0;

  let yearTripBlock = 0;
  let yearTripCredit = 0;
  let yearLegCount = 0;

  let monthTripBlock = 0;
  let monthTripCredit = 0;
  let monthLegCount = 0;

  for (const trip of allTrips) {
    // Use trip-level payCreditMinutes if available (includes pay protection)
    // This is set when pay protection is calculated
    const tripPayCredit = trip.payCreditMinutes || 0;

    if (trip.dutyDays.length > 0) {
      for (const dutyDay of trip.dutyDays) {
        // Get credit minutes: prioritize final > actual > planned
        let creditMin: number;
        let blockMin: number;

        if (dutyDay.legs.length > 0) {
          // Sum from legs
          blockMin = 0;
          creditMin = 0;
          for (const leg of dutyDay.legs) {
            blockMin += leg.actualBlockMinutes || leg.plannedBlockMinutes || 0;
            creditMin += leg.creditMinutes || leg.plannedCreditMinutes || 0;
          }
        } else {
          // Use duty day values
          creditMin = dutyDay.finalCreditMinutes || dutyDay.actualCreditMinutes || dutyDay.plannedCreditMinutes || 0;
          blockMin = dutyDay.actualBlockMinutes || 0;
        }

        // All time
        allTimeTripBlock += blockMin;
        allTimeTripCredit += creditMin;
        allTimeLegCount++;

        // Current year (filter by duty day date)
        if (dutyDay.dutyDate >= yearStart && dutyDay.dutyDate <= yearEnd) {
          yearTripBlock += blockMin;
          yearTripCredit += creditMin;
          yearLegCount++;
        }

        // Current month (filter by duty day date)
        if (dutyDay.dutyDate >= monthStart && dutyDay.dutyDate <= monthEnd) {
          monthTripBlock += blockMin;
          monthTripCredit += creditMin;
          monthLegCount++;
        }
      }
    } else if (trip.totalCreditMinutes > 0) {
      // Trip has no duty days but has totals - use trip-level data
      const tripCredit = tripPayCredit > 0 ? tripPayCredit : trip.totalCreditMinutes;

      allTimeTripBlock += trip.totalBlockMinutes || 0;
      allTimeTripCredit += tripCredit;
      allTimeLegCount++;

      // For trips without duty days, check if trip falls within date range
      if (trip.startDate >= yearStart && trip.endDate <= yearEnd) {
        yearTripBlock += trip.totalBlockMinutes || 0;
        yearTripCredit += tripCredit;
        yearLegCount++;
      }

      if (trip.startDate >= monthStart && trip.endDate <= monthEnd) {
        monthTripBlock += trip.totalBlockMinutes || 0;
        monthTripCredit += tripCredit;
        monthLegCount++;
      }
    }
  }

  // Calculate pay from credit minutes * hourly rate
  // Apply monthly guarantee floor: pilots are paid at least guarantee hrs/month.
  // monthsElapsed for YTD floor, 1 month for current-month floor.
  const monthsElapsedThisYear = today.getMonth() + 1; // Jan=1 … Dec=12
  const guaranteeMin = resolveGuaranteeMinutes(creditCapPeriodType);

  // Month: floor at one month's guarantee
  const monthCreditFloored = Math.max(monthTripCredit, guaranteeMin);
  // Year: floor at guaranteeMin × months elapsed
  const yearCreditFloored = applyYTDGuaranteeFloorSimple(yearTripCredit, monthsElapsedThisYear, creditCapPeriodType);

  const calculatePay = (creditMinutes: number): number => {
    return Math.round((creditMinutes / 60) * hourlyRateCents);
  };

  const allTimeTripPay = calculatePay(allTimeTripCredit);
  const yearTripPay = calculatePay(yearCreditFloored);
  const monthTripPay = calculatePay(monthCreditFloored);

  // Get trip counts by status
  const tripCounts = await db.trip.groupBy({
    by: ["status"],
    where: { userId: user.id },
    _count: true,
  });

  // Combine flight entries and trip data
  return c.json({
    allTime: {
      flightCount: allFlights._count + allTimeLegCount,
      blockMinutes: (allFlights._sum.blockMinutes ?? 0) + allTimeTripBlock,
      creditMinutes: (allFlights._sum.creditMinutes ?? 0) + allTimeTripCredit,
      totalPayCents: (allFlights._sum.totalPayCents ?? 0) + allTimeTripPay + priorYearsEarningsCents,
    },
    currentYear: {
      year: currentYear,
      flightCount: yearFlights._count + yearLegCount,
      blockMinutes: (yearFlights._sum.blockMinutes ?? 0) + yearTripBlock,
      creditMinutes: (yearFlights._sum.creditMinutes ?? 0) + yearTripCredit,
      totalPayCents: (yearFlights._sum.totalPayCents ?? 0) + yearTripPay,
    },
    currentMonth: {
      month: monthStart.substring(0, 7),
      flightCount: monthFlights._count + monthLegCount,
      blockMinutes: (monthFlights._sum.blockMinutes ?? 0) + monthTripBlock,
      creditMinutes: (monthFlights._sum.creditMinutes ?? 0) + monthTripCredit,
      totalPayCents: (monthFlights._sum.totalPayCents ?? 0) + monthTripPay,
    },
    trips: {
      scheduled: tripCounts.find((t) => t.status === "scheduled")?._count ?? 0,
      inProgress: tripCounts.find((t) => t.status === "in_progress")?._count ?? 0,
      completed: tripCounts.find((t) => t.status === "completed")?._count ?? 0,
    },
  });
});

export { profileRouter };
