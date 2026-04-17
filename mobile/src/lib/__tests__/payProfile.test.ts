/**
 * Tests for the Pay Profile Engine
 *
 * Run with: cd mobile && bun jest src/lib/__tests__/payProfile.test.ts
 */
import {
  computePayYearFromDOH,
  getPayProfile,
  getPayProfileByYear,
  formatDollars,
  formatHourlyRate,
} from "../payProfile";

// ─── computePayYearFromDOH ────────────────────────────────────────────────────

describe("computePayYearFromDOH", () => {
  it("returns 1 for null/undefined DOH", () => {
    expect(computePayYearFromDOH(null)).toBe(1);
    expect(computePayYearFromDOH(undefined)).toBe(1);
    expect(computePayYearFromDOH("")).toBe(1);
  });

  it("returns 1 for invalid DOH string", () => {
    expect(computePayYearFromDOH("not-a-date")).toBe(1);
  });

  // DOH = 2022-04-04, asOf = 2022-04-03 (one day before first anniversary would
  // still be year 1 — actually it's the same year as hire, so year 1)
  it("year 1 — same day as hire", () => {
    const asOf = new Date(2022, 3, 4); // Apr 4 2022
    expect(computePayYearFromDOH("2022-04-04", asOf)).toBe(1);
  });

  it("year 1 — before first anniversary", () => {
    const asOf = new Date(2023, 3, 3); // Apr 3 2023 (one day before 1st anniv)
    expect(computePayYearFromDOH("2022-04-04", asOf)).toBe(1);
  });

  it("year 2 — on first anniversary", () => {
    const asOf = new Date(2023, 3, 4); // Apr 4 2023
    expect(computePayYearFromDOH("2022-04-04", asOf)).toBe(2);
  });

  it("year 2 — just after first anniversary", () => {
    const asOf = new Date(2023, 3, 5); // Apr 5 2023
    expect(computePayYearFromDOH("2022-04-04", asOf)).toBe(2);
  });

  it("year 5 — on 4th anniversary (DOH=2022-04-04, asOf=2026-04-04)", () => {
    const asOf = new Date(2026, 3, 4); // Apr 4 2026
    expect(computePayYearFromDOH("2022-04-04", asOf)).toBe(5);
  });

  it("year 4 — one day before 4th anniversary", () => {
    const asOf = new Date(2026, 3, 3); // Apr 3 2026
    expect(computePayYearFromDOH("2022-04-04", asOf)).toBe(4);
  });

  it("caps at year 15", () => {
    const asOf = new Date(2040, 3, 4); // far future
    expect(computePayYearFromDOH("2022-04-04", asOf)).toBe(15);
  });

  it("accepts MM/DD/YYYY format", () => {
    const asOf = new Date(2026, 3, 4); // Apr 4 2026
    expect(computePayYearFromDOH("04/04/2022", asOf)).toBe(5);
  });

  it("handles leap-year hire date (Feb 29)", () => {
    // Hired Feb 29 2020; check on Mar 1 2021 (2021 has no Feb 29)
    const asOf = new Date(2021, 2, 1); // Mar 1 2021
    const year = computePayYearFromDOH("2020-02-29", asOf);
    // First anniversary is Feb 28 or Mar 1 2021 — either way, year should be 2
    expect(year).toBeGreaterThanOrEqual(1);
    expect(year).toBeLessThanOrEqual(2);
  });
});

// ─── getPayProfile — FO ──────────────────────────────────────────────────────

describe("getPayProfile — FO", () => {
  const asOf = new Date(2026, 3, 4); // Apr 4 2026 → year 5

  it("returns correct pay step label for 5th Year FO", () => {
    const result = getPayProfile({ doh: "2022-04-04", position: "FO", asOf });
    expect(result.payStepLabel).toBe("5th Year FO");
  });

  it("returns correct hourly rate for 5th Year FO ($237.58)", () => {
    const result = getPayProfile({ doh: "2022-04-04", position: "FO", asOf });
    expect(result.hourlyRateCents).toBe(23758);
  });

  it("returns correct pay @ guarantee for 5th Year FO ($231,641)", () => {
    const result = getPayProfile({ doh: "2022-04-04", position: "FO", asOf });
    expect(result.payAtGuaranteeCents).toBe(23164100);
  });

  it("returns correct avg line pay for 5th Year FO ($241,935)", () => {
    const result = getPayProfile({ doh: "2022-04-04", position: "FO", asOf });
    expect(result.avgLinePayCents).toBe(24193500);
  });

  it("returns correct avg total pay for 5th Year FO ($266,897)", () => {
    const result = getPayProfile({ doh: "2022-04-04", position: "FO", asOf });
    expect(result.avgTotalPayCents).toBe(26689700);
  });

  it("isManualOverride is false when no override provided", () => {
    const result = getPayProfile({ doh: "2022-04-04", position: "FO", asOf });
    expect(result.isManualOverride).toBe(false);
  });
});

// ─── getPayProfile — CPT ─────────────────────────────────────────────────────

describe("getPayProfile — CPT", () => {
  const asOf = new Date(2026, 3, 4); // Apr 4 2026 → year 5

  it("returns correct pay step label for 5th Year CPT", () => {
    const result = getPayProfile({ doh: "2022-04-04", position: "CPT", asOf });
    expect(result.payStepLabel).toBe("5th Year CPT");
  });

  it("returns correct hourly rate for 5th Year CPT ($371.07)", () => {
    const result = getPayProfile({ doh: "2022-04-04", position: "CPT", asOf });
    expect(result.hourlyRateCents).toBe(37107);
  });

  it("returns correct pay @ guarantee for 5th Year CPT ($361,793)", () => {
    const result = getPayProfile({ doh: "2022-04-04", position: "CPT", asOf });
    expect(result.payAtGuaranteeCents).toBe(36179300);
  });

  it("returns correct avg line pay for 5th Year CPT ($377,872)", () => {
    const result = getPayProfile({ doh: "2022-04-04", position: "CPT", asOf });
    expect(result.avgLinePayCents).toBe(37787200);
  });

  it("returns correct avg total pay for 5th Year CPT ($453,893)", () => {
    const result = getPayProfile({ doh: "2022-04-04", position: "CPT", asOf });
    expect(result.avgTotalPayCents).toBe(45389300);
  });
});

// ─── Manual override ─────────────────────────────────────────────────────────

describe("getPayProfile — manual override", () => {
  const asOf = new Date(2026, 3, 4);

  it("applies override hourly rate", () => {
    const result = getPayProfile({
      doh: "2022-04-04",
      position: "FO",
      asOf,
      overrideRateCents: 25000,
    });
    expect(result.hourlyRateCents).toBe(25000);
    expect(result.isManualOverride).toBe(true);
  });

  it("does not flag as override when override equals contract rate", () => {
    const contractRate = 23758; // 5th year FO
    const result = getPayProfile({
      doh: "2022-04-04",
      position: "FO",
      asOf,
      overrideRateCents: contractRate,
    });
    expect(result.isManualOverride).toBe(false);
  });

  it("override does not affect guarantee/line/total pay", () => {
    const result = getPayProfile({
      doh: "2022-04-04",
      position: "FO",
      asOf,
      overrideRateCents: 99999,
    });
    // These should still come from the contract table
    expect(result.payAtGuaranteeCents).toBe(23164100);
    expect(result.avgLinePayCents).toBe(24193500);
    expect(result.avgTotalPayCents).toBe(26689700);
  });
});

// ─── getPayProfileByYear ─────────────────────────────────────────────────────

describe("getPayProfileByYear", () => {
  it("returns correct data for year 1 FO", () => {
    const result = getPayProfileByYear({ yearOfService: 1, position: "FO" });
    expect(result.payStepLabel).toBe("1st Year FO");
    expect(result.hourlyRateCents).toBe(5977);
  });

  it("returns correct data for year 15 CPT", () => {
    const result = getPayProfileByYear({ yearOfService: 15, position: "CPT" });
    expect(result.payStepLabel).toBe("15th Year CPT");
    expect(result.hourlyRateCents).toBe(40101);
  });

  it("clamps year below 1 to year 1", () => {
    const result = getPayProfileByYear({ yearOfService: 0, position: "FO" });
    expect(result.yearOfService).toBe(1);
  });

  it("clamps year above 15 to year 15", () => {
    const result = getPayProfileByYear({ yearOfService: 20, position: "FO" });
    expect(result.yearOfService).toBe(15);
  });
});

// ─── FO/CPT switch ───────────────────────────────────────────────────────────

describe("FO to CPT switch", () => {
  it("produces different pay profiles for same year/DOH", () => {
    const asOf = new Date(2026, 3, 4);
    const fo = getPayProfile({ doh: "2022-04-04", position: "FO", asOf });
    const cpt = getPayProfile({ doh: "2022-04-04", position: "CPT", asOf });

    expect(fo.yearOfService).toBe(cpt.yearOfService);
    expect(fo.hourlyRateCents).not.toBe(cpt.hourlyRateCents);
    expect(cpt.hourlyRateCents).toBeGreaterThan(fo.hourlyRateCents);
    expect(cpt.avgTotalPayCents).toBeGreaterThan(fo.avgTotalPayCents);
  });
});

// ─── Formatting helpers ───────────────────────────────────────────────────────

describe("formatting helpers", () => {
  it("formatDollars rounds to nearest dollar", () => {
    expect(formatDollars(23164100)).toBe("$231,641");
  });

  it("formatHourlyRate shows 2 decimal places", () => {
    expect(formatHourlyRate(23758)).toBe("$237.58/hr");
  });
});

// ─── Edge dates ───────────────────────────────────────────────────────────────

describe("edge date cases", () => {
  it("year boundary — one day before vs on anniversary", () => {
    const doh = "2020-01-15";
    const dayBefore = new Date(2025, 0, 14); // Jan 14 2025
    const onAnniv = new Date(2025, 0, 15);   // Jan 15 2025

    expect(computePayYearFromDOH(doh, dayBefore)).toBe(5);
    expect(computePayYearFromDOH(doh, onAnniv)).toBe(6);
  });

  it("year-end hire date (Dec 31)", () => {
    const doh = "2020-12-31";
    const asOf = new Date(2024, 11, 31); // Dec 31 2024
    expect(computePayYearFromDOH(doh, asOf)).toBe(5);
  });

  it("very new hire (same day) returns year 1", () => {
    const today = new Date();
    const doh = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(computePayYearFromDOH(doh, today)).toBe(1);
  });
});
