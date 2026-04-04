/**
 * Pay Audit Routes
 *
 * POST /api/pay-audit/analyze  — Upload images, parse, compare, save & return result
 * GET  /api/pay-audit          — List past audits for the user
 * GET  /api/pay-audit/:id      — Get specific audit result
 */

import { Hono } from 'hono';
import { type AppType } from '../types';
import { db } from '../db';
import { analyzePayDocuments, analyzeFlightRegisterOnly, processFlightRegisterOnly } from '../services/pay-audit-service';
import type { PayAuditResult } from '@/shared/contracts';
import type { TaxProfile, Deduction } from '../lib/tax-calculator';

export const payAuditRouter = new Hono<AppType>();

// ============================================
// POST /api/pay-audit/process-fr
// Parse FR and return matched Dayforce dates only (no audit math)
// ============================================
payAuditRouter.post('/process-fr', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const body = await c.req.json<{ flightRegisterImages?: string[]; mimeType?: string }>();

    if (!body.flightRegisterImages?.length) {
      return c.json({ error: 'At least one Flight Register image is required' }, 400);
    }
    if (body.flightRegisterImages.length > 6) {
      return c.json({ error: 'Maximum 6 Flight Register images' }, 400);
    }

    const result = await processFlightRegisterOnly({
      flightRegisterImages: body.flightRegisterImages,
      mimeType: body.mimeType ?? 'image/jpeg',
    });

    return c.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Processing failed';
    console.error('[PayAudit] process-fr error:', error);
    if (msg.includes('OpenAI API key not configured')) {
      return c.json({ error: 'AI service not configured. Please contact support.' }, 503);
    }
    return c.json({ error: msg }, 500);
  }
});

// ============================================
// POST /api/pay-audit/analyze
// ============================================
payAuditRouter.post('/analyze', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json<{
      flightRegisterImages?: string[];
      dayforceImages?: string[];
      mimeType?: string;
      // v3 FR-only fields
      settlementAmountCents?: number;
      advanceAmountCents?: number;
      comparisonMode?: 'gross' | 'net';
    }>();

    if (!body.flightRegisterImages?.length) {
      return c.json({ error: 'At least one Flight Register image is required' }, 400);
    }

    if (body.flightRegisterImages.length > 6) {
      return c.json({ error: 'Maximum 6 Flight Register images' }, 400);
    }

    // Get user profile for pay rate and context
    const profile = await db.profile.findUnique({
      where: { userId: user.id },
      select: { hourlyRateCents: true, position: true, base: true },
    });

    const hourlyRateCents = profile?.hourlyRateCents ?? 32500;
    const position = profile?.position ?? null;
    const base = profile?.base ?? null;

    console.log(`[PayAudit] Analyze request from user ${user.id}, rate=$${hourlyRateCents / 100}`);

    // Determine which path to use: FR-only (v3) or legacy FR+Dayforce
    const isV3 = typeof body.settlementAmountCents === 'number' || typeof body.advanceAmountCents === 'number';

    let result: PayAuditResult;

    if (isV3) {
      // v3: Flight Register only + manual paycheck entry
      const settlementAmountCents = body.settlementAmountCents ?? 0;
      const advanceAmountCents = body.advanceAmountCents ?? 0;
      const comparisonMode = body.comparisonMode ?? 'gross';

      // Load user tax profile and deductions for net estimation
      let taxProfile: TaxProfile | null = null;
      let deductionList: Deduction[] = [];

      if (comparisonMode === 'net') {
        const dbTaxProfile = await db.taxProfile.findUnique({ where: { userId: user.id } });
        if (dbTaxProfile) {
          taxProfile = {
            stateOfResidence: dbTaxProfile.stateOfResidence,
            filingStatus: dbTaxProfile.filingStatus as TaxProfile['filingStatus'],
            payFrequency: dbTaxProfile.payFrequency as TaxProfile['payFrequency'],
            dependents: dbTaxProfile.dependents,
            additionalCreditsCents: dbTaxProfile.additionalCredits,
            extraWithholdingType: dbTaxProfile.extraWithholdingType as TaxProfile['extraWithholdingType'],
            extraWithholdingValue: dbTaxProfile.extraWithholdingValue,
            stateWithholdingOverride: dbTaxProfile.stateWithholdingOverride ?? undefined,
            taxYear: dbTaxProfile.taxYear,
          };
        }
        const dbDeductions = await db.deduction.findMany({
          where: { userId: user.id },
          orderBy: { sortOrder: 'asc' },
        });
        deductionList = dbDeductions.map((d) => ({
          id: d.id,
          name: d.name,
          deductionType: d.deductionType as Deduction['deductionType'],
          amount: d.amount,
          timing: d.timing as Deduction['timing'],
          frequency: d.frequency as Deduction['frequency'],
          isEnabled: d.isEnabled,
          sortOrder: d.sortOrder,
        }));
      }

      result = await analyzeFlightRegisterOnly({
        flightRegisterImages: body.flightRegisterImages,
        mimeType: body.mimeType ?? 'image/jpeg',
        profileHourlyRateCents: hourlyRateCents,
        profilePosition: position,
        profileBase: base,
        settlementAmountCents,
        advanceAmountCents,
        comparisonMode,
        taxProfile,
        deductions: deductionList,
      });
    } else {
      // Legacy: FR + Dayforce
      if (!body.dayforceImages?.length) {
        return c.json({ error: 'Dayforce images required for legacy mode' }, 400);
      }
      result = await analyzePayDocuments({
        flightRegisterImages: body.flightRegisterImages,
        dayforceImages: body.dayforceImages,
        mimeType: body.mimeType ?? 'image/jpeg',
        profileHourlyRateCents: hourlyRateCents,
        profilePosition: position,
        profileBase: base,
      });
    }

    // Persist result
    const saved = await db.payAudit.create({
      data: {
        userId: user.id,
        payPeriodStart: result.flightRegister.payPeriodStart ?? null,
        payPeriodEnd: result.flightRegister.payPeriodEnd ?? null,
        frPayPeriodStart: result.flightRegister.payPeriodStart,
        frPayPeriodEnd: result.flightRegister.payPeriodEnd,
        frBeginningPayCredit: result.flightRegister.beginningPayCredit,
        frEndingPayCredit: result.flightRegister.endingPayCredit,
        frDutyDays: result.flightRegister.dutyDays,
        frJaHours: result.flightRegister.jaHours,
        frJa2Hours: result.flightRegister.ja2Hours,
        frBlockHoursPaid: result.flightRegister.blockHoursPaid,
        frTdyPerDiem: result.flightRegister.tdyPerDiem,
        dfPayPeriodStart: result.dayforce.payPeriodStart,
        dfPayPeriodEnd: result.dayforce.payPeriodEnd,
        dfPayRate: result.dayforce.payRate,
        dfAdvNextPay: result.dayforce.advNextPay,
        dfOverGuaranteeHours: result.dayforce.overGuaranteeHours,
        dfOverGuaranteeAmt: result.dayforce.overGuaranteeAmount,
        dfUnderGuarantee: result.dayforce.underGuarantee,
        dfJuniorHours: result.dayforce.juniorHours,
        dfJuniorAmount: result.dayforce.juniorAmount,
        dfPremiumPayHours: result.dayforce.premiumPayHours,
        dfPremiumPayAmount: result.dayforce.premiumPayAmount,
        dfDomicilePdmTx: result.dayforce.domicilePdmTx,
        dfDmsticPdmTx: result.dayforce.dmsticPdmTx,
        dfVacationHours: result.dayforce.vacationHours,
        dfVacationAmount: result.dayforce.vacationAmount,
        dfGrossPay: result.dayforce.grossPay,
        dfNetPay: result.dayforce.netPay,
        matchScore: result.matchScore,
        matchStatus: result.matchStatus,
        estimatedDifference: result.estimatedDifference,
        jaHourDifference: result.comparison.jaHourDifference,
        jaExpectedPay: result.comparison.jaExpectedPay,
        jaActualPay: result.comparison.jaActualPay,
        summary: result.summary,
        findings: JSON.stringify(result.findings),
        appPayRate: result.appData.payRate,
        appPosition: result.appData.position,
        appBase: result.appData.base,
        // v3 FR-only audit fields
        expectedGrossCents: result.expectedGrossCents ?? null,
        estimatedNetCents: result.estimatedNetCents ?? null,
        enteredSettlementCents: result.enteredSettlementCents ?? null,
        enteredAdvanceCents: result.enteredAdvanceCents ?? null,
        auditDifferenceCents: result.auditDifferenceCents ?? null,
        auditStatus: result.auditStatus ?? null,
        auditSummary: result.auditSummary ?? null,
        comparisonMode: result.comparisonMode ?? null,
        matchedSettlementPeriod: result.matchedSettlementPeriod ?? null,
        matchedAdvancePeriod: result.matchedAdvancePeriod ?? null,
        matchedSettlementPayDate: result.matchedSettlementPayDate ?? null,
        matchedAdvancePayDate: result.matchedAdvancePayDate ?? null,
        expectedGrossBreakdown: result.expectedGrossBreakdown
          ? JSON.stringify(result.expectedGrossBreakdown)
          : null,
      },
    });

    const fullResult: PayAuditResult = {
      ...result,
      id: saved.id,
      createdAt: saved.createdAt.toISOString(),
    };

    return c.json(fullResult);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Analysis failed';
    console.error('[PayAudit] Error:', error);

    if (msg.includes('OpenAI API key not configured')) {
      return c.json({ error: 'AI service not configured. Please contact support.' }, 503);
    }

    return c.json({ error: msg }, 500);
  }
});

// ============================================
// GET /api/pay-audit — list previous audits
// ============================================
payAuditRouter.get('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const audits = await db.payAudit.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        createdAt: true,
        matchScore: true,
        matchStatus: true,
        estimatedDifference: true,
        payPeriodStart: true,
        payPeriodEnd: true,
        summary: true,
      },
    });

    return c.json({
      audits: audits.map((a) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[PayAudit] List error:', error);
    return c.json({ error: 'Failed to fetch audits' }, 500);
  }
});

// ============================================
// GET /api/pay-audit/:id — get single audit
// ============================================
payAuditRouter.get('/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const id = c.req.param('id');

  try {
    const audit = await db.payAudit.findFirst({
      where: { id, userId: user.id },
    });

    if (!audit) {
      return c.json({ error: 'Audit not found' }, 404);
    }

    // Reconstruct PayAuditResult from stored data
    const result: PayAuditResult = {
      id: audit.id,
      createdAt: audit.createdAt.toISOString(),
      matchScore: audit.matchScore ?? 0,
      matchStatus: (audit.matchStatus ?? 'possible_discrepancy') as PayAuditResult['matchStatus'],
      estimatedDifference: audit.estimatedDifference ?? 0,
      summary: audit.summary ?? '',
      findings: audit.findings ? (JSON.parse(audit.findings) as string[]) : [],
      flightRegister: {
        payPeriodStart: audit.frPayPeriodStart,
        payPeriodEnd: audit.frPayPeriodEnd,
        beginningPayCredit: audit.frBeginningPayCredit,
        endingPayCredit: audit.frEndingPayCredit,
        dutyDays: audit.frDutyDays,
        jaHours: audit.frJaHours,
        ja2Hours: audit.frJa2Hours,
        blockHoursPaid: audit.frBlockHoursPaid,
        tdyPerDiem: audit.frTdyPerDiem,
      },
      dayforce: {
        payPeriodStart: audit.dfPayPeriodStart,
        payPeriodEnd: audit.dfPayPeriodEnd,
        payRate: audit.dfPayRate,
        advNextPay: audit.dfAdvNextPay,
        overGuaranteeHours: audit.dfOverGuaranteeHours,
        overGuaranteeAmount: audit.dfOverGuaranteeAmt,
        underGuarantee: audit.dfUnderGuarantee,
        juniorHours: audit.dfJuniorHours,
        juniorAmount: audit.dfJuniorAmount,
        premiumPayHours: audit.dfPremiumPayHours,
        premiumPayAmount: audit.dfPremiumPayAmount,
        domicilePdmTx: audit.dfDomicilePdmTx,
        dmsticPdmTx: audit.dfDmsticPdmTx,
        vacationHours: audit.dfVacationHours,
        vacationAmount: audit.dfVacationAmount,
        grossPay: audit.dfGrossPay,
        netPay: audit.dfNetPay,
      },
      appData: {
        payRate: audit.appPayRate ?? 325,
        position: audit.appPosition,
        base: audit.appBase,
      },
      comparison: {
        // Preserve nulls — null means UNKNOWN, not zero
        jaHourDifference: audit.jaHourDifference ?? null,
        jaDollarDifference:
          audit.jaExpectedPay != null && audit.jaActualPay != null
            ? audit.jaExpectedPay - audit.jaActualPay
            : null,
        jaExpectedPay: audit.jaExpectedPay ?? null,
        jaActualPay: audit.jaActualPay ?? null,
        overGuaranteeDifference: 0,
        grossPayDifference: null,
        baseGuaranteeExpected: (audit.appPayRate ?? 325) * 37.5,
        jaStatus: audit.jaHourDifference != null ? 'found' : 'not_found',
        periodsMatch: true,
      },
      // v3 fields — restored from DB when available
      expectedGrossCents: audit.expectedGrossCents ?? undefined,
      estimatedNetCents: audit.estimatedNetCents ?? undefined,
      enteredSettlementCents: audit.enteredSettlementCents ?? undefined,
      enteredAdvanceCents: audit.enteredAdvanceCents ?? undefined,
      auditDifferenceCents: audit.auditDifferenceCents ?? undefined,
      auditStatus: (audit.auditStatus ?? undefined) as PayAuditResult['auditStatus'] | undefined,
      auditSummary: audit.auditSummary ?? undefined,
      comparisonMode: (audit.comparisonMode ?? undefined) as PayAuditResult['comparisonMode'],
      matchedSettlementPeriod: audit.matchedSettlementPeriod ?? null,
      matchedAdvancePeriod: audit.matchedAdvancePeriod ?? null,
      matchedSettlementPayDate: audit.matchedSettlementPayDate ?? null,
      matchedAdvancePayDate: audit.matchedAdvancePayDate ?? null,
      expectedGrossBreakdown: audit.expectedGrossBreakdown
        ? JSON.parse(audit.expectedGrossBreakdown)
        : null,
    };

    return c.json(result);
  } catch (error) {
    console.error('[PayAudit] Get error:', error);
    return c.json({ error: 'Failed to fetch audit' }, 500);
  }
});
