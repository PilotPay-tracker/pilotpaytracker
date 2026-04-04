/**
 * Pay Audit Service
 *
 * Parses Flight Register and Dayforce pay stub images via OpenAI Vision,
 * then compares them against each other and the user's stored app data.
 *
 * v2: Added validation gates for trust-safe comparison:
 *  - Pay period match gate (mismatched periods = stop)
 *  - JA unknown state (null ≠ zero — never assume missing JA is 0)
 *  - Conservative scoring (no penalty for missing data)
 *  - Estimated difference only shown when source data is valid
 */

import type {
  FlightRegisterData,
  DayforceData,
  PayAuditComparison,
  PayAuditResult,
  PayAuditMatchStatus,
} from '@/shared/contracts';
import { calculateNetPay } from '../lib/tax-calculator';
import type { TaxProfile, Deduction } from '../lib/tax-calculator';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Tolerance for OCR rounding differences (0.05 hours)
const JA_HOUR_TOLERANCE = 0.05;

// Base guarantee hours (UPS contract)
const BASE_GUARANTEE_HOURS = 37.5;

// ============================================
// HH:MM → Decimal conversion
// ============================================
export function hhmmToDecimal(hhmm: string | null | undefined): number {
  if (!hhmm) return 0;
  const clean = hhmm.trim().replace(/[^\d:]/g, '');
  const parts = clean.split(':');
  const h = parseInt(parts[0] ?? '0', 10) || 0;
  const m = parseInt(parts[1] ?? '0', 10) || 0;
  return h + m / 60;
}

// Returns null for missing input — UNKNOWN, not zero
function hhmmToDecimalOrNull(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  return hhmmToDecimal(hhmm);
}

// ============================================
// Pay Period Match Gate
// ============================================
function normalizePeriodDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const s = d.trim();
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // MM/DD/YYYY → YYYY-MM-DD
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  return s.toLowerCase();
}

function checkPayPeriodsMatch(fr: FlightRegisterData, df: DayforceData): boolean {
  const frStart = normalizePeriodDate(fr.payPeriodStart);
  const dfStart = normalizePeriodDate(df.payPeriodStart);
  const frEnd = normalizePeriodDate(fr.payPeriodEnd);
  const dfEnd = normalizePeriodDate(df.payPeriodEnd);

  // If both sides have no period data, cannot detect mismatch — assume match
  if (!frStart && !frEnd && !dfStart && !dfEnd) return true;

  // Compare start dates if both present
  if (frStart && dfStart) return frStart === dfStart;
  // Fall back to end dates if both present
  if (frEnd && dfEnd) return frEnd === dfEnd;

  // One side missing period data — cannot verify, assume match
  return true;
}

/**
 * Check whether a set of Dayforce stubs, when combined, substantially covers the
 * FR pay-period window. Used when single-stub matching fails but multi-stub upload
 * is detected.
 *
 * Rules (per user spec):
 *  1. DF stubs must be consecutive or near-consecutive (≤ 2 day gap between them)
 *  2. Their combined range must fall within or substantially cover the FR range
 *     (within 2 days on each boundary)
 *  3. No overlap/conflict between stubs
 */
function checkMultiStubCoversFR(
  stubs: DayforceData[],
  fr: FlightRegisterData
): boolean {
  if (stubs.length < 2) return false;

  const frStart = normalizePeriodDate(fr.payPeriodStart);
  const frEnd = normalizePeriodDate(fr.payPeriodEnd);
  if (!frStart && !frEnd) return true; // No FR period to compare against

  // Sort stubs by start date
  const sorted = [...stubs].sort((a, b) => {
    const as = normalizePeriodDate(a.payPeriodStart) ?? '';
    const bs = normalizePeriodDate(b.payPeriodStart) ?? '';
    return as.localeCompare(bs);
  });

  // Check consecutive: each stub's end must be within 2 days of next stub's start
  for (let i = 0; i < sorted.length - 1; i++) {
    const endDate = normalizePeriodDate(sorted[i]!.payPeriodEnd);
    const nextStart = normalizePeriodDate(sorted[i + 1]!.payPeriodStart);
    if (!endDate || !nextStart) continue; // Can't verify — allow through

    const endMs = new Date(endDate).getTime();
    const nextStartMs = new Date(nextStart).getTime();
    const gapDays = (nextStartMs - endMs) / (1000 * 60 * 60 * 24);

    // Negative gap means overlap — disallow
    if (gapDays < -1) return false;
    // Gap > 2 days means non-contiguous — disallow
    if (gapDays > 2) return false;
  }

  // Combined range: first stub's start to last stub's end
  const combinedStart = normalizePeriodDate(sorted[0]!.payPeriodStart);
  const combinedEnd = normalizePeriodDate(sorted[sorted.length - 1]!.payPeriodEnd);

  if (frStart && combinedStart) {
    const frStartMs = new Date(frStart).getTime();
    const combinedStartMs = new Date(combinedStart).getTime();
    const diffDays = Math.abs(frStartMs - combinedStartMs) / (1000 * 60 * 60 * 24);
    if (diffDays > 2) return false; // Combined start too far from FR start
  }

  if (frEnd && combinedEnd) {
    const frEndMs = new Date(frEnd).getTime();
    const combinedEndMs = new Date(combinedEnd).getTime();
    const diffDays = Math.abs(frEndMs - combinedEndMs) / (1000 * 60 * 60 * 24);
    if (diffDays > 2) return false; // Combined end too far from FR end
  }

  return true;
}

/**
 * Merge multiple contiguous Dayforce stubs into a single DayforceData.
 * Additive fields (hours, amounts) are summed.
 * Period boundaries are taken from the earliest start and latest end.
 * Pay rate is taken from the first stub that has one.
 * advNextPay is taken from the last stub (it's a forward-looking advance).
 */
function mergeDayforceStubs(stubs: DayforceData[]): DayforceData {
  if (stubs.length === 0) return emptyDayforce();
  if (stubs.length === 1) return stubs[0]!;

  const sorted = [...stubs].sort((a, b) => {
    const as = normalizePeriodDate(a.payPeriodStart) ?? '';
    const bs = normalizePeriodDate(b.payPeriodStart) ?? '';
    return as.localeCompare(bs);
  });

  const sumNullable = (key: keyof DayforceData): number | null => {
    let total: number | null = null;
    for (const s of sorted) {
      const v = s[key] as number | null;
      if (v != null) total = (total ?? 0) + v;
    }
    return total;
  };

  const firstNonNull = (key: keyof DayforceData): number | null => {
    for (const s of sorted) {
      const v = s[key] as number | null;
      if (v != null) return v;
    }
    return null;
  };

  const lastNonNull = (key: keyof DayforceData): number | null => {
    for (let i = sorted.length - 1; i >= 0; i--) {
      const v = sorted[i]![key] as number | null;
      if (v != null) return v;
    }
    return null;
  };

  return {
    payPeriodStart: normalizePeriodDate(sorted[0]!.payPeriodStart) ?? sorted[0]!.payPeriodStart,
    payPeriodEnd: normalizePeriodDate(sorted[sorted.length - 1]!.payPeriodEnd) ?? sorted[sorted.length - 1]!.payPeriodEnd,
    payRate: firstNonNull('payRate'),
    advNextPay: lastNonNull('advNextPay'),   // Forward-looking — take from last stub
    overGuaranteeHours: sumNullable('overGuaranteeHours'),
    overGuaranteeAmount: sumNullable('overGuaranteeAmount'),
    underGuarantee: sumNullable('underGuarantee'),
    juniorHours: sumNullable('juniorHours'),
    juniorAmount: sumNullable('juniorAmount'),
    premiumPayHours: sumNullable('premiumPayHours'),
    premiumPayAmount: sumNullable('premiumPayAmount'),
    domicilePdmTx: sumNullable('domicilePdmTx'),
    dmsticPdmTx: sumNullable('dmsticPdmTx'),
    vacationHours: sumNullable('vacationHours'),
    vacationAmount: sumNullable('vacationAmount'),
    grossPay: sumNullable('grossPay'),
    netPay: sumNullable('netPay'),
  };
}

// ============================================
// Flight Register Parser
// ============================================
async function parseFlightRegister(
  images: string[],
  mimeType: string,
  apiKey: string
): Promise<FlightRegisterData> {
  console.log('[PayAudit] Parsing Flight Register, images:', images.length);

  const imageContent = images.slice(0, 4).map((b64) => ({
    type: 'image_url' as const,
    image_url: {
      url: `data:${mimeType};base64,${b64}`,
      detail: 'high' as const,
    },
  }));

  const prompt = `You are analyzing a UPS Flight Register document (official UPS payroll register / pay statement from the UPS HR system or FlightBridge).

This document shows a pilot's pay register for a specific pay period. Find the TOTALS section — it usually appears at the bottom and summarizes the entire pay period.

Extract these fields. Look carefully at the document — field labels may vary slightly:
- Pay period start date (look for "Period:", "Pay Period:", date range headers)
- Pay period end date
- Beginning pay credit (hours at start of period, may show as "BEG PAY CR", "BEG CREDIT", "BEGIN CREDIT")
- Ending pay credit (hours at end of period, may show as "END PAY CR", "END CREDIT", "ENDING CREDIT", "TOT PAY CR")
- Duty days count (number, may show as "DUTY DAYS", "DD")
- JA hours (Junior Assignment hours, look for "JA", "JA 150%", "JA HOURS") — return null if not present or not clearly visible
- JA2 hours if a second JA line exists — return null if not present
- Block hours paid (look for "BLOCK HRS", "BLK HRS PAID", "BLOCK PAID")
- TDY per diem amount in dollars (look for "TDY", "PER DIEM", "PDM")

ALSO extract these dollar-amount pay buckets from the totals section (they appear as line items with dollar amounts):
- overGuaranteeAmountDollars: Over Guarantee dollar amount (positive, look for "OVER GUARANTEE", "OVER GTY", "O/G AMT") — return null if not present
- underGuaranteeAmountDollars: Under Guarantee dollar amount as a POSITIVE number even though it is a deduction (look for "UNDER GUARANTEE", "UNDER GTY", "U/G AMT") — return null if not present
- premiumPayAmountDollars: Total Premium Pay dollar amount (look for "PREMIUM PAY", "PREM PAY", "PREMIUM") — return null if not present
- taxablePdmAmountDollars: Total taxable per diem included in earnings (sum of "DOMICILE PDM TX", "DOM PDM TX", "DMSTIC PDM TX", "DOMESTIC PDM TX" — these are taxable PDM amounts that appear inside the earnings section) — return null if not present
- jaAmountDollars: The DOLLAR AMOUNT shown next to the JA or "JA 150%" line item (look for a dollar figure next to "JA", "JA 150%", "JUNIOR") — return null if not clearly visible as a dollar amount

CRITICAL: Return null for any field you cannot confidently find. Do NOT guess. Do NOT default to 0 for missing fields.
All time values should be in HH:MM format.
Dates should be YYYY-MM-DD format if possible, or MM/DD/YYYY as found.

Return ONLY valid JSON with no extra text:
{
  "payPeriodStart": "string or null",
  "payPeriodEnd": "string or null",
  "beginningPayCredit": "HH:MM or null",
  "endingPayCredit": "HH:MM or null",
  "dutyDays": number or null,
  "jaHours": "HH:MM or null",
  "ja2Hours": "HH:MM or null",
  "blockHoursPaid": "HH:MM or null",
  "tdyPerDiem": number or null,
  "overGuaranteeAmountDollars": number or null,
  "underGuaranteeAmountDollars": number or null,
  "premiumPayAmountDollars": number or null,
  "taxablePdmAmountDollars": number or null,
  "jaAmountDollars": number or null
}`;

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }, ...imageContent],
        },
      ],
      max_tokens: 800,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('[PayAudit] OpenAI error parsing FR:', response.status, err);
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content ?? '';
  console.log('[PayAudit] FR raw response:', content.substring(0, 600));

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn('[PayAudit] Could not parse JSON from FR response');
    return emptyFlightRegister();
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Partial<FlightRegisterData>;
    const asNum = (v: unknown): number | null => (typeof v === 'number' ? v : null);
    return {
      payPeriodStart: parsed.payPeriodStart ?? null,
      payPeriodEnd: parsed.payPeriodEnd ?? null,
      beginningPayCredit: parsed.beginningPayCredit ?? null,
      endingPayCredit: parsed.endingPayCredit ?? null,
      dutyDays: typeof parsed.dutyDays === 'number' ? parsed.dutyDays : null,
      jaHours: parsed.jaHours ?? null,
      ja2Hours: parsed.ja2Hours ?? null,
      blockHoursPaid: parsed.blockHoursPaid ?? null,
      tdyPerDiem: typeof parsed.tdyPerDiem === 'number' ? parsed.tdyPerDiem : null,
      overGuaranteeAmountDollars: asNum(parsed.overGuaranteeAmountDollars),
      underGuaranteeAmountDollars: asNum(parsed.underGuaranteeAmountDollars),
      premiumPayAmountDollars: asNum(parsed.premiumPayAmountDollars),
      taxablePdmAmountDollars: asNum(parsed.taxablePdmAmountDollars),
      jaAmountDollars: asNum(parsed.jaAmountDollars),
    };
  } catch (e) {
    console.error('[PayAudit] JSON parse error for FR:', e);
    return emptyFlightRegister();
  }
}

function emptyFlightRegister(): FlightRegisterData {
  return {
    payPeriodStart: null,
    payPeriodEnd: null,
    beginningPayCredit: null,
    endingPayCredit: null,
    dutyDays: null,
    jaHours: null,
    ja2Hours: null,
    blockHoursPaid: null,
    tdyPerDiem: null,
    overGuaranteeAmountDollars: null,
    underGuaranteeAmountDollars: null,
    premiumPayAmountDollars: null,
    taxablePdmAmountDollars: null,
    jaAmountDollars: null,
  };
}

// ============================================
// Dayforce Period Mapping (v4)
// Maps FR Pay Period Begin Date → Dayforce stub periods the user should use.
// Pattern: Settlement = FR_begin + 28 days (14-day stub)
//          Advance    = FR_begin + 56 days (14-day stub)
// ============================================

interface DayforcePeriodMatch {
  frBeginDate: string;
  settlementPeriod: string;
  advancePeriod: string;
  settlementPayDate?: string;
  advancePayDate?: string;
}

// Hardcoded proven examples (exact-match verified)
const KNOWN_PERIOD_MAPPINGS: DayforcePeriodMatch[] = [
  {
    frBeginDate: '2025-11-30',
    settlementPeriod: '12/28/2025 – 1/10/2026',
    advancePeriod: '1/25/2026 – 2/7/2026',
  },
];

function formatPeriodDate(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

function computeDayforcePeriods(frBeginIso: string): DayforcePeriodMatch {
  const begin = new Date(frBeginIso + 'T00:00:00Z');
  const addDays = (n: number) => {
    const d = new Date(begin);
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  };
  // Settlement: FR_begin + 28 → +41 (14-day period)
  const settStart = addDays(28);
  const settEnd   = addDays(41);
  // Advance: FR_begin + 56 → +69 (14-day period, one period skipped in between)
  const advStart  = addDays(56);
  const advEnd    = addDays(69);

  return {
    frBeginDate: frBeginIso,
    settlementPeriod: `${formatPeriodDate(settStart)} – ${formatPeriodDate(settEnd)}`,
    advancePeriod:    `${formatPeriodDate(advStart)} – ${formatPeriodDate(advEnd)}`,
  };
}

function matchDayforcePeriods(frBeginDate: string | null | undefined): DayforcePeriodMatch | null {
  if (!frBeginDate) return null;
  const normalized = normalizePeriodDate(frBeginDate);
  if (!normalized) return null;
  // Check known exact mappings first
  const known = KNOWN_PERIOD_MAPPINGS.find((m) => m.frBeginDate === normalized);
  if (known) return known;
  // Fall back to formula-computed mapping
  try {
    return computeDayforcePeriods(normalized);
  } catch {
    return null;
  }
}

// ============================================
// Dayforce Parser
// ============================================
async function parseDayforce(
  images: string[],
  mimeType: string,
  apiKey: string
): Promise<DayforceData> {
  console.log('[PayAudit] Parsing Dayforce, images:', images.length);

  const imageContent = images.slice(0, 4).map((b64) => ({
    type: 'image_url' as const,
    image_url: {
      url: `data:${mimeType};base64,${b64}`,
      detail: 'high' as const,
    },
  }));

  const prompt = `You are analyzing a UPS Dayforce pay stub document (official payroll statement from UPS/Dayforce HCM system).

Extract pay earnings line items and summary amounts. Field names on the document may vary in spacing or capitalization.

Look for these earnings lines (may appear as rows in an earnings table):
- OVER GUARANTEE (hours and dollar amount)
- UNDER GUARANTEE (dollar amount, usually a deduction)
- JUNIOR 150% or JA 150% (hours and dollar amount - this is Junior Assignment pay)
- PREMIUM PAY (hours and dollar amount)
- ADV NEXT PAY (advance amount)
- DOMICILE PDM TX or DOM PDM (domicile per diem taxable)
- DMSTIC PDM TX or DOMESTIC PDM (domestic per diem taxable)
- VACATION or VAC (hours and dollar amount)

Also look for:
- Pay rate (hourly rate, often shown near pilot name or at top of stub)
- Pay period dates (start and end)
- Gross Pay (total gross earnings)
- Net Pay (total net/take-home after deductions)

CRITICAL: Return null for any field not clearly present. Do NOT default to 0 for missing line items.

Return ONLY valid JSON with no extra text:
{
  "payPeriodStart": "string or null",
  "payPeriodEnd": "string or null",
  "payRate": number or null,
  "advNextPay": number or null,
  "overGuaranteeHours": number or null,
  "overGuaranteeAmount": number or null,
  "underGuarantee": number or null,
  "juniorHours": number or null,
  "juniorAmount": number or null,
  "premiumPayHours": number or null,
  "premiumPayAmount": number or null,
  "domicilePdmTx": number or null,
  "dmsticPdmTx": number or null,
  "vacationHours": number or null,
  "vacationAmount": number or null,
  "grossPay": number or null,
  "netPay": number or null
}`;

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }, ...imageContent],
        },
      ],
      max_tokens: 600,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('[PayAudit] OpenAI error parsing DF:', response.status, err);
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content ?? '';
  console.log('[PayAudit] DF raw response:', content.substring(0, 500));

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn('[PayAudit] Could not parse JSON from DF response');
    return emptyDayforce();
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Partial<DayforceData>;
    const asNum = (v: unknown): number | null =>
      typeof v === 'number' ? v : null;
    return {
      payPeriodStart: (parsed.payPeriodStart as string | null) ?? null,
      payPeriodEnd: (parsed.payPeriodEnd as string | null) ?? null,
      payRate: asNum(parsed.payRate),
      advNextPay: asNum(parsed.advNextPay),
      overGuaranteeHours: asNum(parsed.overGuaranteeHours),
      overGuaranteeAmount: asNum(parsed.overGuaranteeAmount),
      underGuarantee: asNum(parsed.underGuarantee),
      juniorHours: asNum(parsed.juniorHours),
      juniorAmount: asNum(parsed.juniorAmount),
      premiumPayHours: asNum(parsed.premiumPayHours),
      premiumPayAmount: asNum(parsed.premiumPayAmount),
      domicilePdmTx: asNum(parsed.domicilePdmTx),
      dmsticPdmTx: asNum(parsed.dmsticPdmTx),
      vacationHours: asNum(parsed.vacationHours),
      vacationAmount: asNum(parsed.vacationAmount),
      grossPay: asNum(parsed.grossPay),
      netPay: asNum(parsed.netPay),
    };
  } catch (e) {
    console.error('[PayAudit] JSON parse error for DF:', e);
    return emptyDayforce();
  }
}

function emptyDayforce(): DayforceData {
  return {
    payPeriodStart: null,
    payPeriodEnd: null,
    payRate: null,
    advNextPay: null,
    overGuaranteeHours: null,
    overGuaranteeAmount: null,
    underGuarantee: null,
    juniorHours: null,
    juniorAmount: null,
    premiumPayHours: null,
    premiumPayAmount: null,
    domicilePdmTx: null,
    dmsticPdmTx: null,
    vacationHours: null,
    vacationAmount: null,
    grossPay: null,
    netPay: null,
  };
}

// ============================================
// Multi-Stub Dayforce Parser
// Asks OpenAI to return an ARRAY of stubs when
// multiple separate pay stubs are detected.
// ============================================
async function parseDayforceAsMultipleStubs(
  images: string[],
  mimeType: string,
  apiKey: string
): Promise<DayforceData[]> {
  console.log('[PayAudit] Parsing Dayforce as multi-stub, images:', images.length);

  const imageContent = images.slice(0, 6).map((b64) => ({
    type: 'image_url' as const,
    image_url: {
      url: `data:${mimeType};base64,${b64}`,
      detail: 'high' as const,
    },
  }));

  const prompt = `You are analyzing one or more UPS Dayforce pay stub documents. These images may contain a SINGLE pay stub (possibly spanning multiple pages) or MULTIPLE separate pay stubs from different pay periods.

Examine the images carefully:
- If all images belong to a SINGLE pay stub (same pay period), return an array with ONE object.
- If images contain MULTIPLE separate stubs with DIFFERENT pay period dates, return an array with ONE object per stub.

For each stub, extract:
- Pay period start and end dates
- Pay rate (hourly rate)
- ADV NEXT PAY (advance amount)
- OVER GUARANTEE hours and dollar amount
- UNDER GUARANTEE dollar amount
- JUNIOR 150% or JA 150% hours and dollar amount
- PREMIUM PAY hours and dollar amount
- DOMICILE PDM TX / DOM PDM amount
- DMSTIC PDM TX / DOMESTIC PDM amount
- VACATION hours and dollar amount
- Gross Pay total
- Net Pay total

CRITICAL: Return null for any field not clearly present. Do NOT default to 0.

Return ONLY a valid JSON ARRAY (even for a single stub):
[
  {
    "payPeriodStart": "string or null",
    "payPeriodEnd": "string or null",
    "payRate": number or null,
    "advNextPay": number or null,
    "overGuaranteeHours": number or null,
    "overGuaranteeAmount": number or null,
    "underGuarantee": number or null,
    "juniorHours": number or null,
    "juniorAmount": number or null,
    "premiumPayHours": number or null,
    "premiumPayAmount": number or null,
    "domicilePdmTx": number or null,
    "dmsticPdmTx": number or null,
    "vacationHours": number or null,
    "vacationAmount": number or null,
    "grossPay": number or null,
    "netPay": number or null
  }
]`;

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }, ...imageContent],
        },
      ],
      max_tokens: 1200,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('[PayAudit] OpenAI error parsing DF multi-stub:', response.status, err);
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content ?? '';
  console.log('[PayAudit] DF multi-stub raw response:', content.substring(0, 800));

  // Extract JSON array from response
  const arrayMatch = content.match(/\[[\s\S]*\]/);
  if (!arrayMatch) {
    console.warn('[PayAudit] Could not parse JSON array from multi-stub DF response');
    return [emptyDayforce()];
  }

  try {
    const parsedArray = JSON.parse(arrayMatch[0]) as Array<Partial<DayforceData>>;
    if (!Array.isArray(parsedArray) || parsedArray.length === 0) {
      return [emptyDayforce()];
    }

    const asNum = (v: unknown): number | null =>
      typeof v === 'number' ? v : null;

    return parsedArray.map((parsed) => ({
      payPeriodStart: (parsed.payPeriodStart as string | null) ?? null,
      payPeriodEnd: (parsed.payPeriodEnd as string | null) ?? null,
      payRate: asNum(parsed.payRate),
      advNextPay: asNum(parsed.advNextPay),
      overGuaranteeHours: asNum(parsed.overGuaranteeHours),
      overGuaranteeAmount: asNum(parsed.overGuaranteeAmount),
      underGuarantee: asNum(parsed.underGuarantee),
      juniorHours: asNum(parsed.juniorHours),
      juniorAmount: asNum(parsed.juniorAmount),
      premiumPayHours: asNum(parsed.premiumPayHours),
      premiumPayAmount: asNum(parsed.premiumPayAmount),
      domicilePdmTx: asNum(parsed.domicilePdmTx),
      dmsticPdmTx: asNum(parsed.dmsticPdmTx),
      vacationHours: asNum(parsed.vacationHours),
      vacationAmount: asNum(parsed.vacationAmount),
      grossPay: asNum(parsed.grossPay),
      netPay: asNum(parsed.netPay),
    }));
  } catch (e) {
    console.error('[PayAudit] JSON parse error for multi-stub DF:', e);
    return [emptyDayforce()];
  }
}

// ============================================
// Comparison Engine
// ============================================
function buildComparison(
  fr: FlightRegisterData,
  df: DayforceData,
  payRate: number
): PayAuditComparison {
  // JA: UNKNOWN when FR JA is not found — null ≠ zero, never assume missing JA is 0
  const frJaDecimal: number | null =
    fr.jaHours != null
      ? hhmmToDecimal(fr.jaHours) + hhmmToDecimal(fr.ja2Hours)
      : null;

  const jaStatus: 'found' | 'not_found' | 'low_confidence' =
    fr.jaHours != null ? 'found' : 'not_found';

  // JA hour comparison — only valid when FR JA is found
  const dfJuniorHours = df.juniorHours ?? 0;
  const jaHourDifference: number | null =
    frJaDecimal != null ? frJaDecimal - dfJuniorHours : null;

  // Expected JA pay — only when FR JA is found
  const jaExpectedPay: number | null =
    frJaDecimal != null ? frJaDecimal * payRate * 1.5 : null;

  // Actual JA pay from Dayforce
  const jaActualPay: number | null =
    df.juniorAmount != null
      ? df.juniorAmount
      : df.juniorHours != null
        ? df.juniorHours * payRate * 1.5
        : null;

  // Dollar difference — only when both sides are known
  const jaDollarDifference: number | null =
    jaExpectedPay != null && jaActualPay != null
      ? jaExpectedPay - jaActualPay
      : null;

  // Over guarantee comparison
  const frEndCredit = hhmmToDecimalOrNull(fr.endingPayCredit);
  const dfOverGuaranteeHours = df.overGuaranteeHours ?? 0;
  const frOverGuaranteeHours =
    frEndCredit != null ? Math.max(0, frEndCredit - BASE_GUARANTEE_HOURS) : 0;
  const overGuaranteeDifference = frOverGuaranteeHours - dfOverGuaranteeHours;

  // Base guarantee expected
  const baseGuaranteeExpected = BASE_GUARANTEE_HOURS * payRate;

  // Gross pay difference — only when Dayforce gross is known and JA is known.
  // Use bucket-based expected gross: guarantee + JA + premium + PDM.
  // Do NOT use frEndCredit * payRate — that stacks credit-based pay on top of
  // payroll buckets and double-counts JA and Premium already embedded in credit.
  let grossPayDifference: number | null = null;
  if (df.grossPay != null && jaExpectedPay != null) {
    const frEstimatedGross =
      BASE_GUARANTEE_HOURS * 2 * payRate +
      jaExpectedPay +
      (fr.premiumPayAmountDollars ?? 0) +
      (fr.overGuaranteeAmountDollars ?? 0) -
      (fr.underGuaranteeAmountDollars ?? 0) +
      (fr.taxablePdmAmountDollars ?? 0);
    grossPayDifference = frEstimatedGross - df.grossPay;
  }

  // Pay period match check
  const periodsMatch = checkPayPeriodsMatch(fr, df);

  return {
    jaHourDifference,
    jaDollarDifference,
    jaExpectedPay,
    jaActualPay,
    overGuaranteeDifference,
    grossPayDifference,
    baseGuaranteeExpected,
    jaStatus,
    periodsMatch,
  };
}

// ============================================
// Match Scoring (out of 100)
// ============================================
function computeMatchScore(
  fr: FlightRegisterData,
  df: DayforceData,
  comparison: PayAuditComparison
): number {
  // Mismatched periods → score 0 (handled separately as a gated status)
  if (comparison.periodsMatch === false) return 0;

  let score = 0;

  // === 50 pts: Dayforce earnings internally consistent ===
  let dfScore = 50;
  if (df.juniorHours != null && df.payRate != null && df.juniorAmount != null) {
    const expectedJunior = df.juniorHours * df.payRate * 1.5;
    const discrepancy = Math.abs(expectedJunior - df.juniorAmount);
    if (discrepancy > 50) dfScore -= 20;
    else if (discrepancy > 10) dfScore -= 8;
  }
  if (
    df.overGuaranteeHours != null &&
    df.payRate != null &&
    df.overGuaranteeAmount != null
  ) {
    const expectedOG = df.overGuaranteeHours * df.payRate;
    const discrepancy = Math.abs(expectedOG - df.overGuaranteeAmount);
    if (discrepancy > 50) dfScore -= 15;
    else if (discrepancy > 15) dfScore -= 5;
  }
  score += Math.max(0, dfScore);

  // === 30 pts: FR totals align with Dayforce ===
  // Only deduct when the comparison is actually valid (not unknown)
  let frScore = 30;
  if (fr.jaHours != null && comparison.jaHourDifference != null) {
    const jaHourDiff = Math.abs(comparison.jaHourDifference);
    if (jaHourDiff <= JA_HOUR_TOLERANCE) frScore -= 0;
    else if (jaHourDiff <= 0.5) frScore -= 8;
    else if (jaHourDiff <= 1.0) frScore -= 15;
    else frScore -= 20;
  }
  // Over guarantee — only score when FR ending credit is known
  if (fr.endingPayCredit != null) {
    const ogDiff = Math.abs(comparison.overGuaranteeDifference);
    if (ogDiff <= 0.1) frScore -= 0;
    else if (ogDiff <= 1.0) frScore -= 5;
    else frScore -= 10;
  }
  score += Math.max(0, frScore);

  // === 20 pts: App pay summary directional match ===
  let appScore = 20;
  if (comparison.grossPayDifference != null) {
    const gpDiff = Math.abs(comparison.grossPayDifference);
    if (gpDiff <= 50) appScore -= 0;
    else if (gpDiff <= 200) appScore -= 5;
    else if (gpDiff <= 500) appScore -= 10;
    else appScore -= 15;
  }
  score += Math.max(0, appScore);

  return Math.min(100, Math.max(0, Math.round(score)));
}

function getMatchStatus(
  score: number,
  comparison: PayAuditComparison,
  df: DayforceData
): PayAuditMatchStatus {
  // Gate 1: Mismatched pay periods — immediate stop, no comparison
  if (comparison.periodsMatch === false) return 'mismatched_periods';

  // Gate 2: JA not found in FR but Dayforce has junior pay → unable to verify
  if (
    comparison.jaStatus === 'not_found' &&
    df.juniorHours != null &&
    df.juniorHours > 0
  ) {
    return 'unable_to_verify';
  }

  // Gate 3: Low score but no valid comparisons were made → unable to verify
  // (prevents false discrepancy when score only reflects Dayforce internal math)
  if (
    score < 75 &&
    comparison.jaHourDifference == null &&
    comparison.grossPayDifference == null
  ) {
    return 'unable_to_verify';
  }

  // Standard score-based statuses (reached only when comparisons were valid)
  if (score >= 97) return 'paid_correctly';
  if (score >= 90) return 'mostly_matched';
  if (score >= 75) return 'possible_discrepancy';
  return 'likely_issue';
}

// ============================================
// Findings Builder
// ============================================
function buildFindings(
  fr: FlightRegisterData,
  df: DayforceData,
  comparison: PayAuditComparison,
  isMultiStubCombined = false
): string[] {
  const findings: string[] = [];

  // Note when multiple stubs were combined
  if (isMultiStubCombined) {
    findings.push('Multiple Dayforce stubs combined: pay period values summed across contiguous stubs.');
  }

  // JA hours — only compare when FR JA is found
  if (fr.jaHours) {
    const frJaDec = hhmmToDecimal(fr.jaHours);
    const dfJuniorHrs = df.juniorHours ?? 0;
    findings.push(
      `JA credit on Flight Register: ${fr.jaHours} (${frJaDec.toFixed(2)} hrs)`
    );
    if (df.juniorHours != null) {
      findings.push(`Dayforce Junior 150%: ${dfJuniorHrs.toFixed(2)} hrs`);
      if (comparison.jaHourDifference != null) {
        const diff = Math.abs(comparison.jaHourDifference);
        if (diff > JA_HOUR_TOLERANCE) {
          findings.push(
            `Hour difference: ${comparison.jaHourDifference > 0 ? '+' : ''}${comparison.jaHourDifference.toFixed(2)} hrs — possible underpayment`
          );
        } else {
          findings.push('JA hours align within tolerance');
        }
      }
    } else {
      findings.push('No Junior 150% line found in Dayforce');
    }
  } else if (df.juniorHours != null && df.juniorHours > 0) {
    // Dayforce has junior pay but FR JA was not found — cannot verify
    findings.push(
      `Junior 150% found on Dayforce (${df.juniorHours.toFixed(2)} hrs), but JA was not found in Flight Register`
    );
  }

  // JA dollar estimate — only when both sides are known
  if (
    comparison.jaDollarDifference != null &&
    comparison.jaDollarDifference > 5 &&
    comparison.jaExpectedPay != null &&
    comparison.jaActualPay != null
  ) {
    findings.push(
      `Expected Junior pay: $${comparison.jaExpectedPay.toFixed(2)} — Dayforce shows: $${comparison.jaActualPay.toFixed(2)}`
    );
  }

  // Over guarantee
  if (fr.endingPayCredit && df.overGuaranteeHours != null) {
    const frOG = Math.max(
      0,
      hhmmToDecimal(fr.endingPayCredit) - BASE_GUARANTEE_HOURS
    );
    if (Math.abs(comparison.overGuaranteeDifference) > 0.1) {
      findings.push(
        `Over guarantee: FR shows ${frOG.toFixed(2)} hrs, Dayforce shows ${df.overGuaranteeHours.toFixed(2)} hrs`
      );
    } else {
      findings.push('Over guarantee hours match');
    }
  }

  if (fr.endingPayCredit) {
    findings.push(`Ending pay credit (FR): ${fr.endingPayCredit}`);
  }

  if (df.grossPay != null) {
    findings.push(`Dayforce gross pay: $${df.grossPay.toFixed(2)}`);
  }

  if (fr.dutyDays != null) {
    findings.push(`Duty days logged: ${fr.dutyDays}`);
  }

  if (df.premiumPayAmount != null && df.premiumPayAmount > 0) {
    findings.push(`Premium pay present: $${df.premiumPayAmount.toFixed(2)}`);
  }

  return findings;
}

// ============================================
// Summary Builder
// ============================================
function buildSummary(
  status: PayAuditMatchStatus,
  comparison: PayAuditComparison,
  fr: FlightRegisterData,
  df: DayforceData,
  isMultiStubCombined = false
): string {
  const multiNote = isMultiStubCombined ? ' (combined across multiple Dayforce stubs)' : '';

  if (status === 'mismatched_periods') {
    return 'Flight Register and Dayforce are from different pay periods. Upload matching documents to run Pay Audit.';
  }

  if (status === 'unable_to_verify') {
    if (
      comparison.jaStatus === 'not_found' &&
      df.juniorHours != null &&
      df.juniorHours > 0
    ) {
      return 'Junior 150% was found on Dayforce, but a matching JA value was not confidently extracted from Flight Register.';
    }
    return 'Not enough high-confidence data was available for a full audit. Review the extracted fields below.';
  }

  const diff =
    comparison.jaDollarDifference != null
      ? Math.abs(comparison.jaDollarDifference)
      : 0;

  if (status === 'paid_correctly') {
    return `Flight Register, Dayforce, and app data are in close alignment. Pay appears to be accurate based on available data${multiNote}.`;
  }

  if (status === 'mostly_matched') {
    if (diff > 5) {
      return `Pay is largely consistent${multiNote}, though a small variance of approximately $${diff.toFixed(2)} was detected. Review recommended.`;
    }
    return `Pay is largely consistent${multiNote}. Minor variance detected — review when convenient.`;
  }

  if (status === 'possible_discrepancy') {
    if (
      fr.jaHours &&
      comparison.jaHourDifference != null &&
      comparison.jaHourDifference > JA_HOUR_TOLERANCE
    ) {
      return `Flight Register shows additional Junior Assignment time not fully reflected in Dayforce${multiNote}. Estimated difference: ~$${diff.toFixed(2)}.`;
    }
    if (comparison.overGuaranteeDifference > 0.1) {
      return `Over-guarantee hours on Flight Register appear higher than what Dayforce reflects${multiNote}. Review the comparison details.`;
    }
    return `A discrepancy was detected between Flight Register and Dayforce${multiNote}. Review the details below.`;
  }

  // likely_issue
  return `Significant difference detected between Flight Register and Dayforce pay${multiNote}. Estimated variance: ~$${diff.toFixed(2)}. Recommend detailed review.`;
}

// ============================================
// Main Entry Point
// ============================================
export async function analyzePayDocuments(params: {
  flightRegisterImages: string[];
  dayforceImages: string[];
  mimeType?: string;
  profileHourlyRateCents: number;
  profilePosition: string | null;
  profileBase: string | null;
}): Promise<PayAuditResult> {
  const {
    flightRegisterImages,
    dayforceImages,
    mimeType = 'image/jpeg',
    profileHourlyRateCents,
    profilePosition,
    profileBase,
  } = params;

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw new Error('OpenAI API key not configured');
  }

  const payRate = profileHourlyRateCents / 100;
  console.log('[PayAudit] Starting analysis, payRate=$' + payRate);

  let fr: FlightRegisterData;
  let df: DayforceData;
  let isMultiStubCombined = false;

  if (dayforceImages.length > 1) {
    // Multi-image Dayforce: ask OpenAI to detect separate stubs in one call
    const [frResult, dfStubs] = await Promise.all([
      parseFlightRegister(flightRegisterImages, mimeType, openaiKey),
      parseDayforceAsMultipleStubs(dayforceImages, mimeType, openaiKey),
    ]);
    fr = frResult;

    if (dfStubs.length > 1) {
      // Multiple stubs detected — check if they can be combined to cover the FR window
      const canCombine = checkMultiStubCoversFR(dfStubs, fr);
      if (canCombine) {
        console.log(`[PayAudit] Combining ${dfStubs.length} contiguous Dayforce stubs`);
        df = mergeDayforceStubs(dfStubs);
        isMultiStubCombined = true;
      } else {
        // Stubs are not contiguous or don't cover FR range — use first stub and let
        // the period mismatch gate report the issue
        console.log('[PayAudit] Multi-stub coverage check failed — using first stub for comparison');
        df = dfStubs[0]!;
      }
    } else {
      // Single stub returned even though multiple images — treat as normal
      df = dfStubs[0] ?? emptyDayforce();
    }
  } else {
    // Single image — use existing single-stub parse
    [fr, df] = await Promise.all([
      parseFlightRegister(flightRegisterImages, mimeType, openaiKey),
      parseDayforce(dayforceImages, mimeType, openaiKey),
    ]);
  }

  // Use Dayforce pay rate if available
  const effectivePayRate =
    df.payRate != null && df.payRate > 0 ? df.payRate : payRate;

  // Build comparison (includes pay period gate + JA unknown state)
  const comparison = buildComparison(fr, df, effectivePayRate);

  // Score — conservative, no penalty for missing data
  const matchScore = computeMatchScore(fr, df, comparison);
  const matchStatus = getMatchStatus(matchScore, comparison, df);

  // Findings and summary
  const findings = buildFindings(fr, df, comparison, isMultiStubCombined);
  const summary = buildSummary(matchStatus, comparison, fr, df, isMultiStubCombined);

  // Estimated difference — only show when source data is valid
  // If JA is unknown, do not compute a fake dollar discrepancy
  const estimatedDifference =
    comparison.jaDollarDifference != null && comparison.jaDollarDifference > 0
      ? comparison.jaDollarDifference
      : comparison.grossPayDifference != null && comparison.grossPayDifference > 0
        ? comparison.grossPayDifference
        : 0;

  console.log(
    `[PayAudit] Done — score=${matchScore} status=${matchStatus} diff=$${estimatedDifference.toFixed(2)} jaStatus=${comparison.jaStatus} periodsMatch=${comparison.periodsMatch} multiStub=${isMultiStubCombined}`
  );

  return {
    matchScore,
    matchStatus,
    estimatedDifference,
    summary,
    findings,
    flightRegister: fr,
    dayforce: df,
    appData: {
      payRate: effectivePayRate,
      position: profilePosition,
      base: profileBase,
    },
    comparison,
  };
}

// ============================================
// Flight Register Only Audit (v3)
// Replaces Dayforce with manual paycheck entry
// ============================================

const MONTHLY_GUARANTEE_HOURS = 75;
// UPS pays guarantee as 2 × 37.5 (settlement + advance)
const HALF_GUARANTEE_HOURS = 37.5;

// ============================================
// Gross Calculation — Bucket Logic (v5)
//
// Expected Gross = (Settlement + Advance entered by user)
//                + JA at 150% (only when FR has explicit dollar amount)
//                + Premium Pay (only when FR has explicit dollar amount)
//                + Over/Under Guarantee Adjustment (only from FR dollar amounts)
//                + Taxable PDM (only from FR dollar amounts)
//
// IMPORTANT: JA and Premium are ALREADY EMBEDDED in the settlement/advance
// Dayforce checks. They must NOT be computed from credit hours and stacked
// on top of the guarantee base — that double-counts them.
//
// Ending Pay Credit is informational only and is never used as a pay base.
// ============================================
function calculateExpectedGrossBuckets(
  fr: FlightRegisterData,
  hourlyRateCents: number,
  enteredSettlementCents: number,
  enteredAdvanceCents: number,
): {
  expectedGrossCents: number;
  guaranteeCents: number;
  jaCents: number;
  premiumPayCents: number;
  overUnderCents: number;
  taxablePdmCents: number;
  jaHours: number;
  totalCreditHours: number;
  usedBucketLogic: boolean;
} {
  // JA hours — informational only (for display/comparison), NOT used in gross calc
  const jaDecimal = hhmmToDecimal(fr.jaHours);
  const endCredit = hhmmToDecimalOrNull(fr.endingPayCredit) ?? MONTHLY_GUARANTEE_HOURS;

  // A. Guarantee base = contract formula: 2 × 37.5 hrs × hourly rate.
  //    This is always computed from the contract, never from entered amounts.
  //    Entered amounts are the comparison target, not the expected calculation base.
  const guaranteeCents = Math.round(HALF_GUARANTEE_HOURS * hourlyRateCents) * 2;

  // B. JA — ONLY add when the FR has an explicit dollar amount that is NOT
  //    already reflected in the entered settlement/advance. When jaAmountDollars
  //    is null the JA is assumed to be correctly embedded in the guarantee base.
  const jaCents = fr.jaAmountDollars != null
    ? Math.round(fr.jaAmountDollars * 100)
    : 0;

  // C. Premium Pay — only when FR has explicit dollar amount not in guarantee base
  const premiumPayCents = fr.premiumPayAmountDollars != null
    ? Math.round(fr.premiumPayAmountDollars * 100)
    : 0;

  // D. Over/Under Guarantee net adjustment (from FR parsed dollar amounts)
  const overGuaranteeCents = fr.overGuaranteeAmountDollars != null
    ? Math.round(fr.overGuaranteeAmountDollars * 100)
    : 0;
  const underGuaranteeCents = fr.underGuaranteeAmountDollars != null
    ? Math.round(fr.underGuaranteeAmountDollars * 100)
    : 0;
  const overUnderCents = overGuaranteeCents - underGuaranteeCents;

  // E. Taxable PDM inside earnings
  const taxablePdmCents = fr.taxablePdmAmountDollars != null
    ? Math.round(fr.taxablePdmAmountDollars * 100)
    : 0;

  // Bucket logic is considered active when any FR dollar amount was explicitly found
  const usedBucketLogic =
    fr.jaAmountDollars != null ||
    fr.premiumPayAmountDollars != null ||
    fr.overGuaranteeAmountDollars != null ||
    fr.underGuaranteeAmountDollars != null ||
    fr.taxablePdmAmountDollars != null;

  const expectedGrossCents = guaranteeCents + jaCents + premiumPayCents + overUnderCents + taxablePdmCents;

  console.log(
    `[PayAudit] Bucket calc: guarantee(entered)=$${(guaranteeCents/100).toFixed(2)} JA(explicit)=$${(jaCents/100).toFixed(2)} premium=$${(premiumPayCents/100).toFixed(2)} over/under=$${(overUnderCents/100).toFixed(2)} pdm=$${(taxablePdmCents/100).toFixed(2)} total=$${(expectedGrossCents/100).toFixed(2)}`
  );

  return {
    expectedGrossCents,
    guaranteeCents,
    jaCents,
    premiumPayCents,
    overUnderCents,
    taxablePdmCents,
    jaHours: jaDecimal,
    totalCreditHours: endCredit,
    usedBucketLogic,
  };
}

function getAuditStatus(differenceCents: number): PayAuditResult['auditStatus'] {
  const absDiff = Math.abs(differenceCents);
  if (absDiff <= 50)    return 'paid_correctly';        // ≤$0.50 — Exact Match
  if (absDiff <= 2000)  return 'minor_variance';        // ≤$20
  if (absDiff <= 10000) return 'review_recommended';    // ≤$100
  if (absDiff <= 50000) return 'possible_discrepancy';  // ≤$500
  return 'likely_issue';                                // >$500
}

function buildAuditSummary(
  status: PayAuditResult['auditStatus'],
  differenceCents: number,
  comparisonMode: 'gross' | 'net'
): string {
  const diffDollars = Math.abs(differenceCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
  const modeLabel = comparisonMode === 'net' ? 'net pay (based on your saved Pay Summary settings)' : 'gross pay';
  switch (status) {
    case 'paid_correctly':
      return `Exact Match — Flight Register and selected Dayforce gross checks align.`;
    case 'minor_variance':
      return `Minor variance of $${diffDollars} detected comparing ${modeLabel}. Values are closely aligned — may be rounding or minor adjustments.`;
    case 'review_recommended':
      return `Review Recommended — a variance of $${diffDollars} was found comparing ${modeLabel}. Check that you used the correct Dayforce stub dates.`;
    case 'possible_discrepancy':
      return `Possible Discrepancy — a notable difference of $${diffDollars} was found comparing ${modeLabel}. Selected checks may not fully match this register.`;
    case 'likely_issue':
      return `Likely Pay Issue — a significant difference of $${diffDollars} was detected comparing ${modeLabel}. Consider reviewing with your union representative.`;
    default:
      return `Comparison complete. Difference: $${diffDollars}.`;
  }
}

// ============================================
// Process FR Only (step 1: parse + match dates, no audit math)
// ============================================
export async function processFlightRegisterOnly(params: {
  flightRegisterImages: string[];
  mimeType?: string;
}): Promise<{
  flightRegister: FlightRegisterData;
  matchedSettlementPeriod: string | null;
  matchedAdvancePeriod: string | null;
  matchedSettlementPayDate: string | null;
  matchedAdvancePayDate: string | null;
}> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error('OpenAI API key not configured');

  const fr = await parseFlightRegister(params.flightRegisterImages, params.mimeType ?? 'image/jpeg', openaiKey);
  const matched = matchDayforcePeriods(fr.payPeriodStart);

  console.log(`[PayAudit] FR processed — payPeriodStart=${fr.payPeriodStart}, matched=${!!matched}`);

  return {
    flightRegister: fr,
    matchedSettlementPeriod: matched?.settlementPeriod ?? null,
    matchedAdvancePeriod: matched?.advancePeriod ?? null,
    matchedSettlementPayDate: matched?.settlementPayDate ?? null,
    matchedAdvancePayDate: matched?.advancePayDate ?? null,
  };
}

export async function analyzeFlightRegisterOnly(params: {
  flightRegisterImages: string[];
  mimeType?: string;
  profileHourlyRateCents: number;
  profilePosition: string | null;
  profileBase: string | null;
  settlementAmountCents: number;
  advanceAmountCents: number;
  comparisonMode: 'gross' | 'net';
  taxProfile: TaxProfile | null;
  deductions: Deduction[];
}): Promise<PayAuditResult> {
  const {
    flightRegisterImages,
    mimeType = 'image/jpeg',
    profileHourlyRateCents,
    profilePosition,
    profileBase,
    settlementAmountCents,
    advanceAmountCents,
    comparisonMode,
    taxProfile,
    deductions,
  } = params;

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error('OpenAI API key not configured');

  console.log(`[PayAudit] FR-only analyze, rate=$${profileHourlyRateCents / 100}, mode=${comparisonMode}`);

  // Parse Flight Register
  const fr = await parseFlightRegister(flightRegisterImages, mimeType, openaiKey);

  // Calculate expected gross using bucket logic (v4)
  const {
    expectedGrossCents,
    guaranteeCents,
    jaCents,
    premiumPayCents,
    overUnderCents,
    taxablePdmCents,
    jaHours,
    totalCreditHours,
  } = calculateExpectedGrossBuckets(fr, profileHourlyRateCents, settlementAmountCents, advanceAmountCents);

  // Calculate estimated net using saved tax settings
  let estimatedNetCents = expectedGrossCents;
  if (taxProfile) {
    try {
      const breakdown = calculateNetPay(expectedGrossCents, taxProfile, deductions);
      estimatedNetCents = breakdown.netPayCents;
    } catch (e) {
      console.warn('[PayAudit] Tax calculation failed, using gross as net estimate:', e);
    }
  }

  // Entered total
  const enteredTotalCents = settlementAmountCents + advanceAmountCents;
  const expectedComparisonCents = comparisonMode === 'net' ? estimatedNetCents : expectedGrossCents;
  const auditDifferenceCents = expectedComparisonCents - enteredTotalCents;
  const auditStatus = getAuditStatus(auditDifferenceCents);
  const auditSummary = buildAuditSummary(auditStatus, auditDifferenceCents, comparisonMode);

  // Match Dayforce periods from FR begin date
  const periodMatch = matchDayforcePeriods(fr.payPeriodStart);

  // Key findings
  const findings: string[] = [];
  if (fr.endingPayCredit) findings.push(`Ending Pay Credit: ${fr.endingPayCredit}`);
  if (jaHours > 0) findings.push(`JA: ${fr.jaHours ?? fr.ja2Hours} (${jaHours.toFixed(2)} hrs @ 150%)`);
  findings.push(`Guarantee: 2 × 37.5 hrs × $${(profileHourlyRateCents / 100).toFixed(2)}/hr`);
  if (premiumPayCents > 0) findings.push(`Premium Pay: $${(premiumPayCents / 100).toFixed(2)}`);
  if (overUnderCents !== 0) findings.push(`Over/Under Guarantee net: $${(overUnderCents / 100).toFixed(2)}`);
  if (taxablePdmCents > 0) findings.push(`Taxable PDM in earnings: $${(taxablePdmCents / 100).toFixed(2)}`);
  if (fr.dutyDays != null) findings.push(`Duty days: ${fr.dutyDays}`);
  findings.push(`Comparison mode: ${comparisonMode === 'net' ? 'Net (uses your saved tax & deduction settings)' : 'Gross'}`);

  // Legacy comparison fields for backward compat
  const comparison: PayAuditComparison = {
    jaHourDifference: jaHours > 0 ? jaHours : null,
    jaDollarDifference: jaCents > 0 ? jaCents / 100 : null,
    jaExpectedPay: jaCents > 0 ? jaCents / 100 : null,
    jaActualPay: null,
    overGuaranteeDifference: 0,
    grossPayDifference: null,
    baseGuaranteeExpected: guaranteeCents / 100,
    jaStatus: jaHours > 0 ? 'found' : 'not_found',
    periodsMatch: true,
  };

  // Build match score (legacy field, derived from auditStatus)
  const matchScore =
    auditStatus === 'paid_correctly'    ? 100 :
    auditStatus === 'minor_variance'    ? 82 :
    auditStatus === 'review_recommended'? 62 :
    auditStatus === 'possible_discrepancy' ? 40 : 20;

  const matchStatus: PayAuditMatchStatus =
    auditStatus === 'paid_correctly'    ? 'paid_correctly' :
    auditStatus === 'minor_variance'    ? 'mostly_matched' :
    auditStatus === 'review_recommended'? 'mostly_matched' :
    auditStatus === 'possible_discrepancy' ? 'possible_discrepancy' : 'likely_issue';

  console.log(`[PayAudit] FR-only done — expectedGross=$${(expectedGrossCents/100).toFixed(2)} estimatedNet=$${(estimatedNetCents/100).toFixed(2)} entered=$${(enteredTotalCents/100).toFixed(2)} diff=$${(auditDifferenceCents/100).toFixed(2)} status=${auditStatus}`);

  return {
    matchScore,
    matchStatus,
    estimatedDifference: Math.abs(auditDifferenceCents / 100),
    summary: auditSummary,
    findings,
    flightRegister: fr,
    dayforce: emptyDayforce(),
    appData: {
      payRate: profileHourlyRateCents / 100,
      position: profilePosition,
      base: profileBase,
    },
    comparison,
    expectedGrossCents,
    estimatedNetCents,
    enteredSettlementCents: settlementAmountCents,
    enteredAdvanceCents: advanceAmountCents,
    comparisonMode,
    auditDifferenceCents,
    auditStatus,
    auditSummary,
    // v4 — matched Dayforce periods + gross breakdown
    matchedSettlementPeriod: periodMatch?.settlementPeriod ?? null,
    matchedAdvancePeriod: periodMatch?.advancePeriod ?? null,
    matchedSettlementPayDate: periodMatch?.settlementPayDate ?? null,
    matchedAdvancePayDate: periodMatch?.advancePayDate ?? null,
    expectedGrossBreakdown: {
      guaranteeCents,
      jaCents,
      premiumPayCents,
      overUnderCents,
      taxablePdmCents,
    },
  };
}
