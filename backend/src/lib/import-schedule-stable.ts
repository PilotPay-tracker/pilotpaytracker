/**
 * Schedule/Trips Import — Stable Fix Pack
 *
 * - Fixes db.scheduleEvidence.create() crashing
 * - Fixes parsed.sourceType.value crashing
 * - Makes import pipeline stable (create evidence -> parse -> update)
 * - Adds basic Trip Board vs Crew Access source detection
 * - Adds optional Sharp preprocessing hook (safe if Sharp not installed)
 */

import { db } from "../db";
import { performOCRWithRetry } from "./ocr-engine";
import { parseScheduleFromOCR, simplifyParsedSchedule } from "./schedule-parser";

// ============================================
// Types
// ============================================

export type SourceType =
  | "TRIP_BOARD"
  | "CREW_ACCESS"
  | "trip_board_browser"
  | "trip_board_trip_details"
  | "crew_access_trip_info"
  | "crew_access_enrichment_only"
  | "enrichment_only"
  | "unknown"
  | "UNKNOWN";

export type ParseStatus = "processing" | "success" | "partial" | "failed" | "pending";

export type ParsedScheduleResult = {
  sourceType: SourceType;
  classification: "complete" | "incomplete" | "full_schedule" | "enrichment_only";
  confidence?: number;
  events: Array<Record<string, unknown>>;
  totals?: Record<string, unknown>;
  lowConfidenceFields?: string[];
};

// ============================================
// Utilities: never-undefined + JSON coerce
// ============================================

/**
 * Safely coerce any input to a Record<string, any>
 * Handles: null, undefined, strings (JSON), objects
 */
export function coerceJson(input: unknown): Record<string, unknown> {
  if (input == null) return {};
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
      return { _raw: input };
    } catch {
      return { _raw: input };
    }
  }
  if (typeof input === "object") return input as Record<string, unknown>;
  return { _value: input };
}

/**
 * Safe number extraction with fallback
 */
export function safeNumber(input: unknown, fallback = 0): number {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string") {
    const parsed = parseFloat(input);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/**
 * Safe string extraction with fallback
 */
export function safeString(input: unknown, fallback = ""): string {
  if (typeof input === "string") return input;
  if (input === null || input === undefined) return fallback;
  return String(input);
}

/**
 * Detect source type from raw OCR text
 */
export function detectSourceType(text: string): SourceType {
  const t = (text || "").toUpperCase();

  // Trip Board "Trip Details" modal is very distinctive
  if (
    t.includes("TRIP DETAILS") ||
    (t.includes("PAIRING") && t.includes("TAFB") && t.includes("PDIEM"))
  ) {
    return "trip_board_trip_details";
  }

  // Trip Board Browser
  if (t.includes("BROWSER") || t.includes("PAIRING VIEW") || t.includes("REPORT AT")) {
    return "trip_board_browser";
  }

  // Crew Access varies; add phrases you see commonly
  if (
    t.includes("CREW ACCESS") ||
    t.includes("PAIRING SUMMARY") ||
    t.includes("CREW SCHEDULE") ||
    t.includes("TRIP INFORMATION") ||
    t.includes("HOTEL DETAILS")
  ) {
    return "crew_access_trip_info";
  }

  return "unknown";
}

/**
 * Normalize parsed schedule data to ensure it's always a usable object
 * with all required fields
 */
export function normalizeParsedSchedule(
  parsed: unknown,
  rawOcrText: string
): ParsedScheduleResult {
  const obj = coerceJson(parsed);
  const ocrText = safeString(rawOcrText, "");

  // Get sourceType from parsed data or detect from OCR text
  let sourceType: SourceType = "unknown";

  if (obj.sourceType) {
    // Handle both { value: string } and plain string formats
    if (typeof obj.sourceType === "object" && obj.sourceType !== null) {
      const sourceObj = obj.sourceType as Record<string, unknown>;
      sourceType = safeString(sourceObj.value, "unknown") as SourceType;
    } else {
      sourceType = safeString(obj.sourceType, "unknown") as SourceType;
    }
  }

  // If still unknown, detect from OCR text
  if (sourceType === "unknown" || sourceType === "UNKNOWN") {
    sourceType = detectSourceType(ocrText);
  }

  // Normalize classification
  let classification: "complete" | "incomplete" | "full_schedule" | "enrichment_only" = "incomplete";
  const rawClassification = safeString(obj.classification, "incomplete");
  if (rawClassification === "complete" || rawClassification === "full_schedule") {
    classification = "complete";
  } else if (rawClassification === "enrichment_only") {
    classification = "enrichment_only";
  }

  return {
    sourceType,
    classification,
    confidence: safeNumber(obj.confidence, 0),
    events: Array.isArray(obj.events) ? obj.events : [],
    totals: typeof obj.totals === "object" && obj.totals ? (obj.totals as Record<string, unknown>) : {},
    lowConfidenceFields: Array.isArray(obj.lowConfidenceFields) ? obj.lowConfidenceFields : [],
  };
}

// ============================================
// OPTIONAL: Image preprocessing (Sharp)
// - If Sharp is not installed, returns original buffer
// ============================================

export async function preprocessImageIfAvailable(imageBuffer: Buffer): Promise<Buffer> {
  try {
    // Dynamically import so code doesn't break if sharp isn't installed
    const sharpMod = await import("sharp");
    const sharp = sharpMod.default;

    // Upscale + contrast + sharpen helps tables like Trip Board modals
    return await sharp(imageBuffer)
      .resize({ width: 2200 }) // upscale for OCR
      .grayscale()
      .normalize()
      .sharpen()
      .toBuffer();
  } catch {
    // Sharp not installed or error - return original
    return imageBuffer;
  }
}

// ============================================
// Core: Stable import pipeline
// - Creates evidence first (processing)
// - Parses second
// - Updates evidence success/partial/failed
// - NEVER crashes on missing sourceType, undefined values, or JSON strings
// ============================================

export type ImportScheduleArgs = {
  userId: string;
  tripId?: string | null;
  imageUrl: string;
  hash: string;
  imageBuffer?: Buffer;
  ocrText?: string; // Pre-existing OCR text (if already run)
  parsedData?: unknown; // Pre-existing parsed data (if already run)
};

export type ImportScheduleResult = {
  ok: boolean;
  evidenceId: string;
  parseStatus: ParseStatus;
  parsed?: ParsedScheduleResult;
  error?: string;
};

/**
 * Stable import pipeline that:
 * 1. Creates evidence record FIRST (cannot fail)
 * 2. Parses OCR if needed
 * 3. Updates evidence with results
 *
 * This ensures we never crash on undefined values or JSON parsing errors.
 */
export async function importScheduleStable(
  args: ImportScheduleArgs
): Promise<ImportScheduleResult> {
  const { userId, tripId, imageUrl, hash } = args;

  // 1) Create evidence FIRST (cannot fail) - use safe defaults
  const evidence = await db.scheduleEvidence.create({
    data: {
      userId,
      tripId: tripId ?? null,
      imageUrl,
      sourceType: "unknown",
      parseStatus: "processing",
      parseConfidence: 0,
      rawOcrText: "",
      parsedData: JSON.stringify({}),
    },
  });

  try {
    let ocrText = args.ocrText || "";
    let parsedRaw = args.parsedData;

    // 2) If we have a buffer and no OCR text, run OCR
    if (args.imageBuffer && !ocrText) {
      try {
        // Write buffer to temp file for OCR
        const fs = await import("node:fs");
        const path = await import("node:path");
        const crypto = await import("node:crypto");

        const tempDir = path.join(process.cwd(), "uploads");
        const tempFilename = `temp_${crypto.randomBytes(8).toString("hex")}.png`;
        const tempPath = path.join(tempDir, tempFilename);

        // Preprocess if possible
        const processed = await preprocessImageIfAvailable(args.imageBuffer);
        fs.writeFileSync(tempPath, processed);

        // Run OCR
        const ocrResult = await performOCRWithRetry(tempPath);
        ocrText = ocrResult.fullText;

        // Clean up
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // Ignore cleanup errors
        }
      } catch (ocrErr) {
        console.log(`[ImportStable] OCR failed: ${ocrErr}`);
        // Continue with empty OCR text
      }
    }

    // 3) If we have OCR text but no parsed data, parse it
    if (ocrText && !parsedRaw) {
      try {
        // Create a minimal OCRResult compatible object
        const ocrResult = {
          fullText: ocrText,
          lines: [] as Array<{
            text: string;
            confidence: number;
            words: Array<{
              text: string;
              confidence: number;
              bbox: { x0: number; y0: number; x1: number; y1: number };
              line: number;
            }>;
            bbox: { x0: number; y0: number; x1: number; y1: number };
          }>,
          confidence: 80,
          blocks: [] as Array<{
            text: string;
            confidence: number;
            lines: Array<{
              text: string;
              confidence: number;
              words: Array<{
                text: string;
                confidence: number;
                bbox: { x0: number; y0: number; x1: number; y1: number };
                line: number;
              }>;
              bbox: { x0: number; y0: number; x1: number; y1: number };
            }>;
            blockType: "text" | "table" | "unknown";
          }>,
          words: [] as Array<{
            text: string;
            confidence: number;
            bbox: { x0: number; y0: number; x1: number; y1: number };
            line: number;
          }>,
          processingTime: 0,
        };
        const fullParsed = parseScheduleFromOCR(ocrResult);
        parsedRaw = simplifyParsedSchedule(fullParsed);
      } catch (parseErr) {
        console.log(`[ImportStable] Parse failed: ${parseErr}`);
        parsedRaw = {};
      }
    }

    // 4) Normalize the parsed data
    const parsed = normalizeParsedSchedule(parsedRaw, ocrText);

    // 5) Determine status
    const status: ParseStatus =
      parsed.classification === "complete" || parsed.classification === "full_schedule"
        ? "success"
        : parsed.events.length > 0
        ? "partial"
        : "failed";

    // 6) Update evidence (cannot fail)
    await db.scheduleEvidence.update({
      where: { id: evidence.id },
      data: {
        parseStatus: status,
        parseConfidence: safeNumber(parsed.confidence, 0),
        rawOcrText: safeString(ocrText, ""),
        sourceType: safeString(parsed.sourceType, "unknown"),
        parsedData: JSON.stringify(parsed),
      },
    });

    return {
      ok: status !== "failed",
      evidenceId: evidence.id,
      parseStatus: status,
      parsed,
    };
  } catch (err: unknown) {
    // 7) On any error, mark evidence failed (still not crashing)
    const errorMessage =
      err instanceof Error ? err.message : String(err);

    await db.scheduleEvidence.update({
      where: { id: evidence.id },
      data: {
        parseStatus: "failed",
        parsedData: JSON.stringify({
          error: safeString(errorMessage, "Unknown error"),
        }),
        errorMessage: safeString(errorMessage, "Unknown error"),
      },
    });

    return {
      ok: false,
      evidenceId: evidence.id,
      parseStatus: "failed",
      error: safeString(errorMessage, "Unknown error"),
    };
  }
}

// ============================================
// Frontend Safety Fix
// - Replace ANY reference to parsed.sourceType.value with this helper
// ============================================

/**
 * Safely extract sourceType value from parsed data
 * Supports:
 * - parsed.sourceType.value
 * - parsed.sourceType
 * - missing altogether
 */
export function getSourceTypeValue(parsed: unknown): SourceType {
  if (!parsed || typeof parsed !== "object") return "unknown";

  const obj = parsed as Record<string, unknown>;

  // Handle { sourceType: { value: "..." } }
  if (obj.sourceType && typeof obj.sourceType === "object") {
    const sourceObj = obj.sourceType as Record<string, unknown>;
    if (sourceObj.value && typeof sourceObj.value === "string") {
      return sourceObj.value as SourceType;
    }
  }

  // Handle { sourceType: "..." }
  if (obj.sourceType && typeof obj.sourceType === "string") {
    return obj.sourceType as SourceType;
  }

  return "unknown";
}

/**
 * Safely extract any field value from parsed data
 * Handles both { field: { value: x } } and { field: x } formats
 */
export function getFieldValue<T>(
  parsed: unknown,
  fieldPath: string,
  defaultValue: T
): T {
  if (!parsed || typeof parsed !== "object") return defaultValue;

  const obj = parsed as Record<string, unknown>;
  const parts = fieldPath.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (!current || typeof current !== "object") return defaultValue;
    current = (current as Record<string, unknown>)[part];
  }

  // Handle { value: x } wrapper
  if (current && typeof current === "object" && "value" in (current as Record<string, unknown>)) {
    return (current as Record<string, unknown>).value as T;
  }

  if (current === undefined || current === null) return defaultValue;
  return current as T;
}
