/**
 * Payroll Profile Service
 *
 * Manages learned deduction profiles built from uploaded real paystubs.
 * Over time, as users upload more paystubs, estimates become more accurate.
 */

import { db } from "../db";

export interface LearnedDeductionProfile {
  paystubCount: number;
  pretaxFlexCents: number;
  vebaCents: number;
  excessLifeCents: number;
  ltdCents: number;
  mutualAidCents: number;
  unionDuesCents: number;
  roth401kCents: number;
  // Derived confidence level
  confidence: "none" | "low" | "medium" | "high";
}

export interface ParsedPaystubDeductions {
  pretaxFlexCents?: number;
  vebaCents?: number;
  excessLifeCents?: number;
  ltdCents?: number;
  mutualAidCents?: number;
  unionDuesCents?: number;
  roth401kCents?: number;
}

/** Default UPS deduction estimates when no learning exists.
 *  Based on a real UPS paystub example (2026-02-23 period).
 */
export const UPS_DEFAULT_DEDUCTIONS: LearnedDeductionProfile = {
  paystubCount: 0,
  pretaxFlexCents: 22157,   // $221.57
  vebaCents: 7400,          // $74.00
  excessLifeCents: 208,     // $2.08
  ltdCents: 15461,          // $154.61
  mutualAidCents: 11000,    // $110.00
  unionDuesCents: 13102,    // $131.02
  roth401kCents: 0,         // $0 (varies per pilot)
  confidence: "none",
};

function deriveConfidence(paystubCount: number): "none" | "low" | "medium" | "high" {
  if (paystubCount === 0) return "none";
  if (paystubCount === 1) return "low";
  if (paystubCount <= 3) return "medium";
  return "high";
}

/**
 * Get the learned deduction profile for a user.
 * Returns defaults if no learning exists.
 */
export async function getPayrollProfile(userId: string): Promise<LearnedDeductionProfile> {
  const record = await db.payrollProfile.findUnique({ where: { userId } });

  if (!record || record.paystubCount === 0) {
    return { ...UPS_DEFAULT_DEDUCTIONS };
  }

  return {
    paystubCount: record.paystubCount,
    pretaxFlexCents: record.pretaxFlexCents,
    vebaCents: record.vebaCents,
    excessLifeCents: record.excessLifeCents,
    ltdCents: record.ltdCents,
    mutualAidCents: record.mutualAidCents,
    unionDuesCents: record.unionDuesCents,
    roth401kCents: record.roth401kCents,
    confidence: deriveConfidence(record.paystubCount) as LearnedDeductionProfile["confidence"],
  };
}

/**
 * Learn from a newly uploaded paystub.
 * Updates the rolling average of recurring deductions.
 */
export async function learnFromPaystub(
  userId: string,
  parsed: ParsedPaystubDeductions
): Promise<LearnedDeductionProfile> {
  const existing = await db.payrollProfile.findUnique({ where: { userId } });

  const count = (existing?.paystubCount ?? 0) + 1;

  // Rolling average: (old_avg * old_count + new_value) / new_count
  function rollingAvg(oldAvg: number, newValue: number | undefined, oldCount: number, newCount: number): number {
    if (newValue === undefined || newValue === null) return oldAvg;
    return Math.round((oldAvg * oldCount + newValue) / newCount);
  }

  const oldCount = existing?.paystubCount ?? 0;

  const updated = {
    paystubCount: count,
    pretaxFlexCents: rollingAvg(existing?.pretaxFlexCents ?? UPS_DEFAULT_DEDUCTIONS.pretaxFlexCents, parsed.pretaxFlexCents, oldCount, count),
    vebaCents: rollingAvg(existing?.vebaCents ?? UPS_DEFAULT_DEDUCTIONS.vebaCents, parsed.vebaCents, oldCount, count),
    excessLifeCents: rollingAvg(existing?.excessLifeCents ?? UPS_DEFAULT_DEDUCTIONS.excessLifeCents, parsed.excessLifeCents, oldCount, count),
    ltdCents: rollingAvg(existing?.ltdCents ?? UPS_DEFAULT_DEDUCTIONS.ltdCents, parsed.ltdCents, oldCount, count),
    mutualAidCents: rollingAvg(existing?.mutualAidCents ?? UPS_DEFAULT_DEDUCTIONS.mutualAidCents, parsed.mutualAidCents, oldCount, count),
    unionDuesCents: rollingAvg(existing?.unionDuesCents ?? UPS_DEFAULT_DEDUCTIONS.unionDuesCents, parsed.unionDuesCents, oldCount, count),
    roth401kCents: rollingAvg(existing?.roth401kCents ?? 0, parsed.roth401kCents, oldCount, count),
  };

  await db.payrollProfile.upsert({
    where: { userId },
    create: { userId, ...updated, rawLearnedData: JSON.stringify(parsed), confidence: deriveConfidence(count) },
    update: { ...updated, rawLearnedData: JSON.stringify(parsed), confidence: deriveConfidence(count) },
  });

  return {
    ...updated,
    confidence: deriveConfidence(count) as LearnedDeductionProfile["confidence"],
  };
}

/**
 * Calculate total non-tax deductions for a check.
 * This is the sum of pre-tax and post-tax non-FICA deductions.
 */
export function calculateUpsOtherDeductions(profile: LearnedDeductionProfile): {
  pretaxTotal: number;
  posttaxTotal: number;
  items: Array<{ id: string; name: string; amountCents: number; timing: "pretax" | "posttax" | "taxable_benefit" }>;
} {
  const items: Array<{ id: string; name: string; amountCents: number; timing: "pretax" | "posttax" | "taxable_benefit" }> = [];

  // Taxable benefit (adds to taxable income)
  if (profile.excessLifeCents > 0) {
    items.push({ id: "excess-life", name: "Excess Life", amountCents: profile.excessLifeCents, timing: "taxable_benefit" });
  }

  // Pre-tax deductions (reduce taxable income)
  if (profile.pretaxFlexCents > 0) {
    items.push({ id: "pretax-flex", name: "Pretax Flex", amountCents: profile.pretaxFlexCents, timing: "pretax" });
  }
  if (profile.vebaCents > 0) {
    items.push({ id: "veba", name: "VEBA", amountCents: profile.vebaCents, timing: "pretax" });
  }

  // Post-tax deductions
  if (profile.ltdCents > 0) {
    items.push({ id: "ltd", name: "Long Term Disability", amountCents: profile.ltdCents, timing: "posttax" });
  }
  if (profile.mutualAidCents > 0) {
    items.push({ id: "mutual-aid", name: "Mutual Aid", amountCents: profile.mutualAidCents, timing: "posttax" });
  }
  if (profile.unionDuesCents > 0) {
    items.push({ id: "union-dues", name: "Union Dues", amountCents: profile.unionDuesCents, timing: "posttax" });
  }
  if (profile.roth401kCents > 0) {
    items.push({ id: "roth-401k", name: "Roth 401(k)", amountCents: profile.roth401kCents, timing: "posttax" });
  }

  const pretaxTotal = items
    .filter((i) => i.timing === "pretax")
    .reduce((s, i) => s + i.amountCents, 0);

  const posttaxTotal = items
    .filter((i) => i.timing === "posttax")
    .reduce((s, i) => s + i.amountCents, 0);

  return { pretaxTotal, posttaxTotal, items };
}
