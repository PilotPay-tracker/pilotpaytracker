/**
 * Late Arrival Pay (LAP) Calculator
 *
 * UPS Premium Code for when actual arrival at domicile exceeds
 * original scheduled arrival by more than 4 hours.
 *
 * Rules:
 * - Eligibility: Actual arrival > Original scheduled arrival + 4:00
 * - LAP Start Time:
 *   - Non-WX/MX: Starts at original scheduled arrival
 *   - WX/MX: Starts at original scheduled arrival + 4:00
 * - Credit Options (choose max):
 *   - Trip Rig: (minutes after LAP start) / 3.75
 *   - Duty Rig:
 *     - EDW: duty minutes / 1.5
 *     - Non-EDW: duty minutes / 2.0
 *   - Leg Credit: actual leg minutes after LAP start
 * - Pay: chosenCreditHours × 1.5 × hourlyRate
 */

export interface LegData {
  actualOutISO?: string;
  actualInISO?: string;
  actualBlockMinutes?: number;
}

export interface LapCalculationInput {
  originalArrivalUtc: string;
  actualArrivalUtc: string;
  dutyStartUtc?: string;
  dutyEndUtc?: string;
  isWxMx: boolean;
  isEdw: boolean;
  isDomicileAirportClosed: boolean;
  hourlyRateCents: number;
  legs?: LegData[];
}

export type LapCreditBasis = "TRIP_RIG" | "DUTY_RIG" | "LEG";
export type LapConfidenceLevel = "green" | "yellow" | "red";

export interface LapCalculationResult {
  isEligible: boolean;
  eligibilityReason?: string;
  lapStartTimeUtc: string | null;
  lateMinutes: number;
  legMinutesAfterLap: number;
  dutyMinutesAfterLap: number;
  tripRigCredit: number;
  dutyRigCredit: number;
  legCredit: number;
  chosenBasis: LapCreditBasis | null;
  chosenCreditMinutes: number;
  estimatedPayCents: number;
  confidenceLevel: LapConfidenceLevel;
  confidenceReason: string;
  explanationText: string;
}

/**
 * Calculate minutes between two ISO timestamps
 */
function minutesBetween(startISO: string, endISO: string): number {
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  return Math.round((end - start) / (1000 * 60));
}

/**
 * Add minutes to an ISO timestamp
 */
function addMinutes(isoString: string, minutes: number): string {
  const date = new Date(isoString);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

/**
 * Format minutes as HH:MM
 */
function formatMinutes(minutes: number): string {
  const hrs = Math.floor(Math.abs(minutes) / 60);
  const mins = Math.abs(minutes) % 60;
  const sign = minutes < 0 ? "-" : "";
  return `${sign}${hrs}:${mins.toString().padStart(2, "0")}`;
}

/**
 * Calculate leg minutes that occur after LAP start time
 */
function calculateLegMinutesAfterLap(
  legs: LegData[],
  lapStartUtc: string
): number {
  const lapStartMs = new Date(lapStartUtc).getTime();
  let totalMinutes = 0;

  for (const leg of legs) {
    if (!leg.actualOutISO || !leg.actualInISO) continue;

    const legOutMs = new Date(leg.actualOutISO).getTime();
    const legInMs = new Date(leg.actualInISO).getTime();

    // If leg ends before LAP start, no credit
    if (legInMs <= lapStartMs) continue;

    // If leg starts after LAP start, full credit
    if (legOutMs >= lapStartMs) {
      totalMinutes += leg.actualBlockMinutes ?? Math.round((legInMs - legOutMs) / (1000 * 60));
      continue;
    }

    // Leg spans LAP start - partial credit
    const minutesAfterLap = Math.round((legInMs - lapStartMs) / (1000 * 60));
    totalMinutes += minutesAfterLap;
  }

  return totalMinutes;
}

/**
 * Main LAP calculation function
 */
export function calculateLap(input: LapCalculationInput): LapCalculationResult {
  const {
    originalArrivalUtc,
    actualArrivalUtc,
    dutyStartUtc,
    dutyEndUtc,
    isWxMx,
    isEdw,
    isDomicileAirportClosed,
    hourlyRateCents,
    legs = [],
  } = input;

  // Check if domicile airport is closed - LAP not applicable
  if (isDomicileAirportClosed) {
    return {
      isEligible: false,
      eligibilityReason: "LAP not applicable when domicile airport is closed",
      lapStartTimeUtc: null,
      lateMinutes: 0,
      legMinutesAfterLap: 0,
      dutyMinutesAfterLap: 0,
      tripRigCredit: 0,
      dutyRigCredit: 0,
      legCredit: 0,
      chosenBasis: null,
      chosenCreditMinutes: 0,
      estimatedPayCents: 0,
      confidenceLevel: "red",
      confidenceReason: "LAP not applicable - domicile airport closed",
      explanationText: "Late Arrival Pay is not applicable when the domicile airport is closed.",
    };
  }

  // Calculate how late the arrival was
  const lateMinutes = minutesBetween(originalArrivalUtc, actualArrivalUtc);

  // Check eligibility: must be > 4 hours (240 minutes) late
  if (lateMinutes <= 240) {
    return {
      isEligible: false,
      eligibilityReason: `Arrival was only ${formatMinutes(lateMinutes)} late. Must be > 4:00 late to qualify for LAP.`,
      lapStartTimeUtc: null,
      lateMinutes,
      legMinutesAfterLap: 0,
      dutyMinutesAfterLap: 0,
      tripRigCredit: 0,
      dutyRigCredit: 0,
      legCredit: 0,
      chosenBasis: null,
      chosenCreditMinutes: 0,
      estimatedPayCents: 0,
      confidenceLevel: "red",
      confidenceReason: `Not eligible - only ${formatMinutes(lateMinutes)} late (need > 4:00)`,
      explanationText: `Late Arrival Pay requires actual arrival to exceed original scheduled arrival by more than 4 hours. Actual delay was ${formatMinutes(lateMinutes)}.`,
    };
  }

  // Calculate LAP start time
  // Non-WX/MX: LAP starts at original scheduled arrival
  // WX/MX: LAP starts at original scheduled arrival + 4:00
  const lapStartTimeUtc = isWxMx
    ? addMinutes(originalArrivalUtc, 240) // +4 hours for WX/MX
    : originalArrivalUtc;

  // Calculate time from LAP start to actual arrival (trip rig basis)
  const minutesFromLapStart = minutesBetween(lapStartTimeUtc, actualArrivalUtc);

  // Calculate leg minutes after LAP start
  const legMinutesAfterLap = calculateLegMinutesAfterLap(legs, lapStartTimeUtc);

  // Calculate duty minutes after LAP start
  let dutyMinutesAfterLap = 0;
  if (dutyStartUtc && dutyEndUtc) {
    const effectiveDutyStart = new Date(dutyStartUtc).getTime() > new Date(lapStartTimeUtc).getTime()
      ? dutyStartUtc
      : lapStartTimeUtc;
    dutyMinutesAfterLap = minutesBetween(effectiveDutyStart, dutyEndUtc);
    dutyMinutesAfterLap = Math.max(0, dutyMinutesAfterLap);
  }

  // Calculate credit options
  // Trip Rig: minutes / 3.75 (convert to ratio then back to minutes)
  const tripRigCredit = Math.round(minutesFromLapStart / 3.75);

  // Duty Rig: EDW = duty/1.5, non-EDW = duty/2.0
  const dutyRigDivisor = isEdw ? 1.5 : 2.0;
  const dutyRigCredit = dutyMinutesAfterLap > 0
    ? Math.round(dutyMinutesAfterLap / dutyRigDivisor)
    : 0;

  // Leg Credit: actual leg minutes after LAP start
  const legCredit = legMinutesAfterLap;

  // Choose maximum credit
  let chosenBasis: LapCreditBasis = "TRIP_RIG";
  let chosenCreditMinutes = tripRigCredit;

  if (dutyRigCredit > chosenCreditMinutes && dutyMinutesAfterLap > 0) {
    chosenBasis = "DUTY_RIG";
    chosenCreditMinutes = dutyRigCredit;
  }

  if (legCredit > chosenCreditMinutes && legMinutesAfterLap > 0) {
    chosenBasis = "LEG";
    chosenCreditMinutes = legCredit;
  }

  // Calculate pay: creditHours × 1.5 × hourlyRate
  const creditHours = chosenCreditMinutes / 60;
  const estimatedPayCents = Math.round(creditHours * 1.5 * hourlyRateCents);

  // Determine confidence level
  let confidenceLevel: LapConfidenceLevel = "red";
  let confidenceReason = "";

  const hasLegs = legs.length > 0 && legs.some(l => l.actualOutISO && l.actualInISO);
  const hasDuty = dutyStartUtc && dutyEndUtc;

  if (hasLegs && hasDuty) {
    confidenceLevel = "green";
    confidenceReason = "All data available (legs + duty times)";
  } else if (hasLegs || hasDuty) {
    confidenceLevel = "yellow";
    confidenceReason = hasLegs
      ? "Leg data available but duty times missing"
      : "Duty times available but leg data missing";
  } else {
    confidenceLevel = "red";
    confidenceReason = "Both leg data and duty times missing - using trip rig only";
  }

  // Generate explanation text
  const explanationText = generateExplanation({
    originalArrivalUtc,
    actualArrivalUtc,
    lapStartTimeUtc,
    lateMinutes,
    isWxMx,
    isEdw,
    minutesFromLapStart,
    legMinutesAfterLap,
    dutyMinutesAfterLap,
    tripRigCredit,
    dutyRigCredit,
    legCredit,
    chosenBasis,
    chosenCreditMinutes,
    estimatedPayCents,
    hourlyRateCents,
    dutyRigDivisor,
  });

  return {
    isEligible: true,
    lapStartTimeUtc,
    lateMinutes,
    legMinutesAfterLap,
    dutyMinutesAfterLap,
    tripRigCredit,
    dutyRigCredit,
    legCredit,
    chosenBasis,
    chosenCreditMinutes,
    estimatedPayCents,
    confidenceLevel,
    confidenceReason,
    explanationText,
  };
}

/**
 * Generate deterministic explanation text
 */
function generateExplanation(data: {
  originalArrivalUtc: string;
  actualArrivalUtc: string;
  lapStartTimeUtc: string;
  lateMinutes: number;
  isWxMx: boolean;
  isEdw: boolean;
  minutesFromLapStart: number;
  legMinutesAfterLap: number;
  dutyMinutesAfterLap: number;
  tripRigCredit: number;
  dutyRigCredit: number;
  legCredit: number;
  chosenBasis: LapCreditBasis;
  chosenCreditMinutes: number;
  estimatedPayCents: number;
  hourlyRateCents: number;
  dutyRigDivisor: number;
}): string {
  const {
    originalArrivalUtc,
    actualArrivalUtc,
    lapStartTimeUtc,
    lateMinutes,
    isWxMx,
    isEdw,
    minutesFromLapStart,
    legMinutesAfterLap,
    dutyMinutesAfterLap,
    tripRigCredit,
    dutyRigCredit,
    legCredit,
    chosenBasis,
    chosenCreditMinutes,
    estimatedPayCents,
    hourlyRateCents,
    dutyRigDivisor,
  } = data;

  const originalTime = new Date(originalArrivalUtc).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const actualTime = new Date(actualArrivalUtc).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const lapStartTime = new Date(lapStartTimeUtc).toISOString().replace("T", " ").slice(0, 16) + " UTC";

  const lines: string[] = [];

  // Header
  lines.push("LATE ARRIVAL PAY (LAP) CALCULATION");
  lines.push("===================================");
  lines.push("");

  // Times
  lines.push("ARRIVAL TIMES:");
  lines.push(`  Original Scheduled Arrival: ${originalTime}`);
  lines.push(`  Actual Arrival at Domicile: ${actualTime}`);
  lines.push(`  Delay: ${formatMinutes(lateMinutes)} (${lateMinutes} minutes)`);
  lines.push("");

  // LAP Start
  lines.push("LAP START TIME:");
  if (isWxMx) {
    lines.push(`  Weather/Maintenance delay applies - LAP starts 4:00 after original arrival`);
  } else {
    lines.push(`  Non-WX/MX delay - LAP starts at original scheduled arrival`);
  }
  lines.push(`  LAP Start: ${lapStartTime}`);
  lines.push(`  Time after LAP start: ${formatMinutes(minutesFromLapStart)} (${minutesFromLapStart} minutes)`);
  lines.push("");

  // Credit Options
  lines.push("CREDIT OPTIONS (choose maximum):");
  lines.push("");

  lines.push(`  1. Trip Rig Credit:`);
  lines.push(`     ${minutesFromLapStart} minutes / 3.75 = ${tripRigCredit} minutes (${formatMinutes(tripRigCredit)})`);
  lines.push("");

  lines.push(`  2. Duty Rig Credit${isEdw ? " (EDW)" : ""}:`);
  if (dutyMinutesAfterLap > 0) {
    lines.push(`     ${dutyMinutesAfterLap} duty minutes / ${dutyRigDivisor} = ${dutyRigCredit} minutes (${formatMinutes(dutyRigCredit)})`);
  } else {
    lines.push(`     Duty times not available`);
  }
  lines.push("");

  lines.push(`  3. Leg Credit:`);
  if (legMinutesAfterLap > 0) {
    lines.push(`     Leg minutes after LAP start: ${legMinutesAfterLap} minutes (${formatMinutes(legMinutesAfterLap)})`);
  } else {
    lines.push(`     Leg data not available`);
  }
  lines.push("");

  // Chosen Basis
  const basisName = chosenBasis === "TRIP_RIG" ? "Trip Rig" :
                    chosenBasis === "DUTY_RIG" ? "Duty Rig" : "Leg Credit";
  lines.push(`CHOSEN BASIS: ${basisName}`);
  lines.push(`  Credit: ${formatMinutes(chosenCreditMinutes)} (${chosenCreditMinutes} minutes)`);
  lines.push("");

  // Pay Calculation
  const hourlyRate = hourlyRateCents / 100;
  const creditHours = chosenCreditMinutes / 60;
  const pay = estimatedPayCents / 100;

  lines.push("PAY CALCULATION:");
  lines.push(`  Credit Hours: ${creditHours.toFixed(2)}`);
  lines.push(`  Premium Rate: 1.5x`);
  lines.push(`  Hourly Rate: $${hourlyRate.toFixed(2)}`);
  lines.push(`  Formula: ${creditHours.toFixed(2)} × 1.5 × $${hourlyRate.toFixed(2)}`);
  lines.push(`  ESTIMATED PAY: $${pay.toFixed(2)}`);

  return lines.join("\n");
}
