/**
 * Tax Profile & Deductions API Routes
 */

import { Hono } from "hono";
import type { AppType } from "../types";
import { db } from "../db";
import {
  calculateNetPay,
  getAllStates,
  getNoTaxStates,
  FILING_STATUS_OPTIONS,
  PAY_FREQUENCY_OPTIONS,
  type FilingStatus,
  type PayFrequency,
  type TaxProfile,
  type Deduction,
} from "../lib/tax-calculator";

const taxRoutes = new Hono<AppType>();

// ============================================
// TAX PROFILE
// ============================================

// GET /api/tax/profile - Get tax profile
taxRoutes.get("/profile", async (c) => {
  const user = c.get("user");
  if (!user?.id) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let profile = await db.taxProfile.findUnique({
    where: { userId: user.id },
  });

  // Create default if not exists
  if (!profile) {
    profile = await db.taxProfile.create({
      data: {
        userId: user.id,
        stateOfResidence: "TX",
        filingStatus: "single",
        payFrequency: "biweekly",
        dependents: 0,
        additionalCredits: 0,
        extraWithholdingType: "fixed",
        extraWithholdingValue: 0,
        taxYear: 2024,
      },
    });
  }

  return c.json({
    profile: {
      stateOfResidence: profile.stateOfResidence,
      filingStatus: profile.filingStatus,
      payFrequency: profile.payFrequency,
      dependents: profile.dependents,
      additionalCreditsCents: profile.additionalCredits,
      extraWithholdingType: profile.extraWithholdingType,
      extraWithholdingValue: profile.extraWithholdingValue,
      stateWithholdingOverride: profile.stateWithholdingOverride,
      taxYear: profile.taxYear,
    },
  });
});

// PUT /api/tax/profile - Update tax profile
taxRoutes.put("/profile", async (c) => {
  const user = c.get("user");
  if (!user?.id) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json();

  const profile = await db.taxProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      stateOfResidence: body.stateOfResidence ?? "TX",
      filingStatus: body.filingStatus ?? "single",
      payFrequency: body.payFrequency ?? "biweekly",
      dependents: body.dependents ?? 0,
      additionalCredits: body.additionalCreditsCents ?? 0,
      extraWithholdingType: body.extraWithholdingType ?? "fixed",
      extraWithholdingValue: body.extraWithholdingValue ?? 0,
      stateWithholdingOverride: body.stateWithholdingOverride ?? null,
      taxYear: body.taxYear ?? 2024,
    },
    update: {
      stateOfResidence: body.stateOfResidence,
      filingStatus: body.filingStatus,
      payFrequency: body.payFrequency,
      dependents: body.dependents,
      additionalCredits: body.additionalCreditsCents,
      extraWithholdingType: body.extraWithholdingType,
      extraWithholdingValue: body.extraWithholdingValue,
      stateWithholdingOverride: body.stateWithholdingOverride,
      taxYear: body.taxYear,
    },
  });

  return c.json({
    success: true,
    profile: {
      stateOfResidence: profile.stateOfResidence,
      filingStatus: profile.filingStatus,
      payFrequency: profile.payFrequency,
      dependents: profile.dependents,
      additionalCreditsCents: profile.additionalCredits,
      extraWithholdingType: profile.extraWithholdingType,
      extraWithholdingValue: profile.extraWithholdingValue,
      stateWithholdingOverride: profile.stateWithholdingOverride,
      taxYear: profile.taxYear,
    },
  });
});

// ============================================
// DEDUCTIONS
// ============================================

// GET /api/tax/deductions - List deductions
taxRoutes.get("/deductions", async (c) => {
  const user = c.get("user");
  if (!user?.id) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const deductions = await db.deduction.findMany({
    where: { userId: user.id },
    orderBy: { sortOrder: "asc" },
  });

  return c.json({
    deductions: deductions.map((d) => ({
      id: d.id,
      name: d.name,
      deductionType: d.deductionType,
      amount: d.amount,
      timing: d.timing,
      frequency: d.frequency,
      isEnabled: d.isEnabled,
      sortOrder: d.sortOrder,
    })),
  });
});

// POST /api/tax/deductions - Create deduction
taxRoutes.post("/deductions", async (c) => {
  const user = c.get("user");
  if (!user?.id) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json();

  // Get max sort order
  const maxSort = await db.deduction.aggregate({
    where: { userId: user.id },
    _max: { sortOrder: true },
  });

  const deduction = await db.deduction.create({
    data: {
      userId: user.id,
      name: body.name,
      deductionType: body.deductionType ?? "fixed",
      amount: body.amount ?? 0,
      timing: body.timing ?? "pretax",
      frequency: body.frequency ?? "per_paycheck",
      isEnabled: body.isEnabled ?? true,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
  });

  return c.json({
    success: true,
    deduction: {
      id: deduction.id,
      name: deduction.name,
      deductionType: deduction.deductionType,
      amount: deduction.amount,
      timing: deduction.timing,
      frequency: deduction.frequency,
      isEnabled: deduction.isEnabled,
      sortOrder: deduction.sortOrder,
    },
  });
});

// PUT /api/tax/deductions/:id - Update deduction
taxRoutes.put("/deductions/:id", async (c) => {
  const user = c.get("user");
  if (!user?.id) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = c.req.param("id");
  const body = await c.req.json();

  // Verify ownership
  const existing = await db.deduction.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return c.json({ error: "Deduction not found" }, 404);
  }

  const deduction = await db.deduction.update({
    where: { id },
    data: {
      name: body.name,
      deductionType: body.deductionType,
      amount: body.amount,
      timing: body.timing,
      frequency: body.frequency,
      isEnabled: body.isEnabled,
      sortOrder: body.sortOrder,
    },
  });

  return c.json({
    success: true,
    deduction: {
      id: deduction.id,
      name: deduction.name,
      deductionType: deduction.deductionType,
      amount: deduction.amount,
      timing: deduction.timing,
      frequency: deduction.frequency,
      isEnabled: deduction.isEnabled,
      sortOrder: deduction.sortOrder,
    },
  });
});

// DELETE /api/tax/deductions/:id - Delete deduction
taxRoutes.delete("/deductions/:id", async (c) => {
  const user = c.get("user");
  if (!user?.id) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = c.req.param("id");

  // Verify ownership
  const existing = await db.deduction.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return c.json({ error: "Deduction not found" }, 404);
  }

  await db.deduction.delete({ where: { id } });

  return c.json({ success: true });
});

// ============================================
// TAX CALCULATION
// ============================================

// POST /api/tax/calculate - Calculate net pay
taxRoutes.post("/calculate", async (c) => {
  const user = c.get("user");
  if (!user?.id) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json();
  const grossPayCents = body.grossPayCents ?? 0;
  const ytdWagesCents = body.ytdWagesCents ?? 0;

  // Get tax profile
  let profile = await db.taxProfile.findUnique({
    where: { userId: user.id },
  });

  if (!profile) {
    profile = await db.taxProfile.create({
      data: {
        userId: user.id,
        stateOfResidence: "TX",
        filingStatus: "single",
        payFrequency: "biweekly",
        dependents: 0,
        additionalCredits: 0,
        extraWithholdingType: "fixed",
        extraWithholdingValue: 0,
        taxYear: 2024,
      },
    });
  }

  // Get deductions
  const deductions = await db.deduction.findMany({
    where: { userId: user.id },
    orderBy: { sortOrder: "asc" },
  });

  const taxProfile: TaxProfile = {
    stateOfResidence: profile.stateOfResidence,
    filingStatus: profile.filingStatus as FilingStatus,
    payFrequency: profile.payFrequency as PayFrequency,
    dependents: profile.dependents,
    additionalCreditsCents: profile.additionalCredits,
    extraWithholdingType: profile.extraWithholdingType as "fixed" | "percent",
    extraWithholdingValue: profile.extraWithholdingValue,
    stateWithholdingOverride: profile.stateWithholdingOverride ?? undefined,
    taxYear: profile.taxYear,
  };

  const deductionList: Deduction[] = deductions.map((d) => ({
    name: d.name,
    deductionType: d.deductionType as "fixed" | "percent",
    amount: d.amount,
    timing: d.timing as "pretax" | "posttax",
    frequency: d.frequency as "per_paycheck" | "monthly",
    isEnabled: d.isEnabled,
  }));

  const breakdown = calculateNetPay(grossPayCents, taxProfile, deductionList, ytdWagesCents);

  return c.json({ breakdown });
});

// ============================================
// REFERENCE DATA
// ============================================

// GET /api/tax/states - Get all states
taxRoutes.get("/states", async (c) => {
  const states = getAllStates();
  const noTaxStates = getNoTaxStates();

  return c.json({
    states,
    noTaxStates,
  });
});

// GET /api/tax/options - Get filing status and pay frequency options
taxRoutes.get("/options", async (c) => {
  return c.json({
    filingStatusOptions: FILING_STATUS_OPTIONS,
    payFrequencyOptions: PAY_FREQUENCY_OPTIONS,
  });
});

export default taxRoutes;
