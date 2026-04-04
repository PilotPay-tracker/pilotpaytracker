import { Hono } from "hono";
import { type AppType } from "../types";
import { db } from "../db";

const adminRouter = new Hono<AppType>();

// ============================================
// ROLES — Single source of truth
// ============================================
const SUPER_ADMIN_EMAIL = "pdavis.ups@outlook.com";
const ADMIN_EMAILS = [SUPER_ADMIN_EMAIL];

function isSuperAdmin(email: string): boolean {
  return email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
}

function isAdmin(email: string): boolean {
  return ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email.toLowerCase());
}

// ============================================
// AUDIT LOGGING HELPER
// ============================================
async function auditLog(
  adminUserId: string,
  adminEmail: string,
  actionType: string,
  details?: string,
  targetUserId?: string,
  targetEmail?: string
) {
  try {
    await db.adminAuditLog.create({
      data: {
        adminEmail,
        adminUserId,
        targetEmail,
        targetUserId,
        actionType,
        details,
      },
    });
  } catch (err) {
    console.error("[Admin] Audit log write failed:", err);
  }
}

// ============================================
// MIDDLEWARE — requires admin (any level)
// ============================================
const requireAdmin = async (c: any, next: () => Promise<void>) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Not authenticated" }, 401);
  }

  if (!isAdmin(user.email ?? "")) {
    console.log(`[Admin] Access denied for user: ${user.email}`);
    return c.json({ error: "Not authorized - admin access required" }, 403);
  }

  console.log(`[Admin] Access granted for: ${user.email}`);
  return next();
};

// ============================================
// MIDDLEWARE — requires SUPER_ADMIN only
// ============================================
const requireSuperAdmin = async (c: any, next: () => Promise<void>) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Not authenticated" }, 401);
  }

  if (!isSuperAdmin(user.email ?? "")) {
    console.log(`[Admin] Super admin access denied for: ${user.email}`);
    return c.json({ error: "Not authorized - super admin access required" }, 403);
  }

  return next();
};

// ============================================
// SUPER ADMIN BYPASS — ensure lifetime premium
// Called on admin check to guarantee creator always has access
// ============================================
async function ensureSuperAdminPremium(userId: string) {
  try {
    const profile = await db.profile.findUnique({
      where: { userId },
      select: {
        subscriptionStatus: true,
        adminRole: true,
      },
    });

    if (!profile) return;

    const needsRoleUpdate = profile.adminRole !== "super_admin";
    const needsPremium = profile.subscriptionStatus !== "active_lifetime";

    if (needsRoleUpdate || needsPremium) {
      await db.profile.update({
        where: { userId },
        data: {
          ...(needsRoleUpdate ? { adminRole: "super_admin" } : {}),
          ...(needsPremium
            ? {
                subscriptionStatus: "active_lifetime",
                subscriptionStartDate: new Date(),
                subscriptionEndDate: null,
              }
            : {}),
        },
      });
      console.log(`[Admin] Super admin premium ensured for userId: ${userId}`);
    }
  } catch (err) {
    console.error("[Admin] ensureSuperAdminPremium error:", err);
  }
}

// ============================================
// GET /api/admin/check - Check if current user is admin
// ============================================
adminRouter.get("/check", async (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ isAdmin: false, reason: "not_authenticated" });
  }

  const userIsAdmin = isAdmin(user.email ?? "");
  const userIsSuperAdmin = isSuperAdmin(user.email ?? "");

  // Ensure super admin always has lifetime premium (non-blocking on errors)
  if (userIsSuperAdmin) {
    ensureSuperAdminPremium(user.id).catch(console.error);
  }

  return c.json({
    isAdmin: userIsAdmin,
    isSuperAdmin: userIsSuperAdmin,
    email: user.email,
  });
});

// ============================================
// GET /api/admin/stats - Get overall app statistics
// ============================================
adminRouter.get("/stats", requireAdmin, async (c) => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const totalUsers = await db.user.count();
  const usersToday = await db.user.count({ where: { createdAt: { gte: todayStart } } });
  const usersThisWeek = await db.user.count({ where: { createdAt: { gte: weekAgo } } });
  const usersThisMonth = await db.user.count({ where: { createdAt: { gte: monthAgo } } });
  const activeSessions = await db.session.count({ where: { expiresAt: { gt: now } } });
  const activeToday = await db.session.groupBy({
    by: ["userId"],
    where: { updatedAt: { gte: todayStart } },
  });
  const profilesWithOnboarding = await db.profile.count({ where: { onboardingComplete: true } });
  const totalTrips = await db.trip.count();
  const tripsThisWeek = await db.trip.count({ where: { createdAt: { gte: weekAgo } } });
  const totalPayEvents = await db.payEvent.count();
  const openPayEvents = await db.payEvent.count({ where: { status: "open" } });
  const totalIssues = await db.issueReport.count();
  const openIssues = await db.issueReport.count({ where: { status: "open" } });
  const issuesThisWeek = await db.issueReport.count({ where: { createdAt: { gte: weekAgo } } });
  const airlineDistribution = await db.profile.groupBy({
    by: ["airline"],
    _count: { airline: true },
    orderBy: { _count: { airline: "desc" } },
  });

  // Subscription stats
  const activeSubscriptions = await db.profile.count({
    where: { subscriptionStatus: "active" },
  });
  const lifetimeAccounts = await db.profile.count({
    where: { subscriptionStatus: "active_lifetime" },
  });
  const activeTrials = await db.profile.count({
    where: { trialStatus: "active" },
  });

  return c.json({
    timestamp: now.toISOString(),
    users: {
      total: totalUsers,
      today: usersToday,
      thisWeek: usersThisWeek,
      thisMonth: usersThisMonth,
      activeToday: activeToday.length,
      activeSessions,
      onboardingCompleteRate:
        totalUsers > 0 ? Math.round((profilesWithOnboarding / totalUsers) * 100) : 0,
    },
    trips: { total: totalTrips, thisWeek: tripsThisWeek },
    payEvents: { total: totalPayEvents, open: openPayEvents },
    issues: { total: totalIssues, open: openIssues, thisWeek: issuesThisWeek },
    subscriptions: {
      active: activeSubscriptions,
      lifetime: lifetimeAccounts,
      activeTrials,
    },
    airlines: airlineDistribution.map((a) => ({
      airline: a.airline,
      count: a._count.airline,
    })),
  });
});

// ============================================
// GET /api/admin/users - List/Search all users
// ============================================
adminRouter.get("/users", requireAdmin, async (c) => {
  const search = c.req.query("search");
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");

  const where = search
    ? {
        OR: [
          { email: { contains: search } },
          { name: { contains: search } },
          { Profile: { firstName: { contains: search } } },
          { Profile: { lastName: { contains: search } } },
          { Profile: { gemsId: { contains: search } } },
        ],
      }
    : undefined;

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      include: {
        Profile: {
          select: {
            firstName: true,
            lastName: true,
            airline: true,
            base: true,
            position: true,
            gemsId: true,
            onboardingComplete: true,
            subscriptionStatus: true,
            trialStatus: true,
            adminRole: true,
          },
        },
        sessions: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { updatedAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    db.user.count({ where }),
  ]);

  return c.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      createdAt: u.createdAt,
      profile: u.Profile,
      lastActive: u.sessions[0]?.updatedAt ?? null,
    })),
    total,
    limit,
    offset,
  });
});

// ============================================
// GET /api/admin/users/:id - Get full user details (Support View)
// ============================================
adminRouter.get("/users/:id", requireAdmin, async (c) => {
  const userId = c.req.param("id");
  const adminUser = c.get("user")!;

  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      Profile: true,
      sessions: {
        orderBy: { updatedAt: "desc" },
        take: 5,
      },
    },
  });

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const [tripCount, payEventCount, flightCount, issueCount] = await Promise.all([
    db.trip.count({ where: { userId } }),
    db.payEvent.count({ where: { userId } }),
    db.flightEntry.count({ where: { userId } }),
    db.issueReport.count({ where: { userId } }),
  ]);

  const recentTrips = await db.trip.findMany({
    where: { userId },
    orderBy: { startDate: "desc" },
    take: 10,
    select: {
      id: true,
      tripNumber: true,
      pairingId: true,
      startDate: true,
      endDate: true,
      totalCreditMinutes: true,
      totalPayCents: true,
      status: true,
      needsReview: true,
      source: true,
    },
  });

  const recentPayEvents = await db.payEvent.findMany({
    where: { userId },
    orderBy: { eventDateISO: "desc" },
    take: 10,
    select: {
      id: true,
      eventType: true,
      title: true,
      eventDateISO: true,
      status: true,
      creditDifferenceMinutes: true,
      payDifferenceCents: true,
    },
  });

  const issues = await db.issueReport.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const notificationSettings = await db.userNotificationSettings.findUnique({
    where: { userId },
  });

  const taxProfile = await db.taxProfile.findUnique({ where: { userId } });

  // Get recent uploads for sync status
  const recentUploads = await db.upload.findMany({
    where: { userId },
    orderBy: { uploadedAt: "desc" },
    take: 5,
    select: {
      id: true,
      sourceType: true,
      status: true,
      uploadedAt: true,
      errorMessage: true,
    },
  });

  // Audit: log opening support view
  await auditLog(
    adminUser.id,
    adminUser.email ?? "",
    "OPEN_SUPPORT_VIEW",
    `Opened support view for user ${user.email}`,
    userId,
    user.email
  );

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    profile: user.Profile,
    sessions: user.sessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      expiresAt: s.expiresAt,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
    })),
    stats: { tripCount, payEventCount, flightCount, issueCount },
    recentTrips,
    recentPayEvents,
    issues,
    notificationSettings,
    taxProfile,
    recentUploads,
    syncStatus: {
      lastScheduleUpload: recentUploads[0]?.uploadedAt ?? null,
      uploadStatus: recentUploads[0]?.status ?? null,
      lastLogin: user.sessions[0]?.updatedAt ?? null,
    },
  });
});

// ============================================
// PUT /api/admin/users/:id/profile - Update user profile
// ============================================
adminRouter.put("/users/:id/profile", requireAdmin, async (c) => {
  const userId = c.req.param("id");
  const body = await c.req.json();
  const adminUser = c.get("user")!;

  const profile = await db.profile.findUnique({ where: { userId } });
  if (!profile) return c.json({ error: "Profile not found" }, 404);

  const allowedFields = [
    "firstName",
    "lastName",
    "gemsId",
    "position",
    "base",
    "dateOfHire",
    "dateOfBirth",
    "hourlyRateCents",
    "airline",
    "onboardingComplete",
    "onboardingStep",
    "contractMappingStatus",
  ];

  const updateData: Record<string, any> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field];
    }
  }

  const updated = await db.profile.update({ where: { userId }, data: updateData });

  // Get target user email for audit
  const targetUser = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  await auditLog(
    adminUser.id,
    adminUser.email ?? "",
    "UPDATE_USER_PROFILE",
    `Updated profile fields: ${Object.keys(updateData).join(", ")}`,
    userId,
    targetUser?.email
  );

  console.log(`[Admin] Updated profile for user ${userId}:`, updateData);
  return c.json({ success: true, profile: updated });
});

// ============================================
// DELETE /api/admin/users/:id/trips
// ============================================
adminRouter.delete("/users/:id/trips", requireAdmin, async (c) => {
  const userId = c.req.param("id");
  const adminUser = c.get("user")!;

  const deleted = await db.trip.deleteMany({ where: { userId } });
  const targetUser = await db.user.findUnique({ where: { id: userId }, select: { email: true } });

  await auditLog(
    adminUser.id,
    adminUser.email ?? "",
    "DELETE_USER_TRIPS",
    `Deleted ${deleted.count} trips`,
    userId,
    targetUser?.email
  );

  console.log(`[Admin] Deleted ${deleted.count} trips for user ${userId}`);
  return c.json({ success: true, deletedCount: deleted.count });
});

// ============================================
// DELETE /api/admin/users/:id/pay-events
// ============================================
adminRouter.delete("/users/:id/pay-events", requireAdmin, async (c) => {
  const userId = c.req.param("id");
  const adminUser = c.get("user")!;

  const deleted = await db.payEvent.deleteMany({ where: { userId } });
  const targetUser = await db.user.findUnique({ where: { id: userId }, select: { email: true } });

  await auditLog(
    adminUser.id,
    adminUser.email ?? "",
    "DELETE_USER_PAY_EVENTS",
    `Deleted ${deleted.count} pay events`,
    userId,
    targetUser?.email
  );

  console.log(`[Admin] Deleted ${deleted.count} pay events for user ${userId}`);
  return c.json({ success: true, deletedCount: deleted.count });
});

// ============================================
// POST /api/admin/users/:id/reset-onboarding
// ============================================
adminRouter.post("/users/:id/reset-onboarding", requireAdmin, async (c) => {
  const userId = c.req.param("id");
  const adminUser = c.get("user")!;

  const profile = await db.profile.update({
    where: { userId },
    data: {
      onboardingComplete: false,
      onboardingStep: 0,
      contractMappingStatus: "none",
    },
  });

  const targetUser = await db.user.findUnique({ where: { id: userId }, select: { email: true } });

  await auditLog(
    adminUser.id,
    adminUser.email ?? "",
    "RESET_ONBOARDING",
    "Reset user onboarding",
    userId,
    targetUser?.email
  );

  console.log(`[Admin] Reset onboarding for user ${userId}`);
  return c.json({ success: true, profile });
});

// ============================================
// DELETE /api/admin/users/:id/sessions
// ============================================
adminRouter.delete("/users/:id/sessions", requireAdmin, async (c) => {
  const userId = c.req.param("id");
  const adminUser = c.get("user")!;

  const deleted = await db.session.deleteMany({ where: { userId } });
  const targetUser = await db.user.findUnique({ where: { id: userId }, select: { email: true } });

  await auditLog(
    adminUser.id,
    adminUser.email ?? "",
    "INVALIDATE_SESSIONS",
    `Invalidated ${deleted.count} sessions (force logout)`,
    userId,
    targetUser?.email
  );

  console.log(`[Admin] Deleted ${deleted.count} sessions for user ${userId}`);
  return c.json({ success: true, deletedCount: deleted.count });
});

// ============================================
// GET /api/admin/issues
// ============================================
adminRouter.get("/issues", requireAdmin, async (c) => {
  const status = c.req.query("status");
  const limit = parseInt(c.req.query("limit") || "50");

  const issues = await db.issueReport.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const userIds = [...new Set(issues.map((i) => i.userId))];
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, name: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  return c.json({
    issues: issues.map((issue) => ({
      ...issue,
      user: userMap.get(issue.userId) ?? null,
    })),
  });
});

// ============================================
// PUT /api/admin/issues/:id
// ============================================
adminRouter.put("/issues/:id", requireAdmin, async (c) => {
  const issueId = c.req.param("id");
  const body = await c.req.json<{ status?: string; adminNotes?: string }>();
  const adminUser = c.get("user")!;

  const issue = await db.issueReport.update({
    where: { id: issueId },
    data: { status: body.status, adminNotes: body.adminNotes },
  });

  await auditLog(
    adminUser.id,
    adminUser.email ?? "",
    "UPDATE_ISSUE",
    `Updated issue ${issueId} status=${body.status}`,
    issue.userId
  );

  console.log(`[Admin] Updated issue ${issueId}:`, body);
  return c.json({ success: true, issue });
});

// ============================================
// GET /api/admin/users/:id/trips
// ============================================
adminRouter.get("/users/:id/trips", requireAdmin, async (c) => {
  const userId = c.req.param("id");
  const limit = parseInt(c.req.query("limit") || "50");

  const trips = await db.trip.findMany({
    where: { userId },
    orderBy: { startDate: "desc" },
    take: limit,
    include: {
      dutyDays: { include: { legs: true } },
    },
  });

  return c.json({ trips });
});

// ============================================
// GET /api/admin/users/:id/pay-events
// ============================================
adminRouter.get("/users/:id/pay-events", requireAdmin, async (c) => {
  const userId = c.req.param("id");
  const limit = parseInt(c.req.query("limit") || "50");

  const payEvents = await db.payEvent.findMany({
    where: { userId },
    orderBy: { eventDateISO: "desc" },
    take: limit,
    include: { documentation: true },
  });

  return c.json({ payEvents });
});

// ============================================
// PUT /api/admin/trips/:id
// ============================================
adminRouter.put("/trips/:id", requireAdmin, async (c) => {
  const tripId = c.req.param("id");
  const body = await c.req.json();

  const allowedFields = [
    "status",
    "needsReview",
    "totalCreditMinutes",
    "totalPayCents",
    "totalBlockMinutes",
  ];

  const updateData: Record<string, any> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) updateData[field] = body[field];
  }

  const trip = await db.trip.update({ where: { id: tripId }, data: updateData });
  console.log(`[Admin] Updated trip ${tripId}:`, updateData);
  return c.json({ success: true, trip });
});

// ============================================
// PUT /api/admin/pay-events/:id
// ============================================
adminRouter.put("/pay-events/:id", requireAdmin, async (c) => {
  const payEventId = c.req.param("id");
  const body = await c.req.json();

  const allowedFields = [
    "status",
    "needsReview",
    "title",
    "description",
    "creditDifferenceMinutes",
    "payDifferenceCents",
  ];

  const updateData: Record<string, any> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) updateData[field] = body[field];
  }

  const payEvent = await db.payEvent.update({ where: { id: payEventId }, data: updateData });
  console.log(`[Admin] Updated pay event ${payEventId}:`, updateData);
  return c.json({ success: true, payEvent });
});

// ============================================
// DELETE /api/admin/trips/:id
// ============================================
adminRouter.delete("/trips/:id", requireAdmin, async (c) => {
  const tripId = c.req.param("id");
  await db.trip.delete({ where: { id: tripId } });
  console.log(`[Admin] Deleted trip ${tripId}`);
  return c.json({ success: true });
});

// ============================================
// DELETE /api/admin/pay-events/:id
// ============================================
adminRouter.delete("/pay-events/:id", requireAdmin, async (c) => {
  const payEventId = c.req.param("id");
  await db.payEvent.delete({ where: { id: payEventId } });
  console.log(`[Admin] Deleted pay event ${payEventId}`);
  return c.json({ success: true });
});

// ============================================================
// PHASE 5 — SUBSCRIPTION / ROLE CONTROL (SUPER ADMIN ONLY)
// ============================================================

// POST /api/admin/users/:id/subscription - Set subscription status
adminRouter.post("/users/:id/subscription", requireSuperAdmin, async (c) => {
  const userId = c.req.param("id");
  const body = await c.req.json<{
    subscriptionStatus: "inactive" | "active" | "active_lifetime" | "cancelled";
    notes?: string;
  }>();
  const adminUser = c.get("user")!;

  const targetUser = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!targetUser) return c.json({ error: "User not found" }, 404);

  const updateData: Record<string, any> = {
    subscriptionStatus: body.subscriptionStatus,
  };

  if (body.subscriptionStatus === "active") {
    updateData.subscriptionStartDate = new Date();
    const endDate = new Date();
    endDate.setFullYear(endDate.getFullYear() + 1);
    updateData.subscriptionEndDate = endDate;
  } else if (body.subscriptionStatus === "active_lifetime") {
    updateData.subscriptionStartDate = new Date();
    updateData.subscriptionEndDate = null;
  } else if (body.subscriptionStatus === "inactive" || body.subscriptionStatus === "cancelled") {
    updateData.subscriptionEndDate = new Date();
  }

  await db.profile.update({ where: { userId }, data: updateData });

  await auditLog(
    adminUser.id,
    adminUser.email ?? "",
    "CHANGE_SUBSCRIPTION",
    `Set subscription to ${body.subscriptionStatus}. Notes: ${body.notes ?? "none"}`,
    userId,
    targetUser.email
  );

  console.log(
    `[Admin] Set subscription for user ${userId} to ${body.subscriptionStatus}`
  );

  return c.json({ success: true, subscriptionStatus: body.subscriptionStatus });
});

// POST /api/admin/users/:id/role - Set user admin role
adminRouter.post("/users/:id/role", requireSuperAdmin, async (c) => {
  const userId = c.req.param("id");
  const body = await c.req.json<{ role: "user" | "admin" | "super_admin"; notes?: string }>();
  const adminUser = c.get("user")!;

  const targetUser = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!targetUser) return c.json({ error: "User not found" }, 404);

  // Protect creator - cannot remove their super_admin
  if (targetUser.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) {
    return c.json({ error: "Cannot modify the creator super admin role" }, 403);
  }

  await db.profile.update({
    where: { userId },
    data: { adminRole: body.role },
  });

  await auditLog(
    adminUser.id,
    adminUser.email ?? "",
    "CHANGE_USER_ROLE",
    `Set role to ${body.role}. Notes: ${body.notes ?? "none"}`,
    userId,
    targetUser.email
  );

  console.log(`[Admin] Set role for user ${userId} to ${body.role}`);
  return c.json({ success: true, role: body.role });
});

// ============================================================
// PHASE 4 — CONTRACT MANAGER (SUPER ADMIN ONLY)
// ============================================================

// GET /api/admin/contracts - List contract versions
adminRouter.get("/contracts", requireSuperAdmin, async (c) => {
  const versions = await db.contractVersion.findMany({
    orderBy: { effectiveDate: "desc" },
  });
  return c.json({ versions });
});

// GET /api/admin/contracts/:id - Get a contract version
adminRouter.get("/contracts/:id", requireSuperAdmin, async (c) => {
  const id = c.req.param("id");
  const version = await db.contractVersion.findUnique({ where: { id } });
  if (!version) return c.json({ error: "Not found" }, 404);
  return c.json({ version });
});

// POST /api/admin/contracts - Create new contract version
adminRouter.post("/contracts", requireSuperAdmin, async (c) => {
  const body = await c.req.json<{
    versionName: string;
    effectiveDate: string;
    notes?: string;
    payTableData?: string;
    retirementRules?: string;
    guaranteeRules?: string;
    reserveRules?: string;
    sickRules?: string;
    premiumRules?: string;
  }>();
  const adminUser = c.get("user")!;

  const version = await db.contractVersion.create({
    data: {
      versionName: body.versionName,
      effectiveDate: body.effectiveDate,
      notes: body.notes,
      payTableData: body.payTableData,
      retirementRules: body.retirementRules,
      guaranteeRules: body.guaranteeRules,
      reserveRules: body.reserveRules,
      sickRules: body.sickRules,
      premiumRules: body.premiumRules,
      status: "draft",
    },
  });

  await auditLog(
    adminUser.id,
    adminUser.email ?? "",
    "CREATE_CONTRACT_VERSION",
    `Created contract version: ${body.versionName} (effective: ${body.effectiveDate})`
  );

  console.log(`[Admin] Created contract version: ${body.versionName}`);
  return c.json({ success: true, version });
});

// PUT /api/admin/contracts/:id - Update contract version
adminRouter.put("/contracts/:id", requireSuperAdmin, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const adminUser = c.get("user")!;

  const existing = await db.contractVersion.findUnique({ where: { id } });
  if (!existing) return c.json({ error: "Not found" }, 404);

  if (existing.status === "published") {
    return c.json({ error: "Cannot edit a published contract. Create a new version." }, 400);
  }

  const allowedFields = [
    "versionName",
    "effectiveDate",
    "notes",
    "payTableData",
    "retirementRules",
    "guaranteeRules",
    "reserveRules",
    "sickRules",
    "premiumRules",
  ];

  const updateData: Record<string, any> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) updateData[field] = body[field];
  }

  const version = await db.contractVersion.update({ where: { id }, data: updateData });

  await auditLog(
    adminUser.id,
    adminUser.email ?? "",
    "UPDATE_CONTRACT_VERSION",
    `Updated contract version: ${existing.versionName}`
  );

  return c.json({ success: true, version });
});

// POST /api/admin/contracts/:id/publish - Publish a contract version
adminRouter.post("/contracts/:id/publish", requireSuperAdmin, async (c) => {
  const id = c.req.param("id");
  const adminUser = c.get("user")!;

  const existing = await db.contractVersion.findUnique({ where: { id } });
  if (!existing) return c.json({ error: "Not found" }, 404);

  if (existing.status === "published") {
    return c.json({ error: "Already published" }, 400);
  }

  const version = await db.contractVersion.update({
    where: { id },
    data: {
      status: "published",
      publishedAt: new Date(),
      publishedBy: adminUser.email,
    },
  });

  await auditLog(
    adminUser.id,
    adminUser.email ?? "",
    "PUBLISH_CONTRACT_VERSION",
    `Published contract version: ${existing.versionName} (effective: ${existing.effectiveDate})`
  );

  console.log(`[Admin] Published contract version: ${existing.versionName}`);
  return c.json({ success: true, version });
});

// DELETE /api/admin/contracts/:id - Delete a draft contract
adminRouter.delete("/contracts/:id", requireSuperAdmin, async (c) => {
  const id = c.req.param("id");
  const adminUser = c.get("user")!;

  const existing = await db.contractVersion.findUnique({ where: { id } });
  if (!existing) return c.json({ error: "Not found" }, 404);

  if (existing.status === "published") {
    return c.json({ error: "Cannot delete a published contract version" }, 400);
  }

  await db.contractVersion.delete({ where: { id } });

  await auditLog(
    adminUser.id,
    adminUser.email ?? "",
    "DELETE_CONTRACT_VERSION",
    `Deleted draft contract version: ${existing.versionName}`
  );

  return c.json({ success: true });
});

// ============================================================
// PHASE 6 — AUDIT LOGS (SUPER ADMIN ONLY)
// ============================================================

// GET /api/admin/audit-logs - View audit logs
adminRouter.get("/audit-logs", requireSuperAdmin, async (c) => {
  const limit = parseInt(c.req.query("limit") || "100");
  const offset = parseInt(c.req.query("offset") || "0");
  const actionType = c.req.query("actionType");
  const targetEmail = c.req.query("targetEmail");

  const where: Record<string, any> = {};
  if (actionType) where.actionType = actionType;
  if (targetEmail) where.targetEmail = { contains: targetEmail };

  const [logs, total] = await Promise.all([
    db.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    db.adminAuditLog.count({ where }),
  ]);

  return c.json({ logs, total, limit, offset });
});

// DELETE /api/admin/users/:id — Permanently delete a user and all their data (SUPER ADMIN ONLY)
adminRouter.delete("/users/:id", requireSuperAdmin, async (c) => {
  const targetUserId = c.req.param("id");
  const adminUser = c.get("user")!;

  // Prevent deleting yourself
  if (targetUserId === adminUser.id) {
    return c.json({ error: "Cannot delete your own account" }, 400);
  }

  const targetUser = await db.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true },
  });

  if (!targetUser) return c.json({ error: "User not found" }, 404);

  const targetEmail = targetUser.email ?? "unknown";

  console.log(`[Admin] Permanently deleting user: ${targetEmail} (${targetUserId})`);

  // Cascade delete via Prisma relations (profile, sessions, etc.)
  await db.user.delete({ where: { id: targetUserId } });

  await auditLog(
    adminUser.id,
    adminUser.email ?? "",
    "DELETE_USER",
    `Permanently deleted user account: ${targetEmail}`,
    targetUserId,
    targetEmail
  );

  console.log(`[Admin] User deleted: ${targetEmail}`);
  return c.json({ success: true });
});

export { adminRouter };
