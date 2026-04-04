/**
 * UPS Pay Benchmarks - Contract Extension TA – 2025
 * Effective September 1, 2025
 *
 * Source: UPS / IPA Contract Extension TA pay table (official chart)
 *
 * DATASET METADATA:
 * - airline: "UPS"
 * - dataset_id: "ups_contract_extension_ta_2025"
 * - dataset_label: "Contract Extension TA – 2025"
 * - effective_date: "2025-09-01"
 * - guarantee_hours_monthly: 75 (UPS rule - 975 hours annual)
 * - source_note: "UPS / IPA Contract Extension TA pay table numbers (effective Sep 1, 2025)"
 *
 * PAY DEFINITIONS (from chart):
 * - Pay @ Guarantee = 975-hour annual Guarantee
 * - Average Line Pay = average regular line paid hours (1018.3)
 * - Average Total Pay = average total paid hours (Capt 1223.2, F/O 1123.4)
 * - Total Pay includes: line pay, vacation buy-back, sick check, open time (trade with/pickup),
 *   JA, premiums, training on day off, vacation on day off, DBL, homestudy, EDW penalty.
 *
 * All monetary values stored in CENTS (displayed dollars × 100)
 */

export const UPS_BENCHMARKS_2025 = {
  airline: "UPS",
  datasetId: "ups_contract_extension_ta_2025",
  datasetLabel: "Contract Extension TA – 2025",
  effectiveDate: "2025-09-01",
  guaranteeHoursMonthly: 75,
  guaranteeHoursAnnual: 975,
  sourceNote: "UPS / IPA Contract Extension TA pay table numbers (effective Sep 1, 2025)",
  avgLinePaidHours: 1018.3,
  avgTotalPaidHoursCaptain: 1223.2,
  avgTotalPaidHoursFO: 1123.4,
  data: {
    // =====================================================================
    // FIRST OFFICER (FO) pay rates - from official chart
    // Columns: Rate | Pay @ Guarantee | Average Line Pay | Average Total Pay
    // =====================================================================
    FO: [
      // Year 1:  $59.77  | $58,276  | $60,866  | $67,146
      { yearOfService: 1,  hourlyRate: 5977,   payAtGuarantee: 5827600,  avgLinePay: 6086600,  avgTotalPay: 6714600 },
      // Year 2:  $228.04 | $222,339 | $232,220 | $256,180
      { yearOfService: 2,  hourlyRate: 22804,  payAtGuarantee: 22233900, avgLinePay: 23222000, avgTotalPay: 25618000 },
      // Year 3:  $228.35 | $222,641 | $232,536 | $256,528
      { yearOfService: 3,  hourlyRate: 22835,  payAtGuarantee: 22264100, avgLinePay: 23253600, avgTotalPay: 25652800 },
      // Year 4:  $232.93 | $227,107 | $237,200 | $261,674
      { yearOfService: 4,  hourlyRate: 23293,  payAtGuarantee: 22710700, avgLinePay: 23720000, avgTotalPay: 26167400 },
      // Year 5:  $237.58 | $231,641 | $241,935 | $266,897
      { yearOfService: 5,  hourlyRate: 23758,  payAtGuarantee: 23164100, avgLinePay: 24193500, avgTotalPay: 26689700 },
      // Year 6:  $242.32 | $236,262 | $246,762 | $272,222
      { yearOfService: 6,  hourlyRate: 24232,  payAtGuarantee: 23626200, avgLinePay: 24676200, avgTotalPay: 27222200 },
      // Year 7:  $247.17 | $240,991 | $251,701 | $277,671
      { yearOfService: 7,  hourlyRate: 24717,  payAtGuarantee: 24099100, avgLinePay: 25170100, avgTotalPay: 27767100 },
      // Year 8:  $252.10 | $245,798 | $256,721 | $283,209
      { yearOfService: 8,  hourlyRate: 25210,  payAtGuarantee: 24579800, avgLinePay: 25672100, avgTotalPay: 28320900 },
      // Year 9:  $257.14 | $250,712 | $261,853 | $288,871
      { yearOfService: 9,  hourlyRate: 25714,  payAtGuarantee: 25071200, avgLinePay: 26185300, avgTotalPay: 28887100 },
      // Year 10: $264.32 | $257,712 | $269,165 | $296,937
      { yearOfService: 10, hourlyRate: 26432,  payAtGuarantee: 25771200, avgLinePay: 26916500, avgTotalPay: 29693700 },
      // Year 11: $271.74 | $264,947 | $276,721 | $305,273
      { yearOfService: 11, hourlyRate: 27174,  payAtGuarantee: 26494700, avgLinePay: 27672100, avgTotalPay: 30527300 },
      // Year 12: $279.37 | $272,386 | $284,491 | $313,844
      { yearOfService: 12, hourlyRate: 27937,  payAtGuarantee: 27238600, avgLinePay: 28449100, avgTotalPay: 31384400 },
      // Year 13: $280.78 | $273,761 | $285,927 | $315,428
      { yearOfService: 13, hourlyRate: 28078,  payAtGuarantee: 27376100, avgLinePay: 28592700, avgTotalPay: 31542800 },
      // Year 14: $282.16 | $275,106 | $287,332 | $316,979
      { yearOfService: 14, hourlyRate: 28216,  payAtGuarantee: 27510600, avgLinePay: 28733200, avgTotalPay: 31697900 },
      // Year 15: $284.29 | $277,183 | $289,501 | $319,371
      { yearOfService: 15, hourlyRate: 28429,  payAtGuarantee: 27718300, avgLinePay: 28950100, avgTotalPay: 31937100 },
    ],
    // =====================================================================
    // CAPTAIN pay rates - from official chart
    // Columns: Rate | Pay @ Guarantee | Average Line Pay | Average Total Pay
    // =====================================================================
    Captain: [
      // Year 1:  $59.77  | $58,276  | $60,866  | $73,111
      { yearOfService: 1,  hourlyRate: 5977,   payAtGuarantee: 5827600,  avgLinePay: 6086600,  avgTotalPay: 7311100 },
      // Year 2:  $367.39 | $358,205 | $374,124 | $449,391
      { yearOfService: 2,  hourlyRate: 36739,  payAtGuarantee: 35820500, avgLinePay: 37412400, avgTotalPay: 44939100 },
      // Year 3:  $368.11 | $358,907 | $374,857 | $450,272
      { yearOfService: 3,  hourlyRate: 36811,  payAtGuarantee: 35890700, avgLinePay: 37485700, avgTotalPay: 45027200 },
      // Year 4:  $369.60 | $360,360 | $376,375 | $452,095
      { yearOfService: 4,  hourlyRate: 36960,  payAtGuarantee: 36036000, avgLinePay: 37637500, avgTotalPay: 45209500 },
      // Year 5:  $371.07 | $361,793 | $377,872 | $453,893
      { yearOfService: 5,  hourlyRate: 37107,  payAtGuarantee: 36179300, avgLinePay: 37787200, avgTotalPay: 45389300 },
      // Year 6:  $372.53 | $363,217 | $379,358 | $455,679
      { yearOfService: 6,  hourlyRate: 37253,  payAtGuarantee: 36321700, avgLinePay: 37935800, avgTotalPay: 45567900 },
      // Year 7:  $374.04 | $364,689 | $380,896 | $457,526
      { yearOfService: 7,  hourlyRate: 37404,  payAtGuarantee: 36468900, avgLinePay: 38089600, avgTotalPay: 45752600 },
      // Year 8:  $375.53 | $366,142 | $382,413 | $459,348
      { yearOfService: 8,  hourlyRate: 37553,  payAtGuarantee: 36614200, avgLinePay: 38241300, avgTotalPay: 45934800 },
      // Year 9:  $377.02 | $367,595 | $383,931 | $461,171
      { yearOfService: 9,  hourlyRate: 37702,  payAtGuarantee: 36759500, avgLinePay: 38393100, avgTotalPay: 46117100 },
      // Year 10: $381.37 | $371,836 | $388,361 | $466,492
      { yearOfService: 10, hourlyRate: 38137,  payAtGuarantee: 37183600, avgLinePay: 38836100, avgTotalPay: 46649200 },
      // Year 11: $385.77 | $376,126 | $392,841 | $471,874
      { yearOfService: 11, hourlyRate: 38577,  payAtGuarantee: 37612600, avgLinePay: 39284100, avgTotalPay: 47187400 },
      // Year 12: $390.21 | $380,455 | $397,363 | $477,305
      { yearOfService: 12, hourlyRate: 39021,  payAtGuarantee: 38045500, avgLinePay: 39736300, avgTotalPay: 47730500 },
      // Year 13: $393.12 | $383,292 | $400,326 | $480,864
      { yearOfService: 13, hourlyRate: 39312,  payAtGuarantee: 38329200, avgLinePay: 40032600, avgTotalPay: 48086400 },
      // Year 14: $397.05 | $387,124 | $404,328 | $485,672
      { yearOfService: 14, hourlyRate: 39705,  payAtGuarantee: 38712400, avgLinePay: 40432800, avgTotalPay: 48567200 },
      // Year 15: $401.01 | $390,985 | $408,361 | $490,515
      { yearOfService: 15, hourlyRate: 40101,  payAtGuarantee: 39098500, avgLinePay: 40836100, avgTotalPay: 49051500 },
    ],
  },
};

/**
 * Convert the benchmark data to the format expected by the API
 */
export function getBenchmarksForSeeding() {
  const benchmarks: Array<{
    airline: string;
    effectiveDate: string;
    seat: "FO" | "Captain";
    yearOfService: number;
    hourlyRateCents: number;
    payAtGuaranteeCents: number;
    avgLinePayCents: number;
    avgTotalPayCents: number;
    sourceNote: string;
  }> = [];

  const { airline, effectiveDate, datasetLabel, sourceNote, data } = UPS_BENCHMARKS_2025;
  const fullSourceNote = `${datasetLabel} - ${sourceNote}`;

  // Add FO benchmarks
  for (const row of data.FO) {
    benchmarks.push({
      airline,
      effectiveDate,
      seat: "FO",
      yearOfService: row.yearOfService,
      hourlyRateCents: row.hourlyRate,
      payAtGuaranteeCents: row.payAtGuarantee,
      avgLinePayCents: row.avgLinePay,
      avgTotalPayCents: row.avgTotalPay,
      sourceNote: fullSourceNote,
    });
  }

  // Add Captain benchmarks
  for (const row of data.Captain) {
    benchmarks.push({
      airline,
      effectiveDate,
      seat: "Captain",
      yearOfService: row.yearOfService,
      hourlyRateCents: row.hourlyRate,
      payAtGuaranteeCents: row.payAtGuarantee,
      avgLinePayCents: row.avgLinePay,
      avgTotalPayCents: row.avgTotalPay,
      sourceNote: fullSourceNote,
    });
  }

  return benchmarks;
}

/**
 * Get dataset metadata for display
 */
export function getDatasetMetadata() {
  return {
    airline: UPS_BENCHMARKS_2025.airline,
    datasetId: UPS_BENCHMARKS_2025.datasetId,
    datasetLabel: UPS_BENCHMARKS_2025.datasetLabel,
    effectiveDate: UPS_BENCHMARKS_2025.effectiveDate,
    guaranteeHoursMonthly: UPS_BENCHMARKS_2025.guaranteeHoursMonthly,
    guaranteeHoursAnnual: UPS_BENCHMARKS_2025.guaranteeHoursAnnual,
    sourceNote: UPS_BENCHMARKS_2025.sourceNote,
    avgLinePaidHours: UPS_BENCHMARKS_2025.avgLinePaidHours,
    avgTotalPaidHoursCaptain: UPS_BENCHMARKS_2025.avgTotalPaidHoursCaptain,
    avgTotalPaidHoursFO: UPS_BENCHMARKS_2025.avgTotalPaidHoursFO,
  };
}
