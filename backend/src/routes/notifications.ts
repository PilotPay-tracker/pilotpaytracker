/**
 * Notification Settings Routes
 *
 * Handles user notification preferences and scheduled notifications.
 */

import { Hono } from "hono";
import { type AppType } from "../types";
import { db } from "../db";
import {
  updateNotificationSettingsRequestSchema,
  sendTestNotificationRequestSchema,
} from "@/shared/contracts";

const notificationsRouter = new Hono<AppType>();

// Helper to format settings for response
function formatSettings(settings: {
  id: string;
  userId: string;
  pushPermissionGranted: boolean;
  pushPermissionAskedAt: Date | null;
  expoPushToken: string | null;
  reportTimeReminderEnabled: boolean;
  reportTimeLeadMinutes: number;
  payPeriodEndingEnabled: boolean;
  payPeriodEndingHours48: boolean;
  payPeriodEndingHours24: boolean;
  paydayReminderEnabled: boolean;
  paydayReminder2DaysBefore: boolean;
  paydayReminder1DayBefore: boolean;
  paydayReminderMorningOf: boolean;
  arrivalWelcomeEnabled: boolean;
  arrivalHighConfidenceOnly: boolean;
  payStatementReadyEnabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursAction: string;
  highConfidenceOnly: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...settings,
    pushPermissionAskedAt: settings.pushPermissionAskedAt?.toISOString() ?? null,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString(),
  };
}

// ============================================
// GET /api/notifications/settings - Get notification settings
// ============================================
notificationsRouter.get("/settings", async (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Get or create settings
  let settings = await db.userNotificationSettings.findUnique({
    where: { userId: user.id },
  });

  if (!settings) {
    // Create default settings
    settings = await db.userNotificationSettings.create({
      data: { userId: user.id },
    });
  }

  return c.json({ settings: formatSettings(settings) });
});

// ============================================
// PUT /api/notifications/settings - Update notification settings
// ============================================
notificationsRouter.put("/settings", async (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json();
  const parseResult = updateNotificationSettingsRequestSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json({ error: "Invalid request", details: parseResult.error.issues }, 400);
  }

  const data = parseResult.data;

  // Build update data, excluding undefined values
  const updateData: Record<string, unknown> = {};

  // Push Permission
  if (data.pushPermissionGranted !== undefined) {
    updateData.pushPermissionGranted = data.pushPermissionGranted;
    if (data.pushPermissionGranted) {
      updateData.pushPermissionAskedAt = new Date();
    }
  }
  if (data.expoPushToken !== undefined) {
    updateData.expoPushToken = data.expoPushToken;
  }

  // Report Time Reminders
  if (data.reportTimeReminderEnabled !== undefined) {
    updateData.reportTimeReminderEnabled = data.reportTimeReminderEnabled;
  }
  if (data.reportTimeLeadMinutes !== undefined) {
    updateData.reportTimeLeadMinutes = data.reportTimeLeadMinutes;
  }

  // Pay Period Ending
  if (data.payPeriodEndingEnabled !== undefined) {
    updateData.payPeriodEndingEnabled = data.payPeriodEndingEnabled;
  }
  if (data.payPeriodEndingHours48 !== undefined) {
    updateData.payPeriodEndingHours48 = data.payPeriodEndingHours48;
  }
  if (data.payPeriodEndingHours24 !== undefined) {
    updateData.payPeriodEndingHours24 = data.payPeriodEndingHours24;
  }

  // Payday Reminders
  if (data.paydayReminderEnabled !== undefined) {
    updateData.paydayReminderEnabled = data.paydayReminderEnabled;
  }
  if (data.paydayReminder2DaysBefore !== undefined) {
    updateData.paydayReminder2DaysBefore = data.paydayReminder2DaysBefore;
  }
  if (data.paydayReminder1DayBefore !== undefined) {
    updateData.paydayReminder1DayBefore = data.paydayReminder1DayBefore;
  }
  if (data.paydayReminderMorningOf !== undefined) {
    updateData.paydayReminderMorningOf = data.paydayReminderMorningOf;
  }

  // Arrival Welcome
  if (data.arrivalWelcomeEnabled !== undefined) {
    updateData.arrivalWelcomeEnabled = data.arrivalWelcomeEnabled;
  }
  if (data.arrivalHighConfidenceOnly !== undefined) {
    updateData.arrivalHighConfidenceOnly = data.arrivalHighConfidenceOnly;
  }

  // Pay Statement Ready
  if (data.payStatementReadyEnabled !== undefined) {
    updateData.payStatementReadyEnabled = data.payStatementReadyEnabled;
  }

  // Quiet Hours
  if (data.quietHoursEnabled !== undefined) {
    updateData.quietHoursEnabled = data.quietHoursEnabled;
  }
  if (data.quietHoursStart !== undefined) {
    updateData.quietHoursStart = data.quietHoursStart;
  }
  if (data.quietHoursEnd !== undefined) {
    updateData.quietHoursEnd = data.quietHoursEnd;
  }
  if (data.quietHoursAction !== undefined) {
    updateData.quietHoursAction = data.quietHoursAction;
  }

  // Global Settings
  if (data.highConfidenceOnly !== undefined) {
    updateData.highConfidenceOnly = data.highConfidenceOnly;
  }

  // Upsert settings (create if not exists)
  const settings = await db.userNotificationSettings.upsert({
    where: { userId: user.id },
    update: updateData,
    create: {
      userId: user.id,
      ...updateData,
    },
  });

  return c.json({
    success: true,
    settings: formatSettings(settings),
  });
});

// ============================================
// POST /api/notifications/test - Send a test notification
// ============================================
notificationsRouter.post("/test", async (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const parseResult = sendTestNotificationRequestSchema.safeParse(body);

  // Default to generic test if no type specified
  const notificationType = parseResult.success ? parseResult.data.type : undefined;

  // Get user settings to check if push is enabled
  const settings = await db.userNotificationSettings.findUnique({
    where: { userId: user.id },
  });

  if (!settings?.pushPermissionGranted) {
    return c.json({
      success: false,
      message: "Push notifications not enabled. Please enable notifications in settings.",
    });
  }

  // For local notifications, we'll just return success
  // The actual notification will be triggered client-side
  // This endpoint is more for verification and could be extended
  // to send server-triggered push notifications later

  let title = "Test Notification";
  let body_text = "Notifications are working correctly!";

  switch (notificationType) {
    case "report_time":
      title = "Report Time Reminder";
      body_text = "Report in 60 minutes — FLT 1234 SDF→ANC at 06:00";
      break;
    case "pay_period_ending":
      title = "Pay Period Closing";
      body_text = "Pay period ends in 48 hours — review premium events and missing flight proof.";
      break;
    case "payday":
      title = "Payday Tomorrow — Big Check";
      body_text = "Settlement pay posts tomorrow. Review Pay Summary for codes & premiums.";
      break;
    case "arrival_welcome":
      title = "Arrived — Welcome to ANC";
      body_text = "Welcome to ANC. Tap to log premiums or add notes.";
      break;
    case "pay_statement_ready":
      title = "Pay Summary Ready";
      body_text = "Your Pay Summary is ready — see what's coming and why.";
      break;
  }

  return c.json({
    success: true,
    message: `Test notification "${title}" ready to send.`,
    notification: { title, body: body_text, type: notificationType ?? "test" },
  });
});

// ============================================
// GET /api/notifications/scheduled - Get scheduled notifications
// ============================================
notificationsRouter.get("/scheduled", async (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const notifications = await db.scheduledNotification.findMany({
    where: {
      userId: user.id,
      status: "scheduled",
      scheduledFor: { gte: new Date() },
    },
    orderBy: { scheduledFor: "asc" },
    take: 50,
  });

  return c.json({
    notifications: notifications.map((n) => ({
      id: n.id,
      notificationType: n.notificationType,
      scheduledFor: n.scheduledFor.toISOString(),
      title: n.title,
      body: n.body,
      tripId: n.tripId,
      status: n.status,
      isInternational: n.isInternational,
    })),
    totalCount: notifications.length,
  });
});

// ============================================
// DELETE /api/notifications/scheduled/:id - Cancel a scheduled notification
// ============================================
notificationsRouter.delete("/scheduled/:id", async (c) => {
  const user = c.get("user");
  const notificationId = c.req.param("id");

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const notification = await db.scheduledNotification.findFirst({
    where: { id: notificationId, userId: user.id },
  });

  if (!notification) {
    return c.json({ error: "Notification not found" }, 404);
  }

  await db.scheduledNotification.update({
    where: { id: notificationId },
    data: { status: "cancelled" },
  });

  return c.json({ success: true });
});

export { notificationsRouter };
