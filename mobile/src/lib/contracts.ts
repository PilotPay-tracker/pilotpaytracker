// contracts.ts
// Shared API contracts (schemas and types) used by both the server and the app.
// Import in the app as: `import { type GetSampleResponse } from "@shared/contracts"`
// Import in the server as: `import { postSampleRequestSchema } from "@shared/contracts"`

import { z } from "zod";

// ============================================
// PER DIEM RATE CONSTANTS (cents per hour of TAFB)
// ============================================
// Domestic
export const PER_DIEM_DOMESTIC_CENTS_PER_HOUR = 350; // $3.50/hr
// International regions
export const PER_DIEM_INTERNATIONAL_CENTS_PER_HOUR = 420; // $4.20/hr
export const PER_DIEM_ASIA_CENTS_PER_HOUR = 390; // $3.90/hr
export const PER_DIEM_EUROPE_CENTS_PER_HOUR = 385; // $3.85/hr

// GET /api/sample
export const getSampleResponseSchema = z.object({
  message: z.string(),
});
export type GetSampleResponse = z.infer<typeof getSampleResponseSchema>;

// POST /api/sample
export const postSampleRequestSchema = z.object({
  value: z.string(),
});
export type PostSampleRequest = z.infer<typeof postSampleRequestSchema>;
export const postSampleResponseSchema = z.object({
  message: z.string(),
});
export type PostSampleResponse = z.infer<typeof postSampleResponseSchema>;

// POST /api/upload/image
export const uploadImageRequestSchema = z.object({
  image: z.instanceof(File),
});
export type UploadImageRequest = z.infer<typeof uploadImageRequestSchema>;
export const uploadImageResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  url: z.string(),
  filename: z.string(),
});
export type UploadImageResponse = z.infer<typeof uploadImageResponseSchema>;

// POST /api/upload/image-base64 - Upload image via base64 data
export const uploadImageBase64RequestSchema = z.object({
  base64: z.string(),
  mimeType: z.string().optional(),
  filename: z.string().optional(),
});
export type UploadImageBase64Request = z.infer<typeof uploadImageBase64RequestSchema>;
// Uses same response schema as regular upload

// ============================================
// FLIGHT ENTRIES
// ============================================

// Flight Entry Schema
export const flightEntrySchema = z.object({
  id: z.string(),
  dateISO: z.string(),
  airline: z.string(),
  flightNumber: z.string().nullable(),
  origin: z.string().nullable(),
  destination: z.string().nullable(),
  blockMinutes: z.number(),
  creditMinutes: z.number(),
  hourlyRateCents: z.number(),
  totalPayCents: z.number(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type FlightEntry = z.infer<typeof flightEntrySchema>;

// GET /api/flights - List flight entries
export const getFlightsRequestSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.number().optional(),
});
export type GetFlightsRequest = z.infer<typeof getFlightsRequestSchema>;
export const getFlightsResponseSchema = z.object({
  flights: z.array(flightEntrySchema),
  totalCount: z.number(),
});
export type GetFlightsResponse = z.infer<typeof getFlightsResponseSchema>;

// POST /api/flights - Create flight entry
export const createFlightRequestSchema = z.object({
  dateISO: z.string(),
  airline: z.string().optional(),
  flightNumber: z.string().optional(),
  origin: z.string().optional(),
  destination: z.string().optional(),
  blockMinutes: z.number(),
  creditMinutes: z.number(),
  notes: z.string().optional(),
});
export type CreateFlightRequest = z.infer<typeof createFlightRequestSchema>;
export const createFlightResponseSchema = z.object({
  success: z.boolean(),
  flight: flightEntrySchema,
});
export type CreateFlightResponse = z.infer<typeof createFlightResponseSchema>;

// DELETE /api/flights/:id - Delete flight entry
export const deleteFlightResponseSchema = z.object({
  success: z.boolean(),
});
export type DeleteFlightResponse = z.infer<typeof deleteFlightResponseSchema>;

// ============================================
// DASHBOARD / PAY SUMMARY
// ============================================

// GET /api/dashboard - Get dashboard data
export const getDashboardResponseSchema = z.object({
  // Current pay period
  currentPeriod: z.number(),
  periodStart: z.string(),
  periodEnd: z.string(),
  // Pay summary
  totalBlockMinutes: z.number(),
  totalCreditMinutes: z.number(),
  totalPayCents: z.number(),
  entryCount: z.number(),
  // Settings
  hourlyRateCents: z.number(),
  // Recent flights
  recentFlights: z.array(flightEntrySchema),
  // Guarantee breakdown (server-computed, accounts for dropped/company-removed trips)
  paidCreditMinutes: z.number().optional(),
  jaPickupCreditMinutes: z.number().optional(),
  droppedByUserCreditMinutes: z.number().optional(),
  bufferMinutes: z.number().optional(),
  isGuaranteeActive: z.boolean().optional(),
  isGuaranteeWaivedByUserDrop: z.boolean().optional(),
  // Extended audit fields
  companyRemovedCreditMinutes: z.number().optional(),
  baseScheduleCredit: z.number().optional(),
  protectedBaseCredit: z.number().optional(),
  paidBaseCreditMinutes: z.number().optional(),
  basePayCents: z.number().optional(),
  jaPayCents: z.number().optional(),
  guaranteeMinutes: z.number().optional(),
  adjustedGuaranteeFloor: z.number().optional(),
  // Awarded baseline analysis — populated by backend; drives "Why This Amount?" explanations
  baselineAnalysis: z.object({
    awardedCreditMinutes: z.number(),
    awardedCreditHours: z.number(),
    source: z.enum(["uploaded_award", "manual_entry", "estimated"]),
    confidence: z.enum(["high", "medium", "low"]),
    isBaselineSet: z.boolean(),
    guaranteeGapMinutes: z.number(),
    straightPickupCreditMinutes: z.number(),
    pickupsFillGuaranteeGapMinutes: z.number(),
    pickupsAboveGuaranteeMinutes: z.number(),
    awardedAboveGuarantee: z.boolean(),
    droppedCreditMinutes: z.number(),
    dropsReducedPaidCredit: z.boolean(),
    extraPaidAboveGuaranteeMinutes: z.number(),
    explanationLines: z.array(z.string()),
  }).optional(),
});
export type GetDashboardResponse = z.infer<typeof getDashboardResponseSchema>;
export type BaselinePayAnalysis = NonNullable<GetDashboardResponse["baselineAnalysis"]>;

// ============================================
// USER SETTINGS
// ============================================

// GET /api/settings - Get user settings
export const getUserSettingsResponseSchema = z.object({
  hourlyRateCents: z.number(),
  airline: z.string(),
});
export type GetUserSettingsResponse = z.infer<typeof getUserSettingsResponseSchema>;

// PUT /api/settings - Update user settings
export const updateUserSettingsRequestSchema = z.object({
  hourlyRateCents: z.number().optional(),
  airline: z.string().optional(),
});
export type UpdateUserSettingsRequest = z.infer<typeof updateUserSettingsRequestSchema>;
export const updateUserSettingsResponseSchema = z.object({
  success: z.boolean(),
  hourlyRateCents: z.number(),
  airline: z.string(),
});
export type UpdateUserSettingsResponse = z.infer<typeof updateUserSettingsResponseSchema>;

// ============================================
// PILOT PROFILE
// ============================================

// Position and Base enums
export const positionValues = ["FO", "CPT"] as const;
export type Position = (typeof positionValues)[number];

export const baseValues = ["ANC", "ONT", "SDF", "SDFZ", "MIA"] as const;
export type Base = (typeof baseValues)[number];

// Pilot Profile Schema
export const pilotProfileSchema = z.object({
  id: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  gemsId: z.string().nullable(),
  position: z.string().nullable(),
  base: z.string().nullable(),
  dateOfHire: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  hourlyRateCents: z.number(),
  airline: z.string(),
  // Onboarding fields
  onboardingComplete: z.boolean(),
  onboardingStep: z.number(),
  aliasPackVersion: z.string().nullable(),
  operatorType: z.string().nullable(),
  contractMappingStatus: z.string(),
  payRuleDefaultsApplied: z.boolean(),
  calendarSyncConnected: z.boolean(),
  // Subscription fields
  trialStatus: z.string().optional(),
  trialStartDate: z.string().nullable().optional(),
  trialEndDate: z.string().nullable().optional(),
  subscriptionStatus: z.string().optional(),
  subscriptionStartDate: z.string().nullable().optional(),
  subscriptionEndDate: z.string().nullable().optional(),
  // Credit Cap Preferences
  creditCapPeriodType: z.string().optional(),
  creditCapAwardedLineCredit: z.number().optional(),
  creditCapIsRDGLine: z.boolean().optional(),
  creditCapAssignmentType: z.string().optional(),
  creditCapExclusionVacation: z.number().optional(),
  creditCapExclusionTraining: z.number().optional(),
  creditCapExclusionJuniorManning: z.number().optional(),
  creditCapExclusionCRAF: z.number().optional(),
  creditCapExclusionSick: z.number().optional(),
  creditCapAllowTripCompletion: z.boolean().optional(),
  creditCapTripCompletionOvercap: z.number().optional(),
  creditCapEnableVacationRelief: z.boolean().optional(),
  creditCapDroppedTripsCredit: z.number().optional(),
  creditCapHasVacationInPeriod: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PilotProfile = z.infer<typeof pilotProfileSchema>;

// Helper to check if profile is complete
export function isProfileComplete(profile: PilotProfile | null): boolean {
  if (!profile) return false;
  return !!(
    profile.firstName &&
    profile.lastName &&
    profile.gemsId &&
    profile.position &&
    profile.base &&
    profile.dateOfHire &&
    profile.dateOfBirth &&
    profile.hourlyRateCents > 0
  );
}

// Helper to check if onboarding is complete
export function isOnboardingComplete(profile: PilotProfile | null): boolean {
  if (!profile) return false;
  return profile.onboardingComplete;
}

// Contract mapping status values
export const contractMappingStatusValues = ["none", "suggested", "confirmed"] as const;
export type ContractMappingStatus = (typeof contractMappingStatusValues)[number];

// GET /api/profile - Get pilot profile
export const getProfileResponseSchema = z.object({
  profile: pilotProfileSchema,
  isComplete: z.boolean(),
});
export type GetProfileResponse = z.infer<typeof getProfileResponseSchema>;

// PUT /api/profile - Update pilot profile
export const updateProfileRequestSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  gemsId: z.string().optional(),
  position: z.string().optional(),
  base: z.string().optional(),
  dateOfHire: z.string().optional(),
  dateOfBirth: z.string().optional(),
  hourlyRateCents: z.number().optional(),
  airline: z.string().optional(),
  // Onboarding fields
  onboardingComplete: z.boolean().optional(),
  onboardingStep: z.number().optional(),
  aliasPackVersion: z.string().optional(),
  operatorType: z.string().optional(),
  contractMappingStatus: z.enum(contractMappingStatusValues).optional(),
  payRuleDefaultsApplied: z.boolean().optional(),
  calendarSyncConnected: z.boolean().optional(),
  payYear: z.number().int().min(1).max(15).optional(),
  hourlyRateSource: z.enum(["contract", "manual"]).optional(),
  // Credit Cap Preferences
  creditCapPeriodType: z.string().optional(),
  creditCapAwardedLineCredit: z.number().optional(),
  creditCapIsRDGLine: z.boolean().optional(),
  creditCapAssignmentType: z.string().optional(),
  creditCapExclusionVacation: z.number().optional(),
  creditCapExclusionTraining: z.number().optional(),
  creditCapExclusionJuniorManning: z.number().optional(),
  creditCapExclusionCRAF: z.number().optional(),
  creditCapExclusionSick: z.number().optional(),
  creditCapAllowTripCompletion: z.boolean().optional(),
  creditCapTripCompletionOvercap: z.number().optional(),
  creditCapEnableVacationRelief: z.boolean().optional(),
  creditCapDroppedTripsCredit: z.number().optional(),
  creditCapHasVacationInPeriod: z.boolean().optional(),
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

// ============================================
// BENCHMARK LOOKUP
// ============================================

// GET /api/pay-benchmarks/lookup
export const benchmarkLookupResponseSchema = z.object({
  airline: z.string(),
  effectiveDate: z.string(),
  seat: z.enum(["FO", "Captain"]),
  yearOfService: z.number(),
  hourlyRateCents: z.number(),
  payAtGuaranteeCents: z.number(),
  avgLinePayCents: z.number(),
  avgTotalPayCents: z.number(),
  sourceNote: z.string().nullable(),
});
export type BenchmarkLookupResponse = z.infer<typeof benchmarkLookupResponseSchema>;

export const updateProfileResponseSchema = z.object({
  success: z.boolean(),
  profile: pilotProfileSchema,
  isComplete: z.boolean(),
});
export type UpdateProfileResponse = z.infer<typeof updateProfileResponseSchema>;

// DELETE /api/profile - Delete pilot profile (reset)
export const deleteProfileResponseSchema = z.object({
  success: z.boolean(),
});
export type DeleteProfileResponse = z.infer<typeof deleteProfileResponseSchema>;

// ============================================
// TRIPS & EVENTS
// ============================================

// Event Types
export const eventTypeValues = [
  "REPORT",
  "FLIGHT",
  "DEADHEAD",
  "LAYOVER",
  "HOTEL",
  "TRANSPORT",
  "COMMUTE",
  "OTHER",
] as const;
export type EventType = (typeof eventTypeValues)[number];

// Flight metadata stored in TripEvent.flightMetadata JSON field
export const flightMetadataSchema = z.object({
  flightNumber: z.string().optional(),
  equipment: z.string().optional(),
  blockMinutes: z.number().optional(),
  dutyMinutes: z.number().optional(),
  creditMinutes: z.number().optional(),
  isDeadhead: z.boolean().optional(),
  category: z.string().optional(),
  dayCode: z.string().optional(), // SU01, TU03, etc.
  hasOoiProof: z.boolean().optional(),
  ooiProofUri: z.string().optional(),
});
export type FlightMetadata = z.infer<typeof flightMetadataSchema>;

// TripEvent Schema
export const tripEventSchema = z.object({
  id: z.string(),
  tripId: z.string(),
  dutyDayId: z.string().nullable(),
  eventType: z.enum(eventTypeValues),
  startTimeLocal: z.string().nullable(),
  endTimeLocal: z.string().nullable(),
  startTimeUtc: z.string().nullable(),
  endTimeUtc: z.string().nullable(),
  timezone: z.string().nullable(),
  depAirport: z.string().nullable(),
  arrAirport: z.string().nullable(),
  station: z.string().nullable(),
  flightMetadata: z.string().nullable(), // JSON string, parse with flightMetadataSchema
  layoverMinutes: z.number().nullable(),
  hotelName: z.string().nullable(),
  hotelPhone: z.string().nullable(),
  hotelBooked: z.boolean(),
  hotelAddress: z.string().nullable(),
  transportNotes: z.string().nullable(),
  transportPhone: z.string().nullable(),
  creditMinutes: z.number(),
  rawCreditText: z.string().nullable(),
  minGuarantee: z.boolean(),
  sortOrder: z.number(),
  sourceType: z.string().nullable(),
  confidence: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TripEvent = z.infer<typeof tripEventSchema>;

// Trip Schema (extended)
export const tripSchema = z.object({
  id: z.string(),
  userId: z.string(),
  tripNumber: z.string().nullable(),
  pairingId: z.string().nullable(),
  source: z.string(),
  baseFleet: z.string().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  totalBlockMinutes: z.number(),
  totalCreditMinutes: z.number(),
  totalPayCents: z.number(),
  legCount: z.number(),
  dutyDaysCount: z.number(),
  totalTafbMinutes: z.number(),
  totalPdiemCents: z.number(),
  premiumCents: z.number(),
  status: z.string(),
  needsReview: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  events: z.array(tripEventSchema).optional(),
  // Phase 5: Pay Protection Credit Fields
  protectedCreditMinutes: z.number().optional(), // From original upload (IMMUTABLE)
  currentCreditMinutes: z.number().optional(), // From latest upload
  payCreditMinutes: z.number().optional(), // max(protected, current) - USE FOR ALL PAY CALCULATIONS
  // Trip action / pickup classification
  tripActionType: z.string().optional(), // "none" | "dropped_by_user" | "company_removed"
  pickupType: z.string().optional(), // "none" | "straight" | "ja"
});
export type Trip = z.infer<typeof tripSchema>;

// GET /api/trips - List trips
export const getTripsRequestSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.string().optional(),
});
export type GetTripsRequest = z.infer<typeof getTripsRequestSchema>;

export const getTripsResponseSchema = z.object({
  trips: z.array(tripSchema),
});
export type GetTripsResponse = z.infer<typeof getTripsResponseSchema>;

// GET /api/trips/:id - Get single trip with events
export const getTripResponseSchema = z.object({
  trip: tripSchema,
});
export type GetTripResponse = z.infer<typeof getTripResponseSchema>;

// POST /api/trips - Create trip
export const createTripRequestSchema = z.object({
  tripNumber: z.string().optional(),
  pairingId: z.string().optional(),
  baseFleet: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
  source: z.enum(["import", "oooi", "manual", "logbook"]).optional(),
});
export type CreateTripRequest = z.infer<typeof createTripRequestSchema>;

export const createTripResponseSchema = z.object({
  success: z.boolean(),
  trip: tripSchema,
});
export type CreateTripResponse = z.infer<typeof createTripResponseSchema>;

// PUT /api/trips/:id - Update trip
export const updateTripRequestSchema = z.object({
  tripNumber: z.string().optional(),
  pairingId: z.string().optional(),
  baseFleet: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  source: z.enum(["import", "oooi", "manual", "logbook"]).optional(),
  totalCreditMinutes: z.number().optional(),
  totalBlockMinutes: z.number().optional(),
});
export type UpdateTripRequest = z.infer<typeof updateTripRequestSchema>;

export const updateTripResponseSchema = z.object({
  success: z.boolean(),
  trip: tripSchema,
});
export type UpdateTripResponse = z.infer<typeof updateTripResponseSchema>;

// DELETE /api/trips/:id
export const deleteTripResponseSchema = z.object({
  success: z.boolean(),
});
export type DeleteTripResponse = z.infer<typeof deleteTripResponseSchema>;

// ============================================
// SCHEDULE PARSING (Upload & Parse Screenshots)
// ============================================

// Source types for schedule screenshots
export const scheduleSourceTypeValues = [
  "trip_board_browser",
  "trip_board_trip_details",
  "crew_access_trip_info",
] as const;
export type ScheduleSourceType = (typeof scheduleSourceTypeValues)[number];

// POST /api/schedule/parse - Upload and parse schedule screenshot(s)
export const parseScheduleRequestSchema = z.object({
  images: z.array(z.string()), // Array of image URLs from upload
});
export type ParseScheduleRequest = z.infer<typeof parseScheduleRequestSchema>;

// Parsed trip data returned from parsing
export const parsedTripDataSchema = z.object({
  tripId: z.string().optional(), // Existing trip ID if merged
  tripNumber: z.string().optional(),
  pairingId: z.string().optional(),
  baseFleet: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  totals: z
    .object({
      creditMinutes: z.number().optional(),
      blockMinutes: z.number().optional(),
      tafbMinutes: z.number().optional(),
      pdiemCents: z.number().optional(),
      dutyDays: z.number().optional(),
    })
    .optional(),
  events: z.array(
    z.object({
      eventType: z.enum(eventTypeValues),
      startTimeLocal: z.string().optional(),
      endTimeLocal: z.string().optional(),
      depAirport: z.string().optional(),
      arrAirport: z.string().optional(),
      station: z.string().optional(),
      flightMetadata: flightMetadataSchema.optional(),
      layoverMinutes: z.number().optional(),
      hotelName: z.string().optional(),
      hotelPhone: z.string().optional(),
      hotelBooked: z.boolean().optional(),
      transportNotes: z.string().optional(),
      transportPhone: z.string().optional(),
      creditMinutes: z.number().optional(),
      rawCreditText: z.string().optional(),
    })
  ),
  sourceType: z.enum(scheduleSourceTypeValues),
  confidence: z.number(),
});
export type ParsedTripData = z.infer<typeof parsedTripDataSchema>;

export const parseScheduleResponseSchema = z.object({
  success: z.boolean(),
  parsedTrips: z.array(parsedTripDataSchema),
  createdTripIds: z.array(z.string()),
  updatedTripIds: z.array(z.string()),
  evidenceIds: z.array(z.string()),
  errors: z.array(z.string()).optional(),
});
export type ParseScheduleResponse = z.infer<typeof parseScheduleResponseSchema>;

// ============================================
// TRIPS TIMELINE (Grouped by date for UI)
// ============================================

// Day group for timeline display
export const tripDayGroupSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  dateDisplay: z.string(), // "Tuesday, Jan 6"
  eventCount: z.number(),
  creditMinutes: z.number(),
  rawCreditText: z.string().optional(),
  minGuaranteeApplied: z.boolean(),
  events: z.array(tripEventSchema),
});
export type TripDayGroup = z.infer<typeof tripDayGroupSchema>;

// GET /api/trips/timeline - Get trips as timeline grouped by date
export const getTripsTimelineRequestSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  month: z.string().optional(), // YYYY-MM format
});
export type GetTripsTimelineRequest = z.infer<typeof getTripsTimelineRequestSchema>;

export const getTripsTimelineResponseSchema = z.object({
  days: z.array(tripDayGroupSchema),
  trips: z.array(tripSchema),
});
export type GetTripsTimelineResponse = z.infer<typeof getTripsTimelineResponseSchema>;

// DELETE /api/trips/clear - Clear trips for a month or all
export const clearTripsRequestSchema = z.object({
  month: z.string().optional(), // YYYY-MM format, if not provided clears all
});
export type ClearTripsRequest = z.infer<typeof clearTripsRequestSchema>;

export const clearTripsResponseSchema = z.object({
  success: z.boolean(),
  deletedCount: z.number(),
});
export type ClearTripsResponse = z.infer<typeof clearTripsResponseSchema>;

// ============================================
// PAY RULES ENGINE
// User-configurable, airline-agnostic pay rules
// ============================================

// Rule Types
export const ruleTypeValues = [
  "GUARANTEE", // Minimum credit/pay thresholds
  "PREMIUM_ADD", // Add fixed time/pay
  "PREMIUM_MULTIPLY", // Multiply credit/pay
  "THRESHOLD", // Triggered when value exceeds threshold
  "LIMIT", // Maximum values (e.g., 30-in-7)
  "CUSTOM", // User-defined formula (future)
] as const;
export type RuleType = (typeof ruleTypeValues)[number];

// Rule Scope
export const ruleScopeValues = [
  "DAILY", // Per duty day
  "TRIP", // Per trip/pairing
  "PAY_PERIOD", // Per pay period
  "MONTHLY", // Per calendar month
  "YEARLY", // Per calendar year
  "ROLLING", // Rolling window (e.g., 7 days)
] as const;
export type RuleScope = (typeof ruleScopeValues)[number];

// Value config schemas for different rule types
export const guaranteeConfigSchema = z.object({
  creditMinutes: z.number().optional(),
  payCents: z.number().optional(),
});
export type GuaranteeConfig = z.infer<typeof guaranteeConfigSchema>;

export const premiumAddConfigSchema = z.object({
  addMinutes: z.number().optional(),
  addCents: z.number().optional(),
});
export type PremiumAddConfig = z.infer<typeof premiumAddConfigSchema>;

export const premiumMultiplyConfigSchema = z.object({
  multiplier: z.number(),
});
export type PremiumMultiplyConfig = z.infer<typeof premiumMultiplyConfigSchema>;

export const thresholdConfigSchema = z.object({
  triggerMinutes: z.number().optional(),
  triggerCents: z.number().optional(),
  action: z.enum(["PREMIUM_ADD", "PREMIUM_MULTIPLY"]),
  addMinutes: z.number().optional(),
  addCents: z.number().optional(),
  multiplier: z.number().optional(),
});
export type ThresholdConfig = z.infer<typeof thresholdConfigSchema>;

export const limitConfigSchema = z.object({
  maxMinutes: z.number().optional(),
  maxCents: z.number().optional(),
  warningMinutes: z.number().optional(),
  warningCents: z.number().optional(),
});
export type LimitConfig = z.infer<typeof limitConfigSchema>;

// Condition for when a rule applies
export const ruleConditionSchema = z.object({
  field: z.string(), // e.g., "dutyMinutes", "premiumCode", "position"
  operator: z.enum(["=", "!=", ">", ">=", "<", "<=", "in", "not_in"]),
  value: z.union([z.string(), z.number(), z.array(z.string())]),
});
export type RuleCondition = z.infer<typeof ruleConditionSchema>;

// Pay Rule Category Schema
export const payRuleCategorySchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PayRuleCategory = z.infer<typeof payRuleCategorySchema>;

// Pay Rule Schema
export const payRuleSchema = z.object({
  id: z.string(),
  userId: z.string(),
  categoryId: z.string().nullable(),
  name: z.string(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  ruleType: z.enum(ruleTypeValues),
  scope: z.enum(ruleScopeValues),
  rollingWindowDays: z.number().nullable(),
  valueConfig: z.string(), // JSON string
  conditions: z.string().nullable(), // JSON string
  airlineLabels: z.string().nullable(), // JSON string
  priority: z.number(),
  isActive: z.boolean(),
  isBuiltIn: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  category: payRuleCategorySchema.nullable().optional(),
});
export type PayRule = z.infer<typeof payRuleSchema>;

// Pay Rule Application Schema
export const payRuleApplicationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  ruleId: z.string(),
  tripId: z.string().nullable(),
  dutyDayId: z.string().nullable(),
  flightEntryId: z.string().nullable(),
  payPeriodStart: z.string().nullable(),
  appliedAt: z.string(),
  originalValueMinutes: z.number().nullable(),
  originalValueCents: z.number().nullable(),
  adjustedValueMinutes: z.number().nullable(),
  adjustedValueCents: z.number().nullable(),
  adjustmentMinutes: z.number().nullable(),
  adjustmentCents: z.number().nullable(),
  explanation: z.string().nullable(),
  source: z.string(),
  createdAt: z.string(),
  rule: payRuleSchema.optional(),
});
export type PayRuleApplication = z.infer<typeof payRuleApplicationSchema>;

// GET /api/pay-rules/categories - List categories
export const getPayRuleCategoriesResponseSchema = z.object({
  categories: z.array(payRuleCategorySchema),
});
export type GetPayRuleCategoriesResponse = z.infer<typeof getPayRuleCategoriesResponseSchema>;

// POST /api/pay-rules/categories - Create category
export const createPayRuleCategoryRequestSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  sortOrder: z.number().optional(),
});
export type CreatePayRuleCategoryRequest = z.infer<typeof createPayRuleCategoryRequestSchema>;

export const createPayRuleCategoryResponseSchema = z.object({
  success: z.boolean(),
  category: payRuleCategorySchema,
});
export type CreatePayRuleCategoryResponse = z.infer<typeof createPayRuleCategoryResponseSchema>;

// GET /api/pay-rules - List rules
export const getPayRulesRequestSchema = z.object({
  categoryId: z.string().optional(),
  ruleType: z.enum(ruleTypeValues).optional(),
  scope: z.enum(ruleScopeValues).optional(),
  activeOnly: z.boolean().optional(),
});
export type GetPayRulesRequest = z.infer<typeof getPayRulesRequestSchema>;

export const getPayRulesResponseSchema = z.object({
  rules: z.array(payRuleSchema),
  categories: z.array(payRuleCategorySchema),
});
export type GetPayRulesResponse = z.infer<typeof getPayRulesResponseSchema>;

// POST /api/pay-rules - Create rule
export const createPayRuleRequestSchema = z.object({
  categoryId: z.string().optional(),
  name: z.string(),
  code: z.string().optional(),
  description: z.string().optional(),
  ruleType: z.enum(ruleTypeValues),
  scope: z.enum(ruleScopeValues),
  rollingWindowDays: z.number().optional(),
  valueConfig: z.record(z.string(), z.unknown()), // Will be stringified
  conditions: z.array(ruleConditionSchema).optional(),
  airlineLabels: z.record(z.string(), z.string()).optional(),
  priority: z.number().optional(),
});
export type CreatePayRuleRequest = z.infer<typeof createPayRuleRequestSchema>;

export const createPayRuleResponseSchema = z.object({
  success: z.boolean(),
  rule: payRuleSchema,
});
export type CreatePayRuleResponse = z.infer<typeof createPayRuleResponseSchema>;

// PUT /api/pay-rules/:id - Update rule
export const updatePayRuleRequestSchema = createPayRuleRequestSchema.partial();
export type UpdatePayRuleRequest = z.infer<typeof updatePayRuleRequestSchema>;

export const updatePayRuleResponseSchema = z.object({
  success: z.boolean(),
  rule: payRuleSchema,
});
export type UpdatePayRuleResponse = z.infer<typeof updatePayRuleResponseSchema>;

// DELETE /api/pay-rules/:id
export const deletePayRuleResponseSchema = z.object({
  success: z.boolean(),
});
export type DeletePayRuleResponse = z.infer<typeof deletePayRuleResponseSchema>;

// POST /api/pay-rules/init-defaults - Initialize default rules for user
export const initDefaultRulesRequestSchema = z.object({
  airline: z.string().optional(), // Optionally customize labels for airline
});
export type InitDefaultRulesRequest = z.infer<typeof initDefaultRulesRequestSchema>;

export const initDefaultRulesResponseSchema = z.object({
  success: z.boolean(),
  rulesCreated: z.number(),
  categoriesCreated: z.number(),
});
export type InitDefaultRulesResponse = z.infer<typeof initDefaultRulesResponseSchema>;

// GET /api/pay-rules/applications - Get rule applications
export const getPayRuleApplicationsRequestSchema = z.object({
  tripId: z.string().optional(),
  dutyDayId: z.string().optional(),
  payPeriodStart: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
export type GetPayRuleApplicationsRequest = z.infer<typeof getPayRuleApplicationsRequestSchema>;

export const getPayRuleApplicationsResponseSchema = z.object({
  applications: z.array(payRuleApplicationSchema),
});
export type GetPayRuleApplicationsResponse = z.infer<typeof getPayRuleApplicationsResponseSchema>;

// ============================================
// PAY EVENTS - Track pay-affecting events
// ============================================

// Pay Event Types (universal)
export const payEventTypeValues = [
  "SCHEDULE_CHANGE", // Schedule changed after report/check-in
  "DUTY_EXTENSION", // Duty period extended beyond original
  "REASSIGNMENT", // Reassigned to different trip/pairing
  "PREMIUM_TRIGGER", // Manual premium trigger
  "PAY_PROTECTION", // Pay protection event (sick, vacation, etc.)
  "JUNIOR_ASSIGNMENT", // Junior assignment (draft/JA)
  "TRAINING", // Training event
  "DEADHEAD", // Deadhead assignment
  "RESERVE_ACTIVATION", // Called from reserve
  "OTHER", // Other pay-affecting event
] as const;
export type PayEventType = (typeof payEventTypeValues)[number];

// Pay Event Status
export const payEventStatusValues = ["open", "resolved", "disputed"] as const;
export type PayEventStatus = (typeof payEventStatusValues)[number];

// Contact Methods
export const contactMethodValues = ["phone", "acars", "message", "other"] as const;
export type ContactMethod = (typeof contactMethodValues)[number];

// Document Types
export const payEventDocTypeValues = ["NOTE", "CALL_LOG", "EMAIL", "SCREENSHOT", "ATTACHMENT"] as const;
export type PayEventDocType = (typeof payEventDocTypeValues)[number];

// Pay Event Document Schema
export const payEventDocumentSchema = z.object({
  id: z.string(),
  payEventId: z.string(),
  docType: z.enum(payEventDocTypeValues),
  contactName: z.string().nullable(),
  contactId: z.string().nullable(),
  contactPhone: z.string().nullable(),
  content: z.string().nullable(),
  attachmentUrl: z.string().nullable(),
  interactionTimeISO: z.string().nullable(),
  createdAt: z.string(),
});
export type PayEventDocument = z.infer<typeof payEventDocumentSchema>;

// Pay Event Schema
export const payEventSchema = z.object({
  id: z.string(),
  userId: z.string(),
  eventType: z.enum(payEventTypeValues),
  airlineLabel: z.string().nullable(),
  eventDateISO: z.string(),
  eventTimeISO: z.string().nullable(),
  tripId: z.string().nullable(),
  dutyDayId: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  originalTripNumber: z.string().nullable(),
  originalStartTime: z.string().nullable(),
  originalEndTime: z.string().nullable(),
  originalCreditMinutes: z.number().nullable(),
  newTripNumber: z.string().nullable(),
  newStartTime: z.string().nullable(),
  newEndTime: z.string().nullable(),
  newCreditMinutes: z.number().nullable(),
  creditDifferenceMinutes: z.number().nullable(),
  payDifferenceCents: z.number().nullable(),
  triggeredRuleIds: z.string().nullable(),
  status: z.enum(payEventStatusValues),
  needsReview: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  documentation: z.array(payEventDocumentSchema).optional(),
});
export type PayEvent = z.infer<typeof payEventSchema>;

// GET /api/pay-events - List pay events
export const getPayEventsRequestSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  eventType: z.enum(payEventTypeValues).optional(),
  tripId: z.string().optional(),
  status: z.enum(payEventStatusValues).optional(),
});
export type GetPayEventsRequest = z.infer<typeof getPayEventsRequestSchema>;

export const getPayEventsResponseSchema = z.object({
  events: z.array(payEventSchema),
});
export type GetPayEventsResponse = z.infer<typeof getPayEventsResponseSchema>;

// GET /api/pay-events/:id - Get single pay event with documents
export const getPayEventResponseSchema = z.object({
  event: payEventSchema,
});
export type GetPayEventResponse = z.infer<typeof getPayEventResponseSchema>;

// POST /api/pay-events - Create pay event
export const createPayEventRequestSchema = z.object({
  eventType: z.enum(payEventTypeValues),
  airlineLabel: z.string().optional(),
  eventDateISO: z.string(),
  eventTimeISO: z.string().optional(),
  tripId: z.string().optional(),
  dutyDayId: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  originalTripNumber: z.string().optional(),
  originalStartTime: z.string().optional(),
  originalEndTime: z.string().optional(),
  originalCreditMinutes: z.number().optional(),
  newTripNumber: z.string().optional(),
  newStartTime: z.string().optional(),
  newEndTime: z.string().optional(),
  newCreditMinutes: z.number().optional(),
  // Phase 3: Premium code fields
  premiumCode: z.string().optional(), // e.g., "AP0", "LRP", "SVT"
  premiumVariantKey: z.string().optional(), // e.g., "ap0_4hrs" for variant selection
});
export type CreatePayEventRequest = z.infer<typeof createPayEventRequestSchema>;

export const createPayEventResponseSchema = z.object({
  success: z.boolean(),
  event: payEventSchema,
});
export type CreatePayEventResponse = z.infer<typeof createPayEventResponseSchema>;

// PUT /api/pay-events/:id - Update pay event
export const updatePayEventRequestSchema = createPayEventRequestSchema.partial().extend({
  status: z.enum(payEventStatusValues).optional(),
  needsReview: z.boolean().optional(),
});
export type UpdatePayEventRequest = z.infer<typeof updatePayEventRequestSchema>;

export const updatePayEventResponseSchema = z.object({
  success: z.boolean(),
  event: payEventSchema,
});
export type UpdatePayEventResponse = z.infer<typeof updatePayEventResponseSchema>;

// DELETE /api/pay-events/:id
export const deletePayEventResponseSchema = z.object({
  success: z.boolean(),
});
export type DeletePayEventResponse = z.infer<typeof deletePayEventResponseSchema>;

// POST /api/pay-events/:id/documents - Add document to event
export const createPayEventDocumentRequestSchema = z.object({
  docType: z.enum(payEventDocTypeValues),
  contactName: z.string().optional(),
  contactId: z.string().optional(),
  contactPhone: z.string().optional(),
  content: z.string().optional(),
  attachmentUrl: z.string().optional(),
  interactionTimeISO: z.string().optional(),
});
export type CreatePayEventDocumentRequest = z.infer<typeof createPayEventDocumentRequestSchema>;

export const createPayEventDocumentResponseSchema = z.object({
  success: z.boolean(),
  document: payEventDocumentSchema,
});
export type CreatePayEventDocumentResponse = z.infer<typeof createPayEventDocumentResponseSchema>;

// DELETE /api/pay-events/:eventId/documents/:docId
export const deletePayEventDocumentResponseSchema = z.object({
  success: z.boolean(),
});
export type DeletePayEventDocumentResponse = z.infer<typeof deletePayEventDocumentResponseSchema>;

// ============================================
// PROJECTIONS - Earnings forecasts and goals
// ============================================

// Actual earnings summary
export const actualEarningsSchema = z.object({
  creditMinutes: z.number(),
  blockMinutes: z.number(),
  payCents: z.number(),
  flights: z.number(),
});
export type ActualEarnings = z.infer<typeof actualEarningsSchema>;

// Period projection
export const periodProjectionSchema = z.object({
  start: z.string(),
  end: z.string(),
  periodNumber: z.number().optional(),
  name: z.string().optional(),
  year: z.number().optional(),
  daysElapsed: z.number(),
  daysRemaining: z.number(),
  daysTotal: z.number(),
  actual: actualEarningsSchema,
  dailyAvgCents: z.number(),
  projectedCents: z.number(),
  projectedCreditMinutes: z.number(),
});
export type PeriodProjection = z.infer<typeof periodProjectionSchema>;

// GET /api/projections
export const getProjectionsResponseSchema = z.object({
  asOfDate: z.string(),
  hourlyRateCents: z.number(),
  payPeriod: periodProjectionSchema,
  month: periodProjectionSchema,
  year: periodProjectionSchema,
});
export type GetProjectionsResponse = z.infer<typeof getProjectionsResponseSchema>;

// Projection scope
export const projectionScopeValues = ["PAY_PERIOD", "MONTH", "YEAR"] as const;
export type ProjectionScope = (typeof projectionScopeValues)[number];

// POST /api/projections/goal
export const calculateGoalRequestSchema = z.object({
  targetCents: z.number(),
  scope: z.enum(projectionScopeValues),
});
export type CalculateGoalRequest = z.infer<typeof calculateGoalRequestSchema>;

export const calculateGoalResponseSchema = z.object({
  scope: z.enum(projectionScopeValues),
  startDate: z.string(),
  endDate: z.string(),
  targetCents: z.number(),
  currentCents: z.number(),
  remainingCents: z.number(),
  percentComplete: z.number(),
  isOnTrack: z.boolean(),
  daysRemaining: z.number(),
  hourlyRateCents: z.number(),
  currentCreditMinutes: z.number(),
  required: z.object({
    totalCents: z.number(),
    dailyCents: z.number(),
    dailyCreditMinutes: z.number(),
    weeklyCents: z.number(),
    weeklyCreditMinutes: z.number(),
  }),
});
export type CalculateGoalResponse = z.infer<typeof calculateGoalResponseSchema>;

// POST /api/projections/what-if
export const whatIfRequestSchema = z.object({
  additionalCreditMinutes: z.number().optional(),
  additionalTrips: z.number().optional(),
  newHourlyRateCents: z.number().optional(),
  scope: z.enum(projectionScopeValues),
});
export type WhatIfRequest = z.infer<typeof whatIfRequestSchema>;

export const whatIfResponseSchema = z.object({
  scope: z.enum(projectionScopeValues),
  startDate: z.string(),
  endDate: z.string(),
  current: z.object({
    creditMinutes: z.number(),
    payCents: z.number(),
    hourlyRateCents: z.number(),
  }),
  scenario: z.object({
    additionalCreditMinutes: z.number(),
    additionalTrips: z.number(),
    avgTripCreditMinutes: z.number(),
    newHourlyRateCents: z.number(),
  }),
  projected: z.object({
    creditMinutes: z.number(),
    payCents: z.number(),
    additionalPayCents: z.number(),
    rateChangeDifference: z.number(),
  }),
  difference: z.object({
    creditMinutes: z.number(),
    payCents: z.number(),
  }),
});
export type WhatIfResponse = z.infer<typeof whatIfResponseSchema>;

// GET /api/projections/history
export const monthHistoryItemSchema = z.object({
  year: z.number(),
  month: z.number(),
  monthName: z.string(),
  creditMinutes: z.number(),
  payCents: z.number(),
  flights: z.number(),
});
export type MonthHistoryItem = z.infer<typeof monthHistoryItemSchema>;

export const getHistoryResponseSchema = z.object({
  history: z.array(monthHistoryItemSchema),
  averages: z.object({
    monthlyCents: z.number(),
    monthlyCreditMinutes: z.number(),
  }),
});
export type GetHistoryResponse = z.infer<typeof getHistoryResponseSchema>;

// ============================================
// SCHEDULE SNAPSHOTS - Trip Board import/comparison
// ============================================

// Change types for schedule comparison
export const scheduleChangeTypeValues = [
  "TRIP_ADDED",
  "TRIP_REMOVED",
  "TRIP_MODIFIED",
  "LEG_ADDED",
  "LEG_REMOVED",
  "LEG_MODIFIED",
  "TIME_CHANGE",
  "DH_CHANGE",
  "CREDIT_CHANGE",
] as const;
export type ScheduleChangeType = (typeof scheduleChangeTypeValues)[number];

// Severity levels for changes
export const changeSeverityValues = ["info", "warning", "pay_impact"] as const;
export type ChangeSeverity = (typeof changeSeverityValues)[number];

// Snapshot trip data (stored in JSON)
export const snapshotTripSchema = z.object({
  tripNumber: z.string().optional(),
  pairingId: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
  baseFleet: z.string().optional(),
  totalCreditMinutes: z.number(),
  legs: z.array(
    z.object({
      legIndex: z.number(),
      flightNumber: z.string().optional(),
      origin: z.string(),
      destination: z.string(),
      scheduledOutISO: z.string().optional(),
      scheduledInISO: z.string().optional(),
      creditMinutes: z.number(),
      isDeadhead: z.boolean(),
      equipment: z.string().optional(),
    })
  ),
});
export type SnapshotTrip = z.infer<typeof snapshotTripSchema>;

// Full snapshot schedule data
export const snapshotScheduleDataSchema = z.object({
  trips: z.array(snapshotTripSchema),
  dateRange: z.object({
    start: z.string(),
    end: z.string(),
  }),
});
export type SnapshotScheduleData = z.infer<typeof snapshotScheduleDataSchema>;

// Schedule Snapshot Schema
export const scheduleSnapshotSchema = z.object({
  id: z.string(),
  userId: z.string(),
  snapshotDate: z.string(),
  sourceType: z.string(),
  imageUrls: z.string(), // JSON array
  scheduleData: z.string(), // JSON SnapshotScheduleData
  startDate: z.string(),
  endDate: z.string(),
  confidence: z.number(),
  parseStatus: z.string(),
  tripCount: z.number(),
  legCount: z.number(),
  totalCreditMinutes: z.number(),
  lastComparedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ScheduleSnapshot = z.infer<typeof scheduleSnapshotSchema>;

// Schedule Change Schema
export const scheduleChangeSchema = z.object({
  id: z.string(),
  userId: z.string(),
  oldSnapshotId: z.string().nullable(),
  newSnapshotId: z.string(),
  changeType: z.enum(scheduleChangeTypeValues),
  severity: z.enum(changeSeverityValues),
  tripNumber: z.string().nullable(),
  tripDate: z.string().nullable(),
  legIndex: z.number().nullable(),
  fieldChanged: z.string().nullable(),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  creditDiffMinutes: z.number(),
  estimatedPayDiffCents: z.number(),
  suggestedEventType: z.string().nullable(),
  suggestedEventTitle: z.string().nullable(),
  payEventId: z.string().nullable(),
  acknowledged: z.boolean(),
  acknowledgedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ScheduleChange = z.infer<typeof scheduleChangeSchema>;

// Reminder Settings Schema
export const scheduleReminderSettingsSchema = z.object({
  id: z.string(),
  userId: z.string(),
  enabled: z.boolean(),
  frequencyHours: z.number(),
  reminderTimes: z.string().nullable(),
  beforeReport: z.boolean(),
  beforeReportHours: z.number(),
  lastImportAt: z.string().nullable(),
  lastReminderAt: z.string().nullable(),
  nextReminderAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ScheduleReminderSettings = z.infer<typeof scheduleReminderSettingsSchema>;

// POST /api/schedule/snapshot - Create new Trip Board snapshot
export const createSnapshotRequestSchema = z.object({
  images: z.array(z.string()), // Array of image URLs from upload
  sourceType: z.enum(["trip_board_browser", "trip_board_trip_details"]).optional(),
});
export type CreateSnapshotRequest = z.infer<typeof createSnapshotRequestSchema>;

export const createSnapshotResponseSchema = z.object({
  success: z.boolean(),
  snapshot: scheduleSnapshotSchema,
  changes: z.array(scheduleChangeSchema),
  previousSnapshot: scheduleSnapshotSchema.nullable(),
  summary: z.object({
    hasChanges: z.boolean(),
    totalChanges: z.number(),
    payImpactChanges: z.number(),
    estimatedPayDiffCents: z.number(),
    suggestedPayEvents: z.array(
      z.object({
        changeId: z.string(),
        eventType: z.string(),
        title: z.string(),
        description: z.string().optional(),
      })
    ),
  }),
});
export type CreateSnapshotResponse = z.infer<typeof createSnapshotResponseSchema>;

// GET /api/schedule/snapshots - List snapshots
export const getSnapshotsRequestSchema = z.object({
  limit: z.number().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
export type GetSnapshotsRequest = z.infer<typeof getSnapshotsRequestSchema>;

export const getSnapshotsResponseSchema = z.object({
  snapshots: z.array(scheduleSnapshotSchema),
  reminderSettings: scheduleReminderSettingsSchema.nullable(),
});
export type GetSnapshotsResponse = z.infer<typeof getSnapshotsResponseSchema>;

// GET /api/schedule/snapshots/:id - Get single snapshot with changes
export const getSnapshotResponseSchema = z.object({
  snapshot: scheduleSnapshotSchema,
  changes: z.array(scheduleChangeSchema),
  previousSnapshot: scheduleSnapshotSchema.nullable(),
});
export type GetSnapshotResponse = z.infer<typeof getSnapshotResponseSchema>;

// GET /api/schedule/changes - Get unacknowledged changes
export const getChangesRequestSchema = z.object({
  acknowledged: z.boolean().optional(),
  severity: z.enum(changeSeverityValues).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
export type GetChangesRequest = z.infer<typeof getChangesRequestSchema>;

export const getChangesResponseSchema = z.object({
  changes: z.array(scheduleChangeSchema),
  summary: z.object({
    totalChanges: z.number(),
    unacknowledged: z.number(),
    payImpactCount: z.number(),
    totalPayImpactCents: z.number(),
  }),
});
export type GetChangesResponse = z.infer<typeof getChangesResponseSchema>;

// POST /api/schedule/changes/:id/acknowledge - Acknowledge a change
export const acknowledgeChangeRequestSchema = z.object({
  createPayEvent: z.boolean().optional(),
  payEventData: createPayEventRequestSchema.optional(),
});
export type AcknowledgeChangeRequest = z.infer<typeof acknowledgeChangeRequestSchema>;

export const acknowledgeChangeResponseSchema = z.object({
  success: z.boolean(),
  change: scheduleChangeSchema,
  payEvent: payEventSchema.nullable(),
});
export type AcknowledgeChangeResponse = z.infer<typeof acknowledgeChangeResponseSchema>;

// PUT /api/schedule/reminder-settings - Update reminder settings
export const updateReminderSettingsRequestSchema = z.object({
  enabled: z.boolean().optional(),
  frequencyHours: z.number().optional(),
  reminderTimes: z.array(z.string()).optional(),
  beforeReport: z.boolean().optional(),
  beforeReportHours: z.number().optional(),
});
export type UpdateReminderSettingsRequest = z.infer<typeof updateReminderSettingsRequestSchema>;

export const updateReminderSettingsResponseSchema = z.object({
  success: z.boolean(),
  settings: scheduleReminderSettingsSchema,
});
export type UpdateReminderSettingsResponse = z.infer<typeof updateReminderSettingsResponseSchema>;

// GET /api/schedule/reminder-status - Get current reminder status
export const getReminderStatusResponseSchema = z.object({
  shouldRemind: z.boolean(),
  lastImportAt: z.string().nullable(),
  hoursSinceLastImport: z.number().nullable(),
  nextReportTime: z.string().nullable(),
  hoursUntilReport: z.number().nullable(),
  settings: scheduleReminderSettingsSchema.nullable(),
});
export type GetReminderStatusResponse = z.infer<typeof getReminderStatusResponseSchema>;

// ============================================
// CONTRACT DOCUMENTS - CBA / Pay Manual uploads
// Reference-only documents for AI context
// ============================================

// Document Types
export const contractDocumentTypeValues = [
  "CBA",
  "PAY_MANUAL",
  "LOA",
  "COMPANY_POLICY",
  "OTHER",
] as const;
export type ContractDocumentType = (typeof contractDocumentTypeValues)[number];

// Parse Status
export const contractParseStatusValues = ["pending", "processing", "success", "failed"] as const;
export type ContractParseStatus = (typeof contractParseStatusValues)[number];

// Contract Section Schema (for granular retrieval)
export const contractSectionSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  sectionNumber: z.string().nullable(), // e.g., "14.G.5.c.1"
  heading: z.string(),
  content: z.string(),
  pageNumber: z.number().nullable(),
  pageEndNumber: z.number().nullable(), // Phase 2: For sections spanning multiple pages
  topics: z.string().nullable(), // JSON array
  summary: z.string().nullable(),
  sortOrder: z.number(),
  // Phase 2: Reference index fields for deep-linking
  displayTitle: z.string().nullable(), // Human-readable title
  excerptText: z.string().nullable(), // Short, non-interpreted snippet
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ContractSection = z.infer<typeof contractSectionSchema>;

// Contract Document Schema
export const contractDocumentSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  documentType: z.enum(contractDocumentTypeValues),
  fileUrl: z.string(),
  fileName: z.string(),
  fileSize: z.number(),
  mimeType: z.string(),
  parseStatus: z.enum(contractParseStatusValues),
  rawText: z.string().nullable(),
  indexedSections: z.string().nullable(), // JSON
  parseError: z.string().nullable(),
  effectiveDate: z.string().nullable(),
  expirationDate: z.string().nullable(),
  airline: z.string().nullable(),
  summary: z.string().nullable(),
  // Phase 1: Version tracking
  versionLabel: z.string().nullable(), // e.g., "Contract 16"
  uploadSource: z.string().default("user"), // user, auto-import
  disclaimerAcceptedAt: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sections: z.array(contractSectionSchema).optional(),
});
export type ContractDocument = z.infer<typeof contractDocumentSchema>;

// Contract Reference Schema (tracking when AI references a section)
export const contractReferenceSchema = z.object({
  id: z.string(),
  userId: z.string(),
  triggerType: z.string(),
  triggerEntityId: z.string().nullable(),
  sectionId: z.string(),
  documentId: z.string(),
  relevanceScore: z.number(),
  snippet: z.string().nullable(),
  aiExplanation: z.string().nullable(),
  wasViewed: z.boolean(),
  viewedAt: z.string().nullable(),
  wasDismissed: z.boolean(),
  wasHelpful: z.boolean().nullable(),
  createdAt: z.string(),
  section: contractSectionSchema.optional(),
  document: contractDocumentSchema.optional(),
});
export type ContractReference = z.infer<typeof contractReferenceSchema>;

// GET /api/contracts - List user's contract documents
export const getContractsResponseSchema = z.object({
  documents: z.array(contractDocumentSchema),
  hasActiveDocuments: z.boolean(),
  totalCount: z.number(),
});
export type GetContractsResponse = z.infer<typeof getContractsResponseSchema>;

// GET /api/contracts/:id - Get single contract with sections
export const getContractResponseSchema = z.object({
  document: contractDocumentSchema,
});
export type GetContractResponse = z.infer<typeof getContractResponseSchema>;

// POST /api/contracts/upload - Upload a contract document
export const uploadContractRequestSchema = z.object({
  title: z.string(),
  documentType: z.enum(contractDocumentTypeValues),
  versionLabel: z.string().optional(), // Phase 1: e.g., "Contract 16"
  disclaimerAccepted: z.boolean(),
});
export type UploadContractRequest = z.infer<typeof uploadContractRequestSchema>;

export const uploadContractResponseSchema = z.object({
  success: z.boolean(),
  document: contractDocumentSchema,
  message: z.string(),
});
export type UploadContractResponse = z.infer<typeof uploadContractResponseSchema>;

// PUT /api/contracts/:id - Update contract metadata
export const updateContractRequestSchema = z.object({
  title: z.string().optional(),
  documentType: z.enum(contractDocumentTypeValues).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateContractRequest = z.infer<typeof updateContractRequestSchema>;

export const updateContractResponseSchema = z.object({
  success: z.boolean(),
  document: contractDocumentSchema,
});
export type UpdateContractResponse = z.infer<typeof updateContractResponseSchema>;

// DELETE /api/contracts/:id - Delete a contract document
export const deleteContractResponseSchema = z.object({
  success: z.boolean(),
});
export type DeleteContractResponse = z.infer<typeof deleteContractResponseSchema>;

// POST /api/contracts/:id/reparse - Trigger re-parsing of document
export const reparseContractResponseSchema = z.object({
  success: z.boolean(),
  document: contractDocumentSchema,
  message: z.string(),
});
export type ReparseContractResponse = z.infer<typeof reparseContractResponseSchema>;

// GET /api/contracts/references - Get AI references for context
export const getContractReferencesRequestSchema = z.object({
  triggerType: z.string().optional(),
  triggerEntityId: z.string().optional(),
  limit: z.number().optional(),
});
export type GetContractReferencesRequest = z.infer<typeof getContractReferencesRequestSchema>;

export const getContractReferencesResponseSchema = z.object({
  references: z.array(contractReferenceSchema),
});
export type GetContractReferencesResponse = z.infer<typeof getContractReferencesResponseSchema>;

// POST /api/contracts/search - Search contract sections
export const searchContractSectionsRequestSchema = z.object({
  query: z.string(),
  documentIds: z.array(z.string()).optional(),
  topics: z.array(z.string()).optional(),
  limit: z.number().optional(),
});
export type SearchContractSectionsRequest = z.infer<typeof searchContractSectionsRequestSchema>;

export const searchContractSectionsResponseSchema = z.object({
  sections: z.array(
    contractSectionSchema.extend({
      documentTitle: z.string(),
      relevanceScore: z.number(),
      highlightedContent: z.string().optional(),
    })
  ),
});
export type SearchContractSectionsResponse = z.infer<typeof searchContractSectionsResponseSchema>;

// POST /api/contracts/find-relevant - AI finds relevant sections for an event
export const findRelevantSectionsRequestSchema = z.object({
  triggerType: z.enum(["SCHEDULE_CHANGE", "PAY_EVENT", "PAY_REVIEW", "USER_QUERY"]),
  triggerEntityId: z.string().optional(),
  context: z.string(), // Description of the event/situation
  saveReference: z.boolean().optional(), // Whether to save the reference for history
});
export type FindRelevantSectionsRequest = z.infer<typeof findRelevantSectionsRequestSchema>;

export const findRelevantSectionsResponseSchema = z.object({
  hasRelevantSections: z.boolean(),
  sections: z.array(
    z.object({
      sectionId: z.string(),
      documentId: z.string(),
      documentTitle: z.string(),
      sectionHeading: z.string(),
      sectionNumber: z.string().nullable(),
      snippet: z.string(),
      relevanceScore: z.number(),
      aiExplanation: z.string(),
    })
  ),
  disclaimer: z.string(),
});
export type FindRelevantSectionsResponse = z.infer<typeof findRelevantSectionsResponseSchema>;

// POST /api/contracts/references/:id/feedback - User feedback on reference
export const referenceFeedbackRequestSchema = z.object({
  wasHelpful: z.boolean(),
});
export type ReferenceFeedbackRequest = z.infer<typeof referenceFeedbackRequestSchema>;

export const referenceFeedbackResponseSchema = z.object({
  success: z.boolean(),
});
export type ReferenceFeedbackResponse = z.infer<typeof referenceFeedbackResponseSchema>;

// ============================================
// PAY STATEMENT MIRROR - Upload, parse, project, reconcile
// ============================================

// Statement source types
export const payStatementSourceValues = ["pdf", "image"] as const;
export type PayStatementSource = (typeof payStatementSourceValues)[number];

// Statement section types
export const statementSectionValues = [
  "EARNINGS",
  "PREMIUMS",
  "GUARANTEES_OFFSETS",
  "REIMBURSEMENTS",
  "DEDUCTIONS",
  "TOTALS",
  "OTHER",
] as const;
export type StatementSection = (typeof statementSectionValues)[number];

// Reconcile status
export const reconcileStatusValues = [
  "matched",
  "missing_in_app",
  "unmatched_needs_review",
] as const;
export type ReconcileStatus = (typeof reconcileStatusValues)[number];

// Diff reason
export const diffReasonValues = [
  "trip_added",
  "trip_removed",
  "credit_changed",
  "premium_logged",
  "rule_changed",
  "statement_uploaded",
  "other",
] as const;
export type DiffReason = (typeof diffReasonValues)[number];

// Mapping status
export const mappingStatusValues = ["none", "suggested", "confirmed"] as const;
export type MappingStatus = (typeof mappingStatusValues)[number];

// Confidence level
export const confidenceLevelValues = ["high", "medium", "low"] as const;
export type ConfidenceLevel = (typeof confidenceLevelValues)[number];

// Statement line item
export const statementLineItemSchema = z.object({
  id: z.string().optional(),
  section: z.enum(statementSectionValues),
  label: z.string(),
  unitsLabel: z.string().optional(),
  units: z.number().optional(),
  rate: z.number().optional(),
  amount: z.number(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type StatementLineItem = z.infer<typeof statementLineItemSchema>;

// Parsed statement section
export const parsedStatementSectionSchema = z.object({
  section: z.enum(statementSectionValues),
  headerText: z.string().optional(),
  lineItems: z.array(statementLineItemSchema),
});
export type ParsedStatementSection = z.infer<typeof parsedStatementSectionSchema>;

// Pay statement parsed result
export const payStatementParsedSchema = z.object({
  payPeriod: z
    .object({
      start: z.string().optional(),
      end: z.string().optional(),
      payDate: z.string().optional(),
    })
    .optional(),
  sections: z.array(parsedStatementSectionSchema),
  totals: z
    .object({
      gross: z.number().optional(),
      net: z.number().optional(),
      deductionsTotal: z.number().optional(),
    })
    .optional(),
  parseConfidence: z.enum(confidenceLevelValues),
  rawText: z.string().optional(),
  providerMeta: z.record(z.string(), z.unknown()).optional(),
});
export type PayStatementParsed = z.infer<typeof payStatementParsedSchema>;

// Statement template
export const statementTemplateSchema = z.object({
  id: z.string(),
  userId: z.string(),
  airlineId: z.string().nullable(),
  version: z.string(),
  sectionOrder: z.array(z.enum(statementSectionValues)),
  sectionHeaders: z.record(z.string(), z.string()),
  lineItemOrderingHints: z.record(z.string(), z.number()).optional(),
  normalizationRules: z
    .object({
      labelAliases: z.record(z.string(), z.string()),
    })
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StatementTemplate = z.infer<typeof statementTemplateSchema>;

// Projected statement section
export const projectedStatementSectionSchema = z.object({
  section: z.enum(statementSectionValues),
  headerText: z.string(),
  lineItems: z.array(statementLineItemSchema),
});
export type ProjectedStatementSection = z.infer<typeof projectedStatementSectionSchema>;

// Projected statement
export const projectedStatementSchema = z.object({
  id: z.string(),
  userId: z.string(),
  payPeriod: z.object({
    id: z.string(),
    start: z.string(),
    end: z.string(),
    payDate: z.string().optional(),
  }),
  templateId: z.string(),
  generatedAt: z.string(),
  sections: z.array(projectedStatementSectionSchema),
  totals: z.object({
    gross: z.number(),
    deductionsTotal: z.number().optional(),
    net: z.number().optional(),
  }),
  confidence: z.enum(confidenceLevelValues),
});
export type ProjectedStatement = z.infer<typeof projectedStatementSchema>;

// Statement diff change
export const statementDiffChangeSchema = z.object({
  section: z.enum(statementSectionValues),
  label: z.string(),
  before: z
    .object({
      units: z.number().optional(),
      rate: z.number().optional(),
      amount: z.number(),
    })
    .optional(),
  after: z
    .object({
      units: z.number().optional(),
      rate: z.number().optional(),
      amount: z.number(),
    })
    .optional(),
  deltaAmount: z.number(),
  why: z.string(),
  driver: z
    .object({
      type: z.string(),
      id: z.string().optional(),
    })
    .optional(),
});
export type StatementDiffChange = z.infer<typeof statementDiffChangeSchema>;

// Statement diff
export const statementDiffSchema = z.object({
  id: z.string(),
  userId: z.string(),
  payPeriod: z.object({
    id: z.string(),
    start: z.string(),
    end: z.string(),
    payDate: z.string().optional(),
  }),
  comparedAt: z.string(),
  reason: z.enum(diffReasonValues),
  summaryLine: z.string(),
  changes: z.array(statementDiffChangeSchema),
});
export type StatementDiff = z.infer<typeof statementDiffSchema>;

// Reconciliation item
export const reconciliationItemSchema = z.object({
  actual: statementLineItemSchema,
  projected: statementLineItemSchema.optional(),
  status: z.enum(reconcileStatusValues),
  note: z.string(),
  suggestion: z.string().optional(),
});
export type ReconciliationItem = z.infer<typeof reconciliationItemSchema>;

// Reconciliation result
export const reconciliationResultSchema = z.object({
  id: z.string(),
  userId: z.string(),
  payPeriod: z.object({
    id: z.string(),
    start: z.string(),
    end: z.string(),
    payDate: z.string().optional(),
  }),
  comparedAt: z.string(),
  items: z.array(reconciliationItemSchema),
  summary: z.object({
    matchedCount: z.number(),
    missingInAppCount: z.number(),
    unmatchedCount: z.number(),
  }),
});
export type ReconciliationResult = z.infer<typeof reconciliationResultSchema>;

// Pay audit check
export const payAuditCheckSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["pass", "warn", "fail"]),
  detail: z.string(),
  action: z
    .object({
      label: z.string(),
      deepLink: z.string().optional(),
    })
    .optional(),
});
export type PayAuditCheck = z.infer<typeof payAuditCheckSchema>;

// Pay audit checklist
export const payAuditChecklistSchema = z.object({
  id: z.string(),
  userId: z.string(),
  payPeriod: z.object({
    id: z.string(),
    start: z.string(),
    end: z.string(),
    payDate: z.string().optional(),
  }),
  generatedAt: z.string(),
  payHealthScore: z.number(),
  checks: z.array(payAuditCheckSchema),
});
export type PayAuditChecklist = z.infer<typeof payAuditChecklistSchema>;

// Pay statement upload record
export const payStatementUploadSchema = z.object({
  id: z.string(),
  userId: z.string(),
  source: z.enum(payStatementSourceValues),
  fileUrl: z.string(),
  mimeType: z.string(),
  status: z.enum(["queued", "processing", "parsed", "failed"]),
  error: z.string().nullable(),
  parsed: payStatementParsedSchema.nullable().optional(),
  extractedPeriod: z
    .object({
      start: z.string().optional(),
      end: z.string().optional(),
      payDate: z.string().optional(),
    })
    .nullable()
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PayStatementUpload = z.infer<typeof payStatementUploadSchema>;

// POST /api/pay-statements/upload - Upload a pay statement
export const uploadPayStatementRequestSchema = z.object({
  source: z.enum(payStatementSourceValues),
  payPeriodStart: z.string().optional(),
  payPeriodEnd: z.string().optional(),
});
export type UploadPayStatementRequest = z.infer<typeof uploadPayStatementRequestSchema>;

export const uploadPayStatementResponseSchema = z.object({
  success: z.boolean(),
  uploadId: z.string(),
});
export type UploadPayStatementResponse = z.infer<typeof uploadPayStatementResponseSchema>;

// POST /api/pay-statements/:uploadId/parse - Parse uploaded statement
export const parsePayStatementResponseSchema = z.object({
  success: z.boolean(),
  parsed: payStatementParsedSchema,
  templateId: z.string(),
});
export type ParsePayStatementResponse = z.infer<typeof parsePayStatementResponseSchema>;

// GET /api/pay-periods/:payPeriodId/actual-statement - Get actual statement
export const getActualStatementResponseSchema = z.object({
  parsed: payStatementParsedSchema.nullable(),
});
export type GetActualStatementResponse = z.infer<typeof getActualStatementResponseSchema>;

// GET /api/pay-periods/:payPeriodId/projected-statement - Get projected statement
export const getProjectedStatementResponseSchema = z.object({
  projected: projectedStatementSchema,
});
export type GetProjectedStatementResponse = z.infer<typeof getProjectedStatementResponseSchema>;

// POST /api/pay-periods/:payPeriodId/projected-statement/recalculate - Recalculate projected
export const recalculateProjectedRequestSchema = z.object({
  reason: z.enum(diffReasonValues),
});
export type RecalculateProjectedRequest = z.infer<typeof recalculateProjectedRequestSchema>;

export const recalculateProjectedResponseSchema = z.object({
  projected: projectedStatementSchema,
  diff: statementDiffSchema,
});
export type RecalculateProjectedResponse = z.infer<typeof recalculateProjectedResponseSchema>;

// POST /api/pay-periods/:payPeriodId/reconciliation/run - Run reconciliation
export const runReconciliationResponseSchema = z.object({
  reconciliation: reconciliationResultSchema,
});
export type RunReconciliationResponse = z.infer<typeof runReconciliationResponseSchema>;

// POST /api/pay-periods/:payPeriodId/audit/run - Run audit
export const runAuditResponseSchema = z.object({
  audit: payAuditChecklistSchema,
});
export type RunAuditResponse = z.infer<typeof runAuditResponseSchema>;

// POST /api/pay-periods/:payPeriodId/export - Export packet
export const exportPacketRequestSchema = z.object({
  include: z.object({
    projectedStatement: z.boolean(),
    whatChanged: z.boolean(),
    reconciliation: z.boolean(),
    auditChecklist: z.boolean(),
    attachments: z.boolean(),
    contractExcerpts: z.boolean(),
  }),
});
export type ExportPacketRequest = z.infer<typeof exportPacketRequestSchema>;

export const exportPacketResponseSchema = z.object({
  packetId: z.string(),
  status: z.enum(["queued", "ready", "failed"]),
  downloadUrl: z.string().optional(),
  error: z.string().optional(),
});
export type ExportPacketResponse = z.infer<typeof exportPacketResponseSchema>;

// GET /api/exports/:packetId/status - Get export status
export const getExportStatusResponseSchema = exportPacketResponseSchema;
export type GetExportStatusResponse = z.infer<typeof getExportStatusResponseSchema>;

// ============================================
// AUDIT TRAIL - Chronological pay activity records
// ============================================

// Audit Trail Entry Types
export const auditTrailEntryTypeValues = [
  "TRIP_IMPORTED",
  "TRIP_CONFIRMED",
  "DETECTED_CHANGE",
  "PAY_EVENT",
  "STATEMENT_UPLOADED",
  "RULE_CHANGE",
  "AI_SUGGESTION",
  "EXPORT_GENERATED",
] as const;
export type AuditTrailEntryType = (typeof auditTrailEntryTypeValues)[number];

// Confidence level for audit entries
export const auditConfidenceLevelValues = ["high", "medium", "low"] as const;
export type AuditConfidenceLevel = (typeof auditConfidenceLevelValues)[number];

// Record status for audit trail items
export const auditRecordStatusValues = ["open", "resolved", "disputed"] as const;
export type AuditRecordStatus = (typeof auditRecordStatusValues)[number];

// Audit Trail Entry Schema
export const auditTrailEntrySchema = z.object({
  id: z.string(),
  entryType: z.enum(auditTrailEntryTypeValues),
  timestamp: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  // Record status: open, resolved, disputed
  status: z.enum(auditRecordStatusValues).nullable(),
  // Linked entities
  tripId: z.string().nullable(),
  tripIds: z.array(z.string()).optional(), // For grouped trip uploads
  payEventId: z.string().nullable(),
  payPeriodId: z.string().nullable(),
  scheduleChangeId: z.string().nullable(),
  rosterChangeIds: z.array(z.string()).optional(), // For grouped roster changes
  payRuleId: z.string().nullable(),
  exportPacketId: z.string().nullable(),
  // Entry-specific data
  creditMinutes: z.number().nullable(),
  payImpactCents: z.number().nullable(),
  confidence: z.enum(auditConfidenceLevelValues).nullable(),
  // For detected changes
  needsReview: z.boolean(),
  // For AI suggestions
  suggestionStatus: z.enum(["pending", "accepted", "dismissed"]).nullable(),
  // Attachments/proof
  attachmentCount: z.number(),
  // Route summary for trips
  routeSummary: z.string().nullable(),
  // Date range for trips
  dateRangeStart: z.string().nullable(),
  dateRangeEnd: z.string().nullable(),
  // User notes
  notes: z.string().nullable(),
  // Explanation for rule/change impact
  explanation: z.string().nullable(),
  // Trip count for grouped uploads
  tripCount: z.number().optional(),
});
export type AuditTrailEntry = z.infer<typeof auditTrailEntrySchema>;

// GET /api/audit-trail - Get audit trail entries
export const getAuditTrailRequestSchema = z.object({
  payPeriodId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  entryTypes: z.array(z.enum(auditTrailEntryTypeValues)).optional(),
  search: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});
export type GetAuditTrailRequest = z.infer<typeof getAuditTrailRequestSchema>;

export const getAuditTrailResponseSchema = z.object({
  entries: z.array(auditTrailEntrySchema),
  totalCount: z.number(),
  hasMore: z.boolean(),
});
export type GetAuditTrailResponse = z.infer<typeof getAuditTrailResponseSchema>;

// ============================================
// PAY CODE LIBRARY - Reference-only pay codes
// ============================================

// Pay Code Categories
export const payCodeCategoryValues = [
  "PREMIUM",
  "GUARANTEE",
  "PROTECTION",
  "REASSIGNMENT",
  "RESERVE",
  "TRAINING",
  "DEADHEAD",
  "LIMITS",
  "PER_DIEM",
  "OTHER",
] as const;
export type PayCodeCategory = (typeof payCodeCategoryValues)[number];

// Pay Code Confidence (for contract references)
export const payCodeConfidenceValues = ["high", "medium", "low"] as const;
export type PayCodeConfidence = (typeof payCodeConfidenceValues)[number];

// Pay Code Reference (linked from user's uploaded contract)
export const payCodeReferenceSchema = z.object({
  id: z.string(),
  payCodeId: z.string(),
  documentId: z.string(),
  documentTitle: z.string(),
  sectionHeading: z.string().nullable(),
  sectionRef: z.string().nullable(), // e.g., "Article 12.3"
  pageNumber: z.number().nullable(),
  excerpt: z.string().nullable(), // Short 2-3 line excerpt
  confidence: z.enum(payCodeConfidenceValues),
  createdAt: z.string(),
});
export type PayCodeReference = z.infer<typeof payCodeReferenceSchema>;

// User Pay Code Schema
export const userPayCodeSchema = z.object({
  id: z.string(),
  userId: z.string(),
  airlineId: z.string(),
  codeKey: z.string(), // Normalized key (e.g., "MIN_DAILY_CREDIT")
  displayName: z.string(), // What user sees
  shortCode: z.string().nullable(), // e.g., "MDC", "JA"
  category: z.enum(payCodeCategoryValues),
  summary: z.string().nullable(), // Neutral AI or seeded summary
  description: z.string().nullable(), // Longer description
  isFromTerminologyPack: z.boolean(), // From airline seed data
  hasContractReferences: z.boolean(), // Has user contract links
  userNotes: z.string().nullable(), // User's personal notes
  createdAt: z.string(),
  updatedAt: z.string(),
  // Included when fetching detail
  references: z.array(payCodeReferenceSchema).optional(),
});
export type UserPayCode = z.infer<typeof userPayCodeSchema>;

// What to Document Checklist Item
export const documentChecklistItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  isRequired: z.boolean(),
  completed: z.boolean().optional(),
});
export type DocumentChecklistItem = z.infer<typeof documentChecklistItemSchema>;

// GET /api/pay-codes - List pay codes for user's airline
export const getPayCodesRequestSchema = z.object({
  airlineId: z.string().optional(),
  category: z.enum(payCodeCategoryValues).optional(),
  search: z.string().optional(),
  hasReferences: z.boolean().optional(),
});
export type GetPayCodesRequest = z.infer<typeof getPayCodesRequestSchema>;

export const getPayCodesResponseSchema = z.object({
  codes: z.array(userPayCodeSchema),
  totalCount: z.number(),
});
export type GetPayCodesResponse = z.infer<typeof getPayCodesResponseSchema>;

// GET /api/pay-codes/:id - Get single pay code with references
export const getPayCodeResponseSchema = z.object({
  code: userPayCodeSchema,
  checklist: z.array(documentChecklistItemSchema), // What to document
  relatedCodes: z.array(userPayCodeSchema), // Related codes
});
export type GetPayCodeResponse = z.infer<typeof getPayCodeResponseSchema>;

// PUT /api/pay-codes/:id - Update user notes on a pay code
export const updatePayCodeRequestSchema = z.object({
  userNotes: z.string().optional(),
});
export type UpdatePayCodeRequest = z.infer<typeof updatePayCodeRequestSchema>;

export const updatePayCodeResponseSchema = z.object({
  success: z.boolean(),
  code: userPayCodeSchema,
});
export type UpdatePayCodeResponse = z.infer<typeof updatePayCodeResponseSchema>;

// POST /api/pay-codes/search-contracts - Search contract for a code
export const searchContractsForCodeRequestSchema = z.object({
  codeKey: z.string(),
  query: z.string().optional(),
});
export type SearchContractsForCodeRequest = z.infer<typeof searchContractsForCodeRequestSchema>;

export const searchContractsForCodeResponseSchema = z.object({
  references: z.array(payCodeReferenceSchema),
  totalFound: z.number(),
});
export type SearchContractsForCodeResponse = z.infer<typeof searchContractsForCodeResponseSchema>;

// ============================================
// CONTRACT SEARCH - Advanced full-text search
// ============================================

// Search match type
export const searchMatchTypeValues = ["exact", "fuzzy"] as const;
export type SearchMatchType = (typeof searchMatchTypeValues)[number];

// Search confidence levels
export const searchConfidenceValues = ["high", "medium", "low"] as const;
export type SearchConfidence = (typeof searchConfidenceValues)[number];

// Search category filters
export const searchCategoryValues = [
  "pay",
  "scheduling",
  "reserve",
  "training",
  "deadhead",
  "other",
] as const;
export type SearchCategory = (typeof searchCategoryValues)[number];

// Search result item
export const contractSearchResultSchema = z.object({
  id: z.string(),
  sectionId: z.string(),
  documentId: z.string(),
  documentTitle: z.string(),
  documentType: z.enum(contractDocumentTypeValues),
  heading: z.string(),
  sectionNumber: z.string().nullable(),
  pageNumber: z.number().nullable(),
  excerpt: z.string(),
  highlightedExcerpt: z.string().optional(),
  confidence: z.enum(searchConfidenceValues),
  relevanceScore: z.number(),
  matchedTerms: z.array(z.string()),
});
export type ContractSearchResult = z.infer<typeof contractSearchResultSchema>;

// POST /api/contracts/advanced-search - Advanced contract search
export const advancedContractSearchRequestSchema = z.object({
  query: z.string(),
  documentIds: z.array(z.string()).optional(),
  documentTypes: z.array(z.enum(contractDocumentTypeValues)).optional(),
  categories: z.array(z.enum(searchCategoryValues)).optional(),
  matchType: z.enum(searchMatchTypeValues).optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});
export type AdvancedContractSearchRequest = z.infer<typeof advancedContractSearchRequestSchema>;

export const advancedContractSearchResponseSchema = z.object({
  results: z.array(contractSearchResultSchema),
  totalCount: z.number(),
  query: z.string(),
  suggestedKeywords: z.array(z.string()).optional(),
  disclaimer: z.string(),
});
export type AdvancedContractSearchResponse = z.infer<typeof advancedContractSearchResponseSchema>;

// POST /api/contracts/ai-suggest-keywords - AI keyword suggestions
export const aiSuggestKeywordsRequestSchema = z.object({
  query: z.string(),
  context: z.string().optional(),
});
export type AiSuggestKeywordsRequest = z.infer<typeof aiSuggestKeywordsRequestSchema>;

export const aiSuggestKeywordsResponseSchema = z.object({
  suggestedKeywords: z.array(z.string()),
  suggestedFilters: z.object({
    documentTypes: z.array(z.enum(contractDocumentTypeValues)).optional(),
    categories: z.array(z.enum(searchCategoryValues)).optional(),
  }).optional(),
  explanation: z.string().optional(),
});
export type AiSuggestKeywordsResponse = z.infer<typeof aiSuggestKeywordsResponseSchema>;

// Saved reference schema
export const savedContractReferenceSchema = z.object({
  id: z.string(),
  userId: z.string(),
  sectionId: z.string(),
  documentId: z.string(),
  documentTitle: z.string(),
  sectionHeading: z.string(),
  sectionNumber: z.string().nullable(),
  pageNumber: z.number().nullable(),
  excerpt: z.string(),
  category: z.enum(searchCategoryValues).nullable(),
  userNotes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SavedContractReference = z.infer<typeof savedContractReferenceSchema>;

// GET /api/contracts/saved-references - List saved references
export const getSavedReferencesResponseSchema = z.object({
  references: z.array(savedContractReferenceSchema),
  totalCount: z.number(),
});
export type GetSavedReferencesResponse = z.infer<typeof getSavedReferencesResponseSchema>;

// POST /api/contracts/saved-references - Save a reference
export const saveContractReferenceRequestSchema = z.object({
  sectionId: z.string(),
  documentId: z.string(),
  documentTitle: z.string(),
  sectionHeading: z.string(),
  sectionNumber: z.string().nullable().optional(),
  pageNumber: z.number().nullable().optional(),
  excerpt: z.string(),
  category: z.enum(searchCategoryValues).nullable().optional(),
  userNotes: z.string().nullable().optional(),
});
export type SaveContractReferenceRequest = z.infer<typeof saveContractReferenceRequestSchema>;

export const saveContractReferenceResponseSchema = z.object({
  success: z.boolean(),
  reference: savedContractReferenceSchema,
});
export type SaveContractReferenceResponse = z.infer<typeof saveContractReferenceResponseSchema>;

// DELETE /api/contracts/saved-references/:id - Delete a saved reference
export const deleteSavedReferenceResponseSchema = z.object({
  success: z.boolean(),
});
export type DeleteSavedReferenceResponse = z.infer<typeof deleteSavedReferenceResponseSchema>;

// ============================================
// PHASE 3: CONTEXTUAL REFERENCE TRIGGERS
// Pattern types that can trigger contract reference display
// ============================================

// Trigger pattern types (non-advisory, reference-only)
export const contractTriggerPatternValues = [
  "RESERVE_EXTENSION", // Reserve availability extension beyond original
  "SCHEDULE_CHANGE", // Any schedule modification event
  "DUTY_EXTENSION", // Duty extended beyond original plan
  "CREDIT_PROTECTED_RESERVE", // Credit-protected reserve schedules
  "JUNIOR_ASSIGNMENT", // JA'd into a trip
  "REASSIGNMENT", // Trip reassignment
  "DEADHEAD", // Deadhead segment
  "TRAINING", // Training assignment
] as const;
export type ContractTriggerPattern = (typeof contractTriggerPatternValues)[number];

// Contract Reference Trigger Schema (maps patterns to contract sections)
export const contractReferenceTriggerSchema = z.object({
  id: z.string(),
  userId: z.string(),
  triggerPattern: z.enum(contractTriggerPatternValues),
  documentId: z.string(),
  sectionId: z.string(),
  sectionNumber: z.string().nullable(), // e.g., "14.G.5.c.1"
  displayTitle: z.string().nullable(), // Human-readable: "Reserve Availability Extension"
  conditions: z.string().nullable(), // JSON: conditions for trigger
  isActive: z.boolean(),
  isUserCreated: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ContractReferenceTrigger = z.infer<typeof contractReferenceTriggerSchema>;

// ============================================
// PHASE 4: REFERENCE VIEW AUDIT LOG
// Tracks when users view contract references (informational only)
// ============================================

// View source types
export const contractViewSourceValues = [
  "manual", // User manually opened
  "contextual_trigger", // Triggered by schedule pattern
  "search", // From search results
  "deep_link", // From deep link in app
] as const;
export type ContractViewSource = (typeof contractViewSourceValues)[number];

// Related entity types for context
export const contractRelatedEntityTypeValues = [
  "reserve_schedule",
  "trip",
  "schedule_change",
  "pay_event",
  "roster_change",
] as const;
export type ContractRelatedEntityType = (typeof contractRelatedEntityTypeValues)[number];

// Contract Reference View Log Schema
export const contractReferenceViewLogSchema = z.object({
  id: z.string(),
  userId: z.string(),
  documentId: z.string(),
  sectionId: z.string().nullable(),
  viewSource: z.enum(contractViewSourceValues),
  relatedEntityType: z.enum(contractRelatedEntityTypeValues).nullable(),
  relatedEntityId: z.string().nullable(),
  referenceCode: z.string().nullable(), // e.g., "14.G.5.c.1"
  pageNumber: z.number().nullable(),
  viewedAt: z.string(),
});
export type ContractReferenceViewLog = z.infer<typeof contractReferenceViewLogSchema>;

// GET /api/contracts/view-history - Get reference view history
export const getContractViewHistoryRequestSchema = z.object({
  limit: z.number().optional(),
  offset: z.number().optional(),
});
export type GetContractViewHistoryRequest = z.infer<typeof getContractViewHistoryRequestSchema>;

export const getContractViewHistoryResponseSchema = z.object({
  views: z.array(contractReferenceViewLogSchema),
  totalCount: z.number(),
});
export type GetContractViewHistoryResponse = z.infer<typeof getContractViewHistoryResponseSchema>;

// POST /api/contracts/log-view - Log a reference view
export const logContractViewRequestSchema = z.object({
  documentId: z.string(),
  sectionId: z.string().optional(),
  viewSource: z.enum(contractViewSourceValues),
  relatedEntityType: z.enum(contractRelatedEntityTypeValues).optional(),
  relatedEntityId: z.string().optional(),
  referenceCode: z.string().optional(),
  pageNumber: z.number().optional(),
});
export type LogContractViewRequest = z.infer<typeof logContractViewRequestSchema>;

export const logContractViewResponseSchema = z.object({
  success: z.boolean(),
  viewLog: contractReferenceViewLogSchema,
});
export type LogContractViewResponse = z.infer<typeof logContractViewResponseSchema>;

// ============================================
// PHASE 5: PATTERN AWARENESS (Safe language only)
// Detected patterns for informational display
// ============================================

// Pattern Detection Schema
export const contractPatternDetectionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  patternType: z.enum(contractTriggerPatternValues),
  patternDescription: z.string(), // Safe, non-advisory description
  occurrenceCount: z.number(),
  firstOccurrence: z.string(),
  lastOccurrence: z.string(),
  rollingWindowMonths: z.number(),
  relatedEntityIds: z.string().nullable(), // JSON array
  isAcknowledged: z.boolean(),
  acknowledgedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ContractPatternDetection = z.infer<typeof contractPatternDetectionSchema>;

// GET /api/contracts/patterns - Get detected patterns
export const getContractPatternsResponseSchema = z.object({
  patterns: z.array(contractPatternDetectionSchema),
  totalCount: z.number(),
});
export type GetContractPatternsResponse = z.infer<typeof getContractPatternsResponseSchema>;

// POST /api/contracts/patterns/:id/acknowledge - Acknowledge a pattern
export const acknowledgePatternResponseSchema = z.object({
  success: z.boolean(),
  pattern: contractPatternDetectionSchema,
});
export type AcknowledgePatternResponse = z.infer<typeof acknowledgePatternResponseSchema>;

// ============================================
// PHASE 2: CONTRACT VIEWER DEEP LINKING
// APIs for PDF viewer with page navigation
// ============================================

// GET /api/contracts/:id/section/:sectionId - Get section for deep-link
export const getContractSectionResponseSchema = z.object({
  section: contractSectionSchema,
  document: contractDocumentSchema,
  // Navigation context
  prevSection: z.object({
    id: z.string(),
    heading: z.string(),
    sectionNumber: z.string().nullable(),
  }).nullable(),
  nextSection: z.object({
    id: z.string(),
    heading: z.string(),
    sectionNumber: z.string().nullable(),
  }).nullable(),
});
export type GetContractSectionResponse = z.infer<typeof getContractSectionResponseSchema>;

// GET /api/contracts/:id/page/:pageNumber - Get page content
export const getContractPageResponseSchema = z.object({
  pageNumber: z.number(),
  totalPages: z.number(),
  content: z.string().nullable(),
  sections: z.array(z.object({
    id: z.string(),
    sectionNumber: z.string().nullable(),
    heading: z.string(),
    startOffset: z.number().optional(), // Character offset for highlighting
    endOffset: z.number().optional(),
  })),
});
export type GetContractPageResponse = z.infer<typeof getContractPageResponseSchema>;

// ============================================
// PHASE 3: CONTEXTUAL TRIGGER CONFIGURATION
// APIs for managing contract reference triggers
// ============================================

// GET /api/contracts/triggers - List reference triggers
export const getContractTriggersResponseSchema = z.object({
  triggers: z.array(contractReferenceTriggerSchema),
  totalCount: z.number(),
});
export type GetContractTriggersResponse = z.infer<typeof getContractTriggersResponseSchema>;

// POST /api/contracts/triggers - Create a reference trigger
export const createContractTriggerRequestSchema = z.object({
  triggerPattern: z.enum(contractTriggerPatternValues),
  documentId: z.string(),
  sectionId: z.string(),
  sectionNumber: z.string().optional(),
  displayTitle: z.string().optional(),
  conditions: z.string().optional(),
});
export type CreateContractTriggerRequest = z.infer<typeof createContractTriggerRequestSchema>;

export const createContractTriggerResponseSchema = z.object({
  success: z.boolean(),
  trigger: contractReferenceTriggerSchema,
});
export type CreateContractTriggerResponse = z.infer<typeof createContractTriggerResponseSchema>;

// DELETE /api/contracts/triggers/:id - Delete a reference trigger
export const deleteContractTriggerResponseSchema = z.object({
  success: z.boolean(),
});
export type DeleteContractTriggerResponse = z.infer<typeof deleteContractTriggerResponseSchema>;

// POST /api/contracts/check-triggers - Check for triggered references
export const checkContractTriggersRequestSchema = z.object({
  entityType: z.enum(contractRelatedEntityTypeValues),
  entityId: z.string(),
  context: z.object({
    // Schedule/trip context
    scheduleType: z.string().optional(), // RSVA, RSVB, etc.
    isExtension: z.boolean().optional(),
    isDutyExtension: z.boolean().optional(),
    isCreditProtected: z.boolean().optional(),
    isJuniorAssignment: z.boolean().optional(),
    isReassignment: z.boolean().optional(),
    isDeadhead: z.boolean().optional(),
  }).optional(),
});
export type CheckContractTriggersRequest = z.infer<typeof checkContractTriggersRequestSchema>;

export const checkContractTriggersResponseSchema = z.object({
  hasTriggeredReferences: z.boolean(),
  triggeredReferences: z.array(z.object({
    triggerId: z.string(),
    triggerPattern: z.enum(contractTriggerPatternValues),
    sectionId: z.string(),
    sectionNumber: z.string().nullable(),
    displayTitle: z.string().nullable(),
    documentId: z.string(),
    documentTitle: z.string(),
    pageNumber: z.number().nullable(),
    // Why this reference was triggered (non-advisory)
    triggerReason: z.string(), // e.g., "This section is linked because this schedule was recorded as a reserve extension."
  })),
});
export type CheckContractTriggersResponse = z.infer<typeof checkContractTriggersResponseSchema>;

// ============================================
// PHASE 7: LEGAL DISCLAIMER CONSTANTS
// ============================================

export const CONTRACT_DISCLAIMER_TEXT =
  "Pilot Pay Tracker is an independent personal record-keeping tool. " +
  "It is not affiliated with, endorsed by, or authorized by any airline, union, or employer. " +
  "Contract references are provided for informational purposes only. " +
  "No legal, contractual, or professional advice is given.";

export const CONTRACT_VIEWER_WATERMARK =
  "Reference Copy — User Provided — Not Official or Controlling";

export const CONTRACT_REFERENCE_INFO_TEXT =
  "Why you're seeing this reference: This section is linked because of how this schedule was recorded.";

// ============================================
// CALENDAR SYNC - Universal calendar import
// Pull schedule from external calendars
// ============================================

// Calendar provider types
export const calendarProviderValues = [
  "apple",
  "google",
  "outlook",
  "ics_feed",
] as const;
export type CalendarProvider = (typeof calendarProviderValues)[number];

// Calendar connection status
export const calendarConnectionStatusValues = [
  "pending",
  "connected",
  "disconnected",
  "error",
] as const;
export type CalendarConnectionStatus = (typeof calendarConnectionStatusValues)[number];

// Calendar sync status
export const calendarSyncStatusValues = [
  "idle",
  "syncing",
  "success",
  "error",
] as const;
export type CalendarSyncStatus = (typeof calendarSyncStatusValues)[number];

// Detected schedule change from calendar sync (for the old vs new popup)
export const detectedScheduleChangeSchema = z.object({
  id: z.string(),
  tripNumber: z.string().nullable(),
  tripDate: z.string(), // YYYY-MM-DD
  changeType: z.enum(scheduleChangeTypeValues),
  // Previous values
  previousStartISO: z.string().nullable(),
  previousEndISO: z.string().nullable(),
  previousOrigin: z.string().nullable(),
  previousDestination: z.string().nullable(),
  previousCreditMinutes: z.number().nullable(),
  previousRoute: z.string().nullable(), // e.g., "SDF-LAX-SDF"
  // New values
  newStartISO: z.string().nullable(),
  newEndISO: z.string().nullable(),
  newOrigin: z.string().nullable(),
  newDestination: z.string().nullable(),
  newCreditMinutes: z.number().nullable(),
  newRoute: z.string().nullable(),
  // Change summary
  fieldsChanged: z.array(z.string()), // ["start_time", "credit", "route"]
  creditDiffMinutes: z.number(),
  estimatedPayDiffCents: z.number(),
  // Classification
  classificationReason: z.string().nullable(), // User-selected reason
});
export type DetectedScheduleChange = z.infer<typeof detectedScheduleChangeSchema>;

// Change classification options
export const changeClassificationValues = [
  "company_initiated", // Company changed the schedule
  "pilot_trade", // Pilot traded trip
  "vacation", // Vacation drop
  "sick_call", // Called in sick
  "training", // Training assignment
  "reserve_activation", // Called from reserve
  "junior_assignment", // JA'd into trip
  "other",
] as const;
export type ChangeClassification = (typeof changeClassificationValues)[number];

// Calendar Connection Schema
export const calendarConnectionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  provider: z.enum(calendarProviderValues),
  displayName: z.string(), // "Work Calendar", "UPS Schedule", etc.
  connectionStatus: z.enum(calendarConnectionStatusValues),
  lastSyncAt: z.string().nullable(),
  nextSyncAt: z.string().nullable(),
  syncError: z.string().nullable(),
  // Provider-specific config (stored encrypted)
  icsUrl: z.string().nullable(), // For ICS feeds
  calendarId: z.string().nullable(), // For OAuth providers
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CalendarConnection = z.infer<typeof calendarConnectionSchema>;

// Calendar sync result
export const calendarSyncResultSchema = z.object({
  success: z.boolean(),
  syncedAt: z.string(),
  eventsProcessed: z.number(),
  changesDetected: z.array(detectedScheduleChangeSchema),
  summary: z.object({
    totalChanges: z.number(),
    tripsAdded: z.number(),
    tripsRemoved: z.number(),
    tripsModified: z.number(),
    tripsAutoApplied: z.number().optional(), // Auto-applied changes count
    payImpactChanges: z.number(),
    estimatedPayDiffCents: z.number(),
  }),
  error: z.string().nullable(),
});
export type CalendarSyncResult = z.infer<typeof calendarSyncResultSchema>;

// GET /api/calendar/connections - List calendar connections
export const getCalendarConnectionsResponseSchema = z.object({
  connections: z.array(calendarConnectionSchema),
  lastSyncAt: z.string().nullable(),
  pendingChanges: z.number(),
});
export type GetCalendarConnectionsResponse = z.infer<typeof getCalendarConnectionsResponseSchema>;

// POST /api/calendar/connections - Add a new calendar connection
export const createCalendarConnectionRequestSchema = z.object({
  provider: z.enum(calendarProviderValues),
  displayName: z.string().optional(),
  icsUrl: z.string().optional(), // For ICS feeds
  deviceCalendarId: z.string().optional(), // For device calendars - the native calendar ID from expo-calendar
});
export type CreateCalendarConnectionRequest = z.infer<typeof createCalendarConnectionRequestSchema>;

export const createCalendarConnectionResponseSchema = z.object({
  success: z.boolean(),
  connection: calendarConnectionSchema.optional(),
  authUrl: z.string().optional(), // For OAuth - redirect user here
  message: z.string(),
});
export type CreateCalendarConnectionResponse = z.infer<typeof createCalendarConnectionResponseSchema>;

// DELETE /api/calendar/connections/:id - Remove calendar connection
export const deleteCalendarConnectionResponseSchema = z.object({
  success: z.boolean(),
});
export type DeleteCalendarConnectionResponse = z.infer<typeof deleteCalendarConnectionResponseSchema>;

// POST /api/calendar/sync - Trigger calendar sync
export const deviceCalendarEventSchema = z.object({
  id: z.string(),
  calendarId: z.string(),
  title: z.string(),
  startDate: z.string(), // ISO string
  endDate: z.string(), // ISO string
  location: z.string().optional(),
  notes: z.string().optional(),
  allDay: z.boolean(),
});
export type DeviceCalendarEvent = z.infer<typeof deviceCalendarEventSchema>;

export const triggerCalendarSyncRequestSchema = z.object({
  connectionId: z.string().optional(), // Sync specific connection, or all if omitted
  syncRange: z.object({
    pastDays: z.number().default(30), // Default past 30 days
    futureDays: z.number().default(90), // Default future 90 days
  }).optional(),
  // Events from device calendars (passed from expo-calendar on the frontend)
  deviceCalendarEvents: z.array(deviceCalendarEventSchema).optional(),
});
export type TriggerCalendarSyncRequest = z.infer<typeof triggerCalendarSyncRequestSchema>;

export const triggerCalendarSyncResponseSchema = z.object({
  success: z.boolean(),
  result: calendarSyncResultSchema.optional(),
  error: z.string().optional(),
});
export type TriggerCalendarSyncResponse = z.infer<typeof triggerCalendarSyncResponseSchema>;

// GET /api/calendar/pending-changes - Get unreviewed changes from last sync
export const getPendingCalendarChangesResponseSchema = z.object({
  changes: z.array(detectedScheduleChangeSchema),
  lastSyncAt: z.string().nullable(),
  totalCount: z.number(),
});
export type GetPendingCalendarChangesResponse = z.infer<typeof getPendingCalendarChangesResponseSchema>;

// POST /api/calendar/changes/:id/apply - Apply a detected change
export const applyCalendarChangeRequestSchema = z.object({
  action: z.enum(["apply", "dismiss"]),
  classificationReason: z.enum(changeClassificationValues).optional(),
  createPayEvent: z.boolean().optional(),
  payEventData: createPayEventRequestSchema.optional(),
});
export type ApplyCalendarChangeRequest = z.infer<typeof applyCalendarChangeRequestSchema>;

export const applyCalendarChangeResponseSchema = z.object({
  success: z.boolean(),
  tripUpdated: z.boolean(),
  payEventCreated: z.boolean(),
  payEvent: payEventSchema.optional(),
});
export type ApplyCalendarChangeResponse = z.infer<typeof applyCalendarChangeResponseSchema>;

// ============================================
// LATE ARRIVAL PAY (LAP) - UPS Premium Code
// ============================================

// LAP Status Values
export const lapStatusValues = ["draft", "submitted", "resolved"] as const;
export type LapStatus = (typeof lapStatusValues)[number];

// LAP Confidence Levels
export const lapConfidenceLevelValues = ["green", "yellow", "red"] as const;
export type LapConfidenceLevel = (typeof lapConfidenceLevelValues)[number];

// LAP Credit Basis
export const lapCreditBasisValues = ["TRIP_RIG", "DUTY_RIG", "LEG"] as const;
export type LapCreditBasis = (typeof lapCreditBasisValues)[number];

// LAP Proof Attachment Schema
export const lapProofAttachmentSchema = z.object({
  id: z.string(),
  lapEntryId: z.string(),
  fileName: z.string(),
  fileUrl: z.string(),
  mimeType: z.string(),
  fileSize: z.number(),
  uploadedAt: z.string(),
  description: z.string().nullable(),
});
export type LapProofAttachment = z.infer<typeof lapProofAttachmentSchema>;

// LAP Entry Schema
export const lapEntrySchema = z.object({
  id: z.string(),
  userId: z.string(),
  tripId: z.string(),
  tripNumber: z.string().nullable(),
  tripDate: z.string(),

  // Original vs Actual Times
  originalArrivalUtc: z.string().nullable(),
  actualArrivalUtc: z.string().nullable(),
  dutyStartUtc: z.string().nullable(),
  dutyEndUtc: z.string().nullable(),

  // LAP Calculation Inputs
  isWxMx: z.boolean(),
  isEdw: z.boolean(),
  isDomicileAirportClosed: z.boolean(),

  // Derived Values
  lapStartTimeUtc: z.string().nullable(),
  lateMinutes: z.number(),
  legMinutesAfterLap: z.number(),
  dutyMinutesAfterLap: z.number(),

  // Credit Calculation Results
  tripRigCredit: z.number(),
  dutyRigCredit: z.number(),
  legCredit: z.number(),
  chosenBasis: z.enum(lapCreditBasisValues).nullable(),
  chosenCreditMinutes: z.number(),

  // Pay Calculation
  hourlyRateCents: z.number(),
  estimatedPayCents: z.number(),

  // Confidence Indicator
  confidenceLevel: z.enum(lapConfidenceLevelValues),
  confidenceReason: z.string().nullable(),

  // AI Explanation
  explanationText: z.string().nullable(),
  explanationPolished: z.string().nullable(),

  // Grievance PDF
  grievancePdfUrl: z.string().nullable(),
  grievancePdfGeneratedAt: z.string().nullable(),

  // User Notes
  pilotNotes: z.string().nullable(),

  // Status
  status: z.enum(lapStatusValues),
  needsReview: z.boolean(),

  createdAt: z.string(),
  updatedAt: z.string(),

  // Relations
  proofAttachments: z.array(lapProofAttachmentSchema).optional(),
});
export type LapEntry = z.infer<typeof lapEntrySchema>;

// GET /api/lap - List LAP entries
export const getLapEntriesRequestSchema = z.object({
  tripId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.enum(lapStatusValues).optional(),
});
export type GetLapEntriesRequest = z.infer<typeof getLapEntriesRequestSchema>;

export const getLapEntriesResponseSchema = z.object({
  entries: z.array(lapEntrySchema),
  totalCount: z.number(),
});
export type GetLapEntriesResponse = z.infer<typeof getLapEntriesResponseSchema>;

// GET /api/lap/:id - Get single LAP entry
export const getLapEntryResponseSchema = z.object({
  entry: lapEntrySchema,
});
export type GetLapEntryResponse = z.infer<typeof getLapEntryResponseSchema>;

// POST /api/lap - Create LAP entry
export const createLapEntryRequestSchema = z.object({
  tripId: z.string(),
  tripNumber: z.string().optional(),
  tripDate: z.string(),
  originalArrivalUtc: z.string().optional(),
  actualArrivalUtc: z.string().optional(),
  dutyStartUtc: z.string().optional(),
  dutyEndUtc: z.string().optional(),
  isWxMx: z.boolean().optional(),
  isEdw: z.boolean().optional(),
  isDomicileAirportClosed: z.boolean().optional(),
  pilotNotes: z.string().optional(),
  // Allow passing leg data for calculation
  legs: z.array(z.object({
    actualOutISO: z.string().optional(),
    actualInISO: z.string().optional(),
    actualBlockMinutes: z.number().optional(),
  })).optional(),
});
export type CreateLapEntryRequest = z.infer<typeof createLapEntryRequestSchema>;

export const createLapEntryResponseSchema = z.object({
  success: z.boolean(),
  entry: lapEntrySchema,
});
export type CreateLapEntryResponse = z.infer<typeof createLapEntryResponseSchema>;

// PUT /api/lap/:id - Update LAP entry
export const updateLapEntryRequestSchema = z.object({
  originalArrivalUtc: z.string().optional(),
  actualArrivalUtc: z.string().optional(),
  dutyStartUtc: z.string().optional(),
  dutyEndUtc: z.string().optional(),
  isWxMx: z.boolean().optional(),
  isEdw: z.boolean().optional(),
  isDomicileAirportClosed: z.boolean().optional(),
  pilotNotes: z.string().optional(),
  status: z.enum(lapStatusValues).optional(),
  // Allow passing leg data for recalculation
  legs: z.array(z.object({
    actualOutISO: z.string().optional(),
    actualInISO: z.string().optional(),
    actualBlockMinutes: z.number().optional(),
  })).optional(),
});
export type UpdateLapEntryRequest = z.infer<typeof updateLapEntryRequestSchema>;

export const updateLapEntryResponseSchema = z.object({
  success: z.boolean(),
  entry: lapEntrySchema,
});
export type UpdateLapEntryResponse = z.infer<typeof updateLapEntryResponseSchema>;

// DELETE /api/lap/:id
export const deleteLapEntryResponseSchema = z.object({
  success: z.boolean(),
});
export type DeleteLapEntryResponse = z.infer<typeof deleteLapEntryResponseSchema>;

// POST /api/lap/:id/proof - Upload proof attachment
export const uploadLapProofRequestSchema = z.object({
  fileName: z.string(),
  fileUrl: z.string(),
  mimeType: z.string(),
  fileSize: z.number().optional(),
  description: z.string().optional(),
});
export type UploadLapProofRequest = z.infer<typeof uploadLapProofRequestSchema>;

export const uploadLapProofResponseSchema = z.object({
  success: z.boolean(),
  attachment: lapProofAttachmentSchema,
});
export type UploadLapProofResponse = z.infer<typeof uploadLapProofResponseSchema>;

// DELETE /api/lap/:id/proof/:proofId
export const deleteLapProofResponseSchema = z.object({
  success: z.boolean(),
});
export type DeleteLapProofResponse = z.infer<typeof deleteLapProofResponseSchema>;

// POST /api/lap/:id/generate-pdf - Generate grievance PDF
export const generateLapPdfResponseSchema = z.object({
  success: z.boolean(),
  pdfUrl: z.string(),
  generatedAt: z.string(),
});
export type GenerateLapPdfResponse = z.infer<typeof generateLapPdfResponseSchema>;

// POST /api/lap/:id/polish-explanation - AI polish explanation
export const polishLapExplanationResponseSchema = z.object({
  success: z.boolean(),
  polishedExplanation: z.string(),
});
export type PolishLapExplanationResponse = z.infer<typeof polishLapExplanationResponseSchema>;

// POST /api/lap/calculate - Calculate LAP without saving (preview)
export const calculateLapRequestSchema = z.object({
  originalArrivalUtc: z.string(),
  actualArrivalUtc: z.string(),
  dutyStartUtc: z.string().optional(),
  dutyEndUtc: z.string().optional(),
  isWxMx: z.boolean(),
  isEdw: z.boolean(),
  isDomicileAirportClosed: z.boolean(),
  hourlyRateCents: z.number(),
  legs: z.array(z.object({
    actualOutISO: z.string().optional(),
    actualInISO: z.string().optional(),
    actualBlockMinutes: z.number().optional(),
  })).optional(),
});
export type CalculateLapRequest = z.infer<typeof calculateLapRequestSchema>;

export const calculateLapResponseSchema = z.object({
  isEligible: z.boolean(),
  eligibilityReason: z.string().optional(),
  lapStartTimeUtc: z.string().nullable(),
  lateMinutes: z.number(),
  legMinutesAfterLap: z.number(),
  dutyMinutesAfterLap: z.number(),
  tripRigCredit: z.number(),
  dutyRigCredit: z.number(),
  legCredit: z.number(),
  chosenBasis: z.enum(lapCreditBasisValues).nullable(),
  chosenCreditMinutes: z.number(),
  estimatedPayCents: z.number(),
  confidenceLevel: z.enum(lapConfidenceLevelValues),
  confidenceReason: z.string(),
  explanationText: z.string(),
});
export type CalculateLapResponse = z.infer<typeof calculateLapResponseSchema>;

// ============================================
// AI PAY EXPLANATIONS
// AI-powered explanations for pay statements
// ============================================

// Explanation Section Types
export const payExplanationSectionValues = [
  "FULL_STATEMENT", // Overall statement explanation
  "EARNINGS", // Credit pay, block overage, premiums
  "TAXES", // Federal, state, FICA, Medicare
  "DEDUCTIONS", // Pre-tax and post-tax deductions
  "REIMBURSEMENTS", // Per diem, expenses
  "NET_PAY", // Final net pay calculation
  "DIFFERENCE", // Projected vs Actual difference
] as const;
export type PayExplanationSection = (typeof payExplanationSectionValues)[number];

// Verification Status
export const payVerificationStatusValues = [
  "VERIFIED", // Matches expectations
  "ESTIMATED", // Some values are estimated
  "MISMATCH", // Significant difference found
  "REVIEW_RECOMMENDED", // User should review
] as const;
export type PayVerificationStatus = (typeof payVerificationStatusValues)[number];

// POST /api/ai/pay-explanation - Request AI explanation
export const payExplanationRequestSchema = z.object({
  section: z.enum(payExplanationSectionValues),
  // Projected pay data
  projectedData: z.object({
    grossPayCents: z.number(),
    netPayCents: z.number().optional(),
    creditMinutes: z.number(),
    blockMinutes: z.number(),
    hourlyRateCents: z.number(),
    // Tax breakdown
    federalWithholdingCents: z.number().optional(),
    stateWithholdingCents: z.number().optional(),
    socialSecurityCents: z.number().optional(),
    medicareCents: z.number().optional(),
    // Deductions
    pretaxDeductionsCents: z.number().optional(),
    posttaxDeductionsCents: z.number().optional(),
    // Other
    perDiemCents: z.number().optional(),
  }),
  // Actual pay data (if comparing)
  actualData: z.object({
    grossPayCents: z.number(),
    netPayCents: z.number().optional(),
    creditMinutes: z.number().optional(),
    // Tax breakdown
    federalWithholdingCents: z.number().optional(),
    stateWithholdingCents: z.number().optional(),
    socialSecurityCents: z.number().optional(),
    medicareCents: z.number().optional(),
    // Deductions
    deductionsCents: z.number().optional(),
  }).optional(),
  // Context data
  context: z.object({
    airline: z.string(),
    position: z.string(), // FO or CPT
    yearOfService: z.number().optional(),
    filingStatus: z.string().optional(),
    stateOfResidence: z.string().optional(),
    payPeriodStart: z.string().optional(),
    payPeriodEnd: z.string().optional(),
    // Pay events in period
    payEvents: z.array(z.object({
      type: z.string(),
      label: z.string().optional(),
      amountCents: z.number().optional(),
    })).optional(),
    // Benchmark data
    benchmarkData: z.object({
      hourlyRateCents: z.number(),
      payAtGuaranteeCents: z.number(),
      avgLinePayCents: z.number(),
      avgTotalPayCents: z.number(),
      sourceNote: z.string().optional(),
    }).optional(),
  }),
});
export type PayExplanationRequest = z.infer<typeof payExplanationRequestSchema>;

// AI Explanation Response
export const payExplanationResponseSchema = z.object({
  success: z.boolean(),
  section: z.enum(payExplanationSectionValues),
  // Main explanation content
  explanation: z.object({
    header: z.string(), // e.g., "What affected your pay this period"
    keyDrivers: z.array(z.string()), // Bullet points
    matched: z.array(z.string()).optional(), // What matched expectations
    differed: z.array(z.string()).optional(), // What differed
    benchmarkContext: z.string().optional(), // Benchmark comparison text
  }),
  // Verification status
  verificationStatus: z.enum(payVerificationStatusValues),
  verificationNote: z.string().optional(),
  // Suggested action
  suggestedAction: z.string().optional(),
  // Difference analysis (for DIFFERENCE section or when actual provided)
  differenceAnalysis: z.object({
    netPayDifferenceCents: z.number(),
    grossPayDifferenceCents: z.number().optional(),
    isWithinTolerance: z.boolean(),
    tolerancePercent: z.number(),
    likelyCauses: z.array(z.string()),
  }).optional(),
});
export type PayExplanationResponse = z.infer<typeof payExplanationResponseSchema>;

// ============================================
// CANONICAL TRIP BREAKDOWN
// Normalized structure for Trip Information and Trip Details imports
// ============================================

// Trip Duty Leg Schema
export const tripDutyLegSchema = z.object({
  id: z.string(),
  index: z.number(),
  flightNumber: z.string().optional(),
  origin: z.string().optional(),
  destination: z.string().optional(),
  equipment: z.string().optional(),
  isDeadhead: z.boolean(),
  scheduledOutISO: z.string().optional(),
  scheduledInISO: z.string().optional(),
  plannedBlockMinutes: z.number(),
  creditMinutes: z.number(),
});
export type TripDutyLeg = z.infer<typeof tripDutyLegSchema>;

// Trip Layover Schema
export const tripLayoverSchema = z.object({
  id: z.string(),
  station: z.string(),
  restMinutes: z.number(),
  hotelName: z.string().optional(),
  hotelPhone: z.string().optional(),
  hotelAddress: z.string().optional(),
  hotelStatus: z.string().optional(),
  hotelSource: z.string().optional(), // "trip_info", "directory", "manual"
  hotelConfidence: z.number(),
  transportNotes: z.string().optional(),
  transportPhone: z.string().optional(),
});
export type TripLayover = z.infer<typeof tripLayoverSchema>;

// Trip Duty Day Schema
export const tripDutyDaySchema = z.object({
  id: z.string(),
  index: z.number(),
  date: z.string(), // YYYY-MM-DD
  reportTimeISO: z.string().optional(),
  releaseTimeISO: z.string().optional(),
  dutyMinutes: z.number(),
  blockMinutes: z.number(),
  creditMinutes: z.number(),
  restAfterMinutes: z.number().optional(),
  layoverStation: z.string().optional(),
  legs: z.array(tripDutyLegSchema),
  layover: tripLayoverSchema.optional(),
});
export type TripDutyDay = z.infer<typeof tripDutyDaySchema>;

// Canonical Trip Breakdown Schema
export const canonicalTripBreakdownSchema = z.object({
  tripId: z.string(),
  tripNumber: z.string().optional(),
  pairingId: z.string().optional(),
  baseFleet: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
  dutyDays: z.array(tripDutyDaySchema),
  totals: z.object({
    creditMinutes: z.number(),
    blockMinutes: z.number(),
    tafbMinutes: z.number(),
    dutyDays: z.number(),
  }),
});
export type CanonicalTripBreakdown = z.infer<typeof canonicalTripBreakdownSchema>;

// GET /api/trips/:id/breakdown - Get canonical trip breakdown
export const getTripBreakdownResponseSchema = z.object({
  breakdown: canonicalTripBreakdownSchema.nullable(),
});
export type GetTripBreakdownResponse = z.infer<typeof getTripBreakdownResponseSchema>;

// ============================================
// HOTEL DIRECTORY
// Per-user, per-airline hotel directory
// ============================================

// Hotel Directory Entry Schema
export const hotelDirectoryEntrySchema = z.object({
  id: z.string(),
  station: z.string(),
  hotelName: z.string(),
  hotelPhone: z.string().optional(),
  hotelAddress: z.string().optional(),
  confirmCount: z.number(),
  rejectCount: z.number(),
  lastConfirmedAt: z.string(),
  lastSeenAt: z.string(),
  isShared: z.boolean(),
  baseCode: z.string().optional(),
  equipmentCode: z.string().optional(),
});
export type HotelDirectoryEntry = z.infer<typeof hotelDirectoryEntrySchema>;

// Hotel Lookup Result Schema
export const hotelLookupResultSchema = z.object({
  found: z.boolean(),
  station: z.string(),
  hotel: z.object({
    hotelName: z.string(),
    hotelPhone: z.string().optional(),
    hotelAddress: z.string().optional(),
    source: z.enum(["trip_info", "directory", "shared_directory"]),
    confidence: z.number(),
  }).optional(),
  message: z.string().optional(),
});
export type HotelLookupResult = z.infer<typeof hotelLookupResultSchema>;

// GET /api/hotel-directory - List user's hotels
export const getHotelDirectoryResponseSchema = z.object({
  airlineCode: z.string(),
  stationCount: z.number(),
  hotelCount: z.number(),
  byStation: z.record(z.string(), z.array(hotelDirectoryEntrySchema)),
});
export type GetHotelDirectoryResponse = z.infer<typeof getHotelDirectoryResponseSchema>;

// GET /api/hotel-directory/lookup - Lookup hotel for station
export const lookupHotelRequestSchema = z.object({
  station: z.string(),
  baseCode: z.string().optional(),
  equipmentCode: z.string().optional(),
});
export type LookupHotelRequest = z.infer<typeof lookupHotelRequestSchema>;

// POST /api/hotel-directory/confirm - Confirm hotel for station
export const confirmHotelRequestSchema = z.object({
  station: z.string(),
  hotelName: z.string(),
  hotelPhone: z.string().optional(),
  hotelAddress: z.string().optional(),
  baseCode: z.string().optional(),
  equipmentCode: z.string().optional(),
  isShared: z.boolean().optional(),
});
export type ConfirmHotelRequest = z.infer<typeof confirmHotelRequestSchema>;

// POST /api/hotel-directory/reject - Reject hotel for station
export const rejectHotelRequestSchema = z.object({
  station: z.string(),
  hotelName: z.string(),
});
export type RejectHotelRequest = z.infer<typeof rejectHotelRequestSchema>;

// PUT /api/hotel-directory/layover/:id - Update layover hotel
export const updateLayoverHotelRequestSchema = z.object({
  hotelName: z.string(),
  hotelPhone: z.string().optional(),
  hotelAddress: z.string().optional(),
  hotelStatus: z.string().optional(),
  action: z.enum(["confirm", "edit", "reject"]),
});
export type UpdateLayoverHotelRequest = z.infer<typeof updateLayoverHotelRequestSchema>;

// GET /api/hotel-directory/stations - List all stations with hotels
export const getHotelStationsResponseSchema = z.object({
  airlineCode: z.string(),
  stations: z.array(z.object({
    station: z.string(),
    hotelCount: z.number(),
    topHotel: z.string().optional(),
    lastUsed: z.string(),
  })),
});
export type GetHotelStationsResponse = z.infer<typeof getHotelStationsResponseSchema>;

// ============================================
// SCHEDULE IMPORT PIPELINE
// ============================================

// Import Source Types
export const importSourceTypeValues = [
  "trip_board_browser",
  "trip_board_trip_details",
  "crew_access_trip_info",
  "unknown",
] as const;
export type ImportSourceType = (typeof importSourceTypeValues)[number];

// Canonical Import Result Schema
export const canonicalImportResultSchema = z.object({
  tripId: z.string(),
  dutyDayIds: z.array(z.string()),
  legIds: z.array(z.string()),
  layoverIds: z.array(z.string()),
  hotelsPopulated: z.number(),
  hotelsFromDirectory: z.number(),
  needsHotelReview: z.array(z.string()), // Layover IDs needing user review
});
export type CanonicalImportResult = z.infer<typeof canonicalImportResultSchema>;

// ============================================
// IMPORT RELIABILITY SYSTEM
// Idempotent, bulletproof schedule imports
// ============================================

// Upload Status
export const uploadStatusValues = [
  "pending",      // Queued for processing
  "processing",   // Currently being parsed
  "completed",    // Successfully imported
  "failed",       // Parse or validation error
  "skipped",      // Duplicate file hash
] as const;
export type UploadStatus = (typeof uploadStatusValues)[number];

// Upload Record Schema
export const uploadRecordSchema = z.object({
  id: z.string(),
  userId: z.string(),
  sourceType: z.string(),
  imageUrl: z.string(),
  fileHash: z.string().nullable(),
  status: z.enum(uploadStatusValues),
  errorMessage: z.string().nullable(),
  uploadedAt: z.string(),
  processedAt: z.string().nullable(),
  parseConfidence: z.number(),
  tripsCreated: z.number(),
  tripsUpdated: z.number(),
  tripsSkipped: z.number(),
  conflictsFound: z.number(),
  warningCount: z.number(),
  warningMessages: z.array(z.string()).nullable(),
});
export type UploadRecord = z.infer<typeof uploadRecordSchema>;

// Import Summary (for UI display after import)
export const importSummarySchema = z.object({
  uploadId: z.string(),
  status: z.enum(uploadStatusValues),
  tripsCreated: z.number(),
  tripsUpdated: z.number(),
  tripsSkipped: z.number(),
  conflictsNeedingReview: z.number(),
  warnings: z.array(z.string()),
  errorMessage: z.string().nullable(),
  // Detailed trip results
  tripResults: z.array(z.object({
    tripId: z.string(),
    action: z.enum(["created", "updated", "skipped", "conflict"]),
    tripNumber: z.string().nullable(),
    pairingId: z.string().nullable(),
    startDate: z.string(),
    endDate: z.string(),
    creditMinutes: z.number(),
    message: z.string().nullable(),
  })),
});
export type ImportSummary = z.infer<typeof importSummarySchema>;

// Pre-flight Validation Result
export const preflightValidationSchema = z.object({
  isValid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  // Parsed data summary
  tripCount: z.number(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  creditMinutes: z.number(),
  dutyDaysCount: z.number(),
});
export type PreflightValidation = z.infer<typeof preflightValidationSchema>;

// Duplicate Check Response
export const duplicateCheckResponseSchema = z.object({
  isDuplicate: z.boolean(),
  existingUploadId: z.string().nullable(),
  existingUploadDate: z.string().nullable(),
  message: z.string(),
});
export type DuplicateCheckResponse = z.infer<typeof duplicateCheckResponseSchema>;

// POST /api/schedule/check-duplicate - Check if file was already uploaded
export const checkDuplicateRequestSchema = z.object({
  fileHash: z.string(),
});
export type CheckDuplicateRequest = z.infer<typeof checkDuplicateRequestSchema>;

// GET /api/uploads/recent - Get recent uploads for user
export const getRecentUploadsResponseSchema = z.object({
  uploads: z.array(uploadRecordSchema),
  totalCount: z.number(),
});
export type GetRecentUploadsResponse = z.infer<typeof getRecentUploadsResponseSchema>;

// POST /api/uploads/:id/retry - Retry a failed upload
export const retryUploadResponseSchema = z.object({
  success: z.boolean(),
  uploadId: z.string(),
  summary: importSummarySchema.nullable(),
  message: z.string(),
});
export type RetryUploadResponse = z.infer<typeof retryUploadResponseSchema>;

// Import Queue Status (for multi-file uploads)
export const importQueueStatusSchema = z.object({
  totalFiles: z.number(),
  processedFiles: z.number(),
  currentFile: z.number(),
  currentFileName: z.string().nullable(),
  status: z.enum(["idle", "processing", "completed", "error"]),
  results: z.array(importSummarySchema),
});
export type ImportQueueStatus = z.infer<typeof importQueueStatusSchema>;

// ============================================
// LIFETIME EARNINGS
// Historical record of annual earnings at current airline
// ============================================

// Earnings Year Source
export const earningsSourceValues = ["user", "app"] as const;
export type EarningsSource = (typeof earningsSourceValues)[number];

// Lifetime Earnings Year Schema
export const lifetimeEarningsYearSchema = z.object({
  id: z.string(),
  year: z.number(),
  grossEarningsCents: z.number(),
  source: z.enum(earningsSourceValues),
  isFinalized: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LifetimeEarningsYear = z.infer<typeof lifetimeEarningsYearSchema>;

// Lifetime Earnings Config Schema
export const lifetimeEarningsConfigSchema = z.object({
  id: z.string(),
  airline: z.string(),
  startYear: z.number().nullable(),
  priorYearsAdded: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LifetimeEarningsConfig = z.infer<typeof lifetimeEarningsConfigSchema>;

// Lifetime Earnings Summary (computed stats)
export const lifetimeEarningsSummarySchema = z.object({
  totalCareerEarningsCents: z.number(),
  yearsActive: z.number(),
  averageAnnualEarningsCents: z.number(),
  highestEarningYear: z.object({
    year: z.number(),
    grossEarningsCents: z.number(),
  }).nullable(),
  lowestEarningYear: z.object({
    year: z.number(),
    grossEarningsCents: z.number(),
  }).nullable(),
  currentYearEarningsCents: z.number(),
  currentYearIsInProgress: z.boolean(),
});
export type LifetimeEarningsSummary = z.infer<typeof lifetimeEarningsSummarySchema>;

// GET /api/lifetime-earnings - Get lifetime earnings data
export const getLifetimeEarningsResponseSchema = z.object({
  config: lifetimeEarningsConfigSchema.nullable(),
  years: z.array(lifetimeEarningsYearSchema),
  summary: lifetimeEarningsSummarySchema,
  airline: z.string(),
});
export type GetLifetimeEarningsResponse = z.infer<typeof getLifetimeEarningsResponseSchema>;

// POST /api/lifetime-earnings/prior-years - Add prior years earnings
export const addPriorYearsRequestSchema = z.object({
  years: z.array(z.object({
    year: z.number(),
    grossEarningsCents: z.number(),
    notes: z.string().optional(),
  })),
});
export type AddPriorYearsRequest = z.infer<typeof addPriorYearsRequestSchema>;

export const addPriorYearsResponseSchema = z.object({
  success: z.boolean(),
  yearsAdded: z.number(),
  years: z.array(lifetimeEarningsYearSchema),
});
export type AddPriorYearsResponse = z.infer<typeof addPriorYearsResponseSchema>;

// PUT /api/lifetime-earnings/years/:year - Update a year's earnings
export const updateEarningsYearRequestSchema = z.object({
  grossEarningsCents: z.number().optional(),
  notes: z.string().optional(),
});
export type UpdateEarningsYearRequest = z.infer<typeof updateEarningsYearRequestSchema>;

export const updateEarningsYearResponseSchema = z.object({
  success: z.boolean(),
  year: lifetimeEarningsYearSchema,
});
export type UpdateEarningsYearResponse = z.infer<typeof updateEarningsYearResponseSchema>;

// DELETE /api/lifetime-earnings/years/:year - Delete a prior year
export const deleteEarningsYearResponseSchema = z.object({
  success: z.boolean(),
});
export type DeleteEarningsYearResponse = z.infer<typeof deleteEarningsYearResponseSchema>;

// GET /api/lifetime-earnings/context - Get career context for Upgrade Simulation
export const getCareerContextResponseSchema = z.object({
  hasLifetimeData: z.boolean(),
  averageAnnualEarningsCents: z.number().nullable(),
  yearsTracked: z.number(),
});
export type GetCareerContextResponse = z.infer<typeof getCareerContextResponseSchema>;

// ============================================
// AI HELP DESK
// ============================================

// POST /api/support/help-desk - AI Help Desk chat
export const helpDeskMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type HelpDeskMessage = z.infer<typeof helpDeskMessageSchema>;

export const helpDeskChatRequestSchema = z.object({
  message: z.string(),
  conversationHistory: z.array(helpDeskMessageSchema).optional(),
});
export type HelpDeskChatRequest = z.infer<typeof helpDeskChatRequestSchema>;

export const helpDeskChatResponseSchema = z.object({
  success: z.boolean(),
  response: z.string(),
  suggestTicket: z.boolean().optional(),
  ticketCategory: z.string().optional(),
});
export type HelpDeskChatResponse = z.infer<typeof helpDeskChatResponseSchema>;

// ============================================
// TRIP VERSION SYSTEM - Roster Change Detection + Pay Protection
// Phase 1-7 Implementation
// ============================================

// ----- SEVERITY CLASSIFICATION (Phase 3) -----
export const rosterChangeSeverityValues = ["minor", "moderate", "major"] as const;
export type RosterChangeSeverity = (typeof rosterChangeSeverityValues)[number];

// ----- CHANGE TYPES (Phase 3) -----
export const rosterChangeTypeValues = [
  "duty_day_added",
  "duty_day_removed",
  "leg_added",
  "leg_removed",
  "time_change",
  "route_change",
  "credit_change",
  "layover_change",
  "deadhead_change",
  "flight_number_change",
] as const;
export type RosterChangeType = (typeof rosterChangeTypeValues)[number];

// ----- PREMIUM CANDIDATE TYPES (Phase 5) -----
export const premiumCandidateTypeValues = [
  "layover_premium",
  "additional_flying",
  "duty_extension",
  "reassignment",
  "pay_protection",
  "deadhead_rig",
] as const;
export type PremiumCandidateType = (typeof premiumCandidateTypeValues)[number];

// Note: ConfidenceLevel is already defined earlier in this file (line ~1531)
// Reuse the existing confidenceLevelValues: ["high", "medium", "low"]

// ----- AUDIT RECORD TYPES (Phase 6) -----
export const auditRecordTypeValues = [
  "trip_imported",
  "roster_change_detected",
  "roster_updated_minor",
  "roster_acknowledged",
  "pay_protection_applied",
  "credit_increased",
  "premium_detected",
  "log_event_created",
  "log_event_submitted",
  "manual_review_recommended",
] as const;
export type AuditRecordType = (typeof auditRecordTypeValues)[number];

// ----- TRIP VERSION SCHEDULE DATA (stored as JSON in TripVersion.scheduleData) -----
export const tripVersionDutyDaySchema = z.object({
  dayIndex: z.number(),
  dutyDate: z.string(),
  reportTimeISO: z.string().nullable(),
  releaseTimeISO: z.string().nullable(),
  dutyMinutes: z.number(),
  blockMinutes: z.number(),
  creditMinutes: z.number(),
  restAfterMinutes: z.number().nullable(),
  layoverStation: z.string().nullable(),
  legs: z.array(
    z.object({
      legIndex: z.number(),
      flightNumber: z.string().nullable(),
      origin: z.string().nullable(),
      destination: z.string().nullable(),
      equipment: z.string().nullable(),
      isDeadhead: z.boolean(),
      scheduledOutISO: z.string().nullable(),
      scheduledInISO: z.string().nullable(),
      plannedBlockMinutes: z.number(),
      plannedCreditMinutes: z.number(),
    })
  ),
  layover: z
    .object({
      station: z.string(),
      restMinutes: z.number(),
      hotelName: z.string().nullable(),
      hotelPhone: z.string().nullable(),
    })
    .nullable(),
});
export type TripVersionDutyDay = z.infer<typeof tripVersionDutyDaySchema>;

export const tripVersionScheduleDataSchema = z.object({
  tripNumber: z.string().nullable(),
  pairingId: z.string().nullable(),
  baseFleet: z.string().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  dutyDays: z.array(tripVersionDutyDaySchema),
  totals: z.object({
    creditMinutes: z.number(),
    blockMinutes: z.number(),
    tafbMinutes: z.number(),
    dutyDaysCount: z.number(),
    legCount: z.number(),
  }),
});
export type TripVersionScheduleData = z.infer<typeof tripVersionScheduleDataSchema>;

// ----- TRIP VERSION SCHEMA -----
export const tripVersionSchema = z.object({
  id: z.string(),
  tripId: z.string(),
  versionNumber: z.number(),
  isActiveVersion: z.boolean(),
  isBaselineVersion: z.boolean(),
  scheduleData: z.string(), // JSON TripVersionScheduleData
  totalCreditMinutes: z.number(),
  totalBlockMinutes: z.number(),
  totalTafbMinutes: z.number(),
  dutyDaysCount: z.number(),
  legCount: z.number(),
  sourceType: z.string(),
  sourceSnapshotId: z.string().nullable(),
  imageUrls: z.string().nullable(), // JSON array
  parseConfidence: z.number(),
  lowConfidenceFields: z.string().nullable(), // JSON array
  createdAt: z.string(),
});
export type TripVersion = z.infer<typeof tripVersionSchema>;

// ----- TRIP PAY PROTECTION SCHEMA -----
export const tripPayProtectionSchema = z.object({
  id: z.string(),
  tripId: z.string(),
  protectedCreditMinutes: z.number(),
  protectedSetAt: z.string().nullable(),
  baselineVersionId: z.string().nullable(),
  currentCreditMinutes: z.number(),
  currentVersionId: z.string().nullable(),
  payCreditMinutes: z.number(),
  payCreditSource: z.string(), // "protected" | "current"
  isPayProtected: z.boolean(),
  protectionAppliedAt: z.string().nullable(),
  creditDeltaMinutes: z.number(),
  estimatedDeltaCents: z.number(),
  lastEvaluatedAt: z.string(),
  evaluationCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TripPayProtection = z.infer<typeof tripPayProtectionSchema>;

// ----- ROSTER CHANGE SCHEMA -----
export const rosterChangeSchema = z.object({
  id: z.string(),
  userId: z.string(),
  tripId: z.string(),
  oldVersionId: z.string().nullable(),
  newVersionId: z.string(),
  changeType: z.enum(rosterChangeTypeValues),
  severity: z.enum(rosterChangeSeverityValues),
  fieldChanged: z.string().nullable(),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  affectedDays: z.string().nullable(), // JSON array
  affectedLegs: z.string().nullable(), // JSON array
  changeSummary: z.string(),
  creditDiffMinutes: z.number(),
  estimatedPayDiffCents: z.number(),
  isPremiumCandidate: z.boolean(),
  premiumCandidateType: z.enum(premiumCandidateTypeValues).nullable(),
  premiumConfidence: z.enum(confidenceLevelValues).nullable(),
  requiresAck: z.boolean(),
  acknowledged: z.boolean(),
  acknowledgedAt: z.string().nullable(),
  acknowledgedBy: z.string().nullable(),
  logEventId: z.string().nullable(),
  logEventStatus: z.string().nullable(),
  recordId: z.string().nullable(),
  createdAt: z.string(),
});
export type RosterChange = z.infer<typeof rosterChangeSchema>;

// ----- AUDIT RECORD SCHEMA -----
export const auditRecordSchema = z.object({
  id: z.string(),
  userId: z.string(),
  recordType: z.enum(auditRecordTypeValues),
  tripId: z.string().nullable(),
  tripVersionId: z.string().nullable(),
  rosterChangeId: z.string().nullable(),
  logEventId: z.string().nullable(),
  title: z.string(),
  summary: z.string(),
  severity: z.enum(rosterChangeSeverityValues).nullable(),
  creditContext: z.string().nullable(), // JSON
  payContext: z.string().nullable(), // JSON
  linkedEvidence: z.string().nullable(), // JSON array
  metadata: z.string().nullable(), // JSON
  createdAt: z.string(),
});
export type AuditRecord = z.infer<typeof auditRecordSchema>;

// ----- PAY OUTCOME STATE (Phase 4 - UX) -----
export const payOutcomeStateValues = ["protected", "increased", "unchanged", "review_required"] as const;
export type PayOutcomeState = (typeof payOutcomeStateValues)[number];

export const payOutcomeBannerSchema = z.object({
  state: z.enum(payOutcomeStateValues),
  title: z.string(),
  message: z.string(),
  subtext: z.string().nullable(),
  protectedCreditMinutes: z.number(),
  currentCreditMinutes: z.number(),
  payCreditMinutes: z.number(),
  creditDeltaMinutes: z.number(),
  estimatedDeltaCents: z.number().nullable(),
});
export type PayOutcomeBanner = z.infer<typeof payOutcomeBannerSchema>;

// ----- USER ACTION STATUS (Phase 4 - UX) -----
export const userActionStatusValues = [
  "no_action_required",
  "acknowledgment_required",
  "log_event_recommended",
] as const;
export type UserActionStatus = (typeof userActionStatusValues)[number];

// ============================================
// TRIP VERSION API CONTRACTS
// ============================================

// GET /api/trips/:tripId/versions - List versions for a trip
export const getTripVersionsResponseSchema = z.object({
  versions: z.array(tripVersionSchema),
  activeVersion: tripVersionSchema.nullable(),
  payProtection: tripPayProtectionSchema.nullable(),
});
export type GetTripVersionsResponse = z.infer<typeof getTripVersionsResponseSchema>;

// GET /api/trips/:tripId/versions/:versionId - Get specific version
export const getTripVersionResponseSchema = z.object({
  version: tripVersionSchema,
  scheduleData: tripVersionScheduleDataSchema,
});
export type GetTripVersionResponse = z.infer<typeof getTripVersionResponseSchema>;

// GET /api/trips/:tripId/pay-protection - Get pay protection state
export const getTripPayProtectionResponseSchema = z.object({
  payProtection: tripPayProtectionSchema.nullable(),
  payOutcome: payOutcomeBannerSchema.nullable(),
  userActionStatus: z.enum(userActionStatusValues),
});
export type GetTripPayProtectionResponse = z.infer<typeof getTripPayProtectionResponseSchema>;

// GET /api/trips/:tripId/changes - Get roster changes for a trip
export const getTripRosterChangesResponseSchema = z.object({
  changes: z.array(rosterChangeSchema),
  pendingAckCount: z.number(),
  hasPremiumCandidates: z.boolean(),
});
export type GetTripRosterChangesResponse = z.infer<typeof getTripRosterChangesResponseSchema>;

// POST /api/trips/:tripId/changes/:changeId/acknowledge - Acknowledge a change
export const acknowledgeRosterChangeRequestSchema = z.object({
  createLogEvent: z.boolean().optional(),
});
export type AcknowledgeRosterChangeRequest = z.infer<typeof acknowledgeRosterChangeRequestSchema>;

export const acknowledgeRosterChangeResponseSchema = z.object({
  success: z.boolean(),
  change: rosterChangeSchema,
  trip: tripSchema.optional(),
  logEventId: z.string().nullable(),
  auditRecordId: z.string(),
});
export type AcknowledgeRosterChangeResponse = z.infer<typeof acknowledgeRosterChangeResponseSchema>;

// GET /api/roster-changes/pending - Get all pending changes across trips
export const getPendingRosterChangesRequestSchema = z.object({
  severityFilter: z.enum(rosterChangeSeverityValues).optional(),
});
export type GetPendingRosterChangesRequest = z.infer<typeof getPendingRosterChangesRequestSchema>;

export const getPendingRosterChangesResponseSchema = z.object({
  changes: z.array(
    rosterChangeSchema.extend({
      tripNumber: z.string().nullable(),
      tripStartDate: z.string(),
    })
  ),
  totalCount: z.number(),
  byTrip: z.array(
    z.object({
      tripId: z.string(),
      tripNumber: z.string().nullable(),
      changeCount: z.number(),
      severity: z.enum(rosterChangeSeverityValues),
    })
  ),
});
export type GetPendingRosterChangesResponse = z.infer<typeof getPendingRosterChangesResponseSchema>;

// ============================================
// AUDIT RECORDS API CONTRACTS
// ============================================

// GET /api/records - List audit records
export const getAuditRecordsRequestSchema = z.object({
  tripId: z.string().optional(),
  recordType: z.enum(auditRecordTypeValues).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});
export type GetAuditRecordsRequest = z.infer<typeof getAuditRecordsRequestSchema>;

export const getAuditRecordsResponseSchema = z.object({
  records: z.array(auditRecordSchema),
  totalCount: z.number(),
  hasMore: z.boolean(),
});
export type GetAuditRecordsResponse = z.infer<typeof getAuditRecordsResponseSchema>;

// GET /api/records/:recordId - Get single audit record
export const getAuditRecordResponseSchema = z.object({
  record: auditRecordSchema,
  relatedVersion: tripVersionSchema.nullable(),
  relatedChange: rosterChangeSchema.nullable(),
});
export type GetAuditRecordResponse = z.infer<typeof getAuditRecordResponseSchema>;

// ============================================
// REVIEW CHANGES SCREEN DATA (Phase 4 UX)
// ============================================

export const reviewChangesScreenDataSchema = z.object({
  // Banner (always first)
  payOutcome: payOutcomeBannerSchema,
  userActionStatus: z.enum(userActionStatusValues),

  // Side-by-side comparison
  oldVersion: tripVersionSchema.nullable(),
  oldScheduleData: tripVersionScheduleDataSchema.nullable(),
  newVersion: tripVersionSchema,
  newScheduleData: tripVersionScheduleDataSchema,

  // Changes detected
  changes: z.array(rosterChangeSchema),

  // Credit summary
  creditSummary: z.object({
    protectedCreditMinutes: z.number(),
    newRosterCreditMinutes: z.number(),
    payCreditUsedMinutes: z.number(),
    explanation: z.string(), // "We always use the higher of your awarded credit or your current roster credit."
  }),

  // Premium candidates
  premiumCandidates: z.array(
    z.object({
      changeId: z.string(),
      candidateType: z.enum(premiumCandidateTypeValues),
      confidence: z.enum(confidenceLevelValues),
      reason: z.string(),
      affectedDates: z.array(z.string()),
    })
  ),
});
export type ReviewChangesScreenData = z.infer<typeof reviewChangesScreenDataSchema>;

// GET /api/trips/:tripId/review-changes - Get data for Review Changes screen
export const getReviewChangesResponseSchema = z.object({
  data: reviewChangesScreenDataSchema,
});
export type GetReviewChangesResponse = z.infer<typeof getReviewChangesResponseSchema>;

// ============================================
// EXTENDED TRIP SCHEMA WITH PAY PROTECTION
// ============================================

export const tripWithPayProtectionSchema = tripSchema.extend({
  // Version state
  activeVersionId: z.string().nullable(),
  hasChangePending: z.boolean(),
  changePendingSince: z.string().nullable(),

  // Pay protection summary (for display)
  payProtection: tripPayProtectionSchema.nullable().optional(),

  // Pending changes count
  pendingChangesCount: z.number().optional(),
});
export type TripWithPayProtection = z.infer<typeof tripWithPayProtectionSchema>;

// ============================================
// TRIP CONFLICT DETECTION (Pay Protection Alert)
// ============================================

// User decision when conflicts detected
// NEW ACTIONS (v2):
// - company_revision: Company changed the assignment (reroute, leg changes, credit change)
//   → Update existing trip with new data, apply protected credit: final = max(old, new)
// - replace_trip: User swap/trade/open time - new trip replaces old
//   → Archive old trip (excluded from totals), import new trip as active
// - cancel: Do nothing, abort import
export const conflictDecisionValues = [
  "company_revision",    // Company Revision (Protected Credit) - update existing, max(old, new) credit
  "replace_trip",        // Replace Trip (Swap / Open Time) - archive old, import new
  "cancel",              // Cancel Import - do nothing
  // Legacy values (still supported for backwards compatibility)
  "replace_existing",    // [LEGACY] → maps to replace_trip
  "keep_both_override",  // [LEGACY] → no longer used
  "resolve_later",       // [LEGACY] → no longer used
] as const;
export type ConflictDecision = (typeof conflictDecisionValues)[number];

// Conflict type
export const tripConflictTypeValues = [
  "date_overlap",        // Overlapping date ranges
  "duty_day_overlap",    // Same duty days
  "same_calendar_day",   // Trip already exists on calendar day
  "duplicate_trip",      // Same trip hash/pairing (potential re-import)
] as const;
export type TripConflictType = (typeof tripConflictTypeValues)[number];

// Summary of a conflicting trip
export const conflictTripSummarySchema = z.object({
  tripId: z.string(),
  tripNumber: z.string().nullable(),
  pairingId: z.string().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  totalCreditMinutes: z.number(),
  dutyDaysCount: z.number(),
  legCount: z.number(),
  routeHighlights: z.string(), // e.g., "SDF-ORD-LAX-SDF"
  isOverride: z.boolean().optional(),
});
export type ConflictTripSummary = z.infer<typeof conflictTripSummarySchema>;

// A detected conflict
export const tripConflictSchema = z.object({
  conflictType: z.enum(tripConflictTypeValues),
  existingTrip: conflictTripSummarySchema,
  overlappingDates: z.array(z.string()), // Specific dates that overlap
  severityScore: z.number(), // 0-100, higher = more severe
});
export type TripConflict = z.infer<typeof tripConflictSchema>;

// POST /api/schedule/check-conflicts - Check for conflicts before import
export const checkConflictsRequestSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  tripNumber: z.string().optional(),
  pairingId: z.string().optional(),
  dutyDates: z.array(z.string()).optional(), // Specific duty day dates
  // For precise time-based conflict detection
  dutyTimes: z.array(z.object({
    date: z.string(),
    reportTimeISO: z.string().optional(),
    releaseTimeISO: z.string().optional(),
  })).optional(),
  // For accurate newTripSummary display (not "Pending")
  totalCreditMinutes: z.number().optional(),
  totalBlockMinutes: z.number().optional(),
  legCount: z.number().optional(),
  routeHighlights: z.string().optional(),
});
export type CheckConflictsRequest = z.infer<typeof checkConflictsRequestSchema>;

export const checkConflictsResponseSchema = z.object({
  hasConflicts: z.boolean(),
  conflicts: z.array(tripConflictSchema),
  newTripSummary: conflictTripSummarySchema,
  recommendedAction: z.enum(conflictDecisionValues).nullable(),
  // Additional info for UX
  conflictTier: z.enum(["hard_duplicate", "hard_time_overlap", "soft_same_day", "none"]).optional(),
  overlapSummary: z.string().optional(), // e.g., "Overlaps on Jan 11 by 2h 30m"
});
export type CheckConflictsResponse = z.infer<typeof checkConflictsResponseSchema>;

// POST /api/schedule/resolve-conflict - Resolve a conflict and proceed
export const resolveConflictRequestSchema = z.object({
  decision: z.enum(conflictDecisionValues),
  conflictingTripIds: z.array(z.string()),
  newTripData: z.any(), // Parsed trip data to import
  acknowledgmentNote: z.string().optional(),
  // For "replace_trip" decision: what happened to the original trip?
  replaceTripReason: z.enum([
    "dropped_traded",      // Dropped / Traded Away (default)
    "company_pulled",      // Company pulled it
    "not_sure",            // Not sure (save both for review)
  ]).optional(),
});
export type ResolveConflictRequest = z.infer<typeof resolveConflictRequestSchema>;

export const resolveConflictResponseSchema = z.object({
  success: z.boolean(),
  tripId: z.string().nullable(), // ID of created/updated trip
  deletedTripIds: z.array(z.string()),
  archivedTripIds: z.array(z.string()).optional(), // Trips archived (not deleted)
  isOverride: z.boolean(),
  auditRecordId: z.string().nullable(),
  // For company_revision - protected credit info
  protectedCreditResult: z.object({
    oldCreditMinutes: z.number(),
    newCreditMinutes: z.number(),
    protectedCreditMinutes: z.number(), // max(old, new)
    changedDutyDays: z.array(z.string()), // Dates of affected duty days
  }).optional(),
});
export type ResolveConflictResponse = z.infer<typeof resolveConflictResponseSchema>;

// ============================================
// PHASE 3: UPLOAD MODEL - Schedule Upload History
// ============================================

export const uploadSourceTypeValues = ["crew_access", "trip_board"] as const;
export type UploadSourceType = (typeof uploadSourceTypeValues)[number];

export const uploadSchema = z.object({
  id: z.string(),
  userId: z.string(),
  sourceType: z.string(), // "crew_access" | "trip_board"
  imageUrl: z.string(),
  imageHash: z.string().nullable(),
  uploadedAt: z.string(),
  parseResultJson: z.string(),
  parseConfidence: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Related trip IDs
  tripIds: z.array(z.string()).optional(),
});
export type Upload = z.infer<typeof uploadSchema>;

// GET /api/uploads - List uploads for a trip
export const getUploadsRequestSchema = z.object({
  tripId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
export type GetUploadsRequest = z.infer<typeof getUploadsRequestSchema>;

export const getUploadsResponseSchema = z.object({
  uploads: z.array(uploadSchema),
});
export type GetUploadsResponse = z.infer<typeof getUploadsResponseSchema>;

// ============================================
// PHASE 3: LOG EVENT MODEL - Premium & Documentation with Leg Linking
// ============================================

export const logEventTypeValues = [
  "schedule_change",
  "reassignment",
  "premium",
  "pay_protection",
  "duty_extension",
  "late_arrival",
  "other",
] as const;
export type LogEventType = (typeof logEventTypeValues)[number];

export const logEventStatusValues = ["draft", "saved", "exported"] as const;
export type LogEventStatus = (typeof logEventStatusValues)[number];

// Linked leg summary (for list views)
export const logEventLegSummarySchema = z.object({
  id: z.string(),
  flightNumber: z.string().nullable(),
  origin: z.string().nullable(),
  destination: z.string().nullable(),
  isDeadhead: z.boolean(),
  dutyDate: z.string(),
  dutyDayIndex: z.number(),
  isPrimary: z.boolean(),
  changeSummary: z.any().nullable(), // JSON object
});
export type LogEventLegSummary = z.infer<typeof logEventLegSummarySchema>;

// Log event attachment
export const logEventAttachmentSchema = z.object({
  id: z.string(),
  uploadId: z.string().nullable(),
  attachmentUrl: z.string().nullable(),
  attachmentType: z.string(),
  description: z.string().nullable(),
});
export type LogEventAttachment = z.infer<typeof logEventAttachmentSchema>;

export const logEventSchema = z.object({
  id: z.string(),
  userId: z.string(),
  tripId: z.string(),
  eventType: z.string(),
  premiumCode: z.string().nullable(),
  premiumMinutesDelta: z.number().nullable(),
  premiumMultiplier: z.number().nullable(),
  notes: z.string().nullable(),
  autoGeneratedNotes: z.string().nullable(),
  changeSummaryJson: z.string().nullable(), // JSON: { before, after, changes }
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Related data
  attachments: z.array(logEventAttachmentSchema).optional(),
  linkedLegs: z.array(logEventLegSummarySchema).optional(),
});
export type LogEvent = z.infer<typeof logEventSchema>;

// Log Event in list view (with headline and leg summaries)
export const logEventListItemSchema = z.object({
  id: z.string(),
  tripId: z.string(),
  tripNumber: z.string().nullable(),
  pairingId: z.string().nullable(),
  tripDates: z.string().nullable(),
  eventType: z.string(),
  premiumCode: z.string().nullable(),
  premiumMinutesDelta: z.number().nullable(),
  premiumMultiplier: z.number().nullable(),
  notes: z.string().nullable(),
  autoGeneratedNotes: z.string().nullable(),
  changeSummary: z.any().nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  primaryLeg: logEventLegSummarySchema.nullable(),
  legs: z.array(logEventLegSummarySchema),
  legCount: z.number(),
  attachmentCount: z.number(),
  headline: z.string(), // e.g., "MCO–RFD • FLT 5903 • Jan 15"
});
export type LogEventListItem = z.infer<typeof logEventListItemSchema>;

// Log Event leg detail (for single event view)
export const logEventLegDetailSchema = z.object({
  id: z.string(),
  linkId: z.string(),
  isPrimary: z.boolean(),
  flightNumber: z.string().nullable(),
  origin: z.string().nullable(),
  destination: z.string().nullable(),
  equipment: z.string().nullable(),
  isDeadhead: z.boolean(),
  scheduledOutISO: z.string().nullable(),
  scheduledInISO: z.string().nullable(),
  actualOutISO: z.string().nullable(),
  actualInISO: z.string().nullable(),
  plannedBlockMinutes: z.number(),
  actualBlockMinutes: z.number(),
  creditMinutes: z.number(),
  premiumCode: z.string().nullable(),
  premiumAmountCents: z.number(),
  dutyDayId: z.string(),
  dutyDate: z.string(),
  dutyDayIndex: z.number(),
  dutyReportTime: z.string().nullable(),
  dutyReleaseTime: z.string().nullable(),
  dutyCreditMinutes: z.number(),
  changeSummary: z.any().nullable(),
});
export type LogEventLegDetail = z.infer<typeof logEventLegDetailSchema>;

// GET /api/log-events - List log events for a trip
export const getLogEventsRequestSchema = z.object({
  tripId: z.string().optional(),
  eventType: z.string().optional(),
  status: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});
export type GetLogEventsRequest = z.infer<typeof getLogEventsRequestSchema>;

export const getLogEventsResponseSchema = z.object({
  events: z.array(logEventListItemSchema),
  total: z.number(),
  hasMore: z.boolean(),
});
export type GetLogEventsResponse = z.infer<typeof getLogEventsResponseSchema>;

// GET /api/log-events/:id - Get single log event
export const getLogEventResponseSchema = z.object({
  event: z.object({
    id: z.string(),
    tripId: z.string(),
    eventType: z.string(),
    premiumCode: z.string().nullable(),
    premiumMinutesDelta: z.number().nullable(),
    premiumMultiplier: z.number().nullable(),
    notes: z.string().nullable(),
    autoGeneratedNotes: z.string().nullable(),
    changeSummary: z.any().nullable(),
    status: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  trip: z.object({
    id: z.string(),
    tripNumber: z.string().nullable(),
    pairingId: z.string().nullable(),
    startDate: z.string(),
    endDate: z.string(),
    totalCreditMinutes: z.number(),
    protectedCreditMinutes: z.number(),
    currentCreditMinutes: z.number(),
  }).nullable(),
  legs: z.array(logEventLegDetailSchema),
  attachments: z.array(z.object({
    id: z.string(),
    url: z.string().nullable(),
    type: z.string(),
    description: z.string().nullable(),
    createdAt: z.string(),
  })),
});
export type GetLogEventResponse = z.infer<typeof getLogEventResponseSchema>;

// POST /api/log-events - Create a log event
export const createLogEventRequestSchema = z.object({
  tripId: z.string(),
  eventType: z.string(),
  premiumCode: z.string().optional(),
  premiumMinutesDelta: z.number().optional(),
  premiumMultiplier: z.number().optional(),
  notes: z.string().optional(),
  autoGeneratedNotes: z.string().optional(),
  changeSummary: z.any().optional(),
  status: z.enum(logEventStatusValues).optional(),
  // Leg linking
  legIds: z.array(z.string()).optional(),
  primaryLegId: z.string().optional(),
  legChangeSummaries: z.record(z.string(), z.any()).optional(),
  // Attachments
  attachmentUrls: z.array(z.string()).optional(),
  attachmentUploadIds: z.array(z.string()).optional(),
});
export type CreateLogEventRequest = z.infer<typeof createLogEventRequestSchema>;

export const createLogEventResponseSchema = z.object({
  success: z.boolean(),
  event: z.object({
    id: z.string(),
    tripId: z.string(),
    eventType: z.string(),
    premiumCode: z.string().nullable(),
    premiumMinutesDelta: z.number().nullable(),
    status: z.string(),
    createdAt: z.string(),
    legCount: z.number(),
    attachmentCount: z.number(),
  }),
});
export type CreateLogEventResponse = z.infer<typeof createLogEventResponseSchema>;

// POST /api/log-events/from-change - Create from schedule change
export const createLogEventFromChangeRequestSchema = z.object({
  tripId: z.string(),
  dutyDayId: z.string().optional(),
  changeType: z.string(),
  before: z.any(),
  after: z.any(),
  legIds: z.array(z.string()).optional(),
  primaryLegId: z.string().optional(),
  attachmentUrls: z.array(z.string()).optional(),
});
export type CreateLogEventFromChangeRequest = z.infer<typeof createLogEventFromChangeRequestSchema>;

// Simple premium suggestion (for auto-suggestions)
export const simplePremiumSuggestionSchema = z.object({
  code: z.string(),
  name: z.string(),
  minutes: z.number(),
  confidence: z.string(),
});
export type SimplePremiumSuggestion = z.infer<typeof simplePremiumSuggestionSchema>;

export const createLogEventFromChangeResponseSchema = z.object({
  success: z.boolean(),
  event: z.object({
    id: z.string(),
    tripId: z.string(),
    eventType: z.string(),
    premiumCode: z.string().nullable(),
    premiumMinutesDelta: z.number().nullable(),
    autoGeneratedNotes: z.string().nullable(),
    status: z.string(),
    createdAt: z.string(),
  }),
  premiumSuggestions: z.array(simplePremiumSuggestionSchema),
  changes: z.array(z.string()),
});
export type CreateLogEventFromChangeResponse = z.infer<typeof createLogEventFromChangeResponseSchema>;

// PUT /api/log-events/:id - Update a log event
export const updateLogEventRequestSchema = z.object({
  eventType: z.string().optional(),
  premiumCode: z.string().nullable().optional(),
  premiumMinutesDelta: z.number().nullable().optional(),
  premiumMultiplier: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  changeSummary: z.any().optional(),
  status: z.enum(logEventStatusValues).optional(),
});
export type UpdateLogEventRequest = z.infer<typeof updateLogEventRequestSchema>;

export const updateLogEventResponseSchema = z.object({
  success: z.boolean(),
  event: z.object({
    id: z.string(),
    tripId: z.string(),
    eventType: z.string(),
    premiumCode: z.string().nullable(),
    premiumMinutesDelta: z.number().nullable(),
    status: z.string(),
    updatedAt: z.string(),
  }),
});
export type UpdateLogEventResponse = z.infer<typeof updateLogEventResponseSchema>;

// DELETE /api/log-events/:id
export const deleteLogEventResponseSchema = z.object({
  success: z.boolean(),
});
export type DeleteLogEventResponse = z.infer<typeof deleteLogEventResponseSchema>;

// POST /api/log-events/:id/legs - Link legs
export const linkLegsToLogEventRequestSchema = z.object({
  legIds: z.array(z.string()),
  primaryLegId: z.string().optional(),
  changeSummaries: z.record(z.string(), z.any()).optional(),
});
export type LinkLegsToLogEventRequest = z.infer<typeof linkLegsToLogEventRequestSchema>;

export const linkLegsToLogEventResponseSchema = z.object({
  success: z.boolean(),
  linkedCount: z.number(),
});
export type LinkLegsToLogEventResponse = z.infer<typeof linkLegsToLogEventResponseSchema>;

// GET /api/log-events/summary/by-trip/:tripId - Get trip premium summary
export const getTripLogEventSummaryResponseSchema = z.object({
  tripId: z.string(),
  tripNumber: z.string().nullable(),
  baseCreditMinutes: z.number(),
  totalPremiumMinutes: z.number(),
  totalCreditWithPremiums: z.number(),
  eventCount: z.number(),
  premiumsByCode: z.array(z.object({
    code: z.string(),
    count: z.number(),
    totalMinutes: z.number(),
    formatted: z.string(),
  })),
  premiumsByLeg: z.array(z.object({
    legId: z.string(),
    origin: z.string(),
    destination: z.string(),
    flightNumber: z.string().nullable(),
    premiumCode: z.string(),
    premiumMinutes: z.number(),
  })),
});
export type GetTripLogEventSummaryResponse = z.infer<typeof getTripLogEventSummaryResponseSchema>;

// GET /api/log-events/premium-suggestions/:changeType
export const getSimplePremiumSuggestionsResponseSchema = z.object({
  suggestions: z.array(simplePremiumSuggestionSchema),
});
export type GetSimplePremiumSuggestionsResponse = z.infer<typeof getSimplePremiumSuggestionsResponseSchema>;

// ============================================
// PHASE 3: ROSTER SNAPSHOT - Trip Snapshot Data
// ============================================

export const legSnapshotSchema = z.object({
  legIndex: z.number(),
  flightNumber: z.string().optional(),
  origin: z.string().optional(),
  destination: z.string().optional(),
  equipment: z.string().optional(),
  isDeadhead: z.boolean(),
  scheduledOutISO: z.string().optional(),
  scheduledInISO: z.string().optional(),
  blockMinutes: z.number(),
  creditMinutes: z.number(),
});
export type LegSnapshot = z.infer<typeof legSnapshotSchema>;

export const layoverSnapshotSchema = z.object({
  station: z.string(),
  restMinutes: z.number(),
  hotelName: z.string().optional(),
});
export type LayoverSnapshot = z.infer<typeof layoverSnapshotSchema>;

export const dutyDaySnapshotSchema = z.object({
  dayIndex: z.number(),
  dutyDate: z.string(),
  reportTimeISO: z.string().optional(),
  releaseTimeISO: z.string().optional(),
  creditMinutes: z.number(),
  blockMinutes: z.number(),
  legs: z.array(legSnapshotSchema),
  layover: layoverSnapshotSchema.optional(),
});
export type DutyDaySnapshot = z.infer<typeof dutyDaySnapshotSchema>;

export const rosterSnapshotDataSchema = z.object({
  dutyDays: z.array(dutyDaySnapshotSchema),
  totalCreditMinutes: z.number(),
  totalBlockMinutes: z.number(),
  totalTafbMinutes: z.number(),
  legCount: z.number(),
  dutyDaysCount: z.number(),
});
export type RosterSnapshotData = z.infer<typeof rosterSnapshotDataSchema>;

// ============================================
// PHASE 3: TRIP CHANGE SEVERITY (for roster changes)
// ============================================
// Note: This extends the existing ChangeSeverity with trip-specific values
// Uses different name to avoid conflict with existing changeSeverityValues

export const tripChangeSeverityValues = ["none", "minor", "moderate_ack", "major_ack"] as const;
export type TripChangeSeverity = (typeof tripChangeSeverityValues)[number];

// ============================================
// PHASE 1: UPS PREMIUM CODE LIBRARY (SINGLE SOURCE OF TRUTH)
// ============================================

// Premium Code Categories
export const premiumCodeCategoryValues = [
  "reassignment",      // AP codes
  "reserve",           // Reserve-related premiums
  "schedule_revision", // LRP, timing changes
  "grievance",         // GT1, etc.
  "soft_max",          // APE, exceeding limits
  "late_arrival",      // LP1, LP2, RJA
  "other",             // Misc premiums
] as const;
export type PremiumCodeCategory = (typeof premiumCodeCategoryValues)[number];

// Premium Type (how premium is calculated)
export const premiumCodeTypeValues = [
  "minutes",     // Fixed credit addition (e.g., +2:00)
  "multiplier",  // Percentage-based (e.g., 1.5x)
  "manual",      // Requires user input (complex rules)
] as const;
export type PremiumCodeType = (typeof premiumCodeTypeValues)[number];

// Premium Variant Schema
export const premiumVariantSchema = z.object({
  variant_key: z.string(),
  label: z.string(),
  premium_type: z.enum(premiumCodeTypeValues),
  premium_minutes: z.number().optional(),
  premium_multiplier: z.number().optional(),
  notes: z.string().optional(),
});
export type PremiumVariant = z.infer<typeof premiumVariantSchema>;

// Premium Code Schema (matches DB model)
export const premiumCodeSchema = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.enum(premiumCodeCategoryValues),
  premiumType: z.enum(premiumCodeTypeValues),
  premiumMinutes: z.number().nullable(),
  premiumMultiplier: z.number().nullable(),
  eligibility: z.string().nullable(),
  tripType: z.string().nullable(),
  contractRef: z.string().nullable(),
  notes: z.string().nullable(),
  variantsJson: z.string().nullable(), // JSON string of PremiumVariant[]
  hasVariants: z.boolean(),
  requiresInputsJson: z.string().nullable(), // JSON string of string[]
  isActive: z.boolean(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PremiumCode = z.infer<typeof premiumCodeSchema>;

// GET /api/premium-codes - List all premium codes
export const getPremiumCodesRequestSchema = z.object({
  category: z.enum(premiumCodeCategoryValues).optional(),
  type: z.enum(premiumCodeTypeValues).optional(),
});
export type GetPremiumCodesRequest = z.infer<typeof getPremiumCodesRequestSchema>;

export const getPremiumCodesResponseSchema = z.object({
  premiumCodes: z.array(premiumCodeSchema),
});
export type GetPremiumCodesResponse = z.infer<typeof getPremiumCodesResponseSchema>;

// GET /api/premium-codes/:code - Get single premium code
export const getPremiumCodeResponseSchema = z.object({
  premiumCode: premiumCodeSchema,
});
export type GetPremiumCodeResponse = z.infer<typeof getPremiumCodeResponseSchema>;

// POST /api/premium-codes/calculate - Calculate premium pay
export const calculatePremiumRequestSchema = z.object({
  code: z.string(),
  hourlyRateCents: z.number(),
  customMinutes: z.number().optional(),
  scheduledEndISO: z.string().optional(),
  actualArrivalISO: z.string().optional(),
  useVariant: z.boolean().optional(),
});
export type CalculatePremiumRequest = z.infer<typeof calculatePremiumRequestSchema>;

export const calculatePremiumResponseSchema = z.object({
  code: z.string(),
  title: z.string(),
  name: z.string().optional(),
  premiumType: z.string(),
  premiumMinutes: z.number().optional(),
  premiumPayCents: z.number().optional(),
  formattedPremium: z.string().optional(),
  formattedPay: z.string().optional(),
  multiplier: z.number().optional(),
  lateMinutes: z.number().optional(),
  formattedLateTime: z.string().optional(),
  basePayCents: z.number().optional(),
  totalPayCents: z.number().optional(),
  formattedBasePay: z.string().optional(),
  formattedPremiumPay: z.string().optional(),
  formattedTotalPay: z.string().optional(),
  requiresInputs: z.array(z.string()).optional(),
  message: z.string().optional(),
  contractRef: z.string().nullable(),
  notes: z.string().nullable(),
});
export type CalculatePremiumResponse = z.infer<typeof calculatePremiumResponseSchema>;

// POST /api/premium-codes/suggest - Auto-suggest premiums
export const suggestPremiumsRequestSchema = z.object({
  changeType: z.string(),
  context: z.object({
    tripId: z.string().optional(),
    originalLayoverMinutes: z.number().optional(),
    newLayoverMinutes: z.number().optional(),
    legsAdded: z.number().optional(),
    legsRemoved: z.number().optional(),
    scheduledEndISO: z.string().optional(),
    actualArrivalISO: z.string().optional(),
    hourlyRateCents: z.number().optional(),
  }).optional(),
});
export type SuggestPremiumsRequest = z.infer<typeof suggestPremiumsRequestSchema>;

export const premiumSuggestionSchema = z.object({
  code: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  premiumType: z.string(),
  premiumMinutes: z.number().nullable(),
  premiumMultiplier: z.number().nullable(),
  eligibility: z.string().nullable(),
  tripType: z.string().nullable(),
  contractRef: z.string().nullable(),
  notes: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string(),
  estimatedPayCents: z.number().optional(),
});
export type PremiumSuggestion = z.infer<typeof premiumSuggestionSchema>;

export const suggestPremiumsResponseSchema = z.object({
  changeType: z.string(),
  suggestions: z.array(premiumSuggestionSchema),
  suggestedCount: z.number(),
});
export type SuggestPremiumsResponse = z.infer<typeof suggestPremiumsResponseSchema>;

// Category Display Names (for UI)
export const PREMIUM_CATEGORY_DISPLAY_NAMES: Record<PremiumCodeCategory, string> = {
  reassignment: "Reassignment (AP)",
  reserve: "Reserve",
  schedule_revision: "Schedule Revision",
  grievance: "Grievance",
  soft_max: "Soft Max",
  late_arrival: "Late Arrival",
  other: "Other",
};

// Helper: Format premium result for display
export function formatPremiumDisplay(code: {
  premiumType: PremiumCodeType;
  premiumMinutes?: number | null;
  premiumMultiplier?: number | null;
}): string {
  if (code.premiumType === "minutes" && code.premiumMinutes) {
    const hours = Math.floor(code.premiumMinutes / 60);
    const mins = code.premiumMinutes % 60;
    return `+${hours}:${mins.toString().padStart(2, "0")}`;
  }
  if (code.premiumType === "multiplier" && code.premiumMultiplier) {
    return `${Math.round(code.premiumMultiplier * 100)}%`;
  }
  return "Manual";
}

// ============================================
// NOTIFICATION SETTINGS
// ============================================

// Quiet Hours Action Values
export const quietHoursActionValues = ["delay", "skip"] as const;
export type QuietHoursAction = (typeof quietHoursActionValues)[number];

// User Notification Settings Schema
export const userNotificationSettingsSchema = z.object({
  id: z.string(),
  userId: z.string(),

  // Push Permission Status
  pushPermissionGranted: z.boolean(),
  pushPermissionAskedAt: z.string().nullable(),
  expoPushToken: z.string().nullable(),

  // Report Time Reminders
  reportTimeReminderEnabled: z.boolean(),
  reportTimeLeadMinutes: z.number(),

  // Pay Period Ending Reminder
  payPeriodEndingEnabled: z.boolean(),
  payPeriodEndingHours48: z.boolean(),
  payPeriodEndingHours24: z.boolean(),

  // Payday Reminders
  paydayReminderEnabled: z.boolean(),
  paydayReminder2DaysBefore: z.boolean(),
  paydayReminder1DayBefore: z.boolean(),
  paydayReminderMorningOf: z.boolean(),

  // Arrival Welcome
  arrivalWelcomeEnabled: z.boolean(),
  arrivalHighConfidenceOnly: z.boolean(),

  // Pay Statement Ready
  payStatementReadyEnabled: z.boolean(),

  // Quiet Hours
  quietHoursEnabled: z.boolean(),
  quietHoursStart: z.string(),
  quietHoursEnd: z.string(),
  quietHoursAction: z.enum(quietHoursActionValues),

  // Global Settings
  highConfidenceOnly: z.boolean(),

  // Timestamps
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type UserNotificationSettings = z.infer<typeof userNotificationSettingsSchema>;

// GET /api/notifications/settings - Get notification settings
export const getNotificationSettingsResponseSchema = z.object({
  settings: userNotificationSettingsSchema,
});
export type GetNotificationSettingsResponse = z.infer<typeof getNotificationSettingsResponseSchema>;

// PUT /api/notifications/settings - Update notification settings
export const updateNotificationSettingsRequestSchema = z.object({
  // Push Permission Status
  pushPermissionGranted: z.boolean().optional(),
  expoPushToken: z.string().nullable().optional(),

  // Report Time Reminders
  reportTimeReminderEnabled: z.boolean().optional(),
  reportTimeLeadMinutes: z.number().optional(),

  // Pay Period Ending Reminder
  payPeriodEndingEnabled: z.boolean().optional(),
  payPeriodEndingHours48: z.boolean().optional(),
  payPeriodEndingHours24: z.boolean().optional(),

  // Payday Reminders
  paydayReminderEnabled: z.boolean().optional(),
  paydayReminder2DaysBefore: z.boolean().optional(),
  paydayReminder1DayBefore: z.boolean().optional(),
  paydayReminderMorningOf: z.boolean().optional(),

  // Arrival Welcome
  arrivalWelcomeEnabled: z.boolean().optional(),
  arrivalHighConfidenceOnly: z.boolean().optional(),

  // Pay Statement Ready
  payStatementReadyEnabled: z.boolean().optional(),

  // Quiet Hours
  quietHoursEnabled: z.boolean().optional(),
  quietHoursStart: z.string().optional(),
  quietHoursEnd: z.string().optional(),
  quietHoursAction: z.enum(quietHoursActionValues).optional(),

  // Global Settings
  highConfidenceOnly: z.boolean().optional(),
});
export type UpdateNotificationSettingsRequest = z.infer<typeof updateNotificationSettingsRequestSchema>;

export const updateNotificationSettingsResponseSchema = z.object({
  success: z.boolean(),
  settings: userNotificationSettingsSchema,
});
export type UpdateNotificationSettingsResponse = z.infer<typeof updateNotificationSettingsResponseSchema>;

// POST /api/notifications/test - Send a test notification
export const sendTestNotificationRequestSchema = z.object({
  type: z.enum(["report_time", "pay_period_ending", "payday", "arrival_welcome", "pay_statement_ready"]).optional(),
});
export type SendTestNotificationRequest = z.infer<typeof sendTestNotificationRequestSchema>;

export const sendTestNotificationResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});
export type SendTestNotificationResponse = z.infer<typeof sendTestNotificationResponseSchema>;

// POST /api/notifications/schedule - Schedule notifications for trips
export const scheduleNotificationsResponseSchema = z.object({
  success: z.boolean(),
  scheduledCount: z.number(),
  message: z.string(),
});
export type ScheduleNotificationsResponse = z.infer<typeof scheduleNotificationsResponseSchema>;

// GET /api/notifications/scheduled - Get scheduled notifications
export const scheduledNotificationSchema = z.object({
  id: z.string(),
  notificationType: z.string(),
  scheduledFor: z.string(),
  title: z.string(),
  body: z.string(),
  tripId: z.string().nullable(),
  status: z.string(),
  isInternational: z.boolean(),
});
export type ScheduledNotification = z.infer<typeof scheduledNotificationSchema>;

export const getScheduledNotificationsResponseSchema = z.object({
  notifications: z.array(scheduledNotificationSchema),
  totalCount: z.number(),
});
export type GetScheduledNotificationsResponse = z.infer<typeof getScheduledNotificationsResponseSchema>;

// ============================================
// RESERVE/STANDBY SCHEDULE SUPPORT (Phase 1)
// ============================================

// Schedule Types
export const reserveScheduleTypeValues = ["RSVA", "RSVB", "RSVC", "RSVD", "HOT", "LCO", "RCID", "TRNG"] as const;
export type ReserveScheduleType = (typeof reserveScheduleTypeValues)[number];

// RSV types specifically (for credit lock rules)
export const rsvScheduleTypeValues = ["RSVA", "RSVB", "RSVC", "RSVD"] as const;
export type RSVScheduleType = (typeof rsvScheduleTypeValues)[number];

// Domicile values
export const domicileValues = ["SDF", "MIA", "ONT", "ANC"] as const;
export type Domicile = (typeof domicileValues)[number];

// Activation status
export const activationStatusValues = ["UNACTIVATED", "PARTIAL", "ACTIVATED"] as const;
export type ActivationStatus = (typeof activationStatusValues)[number];

// Reserve Window Configuration (exact times per domicile/schedule type)
export const reserveWindowConfigSchema = z.object({
  domicile: z.enum(domicileValues),
  scheduleType: z.enum(rsvScheduleTypeValues),
  windowStart: z.string(), // HHmm format (e.g., "2400", "0730")
  windowEnd: z.string(),   // HHmm format (e.g., "1159", "1929")
});
export type ReserveWindowConfig = z.infer<typeof reserveWindowConfigSchema>;

// Domicile-specific reserve windows (EXACT from spec)
// SDF & MIA:
//   RSVA: 2400–1159, RSVB: 1200–2359, RSVC: 1600–0359, RSVD: 0400–1559
// ONT:
//   RSVA: 2300–1059, RSVB: 1200–2359, RSVC: 1559–0358, RSVD: 0400–1559
// ANC:
//   RSVA: 0730–1929, RSVB: 0300–1459, RSVC: 2015–0814, RSVD: 1545–0344
export const RESERVE_WINDOW_CONFIGS: ReserveWindowConfig[] = [
  // SDF
  { domicile: "SDF", scheduleType: "RSVA", windowStart: "2400", windowEnd: "1159" },
  { domicile: "SDF", scheduleType: "RSVB", windowStart: "1200", windowEnd: "2359" },
  { domicile: "SDF", scheduleType: "RSVC", windowStart: "1600", windowEnd: "0359" },
  { domicile: "SDF", scheduleType: "RSVD", windowStart: "0400", windowEnd: "1559" },
  // MIA (same as SDF)
  { domicile: "MIA", scheduleType: "RSVA", windowStart: "2400", windowEnd: "1159" },
  { domicile: "MIA", scheduleType: "RSVB", windowStart: "1200", windowEnd: "2359" },
  { domicile: "MIA", scheduleType: "RSVC", windowStart: "1600", windowEnd: "0359" },
  { domicile: "MIA", scheduleType: "RSVD", windowStart: "0400", windowEnd: "1559" },
  // ONT
  { domicile: "ONT", scheduleType: "RSVA", windowStart: "2300", windowEnd: "1059" },
  { domicile: "ONT", scheduleType: "RSVB", windowStart: "1200", windowEnd: "2359" },
  { domicile: "ONT", scheduleType: "RSVC", windowStart: "1559", windowEnd: "0358" },
  { domicile: "ONT", scheduleType: "RSVD", windowStart: "0400", windowEnd: "1559" },
  // ANC
  { domicile: "ANC", scheduleType: "RSVA", windowStart: "0730", windowEnd: "1929" },
  { domicile: "ANC", scheduleType: "RSVB", windowStart: "0300", windowEnd: "1459" },
  { domicile: "ANC", scheduleType: "RSVC", windowStart: "2015", windowEnd: "0814" },
  { domicile: "ANC", scheduleType: "RSVD", windowStart: "1545", windowEnd: "0344" },
];

// Report-for-duty rules (in minutes)
// RSV: SDF = 90 min, others = 120 min
// LCO: 960 min (16 hours)
export const REPORT_FOR_DUTY_MINUTES = {
  RSV_SDF: 90,        // 1.5 hours for SDF reserve
  RSV_OTHER: 120,     // 2 hours for non-SDF reserve
  LCO: 960,           // 16 hours for long call out
} as const;

// Helper to get report-for-duty minutes for RSV
export function getReportForDutyMinutes(scheduleType: ReserveScheduleType, domicile: string): number | null {
  if (["RSVA", "RSVB", "RSVC", "RSVD"].includes(scheduleType)) {
    return domicile === "SDF" ? REPORT_FOR_DUTY_MINUTES.RSV_SDF : REPORT_FOR_DUTY_MINUTES.RSV_OTHER;
  }
  if (scheduleType === "LCO") {
    return REPORT_FOR_DUTY_MINUTES.LCO;
  }
  // HOT, RCID, TRNG - null unless explicitly defined
  return null;
}

// Helper to check if schedule type should have credit locked
export function shouldCreditBeLocked(scheduleType: ReserveScheduleType): boolean {
  // RSV*, HOT, LCO, RCID all have credit locked
  return ["RSVA", "RSVB", "RSVC", "RSVD", "HOT", "LCO", "RCID"].includes(scheduleType);
}

// Activation Leg Schema
export const activationLegSchema = z.object({
  id: z.string(),
  reserveScheduleEventId: z.string(),
  flightNumber: z.string().nullable(),
  origin: z.string(),
  destination: z.string(),
  depDtLocal: z.string(),
  arrDtLocal: z.string(),
  blockMinutes: z.number(),
  actualOutISO: z.string().nullable(),
  actualOffISO: z.string().nullable(),
  actualOnISO: z.string().nullable(),
  actualInISO: z.string().nullable(),
  equipment: z.string().nullable(),
  tailNumber: z.string().nullable(),
  isDeadhead: z.boolean(),
  legIndex: z.number(),
  sourceUploadId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ActivationLeg = z.infer<typeof activationLegSchema>;

// Reserve Schedule Event Schema
export const reserveScheduleEventSchema = z.object({
  id: z.string(),
  userId: z.string(),
  scheduleType: z.enum(reserveScheduleTypeValues),
  domicile: z.string(),
  startDtLocal: z.string(),
  endDtLocal: z.string(),
  windowStartLocal: z.string().nullable(),
  windowEndLocal: z.string().nullable(),
  reportForDutyMinutes: z.number().nullable(),
  creditHours: z.number(),
  blockHours: z.number(),
  creditLocked: z.boolean(),
  activationStatus: z.enum(activationStatusValues),
  tripId: z.string().nullable(),
  sourceUploadId: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Relations (optional in response)
  activationLegs: z.array(activationLegSchema).optional(),
});
export type ReserveScheduleEvent = z.infer<typeof reserveScheduleEventSchema>;

// GET /api/reserve-schedule - List reserve schedule events
export const getReserveScheduleRequestSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  scheduleType: z.enum(reserveScheduleTypeValues).optional(),
  activationStatus: z.enum(activationStatusValues).optional(),
  includeLegs: z.boolean().optional(),
});
export type GetReserveScheduleRequest = z.infer<typeof getReserveScheduleRequestSchema>;

export const getReserveScheduleResponseSchema = z.object({
  events: z.array(reserveScheduleEventSchema),
  totalCount: z.number(),
});
export type GetReserveScheduleResponse = z.infer<typeof getReserveScheduleResponseSchema>;

// GET /api/reserve-schedule/:id - Get single reserve schedule event
export const getReserveScheduleEventResponseSchema = z.object({
  event: reserveScheduleEventSchema,
});
export type GetReserveScheduleEventResponse = z.infer<typeof getReserveScheduleEventResponseSchema>;

// POST /api/reserve-schedule - Create reserve schedule event
export const createReserveScheduleRequestSchema = z.object({
  scheduleType: z.enum(reserveScheduleTypeValues),
  domicile: z.string(),
  startDtLocal: z.string(),
  endDtLocal: z.string(),
  creditHours: z.number(),
  notes: z.string().optional(),
  sourceUploadId: z.string().optional(),
});
export type CreateReserveScheduleRequest = z.infer<typeof createReserveScheduleRequestSchema>;

export const createReserveScheduleResponseSchema = z.object({
  success: z.boolean(),
  event: reserveScheduleEventSchema,
});
export type CreateReserveScheduleResponse = z.infer<typeof createReserveScheduleResponseSchema>;

// PUT /api/reserve-schedule/:id - Update reserve schedule event
// NOTE: creditHours can ONLY be updated if creditLocked = FALSE
export const updateReserveScheduleRequestSchema = z.object({
  domicile: z.string().optional(),
  startDtLocal: z.string().optional(),
  endDtLocal: z.string().optional(),
  creditHours: z.number().optional(), // Will be rejected if creditLocked = TRUE
  notes: z.string().optional(),
});
export type UpdateReserveScheduleRequest = z.infer<typeof updateReserveScheduleRequestSchema>;

export const updateReserveScheduleResponseSchema = z.object({
  success: z.boolean(),
  event: reserveScheduleEventSchema,
  creditLockViolation: z.boolean().optional(), // TRUE if credit update was blocked
});
export type UpdateReserveScheduleResponse = z.infer<typeof updateReserveScheduleResponseSchema>;

// DELETE /api/reserve-schedule/:id - Delete reserve schedule event
export const deleteReserveScheduleResponseSchema = z.object({
  success: z.boolean(),
});
export type DeleteReserveScheduleResponse = z.infer<typeof deleteReserveScheduleResponseSchema>;

// POST /api/reserve-schedule/:id/activate - Attach activation legs to RSV event
// This is the RSV activation matching endpoint
export const activateReserveScheduleRequestSchema = z.object({
  legs: z.array(z.object({
    flightNumber: z.string().optional(),
    origin: z.string(),
    destination: z.string(),
    depDtLocal: z.string(),
    arrDtLocal: z.string(),
    blockMinutes: z.number().optional(),
    equipment: z.string().optional(),
    tailNumber: z.string().optional(),
    isDeadhead: z.boolean().optional(),
    actualOutISO: z.string().optional(),
    actualOffISO: z.string().optional(),
    actualOnISO: z.string().optional(),
    actualInISO: z.string().optional(),
  })),
  sourceUploadId: z.string().optional(),
});
export type ActivateReserveScheduleRequest = z.infer<typeof activateReserveScheduleRequestSchema>;

export const activateReserveScheduleResponseSchema = z.object({
  success: z.boolean(),
  event: reserveScheduleEventSchema,
  legsAdded: z.number(),
  blockHoursUpdated: z.number(),
  creditLocked: z.boolean(), // Should always be TRUE for RSV
});
export type ActivateReserveScheduleResponse = z.infer<typeof activateReserveScheduleResponseSchema>;

// POST /api/reserve-schedule/match-activation - Match uploaded legs to existing RSV
// Used during import when flying legs overlap RSV dates
export const matchActivationRequestSchema = z.object({
  legs: z.array(z.object({
    flightNumber: z.string().optional(),
    origin: z.string(),
    destination: z.string(),
    depDtLocal: z.string(),
    arrDtLocal: z.string(),
    blockMinutes: z.number().optional(),
    equipment: z.string().optional(),
  })),
  sourceUploadId: z.string().optional(),
});
export type MatchActivationRequest = z.infer<typeof matchActivationRequestSchema>;

export const matchActivationResponseSchema = z.object({
  matched: z.boolean(),
  matchedEvent: reserveScheduleEventSchema.nullable(),
  reason: z.string(), // "date_overlap", "no_rsv_found", etc.
});
export type MatchActivationResponse = z.infer<typeof matchActivationResponseSchema>;

// Reserve Log Event Schema
export const reserveLogEventSchema = z.object({
  id: z.string(),
  userId: z.string(),
  reserveScheduleEventId: z.string(),
  eventType: z.string(),
  notes: z.string().nullable(),
  autoGeneratedNotes: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ReserveLogEvent = z.infer<typeof reserveLogEventSchema>;

// Credit Lock Audit Log Schema
export const creditLockAuditLogSchema = z.object({
  id: z.string(),
  userId: z.string(),
  reserveScheduleEventId: z.string(),
  attemptedCreditHours: z.number(),
  originalCreditHours: z.number(),
  actionTaken: z.string(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type CreditLockAuditLog = z.infer<typeof creditLockAuditLogSchema>;

// GET /api/reserve-schedule/audit-log - Get credit lock audit log
export const getCreditLockAuditLogResponseSchema = z.object({
  logs: z.array(creditLockAuditLogSchema),
  totalCount: z.number(),
});
export type GetCreditLockAuditLogResponse = z.infer<typeof getCreditLockAuditLogResponseSchema>;

// Schedule type display names
export const SCHEDULE_TYPE_DISPLAY_NAMES: Record<ReserveScheduleType, string> = {
  RSVA: "Reserve A",
  RSVB: "Reserve B",
  RSVC: "Reserve C",
  RSVD: "Reserve D",
  HOT: "Airport Standby (HOT)",
  LCO: "Long Call Out",
  RCID: "RCID",
  TRNG: "Training",
};

// Schedule type short names (for badges)
export const SCHEDULE_TYPE_SHORT_NAMES: Record<ReserveScheduleType, string> = {
  RSVA: "RSV-A",
  RSVB: "RSV-B",
  RSVC: "RSV-C",
  RSVD: "RSV-D",
  HOT: "HOT",
  LCO: "LCO",
  RCID: "RCID",
  TRNG: "TRNG",
};

// ============================================
// ANNUAL PAY PLANNER - Flagship PRO Feature
// Planning-grade, trust-first income simulator
// ============================================

// Planning mode enum - drives scenario calculations
export const planningModeValues = ["CONSERVATIVE", "BALANCED", "AGGRESSIVE"] as const;
export type PlanningMode = (typeof planningModeValues)[number];

// Feasibility rating - NEVER use enforcement language
export const feasibilityRatingValues = [
  "VERY_ACHIEVABLE",
  "ACHIEVABLE_WITH_EFFORT",
  "UNLIKELY_WITHOUT_SIGNIFICANT_CHANGE",
  "HIGHLY_UNLIKELY_UNDER_CURRENT_CONDITIONS",
] as const;
export type FeasibilityRating = (typeof feasibilityRatingValues)[number];

// Scenario type enum
export const scenarioTypeValues = ["CURRENT_PACE", "OPTIMIZED", "AGGRESSIVE"] as const;
export type ScenarioType = (typeof scenarioTypeValues)[number];

// Pay component breakdown
export const payComponentBreakdownSchema = z.object({
  basePay: z.number(), // cents
  premiumsContribution: z.number(), // cents
  reserveContribution: z.number(), // cents
  jaContribution: z.number(), // cents - only if JA enabled
  total: z.number(), // cents
});
export type PayComponentBreakdown = z.infer<typeof payComponentBreakdownSchema>;

// Scenario result
export const scenarioResultSchema = z.object({
  scenarioType: z.enum(scenarioTypeValues),
  scenarioName: z.string(), // "Current Pace", "Optimized", "Aggressive"

  // Projected hours
  projectedAnnualCreditHours: z.number(),
  projectedMonthlyAvgCreditHours: z.number(),
  projectedBidPeriodAvgCreditHours: z.number(),

  // Pay breakdown
  projectedAnnualPay: payComponentBreakdownSchema,

  // Delta vs target
  deltaVsTargetCents: z.number(), // positive = over target, negative = under
  percentOfTarget: z.number(), // 0-100+

  // Feasibility
  feasibilityRating: z.enum(feasibilityRatingValues),

  // Required delta (what needs to change)
  requiredExtraCreditHoursPerMonth: z.number(),
  requiredExtraCreditHoursPerBidPeriod: z.number(),

  // Explanation (plain English)
  explanation: z.string(),

  // What would need to change bullets
  whatWouldNeedToChange: z.array(z.string()),
});
export type ScenarioResult = z.infer<typeof scenarioResultSchema>;

// Baseline transparency info
export const baselineTransparencySchema = z.object({
  contractGuaranteeHoursPerMonth: z.number(), // 75 for UPS
  userAvgCreditHoursPerMonth: z.number(), // from historical
  userAvgCreditHoursPerBidPeriod: z.number(),
  plannerBaselineHoursPerMonth: z.number(), // max(75, avg)
  plannerBaselineHoursPerBidPeriod: z.number(),
  rollingWindowMonths: z.number(), // e.g., 12 months
  dataSource: z.string(), // "historical trips" or "no data - using guarantee"
});
export type BaselineTransparency = z.infer<typeof baselineTransparencySchema>;

// Historical averages used for calculations
export const historicalAveragesSchema = z.object({
  avgMonthlyCreditMinutes: z.number(),
  avgBidPeriodCreditMinutes: z.number(),
  avgPremiumCaptureCents: z.number(),
  reserveActivationFrequency: z.number(), // 0-1 fraction
  totalMonthsOfData: z.number(),
  ytdCreditMinutes: z.number(),
  ytdPayCents: z.number(),
});
export type HistoricalAverages = z.infer<typeof historicalAveragesSchema>;

// Annual Pay Planner input parameters
export const annualPayPlannerInputSchema = z.object({
  targetAnnualIncomeCents: z.number(), // required
  hourlyRateCents: z.number().optional(), // defaults to profile rate

  // Optional toggles
  includePremiums: z.boolean().default(true),
  includeReserveActivation: z.boolean().default(true),
  includeAverageSickUsage: z.boolean().default(true),
  includeJA150: z.boolean().default(false), // JA at 150% - NEVER default on

  // Planning mode
  planningMode: z.enum(planningModeValues).default("BALANCED"),

  // Interactive fidgets (live recompute)
  extraCreditHoursPerBidPeriod: z.number().optional(), // slider input
  captureCommonPremiums: z.boolean().optional(),
  heavyReserveYear: z.boolean().optional(),
  conservativeAssumptions: z.boolean().optional(),
  // Pilot's contract period type — drives baseline and period-length scaling
  periodType: z.enum(["BID_28", "BID_56", "PAY_35"]).optional().default("BID_56"),
});
export type AnnualPayPlannerInput = z.infer<typeof annualPayPlannerInputSchema>;

// POST /api/planner/annual - Calculate annual pay scenarios
export const calculateAnnualPlanRequestSchema = annualPayPlannerInputSchema;
export type CalculateAnnualPlanRequest = z.infer<typeof calculateAnnualPlanRequestSchema>;

export const calculateAnnualPlanResponseSchema = z.object({
  // Input echo
  targetAnnualIncomeCents: z.number(),
  hourlyRateCents: z.number(),
  currentYear: z.number(),
  asOfDate: z.string(),

  // Baseline transparency
  baseline: baselineTransparencySchema,

  // Historical data used
  historicalAverages: historicalAveragesSchema,

  // Three scenarios
  scenarios: z.array(scenarioResultSchema), // Current Pace, Optimized, Aggressive

  // Best-fit scenario (closest to target that's achievable)
  bestFitScenarioIndex: z.number(), // 0, 1, or 2

  // Settings used
  settingsUsed: z.object({
    includePremiums: z.boolean(),
    includeReserveActivation: z.boolean(),
    includeAverageSickUsage: z.boolean(),
    includeJA150: z.boolean(),
    planningMode: z.enum(planningModeValues),
  }),

  // Legal disclaimer (exact text)
  disclaimer: z.string(),
});
export type CalculateAnnualPlanResponse = z.infer<typeof calculateAnnualPlanResponseSchema>;

// Saved scenario model
export const savedPlannerScenarioSchema = z.object({
  id: z.string(),
  userId: z.string(),
  scenarioName: z.string(),
  targetAnnualIncomeCents: z.number(),
  scenarioType: z.enum(scenarioTypeValues),
  settings: z.object({
    includePremiums: z.boolean(),
    includeReserveActivation: z.boolean(),
    includeAverageSickUsage: z.boolean(),
    includeJA150: z.boolean(),
    planningMode: z.enum(planningModeValues),
  }),
  projectedAnnualPayCents: z.number(),
  feasibilityRating: z.enum(feasibilityRatingValues),
  savedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SavedPlannerScenario = z.infer<typeof savedPlannerScenarioSchema>;

// POST /api/planner/annual/save - Save a scenario
export const savePlannerScenarioRequestSchema = z.object({
  scenarioName: z.string(),
  targetAnnualIncomeCents: z.number(),
  scenarioType: z.enum(scenarioTypeValues),
  settings: z.object({
    includePremiums: z.boolean(),
    includeReserveActivation: z.boolean(),
    includeAverageSickUsage: z.boolean(),
    includeJA150: z.boolean(),
    planningMode: z.enum(planningModeValues),
  }),
  projectedAnnualPayCents: z.number(),
  feasibilityRating: z.enum(feasibilityRatingValues),
});
export type SavePlannerScenarioRequest = z.infer<typeof savePlannerScenarioRequestSchema>;

export const savePlannerScenarioResponseSchema = z.object({
  success: z.boolean(),
  scenario: savedPlannerScenarioSchema,
});
export type SavePlannerScenarioResponse = z.infer<typeof savePlannerScenarioResponseSchema>;

// GET /api/planner/annual/saved - List saved scenarios
export const getSavedScenariosResponseSchema = z.object({
  scenarios: z.array(savedPlannerScenarioSchema),
  totalCount: z.number(),
});
export type GetSavedScenariosResponse = z.infer<typeof getSavedScenariosResponseSchema>;

// DELETE /api/planner/annual/saved/:id - Delete a saved scenario
export const deleteSavedScenarioResponseSchema = z.object({
  success: z.boolean(),
});
export type DeleteSavedScenarioResponse = z.infer<typeof deleteSavedScenarioResponseSchema>;

// GET /api/planner/annual/tracking - Get tracking vs saved plan
export const getPlanTrackingResponseSchema = z.object({
  hasSavedPlan: z.boolean(),
  savedPlan: savedPlannerScenarioSchema.nullable(),
  ytdActualPayCents: z.number(),
  ytdActualCreditMinutes: z.number(),
  ytdProjectedPayCents: z.number(), // linear extrapolation
  trackingStatus: z.enum(["ABOVE_PLAN", "ON_TRACK", "BELOW_PLAN"]),
  deltaVsPlanCents: z.number(),
  deltaVsPlanPercent: z.number(),
  daysIntoYear: z.number(),
  daysRemaining: z.number(),
});
export type GetPlanTrackingResponse = z.infer<typeof getPlanTrackingResponseSchema>;

// Feasibility rating display helpers
export const FEASIBILITY_RATING_DISPLAY: Record<FeasibilityRating, { label: string; color: string; icon: string }> = {
  VERY_ACHIEVABLE: { label: "Very Achievable", color: "#22c55e", icon: "check-circle" },
  ACHIEVABLE_WITH_EFFORT: { label: "Achievable with Effort", color: "#f59e0b", icon: "trending-up" },
  UNLIKELY_WITHOUT_SIGNIFICANT_CHANGE: { label: "Unlikely Without Change", color: "#f97316", icon: "alert-triangle" },
  HIGHLY_UNLIKELY_UNDER_CURRENT_CONDITIONS: { label: "Highly Unlikely", color: "#ef4444", icon: "x-circle" },
};

// Planning mode display helpers
export const PLANNING_MODE_DISPLAY: Record<PlanningMode, { label: string; description: string }> = {
  CONSERVATIVE: { label: "Conservative", description: "Lower projections with safety margins" },
  BALANCED: { label: "Balanced", description: "Realistic projections based on historical data" },
  AGGRESSIVE: { label: "Aggressive", description: "Higher projections assuming optimal conditions" },
};

// UPS Monthly Guarantee constant (75 hours)
export const UPS_MONTHLY_GUARANTEE_HOURS = 75;
export const UPS_MONTHLY_GUARANTEE_MINUTES = 75 * 60; // 4500

// JA (Junior Assignment) pay multiplier
export const JA_PAY_MULTIPLIER = 1.5;

// ============================================
// PAY AUDIT
// ============================================

export interface FlightRegisterData {
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  beginningPayCredit: string | null;
  endingPayCredit: string | null;
  dutyDays: number | null;
  jaHours: string | null;
  ja2Hours: string | null;
  blockHoursPaid: string | null;
  tdyPerDiem: number | null;
  // v4 — pay bucket fields parsed from FR totals section
  overGuaranteeAmountDollars?: number | null;
  underGuaranteeAmountDollars?: number | null;
  premiumPayAmountDollars?: number | null;
  taxablePdmAmountDollars?: number | null;
  jaAmountDollars?: number | null; // JA dollar amount from FR (exact, avoids recomputed rounding)
}

export interface DayforceData {
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  payRate: number | null;
  advNextPay: number | null;
  overGuaranteeHours: number | null;
  overGuaranteeAmount: number | null;
  underGuarantee: number | null;
  juniorHours: number | null;
  juniorAmount: number | null;
  premiumPayHours: number | null;
  premiumPayAmount: number | null;
  domicilePdmTx: number | null;
  dmsticPdmTx: number | null;
  vacationHours: number | null;
  vacationAmount: number | null;
  grossPay: number | null;
  netPay: number | null;
}

export interface PayAuditComparison {
  // JA fields are nullable — null means UNKNOWN (not zero)
  jaHourDifference: number | null;
  jaDollarDifference: number | null;
  jaExpectedPay: number | null;
  jaActualPay: number | null;
  overGuaranteeDifference: number;
  grossPayDifference: number | null;
  baseGuaranteeExpected: number;
  jaStatus?: 'found' | 'not_found' | 'low_confidence';
  periodsMatch?: boolean;
}

export type PayAuditMatchStatus =
  | 'paid_correctly'
  | 'mostly_matched'
  | 'possible_discrepancy'
  | 'likely_issue'
  | 'mismatched_periods'
  | 'unable_to_verify';

export interface PayAuditResult {
  id?: string;
  matchScore: number;
  matchStatus: PayAuditMatchStatus;
  estimatedDifference: number;
  summary: string;
  findings: string[];
  flightRegister: FlightRegisterData;
  dayforce: DayforceData;
  appData: {
    payRate: number;
    position: string | null;
    base: string | null;
  };
  comparison: PayAuditComparison;
  createdAt?: string;
  // New: Flight Register-only audit fields
  expectedGrossCents?: number;
  estimatedNetCents?: number;
  enteredSettlementCents?: number;
  enteredAdvanceCents?: number;
  comparisonMode?: 'gross' | 'net';
  auditDifferenceCents?: number;
  auditStatus?: 'paid_correctly' | 'minor_variance' | 'review_recommended' | 'possible_discrepancy' | 'likely_issue';
  auditSummary?: string;
  // v4 — matched Dayforce period guidance + gross breakdown buckets
  matchedSettlementPeriod?: string | null;
  matchedAdvancePeriod?: string | null;
  matchedSettlementPayDate?: string | null;
  matchedAdvancePayDate?: string | null;
  expectedGrossBreakdown?: {
    guaranteeCents: number;
    jaCents: number;
    premiumPayCents: number;
    overUnderCents: number;
    taxablePdmCents: number;
  } | null;
}
