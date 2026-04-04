# Pilot Pay Tracker

## Web App — Connected to Live Backend (stabilization pass 2026-04-01)

### Architecture
The web app at `/web` connects to the **same backend** used by the mobile app. No duplicate business logic — shared code lives in `/shared`.

### Data Connections by Page

| Page | Endpoints | Shared Logic |
|------|-----------|--------------|
| Dashboard | `GET /api/dashboard`, `GET /api/profile`, `GET /api/trips` | — |
| Trips | `GET /api/trips?startDate=&endDate=` | Uses canonical `tripDutyDays` for display |
| Pay Summary | `GET /api/trips`, `GET /api/profile` | UPS guarantee floor (75hr/month), small/big check split |
| Settings | `GET /api/profile`, `GET /api/profile/stats` | — |
| Career | `GET /api/projections`, `GET /api/pay-benchmarks/*`, `GET /api/lifetime-earnings`, `POST /api/projections/goal`, `POST /api/projections/what-if` | `@shared/retirementEngine` (pension, Plan B, VEBA forecasts) |

### How it works
- **Dev**: Vite proxy forwards `/api/*` to `localhost:3000` (same backend)
- **Auth**: Cookie-based sessions via Better Auth (same as mobile)
- **Types**: `@shared/contracts` for API types, `@shared/retirementEngine` for retirement logic
- **No duplication**: All pay calculations, projections, benchmarks come from the backend

### Testing each page
1. **Dashboard** — Sign in via `/login`, verify gross pay, credit hours, recent flights
2. **Trips** — Navigate months, expand trip cards, verify duty days and legs
3. **Pay Summary** — Toggle small/big check, verify guarantee calculations
4. **Settings** — Verify profile info, career stats (all-time, trips)
5. **Career** — Check benchmarks, projections, upgrade simulator, retirement tab

---

## TestFlight & Signing Full Fix (2026-03-29)

### All issues resolved

**Backend URL** — `https://royal-jewel.vibecode.run`
All env vars (`EXPO_PUBLIC_CLOUD_BACKEND_URL`, `EXPO_PUBLIC_VIBECODE_BACKEND_URL`, `EXPO_PUBLIC_BACKEND_URL`, `BACKEND_URL`) unified to `royal-jewel.vibecode.run` in `eas.json` and `.env.production`.

**TestFlight signing blocked** — Added `ITSAppUsesNonExemptEncryption: false` to `infoPlist` in `app.json`. Without this key Apple blocks build processing for export compliance.

**Entitlement mismatch** — Added `expo-notifications` to the `plugins` array in `app.json`. The `UIBackgroundModes: remote-notification` claim requires the APS entitlement, which EAS only injects when the plugin is registered.

**URL scheme conflict** — Changed `scheme` from generic `vibecode` (Vibecode platform default) to app-specific `pilotpaytracker`. Updated `authClient.ts` and `auth.ts` trusted origins accordingly. Legacy `vibecode://` entries kept for backwards compatibility.

**Apple Review account bypass gaps** — `tester@pilotpaytracker.app` and `reviewpaid@pilotpaytracker.app` added to all four bypass lists:
  - `mobile/src/lib/appleReviewBypass.ts`
  - `backend/src/routes/subscription.ts`
  - `backend/src/routes/profile.ts`
  - `backend/src/lib/review-accounts-seed.ts` (already had all four)

**Trusted origins missing `https://`** — Wildcard origins (`*.vibecode.run`, etc.) in `auth.ts` updated to include the `https://` protocol prefix.

**Rate limiting disabled** — Re-enabled Better Auth's built-in rate limiter (20 requests / 60-second window).

### How to test sign-in in TestFlight
- **Automatic**: Each new build number forces fresh sign-in automatically
- **Manual**: Settings → Support & Feedback → Diagnostics → Force Sign Out & Clear All Data

### Apple Review credentials
| Email | Password |
|---|---|
| `review@pilotpaytracker.app` | `PilotPay!2026` |
| `reviewer@pilotpaytracker.app` | `PilotPay!2026` |
| `reviewpaid@pilotpaytracker.app` | `PilotPay!2026` |
| `tester@pilotpaytracker.app` | `TestFlight2026!` |

---

## TestFlight & Apple Review Readiness Audit (2026-03-22)

### Critical fixes applied

1. **Password Reset Hasher Mismatch (FIXED)** — Password reset was using `bcryptjs` instead of Better Auth's `hashPassword`. Users who reset their password could not sign back in. Now uses the same hasher as Better Auth.

2. **Password Reset Security (FIXED)** — Reset code was returned in the API response body, enabling account takeover. Code is now only stored server-side.

3. **Apple Review Bypass on Subscription Endpoint (FIXED)** — `GET /api/subscription/status` now returns `hasPremiumAccess: true` for all Apple Review accounts (`review@`, `reviewer@`, `reviewpaid@`). Previously only the profile endpoint had the bypass, leaving a window where review accounts saw `inactive`.

4. **Review Account Seed Status (FIXED)** — Primary review account `review@pilotpaytracker.app` was seeded with `subscriptionStatus: "inactive"`. Now seeded as `"active"` with a 2030 expiration.

5. **Admin Subscription Endpoint (FIXED)** — `POST /api/subscription/admin/set-status` allowed any authenticated user to set their own subscription to `active`, bypassing payment. Now restricted to admin emails only.

6. **Debug Logging Removed (FIXED)** — Sign-in/sign-up debug middleware that logged raw request bodies (including emails and hex dumps) has been removed for production.

7. **SplashScreen Never Hidden (FIXED)** — `SplashScreen.preventAutoHideAsync()` was called but `hideAsync()` was never called. Added `SplashScreen.hideAsync()` in the AuthProvider once auth state resolves.

8. **useSession Refetch No-Op (FIXED)** — `useSession().refetch()` was a no-op empty function with a stale Supabase comment. Now properly invalidates the auth-session query.

9. **Paywall Dynamic Pricing (FIXED)** — Hardcoded prices ($9.99/$99), savings percentage (17%), and trial duration (7-day) are now dynamically computed from RevenueCat package data.

10. **Health Endpoint DB Path Leak (FIXED)** — `/api/health` no longer exposes the database file path.

---

## Retirement Forecast — Real Earnings Integration (2026-03)

### What changed
The Retirement section now fetches and uses **real year-by-year earnings** from the Lifetime Earnings section to power all retirement calculations.

**Before:** All forecasts (Plan A pension FAE, Plan B contributions) used pay-table estimates only, giving "ESTIMATE" confidence.

**After:**
- `RetirementSection` fetches `/api/lifetime-earnings` via React Query (shared cache with LifetimeEarningsSection)
- All 3 forecast computations (`computeRetirementForecast`, `computeDualScenarioForecast`, `computeMultiAgeForecast`) receive the real earnings as `earningsLedger`
- Years with actual earnings data show `ACTUAL` badge; estimated years show `ESTIMATED`
- FAE (Final Average Earnings) for Plan A pension now uses real earnings when available → significant pension accuracy improvement
- Plan B contributions also use actual comp for tracked years
- Auto-populates `priorEarnings` from finalized lifetime earnings years on first load (computes average, estimates prior years before tracking start)

**New UI components:**
1. `EarningsDataBanner` — amber warning when no data, green prompt when partial data (<3 years); taps navigate to Earnings section
2. `EarningsLedgerCard` — shows each year with ACTUAL/ESTIMATED badge + FAE indicator for last 5 years; inline CTA to add more data
3. "How Calculated" modal now shows real vs estimated year count
4. Career screen passes `onNavigateToEarnings` to `RetirementSection`

**Confidence levels:**
- ESTIMATE: 0 years actual (pay table only)
- MEDIUM: 1-2 years actual
- HIGH: 3+ years actual

---

## Trips — Layover Time & Completion Badge Fixes (2026-03)

### Problem 1: Trip badge showed "SCHEDULED" for completed trips
`getTripStatus()` in `TripBreakdownCard.tsx` previously only returned `'complete'` when all
OOOI (Out/Off/On/In) times were recorded. Trips in the past without actuals showed "SCHEDULED".

**Fix:** Added end-date check — if `trip.endDate < today`, status returns `'complete'` regardless
of actuals. Verified still shows needsReview / sick / verified when those conditions apply.

---

### Problem 2: ATL layover showed wrong time (e.g. 33:34 instead of 16:48)

**Root cause — display layer:**
Both `LayoverSection` (TripBreakdownCard) and `LayoverCard` (CanonicalTripBreakdown) were
computing the countdown from `nextDutyStartISO`. For overnight duties the importer was storing
`reportTimeISO` with the wrong calendar date (e.g. `2026-03-12T22:46` instead of
`2026-03-11T21:46`), causing countdown to show 33+ hours.

**Display fix:** Countdown now uses `prevDutyEndISO + restMinutes` as the authoritative
rest-end anchor. `restMinutes` is parsed directly from the pairing's `Rest: HH:MM` line and
is always correct. `nextDutyStartISO` is no longer used for the countdown calculation.

**Root cause — import pipeline:**
In `canonical-import-pipeline.ts`, `reportTimeISO` was always built as
`effectiveStartDate + reportTime`. For overnight duties where report is late evening (≥ 20:00)
and the first flight departs early morning (< 12:00), the report actually falls on the
**previous calendar day**.

**Import fix:** In `canonical-import-pipeline.ts` line ~1323 — if `reportHour >= 20` and
`firstLegHour < 12`, subtract 1 day from `reportDate` before building `reportTimeISO`.
This correctly handles all future schedule uploads with overnight duty start times.

## Pay Summary — UPS Payroll-Accurate Estimation Engine (Updated 2026-03, Tightened Net Pay)

### Contract Guarantee Logic (2026-03)
The Pay Summary (Settlement / Big Check view) now shows a **Contract Guarantee Summary** card that implements UPS bid-period guarantee logic:

**Formulas:**
- `paidHours = max(lineCredit, guaranteeHours)`
- `bufferPayHours = max(guaranteeHours - lineCredit, 0)`

**Period type → guarantee hours:**
- 28-day bid period → **75.0 hrs** guarantee
- 35-day bid period → **96.0 hrs** guarantee

Period type is read from `profile.creditCapPeriodType` (set in Credit Cap settings). Defaults to 28-day.

**UI card** (`GuaranteeBreakdownCard`):
- Shows: Line Credit / Guarantee / Paid Hours / Buffer Pay
- If pilot is on guarantee (credit < guarantee): amber highlight + explanation banner
- Tapping the card opens a tooltip explaining guarantee & buffer pay
- Only shown on Settlement (Big Check) view with real trip data

**Key functions in `pay-check-logic.ts`:**
- `calculateGuaranteeBreakdown(lineCreditHours, periodType)` — core math
- `resolveBidPeriodType(raw)` — normalises "28-DAY" / "28_DAY" / "28" variants
- `GUARANTEE_HOURS_BY_PERIOD` — constant map `{ '28_DAY': 75.0, '35_DAY': 96.0 }`

### Overview
The Pay Summary screen now uses a materially more accurate payroll estimation engine aligned to real UPS Dayforce paystubs.

### Earnings Breakdown (UPS Dayforce Aligned)
- **Guarantee Settlement** (`guarantee-settlement`): 37.5 hrs × hourly rate = Advance Next Pay
- **Over Guarantee** (`over-guarantee`): Only shown if credit minutes > 75-hr monthly guarantee
- **Premium Pay** (`premium-pay`): Junior Assignment 150%, JA, overrides — only if non-zero
- **Per Diem (Non-Taxable)** (`per-diem`): Only shown if actual TAFB data exists — NOT assumed
- **Adjustments** (`adjustments`): Only shown if non-zero

### Deductions Order (UPS Payroll Accurate)
Following actual UPS Dayforce payroll order:
1. **Taxable Benefits** (amber): Excess Life — adds to taxable wages
2. **Pre-Tax Deductions** (blue): Pretax Flex, VEBA — reduces taxable wages
3. **Taxes** (red): Federal W/H, FICA (6.2%), Medicare (1.45%), State
4. **Post-Tax Deductions** (orange): LTD, Mutual Aid, Union Dues, Roth 401(k)

### Net Pay Formula (Tightened 2026-03)
```
taxableWages = grossTaxable + taxableBenefits - preTaxDeductions
federal = taxableWages × effectiveFederalRate  (from tax settings, or bracket estimate)
fica    = taxableWages × 6.2%  (YTD SS wage cap aware)
medicare= taxableWages × 1.45%
estimatedNetPay = grossTaxable + grossNonTaxable(perDiem) - preTaxDeductions - federal - fica - medicare - [state] - postTaxDeductions
```
All deductions shown in the breakdown are actually subtracted in the final net pay card.
`lastBreakdown.netPayCents` (API) is no longer used for final net pay — local computation always wins so UPS-specific deductions are guaranteed to flow through.

### Learned Deduction Profile
- **Default values** from real UPS paystub sample: Pretax Flex $221.57, VEBA $74.00, Excess Life $2.08, LTD $154.61, Mutual Aid $110.00, Union Dues $131.02
- **Learning engine**: As users upload real paystubs, `PayrollProfile` table stores rolling averages
- **Confidence labels**: "none" → "low" → "medium" → "high" based on paystub count (0/1/2-3/4+)
- **API**: `GET /api/payroll-profile` returns current learned profile

### Key Files
- `mobile/src/app/pay-summary.tsx` — Main screen with `allDeductions` useMemo
- `mobile/src/lib/pay-check-logic.ts` — `generateBigCheckEarnings`, `calculateBigCheckBreakdown`
- `backend/src/services/payroll-profile-service.ts` — Learned profile service
- `backend/src/routes/payroll-profile.ts` — API route
- `backend/src/services/pay-statement-mirror.ts` — Paystub parser (UPS Dayforce aligned)

### Validation Target
Real UPS paystub (2026-02-23): Gross $8,734.88, Pre-tax $295.57, FICA $523.36, Medicare $122.40, Post-tax $395.63, Net $6,220.50
Our estimate accuracy (MFJ filing): Net $6,185.88 = 0.56% off — excellent.



## Credit Cap Engine — UPS Contract Credited Time Limits

### Location
`shared/CreditCapEngine.ts` — pure functions, no UI imports

### Architecture
- **Single source of truth** for all UPS contract cap math
- Period types: `BID_56` (208 hr cap / 192 OT gate), `BID_28` (104/96), `PAY_35` (130/120)
- RDG limits: DOMESTIC +5 hrs, INTERNATIONAL +7 hrs over awarded line
- Exclusions (vacation, training, junior manning, CRAF, sick leave) — off-cap but still pay
- Vacation drop cap relief — effective cap += dropped trips credit when enabled
- Trip completion overage — allowed when trip departed domicile (toggle-gated)
- Status outputs: `ACHIEVABLE`, `NOT_ACHIEVABLE_WITH_OT`, `EXCEEDS_CAP_BLOCKED`, `EXCEEDS_CAP_ALLOWED_TRIP_COMPLETION`

### Key functions
- `getPeriodLimits(periodType)` — caps
- `evaluateCreditedTimeStatus(inputs)` — full evaluation with warnings
- `applyOpenTimeClamp(inputs)` — clamp OT before any pay math
- `computeMaxOpenTimeAllowed(inputs)` — max OT per contract
- `buildCapInputsFromPrefs(prefs, requestedOT)` — profile → engine inputs
- `formatDecimalToHHMM(hours)` / `formatHHMMToDecimal(str)` — display helpers

### Integration
- **Annual Pay Planner** (`mobile/src/app/annual-pay-planner.tsx`): compact Contract Limits (Auto) summary card (default) + Contract Limits Details panel (tap to expand). Line credit auto-populated from schedule trips. Manual override available.
- **Backend planner** (`backend/src/routes/annual-planner.ts`): Open Time clamped per engine before scenario math
- **Profile** (`backend/prisma/schema.prisma`): `creditCap*` fields persisted on Profile model
- **Unit tests**: `shared/CreditCapEngine.test.ts` — run with `bun run shared/CreditCapEngine.test.ts`

### UI/UX Pattern (Annual Pay Planner)
- **Default view**: compact `ContractLimitsSummaryCard` showing status pill, auto line credit from schedule, max Open Time allowed, and comparison row when limited
- **Tap "View Contract Details"**: expands `ContractLimitsDetailsPanel` with period type, RDG toggle, collapsed Exclusions/Exceptions accordions, and trimmed/full breakdown toggle
- **Auto line credit**: `awardedLineCredit` auto-populated from `SUM(trip.payCreditMinutes)` of current-year trips. Toggle "Override schedule credit" to enter manually.
- **Terminology**: Always use "Open Time" and "Junior Assignment (JA)" — never "OT"

## Critical Fix: Block/Credit Minutes Always 0 After Import (Fixed)

### Root Cause
The AI parser (gpt-4o-mini) returns `"blockMinutes": 0` and `"creditMinutes": 0` as template defaults, even when it could not read the Block column from the schedule image. The old code treated any explicitly-provided value (including 0) as authoritative, so the times-based fallback (`computeBlockFromTimes`) never ran.

### Fix — `backend/src/lib/canonical-import-pipeline.ts`
Both `normalizeAIParsedData` (new path) and the legacy path now treat `blockMinutes = 0` the same as missing: if `blockMinutes` is 0 and departure/arrival times are present, compute block from those times. Only a value `> 0` from the AI is trusted.

Same change for `creditMinutes`: if `creditMinutes` is 0, fall back to `blockMinutes` (not to AI's explicit 0).

### Fix — `backend/src/lib/upload-job-processor.ts`
Improved AI prompt with explicit `BLOCK/CREDIT TIME RULES` section instructing GPT-4o-mini to:
- Read the `Block` column per flight row and convert H:MM → total minutes
- Read the `Credit Time` footer for trip totals
- Never leave `blockMinutes: 0` when a visible block value exists

### Result
- `plannedBlockMinutes` and `plannedCreditMinutes` on `TripDutyLeg` are now populated from dep/arr times when the AI doesn't extract them
- Duty day and trip-level totals (`blockMinutes`, `creditMinutes`, `totalBlockMinutes`, `totalCreditMinutes`) automatically aggregate from the corrected leg values
- `Est. Pay` in the trip card now shows the correct value based on real credit minutes


- `src/lib/api.ts`, `src/lib/authClient.ts`, and `src/app/(tabs)/trips.tsx` all hardcode the production backend URL as `https://repost-overpay.vibecode.run`
- This is the fallback used in TestFlight/App Store builds where `EXPO_PUBLIC_VIBECODE_BACKEND_URL` is not available
- **Always keep this URL up to date** — wrong URL causes all API calls to silently fail in production

## Retirement Forecast v3 — CBA 2023–2028 Locked, Full Pilot UX

### Location
Career tab → **Retirement** section

### Architecture
- **Engine**: `src/lib/state/retirement-store.ts` — CBA 2023–2028 locked calculation engine
  - `RetirementProfile` — dob, doh, retirementAge, earningsBasis (GUAR/LINE/TOTAL), expectedUpgradeYear, priorEarnings, outsideAssets, planBGrowthRatePct, safeWithdrawalRatePct, stopHRAAtMedicare
  - `computeRetirementForecast(profile, rules, overrideAge?, earningsLedger?)` — full forecast output
  - `computeMultiAgeForecast(profile, rules, ages)` — multiple retirement ages (55,57–63,65)
  - `computeDualScenarioForecast(profile, overrideAge?)` — FO-only vs Upgrade-to-Captain side by side
  - Contract rules locked to `CBA_RULESET_VERSION = "CBA 2023–2028"`
  - Plan B: 12% employer-only; Plan A: MAX(1%×FAE×YOS, flat $3,360–$4,200/YOS)
  - VEBA/HRA: $1/paid hour → $6,250/yr per participant, NOT cash, stops at Medicare

- **Component**: `src/components/career/RetirementSection.tsx`
  - Auto-seeds DOB/DOH from pilot profile on mount and profile changes
  - **All values come from the engine — UI never implements pension formulas**

### UI Cards (in order)
1. **Retirement Paycheck** (hero) — Net Monthly (lead, large) + Gross Monthly + Gross Annual; integrity validation badge; ⓘ info tooltip; "How calc'd" audit modal
2. **Income Breakdown** — Plan A Pension (Guaranteed), Plan B Withdrawal (SWR%), HRA Medical (Not Cash) — monthly + annual per row, tappable contract detail modals
3. **Retirement Assets** — Plan B balance (asset, not income), annual withdrawal at SWR%, outside assets toggle
4. **One-Time Payouts** — Sick leave payout (one-time only, NEVER in annual income totals)
5. **Medical Coverage (New)** — HRA annual benefit × participants (1–3 selector), "Not Cash" badge, Medicare note
6. **Can I Retire at 60?** — Status badge (YES/MAYBE/NOT YET), net monthly at 60, lifestyle thresholds (Middle Class/Upper/Luxury/Ultra Luxury), longevity risk (from SWR), Financial Independence Age estimate
7. **Retirement Age Scenarios** — Age 55 (Reduced)/60/62/65 chips; shows net monthly + gross monthly per scenario
8. **Career Path Impact** — FO Only vs Upgrade toggle; side-by-side net monthly, gross annual, upgrade advantage (+$/mo +$/yr net)
9. **Plan B Growth Chart** — two-line chart (FO vs Upgrade path), upgrade marker, year labels
10. **Contract Engine Badge** — expandable, shows all contract rules + rates

### Assumptions Editor (Edit button)
- Retirement age (55/60/62/65), DOB, DOH
- Career path + upgrade year
- Earnings basis (GUAR/LINE/TOTAL)
- Plan B growth rate (3/5/7%)
- Safe withdrawal rate (3/4/5%)
- Tax estimate (25/30/35%)
- HRA participants (1–3), stop-at-Medicare toggle + age

### Integrity Validation
- Pension monthly must equal annual/12 (±$0.01 tolerance) — shows error banner if mismatch
- HRA is NEVER included in spendable net cash (always labeled "Not Cash")
- Plan B balance shown as ASSET only; only withdrawals shown as income
- Sick leave payout shown as ONE-TIME only, never in annual income totals
- "How Calculated" modal shows full audit: YOS, FAE, formulas used, SWR, tax rate, ruleset version

### Display Units — ALL monetary values stored and computed in CENTS
- `fmtDollarsLong(cents)` → "$1,234" (direct cents display)
- `fmtDollars(cents)` → "$1.2K" or "$1.20M" (short format)
- `fmtMonthly(annualCents)` → divides by 12, formats in cents
- Never multiply cents × 100 before passing to fmt functions

### Lifestyle Thresholds (cents, editable constants)
- Middle Class: $8,000/mo = 800,000 cents
- Upper Middle: $15,000/mo = 1,500,000 cents
- Luxury: $25,000/mo = 2,500,000 cents
- Ultra Luxury: $40,000/mo = 4,000,000 cents

### MAYBE Status Logic
- YES: net monthly ≥ Middle Class ($8K/mo)
- MAYBE: net monthly ≥ 85% of Middle Class threshold ($6,800/mo)
- NOT YET: below MAYBE range

### Key Design Decisions
- UI layer NEVER implements pension formulas or contract rules (Phase 1 engine only)
- HRA excluded from net cash paycheck; shown only in Medical Coverage card + income breakdown (labeled Not Cash)
- Sick leave never added to annual totals
- Plan B shown as asset balance; only SWR withdrawal shown as income
- FI Age computed across ages 55,57,58,59,60,61,62,63,65 for granularity

### Legal Safety
Disclaimer: "Estimates only. Calculation engine locked to CBA 2023–2028. Not HR, legal, or financial advice. Verify with UPS HR and ALPA."



### Location
Career tab → **Retirement** section

### Architecture
- **Store**: `src/lib/state/retirement-store.ts` — Zustand + AsyncStorage persisted store (key: `retirement-profile-storage-v3`)
  - `RetirementProfile` — dob, doh, retirementAge, **earningsBasis** (GUAR/LINE/TOTAL), **expectedUpgradeYear**, priorEarnings, outsideAssets
  - **No more `seatHistory` or manual income** — income is derived from pay tables automatically
  - `UPS_PAY_TABLES` — embedded official UPS Contract Extension TA 2025 pay table (FO + Captain, Y1–Y15)
  - `getPayTableAnnualComp(year, doh, seat, basis)` — single source of truth for projected income
  - `getPayStepYear(calendarYear, doh)` — maps calendar year → pay step (DOH anniversary, cap 15)
  - `ContractRetirementRules` — versioned rules with effectiveDate, planB rates, pensionAnnualPerYOS, vebaPerHourCents, hraAnnualPostRetireCents, wording blocks
  - `UPS_CONTRACT_RULES`:
    - CBA 2023–2028: 19% Plan B (13%+6%), $1,800/mo/YOS pension, $6,250/yr HRA post-retire, $1/hr VEBA
    - CBA 2028 (Projected): 21% Plan B (14%+7%), ~$2,160/mo/YOS pension
  - `computeRetirementForecast(profile, rules, overrideAge?, earningsLedger?)` — pay-table-driven, EarningsLedger takes priority for known years
  - `computeMultiAgeForecast(profile, rules, [60,62,65])` — all three ages in one call
  - `buildScenario(profile, label, upgradeYear)` — upgrade timing impact with pay-table-derived CPT income
  - Confidence level: HIGH (≥3 actual years), MEDIUM (≥1), ESTIMATE (projected only)

- **Component**: `src/components/career/RetirementSection.tsx`
  - **Auto-populates DOB/DOH from Pilot Profile** — syncs on mount and on profile change
  - **No manual captain income field** — derived from pay table at upgrade year
  - Setup modal: Step 1 (Profile/DOB/DOH/age chips), Step 2 (Earnings basis + upgrade year + live pay-table preview)
  - Upgrade year default: DOH + 7 years (editable; staffing-aware)
  - Three-pillar hero: Pension (Plan A) + Plan B (4% SWR) + HRA ($6,250/yr contract)
  - Confidence badge: High / Medium / Estimate
  - Contract detail panels: tap (i) on any plan → "What the contract says" + "How we calculate it" + contract version
  - Contract versioning badge: expandable, shows both contracts + pay table metadata
  - Upgrade impact section: Early / Mid-Career / Late scenarios, delta vs baseline
  - Graph: Plan B growth timeline with upgrade marker and contract-switch marker
  - Contract version badge: shows which contract applies per year, expandable rates table
  - Career Impact Simulation: Early/Mid/Late Upgrade vs Current Path, diff shown
  - Prior Earnings banner: prompts user to add pre-app years to improve accuracy
  - Plan B growth timeline graph (View-based, no SVG)
  - Outside assets toggle (adds 4% SWR of outside assets to total)
  - Setup modal: 2-step (Profile → Career), "Auto" badges on pre-filled fields

### Key Design Decisions
- Historical earnings tied to original contract version (frozen)
- Future projections auto-switch on contractVersion effectiveDate (year-by-year)
- 5% annual growth assumption on Plan B
- 4% sustainable withdrawal rate for Plan B retirement income display
- Pension = min(YOS, 30) × pensionAnnualPerYOS
- VEBA accrues flat per YOS (not income-based)
- UPS 75 hrs/month guarantee used as baseline income for fallback + income estimation
- Total retirement income = Plan B SWR + pension + (optional) outside assets SWR
- VEBA displayed separately (lump sum, not annual income — covers healthcare)

### Legal Safety
Disclaimer: "All retirement projections are estimates... This is not HR, legal, or financial advice. Always consult UPS HR and ALPA for official plan details."

> **V1 Launch Ready**: This app helps UPS pilots understand and verify their pay, not replace payroll or their union. Core features: Pay Rules, Editable Trips, Schedule Import, Pay Confidence, and UPS CBA Integration.

## Benchmarks ↔ Annual Pay Planner Deep Integration (FLAGSHIP)

### Architecture: Shared YearPlan Entity

**YearPlan** is the single shared object that links Benchmarks ("Truth Layer") and Annual Pay Planner ("Planning Layer"):

- **Database**: `year_plan` table (SQLite via Prisma)
- **Backend routes**: `/api/year-plan/active`, `/api/year-plan/upsert`, `/api/year-plan/update-guarantee`, `/api/year-plan/snapshot`
- **Mobile hook**: `src/lib/useYearPlan.ts`

**Key fields**:
- `targetAnnualIncomeCents` — user's income goal
- `hourlyRateCents` — from profile, editable in Planner
- `monthlyGuaranteeHours` — default 75, editable in Benchmarks (syncs to YearPlan)
- `jaMultiplier` — 1.5 (150%)
- `includeJA` — user toggle
- `planningMode` — CONSERVATIVE / BALANCED / AGGRESSIVE
- `planHealth` (computed) — STRONG / WATCH / AT_RISK (math only, no enforcement language)

### Annual Pay Planner Changes (Phase 2)

- "Set as My {year} Target" CTA now **upserts YearPlan** (in addition to legacy SavedPlannerScenario)
- Screen pre-fills target from existing active YearPlan on load
- JA multiplier = 1.5 enforced throughout all calculations

### Annual Pay Planner — Bid Period Primary + Equivalents Hierarchy (Phase 7)

**BID PERIOD is the single authoritative planning timeframe.** Monthly and Pay Period are displayed as equivalents (conversions only), never as separate requirements.

**UI Hierarchy (new render order):**
1. `TargetSelector` — income goal
2. `ResultCard` — feasibility badge
3. Rolling Baseline Toggle — OFF by default (75-hr guarantee); ON uses rolling 90-day avg if available
4. **`BidPeriodPrimaryCard`** (PRIMARY HERO): "This Bid Period Target" — `+{adjBidBase}` credit hrs at font-size 48. Contains the full "How to Fly This Target" section with inline JA share picker.
5. **`EquivalentPaceSection`** (secondary): Monthly + Pay Period conversions with helper text "These are conversions of the same requirement."
6. `PaceIntensityCard` — intensity gauge vs normal variability
7. `WhatYouNeedCard`, `BestLeverCard`, `PayBreakdownCard`, `WhatIfCard`, `SaveCTA`, `DetailsDrawer`

**Baseline rules:**
- Default: `baseline_month = 75.0`, `baseline_bid = 75.0 × (28/30) ≈ 70.0`, `baseline_pay = server value`
- Optional toggle "Use my actual pace (rolling avg)": uses server's `baselineBidPeriodHours` when `baselineSource === "rolling_90_day"`
- If rolling avg unavailable when toggle is ON, shows: "Using 75-hr guarantee baseline (not enough YTD data for a stable pace)."
- NEVER shows 70.0 or 22.0 as monthly baseline unless rolling avg computes to that

**BidPeriodPrimaryCard — "How to Fly This Target" section:**
- **Open Time (Base Rate)**: `+{adjBidBase}` credit hrs (OT) — sky blue
- **JA Equivalent (150%)**: `+{adjBidBase / 1.5}` JA hrs — purple, with note "JA hours have 1.5× pay value"
- **Mixed Strategy**: 5-button JA share picker (0/25/50/75/100%), computes `otPart = adj × (1-share)`, `jaPart = (adj × share) / 1.5` — emerald
- Footer note: "JA availability varies by base/seniority/staffing. These are value-equivalents only."

**Wording standards:**
- Title: "This Bid Period Target" (not "Required Adjustment")
- Subtitle: "Extra credit needed above 75-hr guarantee baseline"
- Baseline label: "Baseline (Guarantee): 75.0 hrs/month"
- Required pace label: "Goal pace needed"
- Info tooltip: "Bid Period is your actionable planning clock. Monthly and Pay Period are conversions of the same requirement."

**Career Benchmarks — Plan Card:**
- `YourPlanCard` now shown when active YearPlan exists, displaying Target + "This Bid Period" credit hrs target
- Contract source label uses `new Date().getFullYear()` dynamically (no hardcoded 2025)


### Benchmarks Changes (Phase 3)

When an active YearPlan exists for the current year, Benchmarks displays:
1. **Year Plan Card** — Target, Projected Annual, Gap vs Plan, From Today Forward pace, Plan Health badge, "Open Plan" CTA
2. **Next Best Action** — "+N credit hrs this bid period to stay on plan" (or JA equivalent)
3. **Why This Status** — 3 factual bullets (pace vs guarantee, months left, YTD progress)

### Sync Rules (Phase 4)

- Edit Monthly Guarantee Hours in Benchmarks → updates `year_plans.monthly_guarantee_hours` for active plan
- Plan Health recomputes on every snapshot fetch

### Legal Safety

All screens show verbatim footer:
> "Planning tools are estimates based on historical data and user inputs. They do not guarantee earnings, enforce contract rules, or provide legal advice."

### Non-negotiables

- Planning layer NEVER mutates pay records, trip credits, reserve credits, or statements
- No enforcement language (no "illegal/violation/guaranteed/impossible")
- "Highly Unlikely Under Current Conditions" not "Impossible"
- JA premium = 1.5x only when enabled by user toggle

---

## Authentication

**Auth Provider**: Supabase Auth (Single source of truth)

**Supabase Project**:
- URL: `https://oybexdpphsfnvarglgmx.supabase.co`
- Auth Features: Email/password signup, login, logout, password reset, session persistence

**Profile Loading (Auto-Creation on Auth)**:
- After successful auth (signup OR login), the profile is **auto-created immediately**
- Uses `ensureProfileExists()` utility with retry logic (2 attempts, 500ms delay)
- Backend `GET /api/profile` creates default profile if user is new
- Profile-setup screen only **updates** existing profile, never creates
- Shows loading screen with "Setting Up Your Account" while profile loads
- On failure, shows retry button instead of infinite loading
- 15-second timeout prevents infinite loading

**Current Phase**: Developer testing
- Email confirmation: OFF
- Apple Sign In: NOT YET (coming for Apple Review)
- SMTP: NOT YET

## TestFlight Debugging (Diagnostics Screen)

If authentication fails in TestFlight builds but works in preview:

1. **Access Diagnostics**: On the Welcome screen, tap the airplane logo **5 times quickly** to open the Diagnostics screen
2. **Run Tests**: Tap "Run Diagnostics" to verify:
   - Backend URL is correct (should show `https://repost-overpay.vibecode.run`)
   - Supabase project ref matches (should show `oybexdpphsfnvarglgmx`)
   - Client and Server Supabase configs match
   - All endpoints are reachable
3. **Screenshot results** if issues persist

### API Health Endpoint

**GET /api/health** - Returns detailed environment info for debugging:
```json
{
  "status": "ok",
  "envName": "preview-xxx | production | staging",
  "nodeEnv": "development | production",
  "apiBaseUrl": "https://...",
  "supabaseProjectRef": "oybexdpphsfnvarglgmx",
  "supabaseUrl": "https://xxx.supabase.co",
  "supabaseConfigSource": "environment | hardcoded",
  "build": { "version", "runtime", "nodeVersion" }
}
```

### Environment Configuration

**Frontend (.env)**:
- `EXPO_PUBLIC_VIBECODE_BACKEND_URL` - API base URL
- `EXPO_PUBLIC_SUPABASE_URL` - Supabase project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon key

**Backend (backend/.env)**:
- `SUPABASE_URL` - Supabase project URL (must match frontend)
- `SUPABASE_ANON_KEY` - Supabase anon key (must match frontend)

**IMPORTANT**: Both frontend and backend Supabase configs MUST point to the same project!

### Common Issues
- If "Env Variable Set" shows "No", the production build may be using the fallback URL
- All URLs must use HTTPS (iOS ATS requirement)
- Sign-in errors now show the actual error message instead of generic text
- **Supabase Mismatch**: If client and server use different Supabase projects, auth tokens won't validate

## App Store Submission

### Review Account Credentials

**Apple Review Account (AUTOMATIC PREMIUM BYPASS):**
- Email: `review@pilotpaytracker.app`
- Password: `PilotPay!2026`
- Behavior: **AUTOMATIC full premium access - NO paywall shown**
- This account has a hardcoded bypass that grants premium access without requiring subscription

### Apple Review Bypass System

The app includes an automatic bypass for the Apple Review account to ensure smooth App Store review:

**How it works:**
1. When the review account (`review@pilotpaytracker.app`) signs in, the app detects this email
2. All subscription checks automatically return "premium active"
3. No paywall is shown, no trial expiration, no subscription prompts
4. All premium features are fully unlocked

**Files implementing this:**
- `src/lib/appleReviewBypass.ts` - Core bypass logic and detection
- `src/lib/useSubscription.ts` - Hooks modified to check for review account
- `src/lib/SupabaseAuthProvider.tsx` - Logging when review account signs in
- `src/components/SubscriptionGate.tsx` - Uses bypass-aware hooks
- `src/app/paywall.tsx` - Uses bypass-aware hooks

**Debug Logging (visible in Expo logs):**
```
[AppleReviewBypass] ========================================
[AppleReviewBypass] REVIEW ACCOUNT DETECTED
[AppleReviewBypass] Email: review@pilotpaytracker.app
[AppleReviewBypass] reviewAccountDetected = true
[AppleReviewBypass] subscriptionBypassActive = true
[AppleReviewBypass] All premium features unlocked
[AppleReviewBypass] ========================================
```

**IMPORTANT:** This bypass ONLY applies to the exact email `review@pilotpaytracker.app`. All other users go through the normal subscription flow.

### Subscription Flow Verification (Regular Users)

1. **New user signup** → 7-day free trial starts automatically
2. **Trial expires** → Paywall displayed, must subscribe to continue
3. **Subscribe button** → Opens native Apple/Google purchase sheet
4. **Restore Purchases** → Checks for existing entitlements

### Pricing

- Monthly: $9.99/month
- Annual: $99/year (7-day free trial)

### Legal Pages (Required for App Store/Google Play Review)

These pages are served from your backend and will open when users tap the links:

- **Terms of Service**: `{BACKEND_URL}/terms`
- **Privacy Policy**: `{BACKEND_URL}/privacy`
- **Support**: Opens email to `support@pilotpaytracker.app`

The HTML files are located in `/backend/public/` directory.

### Support Link
Email: support@pilotpaytracker.app

## Schedule Upload Sources (Official Terminology)

The app supports three schedule upload sources with specific purposes:

### 1. Primary = Crew Access (Official Published Schedule)
- **When to use**: After your schedule is officially published
- **What it provides**:
  - Hotel information
  - Transportation information
  - Call Hotel and Call Transportation buttons unlock
- **This is your source of truth once published**

### 2. Secondary = Trip Board (Leg-by-Leg Detail)
- **When to use**: For leg-by-leg verification
- **What it provides**:
  - Credit confirmation
  - Detailed leg information
  - Supplements Primary data

### 3. Bid Award Technique = Trip Board Browser (Early Visibility)
- **When to use**: Immediately AFTER bids are awarded, BEFORE Crew Access publishes
- **How to use**:
  1. Open Trip Board in browser
  2. Click awarded trip line (e.g., Trip 118)
  3. Open each trip separately
  4. Screenshot each date
  5. Upload to app
- **Purpose**: Populate calendar early, track changes before official publish

## Help System & Tutorials

Every screen has a Help button that provides contextual tutorials:

### Features
- **Auto-open on first visit**: Tutorials automatically show the first time you visit each screen
- **Re-openable**: Tap the Help button (?) anytime to re-access the tutorial
- **Navigation**: Tutorials support Next, Back, Skip, and "Don't show again"
- **User-scoped**: Tutorial seen states are per-user and cleared on logout

### Tutorial Coverage
- Primary Upload (Crew Access)
- Secondary Upload (Trip Board)
- Bid Award Technique (Trip Board Browser)
- Pay Summary (Advance Pay vs Settlement Pay)
- Log Events
- Records / Audit Trail
- Career Stats
- Tools

## Advance Pay / Settlement Pay (Small Check / Big Check)

The Pay Summary now implements accurate UPS pilot pay behavior:

### Core Pay Structure

UPS pilots receive two distinct check types each month:

1. **Advance Pay (Small Check)**
   - Pays ONLY half of monthly guarantee (37.5 hours)
   - NO premium pay, NO per diem, NO adjustments
   - First advance before month-end reconciliation

2. **Settlement Pay (Big Check)**
   - Remaining half of guarantee (37.5 hours)
   - PLUS credit above 75-hour monthly guarantee
   - PLUS 100% of ALL premium pay (JA, Junior Man, overrides)
   - PLUS all per diem (taxable + non-taxable)
   - PLUS adjustments

### Pay Date Scheduling

Pay dates automatically determine expected check type:
- 1st pay date of month → BIG (Settlement)
- 2nd pay date of month → SMALL (Advance)
- 3rd pay date (if exists) → BIG (Settlement)

### Content-Based Confirmation

Statement content overrides date-based expectations:
- Premium pay > 0 → Always classified as Big Check
- Credit above guarantee > 0 → Big Check
- Displays "Expected" vs "Confirmed" status

### Net Pay Per Check

Net pay is calculated specifically for each check type:
- Small Check net = (37.5 hrs × hourly rate) - proportional deductions
- Big Check net = Full settlement amount - applicable deductions
- Helper text: "Based on your saved tax & deduction settings"

### Airline-Aware Configuration

The system is built airline-aware (not airline-hardcoded):
- UPS is the initial template
- `AirlinePayConfig` interface supports:
  - Monthly guarantee hours
  - Advance pay percentage
  - Premium allocation rules
  - Per diem allocation rules

### Implementation Files

- `src/lib/pay-check-logic.ts` - Core pay check type logic
- `src/app/pay-summary.tsx` - Updated Pay Summary UI
- `src/lib/state/profile-store.ts` - Airline selector

## Roster Change Detection & Pay Protection (NEW)

The app now includes a comprehensive system for detecting schedule changes and protecting pilot pay:

### Pay Protection Rule
- **Core Guarantee**: `pay_credit = max(protected_credit, current_credit)` — Company schedule changes can NEVER reduce your pay credit
- **Protected Credit**: Set once at first import (baseline v1), never decreases
- **Current Credit**: From the most recent uploaded schedule
- **Pay Credit**: The maximum of protected and current — always used for pay calculations

### Trip Version System
- Every schedule upload creates an immutable TripVersion (v1, v2, v3...)
- Baseline (v1) establishes your protected credit
- Subsequent versions are compared to detect changes
- Version history preserved permanently in audit trail

### Change Detection & Severity
- **Minor**: Auto-applied (hotel phone, minor layover changes)
- **Moderate**: Requires acknowledgment (time changes > 30 min, route changes)
- **Major**: Requires acknowledgment + premium candidate (legs removed, credit reduced)

### Premium Pay Detection
- System suggests Log Events for premium-eligible changes
- Never auto-claims — user must explicitly create and submit
- Categories: Pay Protection, Additional Flying, Duty Extension, Reassignment, Layover Premium

### User Interface
- **RosterChangeBanner**: Shows pending changes on trip cards
- **PayProtectionIndicator**: Shows when pay protection is active
- **ChangeAcknowledgmentModal**: Review and acknowledge changes
- **Records/Audit Trail**: Complete history of all changes and actions

## Phase 2: Schedule Imports as Source of Truth (NEW)

Schedule uploads are the SINGLE SOURCE for Trip creation and updates. This ensures data consistency across the app:

### How It Works
1. **Upload → Trip Creation**: Every schedule upload creates or updates a Trip record
2. **Trips Tab**: Immediately reflects the latest upload data
3. **Schedule View**: Visual representation derived from Trip data
4. **Records**: Shows "Schedule Uploaded" audit entry for each import
5. **Log Events**: Can be attached to trips for documenting schedule changes, reassignments, or premium pay events

### Key Principles
- **No Orphan Uploads**: All uploads must link to a Trip (enrichment-only uploads attach to most recent trip)
- **Audit Trail**: Every upload creates a "Schedule Uploaded" entry in Records/History
- **Trip Linkage**: Log Events are always attached to specific Trips, not standalone
- **Single Source**: Trips tab data comes exclusively from schedule imports (not manual entry)

### Log Events (Per-Trip Documentation)
- **Purpose**: Document schedule changes, crew calls, reassignments, and other pay-affecting events
- **Location**: Trip Detail Drawer → "Log Events" tab
- **Linked**: Every log event is attached to a specific trip
- **Evidence**: Supports proof attachments (screenshots, ACARS photos)
- **Audit**: All log events appear in Records/Audit Trail

## Phase 4: Trip Matching + Diff Engine + Severity (NEW)

Complete system for matching uploaded schedules to existing trips, detecting changes, and classifying severity.

### Trip Storage & Deduplication

**Database Table**: `trip` (Prisma model: `Trip`)

**Unique Constraints** (enforced at database level):
- `@@unique([userId, pairingId])` - Prevents duplicate pairings per user
- `@@unique([userId, matchKey])` - Prevents duplicate matchKeys per user

**Key Identifier Fields**:
| Field | Purpose | Example |
|-------|---------|---------|
| `id` | Internal primary key (cuid) | `clxyz123...` |
| `pairingId` | Preferred identifier from airline | `S50558` |
| `matchKey` | Composite fallback key | `SDF-2025-01-15-0600-5103` |
| `tripNumber` | Legacy/alternative identifier | `50558` |

**Import Idempotency**: Re-uploading the same schedule is now safe:
1. Unique constraints prevent duplicate trips at database level
2. Multi-tier matching finds existing trips before creating new ones
3. Race conditions handled with constraint violation retry logic

### Trip Matching Logic

**Match Priority Order:**
1. **Explicit Trip ID** - If provided, use directly
2. **Exact Pairing ID Match** (`S#####` format) - 100% confidence, auto-match
3. **Trip Number Match** - Fallback identifier
4. **Match Key Match** (`base-date-reportTime-firstFlight`) - 95% confidence
5. **Exact Date Range Match** - Same startDate AND endDate
6. **No Match** - Create new trip

**Match Keys:**
- Generated format: `{base}-{firstDutyDate}-{firstReportTime}-{firstFlightNumber}`
- Example: `SDF-2025-01-15-0530-2345`
- Used as fallback when pairingId is missing or not matched
- Stored on trip record for future dedup

**Date Validation**:
- `startDate` must be ≤ `endDate` (auto-corrected if reversed)
- Dates must be valid `YYYY-MM-DD` format (throws error otherwise)

### Diff Engine (Original vs Current)

Compares original roster snapshot (immutable) against new upload to detect:
- **Duty Day Changes**: Added/removed days (MAJOR)
- **Leg Changes**: Added/removed legs (MODERATE/MAJOR)
- **Route Changes**: Origin/destination changes (MODERATE)
- **Time Changes**: Departure/arrival/report/release shifts
- **Equipment Changes**: Aircraft type changes (MINOR)
- **Deadhead Status**: Operating ↔ Deadhead changes (MODERATE)
- **Credit Changes**: Total credit time differences

**Change Summary Format:**
- Human-readable "before → after" strings
- Examples:
  - `Day 1 Report: 05:30 → 06:15 (+0:45)`
  - `Day 2 Leg 3 Route: SDF-MIA → SDF-RFD`
  - `Total Credit: 4:30 → 5:15 (+0:45)`

### Severity Classification

| Severity | Criteria | Action |
|----------|----------|--------|
| `none` | No changes detected | No action |
| `minor` | Time shifts < 30 min, same routes/legs, equipment changes | Auto-apply |
| `moderate_ack` | Time shifts > 30 min, route changes, leg additions, deadhead changes | Requires acknowledgment |
| `major_ack` | Duty day added/removed, leg removed, credit change > 60 min | Requires acknowledgment |

### Snapshot Application Rules

1. **Original Snapshot** - Set ONLY ONCE on first upload (IMMUTABLE)
2. **Current Snapshot** - Updates on every matched upload
3. **Protected Credit** - Locked when original is set (used for pay protection)
4. **Current Credit** - Updates from latest upload

### Upload Processing Flow

```
Upload Image
    ↓
Parse Schedule Data
    ↓
Create Upload Record
    ↓
Find Matching Trip
    ├─ High Confidence (≥90%) → Auto-match
    ├─ Medium Confidence (70-90%) → Suggest with confirmation
    └─ Low Confidence (<70%) → User selection required
    ↓
Compare Snapshots (if matched)
    ↓
Classify Severity
    ↓
Update Trip (current snapshot, NOT original)
    ↓
Apply Acknowledgment Flags
```

### Backend Files

- `backend/src/lib/trip-matcher.ts` - Trip matching with confidence scoring
- `backend/src/lib/roster-diff-engine.ts` - Snapshot comparison and severity classification
- `backend/src/lib/upload-processor.ts` - Orchestrates the complete upload flow
- `backend/src/lib/trip-snapshot-manager.ts` - Manages original/current snapshots

### Key Functions

```typescript
// Trip Matching
findMatchingTrip(userId, parsedData) → MatchResult

// Diff Engine
compareRosterSnapshots(original, current) → Phase4DiffResult

// Upload Processing
processScheduleUpload(request) → UploadProcessResult
completeUploadWithConfirmedMatch(uploadId, tripId, userId) → UploadProcessResult

// Snapshot Management
setTripSnapshotsFromUpload(tripId, snapshotData) → SnapshotUpdateResult
createTripWithSnapshots(userId, tripData, snapshotData, uploadId) → Trip
```

## Phase 3: Data Model Lock (NEW)

Exact data model for Trips as source of truth, Upload history, and LogEvents.

### Trip Model (Enhanced)
- `id` - Internal unique identifier
- `pairingId` - Preferred identifier (e.g., S50558)
- `matchKey` - Fallback: base + first duty date + first report time + first flight number
- `baseFleet` - Base (optional if parsed)
- `startDate` - Local date for duty day 1
- `originalRosterSnapshot` - JSON: duty days + legs + times + credit (IMMUTABLE after first set)
- `currentRosterSnapshot` - JSON: latest roster data (updates on every upload)
- `protectedCreditMinutes` - From original upload (IMMUTABLE)
- `currentCreditMinutes` - From latest upload
- `payCreditMinutes` - max(protected, current) — ALWAYS used for pay calculations (Phase 5)
- `changeSummary` - Array of strings "before → after" (placeholder)
- `changeSeverity` - Enum: none | minor | moderate_ack | major_ack (placeholder)
- `acknowledgmentRequired` - Boolean (placeholder)
- `acknowledgedAt` - Timestamp (placeholder)
- `lastUploadId` - Foreign key to most recent Upload
- `premiumEventSuggestions` - Array of objects (placeholder)

### Upload Model (NEW)
- `id` - Internal unique identifier
- `userId` - Owner
- `sourceType` - "crew_access" | "trip_board"
- `imageUrl` - File reference
- `uploadedAt` - Timestamp
- `parseResultJson` - Raw parsed output
- `parseConfidence` - 0–1 score
- `trips` - Many-to-many relation to Trip

### LogEvent Model (NEW)
- `id` - Internal unique identifier
- `userId` - Owner
- `tripId` - REQUIRED foreign key (no standalone events)
- `eventType` - "premium" | "pay_protection" | "reassignment" | "duty_extension" | "late_arrival" | "other"
- `premiumCode` - e.g., "JA", "RA", "EXT", "LA", "LP1", "LP2", "RJA"
- `premiumMinutesDelta` - For fixed +HH:MM premiums (stored as minutes)
- `premiumMultiplier` - For LP1/LP2/RJA rules (e.g., 1.5, 2.5)
- `notes` - Auto-filled; editable
- `status` - "draft" | "saved" | "exported"
- `attachments` - Array of upload references

### Key Constraints
- `originalRosterSnapshot` + `protectedCreditMinutes` are set ONLY ONCE (first upload)
- `currentRosterSnapshot` + `currentCreditMinutes` update on every matched upload
- One Trip → many Uploads
- One Trip → many LogEvents
- Uploads must link to Trip(s) (no orphan uploads)
- LogEvents must attach to a Trip (no standalone events)
- All credit times stored as minutes (int) internally

### Trip Conflict Detection (UPDATED v2)
When importing a new trip that overlaps with existing trips:
- **Pre-Save Validation**: Conflict detection runs BEFORE trip creation
- **Pay Protection Alert Modal**: Shows detailed comparison of existing vs. new trip with computed credit values
- **Importing Trip Display**: The "New Trip (Importing)" card must show REAL computed credit values (never 0:00 unless parsing truly fails)

**Three Actions (v2)**:
1. **Company Revision (Protected Credit)** - Company changed the same assignment
   - Updates existing trip with new imported legs/times
   - Keeps original trip ID continuous (no new trip created)
   - Applies protected credit: `final_credit = max(old_credit, new_credit)`
   - Marks affected duty days as "Changed" (visual outline)
   - Auto-logs: "Company Revision applied" with old credit, new credit, protected credit, affected dates

2. **Replace Trip (Swap / Open Time)** - User intentionally dropped/traded/swapped original
   - Imports new trip as the active trip counting toward totals
   - Archives old trip with status="archived" (excluded from totals but preserved for records)
   - Auto-logs: "Trip replaced by new trip import" with old/new trip IDs and credit comparison

3. **Cancel Import** - Do nothing, no changes

**Credit Protection Rules**:
- Only active trips count toward totals
- Archived trips are excluded from totals automatically
- Protected credit applies ONLY to Company Revision (max of old vs new)
- Replace Trip uses only the new trip's computed credit

**3-Tier Conflict Detection**:
- **HARD CONFLICT - Duplicate**: Same pairingId/tripNumber detected → Block import
- **HARD CONFLICT - Time Overlap**: Actual duty time windows overlap → Block import, show "Overlaps on Jan 11 by 2h 30m"
- **SOFT CONFLICT - Same Day**: Same calendar day but no time overlap → Allow import (pilots can have multiple trips per day)

**Audit Trail (Automatic)**:
- All decisions auto-logged to Log Events, Recent Events, Records
- No manual user logging required
- Full audit trail with old/new credit values, affected dates, legs

- **Backend Guardrail**: Conflict detection enforced at both UI validation AND backend/database level to prevent duplicates even if UI fails
- **Cancel Guarantee**: Selecting Cancel guarantees no new trip is saved and no data is modified
- **Atomic Import**: All trip data (duty days, legs, layovers) saved together atomically - no partial/blank trips

## Phase 6: UX — Trips Tab + Review Changes Screen (NEW)

Complete UX for roster change visibility and acknowledgment workflow. A UPS pilot can now understand in under 10 seconds: what changed, whether acknowledgment is required, what credit they will be paid, and why.

### Trip Card Enhancements

**Status Tags (Trip Header):**
- `Original` - No changes detected (gray badge)
- `Updated` - Changes detected since original import (amber badge)

**Review Required Banner:**
- Appears when `acknowledgmentRequired = true` AND `acknowledgedAt = null`
- Amber highlighted banner: "Roster Change Detected — Review Required"
- Tappable — navigates directly to Review Changes screen

**Pay Credit Display (MANDATORY):**
- Always visible in trip footer (replaces simple "Est Pay")
- Large Pay Credit hours as primary display
- Subline: "Awarded: HH:MM | Current: HH:MM | Pay Credit: HH:MM"
- "PROTECTED" badge when pay protection is active (current < protected)
- Estimated pay shown as secondary info (≈ $X,XXX)

### Review Changes Screen

**Location:** `/review-changes?tripId={id}`

**Layout — Crew Access Style:**
- Left column: Original Roster (locked at first import)
- Right column: New Roster (from latest upload)
- Day-by-day, leg-by-leg comparison
- Differences highlighted with color coding

**Change Summary (Top):**
- List of all detected changes in plain English
- Examples:
  - "Duty Days: 7 → 6"
  - "Layover Changed: 18:20 → 12:10"
  - "Route Changed: ONT–MIA → ONT–RFD"

**Credit Explanation Box (MANDATORY):**
```
Pay Credit Calculation
━━━━━━━━━━━━━━━━━━━━━
Protected Credit (Awarded): HH:MM
New Roster Credit:          HH:MM (−X:XX)
─────────────────────────────────
Pay Credit Used:            HH:MM (protected)

We always use the higher of your awarded credit or
your current roster credit. Company changes cannot
reduce your awarded trip credit.
```

### Acknowledgment Flow

**Severity-Based Logic:**

| Severity | Button State | User Action |
|----------|--------------|-------------|
| `minor` | "Apply Update" (enabled) | Tap once to apply |
| `moderate_ack` | "Review Required — Tap to Confirm" | Tap to confirm, then "Acknowledge & Apply Update" |
| `major_ack` | "Review Required — Tap to Confirm" | Tap to confirm, then "Acknowledge & Apply Update" |

**On Acknowledgment:**
1. Sets `acknowledgedAt` timestamp on Trip
2. Clears `acknowledgmentRequired` flag
3. Creates audit record: "Roster Change Acknowledged"
4. Navigates back to Trips tab

**Post-Acknowledgment State:**
- Banner removed from Trip card
- Trip status remains "Updated" (factual)
- Pay Credit remains correct (protected value preserved)
- Review screen remains accessible for reference

### Backend Endpoint

**POST `/api/trips/:id/acknowledge`**

Creates an audit trail entry and updates trip acknowledgment state:
```json
{
  "success": true,
  "acknowledgedAt": "2025-01-15T12:34:56Z",
  "trip": { /* updated trip object */ },
  "auditRecordCreated": true
}
```

### Files Modified/Created (Phase 6)

**Frontend:**
- `src/components/trips/TripBreakdownCard.tsx` - Status tags, review banner, pay credit display
- `src/app/review-changes.tsx` - NEW: Review Changes screen
- `src/app/_layout.tsx` - Added review-changes route
- `src/app/(tabs)/trips.tsx` - onReviewPress navigation handler

**Backend:**
- `backend/src/routes/trips.ts` - POST /:id/acknowledge endpoint

## Phase 7: UPS Premium Pay Engine + Log Event Automation (NEW)

Complete system for premium pay suggestions, one-tap Log Event creation, and audit-ready documentation.

### Premium Code Library

Hard-coded UPS premium codes table with 20 contract-compliant codes:

**Fixed Minutes Premiums:**
| Code | Name | Premium | Contract Ref |
|------|------|---------|--------------|
| AP0 | Domestic 757 Jumpseating | +2:00 | 13.H.10.b.(6) |
| AP1 | Extra Duty Period Added | +2:00 | 13.E.4.b |
| AP2 | Change of Layover | +2:00 | 13.E.4.b.(2), 08-217 |
| AP3 | Trip Canceled / Substituted | +2:00 | 13.E.4.b |
| AP4 | Replace High-Mins Captain | +2:00 | 13.E.4.b |
| AP5 | Swap Due to Own Illegality | Manual | — |
| AP6 | Additional Segment Added | Manual | — |
| AP7 | Trip Begins >1 Hour Early | Manual | — |
| AP8 | Turn-for-Turn | Manual | — |
| AP9 | FO to IRO for Training | Manual | — |
| SVT | Reserve CQ / Turned Out | +2:00 | 13.B.6.b.(17), 13.B.6.b.(7) |
| PRM | No PRM Augmented 767 | +2:00 | — |
| LRP | Line Revision Premium | +6:00 | 13.E.4.f |
| GT1 | In Lieu of Grievance | +2:00 | — |
| APE | Exceeding Soft Max | Rule-based | 13.A.1.a, 13.A.1.b, 13.A.1.e, 13.R.1 |
| RT1 | Reserve Turned-Out 3rd Time | Manual | 13.B.6.b.(7)(b)(vii) |
| DOD_JS | DOD Jumpseater in Excess | +2:00 | 16.E |

**Multiplier-Based Late Arrival Premiums:**
| Code | Name | Multiplier | Contract Ref |
|------|------|------------|--------------|
| LP1 | Late Arrival >4 Hours | 150% | 13.E.4.e.(1),(2) |
| LP2 | Late Arrival >25h Dom / >50h Intl | 250% | 13.E.5.c |
| RJA | Late Arrival >2h Into Day Off | 150% | 13.B.6.c.(2)(a) |

### Auto-Suggest Logic

System suggests premiums based on detected changes:

| Detected Change | Suggested Code(s) |
|-----------------|-------------------|
| Layover shortened | AP2 |
| Extra duty added | AP1 |
| Legs added | AP6 |
| Route/flight change | AP3, AP4 |
| Duty extended/late release | AP1, LP1/LP2 |
| Credit reduced but protected | Pay Protection |
| Late arrival | LP1, LP2, RJA |
| Reserve CQ/turnouts | SVT, RT1 |

### Log Event Creation UX

**"Create Log Event Draft" CTA:**
- Available on Trip cards and Review Changes screen
- One-tap creates draft with:
  - Trip ID linked
  - Detected change summary auto-filled
  - Recommended premium codes as selectable chips
  - Screenshots auto-attached from uploads
  - Auto-generated notes with before → after context

**Premium Code Chips:**
- Selectable toggles for each applicable premium
- Selecting a code auto-applies +HH:MM or multiplier
- Credit impact displayed in real-time
- Contract reference shown for documentation

**Late Arrival Calculator:**
- For LP1/LP2/RJA multiplier premiums
- Inputs: Scheduled end time, Actual arrival time
- Outputs: Premium credit, Estimated dollar impact
- Auto-generates note text with contract reference

### Credit Impact Display

Always shows premium impact:
```
Premium Credit
━━━━━━━━━━━━━
+2:30 (AP0 + AP2)
≈ $XXX.XX
```

### Audit Trail Integration

Automatic records created for:
- "Premium Draft Created" — When draft Log Event created
- "Premium Applied" — When premium code selected
- "Pay Protection Applied" — When pay protection triggered
- "Credit Increased" — When credit delta applied

Each record links to:
- Trip ID
- Upload(s) used as evidence
- Log Event ID
- Premium codes applied

### API Endpoints

**Premium Codes:**
- `GET /api/premium-codes` — List all active premium codes
- `GET /api/premium-codes/seed` — Seed/refresh premium codes
- `GET /api/premium-codes/:code` — Get specific code details
- `POST /api/premium-codes/calculate` — Calculate premium pay
- `POST /api/premium-codes/suggest` — Get suggestions for change type

**Premium Events:**
- `GET /api/premium-events/candidates` — Get all premium candidates
- `GET /api/premium-events/trips/:tripId/candidates` — Get trip candidates
- `POST /api/premium-events/draft` — Create draft Log Event
- `GET /api/premium-events/drafts` — List user's drafts
- `POST /api/premium-events/drafts/:id/submit` — Submit draft
- `POST /api/premium-events/drafts/:id/dismiss` — Dismiss draft

### Files Created/Modified (Phase 7)

**Backend:**
- `backend/prisma/schema.prisma` — PremiumCode, PremiumEventSuggestion models
- `backend/src/lib/premium-codes-seed.ts` — Premium code definitions and seeder
- `backend/src/routes/premium-codes.ts` — Premium codes API routes
- `backend/scripts/seed-premium-codes.ts` — Seed script

**Frontend:**
- `src/app/create-log-event.tsx` — NEW: Log Event creation screen with premium chips
- `src/app/review-changes.tsx` — Added "Create Log Event Draft" CTA

### Acceptance Criteria (Phase 7)

- ✅ Premium codes searchable and selectable
- ✅ Fixed premiums auto-add correct +HH:MM
- ✅ Multiplier premiums calculate correctly
- ✅ Log Event drafts are one-tap and audit-ready
- ✅ Screenshots auto-attached
- ✅ Premium delta clearly visible to user
- ✅ Contract references displayed

## VibeCodes Premium Code Integration (Complete 5-Phase Implementation)

The VIBECODES system provides a single source of truth for all UPS premium pay codes, with full integration across the app.

### Phase 1: Premium Codes Database (Single Source of Truth)

**Database Table**: `PremiumCode` model in Prisma schema with:
- `code` — Unique identifier (AP0, LP1, etc.)
- `title` — Display title
- `description` — Plain-English explanation
- `category` — reassignment, reserve, schedule_revision, grievance, soft_max, late_arrival, other
- `premiumType` — "minutes" | "multiplier" | "manual"
- `premiumMinutes` — Fixed credit addition (e.g., 120 for +2:00)
- `premiumMultiplier` — Percentage (e.g., 1.5 for 150%)
- `variantsJson` — JSON array of variant options
- `contractRef` — Contract section reference

**Seeded Codes** (24 total):
- **Reassignment (AP0-AP9)**: 10 codes for various reassignment scenarios
- **Reserve (SVT, RT1)**: Reserve turned-out premiums
- **Schedule Revision (LRP, PRM)**: Line revision and augmented premiums
- **Grievance (GT1)**: In-lieu-of-grievance premium
- **Soft Max (APE)**: Exceeding soft max premium
- **Late Arrival (LP1, LP2, RJA)**: Delay-based multiplier premiums
- **Other (DOD_JS)**: DOD jumpseater excess

**Backend Files:**
- `backend/prisma/schema.prisma` — PremiumCode model (Lines 1686-1743)
- `backend/src/lib/premium-codes-seed.ts` — Complete seed data
- `backend/src/routes/premium-codes.ts` — API routes (list, get, calculate, suggest)

### Phase 2: Pay Code Library

**Screens:**
- `src/app/premium-code-library.tsx` — Browse all codes by category with search
- `src/app/premium-code-detail.tsx` — Deep-dive into single code with variants

**Features:**
- Category filter chips
- Most-used quick access row
- Premium type badges (Fixed/Multiplier/Manual)
- Search functionality
- "Use this code" → Create Log Event flow

### Phase 3: Log Event Premium Code Picker

**Component**: `src/components/PremiumCodePicker.tsx`
- Full-screen modal with search and category filters
- Most-used quick access row
- Variant picker for codes with multiple options
- Selected code chip display

**Integration** (`src/app/(tabs)/add.tsx`):
- Required for event types: Premium Trigger, Reassignment, Schedule Change
- Stores: `premiumCode`, `premiumVariantKey`, `premiumMinutes` on PayEvent

### Phase 4: Flight-Line Premium Logging

**Component**: `src/components/trips/LegPremiumLogger.tsx`
- Modal for logging premiums on individual flight legs
- Late arrival calculator using OOOI times as proof
- Calculates LP1 (1.5x), LP2 (2.5x), RJA (1.5x) automatically
- Real-time premium credit and pay display

**Integration** (`src/components/trips/CanonicalTripBreakdown.tsx`):
- Long-press on any leg row to open premium logger
- Premium badge displays when leg has premium applied
- `onLogLegPremium` callback with leg context

**Backend** (`backend/src/routes/trips.ts`):
- `PUT /api/trips/trip-duty-legs/:id/premium` — Save leg premium
- Updates TripDutyLeg, TripDutyDay totals, and Trip totals

**Database Fields** (TripDutyLeg model):
- `premiumCode` — Applied premium code
- `premiumAmountCents` — Calculated premium pay

### Phase 5: Log Event Leg-Level Linking (NEW)

Complete system for leg-level Log Event tracking with before/after change capture and auto-suggested premiums.

**Data Model** (Prisma schema):
- `LogEventLeg` join table linking LogEvents to specific TripDutyLegs
- `isPrimaryLeg` flag for the main affected leg
- `changeSummary` JSON field for before/after data per leg
- `changeSummaryJson` on LogEvent for overall change context

**Backend Routes** (`backend/src/routes/log-events.ts`):
- `GET /api/log-events` — List with headline format "MCO–RFD • FLT #### • Date"
- `POST /api/log-events` — Create with leg linking
- `POST /api/log-events/from-change` — Create from schedule change context
- `GET /api/log-events/summary/by-trip/:tripId` — Trip premium roll-up
- `GET /api/log-events/premium-suggestions/:changeType` — Auto-suggest AP codes
- `POST /api/log-events/:id/legs` — Link legs to existing event

**Frontend Components**:
- `ScheduleChangeLogEventModal` — Before/after display with premium suggestions
- `TripPremiumSummary` — Expandable premium roll-up with leg breakdown
- `LogEventListCard` — List item with headline format and leg preview
- `useLogEvents` hook — React Query integration for all log event operations

**UX Flow**:
1. User makes schedule change via ScheduleChangeModal
2. After save, ScheduleChangeLogEventModal auto-opens with:
   - Before/after comparison
   - Auto-suggested AP codes (AP0-AP8, JA, RA, EXT, LA)
   - One-tap premium selection
   - Leg-level linking
3. Log Event created with leg-level detail
4. Trip detail shows premium roll-up with leg breakdown

**Premium Suggestions by Change Type**:
| Change Type | Suggested Codes |
|-------------|-----------------|
| schedule_change | AP2, AP3, AP6 |
| reassignment | JA, AP3 |
| duty_extension | EXT, AP4 |
| late_arrival | LA, LP1, LP2 |
| early_report | AP7 |
| layover_change | AP2 |
| additional_flying | AP6 |

### Phase 6: QA Acceptance

All phases verified and TypeScript compiles clean. Features:
- Premium codes seeded and accessible via API
- Pay Code Library displays all codes with proper formatting
- Log Event integrates premium code picker for applicable event types
- Flight-line premium logging works via long-press on legs
- Late arrival calculation uses OOOI times as proof
- Premiums roll up to duty day and trip totals

### Key Files Summary

| Phase | File | Purpose |
|-------|------|---------|
| 1 | `backend/prisma/schema.prisma` | PremiumCode model |
| 1 | `backend/src/lib/premium-codes-seed.ts` | 24 seeded codes |
| 1 | `backend/src/routes/premium-codes.ts` | API endpoints |
| 2 | `src/app/premium-code-library.tsx` | Library screen |
| 2 | `src/app/premium-code-detail.tsx` | Detail screen |
| 3 | `src/components/PremiumCodePicker.tsx` | Picker modal |
| 3 | `src/app/(tabs)/add.tsx` | Log Event integration |
| 4 | `src/components/trips/LegPremiumLogger.tsx` | Leg premium modal |
| 4 | `src/components/trips/CanonicalTripBreakdown.tsx` | Long-press handler |
| 4 | `backend/src/routes/trips.ts` | Leg premium endpoint |

## Features

- **Annual Pay Planner (NEW - PRO Feature)**: Flagship income planning tool for UPS pilots
  - **Core Question**: "If I want to make $X this year, is it realistic, and what would it take?"
  - **Target Input**: Set your annual income goal ($100K - $800K slider + numeric input)
  - **Pilot-Friendly Hours Breakdown**: Shows hours like pilots think:
    - "75 hrs (Monthly Guarantee) + 12 hrs (Extra Flying) + 7 hrs (JA @ 150%)"
    - Stacked bar visualization with labeled segments
    - Per bid period and monthly averages in de-emphasized details row
  - **Reality Check Card**: Compares your current avg to required pace with multiplier
    - "Your current average is 82 hrs/month. This plan requires 94 hrs/month (~1.15× your current pace)"
    - Feasibility badge: Very Achievable, Achievable with Effort, Unlikely Without Significant Change, Highly Unlikely Under Current Conditions
  - **What's Driving This Plan**: Shows % contribution breakdown
    - Base/Guarantee contribution percentage
    - Extra Flying contribution percentage
    - JA contribution percentage (with tooltip about availability)
  - **Interactive What-If Toggles**: Quick scenario exploration
    - "Remove JA" - See projected pay without JA
    - "Guarantee Only" - See pay at minimum guarantee
    - "No Extra Flying" - See pay without premium/reserve contributions
    - Shows instant projection delta when toggled
  - **Save Target Year**: CTA to persist plan for tracking
    - "Set as My 2026 Target" button
    - Enables YTD tracking comparison throughout the year
  - **Three Scenarios**: Current Pace, Optimized, and Aggressive projections
  - **Baseline Transparency**: Shows UPS 75-hour monthly guarantee vs your historical average
  - **Pay Breakdown**: Base pay, premiums, reserve contribution, JA (150%) - separate line items
  - **Legal Disclaimer**: "This is a planning tool - not a guarantee"
  - **Philosophy**: Awareness-based, scenario-driven, contract-referenced (read-only)
  - **Location**: Tools tab → "Annual Pay Planner" card
  - **API Endpoints**:
    - `POST /api/planner/annual` - Calculate scenarios
    - `POST /api/planner/annual/save` - Save scenario
    - `GET /api/planner/annual/saved` - List saved scenarios
    - `DELETE /api/planner/annual/saved/:id` - Delete saved scenario
    - `GET /api/planner/annual/tracking` - Get YTD tracking vs plan
  - **Implementation Files**:
    - `backend/src/routes/annual-planner.ts` - Backend API
    - `src/lib/useAnnualPlanner.ts` - React Query hooks
    - `src/app/annual-pay-planner.tsx` - Main screen
    - `shared/contracts.ts` - Type definitions

- **Offline Mode (NEW)**: View your pay data while in flight or without internet
  - **How It Works**: Data is cached locally when online, available offline
  - **Cached Data**: Dashboard, pay statements, trips, pay events, projections
  - **Offline Indicator**: Yellow banner shows when viewing cached data with last sync time
  - **Auto-Refresh**: Data automatically refreshes when connectivity returns
  - **Cache Duration**: Data stays fresh for 7 days
  - **What Works Offline**: Viewing pay summaries, reviewing statements, checking trip details
  - **What Needs Internet**: Adding new trips, logging pay events, uploading schedules
  - **Implementation Files**:
    - `src/lib/offlineStorage.ts` - Local caching utility
    - `src/lib/useNetworkStatus.ts` - Network detection hook
    - `src/components/OfflineIndicator.tsx` - UI indicator component

- **Pay Dashboard (Confidence-First Design)**: Professional pay intelligence tool with:
  1. **Pay Confidence Summary** (Hero Card) - Shows estimated pay with HIGH/MEDIUM/LOW confidence indicator
     - **Tappable Confidence Badge**: Opens modal with verification breakdown
     - **Gross/Net Toggle**: Switch between gross and estimated net pay
     - **"Why this amount?"**: AI explanation of pay calculation components
  2. **Conditional Action Needed Card** - Only appears when trips need review or events pending
  3. **Pay Period Outlook** - Next paycheck date, projected range, days remaining
  4. **Credit vs Block Performance** - Credit/block ratio with color-coded efficiency:
     - Green (>=1.2x) = Excellent efficiency
     - Amber (>=1.0x) = Good efficiency
     - Gray (<1.0x) = Below average
     - Explanation: "Shows how effectively your block time converts into paid credit"
  5. **Pay Events Summary** - List of logged pay events this period
  6. **Quick Actions** - 4-button grid (Log Event, Pay Summary, OOOI, Pay Check)
  7. **Earnings Summary (Consolidated)** - YTD and On Pace For (consolidates MTD if same)
  8. **Premium Banner (Polished)** - Clear trial language: "7-day free trial → paid after"
- **Pay Summary (NEW - AUTO-GENERATED)**: Payroll-style pay breakdown derived entirely from uploaded schedules
  - **Auto-Generated**: No manual pay entry required - updates automatically when schedules/trips change
  - **Data Sources**: Schedule uploads, parsed trip data (legs, credit hours, duty days, layovers), premium pay codes, user-configured deductions
  - **Header**: PilotPay Tracker branding, pay period selector, generated timestamp
  - **User Info Block**: Pilot name, GEMS ID, position, base (no SSN or bank info)
  - **Earnings Breakdown (Estimated)**:
    - Base Flight Pay (from credit hours × hourly rate)
    - Premium Pay (from pay events - JA, reassignment, etc.)
    - Per Diem (non-taxable, shown separately)
    - Total Estimated Gross
    - Each line item tappable to show contributing trips/events
  - **Estimated Deductions (User-Controlled)**:
    - Pre-Tax: 401(k), medical, etc.
    - Taxes: Federal, Social Security (6.2% with cap logic), Medicare (1.45% + 0.9% threshold)
    - Post-Tax: Union dues, Roth 401(k), benefits
  - **Net Pay Snapshot (Hero Card)**:
    - Estimated Take-Home Pay (prominent)
    - Take-home percentage
    - Effective tax rate
    - Non-taxable total (per diem)
  - **Year-to-Date Tracking**:
    - YTD Gross, Estimated Taxes, Estimated Net
    - Social Security wage cap progress indicator
    - 401(k) YTD contributions
  - **Empty State**: Clear CTAs for "Upload Schedule" and "Set Up Deductions"
  - **Export/Share**: Download/share pay summary as text
  - **Disclaimer**: Prominent legal disclaimer - not official payroll/tax document
  - **Footer**: "No SSN or bank information stored" security notice
- **Sick (SIK) Tagging System (NEW)**: Personal sick tracking for trips, days, and legs
  - **Mark Sick Flow**:
    - Mark entire trips, specific duty days, or individual legs as "SIK"
    - Modal selection with scope options (Entire Trip / Day / Legs)
    - Smart default selection based on trip completion status
    - Completed leg safeguard warnings
    - User notes field for personal records
    - **Red/white color scheme** for sick indicators (distinct from flight indicators)
    - **Confirmation dialog** when tapping heart button ("Are you sure?" with Yes/Cancel)
  - **Visual Badges**:
    - Trip list shows SIK/PARTIAL badges (red for full, amber for partial)
    - **Trip card highlight**: Full sick trips get red border and red accent line
    - Duty day headers show DaySikBadge
    - Individual legs show LegSikTag
    - Trip detail drawer header shows TripSikBadge
    - **Red heart with white fill** indicates sick status
  - **Pay/Credit Breakdown Display**:
    - Shows in Pay tab when trip has any SIK legs
    - Earned Credit: HH:MM (legs not marked SIK)
    - Sick Credit: HH:MM (legs marked SIK)
    - Total Credit: HH:MM
    - Legal disclaimer on every display
  - **Rolling 12-Month Sick Summary**:
    - Displays on Pay Summary screen
    - Metrics: Sick Calls (distinct events), Days Covered (unique dates), Sick Credit (hours)
    - Rolling window dates shown
    - Sick history list with event details
  - **Undo Functionality**: Void sick markings to restore legs to FLY status (with bank refund)
  - **Audit Trail**: All sick events create LogEvents for record keeping
  - **Legal Disclaimer**: "This is a personal historical record based on logged events. It does not represent an official sick bank, balance, or employer record."
  - **NEW: Upload-Detected SIK (Phase 1)**:
    - AI detects "SIK" labels in uploaded schedule screenshots
    - Shows review modal with deduction preview
    - User must confirm before applying SIK
    - Auto-attaches upload as proof
    - Already-marked guard prevents double-deduction
  - **NEW: Undo/Edit SIK with Reconciliation (Phase 2)**:
    - Undo SIK refunds hours back to sick bank
    - Edit scope changes which legs are SIK without double-deducting
    - Delta reconciliation: only deducts/refunds the difference
    - Creates audit log entries for all changes
  - **NEW: SIK on Completed Trips (Phase 3)**:
    - Heart (SIK) action available on completed trips (within 120 days)
    - Backdated entries labeled: "Recorded After Trip (Backdated)"
    - Leg-level source of truth with deep links
    - History includes deep links to exact legs/trips
    - SIK filter in Records tab
  - **Implementation Files**:
    - `backend/src/routes/sick.ts` - API endpoints for marking/voiding/editing sick
    - `backend/prisma/schema.prisma` - SickCallEvent, SickCallLegLink, legStatus field
    - `src/lib/useSickTracking.ts` - React Query hooks
    - `src/components/trips/SickMarkingModal.tsx` - Mark sick modal (shows schedule with times and credit)
    - `src/components/trips/SikDetectionReviewModal.tsx` - Upload-detected SIK review modal (NEW)
    - `src/components/trips/SikBadge.tsx` - Badge components (red/white theme)
    - `src/components/trips/SickSummaryCard.tsx` - Summary widget (red/white theme)
- **Sick Time Tracker (NEW - Personal Tool)**: Complete sick bank management under Tools → Sick
  - **IMPORTANT**: For PERSONAL RECORD-KEEPING ONLY - does NOT connect to payroll or company systems
  - **Phase 1 - Sick Bank Setup**:
    - Editable sick bank balance (hours)
    - Visual progress bar toward 1,200 hour cap
    - Cap reached indicator (pauses accrual automatically)
    - Changes auto-save and propagate to all modules
  - **Phase 2 - Accrual Logic**:
    - Default accrual rate: 4 hrs per bid period
    - User-override for custom accrual rate
    - Monthly accrual history table
    - Automatic stop when cap reached, resume when balance drops
  - **Phase 3 - Sick Call Deduction**:
    - Log sick usage with date range and hours
    - Optional trip number linking
    - Coverage status indicators: FULL (green), PARTIAL (amber), NONE (red)
    - Deductions update sick bank balance automatically
  - **Phase 4 - Multi-day/Mid-trip Sick Logic**:
    - Support for marking entire trip, specific days, or individual segments
    - Continuous sick calls grouped as single event for rolling metrics
  - **Phase 5 - Rolling 12-Month Summary**:
    - Sick events count (distinct continuous calls)
    - Total hours used
    - Average hours per event
    - No warning or disciplinary language
  - **Phase 6 - Payout Estimator**:
    - Only hours above 75 hrs eligible
    - Hourly rate from profile or manual override
    - Formula: Eligible Hours = balance - 75; Payout = Eligible × Rate
    - Clearly labeled "Estimate only — personal reference"
  - **Phase 7 - Attachments & Records**:
    - Attach documents per sick event (OOOI screenshots, notes)
    - Immutable usage log (audit trail)
    - Each entry stores: dates, hours, trip ID, coverage status
  - **Database Models**:
    - `SickBank` - User balance, cap, accrual rate
    - `SickAccrualLog` - Monthly accrual history
    - `SickUsageLog` - Immutable sick usage records
    - `SickUsageAttachment` - Document attachments
  - **Implementation Files**:
    - `backend/src/routes/sick-tracker.ts` - API endpoints
    - `backend/prisma/schema.prisma` - SickBank, SickAccrualLog, SickUsageLog, SickUsageAttachment
    - `src/lib/useSickTimeTracker.ts` - React Query hooks
    - `src/app/sick-tracker/index.tsx` - Main tracker screen
    - `src/app/sick-tracker/log.tsx` - Log sick time screen
    - `src/app/sick-tracker/history.tsx` - Usage history screen
    - `src/app/(tabs)/tools.tsx` - Tools page with Sick Time card
- **Tax Settings & Net Pay Estimator**: Built-in tax calculator without external APIs
  - **Tax Profile**: State selection (no address), filing status, pay frequency, dependents
  - **Deductions**: Pre-tax and post-tax deductions with fixed $ or % of gross
  - **Auto-calculated Taxes**: Federal (progressive brackets), FICA (SS + Medicare), State
  - **No Income Tax States**: Automatic $0 state tax for AK, FL, NV, NH, SD, TN, TX, WA, WY
  - **Tax Year Config**: All brackets config-driven for easy annual updates (2024, 2025)
  - **Net Pay Breakdown Modal**: Detailed view of all deductions and taxes
- **Projected Pay Statement (NEW)**: UPS-style pay stub with Pilot Pay Tracker branding
  - Header with pilot name, airline, position, pay period dates
  - **Earnings Section**: Flight credit pay, block overage, pay events
  - **Pre-Tax Deductions**: 401(k), medical, etc. from tax settings
  - **Taxes**: Federal, Social Security, Medicare, state withholding
  - **Post-Tax Deductions**: Union dues, Roth 401(k), etc.
  - **Net Pay Box**: Prominent estimated take-home pay
  - **Disclaimer**: "Estimated projection — not an official payroll statement"
  - **AI-Powered Explanations (NEW)**: Contextual AI explanations for pay statement
    - **Explain This Pay Button**: Top-level button for full statement explanation
    - **Section-Level Explain Icons**: Each section (Earnings, Taxes, Deductions, Net Pay, Reimbursements) has an explain icon
    - **AI Explanation Modal**: Comprehensive breakdown including:
      - Key factors affecting pay this period
      - What matched expectations vs. what differed
      - Career Pay Benchmark context (Contract Extension TA – 2025)
      - Verification status (Verified / Estimated / Mismatch / Review Recommended)
      - Suggested next actions
      - Difference analysis when comparing projected vs actual
    - **Contract-Aware Language**: Uses official contract terminology
    - **Non-Speculative**: AI explains facts, never guesses unknown values
- **Trips (Holy Grail Redesign - Complete Rebuild)**: Premium cockpit glass aesthetic with intelligent schedule management
  - **Cockpit Glass Theme**: Dark slate/navy background with cyan accents, JetBrains Mono typography for flight data
  - **Premium Header**: Clean month navigation, view mode toggles (List/Calendar), smart filter pills (All/Scheduled/Completed/Review)
    - Search functionality with route, trip number, and flight number matching
    - Gradient import button for quick schedule uploads
  - **MonthPaySummaryCard (NEW)**: Enhanced monthly summary with pay focus
    - Shows Block Hours, Credit Hours, Estimated Pay in prominent display
    - Trip count indicator
    - View Dashboard button for full analysis
  - **EstTripPayCard Component (NEW)**: Premium pay estimation display
    - Table format: Credit, Block, Per Diem, TAFB, Days
    - Large Est Trip Pay calculation with formula display (Credit × Hourly Rate)
    - Per Diem + Est Total breakdown
    - Confidence indicator (High/Medium/Low)
  - **TripBreakdownCard Component (BidPro Style)**: Comprehensive trip display with full breakdown
    - **Trip Header**: Shows trip/pairing number, base (origin), equipment, status badge
    - **Expandable Detail View**: Tap chevron to expand full trip breakdown
    - **Duty Day Sections**: Each duty day displayed with date, day number, daily totals
      - Column headers: Flight, Position, Route, Dep(L), Arr(L), Blk (fixed widths for alignment)
      - Individual leg rows with flight number + aircraft chip, F/O position, route, LOCAL times, block time
      - **Local Time Display (NEW)**: Departure times shown in origin airport local time, arrival times in destination airport local time
      - Aircraft type (757/767/747 etc) displayed as compact chip next to flight number
      - Deadhead legs highlighted in orange
    - **Layover Cards**: Rest time between duty days with station and hotel info
      - **Only shows between consecutive duty days** (overnight rest periods)
      - **Calculation per CML**: Rest = next duty START − prior duty END
      - Uses explicit duty start/end datetimes only (no offset subtraction)
      - Does NOT show layover after final duty day (return to base)
      - Does NOT show layover when trip transitions to days off
    - **Trip Summary Footer**:
      - Credit (total), Block (total), Per Diem (estimated), TAFB, Duty Days count
      - Estimated trip pay prominently displayed (auto-calculates from credit × hourly rate)
    - Status-aware accent colors (Cyan scheduled, Green verified, Amber review)
    - Smooth press animations with haptic feedback
  - **FlightCard Component (Legacy)**: Departure board-style trip cards with aviation aesthetics
    - Large 3-letter airport codes (DFW → LAX) with departure/arrival times in HHMM format
    - Animated flight path indicator with plane icon
    - Block time and credit badges with live calculation
    - Leg count and duty day summary
  - **SmartImportModal**: Intelligent multi-source import with AI detection
    - Auto-detect mode for automatic source classification
    - Support for Crew Access Trip Info and Trip Board screenshots
    - Multi-image selection (up to 6) with gallery/camera options
    - Real-time upload progress with animated scanning line effect
    - Visual preview with index badges and remove capability
    - Shows AI extraction capabilities (Flight Numbers, Routes, Block Time, Credit, etc.)
    - **Background Import (NEW)**: Users can dismiss modal during import and continue browsing
      - Floating minimized progress indicator shows import status
      - Import summary modal appears when complete
      - Progress bar has sweeping scan animation for visual engagement
  - **Canonical Trip Breakdown (NEW)**: Trip Information-style display with exact layover/rest matching
    - **Supports Two Schedule Formats**:
      1. **Trip Information / CML printout**: Has "Rest: HH:MM" + hotel name/phone/status
      2. **Trip Details table**: Leg list + duty/credit (may not include hotel lines)
    - **Normalized Structure**: Trip → Duty Days → Legs → Layovers (after each duty day except final)
    - **Non-Negotiable Layover Rule**: Rest = next duty start (report) − prior duty end
      - Never uses calendar day math
      - Never skips duty boundaries
    - **Hotel Extraction**: Attaches hotel info to correct layover station (arrival of final leg)
    - **Layover Hotel Directory**: Per-user, per-airline learned hotel mappings
      - Auto-populates hotels when missing (from Trip Details imports)
      - Confidence scoring with user confirm/edit/reject actions
      - Opt-in sharing across same-airline users (never cross-airline)
  - **Calendar View**: Month calendar with trip blocks spanning across days
    - Status-colored blocks (scheduled/flown/verified/needs review)
  - **Schedule Change & Override System (ENHANCED)**: Record real-world schedule changes without re-importing
    - **Pencil Edit Icon**: Pencil icon on each DAY header in Segments view (replaced half-circle arrows)
    - **OOOI Camera Button (NEW)**: Camera icon on each LEG row for quick OOOI proof capture
      - Shows flight context (flight number, origin, destination) pre-populated
      - Green checkmark when all OOOI times captured
      - Amber when partial OOOI data exists
      - Gray camera icon when no OOOI data yet
    - **Schedule Change Modal**: Record reassignment, reroute, timing changes, leg added/removed
    - **Leg Editing (NEW)**: Edit individual flight legs directly in the Schedule Change modal
      - Edit flight number, origin, destination for each leg
      - Add new legs or mark existing legs as deleted
      - Toggle deadhead status
      - Visual indicators for modified/new/deleted legs
      - Shows original vs new route when leg is modified (e.g., "ONT–MIA → ONT–RFD")
    - **Integrated Log Event (NEW)**: Log Event fields built directly into Schedule Change modal
      - Event type auto-selected from change reason (Reassignment, Schedule Change, etc.)
      - Event description auto-generated from leg edits (e.g., "Reroute: ONT-MIA → ONT-RFD")
      - Event date auto-populated from duty day
      - Contact details section: rep name, contact method (Phone/ACARS/Text/Other), contact time
      - Additional notes field for clarifications
      - Proof attachment: add screenshot directly from photo library
      - Single "Save Change" button creates both schedule change AND pay event
    - **Visual Indicators**:
      - Amber/orange border + "CHANGED" tag for schedule changes
      - Violet/purple border + lock icon + "OVERRIDE" tag for overrides
      - Green "PREMIUM" tag with dollar icon when premium pay applied
    - **Priority Hierarchy**: Override > Schedule Change > Latest Import > Original Import
    - **Override Persistence**: Overrides persist through future imports and become source of truth
    - **Premium Pay Codes**: JA (Junior Assignment), RA (Reassignment), EXT (Extension), LA (Late Arrival)
    - **Premium Credit Display**: Shows base credit + premium credit with total
    - **Automatic Log Events (ENHANCED)**: Creates PayEvent records when changes/overrides applied
      - Title includes specific flight info: "Schedule Change — FLT 2310 ONT–MIA (Tue Jan 13)"
      - Description includes leg edits: route changes, added legs, removed legs
      - Description includes contact info when provided (rep name, method, time)
      - Proof attachments saved as PayEventDocument records
      - Links event to Trip ID and duty day
      - Appears in Recent Events and Records tabs
    - **Trips List Badges**: Shows CHANGED/OVERRIDE/PREMIUM badges on trip cards
  - **List View**: Staggered entry animations with gesture-driven interactions
    - Pull-to-refresh with cyan tint
    - Filter and search integration
    - **Chronological Sorting**: Trips always listed in date order (oldest to newest), same-day trips sorted by first leg departure time
  - **Empty State**: Animated floating plane with encouraging onboarding prompt
  - **Monthly Stats Summary**: Compact card showing Block Hours, Credit Hours, and Estimated Pay for the month
    - Links directly to Dashboard for full pay analysis
  - **Clear Month Feature**: Delete all trips for current month via header menu (with confirmation)
  - **Trip Detail Drawer**: Full flight segment breakdown with edit capabilities
    - **Flight Cards**: Origin→Destination with departure/arrival times, block time, equipment
    - **DEP/ARR/BLK Headers**: Time labels aligned ABOVE values for cleaner display
    - **OOOI Status Badge**: Green checkmark when all times recorded
    - **Day Credit Display**: Shows daily credit total with MIN guarantee badge
    - **Layover Cards with Live Countdown**: Real-time rest countdown until next report
      - **Definition**: Layover = rest between duty days (overnight at outstation)
      - **Non-Cumulative**: Each layover shows single overnight rest (NOT accumulated across days)
      - Only displayed when previous duty day has legs AND next duty day has legs
      - Calculates: nextReportTime - currentTime (LOCAL timezone)
      - **CML Compliant**: Rest = next duty START − prior duty END (no offset subtraction)
      - **Auto Report Offset**: Automatically applies correct report offset:
        - Domestic: 60 minutes prior to departure
        - International: 90 minutes prior to departure (ANC, HNL, MIA, Europe, Asia)
      - Updates every second for smooth countdown
      - Emerald color when >1 hour remaining
      - Amber warning when ≤1 hour remaining
      - Red urgent alert when ≤10 minutes remaining
      - **REPORT TIME Banner**: Prominent red alert banner when countdown reaches 0:00
        - Haptic feedback triggers when countdown reaches zero
        - Shows "REPORT TIME" with alarm icon
        - Displays scheduled report time in local timezone
      - Shows "Rest Time — Until Report" subtitle
      - OCR parsing support for Crew Access ("Rest: HH:MM") and Trip Board ("L/O HH:MM")
    - **Showtime Push Notifications**: Automatic alerts before report
      - 10-minute "Showtime" alert before report time
      - 60-minute "Report Coming Up" warning
      - Uses LOCAL time of report station
      - Auto-schedules on trip import, cancels on trip edit/delete
    - **Hotel Cards with Call Buttons**: Editable phone fields for hotel and transport
      - Tap to edit phone numbers inline
      - One-tap Call Hotel / Call Transport buttons
    - Edit button to modify OOOI times, Camera button to capture proof
    - **Editable Trip Totals (NEW)**: Tap Credit/Block/Pay summary to manually edit values
      - Edit Credit and Block hours with hours:minutes input
      - Live estimated pay preview based on hourly rate
      - Pay auto-recalculates when credit is updated
    - **Edit Flight Modal**: Full flight editing with premium codes
      - Edit route (FROM/TO stations)
      - Edit DEP, ARR, BLK times in local time
      - Add/remove premium codes (JA, Late Arrival, Extension, etc.)
      - Custom premium code support
  - **Imports View**: Schedule import history and status tracking
  - **Trip Board Import (NEW)**: Snapshot-based schedule tracking with change detection
    - Upload Trip Board screenshots to create schedule snapshots
    - Compares new snapshots against previous to detect changes
    - Detects: trips added/removed, legs added/removed, time changes, deadhead changes, credit changes
    - Shows pay impact estimation for each change
    - AI-suggests relevant pay events to log (Schedule Change, Reassignment, Duty Extension)
    - Attach proof screenshots when logging pay events from changes
    - Light reminders to re-import Trip Board every 48-72 hours
    - Shows "Update Schedule" banner when it's time to refresh
  - **Trip Detail Drawer**: Tabbed interface with:
    - Segments tab: Edit legs, add duty days, capture OOOI times
    - Pay tab: Expected vs paid with confidence scoring, discrepancy alerts
    - Events tab: Log schedule changes, extensions, reassignments with rep names/times
    - Proof tab: ACARS screenshots linked to legs with matched/needs match states
    - Notes tab: Trip-level notes
  - **Timezone Conversion (Zulu → Local)**:
    - Built-in airport timezone database (40+ airports)
    - Supports both IATA (SDF) and ICAO (KSDF) codes
    - Automatic Zulu to local time conversion at DEP/ARR stations
    - Upload custom airport database (CSV/JSON) for world coverage
    - Settings screen: Settings → Airport Timezones
  - **Report Time Rules**:
    - Domestic bases (SDF, ONT): 60-minute report offset
    - International bases (ANC, MIA, SDF747): 90-minute report offset
    - Hawaii/Alaska routes: Always 90-minute report
    - Auto-calculates report time from departure
  - **Import Schedule**: Upload screenshots or camera capture to extract trips/legs
    - Auto-detects source type (Crew Access, Trip Board, BidPro Trip Details)
    - **AI-Powered Parsing (Enhanced)**:
      - GPT-4o Vision with high-detail mode for 100% accuracy
      - System prompts optimized for airline schedule formats
      - OCR hints provided to AI for better context
      - Automatic magnification of small text (1.5-2x upscaling)
      - Enhanced image preprocessing with sharpening and contrast
    - **BidPro Trip Details Parser**:
      - Extracts trip number (S5055), base/fleet (SDF 757)
      - Parses every flight leg from table (Date, Pairing, Flt, Pos, Dep, Arr, Blk)
      - Handles Zulu time format: (SU15)20:37
      - Detects deadheads (CML flights, 0:00 block time)
      - Extracts footer totals: Credit, Block, TAFB, Duty Days, Per Diem
    - **Multi-Strategy OCR**: 3 parsing strategies for maximum extraction
      - Strategy 1: Row pattern matching for complete flight rows
      - Strategy 2: Airport-time pair correlation
      - Strategy 3: Synthetic leg creation from footer totals
    - Extracts trips, legs, dates, credit, layovers, hotels, aircraft
    - Preview with uncertain fields highlighted for quick correction
  - **Discrepancy Flags**: Neutral language for items needing review
    - Confidence scoring per trip/pay period
    - "Items to Review" vs "errors" or "owed" terminology
  - **Swipe Actions**: Quick access to Add Pay Event, Add Proof, Mark Flown, Verify Pay
  - **New Changes Popup**: Floating popup notification when new schedule changes are detected
    - Appears at top of screen with haptic feedback
    - Shows count of unacknowledged changes
    - Tap to open Changes Detected modal, dismiss to hide
    - Re-appears when new changes are detected
  - **Tab Badge**: Trips tab shows badge count for unacknowledged changes
  - Real-time pay and credit calculation with minimum credit guarantee
- **Log Pay**: Flight entry form with automatic pay calculations including premium codes
- **Audit Trail (formerly History)**: Professional audit trail and evidence locker for pay protection
  - **Roster Changes Integration**: Automatically reports trip changes when schedules are uploaded
    - Credit difference changes (e.g., "+1:30 credit" or "-0:45 credit")
    - Layover changes with hotel/station updates
    - Time changes (report time, release time adjustments)
    - Route changes and leg additions/removals
    - Premium pay candidates automatically flagged
  - **Trip Change Log Filter**: Dedicated filter for viewing all schedule/roster changes
    - Shows brief summaries of what happened (e.g., "Credit Changed: 4:30 → 5:15 (+0:45 credit)")
    - Helps users review historical changes days or weeks later
    - Badge count shows number of logged changes
  - **Pay-Focused Filters**: All / Earnings / Pay Events / Trip Change Log / Pay Summary
  - **Record Status Display**: Every record shows status (Open / Resolved / Disputed) with color coding
    - Open (Amber): Requires attention or verification
    - Resolved (Green): Verified and closed
    - Disputed (Red): Being contested or under review
  - **Visual Weight by Impact**: Records with higher dollar impact shown more prominently
  - **Grouped Trip Uploads**: Trips uploaded together are consolidated into one record
    - Shows combined credit and pay totals for all trips in the upload
    - Displays trip count badge (e.g., "3 trips") when multiple trips
    - Lists trip numbers as summary (e.g., "T123, T456 +1 more")
    - Date range spans earliest start to latest end date
    - Deleting the record removes all trips from that upload
  - **De-emphasized Trip Imports**: Trip imported records appear muted relative to pay events
  - **Timeline Cards**: Different card types for each entry type
    - Trip Card: Imported/confirmed trips with route summary, date range, credit/pay impact
    - Detected Change Card: Schedule changes needing review with "Review & Classify" action
    - Pay Event Card: Logged pay events with documentation count and status
    - Statement Card: Pay statement uploads with parse confidence and reconciliation status
    - Rule Change Card: Pay rule toggle/changes with impact explanation
    - AI Suggestion Card: AI recommendations with accept/dismiss status
    - Export Card: Generated pay review packets with download action
  - **Evidence Detail Drawer**: Bottom sheet with full entry details
    - Status section with description
    - Pay impact display (credit + estimated pay)
    - Linked trips, notes, attachments
    - Status history
    - **Export as Evidence** action for pay events and disputed records
    - Accept Change / Log Pay Event buttons for detected changes
  - **Search & Filter**: Search bar + horizontal filter chips
  - **Action Needed Alert**: Prominent alert banner when items need attention
  - **Dashboard Integration**: Open and disputed records feed Dashboard "Action Needed" card
  - **Pull-to-Refresh**: Refresh all data sources with haptic feedback
  - **Tab Badge**: Records tab shows badge count for unacknowledged changes
- **Tools (Pay Command Center)**: Clean, prioritized layout organized by pilot intent
  - **SECTION 1 — ANALYZE**:
    - Earnings Overview – [Year]: YTD, current month, tap-through analytics (monthly breakdown, charts, career stats)
  - **SECTION 2 — CALCULATE**:
    - Pay Calculator (estimate trip pay)
    - Late Arrival Pay (UPS LAP premium calculator)
    - Per Diem (meal / expense estimate)
    - 30-in-7 Tracker (FAA block time limit compliance)
  - **SECTION 3 — VERIFY & DOCUMENT**:
    - Pay Summary (auto-generated pay breakdown)
    - Contract Vault (uploaded CBAs / LOAs, shows Active status badge)
    - OOOI Capture (scan flight times from screens)
      - **OpenAI Vision primary parser**: Uses GPT-4o via backend to read ACARS screens
      - Handles rotated/sideways ACARS photos automatically (no need to hold phone level)
      - Falls back to OCR.space text extraction + regex if Vision unavailable
      - Supports green-on-black UPS ACARS-OOOI format
    - **Flight Log (NEW)**: Digital logbook with OOOI times auto-populated
      - Displays all flights with flight number, origin, destination
      - Shows block time and flight time calculated from OOOI data
      - **Summary Cards**: Week/Month/Year totals with flight count
      - **Large Summary Header**: Total block time, flight time, flights for selected period
      - **Expandable Flight Entries**: Tap to view full OOOI times (Out/Off/On/In)
      - **OOOI Badge**: Green "OOOI" badge on entries with complete times
      - Time filter pills: This Week, This Month, This Year, All
      - Sorted by date (most recent first)
  - **SECTION 4 — REFERENCE**:
    - Pay Code Library (all pay codes & definitions, linked to contract)
    - Airline Glossary (airline-specific terminology)
  - **SECTION 5 — SETTINGS** (visually separated):
    - App Settings (profile, airline, pay rate, tax profile, preferences)
  - **UX Goal**: Analyze → Calculate → Verify → Reference → Configure in exact order
  - **Pay Code Library**: Reference-only library of pay codes based on airline terminology + user contracts
    - Filter chips by category (Premiums, Guarantees, Protections, Reassignments, Reserve, etc.)
    - Search by code name, short code, or keyword
    - Contract Linked / No Reference badges
    - Common term indicators from airline terminology pack
    - Deep linking from Events/Changes (category pre-selected)
  - **Pay Code Detail (Holy Grail)**: Full pay code reference page
    - Plain-English Summary with bullet points
    - What to Document Checklist with checkable items
    - "Log This as Pay Event" button with checklist template
    - Contract References from user-uploaded documents (page, section, excerpt, confidence)
    - User Notes section (editable)
    - Related Codes section
    - Reference-only disclaimer banner
  - **Context Entry Points**: Related pay codes shown from:
    - Pay Event Detail modal (based on event type)
    - Detected Change cards in Audit Trail (based on change type)
    - Quick navigation to relevant pay code categories
  - **Contract Vault**: Upload and manage CBA, LOA, Pay Manual documents
  - Pay management tools (Glossary, Pay Events, Pay Rules)
  - Calculators (Pay Calculator, 30-in-7 Tracker, Per Diem)
  - Documents (Pay Summary, Year Summary, OOOI Capture)
  - Settings shortcut
- **Career Tab (NEW - Dedicated Career Intelligence)**: Top-level tab for career-level insights with three-section architecture
  - **Section Navigation**: Segmented control for switching between Benchmarks, Simulation, and Earnings
  - **1. Career Benchmarks (Present Performance)**: Contract-accurate, seniority-driven career pay intelligence
    - **Data Model**: PayBenchmark table with airline, effectiveDate, seat, yearOfService, hourlyRateCents, payAtGuaranteeCents, avgLinePayCents, avgTotalPayCents, sourceNote
    - **MVP Dataset**: UPS Contract Extension TA – 2025 (dataset_id: ups_contract_extension_ta_2025)
      - Effective: Sep 1, 2025
      - Source: UPS / IPA Contract Extension TA pay table numbers
      - Guarantee: 975-hour annual (75 hours/month)
      - FO and Captain rates for years 1-15
      - Avg Line Pay based on 1018.3 paid hours
      - Avg Total Pay based on 1223.2 (Capt) / 1123.4 (FO) paid hours
    - **UI Display**: Shows "Using: Contract Extension TA – 2025 (Effective Sep 1, 2025)" prominently
    - **User Comparison**: YTD earnings, projected annual, delta from Guaranteed Avg (not generic avg)
    - **Projection Note**: "Projection assumes similar flying pace, trip pickups, and premium pay throughout the year."
    - **Contractual Guarantee Configuration**:
      - Display Monthly Guaranteed Hours prominently
      - Default value auto-populates based on airline/contract
      - Edit button to manually adjust guarantee
      - "User-adjusted guarantee" label when edited
      - Reset to Contract Default option
      - Drives all guarantee-based percentages in real time
    - **Performance Comparisons with Context**: Info icons with expandable explanations:
      - vs Guarantee: "You're flying X% of your defined contractual guarantee"
      - vs Average Line Holder: "You're flying significantly more than the typical scheduled line holder"
      - vs Average Total: "Even including paid vacation averages, your earnings exceed peers"
    - **Career Insight System**: Auto-generated, priority-ranked, airline-specific insights
      - Only one insight displays at a time (highest priority wins)
      - Priority Order: Senior FO Advantage → Captain Leverage → OE/Displacement → Premium Strategy → Neutral/QoL
    - **Pay Scale Table**: Seat toggle (FO/Captain) with full pay scale display
    - **Design Principles**: Main screens stay simple; exploration behind arrows/icons; language is analytical, neutral, pilot-credible
  - **2. Upgrade Simulation (Future Scenarios)**: Dedicated section for future decision-making
    - **Profile Summary**: Read-only display of Airline, Fleet, Current Seat, Company Year (from DOH)
    - **Scenario Configuration**:
      - Upgrade to Captain at Year (user-adjustable)
      - Compare Against FO Year (user-adjustable)
      - Supports scenarios like FO Year 4 → Captain Year 7, FO Year 6 → Captain Year 10
    - **Upgrade Pay Logic (CRITICAL)**:
      - **REMOVED** Captain Year 1 reset logic
      - Captain pay year maps directly to total company seniority
      - Auto-populates and auto-advances yearly using Date of Hire
    - **Upgrade Earnings Comparison Table**: Shows FO earnings, Captain earnings, Net difference (upgrade leverage)
    - **Career Context Tie-in (NEW)**: Subtle, non-interactive line near bottom:
      - "Career context: Your historical career average is ~$___ per year across ___ years."
      - Tapping navigates to Lifetime Earnings section
      - Does NOT affect simulation calculations
    - **Disclaimer**: "Estimates based on published pay tables and average utilization."
  - **3. Lifetime Earnings (Historical Record)**: New section for historical earnings tracking
    - **Purpose**: Historical gross earnings at current airline only
    - **Combines Two Sources**:
      - App-tracked earnings from signup forward (automatic)
      - Optional user-entered earnings for prior years (one-time setup)
    - **Summary Stats**: Total Career Earnings, Years Active, Average Annual, Highest/Lowest Year
    - **Year-by-Year Breakdown**: Table with year, earnings, source (user/app), status (finalized/in-progress)
    - **Add Prior Earnings (Optional, One-Time)**:
      - Only accessible inside Lifetime Earnings section
      - Not shown during onboarding
      - Label: "Add Prior Earnings (Optional)"
      - Scope: Current airline only, 3-5 prior years max, annual gross only
      - No flight-level or schedule-level reconstruction
    - **Automatic Yearly Tracking (Critical)**:
      - After prior years entered, all future years track automatically
      - Historical years: Entered once, immutable, labeled "User-verified"
      - Current year: Tracked in real-time, labeled "In Progress"
      - Year-end rollover: Auto-finalizes year, adds to lifetime, starts next at $0
    - **Editing Controls**: Add/edit/remove prior years (user-entered only)
    - **Trust Line**: "Includes user-verified historical earnings and app-tracked totals"
    - **Strict Separation (Non-negotiable)**:
      - Does NOT affect Career Benchmarks
      - Does NOT affect Upgrade Simulation
      - Does NOT affect projections or insights
      - Historical only: Benchmarks = present, Simulation = future, Lifetime = past
- **Pay Review (Statement Mirror)**: Project, reconcile, and audit pay with company-style statement format
  - Upload actual pay statements (PDF/image) for OCR parsing
  - Build template from company format
  - Generate projected statements from trips/events/rules
  - "What Changed?" diff view showing estimate changes
  - Reconciliation comparing actual vs projected
  - Pay Audit Checklist with health score
- **30-in-7 Compliance**: Real-time tracking of FAR 30-in-7 block time limits
- **Profile Setup**: Required profile completion for new users with pilot information
  - **Airline**: Locked to UPS - this app is built by a UPS pilot for UPS pilots
  - All terminology, pay codes, and contract rules are configured for the UPS CBA
- **Pay Rules Engine**: User-configurable, airline-agnostic pay calculation rules
- **Pay Events (Log Event Tab - V2 Redesign)**: Structured pay-protection and documentation tool for recording contract-relevant pay triggers
  - **Event Type Selection (Required)**: 10 event types with color-coded icons
    - Schedule Change, Duty Extension, Reassignment, Premium Trigger, Pay Protection
    - Junior Assignment, Training, Deadhead, Reserve Activation, Other (muted)
    - Event type drives required fields, pay impact preview, and auto-suggestions
  - **Event Description (Required)**: "What changed?" field with auto-populated suggestions
    - Suggested descriptions based on event type (e.g., "Reassigned after report time")
    - User may edit but cannot leave blank
  - **Event Date (Required)**: Pre-filled to current date, user-editable with date picker
  - **Pay Impact Preview (Auto-Generated, Read-Only)**: Shows potential pay impact after event type selection
    - Estimated credit affected
    - Possible premiums triggered (e.g., "Pay protection", "Reassignment premium")
    - Confidence level: High / Medium / Low
  - **Contact Details (Conditionally Required)**: For Schedule Change, Duty Extension, Reassignment, Premium Trigger, Pay Protection, Junior Assignment
    - Crew Scheduling Rep Name (required for listed types)
    - Contact Method (Phone / ACARS / Message / Other) - required for listed types
    - Contact Time (optional but encouraged) - time zone auto-inferred
  - **Additional Notes (Optional)**: Free-text for clarifications, sequence of events, follow-up instructions
  - **Attachments/Proof (Optional but Prominent)**: Upload screenshots, photos, PDFs
    - Encouraged for crew scheduling messages, trip board changes, pay statements
    - Multiple attachments allowed
  - **Event Status (Required)**: Open (default), Resolved, Disputed
    - Open events surface in Dashboard "Action Needed"
    - Resolved events suppress alerts
    - Disputed reserved for grievance workflows
  - **Trip Linking (Auto if Possible)**: Auto-link to existing trip, display read-only trip identifier
  - **Save Event Button**: Disabled until all required fields completed, strong visual emphasis when enabled
  - Form validation with clear error messages for missing required fields
  - Events linked to trips for improved pay confidence scoring
- **Airline Glossary**: Reference-only mapping of airline-specific terminology to universal pay event keys

## Navigation

- 6 main tabs: Dashboard, Trips, Log Event, Records (Audit Trail), Career, Tools
- Auth flow: Welcome -> Sign In / Create Account -> Profile Setup (if incomplete) -> Main App
- Settings screen accessible from Dashboard and Tools
- **Career Tab**: Dedicated tab for career-level insights, upgrade simulation, and earnings comparison
  - Career Pay Benchmarks with pay scale comparison
  - Upgrade simulation with seniority-driven calculations
  - Career insights and performance vs benchmarks

### Authentication & Session Management

The app includes robust authentication handling designed to **never** unexpectedly log users out:

- **Session Persistence**: Sessions are stored in SecureStore and persist across app restarts
- **Session Flag**: A persistent flag tracks if user has ever logged in - prevents false logout loops
- **Auto-Refresh**: Sessions are automatically refreshed when the app comes to foreground and every 5 minutes
- **Retry Logic**: Sign-in attempts include automatic retry for network failures (3 attempts with exponential backoff)
- **Graceful Degradation**: Network errors don't log users out - stored sessions remain valid
- **Trust Previous Sessions**: If user previously had a valid session, app trusts it even during temporary auth failures
- **Explicit Sign-Out Only**: Users are only logged out when they explicitly tap "Sign Out" in Settings
- **Clear Error Messages**: User-friendly error messages for common issues (invalid credentials, network problems, rate limiting)
- **Password Reset**: Simple password reset flow available from sign-in screen (enter email → get code → set new password)

### Session Security

The app uses secure token storage for authentication:

- **SecureStore**: Auth tokens stored in device's secure enclave (Keychain on iOS, Keystore on Android)
- **Auto-Refresh**: Sessions refresh automatically when app comes to foreground
- **Persistent Sessions**: 1-year session duration with 30-day refresh window
- **Explicit Sign-Out**: Users must explicitly sign out - app never auto-logs out

**Note:** The app is trip-centric. The "Log Event" tab (previously "Log Pay") is for documenting pay-affecting events like schedule changes, duty extensions, and reassignments. Manual flight entry is available within Trip -> Segments for block/credit entry as a fallback.

## Profile Setup

New users must complete their profile before accessing the app. The profile includes:

- **Identity**: First name, last name, GEMS ID
- **Dates**: Date of Hire (DOH), Date of Birth (DOB) with calculated retirement date (age 65)
- **Pilot Settings**:
  - Position (FO/CPT)
  - **Airline**: Locked to UPS (built by a UPS pilot for UPS pilots)
  - Base: Select from UPS bases (ANC/ONT/SDF/SDFZ/MIA)
  - Hourly Rate (auto-populates throughout the app for pay calculations)

### Data Synchronization

Profile data flows throughout the entire app:
- **Hourly Rate**: Used for all pay calculations in Dashboard, Trips, and Tools
- **Position & Base**: Displayed in profile sections and used for filtering/grouping
- **Airline**: Always UPS - all terminology, pay codes, and contract rules use UPS CBA

### Anniversary Feature
On the user's work anniversary (DOH), a celebration banner displays on the dashboard.

### Clear All Data & Reset
Users can reset their profile and all flight data from Settings, which returns them to the profile setup screen.

## Backend API

The backend runs on Hono with Prisma/SQLite and provides a complete API for the pilot pay tracking functionality.

### Auth
- `GET/POST /api/auth/*` - Better Auth endpoints (sign-in, sign-up, sessions)

### Flights
- `GET /api/flights` - List flight entries with optional date filters
- `POST /api/flights` - Create flight entry (auto-calculates pay with overage)
- `DELETE /api/flights/:id` - Delete a flight entry

### Dashboard
- `GET /api/dashboard` - Current pay period summary, totals, recent flights

### Trips (Full CRUD)
- `GET /api/trips` - List trips with date range and status filters
- `GET /api/trips/:id` - Get single trip with duty days, legs, and events
- `POST /api/trips` - Create trip
- `PUT /api/trips/:id` - Update trip (credit/block times editable, est pay auto-calculates)
- `DELETE /api/trips/:id` - Delete trip (cascade deletes duty days/legs)
- `POST /api/trips/:id/duty-days` - Add duty day to trip
- `POST /api/trips/duty-days/:id/legs` - Add leg to duty day
- `PUT /api/trips/legs/:id` - Update leg with OOOI times
- `DELETE /api/trips/legs/:id` - Delete leg
- `PUT /api/trips/duty-days/:id/schedule-change` - Apply schedule change or override to duty day
  - Records schedule changes (reassignment, reroute, timing change, leg added/removed)
  - Supports override mode for persistent changes through future imports
  - Applies premium pay codes (JA, RA, EXT, LA) with credit calculation
  - Auto-creates PayEvent log for audit trail

### Trips Display
- Each duty day displays as its own card with clear date visibility
- Cards show: date, trip number, origin → destination, departure/arrival times
- Stats row: block time, credit time, leg count, estimated pay
- Estimated pay auto-calculates from credit hours × profile hourly rate
- Tapping a card opens the trip detail drawer for editing

### Schedule Parsing (OCR-Based)
- `POST /api/schedule/parse` - Upload and parse schedule screenshots using Tesseract.js OCR
  - Supports: Trip Board Browser, Trip Board Trip Details, Crew Access Trip Info
  - Auto-classifies source type and builds proper timeline hierarchy
  - Creates layovers with nested hotel/transport info
  - Crew Access trip info screenshots now properly create trips with duty days
  - Enrichment-only uploads (hotel/transport without trip info) attach to existing trips
  - Fixed cache handling to properly preserve OCR text on duplicate image detection
  - **CML-Compliant Layover Extraction**: Extracts L/O (layover) times from both formats:
    - BidPro Trip Details: Parses L/O column values after credit (Cr) column
    - Crew Access: Extracts REST times from "Duty totals" rows
    - Layover calculation per CML: Rest = next duty START − prior duty END
  - **Authoritative Credit Totals**: Uses footer totals (Credit: XX:XX) as authoritative source
    - BidPro footer "Credit: 43:42T" is parsed and used directly
    - Does NOT recalculate by summing duty day credits (which may miss trip/duty rig)
    - Ensures Trip Board and Crew Access imports produce identical credit totals
  - **Stable Import Pipeline**: Uses `importScheduleStable()` which:
    - Creates evidence record FIRST (processing state) before parsing
    - Never crashes on `undefined` values or malformed JSON
    - Safely handles `parsed.sourceType.value` vs `parsed.sourceType` formats
    - Updates evidence with success/partial/failed status after parsing
  - **Safe Field Access**: `getSourceTypeValue()` and `getFieldValue()` helpers prevent crashes
  - **Crew Access Parser (Enhanced)**: Precise parsing for Trip Information table format:
    - Extracts trip start date from "Date: DDMonYYYY" header
    - Parses day/flight rows with pattern: "N Day Flight DEP-ARR Times..."
    - Handles OCR quirks: "DHDL3195" → DH + flight 3195, "RED" → "RFD" correction
    - Strategy 1: Day-based parsing for primary extraction
    - Strategy 2: Route fallback catches missed flights from OCR issues
    - Correctly assigns dates to each flight based on day number
    - Detects deadhead flights (DH prefix patterns)
    - Extracts flight numbers, equipment (767/757), block times
  - **Enhanced Hotel/Transport Extraction (NEW)**: Airline-grade parsing for hotel and transportation rows
    - **Crew Access Hotel Details**: Parses "Hotel details Status: BOOKED Hotel: [Name] Phone: [###-###-####]"
    - **Hotel Brand Detection**: Recognizes 80+ hotel brands (Marriott, Hilton, Hyatt, IHG, Wyndham, etc.)
    - **Transport Parsing**: Extracts "Hotel Transport Phone: [###]" and shuttle/van notes
    - **Station Association**: Automatically associates hotels with the correct layover airport (arrival of final leg)
    - **Address Extraction**: Captures hotel addresses when visible
    - **Phone Normalization**: Strips formatting from phone numbers (###-###-#### → ##########)
    - **Confidence Scoring**: Low-confidence hotel/transport fields flagged for user review
    - **AI Double-Check**: OpenAI GPT-4o Vision extracts hotels/transport with dedicated JSON arrays
    - **Merge Logic**: Combines hotel info from multiple sources (OCR, AI, user directory)
- `DELETE /api/schedule/clear-cache` - Clear parse cache for fresh re-parsing
- `GET /api/schedule/timeline` - Get trips timeline grouped by date
- `DELETE /api/schedule/clear` - Clear trips for a month or all (also clears cache)
- `POST /api/schedule/events` - Create event manually
- `PUT /api/schedule/events/:id` - Update event
- `DELETE /api/schedule/events/:id` - Delete event
- `GET /api/schedule/hotels` - Get hotel suggestions for an airport

### Schedule Snapshots (Trip Board Change Detection - NEW)
- `POST /api/schedule/snapshot` - Create new Trip Board snapshot and detect changes
  - Parses uploaded screenshots into structured schedule data
  - Compares against previous snapshot to detect changes
  - Categorizes changes: TRIP_ADDED, TRIP_REMOVED, LEG_ADDED, LEG_REMOVED, TIME_CHANGE, DH_CHANGE, CREDIT_CHANGE
  - Calculates pay impact and suggests pay events to log
- `GET /api/schedule/snapshots` - List all snapshots with reminder settings
- `GET /api/schedule/snapshots/:id` - Get snapshot with detected changes
- `GET /api/schedule/changes` - Get schedule changes with filters
- `POST /api/schedule/changes/:id/acknowledge` - Acknowledge change, optionally create pay event
- `PUT /api/schedule/reminder-settings` - Update reminder frequency (48-72 hours)
- `GET /api/schedule/reminder-status` - Check if user should update Trip Board
- `POST /api/schedule/backfill` - Backfill DutyDays and Legs for existing trips (auto-called on trips screen load)

### Compliance (30-in-7)
- `GET /api/compliance/30-in-7` - Get 30-in-7 status (rolling 7-day block time)
- `GET /api/compliance/30-in-7/projection` - Project future 30-in-7 status

### Late Arrival Pay (LP Calculator) - UPS Only

The Late Arrival Pay Calculator is a UPS-specific tool for calculating LP1, LP2, and RJA premium codes.

**Premium Codes:**
| Code | Multiplier | Threshold | Contract Reference |
|------|------------|-----------|-------------------|
| LP1 | 150% (1.5x) | Delay > 4 hours from scheduled trip end | 13.E.4.e.(1),(2) |
| LP2 | 250% (2.5x) | Delay > 25h domestic / > 50h international | 13.E.5.c |
| RJA | 150% (1.5x) | Arrival > 2 hours into calendar day off | 13.B.6.c.(2)(a) |

**Auto-Select Logic:**
1. Check RJA first (highest priority if arrival > 2h into day off)
2. Check LP2 (domestic > 25h late, international > 50h late)
3. Check LP1 (> 4h late from scheduled trip end)
4. If none apply, show "Not Eligible"

#### Leg-Level OOOI Integration (NEW)

Late Arrival Pay now uses OOOI (OUT/OFF/ON/IN) times as the primary source of truth for accurate calculations:

**Trip & Leg Selection Flow:**
1. User selects a Trip from the list
2. Trip expands to show ALL flight legs (line-by-line)
3. User selects a specific flight leg
4. System auto-fetches OOOI times for that leg
5. Calculation uses the most accurate time source available

**OOOI Auto-Fetch:**
- When a leg is selected, the system immediately checks for existing OOOI data
- If OOOI exists: Shows "OOOI Detected" badge with OUT/OFF/ON/IN times displayed
- If OOOI missing: Shows "OOOI Missing" state with upload prompt

**Time Source Priority (Source of Truth):**
1. **OOOI** - Primary (OUT/OFF/ON/IN times from ACARS/Crew Access)
2. **Actual** - Secondary (partial actual times if OOOI incomplete)
3. **Scheduled** - Fallback (scheduled times only)
4. **Manual** - Override (pilot-entered times with required reason)

**Leg-Scoped Proof Uploads:**
- All proof uploads are tied to the selected leg (not trip-level)
- Supports camera and gallery uploads
- Tip displayed: "Upload your ACARS or Crew Access screenshot — we'll extract OUT/OFF/ON/IN automatically"
- Proof attachments linked to leg ID for audit trail

**Manual Override (Always Allowed):**
- Pilot can always override auto-filled OOOI times
- If OOOI existed, override requires a reason note
- Override reason is logged for audit/grievance support
- Time source changes to "manual" when overridden

**Data Stored for Audit:**
- trip_id, leg_id, flight_number, route
- OOOI times (if used): OUT/OFF/ON/IN
- time_source_used: "OOOI" | "actual" | "scheduled" | "manual"
- Calculated minutes late and premium code applied
- Override notes (if any)
- All data supports grievance PDF generation

**Features:**
- Trip selector with leg-level expansion and OOOI badges
- OOOI Display Card showing OUT/OFF/ON/IN times with source indicator
- Required times: Scheduled Trip End, Actual Trip End, Day Off Start (for RJA)
- Delay reason toggles: WX (Weather) / MX (Maintenance) / Other
- EDW (Extended Duty Workday) toggle
- Basis hours: Auto from trip or manual entry (HH:MM)
- Proof attachments via camera or gallery (leg-scoped)
- Live calculation with confidence badge (Exact vs Needs Basis)
- Time source indicator in results card
- Save as Log Event (creates PayEvent with leg info, OOOI, and all calculation details)

**Calculation Formula:**
```
premium_pay = basis_hours × multiplier × hourly_rate
```

**API Endpoints (Legacy):**
- `GET /api/lap` - List LAP entries with filters (tripId, startDate, endDate, status)
- `GET /api/lap/:id` - Get single LAP entry with proof attachments
- `POST /api/lap` - Create LAP entry for a trip
- `PUT /api/lap/:id` - Update LAP entry (recalculates automatically)
- `DELETE /api/lap/:id` - Delete LAP entry
- `POST /api/lap/:id/proof` - Upload proof attachment to LAP entry
- `DELETE /api/lap/:id/proof/:proofId` - Delete proof attachment
- `POST /api/lap/calculate` - Calculate LAP without saving (preview mode)
- `POST /api/lap/:id/generate-pdf` - Generate grievance PDF document
- `POST /api/lap/:id/polish-explanation` - AI polish explanation for grievance

### Profile
- `GET /api/profile` - Get pilot profile with isComplete flag
- `PUT /api/profile` - Update profile
- `DELETE /api/profile` - Clear all user data and reset profile
- `GET /api/profile/stats` - Get statistics (all-time, year, month totals)

### Pay Periods
- `GET /api/pay-periods` - List all UPS pay periods
- `GET /api/pay-periods/current` - Get current pay period with user totals
- `GET /api/pay-periods/next-pay-date` - Get next pay date and days until
- `GET /api/pay-periods/:year/:period` - Get specific period with flights

### Pay Rules Engine (NEW)
- `GET /api/pay-rules` - List pay rules with optional filters
- `GET /api/pay-rules/:id` - Get single rule
- `POST /api/pay-rules` - Create custom pay rule
- `PUT /api/pay-rules/:id` - Update pay rule
- `DELETE /api/pay-rules/:id` - Delete pay rule
- `POST /api/pay-rules/init-defaults` - Initialize default rules for new users
- `GET /api/pay-rules/categories` - List rule categories
- `POST /api/pay-rules/categories` - Create rule category
- `DELETE /api/pay-rules/categories/:id` - Delete category
- `GET /api/pay-rules/applications` - Get rule application history

### Pay Events (NEW)
- `GET /api/pay-events` - List pay events with filters
- `GET /api/pay-events/:id` - Get single event with documentation
- `POST /api/pay-events` - Log new pay event
- `PUT /api/pay-events/:id` - Update pay event
- `DELETE /api/pay-events/:id` - Delete pay event
- `POST /api/pay-events/:id/documents` - Add documentation to event
- `DELETE /api/pay-events/:eventId/documents/:docId` - Delete document
- `GET /api/pay-events/summary` - Get event summary statistics

### Projections (NEW)
- `GET /api/projections` - Get earnings projections (pay period, month, year)
- `POST /api/projections/goal` - Calculate required pace for income goal
- `POST /api/projections/what-if` - Model what-if scenarios for additional flying
- `GET /api/projections/history` - Get historical monthly earnings data

### Pay Statement Mirror (NEW)
- `POST /api/pay-statements/upload` - Upload pay statement (PDF/image)
- `POST /api/pay-statements/:uploadId/parse` - Parse uploaded statement with OCR
- `GET /api/pay-statements/pay-periods/:payPeriodId/actual-statement` - Get parsed actual statement
- `GET /api/pay-statements/pay-periods/:payPeriodId/projected-statement` - Get projected statement
- `POST /api/pay-statements/pay-periods/:payPeriodId/projected-statement/recalculate` - Recalculate and get diff
- `POST /api/pay-statements/pay-periods/:payPeriodId/reconciliation/run` - Run actual vs projected reconciliation
- `POST /api/pay-statements/pay-periods/:payPeriodId/audit/run` - Run pay audit checklist
- `POST /api/pay-statements/pay-periods/:payPeriodId/export` - Export pay review packet
- `GET /api/pay-statements/exports/:packetId/status` - Get export status

### AI Pay Explanations (NEW)
- `GET /api/ai/status` - Check available AI services (OpenAI, Anthropic, etc.)
- `POST /api/ai/pay-explanation` - Generate AI explanation for pay statement section
  - **Request body**: `{ section, projectedData, actualData?, context }`
  - **Sections**: FULL_STATEMENT, EARNINGS, TAXES, DEDUCTIONS, REIMBURSEMENTS, NET_PAY, DIFFERENCE
  - **Response**: Key drivers, matched/differed items, benchmark context, verification status, suggested actions
  - **Verification statuses**: VERIFIED, ESTIMATED, MISMATCH, REVIEW_RECOMMENDED

### Settings
- `GET /api/settings` - Get user settings (hourly rate, airline)
- `PUT /api/settings` - Update user settings

## Database Schema

### Core Models
- **Profile**: UPS pilot info (firstName, lastName, gemsId, position, base, hourlyRateCents, airline=UPS)
- **FlightEntry**: Individual flight logs with full OOOI times, pay calculations, premium codes
- **Trip**: Trip pairings with date range and totals
- **DutyDay**: Duty days within trips with minimum credit guarantee (6:00 hours)
- **Leg**: Flight segments with scheduled/actual times, OOOI proofs

### Supporting Models
- **ScheduleBatch/ScheduleEvent**: Schedule import tracking
- **ScheduleSnapshot**: Trip Board snapshots for change detection (NEW)
- **ScheduleChange**: Detected schedule changes with pay impact (NEW)
- **ScheduleReminderSettings**: User preferences for import reminders (NEW)
- **IROSegment**: Relief pilot seat timer segments
- **PayPeriod**: Pay period calendar (2026)
- **AircraftCache/AirportCache**: Enrichment data caching
- **PayRuleCategory**: Groups of related pay rules
- **PayRule**: User-configurable pay calculation rules
- **PayRuleApplication**: Audit trail of rule applications
- **PayEvent**: Pay-affecting events (schedule changes, extensions, etc.)
- **PayEventDocument**: Documentation attached to pay events
- **PayStatementUpload**: Uploaded pay statement files (PDF/image)
- **StatementTemplate**: Company-style statement format template
- **ActualStatement**: Parsed actual statement data
- **ProjectedStatement**: Generated projected statement
- **StatementDiff**: What changed diff records
- **ReconciliationResult**: Actual vs projected comparison
- **PayAuditChecklist**: Pay health audit results
- **ExportPacket**: Pay review packet exports

## Pay Calculation Logic

### User-Configurable Pay Rules (NEW)

The Pay Rules Engine allows pilots to define their own pay calculation rules, making the app work across any airline:

**Rule Types:**
- **GUARANTEE**: Minimum credit/pay thresholds (e.g., 6:00 daily minimum)
- **PREMIUM_ADD**: Add fixed time/pay (e.g., +2:00 for airport reserve)
- **PREMIUM_MULTIPLY**: Multiply credit/pay (e.g., 1.5x for overtime)
- **THRESHOLD**: Triggered when value exceeds threshold
- **LIMIT**: Maximum values (e.g., 30-in-7 block limit)

**Rule Scopes:**
- DAILY: Per duty day
- TRIP: Per trip/pairing
- PAY_PERIOD: Per pay period
- MONTHLY: Per calendar month
- YEARLY: Per calendar year
- ROLLING: Rolling window (e.g., 7 days)

**Default Rules Include:**
- Minimum Daily Credit (6:00)
- Airport Reserve Premium (+2:00)
- Short Visit Turnaround (+2:00)
- Long Range Premium (+6:00)
- Time and a Half (1.5x)
- 30-in-7 Block Limit (30:00 max)
- 100-in-28 Block Limit (100:00 max)
- Schedule Change Pay Protection
- Duty Extension Premium

### Premium Pay Codes (Legacy/Reference)
- **AP0-AP9**: Airport reserve premium (+2:00 hours)
- **SVT**: Short visit turnaround (+2:00)
- **LRP**: Long range premium (+6:00)
- **LP1/LP2/LPT/RJA**: Multiplier premiums (1.5x-2.5x)

### Calculation Formula
```
adjustedCredit = applyPremium(creditMinutes, premiumCode)
basePay = adjustedCredit * hourlyRate
overage = max(0, blockMinutes - creditMinutes)
overagePay = overage * hourlyRate
totalPay = basePay + overagePay + flatPremiumAmount
```

### Key Rules
- **Minimum Daily Guarantee**: 6:00 hours per duty day (applied at duty day level)
- **Overage**: Block time exceeding credit is paid at hourly rate
- **Default Hourly Rate**: $325/hr (32500 cents)
- **Per Diem Rates** (per hour of TAFB):
  - **Domestic**: $3.50/hr
  - **International**: $4.20/hr
  - **Asia**: $3.90/hr
  - **Europe**: $3.85/hr

## 30-in-7 Compliance

Tracks FAR 30-in-7 rule (max 30 block hours in any 7 consecutive days):
- **Green**: < 27 hours - safe
- **Yellow**: 27-30 hours - caution
- **Red**: >= 30 hours - over limit

## Design

- Dark theme with slate/navy background
- Amber/gold accent colors
- Smooth animations using react-native-reanimated
- Haptic feedback for interactive elements

## Tech Stack

### Frontend
- Expo SDK 53 / React Native 0.76.7
- NativeWind (TailwindCSS) for styling
- React Query for server state
- Zustand for local state management
- react-native-reanimated for animations
- lucide-react-native for icons

### Backend
- Bun runtime
- Hono web framework
- Prisma ORM with SQLite
- Better Auth for authentication

### Performance Optimizations (V1.1)
- **Database Indexes**: Composite indexes on frequently queried columns (userId + startDate + endDate for trips, userId + status for filtered queries)
- **Query Efficiency**: Backend uses `select` to fetch only required fields, reducing payload size by ~60%
- **React Query Caching**: Optimized stale times (2 min for dashboard, 1 min for trips) with garbage collection times
- **Reduced Logging**: Production builds skip verbose console logging for faster response times

### Schedule Upload Optimizations (V1.3) - Scales to Thousands of Pilots
- **Queue-Based Processing**: Upload returns immediately with job ID, processing happens in background
  - New API: `POST /api/schedule/parse-async` - Queue upload job
  - New API: `GET /api/schedule/job-status/:id` - Poll job status
  - Jobs processed by background worker with configurable concurrency
  - Database table: `UploadJob` tracks status, progress, and results
- **Parallel Image Processing**: Multiple images processed simultaneously (up to 3 concurrent)
  - Reduces multi-image upload time by 60-70%
  - Each image runs OCR/parsing in parallel
- **Smart AI Skipping**: Only calls OpenAI Vision when OCR confidence < 70%
  - High-confidence OCR results skip AI verification entirely
  - Saves ~12 seconds per image when OCR is confident
  - Reduces OpenAI API costs significantly
- **Parallel Hotel Prefetch**: All layover hotels fetched in parallel before trip creation
  - Uses `Promise.all()` for concurrent database lookups
  - Reduces hotel lookup time from O(n) to O(1)
- **Frontend Async API**: New `parseScheduleWithPolling()` helper for async uploads
  - Automatic polling until job completes
  - Progress callback for UI updates
  - Graceful fallback to sync API if async fails

### Analytics & Support (V1.2)
- **PostHog Analytics**: User activity tracking, feature usage, session analytics
  - Configure via `EXPO_PUBLIC_POSTHOG_API_KEY` environment variable
  - Tracks sign-ups, feature usage, errors
- **Report Issue Feature**: In-app feedback system in Settings
  - Bug reports, feature requests, questions
  - Includes device info and app version automatically
- **Admin Dashboard API**: Backend endpoints for monitoring
  - User stats (total, active today, onboarding rate)
  - Trip and pay event counts
  - Issue tracking and management
  - Protected by `ADMIN_SECRET` header

### Admin API Endpoints
- `GET /api/admin/stats` - Overall app statistics (users, trips, issues)
- `GET /api/admin/issues` - List all issue reports with filters
- `PUT /api/admin/issues/:id` - Update issue status/notes
- `GET /api/admin/users` - Search users by email
- `GET /api/admin/users/:id` - Get user details and activity
- All admin endpoints require `x-admin-secret` header

## TODO

- [x] Connect dashboard to backend for real pay data
- [x] Add flight entry persistence
- [x] Implement pay calculation logic with premium codes
- [x] Add 30-in-7 compliance tracking
- [x] Create trips/duty days/legs management
- [x] Add pilot profile with stats
- [x] Implement UPS pay period calendar
- [x] Add required profile setup flow for new users
- [x] Add anniversary banner on DOH
- [x] Add clear all data & reset functionality
- [x] Implement schedule upload and parsing (Vision AI)
- [x] Add Trips timeline screen with event cards
- [x] Add layover countdown timer
- [x] Add shared hotel/transport library
- [x] Implement free OCR-based schedule parsing (Tesseract.js)
- [x] Add image preprocessing for optimal OCR (auto-crop, contrast, resize)
- [x] Add image hash caching and deduplication
- [x] Add diff-merge logic for schedule updates
- [x] Add confidence scoring with low-confidence UI warnings
- [x] Improved Crew Access parsing with multi-strategy approach:
  - Multiple flight pattern detection strategies
  - HHMM and HH:MM time format support
  - Automatic fallback to OpenAI Vision when OCR fails to find flights
  - Enhanced airport code filtering to reduce false positives
- [x] Add OOOI module with OCR parsing for ACARS screenshots
- [x] Connect frontend to new trip management APIs
- [x] Add full Trips tab UI with React Query integration
- [x] Add OOOI capture flow with camera
- [x] Add leg management (add/edit)
- [x] Add OOOI proof photo storage
- [x] Add Pay Rules Engine (user-configurable rules)
- [x] Add Pay Events logging (schedule changes, extensions, etc.)
- [x] Build Projections feature (earnings forecast, goal setting)
- [x] Wire up Tools tab calculators (Pay Calculator, 30-in-7 Tracker, Per Diem)
- [x] Build Pay Dashboard with confidence-first design (8 priority-ordered cards)
- [x] Redesign Trips tab as Schedule + Pay Ops Center
  - [x] Add Calendar view with trip blocks spanning days
  - [x] Add List view with enhanced trip cards (pay status, proof badges)
  - [x] Add Trip Detail Drawer with tabs (Segments/Pay/Events/Proof/Notes)
  - [x] Add Import Schedule modal with camera/gallery flow
  - [x] Add swipe actions for quick trip operations
  - [x] Add discrepancy flags with neutral language
- [x] Wire up Add Pay Event buttons (navigate to Pay Events screen)
- [x] Add Event Detail modal with status updates
- [x] Add Import History view with grouped imports
- [x] Add dynamic confidence calculation in Trip Detail Pay tab
- [x] Wire up Verify Pay button in Trip Detail drawer
- [x] Replace "Log Pay" tab with "Log Event" tab (trip-centric architecture)
- [x] Redesign Log Event screen with Holy Grail specification
  - [x] Add Related Trip selector with auto-detection
  - [x] Add Primary/Secondary event type categorization
  - [x] Add Smart Context Questions
  - [x] Add Smart Title auto-generation
  - [x] Add Structured Details fields (Rep Name, Contact Time, Notes)
  - [x] Add Proof Attachment with Camera/Gallery
  - [x] Add Impact Preview indicator
  - [x] Add Post-Save confirmation with next steps
- [x] Add Trip Board snapshot-based change detection
  - [x] Add ScheduleSnapshot model for storing schedule versions
  - [x] Add snapshot comparison logic (trips/legs/times/DH/credit)
  - [x] Add Changes Detected modal with diff visualization
  - [x] Add AI suggestions for pay event logging from changes
  - [x] Add reminder system for re-importing (48-72 hours)
  - [x] Add "Update Schedule" banner when stale
- [x] Add Subscription/Paywall System
  - [x] Add paywall screen with 7-day free trial and premium tiers
  - [x] Add TrialStatusBanner for dashboard
  - [x] Add TrialExpiredModal for expired trial prompts
  - [x] Add LockedFeatureTooltip for premium feature indicators
  - [x] Add subscription state management with Zustand

## Subscription System

The app includes a subscription system with trial and premium tiers:

### Tiers
- **Free**: Basic access with limited features
- **Trial**: 7-day free trial with full premium access
- **Premium**: Full access to all features ($9.99/month or $79.99/year)

### Components (src/components/subscription/)
- **TrialStatusBanner**: Shows trial status on dashboard (days remaining, upgrade prompts)
- **TrialExpiredModal**: Full-screen modal when trial expires
- **LockedFeatureTooltip**: Inline indicator for premium-only features
- **LockedOverlay**: Full overlay for locked screens/sections
- **PremiumGate**: Wrapper component that shows locked state for non-premium users
- **UpgradePromptCard**: Card component for upgrade prompts

### State Management (src/lib/subscriptionStore.ts)
- Zustand store with AsyncStorage persistence
- Tracks tier, trial dates, subscription dates
- Helper hooks: `useSubscriptionTier`, `useTrialDaysRemaining`, `useHasFeatureAccess`

### Integration
- Paywall screen at `/paywall` (modal presentation)
- TrialStatusBanner integrated in dashboard
- Ready for RevenueCat integration via Payments tab

## Airline Glossary

The glossary provides UPS-specific terminology mapped to universal pay event keys. This is a **reference-only** feature.

### Universal Pay Event Keys (Canonical)
- `schedule_change_after_report` - Assignment change after duty report
- `reassignment` - Trip/leg changed by scheduling
- `duty_extension` - Duty period extended beyond scheduled
- `premium_pay_trigger` - Qualifies for additional compensation
- `pay_protection_event` - Pay protection due to changes
- `deadhead_added` - Passenger travel assigned by company
- `training_event` - Training activity affecting pay
- `reserve_event` - Reserve duty activation
- `draft_event` - Involuntary assignment
- `per_diem_adjustment` - Per diem adjustment

### UPS Terminology
- **JA (Junior Available/Assignment)**: Involuntary assignment based on seniority
- **RA (Reassignment)**: Trip/leg changed by crew scheduling
- **DH (Deadhead)**: Passenger travel to/from assignments
- **CR (Call-Out/Ready)**: Reserve callout for duty
- **LRP (Long Range Premium)**: Premium for long-range international flying
- **AP (Airport Reserve Premium)**: Premium for airport reserve duty
- **SVT (Short Visit Turnaround)**: Premium for quick turns
- **EXT (Extension)**: Duty period extended
- **LAP (Late Arrival Pay)**: Premium for late arrivals

### Usage in App
- Glossary accessible from Tools tab
- All terminology uses UPS CBA language
- Clicking a term shows definition, example, and related universal event
- Terms are display/reference-only and never drive pay logic

## OOOI Module (src/lib/oooi/)

The OOOI (Out-Off-On-In) module provides flight time tracking via ACARS screenshot parsing:

### Files
- **types.ts**: Core types for trips, duty days, legs, and OOOI times with helper functions
- **store.ts**: Zustand store for managing trips, duty days, and legs with OOOI tracking
- **ocrClient.ts**: Free OCR.space API integration for extracting text from ACARS images
- **visionParser.ts**: Image parsing pipeline (OCR first, OpenAI Vision fallback)
- **scanHistoryStore.ts**: Tracks all ACARS scans with method used and links to legs

### Features
- Free OCR parsing via OCR.space API (500 calls/day)
- OpenAI Vision fallback for complex images (requires API key)
- ACARS text pattern matching for OOOI times extraction
- Automatic block/flight time calculation
- Minimum credit rule enforcement (6:00 per duty day)
- Scan history tracking with confidence scores

## Onboarding Flow (UPS-Only)

The app features a streamlined onboarding flow optimized for UPS pilots.

### Onboarding Flow (3 Steps)

**Step 1: UPS Configuration (Automatic)**
- Airline is automatically set to UPS (no selection required)
- UPS terminology pack loaded immediately
- Operator type set to "cargo"

**Step 2: Contract Upload (Optional)**
- Upload CBA/LOA/pay manual documents
- One-time disclaimer acceptance: "Documents used for reference only"
- Supported formats: PDF, DOC, TXT
- Multiple documents supported

**Step 3: Schedule Upload (Recommended)**
- Upload schedule snapshot (Trip Board or Crew Access screenshots)
- AI extracts trip details automatically
- Works with both Crew Access and Trip Board
- Can be skipped and configured later

### UPS Alias Pack

The app uses UPS-specific terminology throughout:

**Canonical Rules** (internal, never changes): `MIN_DAILY_CREDIT`, `TRIP_GUARANTEE`, `JUNIOR_ASSIGNMENT`, etc.

**UPS Display Labels**:
- `JUNIOR_ASSIGNMENT` → "JA (Junior Assignment)"
- `REASSIGNMENT` → "RA (Reassignment)"
- `AIRPORT_RESERVE` → "AP (Airport Reserve)"
- `MIN_DAILY_CREDIT` → "MDC (Minimum Daily Credit)"

## Pay Confidence Architecture

The app uses UPS contract-accurate pay calculations with verified confidence levels.

### Verified Pay Mode
- Automated premium pay calculations
- Pay stacking logic
- Minimum credit enforcement
- Verified dollar amounts
- Grievance-ready PDFs with calculated totals
- All outputs labeled as "Verified" for UPS

### Key Files

**Pay Confidence Logic:**
- `src/lib/data/airline-alias-packs.ts` - Contains UPS alias pack and helper functions
- `src/lib/state/pay-confidence-context.tsx` - React context providing pay confidence mode throughout the app
- `src/components/PayConfidenceBadge.tsx` - UI components for displaying pay confidence status

**Usage (Hooks):**
```typescript
import { usePayConfidence } from '@/lib/state/pay-confidence-context';

const { isVerified, confidenceLabel, formatPayAmount } = usePayConfidence();

// Format pay with confidence-appropriate display
const displayPay = formatPayAmount(12500); // "$125.00" (verified)
```

### Profile Indicator

After onboarding, the dashboard shows a profile indicator strip:
- `Profile: UPS • Contract refs active ✓`
- Tapping navigates to Settings for management

### Settings Integration

Settings screen now includes:
- **Airline & Terminology** section showing UPS (locked)

### Key Files

**Data & Types:**
- `src/lib/data/airline-alias-packs.ts` - Canonical rules and airline terminology packs
- `shared/contracts.ts` - Updated PilotProfile type with onboarding fields

**React Context:**
- `src/lib/state/alias-context.tsx` - AliasProvider and hooks for terminology

**Onboarding Screens:**
- `src/app/onboarding/airline-select.tsx` - Step 1
- `src/app/onboarding/contract-upload.tsx` - Step 2
- `src/app/onboarding/schedule-sync.tsx` - Step 3

**Database Changes:**
- Profile model extended with: `onboardingComplete`, `onboardingStep`, `aliasPackVersion`, `operatorType`, `contractMappingStatus`, `payRuleDefaultsApplied`

### Usage (Hooks)

```typescript
import { useAliasContext, useRuleDisplayName } from '@/lib/state/alias-context';

// Get full context
const { getDisplayName, getShortCode, glossary, airlineId } = useAliasContext();

// Get display name for a specific rule
const label = getDisplayName('MIN_DAILY_CREDIT'); // "Minimum Daily Credit" or "MDC" depending on airline

// Direct hook for single rule
const juniorLabel = useRuleDisplayName('JUNIOR_ASSIGNMENT'); // "JA", "Draft", or "Junior Manning"
```

## Contract Documents Feature (V1.5)

The Contract Documents feature allows users to upload their CBA, pay manual, LOAs, and company policies for AI reference context. **This is reference-only** — AI surfaces relevant sections but does not interpret contract terms or calculate entitlements.

### User Flow
1. **Upload**: Settings > Contract & Pay References > Upload Document
   - Supported formats: PDF, images (JPEG, PNG, WebP), Word documents
   - One-time disclaimer acceptance required
2. **Home Card**: Dashboard shows adoption card:
   - "Upload your contract (optional)" if no documents
   - "Contract references active" with document count if uploaded
3. **AI Context**: When events occur (schedule changes, pay events), AI surfaces relevant sections

### AI Behavior (Non-negotiable Guardrails)
**AI MAY:**
- Index headings/sections from uploaded documents
- Surface relevant excerpts based on event context
- Summarize what a section discusses in neutral language
- Link events to "Relevant section(s)" from user's documents

**AI MAY NOT:**
- Interpret entitlement
- Apply contract logic automatically
- Declare pay owed
- Accuse payroll/company error

### API Endpoints
- `GET /api/contracts` - List user's contract documents
- `GET /api/contracts/:id` - Get single contract with sections
- `POST /api/contracts/upload` - Upload contract (multipart/form-data)
- `PUT /api/contracts/:id` - Update contract metadata
- `DELETE /api/contracts/:id` - Delete contract and file
- `POST /api/contracts/:id/reparse` - Trigger re-parsing
- `GET /api/contracts/references` - Get AI references history
- `POST /api/contracts/search` - Search contract sections
- `POST /api/contracts/find-relevant` - AI finds relevant sections for event context
- `POST /api/contracts/references/:id/feedback` - User feedback on reference helpfulness
- `POST /api/contracts/references/:id/view` - Mark reference as viewed

### Database Models
- **ContractDocument**: User's uploaded documents with parse status, extracted text, metadata
- **ContractSection**: Indexed sections from parsed documents with topics and summaries
- **ContractReference**: Tracks when AI surfaces a section and user interaction

### Frontend Components
- **ContractReferencesScreen** (`/contract-references`): Upload/manage documents
- **ContractUploadCard**: Dashboard card for adoption
- **ContractReferenceCard**: Non-blocking module showing relevant sections at trigger points
- **useContracts hook**: React Query hooks for contract operations

### Trigger Points (Where AI Uses CBA)
- Detected schedule change (calendar/snapshot diff)
- User logs a pay event
- User creates a Pay Review Packet

### Integration Note
- App is built exclusively for UPS pilots - all terminology and contract rules are UPS-specific
- AI uses UPS terminology to match user vocabulary and improve retrieval cues

### Document Types
- CBA (Collective Bargaining Agreement)
- PAY_MANUAL (Pay Manual)
- LOA (Letter of Agreement)
- COMPANY_POLICY (Company Policy)
- OTHER (Other Document)

## Search My Contract (NEW)

The Search My Contract feature provides AI-assisted full-text search across uploaded contract documents. Users can find relevant sections using keywords, with automatic expansion to airline-specific terminology.

### Features
- **Keyword Search**: Search for terms like "junior assignment", "guarantee", "reassignment"
- **AI Keyword Suggestions**: AI suggests related terms based on airline terminology pack
- **Filters**: Filter by document type (CBA, LOA, Pay Manual) and category (Pay, Scheduling, Reserve, Training, Deadhead)
- **Match Type**: Toggle between Fuzzy (partial match) and Exact (word boundary) matching
- **Confidence Scoring**: Results show High/Med/Low confidence based on match quality
- **Save References**: Bookmark important sections for future reference
- **Reference-Only**: Results cite documents but do not interpret entitlements

### Entry Points
- **Tools Tab**: "Search Contract" tile in Quick Access grid
- **Contract Vault**: "Search My Contract" button when documents are uploaded
- **Pre-filled Search**: Can open with pre-filled query from other screens

### AI Assist Panel
The collapsible AI Assist panel helps users find better keywords:
- Describe what you're looking for in natural language
- AI suggests relevant keywords from the airline terminology pack
- Suggests document types and categories to filter
- Expands acronyms (e.g., "JA" → "junior assignment")

### Terminology Expansion
Search automatically expands terms using the airline terminology pack:
- "JA" expands to: junior, assignment, draft, junior assignment
- "reserve" expands to: on call, standby, ready reserve, short call, long call
- "guarantee" expands to: min day, minimum, daily guarantee, trip guarantee, rig

### API Endpoints
- `POST /api/contracts/advanced-search` - Advanced search with filters and ranking
- `POST /api/contracts/ai-suggest-keywords` - AI keyword suggestions
- `GET /api/contracts/saved-references` - List saved references
- `POST /api/contracts/saved-references` - Save a reference
- `DELETE /api/contracts/saved-references/:id` - Delete saved reference

### Database Models
- **SavedContractReference**: User's bookmarked contract sections with category and notes

### Frontend Components
- **SearchContractScreen** (`/search-contract`): Main search interface
- **AiAssistPanel**: Collapsible AI keyword suggestion panel
- **SearchResultCard**: Result card with open page, save reference actions
- **useContractSearch hook**: React Query hooks for search operations

## Calendar Sync (UPDATED)

The Calendar Sync feature allows pilots to import their schedule from device calendars (Apple Calendar, Google Calendar, Outlook, etc. already configured on their phone) or ICS feeds. Changes are automatically applied to your schedule.

### Features
- **Device Calendar Access**: Uses expo-calendar to directly access calendars already on the user's phone
- **Universal Import**: Supports Apple iCloud, Google Calendar, Microsoft Outlook/Exchange, and ICS feeds
- **Sync Range**: Imports past 30 days + future 90 days of schedule data
- **Auto-Apply**: Detected changes are automatically applied to your schedule (no manual review required)
- **Change Summary**: Shows what was added, updated, or removed after sync
- **Pay Impact Estimation**: Calculates estimated pay impact for each detected change
- **Smart Block/Credit Parsing**: Extracts actual block and credit times from calendar event descriptions
  - Parses formats like "Blk 03:15", "Block: 3:15", "Credit 4:30", "BLK/CRD 3:15/4:00"
  - Extracts route information (DFW→LAX, SDF-LAX-SDF)
  - Falls back to estimated times based on event duration if no explicit times found

### Entry Points
- **Trips Header**: Sync button (refresh icon) in the top-right of the Trips screen

### Sync Flow
1. User taps the sync button to open Calendar Sync modal
2. If no calendar permission, user is prompted to grant access
3. User selects which device calendars to connect (grouped by provider)
4. Tap "Sync Now" to pull schedule events from the device
5. Events are sent to the backend for comparison against existing trips
6. Changes are automatically applied:
   - New trips are created
   - Modified trips are updated
   - Removed trips are marked as cancelled
7. User sees a summary of what changed

### Device Calendar Integration
The app uses `expo-calendar` to access native calendars:
- Requests calendar permission via system dialog
- Lists all calendars on the device grouped by provider (iCloud, Google, Outlook, etc.)
- User selects which calendars to sync
- Events are read directly from the device and sent to the backend for processing
- No OAuth required for device calendars - they're already authenticated on the phone

### API Endpoints
- `GET /api/calendar/connections` - List calendar connections
- `POST /api/calendar/connections` - Add new calendar connection
- `DELETE /api/calendar/connections/:id` - Remove calendar connection
- `POST /api/calendar/sync` - Trigger calendar sync (auto-applies changes)
- `GET /api/calendar/pending-changes` - Get change history
- `POST /api/calendar/changes/:id/apply` - Manual apply/dismiss (for failed auto-applies)

### Database Models
- **CalendarConnection**: Stores calendar provider connections with OAuth tokens or ICS URLs
- **CalendarPendingChange**: Detected changes with applied/pending status

### Frontend Components
- **CalendarSyncModal**: Modal for managing connections and triggering sync
- **TripsHeader**: Updated with sync button

### Hooks
- **useCalendarConnections**: List and manage calendar connections
- **useCreateCalendarConnection**: Add new calendar connection
- **useDeleteCalendarConnection**: Remove connection
- **useTriggerCalendarSync**: Trigger sync and get results
- **usePendingCalendarChanges**: Get change history
- **useApplyCalendarChange**: Manual apply/dismiss for failed changes

## AI Help Desk (NEW)

The AI Help Desk provides 24/7 instant support for users with questions about the app, including detailed tutorials for importing UPS schedules.

### Features
- **AI-Powered Chat**: Instant answers to common questions about app features
- **UPS Schedule Import Tutorials**: Comprehensive step-by-step guides for:
  - Crew Access Trip Info import (recommended method)
  - Trip Board screenshot import
  - Trip Details view import
- **Quick Action Buttons**: Common topics available with one tap
- **Troubleshooting**: Help with common issues like parsing errors, missing data
- **Ticket Escalation**: When AI can't solve an issue, it suggests submitting a support ticket

### Entry Points
- **Settings Screen**: Support & Feedback section → "AI Help Desk" (marked as NEW)
- Direct navigation to `/help-desk`

### How It Works
1. User opens Help Desk from Settings
2. AI greets user with available help topics
3. User can tap quick actions or type a question
4. AI provides detailed, step-by-step guidance
5. If issue can't be resolved, AI suggests submitting a support ticket

### UPS Schedule Import Methods (AI Knowledge)

**Method 1: Crew Access - Trip Info (Recommended)**
1. Open UPS Crew Access
2. Go to "My Schedule" or "Trip Info"
3. Select the trip to import
4. Take screenshot showing full trip details
5. In app: Add tab → Upload Schedule
6. AI parses and creates the trip

**Method 2: Trip Board Screenshot**
1. Open UPS Crew Access
2. Navigate to Trip Board/monthly schedule
3. Take screenshot of trips
4. Upload in app
5. Review and confirm parsed trips

**Method 3: Trip Details View**
1. Open specific trip in Crew Access
2. Go to Trip Details
3. Screenshot the details page
4. Upload in app

### API Endpoints
- `POST /api/support/help-desk` - AI chat endpoint

### Components
- **HelpDeskScreen** (`/help-desk`): Chat interface with AI assistant
- Settings integration with "AI Help Desk" button

## Notification System (NEW)

Comprehensive push notification system to keep pilots informed about their schedule and pay.

### Notification Types

| Type | Lead Time | Description |
|------|-----------|-------------|
| **Report Time Reminder** | 60 min (domestic) / 90 min (intl) | Reminder before duty report time |
| **Pay Period Ending** | 48h / 24h before | Review premiums before period closes |
| **Payday Reminder** | 2 days / 1 day / morning of | With Big Check (Settlement) or Small Check (Advance) label |
| **Arrival Welcome** | On arrival (HIGH confidence only) | Friendly greeting with quick access to log premiums |
| **Pay Statement Ready** | Immediate | When pay summary is generated |

### Notification Settings

Located in Settings → Notifications:

- **Report Time Reminders**: Toggle + auto domestic/international lead time
- **Pay Period Ending**: 48h and optional 24h reminders
- **Payday Reminders**: 2 days, 1 day, and morning-of options
- **Arrival Welcome**: Locked to HIGH confidence to prevent false notifications
- **Pay Statement Ready**: Notification when pay summary is available
- **Quiet Hours**: Configurable start/end times with delay or skip action
- **High Confidence Only**: Global filter for all notifications

### Big Check vs Small Check Labels

Payday reminders include check type information:
- **Small Check (Advance)**: Pays 1st pay date - half of monthly guarantee only
- **Big Check (Settlement)**: Pays 15th pay date - remaining guarantee + all premiums + per diem

### Technical Implementation

**Frontend Files:**
- `src/app/notification-settings.tsx` - Settings UI with toggles
- `src/lib/notificationService.ts` - Core notification scheduling logic
- `src/lib/useNotifications.ts` - React Query hooks for notifications

**Backend Files:**
- `backend/src/routes/notifications.ts` - API endpoints for settings
- `backend/prisma/schema.prisma` - UserNotificationSettings model

**Key Features:**
- Local scheduling (works offline)
- Quiet hours support with delay/skip options
- Idempotent arrival notifications (no duplicate sends)
- Auto-scheduling on trip load
- Domestic vs international detection for lead times

## Crew Referral Program (NEW)

Referral system allowing pilots to share the app with fellow crew members and earn rewards.

### How It Works

1. **Get Your Code**: In Settings → Crew Referral Program, each user gets a unique code (e.g., `PILOT-A7B3`)
2. **Share with Crew**: Tap "Share with Crew" to send via text/email with pre-filled message
3. **New User Signs Up**: New pilot enters the referral code during account creation
4. **Discount Applied**: Referred user gets **50% off their first payment**
5. **Referrer Rewarded**: When referred user subscribes, referrer earns rewards

### Features

- **Unique Referral Codes**: Each user gets their own code in `PILOT-XXXX` format
- **One-Time Use**: Each user can only be referred once (prevents abuse)
- **Self-Referral Protection**: Users cannot use their own referral code
- **Stats Tracking**: View total referrals, successful subscriptions, and rewards earned
- **Copy to Clipboard**: Tap referral code to copy it
- **Native Share**: Share button uses iOS/Android native share sheet

### User Flow

**Referrer (Settings Screen):**
- View their unique referral code
- See stats: Referred | Subscribed | Rewards
- Share button to send code to crew

**New User (Create Account Screen):**
- Optional "Referral Code" field at bottom of form
- Real-time validation with visual feedback (green check / red X)
- Discount preview: "You'll get 50% off your first payment!"

### Technical Implementation

**Backend Files:**
- `backend/src/routes/referrals.ts` - API endpoints for referral system
- `backend/prisma/schema.prisma` - Referral and ReferralStats models

**Frontend Files:**
- `src/app/settings.tsx` - Crew Referral Program section
- `src/app/create-account.tsx` - Referral code input field

**API Endpoints:**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/referrals/my-code` | GET | Get or create user's referral code |
| `/api/referrals/stats` | GET | Get referral statistics |
| `/api/referrals/validate` | POST | Validate a referral code |
| `/api/referrals/apply` | POST | Apply referral after account creation |
| `/api/referrals/my-discount` | GET | Check if user has referral discount |
| `/api/referrals/check-referred` | GET | Check if user was referred |


## Apple App Store Review Account

**Credentials:**
- Email: `review@pilotpaytracker.app`
- Password: `PilotPay!2026`

**Setup:**
- Account exists in Supabase auth and local SQLite DB
- Profile is pre-populated with realistic UPS Captain data (App Review, CPT, SDF base, $348/hr)
- `subscriptionStatus = "active"` with end date through 2030-12-31
- `trialStatus = "expired"` (shows paid subscription, not trial)
- Apple Review bypass is active in `src/lib/appleReviewBypass.ts` — grants all premium access immediately on sign-in

**Key files:**
- `backend/src/routes/profile.ts` — `REVIEW_PROFILE_DEFAULTS` auto-populates profile if ever missing
- `backend/src/utils/ensureUser.ts` — Safely migrates user ID if Supabase UUID differs from local DB, **preserving profile data**
- `mobile/src/lib/appleReviewBypass.ts` — Client-side premium bypass
- `mobile/src/lib/useSubscription.ts` — `usePremiumAccess()` always returns `true` for review account

**Subscription flow for reviewers:**
1. Login → Supabase auth validates credentials
2. Profile loaded → backend returns `subscriptionStatus: "active"` and `hasPremiumAccess: true`
3. Client-side bypass also grants access independently (double protection)
4. User lands in app with full premium access, no paywall shown
