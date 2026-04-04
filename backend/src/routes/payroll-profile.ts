/**
 * Payroll Profile API Routes
 *
 * Exposes the learned deduction profile for authenticated users.
 */

import { Hono } from "hono";
import type { AppType } from "../types";
import { getPayrollProfile } from "../services/payroll-profile-service";

const payrollProfileRoute = new Hono<AppType>();

// GET /api/payroll-profile
payrollProfileRoute.get("/", async (c) => {
  const user = c.get("user");
  if (!user?.id) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const profile = await getPayrollProfile(user.id);
  return c.json({ profile });
});

export default payrollProfileRoute;
