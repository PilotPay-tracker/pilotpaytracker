import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  updateUserSettingsRequestSchema,
  type GetUserSettingsResponse,
  type UpdateUserSettingsResponse,
} from "@/shared/contracts";
import { type AppType } from "../types";
import { db } from "../db";
import { ensureUserExists } from "../utils/ensureUser";

const settingsRouter = new Hono<AppType>();

// ============================================
// GET /api/settings - Get user settings
// ============================================
settingsRouter.get("/", async (c) => {
  const user = c.get("user");

  if (!user) {
    console.log("❌ [Settings] Unauthorized access attempt");
    return c.json({ error: "Unauthorized" }, 401);
  }

  console.log(`⚙️ [Settings] Fetching settings for user: ${user.id}`);

  // Ensure user exists in local database
  await ensureUserExists(user, "Settings");

  let profile = await db.profile.findUnique({
    where: { userId: user.id },
  });

  if (!profile) {
    profile = await db.profile.create({
      data: { userId: user.id },
    });
  }

  const response: GetUserSettingsResponse = {
    hourlyRateCents: profile.hourlyRateCents,
    airline: profile.airline,
  };

  return c.json(response);
});

// ============================================
// PUT /api/settings - Update user settings
// ============================================
settingsRouter.put(
  "/",
  zValidator("json", updateUserSettingsRequestSchema),
  async (c) => {
    const user = c.get("user");

    if (!user) {
      console.log("❌ [Settings] Unauthorized access attempt");
      return c.json({ error: "Unauthorized" }, 401);
    }

    const body = c.req.valid("json");
    console.log(`⚙️ [Settings] Updating settings for user: ${user.id}`);

    const profile = await db.profile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        hourlyRateCents: body.hourlyRateCents ?? 32500,
        airline: body.airline ?? "UPS",
      },
      update: {
        ...(body.hourlyRateCents !== undefined && {
          hourlyRateCents: body.hourlyRateCents,
        }),
        ...(body.airline !== undefined && { airline: body.airline }),
      },
    });

    console.log(`✅ [Settings] Updated settings for user: ${user.id}`);

    const response: UpdateUserSettingsResponse = {
      success: true,
      hourlyRateCents: profile.hourlyRateCents,
      airline: profile.airline,
    };

    return c.json(response);
  }
);

export { settingsRouter };
