import { Hono } from 'hono';
import { type AppType } from '../types';

const OCR_SPACE_API_KEY = 'K85551988788957';
const OCR_SPACE_URL = 'https://api.ocr.space/parse/image';

export const ocrRouter = new Hono<AppType>();

/**
 * POST /api/ocr/extract
 * Main OCR endpoint. Uses OpenAI Vision (gpt-4o) as primary parser for ACARS
 * images since it handles rotation and low-contrast green-on-black displays
 * far better than OCR.space. Falls back to OCR.space if OpenAI is unavailable.
 *
 * Accepts JSON body: { base64Image: string, mimeType: string, engine: '1' | '2' }
 */
ocrRouter.post('/extract', async (c) => {
  try {
    const body = await c.req.json<{
      base64Image: string;
      mimeType: string;
      engine: '1' | '2';
    }>();

    if (!body.base64Image) {
      return c.json({ error: 'base64Image is required' }, 400);
    }

    const mimeType = body.mimeType || 'image/png';
    const openaiKey = process.env.OPENAI_API_KEY;

    // Primary: OpenAI Vision - handles rotated images and green-on-black ACARS displays
    if (openaiKey) {
      console.log('[OCR] Attempting OpenAI Vision parsing (primary)...');
      const visionResult = await parseWithOpenAIVision(body.base64Image, mimeType, openaiKey);
      if (visionResult) {
        console.log('[OCR] OpenAI Vision succeeded, returning structured result');
        return c.json(visionResult);
      }
      console.log('[OCR] OpenAI Vision failed, falling back to OCR.space...');
    } else {
      console.log('[OCR] No OpenAI key, using OCR.space...');
    }

    // Fallback: OCR.space
    const engine = body.engine || '2';
    console.log(`[OCR Proxy] Forwarding to OCR.space, engine=${engine}, base64 length=${body.base64Image.length}`);

    const formData = new FormData();
    formData.append('base64Image', `data:${mimeType};base64,${body.base64Image}`);
    formData.append('apikey', OCR_SPACE_API_KEY);
    formData.append('language', 'eng');
    formData.append('isOverlayRequired', 'false');
    formData.append('detectOrientation', 'true');
    formData.append('scale', 'true');
    formData.append('OCREngine', engine);

    const response = await fetch(OCR_SPACE_URL, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      console.error(`[OCR Proxy] OCR.space error: ${response.status}`);
      return c.json({ error: `OCR service error: ${response.status}` }, 502);
    }

    const result = await response.json() as { IsErroredOnProcessing?: boolean };
    console.log(`[OCR Proxy] OCR.space response, IsErrored=${result.IsErroredOnProcessing}`);

    return c.json(result);
  } catch (error) {
    console.error('[OCR Proxy] Error:', error);
    return c.json({ error: 'OCR proxy failed' }, 500);
  }
});

/**
 * POST /api/ocr/parse-acars
 * Direct ACARS structured data extraction via OpenAI Vision.
 * Returns parsed OOOI data directly without raw OCR text processing.
 */
ocrRouter.post('/parse-acars', async (c) => {
  try {
    const body = await c.req.json<{
      base64Image: string;
      mimeType?: string;
    }>();

    if (!body.base64Image) {
      return c.json({ error: 'base64Image is required' }, 400);
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return c.json({ success: false, error: 'OpenAI not configured' }, 503);
    }

    const mimeType = body.mimeType || 'image/jpeg';
    console.log('[ACARS Vision] Starting direct ACARS parse via OpenAI Vision...');

    const parsed = await parseACARSWithVision(body.base64Image, mimeType, openaiKey);
    return c.json(parsed);
  } catch (error) {
    console.error('[ACARS Vision] Error:', error);
    return c.json({ success: false, error: 'Vision parsing failed' }, 500);
  }
});

/**
 * Use OpenAI Vision to extract raw text in OCR.space compatible format.
 * Returns null if OpenAI fails so caller can fall back.
 */
async function parseWithOpenAIVision(
  base64Image: string,
  mimeType: string,
  apiKey: string
): Promise<object | null> {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `This is an ACARS flight display, possibly rotated. Extract ALL visible text exactly as shown, preserving the structure.
The display may be sideways or at an angle - read it regardless of orientation.
Return ONLY the raw text content you can read, with line breaks between rows. No explanation.`,
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                  detail: 'high',
                },
              },
            ],
          },
        ],
        max_tokens: 800,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[OpenAI Vision] API error:', response.status, err);
      return null;
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const text = data.choices?.[0]?.message?.content || '';
    console.log('[OpenAI Vision] Extracted text:', text.substring(0, 300));

    if (!text || text.length < 10) return null;

    // Return in OCR.space compatible format so mobile client can reuse existing parsing
    return {
      IsErroredOnProcessing: false,
      ParsedResults: [
        {
          ParsedText: text,
          TextOverlay: { confidence: 0.92 },
        },
      ],
    };
  } catch (err) {
    console.error('[OpenAI Vision] Exception:', err);
    return null;
  }
}

/**
 * Full structured ACARS parse via OpenAI Vision.
 * Returns structured OOOI data directly.
 */
async function parseACARSWithVision(
  base64Image: string,
  mimeType: string,
  apiKey: string
): Promise<object> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this ACARS flight display image. It may be rotated or at an angle - read it regardless.

This is a UPS-style ACARS-OOOI screen with green text on black background.

Extract these fields:
- FLT-DATE: flight number (first 3-4 digits before the dash) and date (MM/DD after the dash)
- ORIG-DEST: 3-letter origin and destination airport codes
- OUT: gate departure time (HH:MM, 24hr)
- OFF: takeoff time (HH:MM, 24hr)
- ON: landing time (HH:MM, 24hr)
- IN: gate arrival time (HH:MM, 24hr)
- BLK: block time duration (HH:MM)
- FLT: flight time duration (HH:MM)

Return ONLY valid JSON, no explanation:
{
  "flightNumber": "digits only e.g. 841 or 5501",
  "origin": "3-letter code e.g. SLC",
  "destination": "3-letter code e.g. ONT",
  "date": "YYYY-MM-DD format",
  "outTime": "HH:MM 24hr or null",
  "offTime": "HH:MM 24hr or null",
  "onTime": "HH:MM 24hr or null",
  "inTime": "HH:MM 24hr or null",
  "blockTime": "HH:MM or null",
  "flightTime": "HH:MM or null"
}`,
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
      max_tokens: 400,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content || '';
  console.log('[ACARS Vision] Raw response:', content);

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { success: false, error: 'Could not parse JSON from response', rawText: content };
  }

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, string | null>;

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
    confidence: hasData ? 0.92 : 0,
  };
}
