/**
 * Pay Statement Mirror Service
 *
 * Handles parsing pay statements, building templates, projecting statements,
 * computing diffs, reconciliation, and audit checklists.
 */

import { db } from "../db";
import type {
  PayStatementParsed,
  StatementSection,
  StatementLineItem,
  ProjectedStatement,
  StatementDiff,
  DiffReason,
  ReconciliationResult,
  PayAuditChecklist,
  StatementTemplate,
} from "@/shared/contracts";
import type { ParsedPaystubDeductions } from "./payroll-profile-service";

// ============================================
// UTILITY FUNCTIONS
// ============================================

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, " ").toUpperCase();
}

function nowISO(): string {
  return new Date().toISOString();
}

function centsToAmount(cents: number): number {
  return round2(cents / 100);
}

function amountToCents(amount: number): number {
  return Math.round(amount * 100);
}

// ============================================
// MOCK OCR PARSER (Replace with real OCR provider)
// ============================================

/**
 * Parse pay statement from raw text.
 * In production, this would use OCR (Textract, Google DocAI, Azure).
 * For now, we generate mock parsed data aligned to UPS Dayforce paystub structure.
 *
 * UPS Dayforce earnings categories:
 *   - ADVANCE NEXT PAY / GUARANTEE SETTLEMENT: base hourly × 37.5 hrs (settlement guarantee)
 *   - OVER GUARANTEE: credit hours above 75 hrs threshold billed at hourly rate
 *   - PREMIUM PAY: premium pay events
 *   - VACATION: if any vacation pay exists
 *
 * Deductions follow the standard UPS paystub layout:
 *   Taxable benefits: EXCESS LIFE
 *   Pre-tax:          PRETAX FLEX, VEBA
 *   Taxes:            FEDERAL W/H, FICA, MEDICARE
 *   Other:            LTD, MUTUAL AID, UNION DUES, ROTH 401K
 */
export async function parsePayStatementMock(
  userId: string,
  payPeriodStart: string,
  payPeriodEnd: string
): Promise<PayStatementParsed> {
  // Get user's profile for hourly rate
  const profile = await db.profile.findUnique({ where: { userId } });
  const hourlyRateCents = profile?.hourlyRateCents ?? 32500;
  const hourlyRate = round2(hourlyRateCents / 100);

  // Get trips in this pay period
  const trips = await db.trip.findMany({
    where: {
      userId,
      startDate: { gte: payPeriodStart },
      endDate: { lte: payPeriodEnd },
    },
  });

  // Calculate totals
  const totalCreditMinutes = trips.reduce((sum, t) => sum + t.totalCreditMinutes, 0);
  const totalCreditHours = round2(totalCreditMinutes / 60);
  const totalPremiumCents = trips.reduce((sum, t) => sum + t.premiumCents, 0);
  const totalPerDiemCents = trips.reduce((sum, t) => sum + t.totalPdiemCents, 0);

  // ── UPS Dayforce earnings logic ──────────────────────────────────────────────
  //
  // UPS pilots are paid under a guarantee model:
  //   - Guarantee threshold:    75 credit hours per period
  //   - Settlement base:        37.5 hrs × hourly rate  (ADVANCE NEXT PAY or GUARANTEE SETTLEMENT)
  //   - Over-guarantee:         credit hours > 75  →  OVER GUARANTEE at hourly rate
  //
  // If credit < 75 hrs the pilot still earns 75 hrs worth of pay
  // (the other 37.5 hrs appears as GUARANTEE SETTLEMENT on the following check).
  // For the mock we simplify: guarantee settlement = 37.5 × rate on every check,
  // and any hours above 75 become OVER GUARANTEE.

  const GUARANTEE_HOURS = 75;
  const SETTLEMENT_HOURS = 37.5;

  const earningsItems: StatementLineItem[] = [];

  // GUARANTEE SETTLEMENT  (always present – the "advance" portion)
  const settlementAmountCents = Math.round(hourlyRateCents * SETTLEMENT_HOURS);
  earningsItems.push({
    section: "EARNINGS",
    label: "GUARANTEE SETTLEMENT",
    unitsLabel: "HRS",
    units: SETTLEMENT_HOURS,
    rate: hourlyRate,
    amount: centsToAmount(settlementAmountCents),
  });

  // OVER GUARANTEE  (credit hours above 75 hrs)
  const overGuaranteeHours = Math.max(0, round2(totalCreditHours - GUARANTEE_HOURS));
  if (overGuaranteeHours > 0) {
    const overAmountCents = Math.round(hourlyRateCents * overGuaranteeHours);
    earningsItems.push({
      section: "EARNINGS",
      label: "OVER GUARANTEE",
      unitsLabel: "HRS",
      units: overGuaranteeHours,
      rate: hourlyRate,
      amount: centsToAmount(overAmountCents),
    });
  }

  // PREMIUM PAY
  if (totalPremiumCents > 0) {
    earningsItems.push({
      section: "EARNINGS",
      label: "PREMIUM PAY",
      amount: centsToAmount(totalPremiumCents),
    });
  }

  // ── Reimbursements ───────────────────────────────────────────────────────────
  const reimbursementItems: StatementLineItem[] = [];
  if (totalPerDiemCents > 0) {
    reimbursementItems.push({
      section: "REIMBURSEMENTS",
      label: "PER DIEM",
      amount: centsToAmount(totalPerDiemCents),
    });
  }

  // ── Gross pay ────────────────────────────────────────────────────────────────
  const earningsGrossCents =
    settlementAmountCents +
    Math.round(hourlyRateCents * overGuaranteeHours) +
    totalPremiumCents;
  const grossPayCents = earningsGrossCents + totalPerDiemCents;

  // ── UPS Dayforce deductions ──────────────────────────────────────────────────
  //
  // Taxable benefit section (adds to taxable wages):
  //   EXCESS LIFE ~$2.08
  //
  // Pre-tax section (reduces taxable wages):
  //   PRETAX FLEX  ~$221.57
  //   VEBA         ~$74.00
  //
  // Tax withholdings (estimated from taxable wages):
  //   FEDERAL W/H  ~22% of taxable
  //   FICA         ~6.2%
  //   MEDICARE     ~1.45%
  //
  // Other post-tax deductions:
  //   LTD         ~$154.61
  //   MUTUAL AID  ~$110.00
  //   UNION DUES  ~$131.02
  //   ROTH 401K   optional, default 0

  // Fixed UPS default deduction amounts (cents) – mirrors UPS_DEFAULT_DEDUCTIONS
  const excessLifeCents = 208;          // taxable benefit
  const pretaxFlexCents = 22157;        // pre-tax
  const vebaCents = 7400;               // pre-tax
  const ltdCents = 15461;               // post-tax
  const mutualAidCents = 11000;         // post-tax
  const unionDuesCents = 13102;         // post-tax
  const roth401kCents = 0;              // post-tax (varies)

  // Taxable wages = earnings gross + excess life benefit - pre-tax deductions
  const taxableWagesCents = earningsGrossCents + excessLifeCents - pretaxFlexCents - vebaCents;

  const federalWithholdingCents = Math.round(taxableWagesCents * 0.22);
  const ficaCents = Math.round(taxableWagesCents * 0.062);
  const medicareCents = Math.round(taxableWagesCents * 0.0145);

  const deductionItems: StatementLineItem[] = [
    // Taxable benefits section (presented first on UPS paystub)
    {
      section: "DEDUCTIONS",
      label: "EXCESS LIFE",
      amount: centsToAmount(excessLifeCents),   // positive – adds to taxable wages
    },
    // Pre-tax deductions
    {
      section: "DEDUCTIONS",
      label: "PRETAX FLEX",
      amount: -centsToAmount(pretaxFlexCents),
    },
    {
      section: "DEDUCTIONS",
      label: "VEBA",
      amount: -centsToAmount(vebaCents),
    },
    // Tax withholdings
    {
      section: "DEDUCTIONS",
      label: "FEDERAL W/H",
      amount: -centsToAmount(federalWithholdingCents),
    },
    {
      section: "DEDUCTIONS",
      label: "FICA",
      amount: -centsToAmount(ficaCents),
    },
    {
      section: "DEDUCTIONS",
      label: "MEDICARE",
      amount: -centsToAmount(medicareCents),
    },
    // Other post-tax deductions
    {
      section: "DEDUCTIONS",
      label: "LTD",
      amount: -centsToAmount(ltdCents),
    },
    {
      section: "DEDUCTIONS",
      label: "MUTUAL AID",
      amount: -centsToAmount(mutualAidCents),
    },
    {
      section: "DEDUCTIONS",
      label: "UNION DUES",
      amount: -centsToAmount(unionDuesCents),
    },
    ...(roth401kCents > 0
      ? [
          {
            section: "DEDUCTIONS" as const,
            label: "ROTH 401K",
            amount: -centsToAmount(roth401kCents),
          },
        ]
      : []),
  ];

  const totalDeductions = deductionItems.reduce((sum, d) => sum + d.amount, 0);

  // Compute a pay date: 7 days after period end (typical UPS schedule)
  const periodEndDate = new Date(payPeriodEnd);
  periodEndDate.setDate(periodEndDate.getDate() + 7);
  const payDate = periodEndDate.toISOString().split("T")[0];

  return {
    payPeriod: {
      start: payPeriodStart,
      end: payPeriodEnd,
      payDate,
    },
    sections: [
      {
        section: "EARNINGS" as const,
        headerText: "Earnings",
        lineItems: earningsItems,
      },
      ...(reimbursementItems.length > 0
        ? [
            {
              section: "REIMBURSEMENTS" as const,
              headerText: "Reimbursements",
              lineItems: reimbursementItems,
            },
          ]
        : []),
      {
        section: "DEDUCTIONS" as const,
        headerText: "Deductions",
        lineItems: deductionItems,
      },
    ],
    totals: {
      gross: centsToAmount(grossPayCents),
      deductionsTotal: Math.abs(totalDeductions),
      net: centsToAmount(grossPayCents) + totalDeductions,
    },
    parseConfidence: trips.length > 0 ? "high" : "low",
  };
}

// ============================================
// DEDUCTION EXTRACTOR
// ============================================

/**
 * Extract learned deduction amounts from a parsed pay statement.
 * Scans all section line items for known UPS Dayforce deduction labels
 * and maps them into a ParsedPaystubDeductions object (amounts in cents).
 */
export function extractLearnedDeductionsFromParsed(parsed: PayStatementParsed): ParsedPaystubDeductions {
  const deductions: ParsedPaystubDeductions = {};

  const allItems = parsed.sections.flatMap((s) => s.lineItems);

  for (const item of allItems) {
    const label = item.label.toUpperCase().replace(/\s+/g, " ").trim();
    const amount = Math.abs(Math.round(item.amount * 100)); // convert to cents

    if (label.includes("PRETAX FLEX") || label.includes("PRE TAX FLEX") || label.includes("PRETAX FSA")) {
      deductions.pretaxFlexCents = amount;
    } else if (label.includes("VEBA")) {
      deductions.vebaCents = amount;
    } else if (label.includes("EXCESS LIFE") || label.includes("EXCESS LIFE INS")) {
      deductions.excessLifeCents = amount;
    } else if (label.includes("LTD") || label.includes("LONG TERM DIS") || label.includes("LONG-TERM DIS")) {
      deductions.ltdCents = amount;
    } else if (label.includes("MUTUAL AID")) {
      deductions.mutualAidCents = amount;
    } else if (label.includes("UNION DUES") || label.includes("UNION DUE")) {
      deductions.unionDuesCents = amount;
    } else if (label.includes("ROTH 401") || label.includes("ROTH401") || label.includes("ROTH 401K")) {
      deductions.roth401kCents = amount;
    }
  }

  return deductions;
}

// ============================================
// TEMPLATE BUILDER
// ============================================

export function buildTemplate(args: {
  userId: string;
  airlineId?: string;
  parsed: PayStatementParsed;
}): Omit<StatementTemplate, "id" | "createdAt" | "updatedAt"> {
  const sectionOrder = args.parsed.sections.map((s) => s.section);
  const sectionHeaders: Record<string, string> = {};
  for (const s of args.parsed.sections) {
    sectionHeaders[s.section] = s.headerText ?? s.section;
  }

  const orderingHints: Record<string, number> = {};
  let i = 0;
  for (const s of args.parsed.sections) {
    for (const li of s.lineItems) {
      orderingHints[normalize(li.label)] = i++;
    }
  }

  return {
    userId: args.userId,
    airlineId: args.airlineId ?? null,
    version: "v1",
    sectionOrder,
    sectionHeaders,
    lineItemOrderingHints: orderingHints,
    normalizationRules: { labelAliases: {} },
  };
}

// ============================================
// PROJECTED STATEMENT BUILDER
// ============================================

export async function buildProjectedStatement(args: {
  userId: string;
  payPeriodId: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  payDate?: string;
  templateId: string;
}): Promise<ProjectedStatement> {
  // Get user profile
  const profile = await db.profile.findUnique({ where: { userId: args.userId } });
  const hourlyRateCents = profile?.hourlyRateCents ?? 32500;

  // Get template
  const template = await db.statementTemplate.findUnique({
    where: { id: args.templateId },
  });
  if (!template) throw new Error("Template not found");

  const sectionHeaders = JSON.parse(template.sectionHeaders) as Record<string, string>;

  // Get trips in period
  const trips = await db.trip.findMany({
    where: {
      userId: args.userId,
      startDate: { gte: args.payPeriodStart },
      endDate: { lte: args.payPeriodEnd },
    },
  });

  // Get pay events in period
  const payEvents = await db.payEvent.findMany({
    where: {
      userId: args.userId,
      eventDateISO: { gte: args.payPeriodStart, lte: args.payPeriodEnd },
    },
  });

  // Calculate totals
  const totalCreditMinutes = trips.reduce((sum, t) => sum + t.totalCreditMinutes, 0);
  const totalPayCents = trips.reduce((sum, t) => sum + t.totalPayCents, 0);
  const totalPremiumCents = trips.reduce((sum, t) => sum + t.premiumCents, 0);
  const totalPerDiemCents = trips.reduce((sum, t) => sum + t.totalPdiemCents, 0);
  const eventPremiums = payEvents.reduce((sum, e) => sum + (e.payDifferenceCents ?? 0), 0);

  const sections: ProjectedStatement["sections"] = [];

  // Earnings section
  const earningsAmount = centsToAmount(totalPayCents - totalPremiumCents);
  if (earningsAmount > 0) {
    sections.push({
      section: "EARNINGS",
      headerText: sectionHeaders["EARNINGS"] ?? "Earnings",
      lineItems: [
        {
          section: "EARNINGS",
          label: "FLIGHT PAY (ESTIMATE)",
          unitsLabel: "HRS",
          units: round2(totalCreditMinutes / 60),
          rate: round2(hourlyRateCents / 100),
          amount: earningsAmount,
          meta: { estimate: true },
        },
      ],
    });
  }

  // Premiums section
  const premiumAmount = centsToAmount(totalPremiumCents + eventPremiums);
  if (premiumAmount !== 0) {
    sections.push({
      section: "PREMIUMS",
      headerText: sectionHeaders["PREMIUMS"] ?? "Premiums",
      lineItems: [
        {
          section: "PREMIUMS",
          label: "PREMIUMS (ESTIMATE)",
          amount: premiumAmount,
          meta: { estimate: true },
        },
      ],
    });
  }

  // Reimbursements section
  const perDiemAmount = centsToAmount(totalPerDiemCents);
  if (perDiemAmount > 0) {
    sections.push({
      section: "REIMBURSEMENTS",
      headerText: sectionHeaders["REIMBURSEMENTS"] ?? "Reimbursements",
      lineItems: [
        {
          section: "REIMBURSEMENTS",
          label: "PER DIEM (ESTIMATE)",
          amount: perDiemAmount,
          meta: { estimate: true },
        },
      ],
    });
  }

  const gross = round2(earningsAmount + premiumAmount + perDiemAmount);

  // Totals section
  sections.push({
    section: "TOTALS",
    headerText: sectionHeaders["TOTALS"] ?? "Totals",
    lineItems: [
      {
        section: "TOTALS",
        label: "GROSS (ESTIMATE)",
        amount: gross,
        meta: { estimate: true },
      },
    ],
  });

  const confidence: ProjectedStatement["confidence"] =
    trips.length >= 3 ? "high" : trips.length >= 1 ? "medium" : "low";

  return {
    id: "", // Will be set by caller
    userId: args.userId,
    payPeriod: {
      id: args.payPeriodId,
      start: args.payPeriodStart,
      end: args.payPeriodEnd,
      payDate: args.payDate,
    },
    templateId: args.templateId,
    generatedAt: nowISO(),
    sections,
    totals: {
      gross,
    },
    confidence,
  };
}

// ============================================
// WHAT CHANGED DIFF
// ============================================

function flattenProjected(stmt: ProjectedStatement): Record<string, StatementLineItem> {
  const map: Record<string, StatementLineItem> = {};
  for (const sec of stmt.sections) {
    for (const li of sec.lineItems) {
      map[`${sec.section}::${normalize(li.label)}`] = li;
    }
  }
  return map;
}

function neutralWhy(reason: DiffReason): string {
  switch (reason) {
    case "trip_added":
      return "A trip was added, which updated the estimate.";
    case "trip_removed":
      return "A trip was removed, which updated the estimate.";
    case "credit_changed":
      return "Trip credit changed, which updated the estimate.";
    case "premium_logged":
      return "A pay event was logged, which updated the estimate.";
    case "rule_changed":
      return "Your pay rules changed, which updated the estimate.";
    case "statement_uploaded":
      return "Your statement template updated categories/formatting.";
    default:
      return "Inputs changed, which updated the estimate.";
  }
}

function formatSummary(deltaTotal: number, reason: DiffReason): string {
  const sign = deltaTotal >= 0 ? "+" : "-";
  const amt = Math.abs(deltaTotal).toFixed(2);
  const lead =
    reason === "trip_added"
      ? "Trip added"
      : reason === "trip_removed"
        ? "Trip removed"
        : reason === "premium_logged"
          ? "Premium event logged"
          : reason === "rule_changed"
            ? "Rules updated"
            : "Estimate updated";
  return `${lead}: ${sign}$${amt} est.`;
}

export function buildStatementDiff(args: {
  userId: string;
  payPeriod: { id: string; start: string; end: string; payDate?: string };
  reason: DiffReason;
  before: ProjectedStatement;
  after: ProjectedStatement;
}): StatementDiff {
  const beforeMap = flattenProjected(args.before);
  const afterMap = flattenProjected(args.after);

  const keys = new Set([...Object.keys(beforeMap), ...Object.keys(afterMap)]);
  const changes: StatementDiff["changes"] = [];
  let deltaTotal = 0;

  for (const k of keys) {
    const b = beforeMap[k];
    const a = afterMap[k];
    const bAmt = b?.amount ?? 0;
    const aAmt = a?.amount ?? 0;
    if (round2(bAmt) === round2(aAmt)) continue;

    const delta = round2(aAmt - bAmt);
    deltaTotal += delta;

    changes.push({
      section: a?.section ?? b!.section,
      label: a?.label ?? b!.label,
      before: b ? { units: b.units, rate: b.rate, amount: b.amount } : undefined,
      after: a ? { units: a.units, rate: a.rate, amount: a.amount } : undefined,
      deltaAmount: delta,
      why: neutralWhy(args.reason),
      driver: { type: args.reason === "rule_changed" ? "rule" : "unknown" },
    });
  }

  return {
    id: "", // Will be set by caller
    userId: args.userId,
    payPeriod: args.payPeriod,
    comparedAt: nowISO(),
    reason: args.reason,
    summaryLine: formatSummary(deltaTotal, args.reason),
    changes: changes.sort((x, y) => Math.abs(y.deltaAmount) - Math.abs(x.deltaAmount)),
  };
}

// ============================================
// RECONCILIATION
// ============================================

function mapAlias(label: string, templateNormRules?: { labelAliases: Record<string, string> }): string {
  const n = normalize(label);
  return templateNormRules?.labelAliases?.[n] ?? label;
}

export function reconcileStatements(args: {
  userId: string;
  payPeriod: { id: string; start: string; end: string; payDate?: string };
  actual: PayStatementParsed;
  projected: ProjectedStatement;
  templateNormRules?: { labelAliases: Record<string, string> };
}): ReconciliationResult {
  const actualItems = args.actual.sections.flatMap((s) =>
    s.lineItems.map((li) => ({ ...li, section: s.section }))
  );
  const projMap = flattenProjected(args.projected);

  const usedProj = new Set<string>();
  const items: ReconciliationResult["items"] = [];

  for (const a of actualItems) {
    const key = `${a.section}::${normalize(mapAlias(a.label, args.templateNormRules))}`;
    const p = projMap[key];
    if (p) usedProj.add(key);

    if (p) {
      items.push({
        actual: a,
        projected: p,
        status: "matched",
        note: "Matched to your projection (estimate).",
      });
    } else {
      items.push({
        actual: a,
        status: "missing_in_app",
        note: "This line item isn't currently explained by trips/events in the app.",
        suggestion: "Consider logging a pay event or attaching proof for this period.",
      });
    }
  }

  for (const key of Object.keys(projMap)) {
    if (usedProj.has(key)) continue;
    const p = projMap[key];
    if (!p) continue;
    items.push({
      actual: { section: p.section, label: "(Not on statement)", amount: 0 },
      projected: p,
      status: "unmatched_needs_review",
      note: "This estimate did not appear on the uploaded statement.",
      suggestion: "Review rules/events for this period.",
    });
  }

  return {
    id: "", // Will be set by caller
    userId: args.userId,
    payPeriod: args.payPeriod,
    comparedAt: nowISO(),
    items,
    summary: {
      matchedCount: items.filter((r) => r.status === "matched").length,
      missingInAppCount: items.filter((r) => r.status === "missing_in_app").length,
      unmatchedCount: items.filter((r) => r.status === "unmatched_needs_review").length,
    },
  };
}

// ============================================
// PAY AUDIT CHECKLIST
// ============================================

export function buildAuditChecklist(args: {
  userId: string;
  payPeriod: { id: string; start: string; end: string; payDate?: string };
  projected: ProjectedStatement;
  reconciliation?: ReconciliationResult;
  missingProofCount?: number;
}): PayAuditChecklist {
  const checks: PayAuditChecklist["checks"] = [];

  // Confidence check
  const lowConf = args.projected.confidence === "low";
  checks.push({
    id: "confidence",
    title: "Estimate confidence",
    status: lowConf ? "warn" : "pass",
    detail: lowConf
      ? "Confidence is low. Add trips/events or upload a statement to improve accuracy."
      : "Confidence looks good for this period.",
    action: lowConf ? { label: "Improve confidence", deepLink: "/trips" } : undefined,
  });

  // Reconciliation check
  if (args.reconciliation) {
    const missing = args.reconciliation.summary.missingInAppCount;
    checks.push({
      id: "recon_missing",
      title: "Unexplained payroll lines",
      status: missing > 0 ? "warn" : "pass",
      detail:
        missing > 0
          ? `${missing} line item(s) on the statement are not currently explained in the app.`
          : "All statement lines are explained by the app.",
      action: missing > 0 ? { label: "Review reconciliation", deepLink: "/pay/reconciliation" } : undefined,
    });
  }

  // Proof check
  const missingProof = args.missingProofCount ?? 0;
  checks.push({
    id: "proof",
    title: "Supporting proof attached",
    status: missingProof > 0 ? "warn" : "pass",
    detail:
      missingProof > 0
        ? `${missingProof} item(s) are missing proof attachments.`
        : "Proof coverage looks good.",
    action: missingProof > 0 ? { label: "Attach proof", deepLink: "/events" } : undefined,
  });

  // Calculate health score
  let score = 100;
  for (const c of checks) {
    if (c.status === "warn") score -= 10;
    if (c.status === "fail") score -= 25;
  }
  score = Math.max(0, Math.min(100, score));

  return {
    id: "", // Will be set by caller
    userId: args.userId,
    payPeriod: args.payPeriod,
    generatedAt: nowISO(),
    payHealthScore: score,
    checks,
  };
}

// ============================================
// SERVICE ORCHESTRATOR
// ============================================

export class PayStatementMirrorService {
  /**
   * Create or get existing template for user
   */
  async ensureTemplate(userId: string, airlineId?: string): Promise<string> {
    // Check if template exists
    const existing = await db.statementTemplate.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    if (existing) return existing.id;

    // Create default template
    const template = buildTemplate({
      userId,
      airlineId,
      parsed: {
        sections: [
          { section: "EARNINGS", headerText: "Earnings", lineItems: [] },
          { section: "PREMIUMS", headerText: "Premiums", lineItems: [] },
          { section: "GUARANTEES_OFFSETS", headerText: "Guarantees / Offsets", lineItems: [] },
          { section: "REIMBURSEMENTS", headerText: "Reimbursements", lineItems: [] },
          { section: "DEDUCTIONS", headerText: "Deductions", lineItems: [] },
          { section: "TOTALS", headerText: "Totals", lineItems: [] },
        ],
        totals: {},
        parseConfidence: "medium",
      },
    });

    const created = await db.statementTemplate.create({
      data: {
        userId: template.userId,
        airlineId: template.airlineId,
        version: template.version,
        sectionOrder: JSON.stringify(template.sectionOrder),
        sectionHeaders: JSON.stringify(template.sectionHeaders),
        lineItemOrderingHints: template.lineItemOrderingHints ? JSON.stringify(template.lineItemOrderingHints) : null,
        normalizationRules: template.normalizationRules ? JSON.stringify(template.normalizationRules) : null,
      },
    });

    return created.id;
  }

  /**
   * Get or build projected statement
   */
  async getProjected(
    userId: string,
    payPeriodId: string,
    payPeriodStart: string,
    payPeriodEnd: string,
    payDate?: string
  ): Promise<ProjectedStatement> {
    const profile = await db.profile.findUnique({ where: { userId } });
    const templateId = await this.ensureTemplate(userId, profile?.airline);

    const projected = await buildProjectedStatement({
      userId,
      payPeriodId,
      payPeriodStart,
      payPeriodEnd,
      payDate,
      templateId,
    });

    // Save to database
    const existing = await db.projectedStatement.findFirst({
      where: { userId, payPeriodId },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      await db.projectedStatement.update({
        where: { id: existing.id },
        data: {
          generatedAt: projected.generatedAt,
          sectionsData: JSON.stringify(projected.sections),
          grossCents: amountToCents(projected.totals.gross),
          deductionsCents: projected.totals.deductionsTotal ? amountToCents(projected.totals.deductionsTotal) : null,
          netCents: projected.totals.net ? amountToCents(projected.totals.net) : null,
          confidence: projected.confidence,
        },
      });
      return { ...projected, id: existing.id };
    }

    const created = await db.projectedStatement.create({
      data: {
        userId,
        payPeriodId,
        templateId,
        generatedAt: projected.generatedAt,
        sectionsData: JSON.stringify(projected.sections),
        grossCents: amountToCents(projected.totals.gross),
        deductionsCents: projected.totals.deductionsTotal ? amountToCents(projected.totals.deductionsTotal) : null,
        netCents: projected.totals.net ? amountToCents(projected.totals.net) : null,
        confidence: projected.confidence,
      },
    });

    return { ...projected, id: created.id };
  }

  /**
   * Recalculate projected and compute diff
   */
  async recalcAndDiff(
    userId: string,
    payPeriodId: string,
    payPeriodStart: string,
    payPeriodEnd: string,
    payDate: string | undefined,
    reason: DiffReason
  ): Promise<{ projected: ProjectedStatement; diff: StatementDiff }> {
    // Get existing projection
    const existingData = await db.projectedStatement.findFirst({
      where: { userId, payPeriodId },
      orderBy: { createdAt: "desc" },
    });

    // Build new projection
    const after = await this.getProjected(userId, payPeriodId, payPeriodStart, payPeriodEnd, payDate);

    // Build before (either from DB or use after as fallback)
    let before: ProjectedStatement;
    if (existingData) {
      before = {
        id: existingData.id,
        userId: existingData.userId,
        payPeriod: {
          id: payPeriodId,
          start: payPeriodStart,
          end: payPeriodEnd,
          payDate,
        },
        templateId: existingData.templateId,
        generatedAt: existingData.generatedAt,
        sections: JSON.parse(existingData.sectionsData),
        totals: {
          gross: centsToAmount(existingData.grossCents),
          deductionsTotal: existingData.deductionsCents ? centsToAmount(existingData.deductionsCents) : undefined,
          net: existingData.netCents ? centsToAmount(existingData.netCents) : undefined,
        },
        confidence: existingData.confidence as "high" | "medium" | "low",
      };
    } else {
      before = after;
    }

    const diff = buildStatementDiff({
      userId,
      payPeriod: { id: payPeriodId, start: payPeriodStart, end: payPeriodEnd, payDate },
      reason,
      before,
      after,
    });

    // Save diff
    const savedDiff = await db.statementDiff.create({
      data: {
        userId,
        payPeriodId,
        comparedAt: diff.comparedAt,
        reason: diff.reason,
        summaryLine: diff.summaryLine,
        changesData: JSON.stringify(diff.changes),
      },
    });

    return { projected: after, diff: { ...diff, id: savedDiff.id } };
  }

  /**
   * Run reconciliation
   */
  async runReconciliation(
    userId: string,
    payPeriodId: string,
    payPeriodStart: string,
    payPeriodEnd: string,
    payDate?: string
  ): Promise<ReconciliationResult> {
    // Get actual statement
    const actualStmt = await db.actualStatement.findUnique({
      where: { userId_payPeriodId: { userId, payPeriodId } },
    });

    if (!actualStmt) {
      throw new Error("No actual statement uploaded for this pay period.");
    }

    const actual: PayStatementParsed = JSON.parse(actualStmt.parsedData);

    // Get projected
    const projected = await this.getProjected(userId, payPeriodId, payPeriodStart, payPeriodEnd, payDate);

    // Get template normalization rules
    const template = await db.statementTemplate.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    const templateNormRules = template?.normalizationRules
      ? JSON.parse(template.normalizationRules)
      : undefined;

    const reconciliation = reconcileStatements({
      userId,
      payPeriod: { id: payPeriodId, start: payPeriodStart, end: payPeriodEnd, payDate },
      actual,
      projected,
      templateNormRules,
    });

    // Save
    const saved = await db.reconciliationResult.create({
      data: {
        userId,
        payPeriodId,
        comparedAt: reconciliation.comparedAt,
        itemsData: JSON.stringify(reconciliation.items),
        matchedCount: reconciliation.summary.matchedCount,
        missingInAppCount: reconciliation.summary.missingInAppCount,
        unmatchedCount: reconciliation.summary.unmatchedCount,
      },
    });

    return { ...reconciliation, id: saved.id };
  }

  /**
   * Run audit
   */
  async runAudit(
    userId: string,
    payPeriodId: string,
    payPeriodStart: string,
    payPeriodEnd: string,
    payDate?: string
  ): Promise<PayAuditChecklist> {
    // Get projected
    const projected = await this.getProjected(userId, payPeriodId, payPeriodStart, payPeriodEnd, payDate);

    // Try to get reconciliation
    let reconciliation: ReconciliationResult | undefined;
    try {
      reconciliation = await this.runReconciliation(userId, payPeriodId, payPeriodStart, payPeriodEnd, payDate);
    } catch {
      // No actual statement yet - that's ok
    }

    // Count events without proof
    const eventsWithoutProof = await db.payEvent.count({
      where: {
        userId,
        eventDateISO: { gte: payPeriodStart, lte: payPeriodEnd },
        documentation: { none: {} },
      },
    });

    const audit = buildAuditChecklist({
      userId,
      payPeriod: { id: payPeriodId, start: payPeriodStart, end: payPeriodEnd, payDate },
      projected,
      reconciliation,
      missingProofCount: eventsWithoutProof,
    });

    // Save
    const saved = await db.payAuditChecklist.create({
      data: {
        userId,
        payPeriodId,
        generatedAt: audit.generatedAt,
        payHealthScore: audit.payHealthScore,
        checksData: JSON.stringify(audit.checks),
      },
    });

    return { ...audit, id: saved.id };
  }

  /**
   * Store actual statement from upload
   */
  async storeActualStatement(
    userId: string,
    payPeriodId: string,
    parsed: PayStatementParsed,
    uploadId?: string
  ): Promise<void> {
    await db.actualStatement.upsert({
      where: { userId_payPeriodId: { userId, payPeriodId } },
      create: {
        userId,
        payPeriodId,
        parsedData: JSON.stringify(parsed),
        uploadId,
      },
      update: {
        parsedData: JSON.stringify(parsed),
        uploadId,
      },
    });
  }
}

// Export singleton instance
export const payStatementMirrorService = new PayStatementMirrorService();
