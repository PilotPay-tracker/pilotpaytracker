/**
 * Pay Rules API Routes
 * User-configurable, airline-agnostic pay rules engine
 */

import { Hono } from "hono";
import { db } from "../db";
import { type AppType } from "../types";
import {
  createPayRuleRequestSchema,
  createPayRuleCategoryRequestSchema,
  initDefaultRulesRequestSchema,
} from "@/shared/contracts";

export const payRulesRouter = new Hono<AppType>();

// ============================================
// HELPER: Require authentication
// ============================================
function requireAuth(userId: string | undefined): string {
  if (!userId) {
    throw new Error("Unauthorized");
  }
  return userId;
}

// ============================================
// DEFAULT RULE TEMPLATES
// These are universal rules that work across airlines
// Users can customize values and add airline-specific labels
// ============================================

interface DefaultCategory {
  name: string;
  description: string;
  sortOrder: number;
}

interface DefaultRule {
  categoryName: string;
  name: string;
  code: string | null;
  description: string;
  ruleType: string;
  scope: string;
  rollingWindowDays: number | null;
  valueConfig: Record<string, unknown>;
  conditions: Array<{ field: string; operator: string; value: unknown }> | null;
  airlineLabels: Record<string, string> | null;
  priority: number;
}

const DEFAULT_CATEGORIES: DefaultCategory[] = [
  {
    name: "Daily Guarantees",
    description: "Minimum credit and pay guarantees per duty day",
    sortOrder: 1,
  },
  {
    name: "Premium Pay",
    description: "Additional pay for specific conditions or assignments",
    sortOrder: 2,
  },
  {
    name: "Duty Limits",
    description: "Maximum duty time and rolling limits",
    sortOrder: 3,
  },
  {
    name: "Pay Protection",
    description: "Pay protection for schedule changes and cancellations",
    sortOrder: 4,
  },
];

const DEFAULT_RULES: DefaultRule[] = [
  // Daily Guarantees
  {
    categoryName: "Daily Guarantees",
    name: "Minimum Daily Credit",
    code: "MDC",
    description: "Minimum credit hours per duty day (typically 4-6 hours depending on airline)",
    ruleType: "GUARANTEE",
    scope: "DAILY",
    rollingWindowDays: null,
    valueConfig: { creditMinutes: 360 }, // 6:00 default
    conditions: null,
    airlineLabels: null,
    priority: 100,
  },
  {
    categoryName: "Daily Guarantees",
    name: "Trip Guarantee",
    code: "TRG",
    description: "Minimum credit for a complete trip/pairing",
    ruleType: "GUARANTEE",
    scope: "TRIP",
    rollingWindowDays: null,
    valueConfig: { creditMinutes: 0 }, // User configures
    conditions: null,
    airlineLabels: null,
    priority: 90,
  },

  // Premium Pay - Add Hours
  {
    categoryName: "Premium Pay",
    name: "Airport Reserve Premium",
    code: "AP",
    description: "Additional credit for airport reserve duty",
    ruleType: "PREMIUM_ADD",
    scope: "DAILY",
    rollingWindowDays: null,
    valueConfig: { addMinutes: 120 }, // +2:00
    conditions: [{ field: "premiumCode", operator: "in", value: ["AP0", "AP1", "AP2", "AP3", "AP4", "AP5", "AP6", "AP7", "AP8", "AP9"] }],
    airlineLabels: { UPS: "AP", Delta: "RAP", United: "ARP" },
    priority: 80,
  },
  {
    categoryName: "Premium Pay",
    name: "Short Visit Turnaround",
    code: "SVT",
    description: "Premium for short turnaround at destination",
    ruleType: "PREMIUM_ADD",
    scope: "DAILY",
    rollingWindowDays: null,
    valueConfig: { addMinutes: 120 }, // +2:00
    conditions: [{ field: "premiumCode", operator: "=", value: "SVT" }],
    airlineLabels: { UPS: "SVT" },
    priority: 80,
  },
  {
    categoryName: "Premium Pay",
    name: "Long Range Premium",
    code: "LRP",
    description: "Premium for long-range international flights",
    ruleType: "PREMIUM_ADD",
    scope: "DAILY",
    rollingWindowDays: null,
    valueConfig: { addMinutes: 360 }, // +6:00
    conditions: [{ field: "premiumCode", operator: "=", value: "LRP" }],
    airlineLabels: { UPS: "LRP" },
    priority: 80,
  },

  // Premium Pay - Multipliers
  {
    categoryName: "Premium Pay",
    name: "Time and a Half",
    code: "1.5X",
    description: "1.5x pay multiplier",
    ruleType: "PREMIUM_MULTIPLY",
    scope: "DAILY",
    rollingWindowDays: null,
    valueConfig: { multiplier: 1.5 },
    conditions: [{ field: "premiumCode", operator: "in", value: ["LP1", "LPT", "RJA"] }],
    airlineLabels: null,
    priority: 70,
  },
  {
    categoryName: "Premium Pay",
    name: "Double Time and a Half",
    code: "2.5X",
    description: "2.5x pay multiplier",
    ruleType: "PREMIUM_MULTIPLY",
    scope: "DAILY",
    rollingWindowDays: null,
    valueConfig: { multiplier: 2.5 },
    conditions: [{ field: "premiumCode", operator: "=", value: "LP2" }],
    airlineLabels: null,
    priority: 70,
  },

  // Duty Limits
  {
    categoryName: "Duty Limits",
    name: "30-in-7 Block Limit",
    code: "30IN7",
    description: "Maximum block time in rolling 7-day window (FAR 117)",
    ruleType: "LIMIT",
    scope: "ROLLING",
    rollingWindowDays: 7,
    valueConfig: { maxMinutes: 1800, warningMinutes: 1620 }, // 30:00 max, 27:00 warning
    conditions: null,
    airlineLabels: null,
    priority: 100,
  },
  {
    categoryName: "Duty Limits",
    name: "100-in-28 Block Limit",
    code: "100IN28",
    description: "Maximum block time in rolling 28-day window",
    ruleType: "LIMIT",
    scope: "ROLLING",
    rollingWindowDays: 28,
    valueConfig: { maxMinutes: 6000, warningMinutes: 5700 }, // 100:00 max, 95:00 warning
    conditions: null,
    airlineLabels: null,
    priority: 100,
  },

  // Pay Protection
  {
    categoryName: "Pay Protection",
    name: "Schedule Change After Report",
    code: "SCAR",
    description: "Pay protection when schedule changes after reporting for duty",
    ruleType: "GUARANTEE",
    scope: "DAILY",
    rollingWindowDays: null,
    valueConfig: { creditMinutes: 0 }, // Protects original credit
    conditions: [{ field: "eventType", operator: "=", value: "SCHEDULE_CHANGE" }],
    airlineLabels: { UPS: "JA", Delta: "Reassign" },
    priority: 90,
  },
  {
    categoryName: "Pay Protection",
    name: "Duty Extension Premium",
    code: "EXT",
    description: "Premium pay when duty is extended beyond original schedule",
    ruleType: "THRESHOLD",
    scope: "DAILY",
    rollingWindowDays: null,
    valueConfig: { triggerMinutes: 60, action: "PREMIUM_ADD", addMinutes: 60 },
    conditions: [{ field: "eventType", operator: "=", value: "DUTY_EXTENSION" }],
    airlineLabels: null,
    priority: 85,
  },
];

// ============================================
// CATEGORIES ROUTES
// ============================================

// GET /api/pay-rules/categories - List all categories
payRulesRouter.get("/categories", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);

    const categories = await db.payRuleCategory.findMany({
      where: { userId },
      orderBy: { sortOrder: "asc" },
    });

    return c.json({
      categories: categories.map((cat) => ({
        ...cat,
        createdAt: cat.createdAt.toISOString(),
        updatedAt: cat.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error fetching categories:", error);
    return c.json({ error: "Failed to fetch categories" }, 500);
  }
});

// POST /api/pay-rules/categories - Create category
payRulesRouter.post("/categories", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const body = await c.req.json();
    const parsed = createPayRuleCategoryRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
    }

    const { name, description, sortOrder } = parsed.data;

    // Get max sort order if not provided
    let finalSortOrder = sortOrder;
    if (finalSortOrder === undefined) {
      const maxSort = await db.payRuleCategory.aggregate({
        where: { userId },
        _max: { sortOrder: true },
      });
      finalSortOrder = (maxSort._max.sortOrder ?? 0) + 1;
    }

    const category = await db.payRuleCategory.create({
      data: {
        userId,
        name,
        description: description ?? null,
        sortOrder: finalSortOrder,
      },
    });

    return c.json({
      success: true,
      category: {
        ...category,
        createdAt: category.createdAt.toISOString(),
        updatedAt: category.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error creating category:", error);
    return c.json({ error: "Failed to create category" }, 500);
  }
});

// DELETE /api/pay-rules/categories/:id - Delete category
payRulesRouter.delete("/categories/:id", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const categoryId = c.req.param("id");

    // Verify ownership
    const existing = await db.payRuleCategory.findFirst({
      where: { id: categoryId, userId },
    });

    if (!existing) {
      return c.json({ error: "Category not found" }, 404);
    }

    // Delete category (rules will have categoryId set to null due to SetNull)
    await db.payRuleCategory.delete({
      where: { id: categoryId },
    });

    return c.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error deleting category:", error);
    return c.json({ error: "Failed to delete category" }, 500);
  }
});

// ============================================
// RULES ROUTES
// ============================================

// ============================================
// INIT DEFAULTS - Create starter rules for new users
// NOTE: Must be before /:id to avoid being caught as id="init-defaults"
// ============================================

// POST /api/pay-rules/init-defaults - Initialize default rules
payRulesRouter.post("/init-defaults", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const body = await c.req.json().catch(() => ({}));
    const parsed = initDefaultRulesRequestSchema.safeParse(body);
    const airline = parsed.success ? parsed.data.airline : undefined;

    // Check if user already has rules
    const existingRules = await db.payRule.count({ where: { userId } });
    if (existingRules > 0) {
      return c.json({
        success: true,
        rulesCreated: 0,
        categoriesCreated: 0,
        message: "Rules already exist",
      });
    }

    // Create categories first
    const categoryMap = new Map<string, string>();
    for (const cat of DEFAULT_CATEGORIES) {
      const created = await db.payRuleCategory.create({
        data: {
          userId,
          name: cat.name,
          description: cat.description,
          sortOrder: cat.sortOrder,
        },
      });
      categoryMap.set(cat.name, created.id);
    }

    // Create rules
    let rulesCreated = 0;
    for (const rule of DEFAULT_RULES) {
      const categoryId = categoryMap.get(rule.categoryName);

      // If airline is provided, customize labels
      let airlineLabels = rule.airlineLabels;
      if (airline && airlineLabels) {
        // Keep the user's airline label prominent
        const userLabel = airlineLabels[airline];
        if (userLabel) {
          airlineLabels = { [airline]: userLabel, ...airlineLabels };
        }
      }

      await db.payRule.create({
        data: {
          userId,
          categoryId: categoryId ?? null,
          name: rule.name,
          code: rule.code,
          description: rule.description,
          ruleType: rule.ruleType,
          scope: rule.scope,
          rollingWindowDays: rule.rollingWindowDays,
          valueConfig: JSON.stringify(rule.valueConfig),
          conditions: rule.conditions ? JSON.stringify(rule.conditions) : null,
          airlineLabels: airlineLabels ? JSON.stringify(airlineLabels) : null,
          priority: rule.priority,
          isActive: true,
          isBuiltIn: true,
        },
      });
      rulesCreated++;
    }

    return c.json({
      success: true,
      rulesCreated,
      categoriesCreated: DEFAULT_CATEGORIES.length,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error initializing defaults:", error);
    return c.json({ error: "Failed to initialize defaults" }, 500);
  }
});

// ============================================
// RULE APPLICATIONS - Track when rules are applied
// NOTE: Must be before /:id to avoid being caught as id="applications"
// ============================================

// GET /api/pay-rules/applications - Get rule applications
payRulesRouter.get("/applications", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const tripId = c.req.query("tripId");
    const dutyDayId = c.req.query("dutyDayId");
    const payPeriodStart = c.req.query("payPeriodStart");
    const startDate = c.req.query("startDate");
    const endDate = c.req.query("endDate");

    const where: Record<string, unknown> = { userId };
    if (tripId) where.tripId = tripId;
    if (dutyDayId) where.dutyDayId = dutyDayId;
    if (payPeriodStart) where.payPeriodStart = payPeriodStart;
    if (startDate || endDate) {
      where.appliedAt = {};
      if (startDate) (where.appliedAt as Record<string, unknown>).gte = new Date(startDate);
      if (endDate) (where.appliedAt as Record<string, unknown>).lte = new Date(endDate);
    }

    const applications = await db.payRuleApplication.findMany({
      where,
      include: { rule: true },
      orderBy: { appliedAt: "desc" },
    });

    return c.json({
      applications: applications.map((app) => ({
        ...app,
        appliedAt: app.appliedAt.toISOString(),
        createdAt: app.createdAt.toISOString(),
        rule: app.rule
          ? {
              ...app.rule,
              createdAt: app.rule.createdAt.toISOString(),
              updatedAt: app.rule.updatedAt.toISOString(),
            }
          : undefined,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error fetching applications:", error);
    return c.json({ error: "Failed to fetch applications" }, 500);
  }
});

// ============================================
// RULES ROUTES
// ============================================

// GET /api/pay-rules - List all rules
payRulesRouter.get("/", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const categoryId = c.req.query("categoryId");
    const ruleType = c.req.query("ruleType");
    const scope = c.req.query("scope");
    const activeOnly = c.req.query("activeOnly") === "true";

    const where: Record<string, unknown> = { userId };
    if (categoryId) where.categoryId = categoryId;
    if (ruleType) where.ruleType = ruleType;
    if (scope) where.scope = scope;
    if (activeOnly) where.isActive = true;

    const [rules, categories] = await Promise.all([
      db.payRule.findMany({
        where,
        include: { category: true },
        orderBy: [{ priority: "desc" }, { name: "asc" }],
      }),
      db.payRuleCategory.findMany({
        where: { userId },
        orderBy: { sortOrder: "asc" },
      }),
    ]);

    return c.json({
      rules: rules.map((rule) => ({
        ...rule,
        createdAt: rule.createdAt.toISOString(),
        updatedAt: rule.updatedAt.toISOString(),
        category: rule.category
          ? {
              ...rule.category,
              createdAt: rule.category.createdAt.toISOString(),
              updatedAt: rule.category.updatedAt.toISOString(),
            }
          : null,
      })),
      categories: categories.map((cat) => ({
        ...cat,
        createdAt: cat.createdAt.toISOString(),
        updatedAt: cat.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error fetching rules:", error);
    return c.json({ error: "Failed to fetch rules" }, 500);
  }
});

// GET /api/pay-rules/:id - Get single rule
payRulesRouter.get("/:id", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const ruleId = c.req.param("id");

    const rule = await db.payRule.findFirst({
      where: { id: ruleId, userId },
      include: { category: true },
    });

    if (!rule) {
      return c.json({ error: "Rule not found" }, 404);
    }

    return c.json({
      rule: {
        ...rule,
        createdAt: rule.createdAt.toISOString(),
        updatedAt: rule.updatedAt.toISOString(),
        category: rule.category
          ? {
              ...rule.category,
              createdAt: rule.category.createdAt.toISOString(),
              updatedAt: rule.category.updatedAt.toISOString(),
            }
          : null,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error fetching rule:", error);
    return c.json({ error: "Failed to fetch rule" }, 500);
  }
});

// POST /api/pay-rules - Create rule
payRulesRouter.post("/", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const body = await c.req.json();
    const parsed = createPayRuleRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
    }

    const {
      categoryId,
      name,
      code,
      description,
      ruleType,
      scope,
      rollingWindowDays,
      valueConfig,
      conditions,
      airlineLabels,
      priority,
    } = parsed.data;

    // Verify category exists if provided
    if (categoryId) {
      const category = await db.payRuleCategory.findFirst({
        where: { id: categoryId, userId },
      });
      if (!category) {
        return c.json({ error: "Category not found" }, 404);
      }
    }

    const rule = await db.payRule.create({
      data: {
        userId,
        categoryId: categoryId ?? null,
        name,
        code: code ?? null,
        description: description ?? null,
        ruleType,
        scope,
        rollingWindowDays: rollingWindowDays ?? null,
        valueConfig: JSON.stringify(valueConfig),
        conditions: conditions ? JSON.stringify(conditions) : null,
        airlineLabels: airlineLabels ? JSON.stringify(airlineLabels) : null,
        priority: priority ?? 100,
        isActive: true,
        isBuiltIn: false,
      },
      include: { category: true },
    });

    return c.json({
      success: true,
      rule: {
        ...rule,
        createdAt: rule.createdAt.toISOString(),
        updatedAt: rule.updatedAt.toISOString(),
        category: rule.category
          ? {
              ...rule.category,
              createdAt: rule.category.createdAt.toISOString(),
              updatedAt: rule.category.updatedAt.toISOString(),
            }
          : null,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error creating rule:", error);
    return c.json({ error: "Failed to create rule" }, 500);
  }
});

// PUT /api/pay-rules/:id - Update rule
payRulesRouter.put("/:id", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const ruleId = c.req.param("id");
    const body = await c.req.json();

    // Verify ownership
    const existing = await db.payRule.findFirst({
      where: { id: ruleId, userId },
    });

    if (!existing) {
      return c.json({ error: "Rule not found" }, 404);
    }

    const updateData: Record<string, unknown> = {};

    if (body.categoryId !== undefined) updateData.categoryId = body.categoryId;
    if (body.name !== undefined) updateData.name = body.name;
    if (body.code !== undefined) updateData.code = body.code;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.ruleType !== undefined) updateData.ruleType = body.ruleType;
    if (body.scope !== undefined) updateData.scope = body.scope;
    if (body.rollingWindowDays !== undefined) updateData.rollingWindowDays = body.rollingWindowDays;
    if (body.valueConfig !== undefined) updateData.valueConfig = JSON.stringify(body.valueConfig);
    if (body.conditions !== undefined) updateData.conditions = body.conditions ? JSON.stringify(body.conditions) : null;
    if (body.airlineLabels !== undefined) updateData.airlineLabels = body.airlineLabels ? JSON.stringify(body.airlineLabels) : null;
    if (body.priority !== undefined) updateData.priority = body.priority;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const rule = await db.payRule.update({
      where: { id: ruleId },
      data: updateData,
      include: { category: true },
    });

    return c.json({
      success: true,
      rule: {
        ...rule,
        createdAt: rule.createdAt.toISOString(),
        updatedAt: rule.updatedAt.toISOString(),
        category: rule.category
          ? {
              ...rule.category,
              createdAt: rule.category.createdAt.toISOString(),
              updatedAt: rule.category.updatedAt.toISOString(),
            }
          : null,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error updating rule:", error);
    return c.json({ error: "Failed to update rule" }, 500);
  }
});

// DELETE /api/pay-rules/:id - Delete rule
payRulesRouter.delete("/:id", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const ruleId = c.req.param("id");

    // Verify ownership
    const existing = await db.payRule.findFirst({
      where: { id: ruleId, userId },
    });

    if (!existing) {
      return c.json({ error: "Rule not found" }, 404);
    }

    await db.payRule.delete({
      where: { id: ruleId },
    });

    return c.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error deleting rule:", error);
    return c.json({ error: "Failed to delete rule" }, 500);
  }
});

