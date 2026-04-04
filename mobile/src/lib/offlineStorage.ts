/**
 * Offline Storage Utility
 *
 * Provides caching layer for offline access to pay data.
 * Uses AsyncStorage to persist data locally on device.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

// Cache keys
const CACHE_KEYS = {
  DASHBOARD: "offline_dashboard",
  PAY_PERIODS: "offline_pay_periods",
  PAY_PERIOD_DETAIL: "offline_pay_period_detail_", // Append year_period
  TRIPS: "offline_trips",
  TRIPS_DATE: "offline_trips_date_", // Append startDate_endDate
  PAY_EVENTS: "offline_pay_events",
  PAY_EVENTS_DATE: "offline_pay_events_date_", // Append startDate_endDate
  PROFILE: "offline_profile",
  PROFILE_STATS: "offline_profile_stats",
  PROJECTIONS: "offline_projections_v2",
  PROJECTIONS_HISTORY: "offline_projections_history_", // Append months
  CONTRACTS: "offline_contracts",
  PAY_RULES: "offline_pay_rules",
  PAY_RULE_CATEGORIES: "offline_pay_rule_categories",
  PREMIUM_CODES: "offline_premium_codes",
  RESERVE_SCHEDULE: "offline_reserve_schedule_", // Append startDate_endDate
  TAX_PROFILE: "offline_tax_profile",
  YEAR_PLAN: "offline_year_plan",
  LIFETIME_EARNINGS: "offline_lifetime_earnings",
  ANNUAL_PLANNER_SCENARIOS: "offline_annual_planner_scenarios",
  ANNUAL_PLANNER_TRACKING: "offline_annual_planner_tracking",
  BENCHMARKS: "offline_benchmarks",
  SETTINGS: "offline_settings",
  LAST_SYNC: "offline_last_sync",
} as const;

// Cache expiry in milliseconds (7 days)
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

interface CachedData<T> {
  data: T;
  timestamp: number;
}

/**
 * Save data to offline cache
 */
async function saveToCache<T>(key: string, data: T): Promise<void> {
  try {
    const cached: CachedData<T> = {
      data,
      timestamp: Date.now(),
    };
    await AsyncStorage.setItem(key, JSON.stringify(cached));
    console.log(`[OfflineStorage] Cached: ${key}`);
  } catch (error) {
    console.error(`[OfflineStorage] Failed to cache ${key}:`, error);
  }
}

/**
 * Get data from offline cache
 * Returns null if not found or expired
 */
async function getFromCache<T>(key: string): Promise<T | null> {
  try {
    const stored = await AsyncStorage.getItem(key);
    if (!stored) return null;

    const cached: CachedData<T> = JSON.parse(stored);

    // Check if expired
    if (Date.now() - cached.timestamp > CACHE_EXPIRY_MS) {
      console.log(`[OfflineStorage] Cache expired: ${key}`);
      await AsyncStorage.removeItem(key);
      return null;
    }

    console.log(`[OfflineStorage] Cache hit: ${key}`);
    return cached.data;
  } catch (error) {
    console.error(`[OfflineStorage] Failed to read ${key}:`, error);
    return null;
  }
}

/**
 * Get cache timestamp
 */
async function getCacheTimestamp(key: string): Promise<Date | null> {
  try {
    const stored = await AsyncStorage.getItem(key);
    if (!stored) return null;

    const cached: CachedData<unknown> = JSON.parse(stored);
    return new Date(cached.timestamp);
  } catch {
    return null;
  }
}

/**
 * Clear all offline cache
 */
async function clearCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const offlineKeys = keys.filter((k) => k.startsWith("offline_"));
    await AsyncStorage.multiRemove(offlineKeys);
    console.log(`[OfflineStorage] Cleared ${offlineKeys.length} cached items`);
  } catch (error) {
    console.error("[OfflineStorage] Failed to clear cache:", error);
  }
}

// Specific cache operations for different data types

export const offlineCache = {
  // Dashboard data
  saveDashboard: <T>(data: T) => saveToCache(CACHE_KEYS.DASHBOARD, data),
  getDashboard: <T>() => getFromCache<T>(CACHE_KEYS.DASHBOARD),

  // Pay periods list
  savePayPeriods: <T>(data: T) => saveToCache(CACHE_KEYS.PAY_PERIODS, data),
  getPayPeriods: <T>() => getFromCache<T>(CACHE_KEYS.PAY_PERIODS),

  // Pay period detail (by year/period)
  savePayPeriodDetail: <T>(year: number, period: number, data: T) =>
    saveToCache(`${CACHE_KEYS.PAY_PERIOD_DETAIL}${year}_${period}`, data),
  getPayPeriodDetail: <T>(year: number, period: number) =>
    getFromCache<T>(`${CACHE_KEYS.PAY_PERIOD_DETAIL}${year}_${period}`),

  // Trips data (all)
  saveTrips: <T>(data: T) => saveToCache(CACHE_KEYS.TRIPS, data),
  getTrips: <T>() => getFromCache<T>(CACHE_KEYS.TRIPS),

  // Trips data by date range
  saveTripsForDate: <T>(startDate: string, endDate: string, data: T) =>
    saveToCache(`${CACHE_KEYS.TRIPS_DATE}${startDate}_${endDate}`, data),
  getTripsForDate: <T>(startDate: string, endDate: string) =>
    getFromCache<T>(`${CACHE_KEYS.TRIPS_DATE}${startDate}_${endDate}`),

  // Pay events (all)
  savePayEvents: <T>(data: T) => saveToCache(CACHE_KEYS.PAY_EVENTS, data),
  getPayEvents: <T>() => getFromCache<T>(CACHE_KEYS.PAY_EVENTS),

  // Pay events by date range
  savePayEventsForDate: <T>(startDate: string, endDate: string, data: T) =>
    saveToCache(`${CACHE_KEYS.PAY_EVENTS_DATE}${startDate}_${endDate}`, data),
  getPayEventsForDate: <T>(startDate: string, endDate: string) =>
    getFromCache<T>(`${CACHE_KEYS.PAY_EVENTS_DATE}${startDate}_${endDate}`),

  // Profile data
  saveProfile: <T>(data: T) => saveToCache(CACHE_KEYS.PROFILE, data),
  getProfile: <T>() => getFromCache<T>(CACHE_KEYS.PROFILE),

  // Profile stats
  saveProfileStats: <T>(data: T) => saveToCache(CACHE_KEYS.PROFILE_STATS, data),
  getProfileStats: <T>() => getFromCache<T>(CACHE_KEYS.PROFILE_STATS),

  // Projections
  saveProjections: <T>(data: T) => saveToCache(CACHE_KEYS.PROJECTIONS, data),
  getProjections: <T>() => getFromCache<T>(CACHE_KEYS.PROJECTIONS),

  // Projection history
  saveProjectionHistory: <T>(months: number, data: T) =>
    saveToCache(`${CACHE_KEYS.PROJECTIONS_HISTORY}${months}`, data),
  getProjectionHistory: <T>(months: number) =>
    getFromCache<T>(`${CACHE_KEYS.PROJECTIONS_HISTORY}${months}`),

  // Contracts list
  saveContracts: <T>(data: T) => saveToCache(CACHE_KEYS.CONTRACTS, data),
  getContracts: <T>() => getFromCache<T>(CACHE_KEYS.CONTRACTS),

  // Pay rules
  savePayRules: <T>(data: T) => saveToCache(CACHE_KEYS.PAY_RULES, data),
  getPayRules: <T>() => getFromCache<T>(CACHE_KEYS.PAY_RULES),

  // Pay rule categories
  savePayRuleCategories: <T>(data: T) => saveToCache(CACHE_KEYS.PAY_RULE_CATEGORIES, data),
  getPayRuleCategories: <T>() => getFromCache<T>(CACHE_KEYS.PAY_RULE_CATEGORIES),

  // Premium codes list
  savePremiumCodes: <T>(data: T) => saveToCache(CACHE_KEYS.PREMIUM_CODES, data),
  getPremiumCodes: <T>() => getFromCache<T>(CACHE_KEYS.PREMIUM_CODES),

  // Reserve schedule by date range
  saveReserveSchedule: <T>(startDate: string, endDate: string, data: T) =>
    saveToCache(`${CACHE_KEYS.RESERVE_SCHEDULE}${startDate}_${endDate}`, data),
  getReserveSchedule: <T>(startDate: string, endDate: string) =>
    getFromCache<T>(`${CACHE_KEYS.RESERVE_SCHEDULE}${startDate}_${endDate}`),

  // Tax profile
  saveTaxProfile: <T>(data: T) => saveToCache(CACHE_KEYS.TAX_PROFILE, data),
  getTaxProfile: <T>() => getFromCache<T>(CACHE_KEYS.TAX_PROFILE),

  // Year plan
  saveYearPlan: <T>(data: T) => saveToCache(CACHE_KEYS.YEAR_PLAN, data),
  getYearPlan: <T>() => getFromCache<T>(CACHE_KEYS.YEAR_PLAN),

  // Lifetime earnings
  saveLifetimeEarnings: <T>(data: T) => saveToCache(CACHE_KEYS.LIFETIME_EARNINGS, data),
  getLifetimeEarnings: <T>() => getFromCache<T>(CACHE_KEYS.LIFETIME_EARNINGS),

  // Annual planner scenarios
  saveAnnualPlannerScenarios: <T>(data: T) => saveToCache(CACHE_KEYS.ANNUAL_PLANNER_SCENARIOS, data),
  getAnnualPlannerScenarios: <T>() => getFromCache<T>(CACHE_KEYS.ANNUAL_PLANNER_SCENARIOS),

  // Annual planner tracking
  saveAnnualPlannerTracking: <T>(data: T) => saveToCache(CACHE_KEYS.ANNUAL_PLANNER_TRACKING, data),
  getAnnualPlannerTracking: <T>() => getFromCache<T>(CACHE_KEYS.ANNUAL_PLANNER_TRACKING),

  // Pay benchmarks
  saveBenchmarks: <T>(data: T) => saveToCache(CACHE_KEYS.BENCHMARKS, data),
  getBenchmarks: <T>() => getFromCache<T>(CACHE_KEYS.BENCHMARKS),

  // Settings
  saveSettings: <T>(data: T) => saveToCache(CACHE_KEYS.SETTINGS, data),
  getSettings: <T>() => getFromCache<T>(CACHE_KEYS.SETTINGS),

  // Last sync time
  saveLastSync: () => saveToCache(CACHE_KEYS.LAST_SYNC, Date.now()),
  getLastSync: async (): Promise<Date | null> => {
    const timestamp = await getFromCache<number>(CACHE_KEYS.LAST_SYNC);
    return timestamp ? new Date(timestamp) : null;
  },

  // Cache timestamp for any key
  getCacheTimestamp,

  // Clear all cache
  clearCache,
};

export default offlineCache;
