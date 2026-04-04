/**
 * CreditCapEngine — Deterministic Unit Tests
 *
 * Run with: bun test shared/CreditCapEngine.test.ts
 *
 * All 6 required scenarios from the spec + extras.
 */

import {
  evaluateCreditedTimeStatus,
  computeMaxOpenTimeAllowed,
  buildCapInputsFromPrefs,
  DEFAULT_CREDIT_CAP_PREFERENCES,
  type CreditCapInputs,
  type CreditCapPreferences,
} from "./CreditCapEngine";

// ─── Micro-test framework ────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function expect<T>(label: string, actual: T, expected: T) {
  if (actual === expected) {
    console.log(`  ✅ ${label}: ${JSON.stringify(actual)}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}:`);
    console.error(`       expected: ${JSON.stringify(expected)}`);
    console.error(`       actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n▶ ${title}`);
}

// ─── Test 1: BID_56, awardedLine=185, requestedOT=44 ───────────────────────
section("TEST 1 — BID_56 awardedLine=185 requestedOT=44");
// OT gate = 192. max OT = 192 - 185 = 7. requested=44 > 7 → NOT_ACHIEVABLE_WITH_OT
{
  const inputs: CreditCapInputs = {
    periodType: "BID_56",
    awardedLineCredit: 185,
    plannedOpenTimeCredit: 44,
  };
  const result = evaluateCreditedTimeStatus(inputs);
  expect("status", result.status, "NOT_ACHIEVABLE_WITH_OT");
  expect("maxOpenTimeAllowed", result.maxOpenTimeAllowed, 7);
  expect("clampedOT", result.plannedOpenTimeCreditClamped, 7);
  expect("capCountingCredit", result.capCountingCredit, 185 + 7);
  expect("overCapBy", result.overCapBy, 0);
}

// ─── Test 2: BID_56, awardedLine=150, requestedOT=20 ───────────────────────
section("TEST 2 — BID_56 awardedLine=150 requestedOT=20");
// OT gate = 192. max OT = 192 - 150 = 42. 20 <= 42 → ACHIEVABLE
// cap-counting = 150 + 20 = 170 <= 208 → ACHIEVABLE
{
  const inputs: CreditCapInputs = {
    periodType: "BID_56",
    awardedLineCredit: 150,
    plannedOpenTimeCredit: 20,
  };
  const result = evaluateCreditedTimeStatus(inputs);
  expect("status", result.status, "ACHIEVABLE");
  expect("maxOpenTimeAllowed", result.maxOpenTimeAllowed, 42);
  expect("clampedOT", result.plannedOpenTimeCreditClamped, 20);
  expect("capCountingCredit", result.capCountingCredit, 170);
}

// ─── Test 3: RDG DOM, awardedLine=75, requestedOT=10 ───────────────────────
section("TEST 3 — RDG DOMESTIC awardedLine=75 requestedOT=10");
// RDG DOM: maxCapCounting = 75 + 5 = 80. max OT = 80 - 75 = 5. 10 > 5 → NOT_ACHIEVABLE_WITH_OT
{
  const inputs: CreditCapInputs = {
    periodType: "BID_56",
    awardedLineCredit: 75,
    plannedOpenTimeCredit: 10,
    isRDGLine: true,
    assignmentType: "DOMESTIC",
  };
  const result = evaluateCreditedTimeStatus(inputs);
  expect("status", result.status, "NOT_ACHIEVABLE_WITH_OT");
  expect("maxOpenTimeAllowed", result.maxOpenTimeAllowed, 5);
  expect("clampedOT", result.plannedOpenTimeCreditClamped, 5);
}

// ─── Test 4: Exceed effective absolute cap, no exceptions ──────────────────
section("TEST 4 — Exceed absolute cap without exceptions");
// BID_56, awardedLine=200, requestedOT=30
// max OT gate = 192 - 200 = max(0, -8) = 0. OT clamped to 0.
// capCountingCredit = 200 + 0 = 200 <= 208 → ...wait, let me recalculate.
// Actually, OT clamped=0. cap-counting=200. 200 <= 208 → ACHIEVABLE (no over-cap)
// To force EXCEEDS_CAP_BLOCKED: need cap-counting > 208 with full clamping
// Use PAY_35 (130 cap). awardedLine=140, OT=0 → cap-counting=140 > 130 → EXCEEDS_CAP_BLOCKED
// But OT gate for PAY_35 = 120. max OT = max(0, 120-140) = 0.
// cap-counting = 140 > 130 → EXCEEDS_CAP_BLOCKED
{
  const inputs: CreditCapInputs = {
    periodType: "PAY_35",
    awardedLineCredit: 140,
    plannedOpenTimeCredit: 5,
    isRDGLine: false,
  };
  const result = evaluateCreditedTimeStatus(inputs);
  expect("status", result.status, "EXCEEDS_CAP_BLOCKED");
  expect("overCapBy", result.overCapBy, 10);  // 140 - 130
}

// ─── Test 5: Exceed cap with trip completion allowance ─────────────────────
section("TEST 5 — Exceed cap, allowTripCompletionOvercap=true");
{
  const inputs: CreditCapInputs = {
    periodType: "PAY_35",
    awardedLineCredit: 140,
    plannedOpenTimeCredit: 0,
    allowTripCompletionOvercap: true,
    tripCompletionCreditOvercap: 10,
  };
  const result = evaluateCreditedTimeStatus(inputs);
  expect("status", result.status, "EXCEEDS_CAP_ALLOWED_TRIP_COMPLETION");
  expect("overCapBy", result.overCapBy, 10);
}

// ─── Test 6: Vacation relief increases effective cap ──────────────────────
section("TEST 6 — Vacation drop cap relief changes result status");
// PAY_35 cap = 130. awardedLine=125, requestedOT=10, dropped=15, relief enabled
// OT gate = 120. max OT = max(0, 120-125) = 0. clamped OT = 0. cap-counting = 125
// Without relief: effectiveCap=130 → 125 <= 130 → ACHIEVABLE
// With vacation relief and dropped=15: effectiveCap=130+15=145 → still ACHIEVABLE but cap raised
{
  // First without relief
  const noRelief: CreditCapInputs = {
    periodType: "PAY_35",
    awardedLineCredit: 135,
    plannedOpenTimeCredit: 0,
  };
  const resultNoRelief = evaluateCreditedTimeStatus(noRelief);
  expect("without relief — status", resultNoRelief.status, "EXCEEDS_CAP_BLOCKED");
  expect("without relief — effectiveCap", resultNoRelief.effectiveAbsoluteCap, 130);

  // Now with vacation relief
  const withRelief: CreditCapInputs = {
    periodType: "PAY_35",
    awardedLineCredit: 135,
    plannedOpenTimeCredit: 0,
    vacationNuance: {
      hasVacationInPeriod: true,
      droppedTripsCreditForVacation: 10,
      enableVacationDropCapRelief: true,
    },
  };
  const resultWithRelief = evaluateCreditedTimeStatus(withRelief);
  expect("with relief — effectiveCap", resultWithRelief.effectiveAbsoluteCap, 140);
  expect("with relief — status", resultWithRelief.status, "ACHIEVABLE");
}

// ─── Test 7: Exclusions reduce cap-counting but not pay ────────────────────
section("TEST 7 — Exclusions reduce cap-counting credit");
{
  const inputs: CreditCapInputs = {
    periodType: "BID_56",
    awardedLineCredit: 195,
    plannedOpenTimeCredit: 20,
    exclusions: {
      vacationCredit: 15,
      shortTermTrainingCredit: 5,
    },
  };
  const result = evaluateCreditedTimeStatus(inputs);
  expect("exclusionsSum", result.exclusionsSum, 20);
  // OT gate = 192. awardedLine=195 > 192, so max OT = max(0, 192-195) = 0.
  // Requested OT=20 > clamped OT=0 → NOT_ACHIEVABLE_WITH_OT
  // cap-counting = 195 + 0 - 20 = 175
  expect("capCountingCredit", result.capCountingCredit, 175);
  expect("status", result.status, "NOT_ACHIEVABLE_WITH_OT");
  // 175 < 208 so no cap exceeded, just OT can't be picked up
  expect("overCapBy", result.overCapBy, 0);
}

// ─── Test 8: buildCapInputsFromPrefs round-trip ────────────────────────────
section("TEST 8 — buildCapInputsFromPrefs + evaluateCreditedTimeStatus round-trip");
{
  const prefs: CreditCapPreferences = {
    ...DEFAULT_CREDIT_CAP_PREFERENCES,
    periodType: "BID_28",
    awardedLineCredit: 90,
  };
  // BID_28 OT gate = 96. max OT = 96 - 90 = 6.
  const inputs = buildCapInputsFromPrefs(prefs, 4);
  const result = evaluateCreditedTimeStatus(inputs);
  expect("status", result.status, "ACHIEVABLE");
  expect("clampedOT", result.plannedOpenTimeCreditClamped, 4);
  expect("capCountingCredit", result.capCountingCredit, 94);
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
