// src/lib/oooi/ocrClient.ts
// OCR integration for ACARS parsing — proxied through backend to avoid
// React Native network failures when sending large base64 payloads directly.

import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { BACKEND_URL } from '../api';

const OCR_PROXY_URL = `${BACKEND_URL}/api/ocr/extract`;
const ACARS_VISION_URL = `${BACKEND_URL}/api/ocr/parse-acars`;

export interface OCRResult {
  success: boolean;
  text: string;
  confidence: number;
  error?: string;
}

export interface ParsedACARSData {
  flightNumber?: string;
  origin?: string;
  destination?: string;
  outTime?: string;
  offTime?: string;
  onTime?: string;
  inTime?: string;
  date?: string;
  aircraftTail?: string;
  blockTime?: string;
  flightTime?: string;
}

export interface ACARSParseResult {
  success: boolean;
  data: ParsedACARSData;
  rawText: string;
  confidence: number;
  error?: string;
}

const MAX_FILE_SIZE_KB = 900; // OCR.space limit is 1024 KB, keep some buffer

/**
 * Compress and preprocess image for OCR.
 * Scales to a good resolution for text recognition and stays within OCR.space limit.
 */
async function compressImageForOCR(imageUri: string): Promise<{ uri: string; base64: string }> {
  console.log('[OCR] Checking image size and preprocessing...');

  const fileInfo = await FileSystem.getInfoAsync(imageUri, { size: true });
  const originalSizeKB = (fileInfo as { size?: number }).size
    ? Math.round((fileInfo as { size: number }).size / 1024)
    : 0;
  console.log('[OCR] Original image size:', originalSizeKB, 'KB');

  // Scale to a width that gives OCR enough resolution without exceeding the limit.
  // 1800px is a good sweet-spot for ACARS character sizes.
  const targetWidth = originalSizeKB > 2000 ? 1400 : 1800;

  // Use JPEG format so compress quality actually reduces file size (PNG is lossless - quality is ignored)
  let quality = 0.92;
  let result = await ImageManipulator.manipulateAsync(
    imageUri,
    [{ resize: { width: targetWidth } }],
    { compress: quality, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );

  let estimatedSizeKB = Math.round(((result.base64?.length || 0) * 0.75) / 1024);

  // Progressively reduce quality until within size limit
  while (estimatedSizeKB > MAX_FILE_SIZE_KB && quality > 0.3) {
    quality = Math.max(0.3, quality - 0.15);
    console.log(`[OCR] Reducing quality to ${quality}, size: ${estimatedSizeKB} KB`);
    result = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: targetWidth } }],
      { compress: quality, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
    estimatedSizeKB = Math.round(((result.base64?.length || 0) * 0.75) / 1024);
  }

  console.log('[OCR] Final image size estimate:', estimatedSizeKB, 'KB');
  return { uri: result.uri, base64: result.base64 || '' };
}

/**
 * Extract text from image using OCR.space free API
 */
export async function extractTextFromImage(imageUri: string): Promise<OCRResult> {
  try {
    console.log('[OCR] Starting text extraction from image...');

    // Compress image to meet API size limits
    const { base64: base64Image } = await compressImageForOCR(imageUri);
    console.log('[OCR] Image compressed and converted to base64, length:', base64Image.length);

    // Use JPEG for better compression
    const mimeType = 'image/jpeg';

    // Send through backend proxy to avoid React Native fetch issues with large
    // base64 payloads sent directly to third-party APIs.
    console.log('[OCR] Sending request via backend proxy (Engine 2)...');
    const response = await fetch(OCR_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Image, mimeType, engine: '2' }),
    });

    if (!response.ok) {
      console.error('[OCR] Proxy error status:', response.status);
      throw new Error(`OCR proxy error: ${response.status}`);
    }

    const result = await response.json() as {
      IsErroredOnProcessing?: boolean;
      ErrorMessage?: string[];
      ParsedResults?: Array<{ ParsedText?: string; TextOverlay?: { confidence?: number } }>;
    };
    console.log('[OCR] API response received, IsErrored:', result.IsErroredOnProcessing);

    if (result.IsErroredOnProcessing) {
      console.error('[OCR] Processing error:', result.ErrorMessage);
      // Try again with Engine 1 as fallback
      console.log('[OCR] Retrying with Engine 1...');
      return await extractTextWithEngine1(base64Image, mimeType);
    }

    const parsedResults = result.ParsedResults;
    if (!parsedResults || parsedResults.length === 0) {
      console.error('[OCR] No parsed results returned, trying Engine 1...');
      return await extractTextWithEngine1(base64Image, mimeType);
    }

    const text = parsedResults[0].ParsedText || '';
    const confidence = parsedResults[0].TextOverlay?.confidence || 0.8;

    console.log('[OCR] Extracted text length:', text.length);
    console.log('[OCR] Extracted text preview:', text.substring(0, 500));
    console.log('[OCR] Full OCR text:', text);
    console.log('[OCR] Confidence:', confidence);

    // If we got very little text, try Engine 1
    if (text.length < 20) {
      console.log('[OCR] Insufficient text, trying Engine 1...');
      const engine1Result = await extractTextWithEngine1(base64Image, mimeType);
      if (engine1Result.text.length > text.length) {
        return engine1Result;
      }
    }

    return {
      success: text.length > 0,
      text: text.trim(),
      confidence: text.length > 0 ? confidence : 0,
    };
  } catch (error) {
    console.error('[OCR] Extraction error:', error);
    return {
      success: false,
      text: '',
      confidence: 0,
      error: error instanceof Error ? error.message : 'Unknown OCR error',
    };
  }
}

/**
 * Fallback OCR extraction using Engine 1
 * Engine 1 can sometimes work better for certain image types
 */
async function extractTextWithEngine1(base64Image: string, mimeType: string): Promise<OCRResult> {
  try {
    const response = await fetch(OCR_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Image, mimeType, engine: '1' }),
    });

    if (!response.ok) {
      throw new Error(`OCR proxy error: ${response.status}`);
    }

    const result = await response.json() as {
      IsErroredOnProcessing?: boolean;
      ErrorMessage?: string[];
      ParsedResults?: Array<{ ParsedText?: string; TextOverlay?: { confidence?: number } }>;
    };

    if (result.IsErroredOnProcessing) {
      return {
        success: false,
        text: '',
        confidence: 0,
        error: result.ErrorMessage?.[0] || 'OCR Engine 1 processing failed',
      };
    }

    const parsedResults = result.ParsedResults;
    if (!parsedResults || parsedResults.length === 0) {
      return {
        success: false,
        text: '',
        confidence: 0,
        error: 'No text detected with Engine 1',
      };
    }

    const text = parsedResults[0].ParsedText || '';
    const confidence = parsedResults[0].TextOverlay?.confidence || 0.7;

    console.log('[OCR Engine 1] Extracted text length:', text.length);
    console.log('[OCR Engine 1] Extracted text preview:', text.substring(0, 500));

    return {
      success: text.length > 0,
      text: text.trim(),
      confidence: text.length > 0 ? confidence : 0,
    };
  } catch (error) {
    console.error('[OCR Engine 1] Error:', error);
    return {
      success: false,
      text: '',
      confidence: 0,
      error: error instanceof Error ? error.message : 'Engine 1 OCR failed',
    };
  }
}

/**
 * Parse ACARS text to extract OOOI times and flight data
 * Enhanced version with better pattern matching for various ACARS formats
 * Optimized for UPS ACARS-OOOI format (green on black displays)
 */
export function parseACARSText(text: string): ACARSParseResult {
  console.log('[ACARS Parse] Starting text parsing...');
  console.log('[ACARS Parse] Raw input text:', text);

  if (!text || text.trim().length === 0) {
    console.log('[ACARS Parse] Empty text provided');
    return {
      success: false,
      data: {},
      rawText: text,
      confidence: 0,
      error: 'Empty text provided',
    };
  }

  const data: ParsedACARSData = {};
  let fieldsFound = 0;
  const totalExpectedFields = 8; // flight, origin, dest, out, off, on, in, date

  // Normalize text - handle various line endings, spacing, and OCR artifacts
  // Keep original case for some patterns, then uppercase
  const normalizedText = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Common OCR misreads for ACARS green-on-black displays
    .replace(/[|l]/g, (match, offset, str) => {
      // Only replace | with I if it's likely a character
      if (match === '|') return 'I';
      return match;
    })
    .replace(/0(?=[A-Z]{2})/g, 'O') // 0 before airport code likely O
    .replace(/Ø/g, '0') // Slashed zero
    .replace(/ø/g, '0')
    .toUpperCase();

  console.log('[ACARS Parse] Normalized text:', normalizedText);

  const lines = normalizedText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  console.log('[ACARS Parse] Lines:', lines);

  // ===========================================
  // UPS ACARS-OOOI specific format detection
  // Example from images:
  // ACARS-0001 - CURR 1/5
  // FLT-DATE 2310-01/14   ORIG-DEST ONT-MIA
  // OUT 19:48    OFF 20:08
  // IN  00:34    ON  00:29
  // BLK 04:46    FLT 04:21
  // ===========================================
  const isUPSFormat = normalizedText.includes('ACARS') ||
                      normalizedText.includes('FLT-DATE') ||
                      normalizedText.includes('ORIG-DEST') ||
                      normalizedText.includes('BLK') ||
                      normalizedText.includes('CURR') ||
                      (normalizedText.includes('OUT') && normalizedText.includes('OFF') &&
                       normalizedText.includes('ON') && normalizedText.includes('IN'));

  if (isUPSFormat) {
    console.log('[ACARS Parse] Detected UPS ACARS-OOOI format');

    // UPS FLT-DATE format: "FLT-DATE 5501-01/07" or "2310-01/14"
    // Flight number is first 3-4 digits, then date is MM/DD
    const fltDatePatterns = [
      /FLT[\s-]*DATE[\s:]*(\d{3,4})[\s-]*(\d{1,2})[\/](\d{1,2})/i,
      /(\d{4})[\s-]+(\d{1,2})[\/](\d{1,2})/,
    ];

    for (const pattern of fltDatePatterns) {
      const fltDateMatch = normalizedText.match(pattern);
      if (fltDateMatch && !data.flightNumber) {
        data.flightNumber = fltDateMatch[1];
        // Parse date - assume current year, format MM/DD
        const month = fltDateMatch[2]?.padStart(2, '0');
        const day = fltDateMatch[3]?.padStart(2, '0');
        const year = new Date().getFullYear();
        data.date = `${year}-${month}-${day}`;
        fieldsFound += 2;
        console.log('[ACARS Parse] UPS FLT-DATE:', data.flightNumber, data.date);
        break;
      }
    }

    // UPS ORIG-DEST format: "ORIG-DEST ONT-MIA" or "LAX-SDF"
    const origDestPatterns = [
      /ORIG[\s-]*DEST[\s:]*([A-Z]{3})[\s-]+([A-Z]{3})/i,
      /ORIG[\s-]*DEST[\s:]*([A-Z]{3})[\s]*-[\s]*([A-Z]{3})/i,
      /([A-Z]{3})[\s]*-[\s]*([A-Z]{3})(?!\d)/, // XXX-XXX but not followed by digit
    ];

    for (const pattern of origDestPatterns) {
      const origDestMatch = normalizedText.match(pattern);
      if (origDestMatch && !data.origin) {
        data.origin = origDestMatch[1];
        data.destination = origDestMatch[2];
        fieldsFound += 2;
        console.log('[ACARS Parse] UPS ORIG-DEST:', data.origin, '->', data.destination);
        break;
      }
    }

    // UPS specific time patterns - handles various spacings and OCR artifacts.
    // We use a line-level approach: split by newline and search each line so that
    // the short labels (OUT, OFF, ON, IN) cannot accidentally match mid-word.

    const lineBasedTimeSearch = (
      label: string,
      altLabels: string[] = []
    ): string | undefined => {
      const allLabels = [label, ...altLabels];
      for (const ln of lines) {
        for (const lbl of allLabels) {
          // Match label at start of the token (word boundary on the left, any
          // whitespace/colon separator, then HH:MM or HHMM).
          const rx = new RegExp(
            `(?:^|\\s)${lbl}[\\s:]+([0-2]?[0-9])[:.]([0-5][0-9])(?:[Z\\s]|$)`,
            'i'
          );
          const m = ln.match(rx);
          if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
        }
      }
      return undefined;
    };

    const upsOutResult = lineBasedTimeSearch('OUT', ['0UT']);
    if (upsOutResult && !data.outTime) {
      data.outTime = upsOutResult;
      fieldsFound++;
      console.log('[ACARS Parse] UPS OUT time:', data.outTime);
    }

    const upsOffResult = lineBasedTimeSearch('OFF', ['0FF']);
    if (upsOffResult && !data.offTime) {
      data.offTime = upsOffResult;
      fieldsFound++;
      console.log('[ACARS Parse] UPS OFF time:', data.offTime);
    }

    // ON time – must only match the label "ON" exactly, not partial words.
    // We require it to be preceded by whitespace or start-of-line and followed
    // by whitespace/colon, NOT by a letter (avoids CONN, DONE, etc.).
    const upsOnResult = lineBasedTimeSearch('ON');
    if (upsOnResult && !data.onTime) {
      data.onTime = upsOnResult;
      fieldsFound++;
      console.log('[ACARS Parse] UPS ON time:', data.onTime);
    }

    // IN time – same strictness.
    const upsInResult = lineBasedTimeSearch('IN', ['1N']);
    if (upsInResult && !data.inTime) {
      data.inTime = upsInResult;
      fieldsFound++;
      console.log('[ACARS Parse] UPS IN time:', data.inTime);
    }

    // UPS block/flight time: "BLK 04:46", "FLT 04:21"
    const blkMatch = normalizedText.match(/BLK[\s:]*(\d{1,2}):(\d{2})/i);
    if (blkMatch) {
      data.blockTime = `${blkMatch[1].padStart(2, '0')}:${blkMatch[2]}`;
      console.log('[ACARS Parse] UPS BLK time:', data.blockTime);
    }

    // FLT can be flight number OR flight time - only match if followed by HH:MM pattern
    const fltTimeMatch = normalizedText.match(/\bFLT[\s:]+(\d{1,2}):(\d{2})(?!\d)/i);
    if (fltTimeMatch) {
      const hours = parseInt(fltTimeMatch[1], 10);
      const mins = parseInt(fltTimeMatch[2], 10);
      // Flight time should be reasonable (under 20 hours, valid minutes)
      if (hours < 20 && mins < 60) {
        data.flightTime = `${fltTimeMatch[1].padStart(2, '0')}:${fltTimeMatch[2]}`;
        console.log('[ACARS Parse] UPS FLT time:', data.flightTime);
      }
    }
  }

  // Flight number patterns - expanded
  const flightPatterns = [
    /\b(FLT|FLIGHT)[:\s#]*([A-Z]{2,3}\s*\d{1,4}[A-Z]?)\b/i,
    /\b([A-Z]{2})\s*(\d{3,4}[A-Z]?)\b/, // AA1234
    /\bFLT\s*#?\s*(\d{3,4})\b/i,
    /\b(\d{4})\s*[A-Z]{3}\s*[-\/]\s*[A-Z]{3}\b/, // 1234 PHX-ONT (flight number before route)
  ];

  for (const pattern of flightPatterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      data.flightNumber = match[2] || match[1];
      if (data.flightNumber) {
        data.flightNumber = data.flightNumber.replace(/\s+/g, '');
        fieldsFound++;
        console.log('[ACARS Parse] Found flight number:', data.flightNumber);
        break;
      }
    }
  }

  // Airport codes (3-letter IATA) - enhanced patterns
  const airportPatterns = [
    /\b([A-Z]{3})\s*[-\/→>]\s*([A-Z]{3})\b/, // PHX-ONT, PHX/ONT, PHX→ONT
    /\b([A-Z]{3})\s+TO\s+([A-Z]{3})\b/i, // PHX TO ONT
    /\bFROM\s+([A-Z]{3})\s+TO\s+([A-Z]{3})\b/i, // FROM PHX TO ONT
  ];

  for (const pattern of airportPatterns) {
    const airportMatch = normalizedText.match(pattern);
    if (airportMatch) {
      data.origin = airportMatch[1];
      data.destination = airportMatch[2];
      fieldsFound += 2;
      console.log('[ACARS Parse] Found route:', data.origin, '->', data.destination);
      break;
    }
  }

  // If no route found, try separate origin/destination patterns
  if (!data.origin || !data.destination) {
    const originPatterns = [
      /\b(FROM|ORIG|ORIGIN|DEP)[:\s]*([A-Z]{3})\b/i,
      /\bORIG[:\s]*([A-Z]{3})\b/i,
    ];
    const destPatterns = [
      /\b(TO|DEST|DESTINATION|ARR)[:\s]*([A-Z]{3})\b/i,
      /\bDEST[:\s]*([A-Z]{3})\b/i,
    ];

    for (const pattern of originPatterns) {
      const match = normalizedText.match(pattern);
      if (match && !data.origin) {
        data.origin = match[2] || match[1];
        fieldsFound++;
        break;
      }
    }

    for (const pattern of destPatterns) {
      const match = normalizedText.match(pattern);
      if (match && !data.destination) {
        data.destination = match[2] || match[1];
        fieldsFound++;
        break;
      }
    }
  }

  // Helper to format time from 3-4 digit number
  const formatTime = (t: string | undefined): string | undefined => {
    if (!t) return undefined;
    const cleaned = t.replace(/[^0-9]/g, '');
    if (cleaned.length < 3 || cleaned.length > 4) return undefined;
    const padded = cleaned.padStart(4, '0');
    const hours = parseInt(padded.slice(0, 2), 10);
    const mins = parseInt(padded.slice(2), 10);
    if (hours > 23 || mins > 59) return undefined;
    return `${padded.slice(0, 2)}:${padded.slice(2)}`;
  };

  // Time patterns - OOOI (Out, Off, On, In)
  // Format: HH:MM, HHMM, or H:MM, possibly with Z suffix for Zulu time

  // OUT time patterns - expanded
  const outPatterns = [
    /(?:^|\s)OUT[\s:]*(\d{1,2}):?(\d{2})Z?(?:\s|$)/i,
    /\bPUSH\s*(?:BACK)?[\s:]*(\d{1,2}):?(\d{2})Z?\b/i,
    /\bGATE\s*DEP(?:ART(?:URE)?)?[\s:]*(\d{1,2}):?(\d{2})Z?\b/i,
    /\bBLOCK\s*OUT[\s:]*(\d{1,2}):?(\d{2})Z?\b/i,
    /\bDEP(?:ART)?[\s:]*(\d{1,2}):?(\d{2})Z?\b/i,
    /(?:^|\s)0UT[\s:]*(\d{1,2}):?(\d{2})Z?(?:\s|$)/i, // OCR misread O as 0
  ];

  for (const pattern of outPatterns) {
    const match = normalizedText.match(pattern);
    if (match && !data.outTime) {
      data.outTime = `${match[1].padStart(2, '0')}:${match[2]}`;
      fieldsFound++;
      console.log('[ACARS Parse] Found OUT time:', data.outTime);
      break;
    }
  }

  // OFF time patterns (takeoff) - expanded
  const offPatterns = [
    /\bOFF[:\s]*(\d{1,2}):?(\d{2})Z?\b/i,
    /\bT\/O[:\s]*(\d{1,2}):?(\d{2})Z?\b/i,
    /\bTAKE[\s-]?OFF[:\s]*(\d{1,2}):?(\d{2})Z?\b/i,
    /\bAIRBORNE[:\s]*(\d{1,2}):?(\d{2})Z?\b/i,
    /\bWHEELS\s*UP[:\s]*(\d{1,2}):?(\d{2})Z?\b/i,
    /\bLIFT[\s-]?OFF[:\s]*(\d{1,2}):?(\d{2})Z?\b/i,
    /\b0FF[:\s]*(\d{1,2}):?(\d{2})Z?\b/i, // OCR misread O as 0
  ];

  for (const pattern of offPatterns) {
    const match = normalizedText.match(pattern);
    if (match && !data.offTime) {
      data.offTime = `${match[1].padStart(2, '0')}:${match[2]}`;
      fieldsFound++;
      console.log('[ACARS Parse] Found OFF time:', data.offTime);
      break;
    }
  }

  // ON time patterns (landing) - expanded
  // Use line-level matching to prevent partial word matches (e.g. "CONN", "DONE")
  const onPatterns = [
    /(?:^|\s)ON[\s:]+(\d{1,2}):?(\d{2})Z?(?:\s|$)/i,
    /\bT\/D[\s:]*(\d{1,2}):?(\d{2})Z?\b/i,
    /\bTOUCH[\s-]?DOWN[\s:]*(\d{1,2}):?(\d{2})Z?\b/i,
    /\bLAND(?:ING|ED)?[\s:]*(\d{1,2}):?(\d{2})Z?\b/i,
    /\bWHEELS\s*DOWN[\s:]*(\d{1,2}):?(\d{2})Z?\b/i,
    /\bARRIV(?:AL|ED)?[\s:]*(\d{1,2}):?(\d{2})Z?\b/i,
    /(?:^|\s)0N[\s:]+(\d{1,2}):?(\d{2})Z?(?:\s|$)/i, // OCR misread O as 0
  ];

  for (const pattern of onPatterns) {
    const match = normalizedText.match(pattern);
    if (match && !data.onTime) {
      data.onTime = `${match[1].padStart(2, '0')}:${match[2]}`;
      fieldsFound++;
      console.log('[ACARS Parse] Found ON time:', data.onTime);
      break;
    }
  }

  // IN time patterns (gate arrival) - expanded
  // Use line-level matching to prevent partial word matches ("MAIN", "CABIN", etc.)
  const inPatterns = [
    /(?:^|\s)IN[\s:]+(\d{1,2}):?(\d{2})Z?(?:\s|$)/i,
    /\bGATE\s*ARR(?:IVAL)?[\s:]*(\d{1,2}):?(\d{2})Z?\b/i,
    /\bBLOCK\s*IN[\s:]*(\d{1,2}):?(\d{2})Z?\b/i,
    /\bON[\s-]?BLOCK[\s:]*(\d{1,2}):?(\d{2})Z?\b/i,
    /\bCHOCKS[\s:]*(\d{1,2}):?(\d{2})Z?\b/i,
    /(?:^|\s)1N[\s:]+(\d{1,2}):?(\d{2})Z?(?:\s|$)/i, // OCR misread I as 1
  ];

  for (const pattern of inPatterns) {
    const match = normalizedText.match(pattern);
    if (match && !data.inTime) {
      data.inTime = `${match[1].padStart(2, '0')}:${match[2]}`;
      fieldsFound++;
      console.log('[ACARS Parse] Found IN time:', data.inTime);
      break;
    }
  }

  // Try to find times in table format (common in ACARS)
  // Format: OUT OFF ON IN
  //         1234 1245 1356 1410
  if (!data.outTime || !data.offTime || !data.onTime || !data.inTime) {
    // Look for header row patterns
    const tablePatterns = [
      /OUT\s+OFF\s+ON\s+IN/i,
      /OUT\s+0FF\s+0N\s+IN/i, // OCR misreads
      /0UT\s+OFF\s+ON\s+1N/i,
    ];

    for (const headerPattern of tablePatterns) {
      const tableHeaderMatch = normalizedText.match(headerPattern);
      if (tableHeaderMatch) {
        const headerIndex = normalizedText.indexOf(tableHeaderMatch[0]);
        const afterHeader = normalizedText.slice(headerIndex + tableHeaderMatch[0].length);
        // Match 4 groups of 3-4 digits
        const timeLineMatch = afterHeader.match(/(\d{3,4})\s+(\d{3,4})\s+(\d{3,4})\s+(\d{3,4})/);
        if (timeLineMatch) {
          console.log('[ACARS Parse] Found table format times');
          if (!data.outTime) {
            const formatted = formatTime(timeLineMatch[1]);
            if (formatted) { data.outTime = formatted; fieldsFound++; }
          }
          if (!data.offTime) {
            const formatted = formatTime(timeLineMatch[2]);
            if (formatted) { data.offTime = formatted; fieldsFound++; }
          }
          if (!data.onTime) {
            const formatted = formatTime(timeLineMatch[3]);
            if (formatted) { data.onTime = formatted; fieldsFound++; }
          }
          if (!data.inTime) {
            const formatted = formatTime(timeLineMatch[4]);
            if (formatted) { data.inTime = formatted; fieldsFound++; }
          }
          break;
        }
      }
    }
  }

  // Try to find times in a row format without headers (just 4 consecutive times)
  // This is a fallback if no labeled times were found
  if (!data.outTime && !data.offTime && !data.onTime && !data.inTime) {
    // Look for patterns like "1234 1256 1423 1445" anywhere in text
    const fourTimesMatch = normalizedText.match(/\b(\d{3,4})[ \/]+(\d{3,4})[ \/]+(\d{3,4})[ \/]+(\d{3,4})\b/);
    if (fourTimesMatch) {
      console.log('[ACARS Parse] Found 4 consecutive times pattern');
      const times = [fourTimesMatch[1], fourTimesMatch[2], fourTimesMatch[3], fourTimesMatch[4]];
      const formattedTimes = times.map(formatTime).filter(Boolean);

      // Validate that times are in chronological order (OUT < OFF < ON < IN)
      if (formattedTimes.length === 4) {
        const timeValues = formattedTimes.map(t => {
          const [h, m] = t!.split(':').map(Number);
          return h * 60 + m;
        });

        // Check if times are roughly in order (allow for overnight flights)
        let valid = true;
        for (let i = 1; i < timeValues.length; i++) {
          const diff = (timeValues[i] - timeValues[i-1] + 1440) % 1440;
          if (diff > 720) valid = false; // More than 12 hours between events is suspicious
        }

        if (valid) {
          data.outTime = formattedTimes[0];
          data.offTime = formattedTimes[1];
          data.onTime = formattedTimes[2];
          data.inTime = formattedTimes[3];
          fieldsFound += 4;
          console.log('[ACARS Parse] Assigned consecutive times:', data.outTime, data.offTime, data.onTime, data.inTime);
        }
      }
    }
  }

  // Date patterns - expanded
  const datePatterns = [
    /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/, // MM/DD/YYYY or DD/MM/YYYY
    /\b(\d{2})([A-Z]{3})(\d{2,4})\b/i, // 15JAN2024
    /\b([A-Z]{3})\s*(\d{1,2}),?\s*(\d{4})\b/i, // JAN 15, 2024
    /\b(\d{4})[\/\-](\d{2})[\/\-](\d{2})\b/, // YYYY-MM-DD
  ];

  for (const pattern of datePatterns) {
    const match = normalizedText.match(pattern);
    if (match && !data.date) {
      data.date = match[0];
      fieldsFound++;
      console.log('[ACARS Parse] Found date:', data.date);
      break;
    }
  }

  // Aircraft tail number
  const tailPatterns = [
    /\b(TAIL|A\/C|AIRCRAFT)[:\s#]*([A-Z]?\d{3,5}[A-Z]{0,2})\b/i,
    /\bN(\d{3,5}[A-Z]{0,2})\b/, // US registration
  ];

  for (const pattern of tailPatterns) {
    const match = normalizedText.match(pattern);
    if (match && !data.aircraftTail) {
      data.aircraftTail = match[2] || `N${match[1]}`;
      console.log('[ACARS Parse] Found tail number:', data.aircraftTail);
      break;
    }
  }

  // Block time and flight time
  const blockTimeMatch = normalizedText.match(/\b(BLK|BLOCK)[\s:-]*(\d{1,2}):?(\d{2})\b/i);
  if (blockTimeMatch) {
    data.blockTime = `${blockTimeMatch[2].padStart(2, '0')}:${blockTimeMatch[3]}`;
  }

  const flightTimeMatch = normalizedText.match(/\b(FLT|FLIGHT)[\s:-]*TIME[\s:-]*(\d{1,2}):?(\d{2})\b/i);
  if (flightTimeMatch) {
    data.flightTime = `${flightTimeMatch[2].padStart(2, '0')}:${flightTimeMatch[3]}`;
  }

  // Calculate confidence based on fields found
  const confidence = Math.min(fieldsFound / totalExpectedFields, 1);

  // Determine success - need at least some OOOI times
  // Lowered requirement: even 1 time pair is useful
  const hasOOOIData = Boolean(data.outTime || data.offTime || data.onTime || data.inTime);
  const hasMinimumData = Boolean(
    (data.outTime && data.inTime) ||
    (data.offTime && data.onTime) ||
    hasOOOIData // Accept even partial data
  );

  console.log('[ACARS Parse] Result - fieldsFound:', fieldsFound, 'hasMinimumData:', hasMinimumData, 'confidence:', confidence);
  console.log('[ACARS Parse] Parsed data:', JSON.stringify(data));

  return {
    success: hasMinimumData,
    data,
    rawText: text,
    confidence: hasMinimumData ? Math.max(confidence, 0.5) : confidence, // Boost confidence if we got data
    error: hasMinimumData ? undefined : 'Could not extract sufficient OOOI data from text',
  };
}

/**
 * Full pipeline: Extract text from image and parse ACARS data.
 * First tries the backend's direct vision parse endpoint (GPT-4o, handles rotation).
 * Falls back to OCR text extraction + regex parsing if that fails.
 */
export async function parseACARSFromImage(imageUri: string): Promise<ACARSParseResult> {
  console.log('[parseACARSFromImage] Starting ACARS parse pipeline...');

  // Step 1: Try direct vision parsing (GPT-4o via backend - handles rotated ACARS images)
  try {
    const { base64: base64Image } = await compressImageForOCR(imageUri);
    console.log('[parseACARSFromImage] Trying direct vision endpoint...');

    const response = await fetch(ACARS_VISION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Image, mimeType: 'image/png' }),
    });

    if (response.ok) {
      const visionData = await response.json() as {
        success?: boolean;
        flightNumber?: string;
        origin?: string;
        destination?: string;
        date?: string;
        outTime?: string;
        offTime?: string;
        onTime?: string;
        inTime?: string;
        blockTime?: string;
        flightTime?: string;
        confidence?: number;
        error?: string;
      };

      console.log('[parseACARSFromImage] Vision endpoint response:', JSON.stringify(visionData));

      if (visionData.success && (visionData.outTime || visionData.offTime || visionData.onTime || visionData.inTime)) {
        return {
          success: true,
          data: {
            flightNumber: visionData.flightNumber,
            origin: visionData.origin,
            destination: visionData.destination,
            date: visionData.date,
            outTime: visionData.outTime,
            offTime: visionData.offTime,
            onTime: visionData.onTime,
            inTime: visionData.inTime,
            blockTime: visionData.blockTime,
            flightTime: visionData.flightTime,
          },
          rawText: `Vision parsed: ${visionData.flightNumber || ''} ${visionData.origin || ''}-${visionData.destination || ''}`,
          confidence: visionData.confidence ?? 0.92,
        };
      }
    }
    console.log('[parseACARSFromImage] Vision endpoint did not return usable data, falling back to OCR...');
  } catch (err) {
    console.log('[parseACARSFromImage] Vision endpoint failed:', err);
  }

  // Step 2: Fall back to OCR text extraction + regex parsing
  const ocrResult = await extractTextFromImage(imageUri);

  if (!ocrResult.success) {
    return {
      success: false,
      data: {},
      rawText: '',
      confidence: 0,
      error: ocrResult.error || 'OCR extraction failed',
    };
  }

  // Step 3: Parse the extracted text
  const parseResult = parseACARSText(ocrResult.text);

  // Adjust confidence based on OCR confidence
  parseResult.confidence = parseResult.confidence * ocrResult.confidence;

  return parseResult;
}
