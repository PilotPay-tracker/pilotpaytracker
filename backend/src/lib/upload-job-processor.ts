/**
 * Upload Job Processor
 *
 * Background processing system for schedule uploads that scales to thousands of users.
 * Key features:
 * - Queue-based processing (instant response to user, background work)
 * - Parallel image processing (multiple images at once)
 * - ROBUST PARSER for Crew Access format (v2.1.0) - uses OCR + template-aware parsing
 * - AI fallback for other formats or low-confidence OCR
 * - Batch database operations (faster inserts)
 * - Memory-efficient for high concurrency
 *
 * ROUTING LOGIC (v2.1.0):
 * 1. Run OCR on image
 * 2. Detect template type (Crew Access vs Trip Board)
 * 3. If Crew Access + OCR confidence >= 80% + required fields found:
 *    -> Use ROBUST parser (importScheduleRobust)
 * 4. If robust parser fails validation:
 *    -> Fallback to AI parser
 * 5. If both fail:
 *    -> Return error with debug info for review
 */

import { db } from "../db";
import * as fs from "node:fs";
import * as path from "node:path";
import { generateImageHash } from "./image-preprocessing";
import { performOCRWithRetry, type OCRResult } from "./ocr-engine";
import { parseScheduleFromOCR, simplifyParsedSchedule, type ParsedSchedule } from "./schedule-parser";
import { getCachedParse, cacheParse } from "./parse-cache";
import { importToCanonicalStructure, normalizeAIParsedData, type ParsedTripImport, type ImportSourceType } from "./canonical-import-pipeline";
import { importWithVersionTracking, type VersionAwareImportResult, type ImportOptions } from "./version-aware-import";
import { checkTripConflicts, type ConflictCheckInput } from "./trip-conflict-detector";
// NEW: RSV Activation Integration
import { tryActivateRSVForImport, type RSVActivationResult } from "./rsv-activation-integration";

// NEW: Import robust parser components
import {
  detectTemplate,
  parseCrewAccessTripInfo,
  type TemplateType,
} from "./robust-schedule-parser";
import {
  importScheduleRobust,
  type ImportResult as RobustImportResult,
} from "./robust-import-pipeline";

// ============================================
// Configuration
// ============================================

const CONFIG = {
  // Parallelism settings
  MAX_CONCURRENT_IMAGES: 3,     // Process up to 3 images in parallel (reduced to avoid rate limits)
  MAX_CONCURRENT_JOBS: 5,       // Process up to 5 jobs at a time (reduced for stability)

  // ROBUST PARSER thresholds (v2.1.0)
  ROBUST_OCR_CONFIDENCE_THRESHOLD: 0.65,  // 65% OCR confidence — Crew Access format is structured enough at this level
  ROBUST_TEMPLATE_CONFIDENCE_THRESHOLD: 0.70,  // 70% template detection confidence required

  // AI fallback threshold - use AI when robust parser isn't applicable
  AI_CONFIDENCE_THRESHOLD: 0.60,  // Below 60% OCR, try AI directly

  // Polling interval for job processor
  JOB_POLL_INTERVAL_MS: 750,    // Check for new jobs every 750ms (balanced)

  // Job timeout
  JOB_TIMEOUT_MS: 5 * 60 * 1000,  // 5 minute timeout per job (increased for reliability)
};

// Parser version tracking
const PARSER_VERSION = "2.1.0";

// ============================================
// Types
// ============================================

interface ImageProcessResult {
  imageUrl: string;
  success: boolean;
  ocrText?: string;
  parsedData?: any;
  sourceType?: string;
  confidence?: number;
  fileHash?: string;
  error?: string;
  processingTimeMs: number;
  usedAI: boolean;
  // NEW: Parser tracking (v2.1.0)
  parserVersion: string;
  pipelineUsed: "robust" | "ai" | "none";
  templateType?: TemplateType;
  ocrConfidence?: number;
  robustParserFailed?: boolean;
  robustParserError?: string;
}

interface ConflictInfo {
  tripNumber?: string;
  conflicts: any[];
  newTripSummary: any;
  parsedData: any;
}

interface RSVActivationInfo {
  eventId: string;
  scheduleType?: string;
  legsAdded: number;
  blockHoursUpdated: number;
  creditPreserved: number;
}

interface JobResult {
  createdTripIds: string[];
  updatedTripIds: string[];
  activatedRSVs: RSVActivationInfo[];
  errors: string[];
  totalProcessingTimeMs: number;
  conflictsDetected?: ConflictInfo[];
}

// ============================================
// Job Queue Manager
// ============================================

// Use globalThis to persist interval across hot reloads — prevents duplicate processors
const GLOBAL_KEY = "__uploadJobProcessorInterval__";

let isProcessorRunning = false;

/**
 * Start the background job processor
 */
export function startJobProcessor(): void {
  // Clear any existing interval (including from hot-reload of previous module instance)
  const existingInterval = (globalThis as any)[GLOBAL_KEY];
  if (existingInterval) {
    clearInterval(existingInterval);
    (globalThis as any)[GLOBAL_KEY] = null;
  }

  isProcessorRunning = true;
  console.log("⚡ [JobProcessor] Starting background processor");
  console.log(`  Max concurrent jobs: ${CONFIG.MAX_CONCURRENT_JOBS}`);
  console.log(`  Max concurrent images per job: ${CONFIG.MAX_CONCURRENT_IMAGES}`);
  console.log(`  AI confidence threshold: ${CONFIG.AI_CONFIDENCE_THRESHOLD * 100}%`);
  console.log(`  Poll interval: ${CONFIG.JOB_POLL_INTERVAL_MS}ms`);

  // Recover any jobs stuck in "processing" state from a previous server crash/restart
  db.uploadJob.updateMany({
    where: { status: "processing" },
    data: { status: "pending", currentStep: "Queued...", progress: 0 },
  }).then((r) => {
    if (r.count > 0) {
      console.log(`⚡ [JobProcessor] Recovered ${r.count} stuck job(s) from previous session`);
    }
  }).catch(() => {});

  const interval = setInterval(processNextJobs, CONFIG.JOB_POLL_INTERVAL_MS);
  (globalThis as any)[GLOBAL_KEY] = interval;

  // Process immediately (DB is already connected when this is called from index.ts)
  processNextJobs();
}

/**
 * Stop the background job processor
 */
export function stopJobProcessor(): void {
  const existingInterval = (globalThis as any)[GLOBAL_KEY];
  if (existingInterval) {
    clearInterval(existingInterval);
    (globalThis as any)[GLOBAL_KEY] = null;
  }
  isProcessorRunning = false;
  console.log("⚡ [JobProcessor] Stopped");
}

/**
 * Process pending jobs
 */
async function processNextJobs(): Promise<void> {
  try {
    // Count currently processing jobs
    const processingCount = await db.uploadJob.count({
      where: { status: "processing" },
    });

    // Get pending jobs up to available capacity
    const availableSlots = CONFIG.MAX_CONCURRENT_JOBS - processingCount;
    const pendingJobs = await db.uploadJob.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: availableSlots,
    });

    if (pendingJobs.length > 0) {
      console.log(`⚡ [JobProcessor] Found ${pendingJobs.length} pending job(s), processing...`);
    }

    if (pendingJobs.length === 0) {
      return;
    }

    if (processingCount >= CONFIG.MAX_CONCURRENT_JOBS) {
      console.log(`⚡ [JobProcessor] At capacity (${processingCount}/${CONFIG.MAX_CONCURRENT_JOBS}), ${pendingJobs.length} jobs waiting`);
      return;
    }

    console.log(`⚡ [JobProcessor] Found ${pendingJobs.length} pending job(s), processing...`);

    // Process jobs in parallel (but respect the limit)
    await Promise.all(
      pendingJobs.map((job) => processJob(job.id).catch((err) => {
        console.error(`⚡ [JobProcessor] Job ${job.id} failed:`, err?.message || err);
      }))
    );
  } catch (error: any) {
    const errorMsg = error?.message || error?.toString() || "Unknown error";
    // Brief log for all errors so we can diagnose without flooding logs
    console.error(`⚡ [JobProcessor] processNextJobs error: ${errorMsg.substring(0, 120)}`);
  }
}

/**
 * Create a new upload job (called from API)
 */
export async function createUploadJob(
  userId: string,
  imageUrls: string[]
): Promise<{ jobId: string }> {
  const job = await db.uploadJob.create({
    data: {
      userId,
      imageUrls: JSON.stringify(imageUrls),
      imageCount: imageUrls.length,
      status: "pending",
      progress: 0,
      currentStep: "Queued...",
    },
  });

  console.log(`⚡ [JobProcessor] Created job ${job.id} with ${imageUrls.length} image(s) for user ${userId}`);

  // Trigger immediate processing (don't wait for next poll)
  setTimeout(() => processNextJobs(), 100);

  return { jobId: job.id };
}

/**
 * Get job status (for polling from frontend)
 */
export async function getJobStatus(jobId: string, userId: string): Promise<{
  status: string;
  progress: number;
  currentStep: string | null;
  createdTripIds: string[];
  updatedTripIds: string[];
  errorMessage: string | null;
  processingTimeMs: number | null;
  hasConflicts?: boolean;
  conflictsDetected?: ConflictInfo[];
  // NEW: Parser tracking (v2.1.0)
  parserVersion: string;
  pipelineUsed?: "robust" | "ai" | "mixed" | "none";
} | null> {
  const job = await db.uploadJob.findFirst({
    where: { id: jobId, userId },
  });

  if (!job) return null;

  const conflictsDetected = job.conflictsDetected ? JSON.parse(job.conflictsDetected) : [];

  // Parse pipeline info from currentStep (embedded during processing)
  // Format: "Complete! [robust|ai|mixed]" or just "Complete!"
  let pipelineUsed: "robust" | "ai" | "mixed" | "none" | undefined;
  if (job.currentStep?.includes("[robust]")) {
    pipelineUsed = "robust";
  } else if (job.currentStep?.includes("[ai]")) {
    pipelineUsed = "ai";
  } else if (job.currentStep?.includes("[mixed]")) {
    pipelineUsed = "mixed";
  } else if (job.status === "completed") {
    pipelineUsed = "none";
  }

  return {
    status: job.status,
    progress: job.progress,
    currentStep: job.currentStep?.replace(/\s*\[(robust|ai|mixed)\]/, "") || null, // Clean up display
    createdTripIds: job.createdTripIds ? JSON.parse(job.createdTripIds) : [],
    updatedTripIds: job.updatedTripIds ? JSON.parse(job.updatedTripIds) : [],
    errorMessage: job.errorMessage,
    processingTimeMs: job.processingTimeMs,
    hasConflicts: conflictsDetected.length > 0,
    conflictsDetected: conflictsDetected.length > 0 ? conflictsDetected : undefined,
    // NEW: Parser tracking
    parserVersion: PARSER_VERSION,
    pipelineUsed,
  };
}

// ============================================
// Core Processing Logic
// ============================================

/**
 * Process a single job
 */
async function processJob(jobId: string): Promise<void> {
  const startTime = Date.now();
  console.log(`⚡ [Job ${jobId}] ========== STARTING ==========`);

  // Mark as processing — write progress=5 immediately so UI stops showing "Queued..."
  const job = await db.uploadJob.update({
    where: { id: jobId },
    data: {
      status: "processing",
      startedAt: new Date(),
      progress: 5,
      currentStep: "Reading image...",
    },
  });

  const userId = job.userId;
  const imageUrls: string[] = JSON.parse(job.imageUrls);

  console.log(`⚡ [Job ${jobId}] Processing ${imageUrls.length} image(s) - ${Date.now() - startTime}ms`);

  try {
    // Get user profile for base/fleet
    const profile = await db.profile.findUnique({
      where: { userId },
    });
    console.log(`⚡ [Job ${jobId}] Profile loaded - ${Date.now() - startTime}ms`);

    // Check if AI is available - Vibecode proxy handles auth even without env var
    const hasOpenAI = Boolean(
      process.env.OPENAI_BASE_URL || // Vibecode proxy URL present
      process.env.EXPO_PUBLIC_VIBECODE_OPENAI_API_KEY ||
      process.env.OPENAI_API_KEY
    );
    console.log(`⚡ [Job ${jobId}] AI available: ${hasOpenAI} - ${Date.now() - startTime}ms`);

    // Update progress
    await updateJobProgress(jobId, 10, "Analyzing images...");

    // ============================================
    // FAST Image Processing - Direct to AI
    // ============================================
    console.log(`⚡ [Job ${jobId}] Starting AI parsing... - ${Date.now() - startTime}ms`);
    const imageResults = await processImagesInParallel(
      imageUrls,
      userId,
      hasOpenAI,
      jobId
    );
    console.log(`⚡ [Job ${jobId}] AI parsing complete - ${Date.now() - startTime}ms`);

    await updateJobProgress(jobId, 60, "Extracting flight data...");

    // ============================================
    // OPTIMIZATION 2: Batch Trip Creation
    // WITH RSV ACTIVATION INTEGRATION
    // ============================================
    const createdTripIds: string[] = [];
    const updatedTripIds: string[] = [];
    const activatedRSVs: RSVActivationInfo[] = [];
    const errors: string[] = [];
    const conflictsDetected: ConflictInfo[] = [];

    for (const result of imageResults) {
      if (!result.success || !result.parsedData) {
        if (result.error) errors.push(result.error);
        continue;
      }

      // If robust parser already handled the trip, record it correctly as created or updated
      if (result.pipelineUsed === "robust" && result.parsedData.tripId) {
        const action = result.parsedData.robustAction || "created";
        if (action === "updated") {
          console.log(`⚡ [Job ${jobId}] Trip updated by robust parser: ${result.parsedData.tripId}`);
          updatedTripIds.push(result.parsedData.tripId);
        } else {
          console.log(`⚡ [Job ${jobId}] Trip created by robust parser: ${result.parsedData.tripId}`);
          createdTripIds.push(result.parsedData.tripId);
        }
        continue;
      }

      try {
        // Determine if this should create a trip or just enrichment
        // AI parser returns events WITHOUT eventType (uses flightNumber/isDeadhead instead)
        // Robust parser returns events WITH eventType: "FLIGHT" | "DEADHEAD"
        const hasFlightLegs = result.parsedData.events?.some(
          (e: any) =>
            e.eventType === "FLIGHT" ||
            e.eventType === "DEADHEAD" ||
            // AI format: has flightNumber (or depAirport+arrAirport) and no eventType
            (e.flightNumber && !e.eventType) ||
            (e.depAirport && e.arrAirport && !e.eventType)
        );
        const isCrewAccessTripInfo = result.sourceType === "crew_access_trip_info";
        const hasTripInfo = result.parsedData.tripNumber || result.parsedData.pairingId;

        if (!hasFlightLegs && !isCrewAccessTripInfo) {
          continue; // Skip enrichment-only for now
        }

        // ============================================
        // NEW: Check for RSV activation FIRST
        // If legs overlap an existing RSV, activate it instead of creating a Trip
        // ============================================
        console.log(`⚡ [Job ${jobId}] Checking for RSV activation opportunity...`);
        const rsvActivation = await tryActivateRSVForImport(
          userId,
          result.parsedData,
          result.imageUrl // Use image URL as source reference
        );

        if (rsvActivation.activated && rsvActivation.eventId) {
          console.log(`⚡ [Job ${jobId}] ✅ RSV ACTIVATED: ${rsvActivation.eventId}`);
          console.log(`   Legs: ${rsvActivation.activationResult?.legsAdded}, Block: ${rsvActivation.activationResult?.blockHoursUpdated}h`);
          console.log(`   Credit preserved: ${rsvActivation.activationResult?.creditPreserved}h`);

          activatedRSVs.push({
            eventId: rsvActivation.eventId,
            legsAdded: rsvActivation.activationResult?.legsAdded || 0,
            blockHoursUpdated: rsvActivation.activationResult?.blockHoursUpdated || 0,
            creditPreserved: rsvActivation.activationResult?.creditPreserved || 0,
          });

          // Skip trip creation - RSV was activated instead
          continue;
        }

        console.log(`⚡ [Job ${jobId}] No RSV match (${rsvActivation.reason}), proceeding with Trip creation...`);

        // Check for conflicts first
        const conflictInput: ConflictCheckInput = {
          userId,
          startDate: result.parsedData.startDate || new Date().toISOString().split('T')[0]!,
          endDate: result.parsedData.endDate || result.parsedData.startDate || new Date().toISOString().split('T')[0]!,
          tripNumber: result.parsedData.tripNumber,
          pairingId: result.parsedData.pairingId,
        };
        const conflictCheck = await checkTripConflicts(conflictInput);

        if (conflictCheck.hasConflicts && conflictCheck.conflicts.length > 0) {
          // Store conflict info for user to resolve via UI
          console.log(`⚡ [Job ${jobId}] Conflict detected for trip ${result.parsedData.tripNumber || 'unknown'} - storing for user resolution`);
          conflictsDetected.push({
            tripNumber: result.parsedData.tripNumber,
            conflicts: conflictCheck.conflicts,
            newTripSummary: {
              tripId: '',
              tripNumber: result.parsedData.tripNumber || null,
              pairingId: result.parsedData.pairingId || null,
              startDate: result.parsedData.startDate || '',
              endDate: result.parsedData.endDate || '',
              totalCreditMinutes: result.parsedData.totals?.creditMinutes || 0,
              dutyDaysCount: result.parsedData.events?.filter((e: any) => e.eventType === "FLIGHT" || e.eventType === "DEADHEAD").length || 0,
              legCount: result.parsedData.events?.length || 0,
              routeHighlights: result.parsedData.events?.slice(0, 3).map((e: any) => `${e.depAirport || ''}-${e.arrAirport || ''}`).join(', ') || '',
            },
            parsedData: result.parsedData,
          });
          continue;
        }

        // Normalize the parsed data for canonical import
        const sourceType = (result.sourceType || "trip_board_browser") as ImportSourceType;
        const normalizedData = normalizeAIParsedData(result.parsedData, sourceType);

        // Import with version tracking
        const importOptions: ImportOptions = {
          sourceType: "import",
          imageUrls: [result.imageUrl],
          parseConfidence: result.confidence,
          hourlyRateCents: profile?.hourlyRateCents ?? 32500,
        };
        const importResult = await importWithVersionTracking(
          userId,
          profile?.airline || "DL", // Default to DL if no airline set
          normalizedData,
          undefined, // Let it find or create trip
          importOptions
        );

        if (importResult.tripId) {
          if (importResult.isNewTrip) {
            createdTripIds.push(importResult.tripId);
          } else {
            updatedTripIds.push(importResult.tripId);
          }
        }
      } catch (tripError: any) {
        console.error(`⚡ [Job ${jobId}] Error creating trip:`, tripError);
        errors.push(tripError.message || "Failed to create trip");
      }
    }

    await updateJobProgress(jobId, 90, "Creating trips...");

    // Determine which pipeline(s) were used
    const robustCount = imageResults.filter(r => r.pipelineUsed === "robust").length;
    const aiCount = imageResults.filter(r => r.pipelineUsed === "ai").length;
    let pipelineTag: string;
    if (robustCount > 0 && aiCount > 0) {
      pipelineTag = "[mixed]";
    } else if (robustCount > 0) {
      pipelineTag = "[robust]";
    } else if (aiCount > 0) {
      pipelineTag = "[ai]";
    } else {
      pipelineTag = "[none]";
    }

    // Complete the job
    const totalTime = Date.now() - startTime;
    await db.uploadJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        progress: 100,
        currentStep: `Complete! ${pipelineTag}`,
        createdTripIds: JSON.stringify(createdTripIds),
        updatedTripIds: JSON.stringify(updatedTripIds),
        errorMessage: errors.length > 0 ? errors.join("; ") : null,
        conflictsDetected: conflictsDetected.length > 0 ? JSON.stringify(conflictsDetected) : null,
        completedAt: new Date(),
        processingTimeMs: totalTime,
      },
    });

    console.log(`⚡ [Job ${jobId}] Completed in ${totalTime}ms - Created: ${createdTripIds.length}, Updated: ${updatedTripIds.length}, RSV Activated: ${activatedRSVs.length}, Pipeline: ${pipelineTag}`);
    console.log(`⚡ [Job ${jobId}] Parser version: ${PARSER_VERSION}, Robust: ${robustCount}, AI: ${aiCount}`);
    if (activatedRSVs.length > 0) {
      console.log(`⚡ [Job ${jobId}] RSV Activations:`, activatedRSVs.map(r => `${r.eventId} (${r.legsAdded} legs, ${r.blockHoursUpdated}h block, ${r.creditPreserved}h credit preserved)`).join(", "));
    }

  } catch (error: any) {
    const totalTime = Date.now() - startTime;
    console.error(`⚡ [Job ${jobId}] Failed:`, error);

    await db.uploadJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        errorMessage: error.message || "Unknown error",
        completedAt: new Date(),
        processingTimeMs: totalTime,
      },
    });
  }
}

/**
 * Process multiple images in parallel
 */
async function processImagesInParallel(
  imageUrls: string[],
  userId: string,
  hasOpenAI: boolean,
  jobId: string
): Promise<ImageProcessResult[]> {
  const results: ImageProcessResult[] = [];
  const totalImages = imageUrls.length;

  // Process in batches of MAX_CONCURRENT_IMAGES
  for (let i = 0; i < imageUrls.length; i += CONFIG.MAX_CONCURRENT_IMAGES) {
    const batch = imageUrls.slice(i, i + CONFIG.MAX_CONCURRENT_IMAGES);

    const batchResults = await Promise.all(
      batch.map((url) => processingSingleImage(url, userId, hasOpenAI))
    );

    results.push(...batchResults);

    // Update progress based on images processed (10-60% range)
    const imagesProcessed = i + batch.length;
    const progressPercent = Math.round(10 + (50 * imagesProcessed) / totalImages);
    const stepText = totalImages > 1
      ? `Parsing image ${imagesProcessed} of ${totalImages}...`
      : "Reading schedule...";
    await updateJobProgress(jobId, progressPercent, stepText);
  }

  return results;
}

/**
 * Process a single image - ROBUST PARSER ROUTING (v2.1.0)
 *
 * Routing logic:
 * 1. Run OCR on image
 * 2. Detect template type (Crew Access vs Trip Board)
 * 3. If Crew Access + OCR confidence >= 80% + required fields found:
 *    -> Use ROBUST parser (importScheduleRobust)
 * 4. If robust parser fails validation:
 *    -> Fallback to AI parser
 * 5. If both fail:
 *    -> Return error with debug info for review
 */
async function processingSingleImage(
  imageUrl: string,
  userId: string,
  hasOpenAI: boolean
): Promise<ImageProcessResult> {
  const startTime = Date.now();

  try {
    const uploadsDir = path.join(process.cwd(), "uploads");
    const filename = imageUrl.replace("/uploads/", "");
    const filePath = path.join(uploadsDir, filename);

    // Check if file exists with retry (file might still be writing)
    let fileExists = fs.existsSync(filePath);
    if (!fileExists) {
      await new Promise(resolve => setTimeout(resolve, 500));
      fileExists = fs.existsSync(filePath);
    }

    if (!fileExists) {
      console.log(`  ❌ [Image] File not found: ${filePath}`);
      return {
        imageUrl,
        success: false,
        error: "Image file not found. Please try uploading again.",
        processingTimeMs: Date.now() - startTime,
        usedAI: false,
        parserVersion: PARSER_VERSION,
        pipelineUsed: "none",
      };
    }

    // Check file size to avoid processing corrupt/empty files
    const stats = fs.statSync(filePath);
    if (stats.size < 1000) {
      console.log(`  ❌ [Image] File too small (${stats.size} bytes): ${filePath}`);
      return {
        imageUrl,
        success: false,
        error: "Image file appears to be corrupted or empty.",
        processingTimeMs: Date.now() - startTime,
        usedAI: false,
        parserVersion: PARSER_VERSION,
        pipelineUsed: "none",
      };
    }

    // ============================================
    // STEP 1: Run OCR first
    // ============================================
    console.log(`  📷 [Image] Running OCR (${(stats.size / 1024).toFixed(0)}KB)...`);
    const ocrResult = await performOCRWithRetry(filePath);
    const ocrConfidence = ocrResult.confidence / 100; // Convert to 0-1 scale
    console.log(`  📷 [Image] OCR complete: ${ocrResult.fullText.length} chars, confidence: ${(ocrConfidence * 100).toFixed(1)}%`);

    // ============================================
    // STEP 2: Detect template type
    // ============================================
    const templateDetection = detectTemplate(ocrResult.fullText);
    console.log(`  🔍 [Image] Template: ${templateDetection.templateType}, confidence: ${(templateDetection.confidence * 100).toFixed(1)}%`);

    // ============================================
    // STEP 3: Check if ROBUST parser is applicable
    // ============================================
    const isCrewAccess = templateDetection.templateType === "crew_access_trip_info";
    const ocrConfidenceOK = ocrConfidence >= CONFIG.ROBUST_OCR_CONFIDENCE_THRESHOLD;
    const templateConfidenceOK = templateDetection.confidence >= CONFIG.ROBUST_TEMPLATE_CONFIDENCE_THRESHOLD;

    // Check for required fields in Crew Access format
    const hasTripIdLine = /Trip\s*(?:Id|1d)[:\s]+([A-Z]?\d{4,6})/i.test(ocrResult.fullText);
    // Pattern handles OCR variations: "1Fr", "1 Fr", "28a" (Sa misread), "3Su", etc.
    // - \s* allows optional space between digit and day code (OCR often removes it)
    // - Day codes: Su,Mo,Tu,We,Th,Fr,Sa + common OCR misreads (8a=Sa, 0u=Su, etc.)
    const hasLegRows = /\d\s*(?:Su|Mo|Tu|We|Th|Fr|Sa|8a|0u)\s+(?:DH\s+)?\d{3,5}?\s+[A-Z]{3}\s*[-–]\s*[A-Z]{3}/i.test(ocrResult.fullText);
    const hasBlockColumn = /Block|BLK|\d:\d{2}\s+76[78WP]/i.test(ocrResult.fullText);
    const requiredFieldsOK = hasTripIdLine && hasLegRows && hasBlockColumn;

    const useRobustParser = isCrewAccess && ocrConfidenceOK && templateConfidenceOK && requiredFieldsOK;

    console.log(`  🔍 [Image] Robust parser check: isCrewAccess=${isCrewAccess}, ocrOK=${ocrConfidenceOK}, templateOK=${templateConfidenceOK}, fieldsOK=${requiredFieldsOK}`);
    console.log(`  🔍 [Image] Fields: tripId=${hasTripIdLine}, legs=${hasLegRows}, block=${hasBlockColumn}`);

    // ============================================
    // STEP 4: Try ROBUST parser if applicable
    // ============================================
    if (useRobustParser) {
      console.log(`  🚀 [Image] Using ROBUST parser v${PARSER_VERSION}...`);

      try {
        const robustResult = await importScheduleRobust({
          userId,
          imageUrls: [imageUrl],
          ocrText: ocrResult.fullText,
          baseDate: undefined,
          dryRun: false,
        });

        if (robustResult.success && robustResult.tripId) {
          console.log(`  ✅ [Image] ROBUST parser success in ${Date.now() - startTime}ms - Trip: ${robustResult.tripNumber || robustResult.tripId} (${robustResult.action})`);

          // Build parsedData from robust result for downstream processing
          const parsedData = {
            tripNumber: robustResult.tripNumber,
            tripId: robustResult.tripId,
            startDate: robustResult.parseResult?.trip?.tripStartDate,
            endDate: robustResult.parseResult?.trip?.tripEndDate,
            events: robustResult.parseResult?.trip?.dutyDays?.flatMap((dd: any) =>
              dd.legs.map((leg: any) => ({
                date: dd.calendarDate,
                flightNumber: leg.flightNumber,
                depAirport: leg.depAirport,
                arrAirport: leg.arrAirport,
                startTime: leg.depLocalTime,
                endTime: leg.arrLocalTime,
                blockMinutes: leg.blockMinutes,
                isDeadhead: leg.dhFlag,
                eventType: leg.dhFlag ? "DEADHEAD" : "FLIGHT",
              }))
            ) || [],
            totals: robustResult.parseResult?.trip?.totals || {},
            sourceType: "crew_access_trip_info",
            confidence: robustResult.confidence,
            parserVersion: PARSER_VERSION,
            pipelineUsed: "robust",
            // Include action so job processor knows if it was created or updated
            robustAction: robustResult.action,
          };

          return {
            imageUrl,
            success: true,
            ocrText: ocrResult.fullText,
            parsedData,
            sourceType: "crew_access_trip_info",
            confidence: robustResult.confidence,
            fileHash: undefined,
            processingTimeMs: Date.now() - startTime,
            usedAI: false,
            parserVersion: PARSER_VERSION,
            pipelineUsed: "robust",
            templateType: templateDetection.templateType,
            ocrConfidence,
          };
        }

        // Robust parser didn't create a trip - check why
        console.log(`  ⚠️ [Image] ROBUST parser did not create trip: ${robustResult.message}`);
        console.log(`  ⚠️ [Image] Errors: ${robustResult.errors?.join(", ") || "none"}`);
        console.log(`  ⚠️ [Image] Warnings: ${robustResult.warnings?.join(", ") || "none"}`);

        // If it needs review, still return success but flag for review
        if (robustResult.action === "review_required") {
          return {
            imageUrl,
            success: false,
            ocrText: ocrResult.fullText,
            error: `Schedule requires review: ${robustResult.message}`,
            processingTimeMs: Date.now() - startTime,
            usedAI: false,
            parserVersion: PARSER_VERSION,
            pipelineUsed: "robust",
            templateType: templateDetection.templateType,
            ocrConfidence,
            robustParserFailed: true,
            robustParserError: robustResult.message,
          };
        }

        // Fall through to AI fallback
        console.log(`  🔄 [Image] Falling back to AI parser...`);

      } catch (robustError: any) {
        console.log(`  ❌ [Image] ROBUST parser error: ${robustError.message}`);
        console.log(`  🔄 [Image] Falling back to AI parser...`);
        // Fall through to AI fallback
      }
    }

    // ============================================
    // STEP 5: AI Parser (fallback or primary for non-Crew Access)
    // ============================================
    if (!hasOpenAI) {
      console.log(`  ⚠️ [Image] No AI available and robust parser not applicable`);
      return {
        imageUrl,
        success: false,
        ocrText: ocrResult.fullText,
        error: "Could not parse schedule. AI service unavailable and image format not recognized as Crew Access.",
        processingTimeMs: Date.now() - startTime,
        usedAI: false,
        parserVersion: PARSER_VERSION,
        pipelineUsed: "none",
        templateType: templateDetection.templateType,
        ocrConfidence,
        robustParserFailed: useRobustParser,
      };
    }

    console.log(`  🤖 [Image] Using AI parser${useRobustParser ? " (fallback after robust failed)" : ""}...`);
    const aiResult = await parseImageWithAIFast(filePath);

    if (aiResult && (aiResult.events?.length > 0 || aiResult.tripNumber || aiResult.pairingId)) {
      console.log(`  ✅ [Image] AI parsed in ${Date.now() - startTime}ms - ${aiResult.events?.length || 0} events`);

      // Add parser tracking to AI result
      aiResult.parserVersion = PARSER_VERSION;
      aiResult.pipelineUsed = "ai";

      return {
        imageUrl,
        success: true,
        ocrText: ocrResult.fullText,
        parsedData: aiResult,
        sourceType: aiResult.sourceType || templateDetection.templateType || "trip_board_browser",
        confidence: aiResult.confidence || 0.9,
        fileHash: undefined,
        processingTimeMs: Date.now() - startTime,
        usedAI: true,
        parserVersion: PARSER_VERSION,
        pipelineUsed: "ai",
        templateType: templateDetection.templateType,
        ocrConfidence,
        robustParserFailed: useRobustParser,
      };
    }

    // Both parsers failed
    console.log(`  ❌ [Image] Both parsers failed after ${Date.now() - startTime}ms`);
    return {
      imageUrl,
      success: false,
      ocrText: ocrResult.fullText,
      error: "Could not extract schedule data from this image. Please ensure the image clearly shows trip/schedule information.",
      processingTimeMs: Date.now() - startTime,
      usedAI: true,
      parserVersion: PARSER_VERSION,
      pipelineUsed: "none",
      templateType: templateDetection.templateType,
      ocrConfidence,
      robustParserFailed: useRobustParser,
    };

  } catch (error: any) {
    console.log(`  ❌ [Image] Error: ${error.message}`);

    // Provide user-friendly error messages
    let userMessage = "Processing failed. Please try again.";
    if (error.message?.includes("timeout") || error.message?.includes("AbortError")) {
      userMessage = "Processing timed out. The image may be too large or complex. Try a smaller/clearer screenshot.";
    } else if (error.message?.includes("rate") || error.message?.includes("429")) {
      userMessage = "Too many requests. Please wait a moment and try again.";
    } else if (error.message?.includes("API error")) {
      userMessage = "AI service temporarily unavailable. Please try again in a few seconds.";
    }

    return {
      imageUrl,
      success: false,
      error: userMessage,
      processingTimeMs: Date.now() - startTime,
      usedAI: false,
      parserVersion: PARSER_VERSION,
      pipelineUsed: "none",
    };
  }
}

/**
 * FAST AI parsing with OCR hint - gpt-4o-mini for speed
 */
async function parseImageWithAIOptimized(
  filePath: string,
  ocrHint: string
): Promise<any | null> {
  const apiKey = process.env.EXPO_PUBLIC_VIBECODE_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

  if (!apiKey) return null;

  const imageBuffer = fs.readFileSync(filePath);
  const base64Image = imageBuffer.toString("base64");
  const mimeType = filePath.endsWith(".png") ? "image/png" : "image/jpeg";
  const dataUrl = `data:${mimeType};base64,${base64Image}`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",  // Fastest model
      max_tokens: 2048,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Parse schedule. OCR: ${ocrHint.substring(0, 800)}
Times: "(XX)HH:MM"=LOCAL hour XX. "(FR14)19:00"=14:00.
JSON: {"tripNumber":"","startDate":"","endDate":"","events":[{"date":"","flightNumber":"","depAirport":"","arrAirport":"","startTime":"","endTime":"","blockMinutes":0}],"totals":{"creditMinutes":0,"blockMinutes":0,"tafbMinutes":0,"dutyDays":0}}`,
            },
            {
              type: "image_url",
              image_url: { url: dataUrl, detail: "low" },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) return null;

  const data = await response.json() as any;
  const responseText = data.choices?.[0]?.message?.content || "";

  // Parse JSON from response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

/**
 * FAST AI parsing - gpt-4o-mini with minimal prompt for speed
 * Includes retry logic for transient failures
 */
async function parseImageWithAIFast(filePath: string, retryCount = 0): Promise<any | null> {
  const MAX_RETRIES = 2;
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const apiKey = process.env.EXPO_PUBLIC_VIBECODE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "vibecode-proxy";

  const imageBuffer = fs.readFileSync(filePath);
  const base64Image = imageBuffer.toString("base64");
  const mimeType = filePath.endsWith(".png") ? "image/png" : "image/jpeg";
  const dataUrl = `data:${mimeType};base64,${base64Image}`;

  console.log(`  📡 [AI] Calling gpt-4o-mini FAST (${(imageBuffer.length / 1024).toFixed(0)}KB)${retryCount > 0 ? ` - Retry ${retryCount}` : ''}...`);
  const startTime = Date.now();

  try {
    // Add timeout controller
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 second timeout

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",  // Full model for accurate schedule parsing (DH, credit, times)
        max_tokens: 4000,      // Multi-day schedules with many flights
        temperature: 0,        // Deterministic for speed
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You are parsing a UPS pilot schedule from Crew Access (crewaccess.inside.ups.com). Extract the trip data EXACTLY as shown.

COLUMN LAYOUT (Crew Access "Trip Information" format):
The table has columns: Day | Flight | Departure-Arrival | Start | Start(LT) | End | End(LT) | Block | A/C | Cnx | PNR | DH | Remark
- "Start" and "End" = ZULU (UTC) times — IGNORE THESE
- "Start(LT)" and "End(LT)" = LOCAL times — USE THESE for scheduledOut/scheduledIn
- "Block" = block time for that leg (H:MM format, e.g. "2:33" = 153 minutes)
- "A/C" = aircraft type (e.g. 757, 767, 757*, 767*)  — strip the asterisk, use the number
- "Cnx" = credit time for that leg — USE THIS for creditMinutes (convert H:MM to minutes)
- "DH" column = deadhead indicator — if it shows a time value, the flight IS a deadhead

DUTY DAY STRUCTURE:
- "Duty start" row gives report time in Start(LT) column
- "Duty end" row gives release time in End(LT) column
- "Duty totals" row shows: Time: HH:MM (duty minutes), Block: H:MM (day block), Rest: HH:MM
- Each duty period has flights listed between "Duty start" and "Duty end"
- The "Day" column shows the calendar day number and day code (e.g. "1 Su", "3 Tu", "4 We")

DATE ASSIGNMENT:
- The trip header shows "Trip Id: XXXXX DDMonYYYY" — this is the trip start date
- Use the "Day" column number to offset from the trip start date
  - Day 1 = trip start date
  - Day 3 = trip start date + 2 days
  - Day 4 = trip start date + 3 days, etc.
- Every leg in a duty period gets the date from its "Day" column

DEADHEAD FLIGHTS:
- Flights labeled "DH" at the start (e.g. "DH AA5644") are deadheads
- Set isDeadhead: true
- blockMinutes = 0 for deadheads
- creditMinutes = value in "DH" column (e.g. "01:01" = 61 minutes) OR 0 if no value shown

AIRCRAFT/EQUIPMENT:
- Read from "A/C" column per leg. Strip asterisk (*). Values like "757", "767", "757*" → use "757" or "767"
- Also extract the base fleet from "Crew: Base:" section at bottom (e.g. "SDF" means base is SDF)
- Put aircraft type in equipment field for each leg

BOTTOM TOTALS ROW (CRITICAL — read these exact values):
The last row before "Crew on trip" shows:
  Block Time: H:MM  |  Credit Time: H:MM  |  Trip Days: N  |  TAFB: HHH:MM
- Convert Block Time H:MM to blockMinutes
- Convert Credit Time H:MM to creditMinutes
- Convert TAFB HHH:MM to tafbMinutes
- These are the AUTHORITATIVE totals — extract them exactly

DUTY PERIOD GROUPING:
Group legs by their "Day" number. Each unique day number = one duty period.
Example: Day 1 gets dutyDayIndex 1, Day 3 gets dutyDayIndex 2, Day 4 gets dutyDayIndex 3, etc.

Return this exact JSON structure:
{"tripNumber":"","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","baseFleet":"SDF","events":[{"date":"YYYY-MM-DD","flightNumber":"","depAirport":"XXX","arrAirport":"XXX","scheduledOut":"HH:MM","scheduledIn":"HH:MM","blockMinutes":0,"creditMinutes":0,"isDeadhead":false,"equipment":"757","dutyDayNumber":1}],"dutyPeriods":[{"dutyDayNumber":1,"startDate":"YYYY-MM-DD","reportTime":"HH:MM","releaseTime":"HH:MM","blockMinutes":0,"creditMinutes":0,"dutyMinutes":0,"restMinutes":0}],"totals":{"blockMinutes":0,"creditMinutes":0,"tafbMinutes":0,"dutyDays":0}}

CRITICAL REMINDERS:
- ALWAYS use Start(LT)/End(LT) columns for times, NEVER Start/End (those are Zulu)
- Extract ALL legs including deadheads
- Read credit from Cnx column per leg, and Credit Time from totals row
- The credit total will be LARGER than block total due to minimum pay rules
- Include ALL duty periods even rest-only days if they appear`,
              },
              {
                type: "image_url",
                image_url: { url: dataUrl, detail: "high" },
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    console.log(`  📡 [AI] Status: ${response.status} (${Date.now() - startTime}ms)`);

    if (!response.ok) {
      const errText = await response.text();
      console.log(`  ❌ [AI] Error: ${errText.substring(0, 200)}`);

      // Retry on rate limit or server errors
      if ((response.status === 429 || response.status >= 500) && retryCount < MAX_RETRIES) {
        const delay = (retryCount + 1) * 2000; // 2s, 4s backoff
        console.log(`  🔄 [AI] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return parseImageWithAIFast(filePath, retryCount + 1);
      }

      throw new Error(`AI API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const responseText = data.choices?.[0]?.message?.content || "";

    // Extract JSON from response - handle markdown code blocks
    let jsonStr = responseText;

    // Remove markdown code block if present
    const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1];
    }

    // Find JSON object
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log(`  ⚠️ [AI] No JSON found in response`);

      // Retry if we got a response but no JSON
      if (retryCount < MAX_RETRIES) {
        console.log(`  🔄 [AI] Retrying to get valid JSON...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return parseImageWithAIFast(filePath, retryCount + 1);
      }
      return null;
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`  ✅ [AI] Parsed ${parsed.events?.length || 0} events, trip: ${parsed.tripNumber || parsed.pairingId || 'unknown'}`);
      return parsed;
    } catch (e) {
      console.log(`  ⚠️ [AI] JSON parse error: ${e}`);

      // Retry on parse error
      if (retryCount < MAX_RETRIES) {
        console.log(`  🔄 [AI] Retrying due to JSON parse error...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return parseImageWithAIFast(filePath, retryCount + 1);
      }
      return null;
    }
  } catch (error: any) {
    // Handle timeout and network errors
    if (error.name === 'AbortError') {
      console.log(`  ⚠️ [AI] Request timed out`);
    } else {
      console.log(`  ⚠️ [AI] Request failed: ${error.message}`);
    }

    // Retry on transient errors
    if (retryCount < MAX_RETRIES) {
      const delay = (retryCount + 1) * 2000;
      console.log(`  🔄 [AI] Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return parseImageWithAIFast(filePath, retryCount + 1);
    }

    throw error;
  }
}

/**
 * Update job progress
 */
async function updateJobProgress(
  jobId: string,
  progress: number,
  currentStep: string
): Promise<void> {
  await db.uploadJob.update({
    where: { id: jobId },
    data: { progress, currentStep },
  });
}

// ============================================
// Cleanup old jobs
// ============================================

/**
 * Clean up completed/failed jobs older than 24 hours
 */
export async function cleanupOldJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const result = await db.uploadJob.deleteMany({
    where: {
      status: { in: ["completed", "failed"] },
      createdAt: { lt: cutoff },
    },
  });

  if (result.count > 0) {
    console.log(`⚡ [JobProcessor] Cleaned up ${result.count} old jobs`);
  }

  return result.count;
}
