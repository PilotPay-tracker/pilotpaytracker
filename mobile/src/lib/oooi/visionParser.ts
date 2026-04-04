// src/lib/oooi/visionParser.ts
// ACARS image parsing - OCR first with OpenAI Vision fallback

import * as FileSystem from 'expo-file-system';
import { parseACARSFromImage, parseACARSText, type ACARSParseResult } from './ocrClient';
import { useScanHistoryStore, type ParseMethod } from './scanHistoryStore';

export interface ParseResult {
  success: boolean;
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
  confidence: number;
  rawText?: string;
  error?: string;
}

export interface ExtendedParseResult extends ParseResult {
  method: ParseMethod;
  scanId?: string;
}

// OpenAI Vision parsing (fallback)
async function parseWithOpenAI(imageUri: string): Promise<ParseResult> {
  try {
    const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

    if (!apiKey) {
      return {
        success: false,
        confidence: 0,
        error: 'OpenAI API key not configured',
      };
    }

    // Read image as base64
    const base64Image = await FileSystem.readAsStringAsync(imageUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analyze this ACARS flight document image. This is a UPS-style ACARS display with green text on a black background.

Look for these specific fields:
- FLT-DATE: Contains flight number (first 3-4 digits) and date (MM/DD format)
- ORIG-DEST: Origin and destination airport codes (3-letter codes like LAX-SDF or ONT-MIA)
- OUT: Gate departure time (format HH:MM, like "12:47" or "19:48")
- OFF: Takeoff time (format HH:MM)
- ON: Landing time (format HH:MM)
- IN: Gate arrival time (format HH:MM)
- BLK: Block time duration
- FLT: Flight time duration

Extract the information in JSON format:
{
  "flightNumber": "flight number (just the digits, e.g., 5501 or 2310)",
  "origin": "3-letter origin airport code",
  "destination": "3-letter destination airport code",
  "date": "flight date in YYYY-MM-DD format",
  "outTime": "OUT time in HH:MM format (24-hour)",
  "offTime": "OFF time in HH:MM format (24-hour)",
  "onTime": "ON time in HH:MM format (24-hour)",
  "inTime": "IN time in HH:MM format (24-hour)",
  "blockTime": "block time if shown",
  "flightTime": "flight time if shown"
}

IMPORTANT: Times should be in 24-hour HH:MM format. Only include fields you can clearly read. Use null for fields you cannot determine.`,
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`,
                },
              },
            ],
          },
        ],
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return {
        success: false,
        confidence: 0,
        error: 'No response from OpenAI',
      };
    }

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        success: false,
        confidence: 0,
        error: 'Could not parse response as JSON',
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Check if we got meaningful data
    const hasData = Boolean(parsed.outTime || parsed.offTime || parsed.onTime || parsed.inTime);

    return {
      success: hasData,
      flightNumber: parsed.flightNumber || undefined,
      origin: parsed.origin || undefined,
      destination: parsed.destination || undefined,
      date: parsed.date || undefined,
      outTime: parsed.outTime || undefined,
      offTime: parsed.offTime || undefined,
      onTime: parsed.onTime || undefined,
      inTime: parsed.inTime || undefined,
      blockTime: parsed.blockTime || undefined,
      flightTime: parsed.flightTime || undefined,
      confidence: hasData ? 0.85 : 0,
      rawText: content,
    };
  } catch (error) {
    console.error('OpenAI parsing error:', error);
    return {
      success: false,
      confidence: 0,
      error: error instanceof Error ? error.message : 'OpenAI parsing failed',
    };
  }
}

/**
 * Main parsing function - tries OCR first, falls back to OpenAI
 */
export async function parseOOOIFromImage(
  imageUri: string,
  preferredMethod?: ParseMethod
): Promise<ExtendedParseResult> {
  const addScan = useScanHistoryStore.getState().addScan;

  // If manual is preferred, return empty for manual entry
  if (preferredMethod === 'manual') {
    const scanId = addScan({
      method: 'manual',
      confidence: 1,
      wasApplied: false,
      imageUri,
    });

    return {
      success: true,
      method: 'manual',
      confidence: 1,
      scanId,
    };
  }

  // Try OCR first (free, fast)
  console.log('[VisionParser] Attempting OCR parsing...');
  const ocrResult = await parseACARSFromImage(imageUri);

  console.log('[VisionParser] OCR result:', {
    success: ocrResult.success,
    confidence: ocrResult.confidence,
    hasOutTime: !!ocrResult.data.outTime,
    hasOffTime: !!ocrResult.data.offTime,
    hasOnTime: !!ocrResult.data.onTime,
    hasInTime: !!ocrResult.data.inTime,
    rawTextLength: ocrResult.rawText?.length || 0,
  });

  // Accept OCR result if it has any useful data, even with lower confidence
  if (ocrResult.success && ocrResult.confidence >= 0.3) {
    console.log('[VisionParser] OCR parsing successful with confidence:', ocrResult.confidence);

    const scanId = addScan({
      method: 'ocr',
      confidence: ocrResult.confidence,
      rawText: ocrResult.rawText,
      imageUri,
      flightNumber: ocrResult.data.flightNumber,
      origin: ocrResult.data.origin,
      destination: ocrResult.data.destination,
      date: ocrResult.data.date,
      outTime: ocrResult.data.outTime,
      offTime: ocrResult.data.offTime,
      onTime: ocrResult.data.onTime,
      inTime: ocrResult.data.inTime,
      wasApplied: false,
    });

    return {
      success: true,
      method: 'ocr',
      flightNumber: ocrResult.data.flightNumber,
      origin: ocrResult.data.origin,
      destination: ocrResult.data.destination,
      date: ocrResult.data.date,
      outTime: ocrResult.data.outTime,
      offTime: ocrResult.data.offTime,
      onTime: ocrResult.data.onTime,
      inTime: ocrResult.data.inTime,
      blockTime: ocrResult.data.blockTime,
      flightTime: ocrResult.data.flightTime,
      confidence: ocrResult.confidence,
      rawText: ocrResult.rawText,
      scanId,
    };
  }

  // Fall back to OpenAI Vision if OCR failed or low confidence
  console.log('[VisionParser] OCR insufficient, trying OpenAI Vision...');
  const openaiResult = await parseWithOpenAI(imageUri);

  console.log('[VisionParser] OpenAI result:', {
    success: openaiResult.success,
    confidence: openaiResult.confidence,
    error: openaiResult.error,
  });

  if (openaiResult.success) {
    console.log('[VisionParser] OpenAI parsing successful');

    const scanId = addScan({
      method: 'openai',
      confidence: openaiResult.confidence,
      rawText: openaiResult.rawText,
      imageUri,
      flightNumber: openaiResult.flightNumber,
      origin: openaiResult.origin,
      destination: openaiResult.destination,
      date: openaiResult.date,
      outTime: openaiResult.outTime,
      offTime: openaiResult.offTime,
      onTime: openaiResult.onTime,
      inTime: openaiResult.inTime,
      wasApplied: false,
    });

    return {
      ...openaiResult,
      method: 'openai',
      scanId,
    };
  }

  // Both methods failed - check if we got ANY data from OCR that might be useful
  console.log('[VisionParser] All parsing methods failed');

  // If OCR got some data but below confidence threshold, still return it for manual verification
  const hasPartialData = ocrResult.data.outTime || ocrResult.data.offTime || ocrResult.data.onTime || ocrResult.data.inTime;

  if (hasPartialData) {
    console.log('[VisionParser] Returning partial OCR data for manual review');

    const scanId = addScan({
      method: 'ocr',
      confidence: ocrResult.confidence,
      rawText: ocrResult.rawText,
      imageUri,
      flightNumber: ocrResult.data.flightNumber,
      origin: ocrResult.data.origin,
      destination: ocrResult.data.destination,
      date: ocrResult.data.date,
      outTime: ocrResult.data.outTime,
      offTime: ocrResult.data.offTime,
      onTime: ocrResult.data.onTime,
      inTime: ocrResult.data.inTime,
      wasApplied: false,
    });

    return {
      success: true, // Allow user to use partial data
      method: 'ocr',
      flightNumber: ocrResult.data.flightNumber,
      origin: ocrResult.data.origin,
      destination: ocrResult.data.destination,
      date: ocrResult.data.date,
      outTime: ocrResult.data.outTime,
      offTime: ocrResult.data.offTime,
      onTime: ocrResult.data.onTime,
      inTime: ocrResult.data.inTime,
      blockTime: ocrResult.data.blockTime,
      flightTime: ocrResult.data.flightTime,
      confidence: Math.max(ocrResult.confidence, 0.3), // Minimum confidence for partial data
      rawText: ocrResult.rawText,
      scanId,
    };
  }

  const scanId = addScan({
    method: 'manual',
    confidence: 0,
    rawText: ocrResult.rawText || '',
    imageUri,
    wasApplied: false,
    errorMessage: openaiResult.error || ocrResult.error || 'Parsing failed',
  });

  return {
    success: false,
    method: 'manual',
    confidence: 0,
    rawText: ocrResult.rawText,
    error: 'Could not parse image. Please enter times manually.',
    scanId,
  };
}

/**
 * Parse raw text directly (for manual paste or re-processing)
 */
export function parseOOOIFromText(text: string): ExtendedParseResult {
  const addScan = useScanHistoryStore.getState().addScan;
  const result = parseACARSText(text);

  const scanId = addScan({
    method: 'manual',
    confidence: result.confidence,
    rawText: text,
    flightNumber: result.data.flightNumber,
    origin: result.data.origin,
    destination: result.data.destination,
    date: result.data.date,
    outTime: result.data.outTime,
    offTime: result.data.offTime,
    onTime: result.data.onTime,
    inTime: result.data.inTime,
    wasApplied: false,
  });

  return {
    success: result.success,
    method: 'manual',
    flightNumber: result.data.flightNumber,
    origin: result.data.origin,
    destination: result.data.destination,
    date: result.data.date,
    outTime: result.data.outTime,
    offTime: result.data.offTime,
    onTime: result.data.onTime,
    inTime: result.data.inTime,
    blockTime: result.data.blockTime,
    flightTime: result.data.flightTime,
    confidence: result.confidence,
    rawText: text,
    error: result.error,
    scanId,
  };
}
