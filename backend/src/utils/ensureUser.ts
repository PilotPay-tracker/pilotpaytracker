/**
 * ensureUser - verifies the current Better Auth user exists in the local DB.
 * Also detects and merges legacy user accounts (e.g., CUID → UUID migration)
 * where the same email exists under multiple user IDs. This happens when
 * BetterAuth recreates a user with a new UUID-format ID, leaving trip/profile
 * data orphaned under the old CUID-format ID.
 */
import { db } from "../db";

interface UserInfo {
  id: string;
  email?: string | null;
  name?: string | null;
}

// Tables where we need to migrate userId references
const USER_ID_TABLES = [
  "trip",
  "flight_entry",
  "pay_event",
  "pay_period",
  "pay_rule",
  "pay_statement_upload",
  "schedule_event",
  "schedule_snapshot",
  "schedule_batch",
  "contract_document",
  "contract_reference",
  "log_event",
  "sick_bank",
  "sick_accrual_log",
  "sick_usage_log",
  "sick_call_event",
  "reserve_schedule_event",
  "reserve_window_config",
  "schedule_reminder_settings",
  "lifetime_earnings_config",
  "lifetime_earnings_year",
  "tax_profile",
  "payroll_profile",
  "referral",
  "referral_stats",
  "calendar_connection",
  "user_notification_settings",
  "user_custom_term",
  "saved_planner_scenario",
  "year_plan",
  "lap_entry",
  "export_packet",
  "issue_report",
  "pay_benchmark",
  "logbook_import",
] as const;

export async function ensureUserExists(user: UserInfo, context?: string): Promise<void> {
  const prefix = context ? `[${context}]` : "";

  if (!user.id) {
    console.error(`❌ ${prefix} ensureUserExists called with no user ID`);
    throw new Error("User ID is required");
  }

  const exists = await db.user.findUnique({ where: { id: user.id }, select: { id: true } });
  if (!exists) {
    console.warn(`⚠️ ${prefix} User ${user.id} not found in local DB (Better Auth should have created it)`);
    return;
  }

  // Check for legacy users with the same email but different ID (CUID vs UUID migration)
  if (!user.email) return;

  const legacyUser = await db.user.findFirst({
    where: { email: user.email, id: { not: user.id } },
    select: { id: true },
  });

  if (!legacyUser) return;

  // Found a legacy duplicate — migrate all data to current user ID
  console.log(`🔄 ${prefix} Migrating legacy user data ${legacyUser.id} → ${user.id} for ${user.email}`);

  try {
    // Migrate each table that has a userId column
    for (const table of USER_ID_TABLES) {
      try {
        await db.$executeRawUnsafe(
          `UPDATE "${table}" SET "userId" = ? WHERE "userId" = ?`,
          user.id,
          legacyUser.id,
        );
      } catch {
        // Table may not have userId column or not exist — skip silently
      }
    }

    // Merge profile: if legacy has a profile but current doesn't, move it;
    // if both exist, keep the current one (it was created with defaults)
    const legacyProfile = await db.profile.findUnique({ where: { userId: legacyUser.id } });
    const currentProfile = await db.profile.findUnique({ where: { userId: user.id } });

    if (legacyProfile && !currentProfile) {
      await db.profile.update({ where: { userId: legacyUser.id }, data: { userId: user.id } });
      console.log(`✅ ${prefix} Profile transferred from legacy user`);
    } else if (legacyProfile && currentProfile) {
      // Both exist — merge key fields from legacy into current (hourly rate, settings)
      await db.profile.update({
        where: { userId: user.id },
        data: {
          hourlyRateCents: legacyProfile.hourlyRateCents,
          creditCapPeriodType: legacyProfile.creditCapPeriodType,
          airline: legacyProfile.airline || currentProfile.airline,
          base: legacyProfile.base || currentProfile.base,
          position: legacyProfile.position || currentProfile.position,
          dateOfHire: legacyProfile.dateOfHire || currentProfile.dateOfHire,
          dateOfBirth: legacyProfile.dateOfBirth || currentProfile.dateOfBirth,
          gemsId: legacyProfile.gemsId || currentProfile.gemsId,
          firstName: legacyProfile.firstName || currentProfile.firstName,
          lastName: legacyProfile.lastName || currentProfile.lastName,
          onboardingComplete: legacyProfile.onboardingComplete || currentProfile.onboardingComplete,
        },
      });
      await db.profile.delete({ where: { userId: legacyUser.id } });
      console.log(`✅ ${prefix} Profiles merged (kept current, merged legacy fields)`);
    }

    // Remove the legacy user (cascade deletes its sessions, accounts, etc.)
    await db.user.delete({ where: { id: legacyUser.id } });
    console.log(`✅ ${prefix} Legacy user ${legacyUser.id} removed after migration`);
  } catch (err) {
    console.error(`⚠️ ${prefix} Migration failed for ${legacyUser.id}:`, err);
    // Non-fatal — dashboard will still return partial data
  }
}
