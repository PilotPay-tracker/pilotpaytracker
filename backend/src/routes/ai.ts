/**
 * AI API Proxy Routes
 * Proxies AI API calls to keep API keys secure on the backend
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { type ContentfulStatusCode } from "hono/utils/http-status";
import { type AppType } from "../types";
import { env } from "../env";
import { aiRateLimit } from "../middleware/rate-limit";
import {
  payExplanationRequestSchema,
  type PayExplanationRequest,
  type PayExplanationResponse,
  type PayExplanationSection,
  type PayVerificationStatus,
} from "@/shared/contracts";

const aiRouter = new Hono<AppType>();

// Apply AI rate limiting to all routes
aiRouter.use("*", aiRateLimit);

// Require authentication for all AI routes
aiRouter.use("*", async (c, next) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }
  return next();
});

/**
 * OpenAI Chat Completion Proxy
 * POST /api/ai/openai/chat
 */
aiRouter.post("/openai/chat", async (c) => {
  if (!env.OPENAI_API_KEY) {
    return c.json({ error: "OpenAI API not configured" }, 503);
  }

  try {
    const body = await c.req.json();

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      const errorObj = data.error as Record<string, unknown> | undefined;
      return c.json({ error: errorObj?.message || "OpenAI API error" }, response.status as ContentfulStatusCode);
    }

    return c.json(data as Record<string, unknown>);
  } catch (error) {
    console.error("OpenAI proxy error:", error);
    return c.json({ error: "Failed to process AI request" }, 500);
  }
});

/**
 * Anthropic Claude Proxy
 * POST /api/ai/anthropic/messages
 */
aiRouter.post("/anthropic/messages", async (c) => {
  if (!env.ANTHROPIC_API_KEY) {
    return c.json({ error: "Anthropic API not configured" }, 503);
  }

  try {
    const body = await c.req.json();

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      const errorObj = data.error as Record<string, unknown> | undefined;
      return c.json({ error: errorObj?.message || "Anthropic API error" }, response.status as ContentfulStatusCode);
    }

    return c.json(data as Record<string, unknown>);
  } catch (error) {
    console.error("Anthropic proxy error:", error);
    return c.json({ error: "Failed to process AI request" }, 500);
  }
});

/**
 * ElevenLabs Text-to-Speech Proxy
 * POST /api/ai/elevenlabs/tts
 */
aiRouter.post("/elevenlabs/tts", async (c) => {
  if (!env.ELEVENLABS_API_KEY) {
    return c.json({ error: "ElevenLabs API not configured" }, 503);
  }

  try {
    const body = await c.req.json();
    const { voice_id, text, model_id } = body;

    if (!voice_id || !text) {
      return c.json({ error: "voice_id and text are required" }, 400);
    }

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": env.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: model_id || "eleven_monolingual_v1",
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
      return c.json({ error: (errorData.detail as string) || "ElevenLabs API error" }, response.status as ContentfulStatusCode);
    }

    // Return audio as base64
    const audioBuffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString("base64");

    return c.json({
      audio: base64Audio,
      content_type: response.headers.get("content-type") || "audio/mpeg"
    });
  } catch (error) {
    console.error("ElevenLabs proxy error:", error);
    return c.json({ error: "Failed to process TTS request" }, 500);
  }
});

/**
 * Check available AI services
 * GET /api/ai/status
 */
aiRouter.get("/status", async (c) => {
  return c.json({
    openai: !!env.OPENAI_API_KEY,
    anthropic: !!env.ANTHROPIC_API_KEY,
    grok: !!env.GROK_API_KEY,
    google: !!env.GOOGLE_API_KEY,
    elevenlabs: !!env.ELEVENLABS_API_KEY,
  });
});

// ============================================
// PAY STATEMENT AI EXPLANATIONS
// ============================================

/**
 * Helper function to format cents as currency
 */
function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Helper function to format minutes as hours
 */
function formatHours(minutes: number): string {
  return `${(minutes / 60).toFixed(2)} hours`;
}

/**
 * Build the AI prompt for pay explanations
 */
function buildPayExplanationPrompt(data: PayExplanationRequest): string {
  const { section, projectedData, actualData, context } = data;

  const positionLabel = context.position === "CPT" ? "Captain" : "First Officer";
  const yos = context.yearOfService ? `Year ${context.yearOfService}` : "";

  let prompt = `You are a professional payroll analyst explaining a pilot's pay statement. Be factual, contract-aware, and non-speculative. Use professional, neutral language.

CONTEXT:
- Airline: ${context.airline}
- Position: ${positionLabel} ${yos}
- Pay Period: ${context.payPeriodStart || "Current"} to ${context.payPeriodEnd || "Present"}
${context.filingStatus ? `- Filing Status: ${context.filingStatus}` : ""}
${context.stateOfResidence ? `- State of Residence: ${context.stateOfResidence}` : ""}

PROJECTED PAY DATA:
- Gross Pay: ${formatCents(projectedData.grossPayCents)}
- Credit Time: ${formatHours(projectedData.creditMinutes)}
- Block Time: ${formatHours(projectedData.blockMinutes)}
- Hourly Rate: ${formatCents(projectedData.hourlyRateCents)}/hr
${projectedData.netPayCents ? `- Net Pay: ${formatCents(projectedData.netPayCents)}` : ""}
${projectedData.federalWithholdingCents ? `- Federal Tax: ${formatCents(projectedData.federalWithholdingCents)}` : ""}
${projectedData.stateWithholdingCents ? `- State Tax: ${formatCents(projectedData.stateWithholdingCents)}` : ""}
${projectedData.socialSecurityCents ? `- Social Security: ${formatCents(projectedData.socialSecurityCents)}` : ""}
${projectedData.medicareCents ? `- Medicare: ${formatCents(projectedData.medicareCents)}` : ""}
${projectedData.pretaxDeductionsCents ? `- Pre-tax Deductions: ${formatCents(projectedData.pretaxDeductionsCents)}` : ""}
${projectedData.posttaxDeductionsCents ? `- Post-tax Deductions: ${formatCents(projectedData.posttaxDeductionsCents)}` : ""}
`;

  if (actualData) {
    prompt += `
ACTUAL PAY DATA (from uploaded statement):
- Gross Pay: ${formatCents(actualData.grossPayCents)}
${actualData.netPayCents ? `- Net Pay: ${formatCents(actualData.netPayCents)}` : ""}
${actualData.creditMinutes ? `- Credit Time: ${formatHours(actualData.creditMinutes)}` : ""}
`;
  }

  if (context.payEvents && context.payEvents.length > 0) {
    prompt += `
PAY EVENTS THIS PERIOD:
${context.payEvents.map((e) => `- ${e.label || e.type}${e.amountCents ? `: ${formatCents(e.amountCents)}` : ""}`).join("\n")}
`;
  }

  if (context.benchmarkData) {
    prompt += `
CAREER PAY BENCHMARKS (Contract Extension TA - 2025):
- Benchmark Hourly Rate: ${formatCents(context.benchmarkData.hourlyRateCents)}/hr
- Pay at Guarantee: ${formatCents(context.benchmarkData.payAtGuaranteeCents)}/year
- Average Line Pay: ${formatCents(context.benchmarkData.avgLinePayCents)}/year
- Average Total Pay: ${formatCents(context.benchmarkData.avgTotalPayCents)}/year
${context.benchmarkData.sourceNote ? `- Source: ${context.benchmarkData.sourceNote}` : ""}
`;
  }

  // Section-specific instructions
  const sectionInstructions: Record<PayExplanationSection, string> = {
    FULL_STATEMENT: `
TASK: Provide a comprehensive explanation of this pay statement.
Include:
1. How projected pay was calculated
2. Key drivers affecting pay this period
3. Overall verification status
4. Any recommended actions`,

    EARNINGS: `
TASK: Explain the EARNINGS section only.
Include:
1. How credit time pay was calculated (credit hours x hourly rate)
2. Any block overage pay (when block > credit)
3. Premium pay or pay events applied
4. Total gross earnings breakdown`,

    TAXES: `
TASK: Explain the TAXES section only.
Include:
1. Federal income tax withholding calculation
2. Social Security (6.2% up to wage base)
3. Medicare (1.45% + 0.9% additional if applicable)
4. State tax withholding (if applicable)
5. Total tax burden as percentage of gross`,

    DEDUCTIONS: `
TASK: Explain the DEDUCTIONS section only.
Include:
1. Pre-tax deductions (401k, health insurance, etc.)
2. Post-tax deductions
3. Impact on taxable wages
4. Total deduction amount`,

    REIMBURSEMENTS: `
TASK: Explain the REIMBURSEMENTS section only.
Include:
1. Per diem calculation (if applicable)
2. Why reimbursements are non-taxable
3. Total reimbursements`,

    NET_PAY: `
TASK: Explain the NET PAY calculation.
Include:
1. Formula: Gross - Pre-tax Deductions - Taxes - Post-tax Deductions = Net
2. Breakdown of each component
3. Final net pay amount`,

    DIFFERENCE: `
TASK: Explain the DIFFERENCE between projected and actual pay.
Include:
1. Dollar difference in net pay
2. Most likely cause(s) of the difference
3. Whether the difference is within normal variance
4. Whether review is recommended`,
  };

  prompt += sectionInstructions[section];

  prompt += `

OUTPUT FORMAT (respond with valid JSON only):
{
  "header": "Brief title (e.g., 'What affected your pay this period')",
  "keyDrivers": ["Bullet point 1", "Bullet point 2", ...],
  "matched": ["What matched expectations..."] (optional),
  "differed": ["What differed from expectations..."] (optional),
  "benchmarkContext": "Comparison to career pay benchmarks" (optional),
  "verificationStatus": "VERIFIED" | "ESTIMATED" | "MISMATCH" | "REVIEW_RECOMMENDED",
  "verificationNote": "Brief status explanation",
  "suggestedAction": "Next step if any" (optional)
}

RULES:
- Be deterministic and traceable
- Reference contract terms when applicable
- Use "Contract Extension TA - 2025" when citing benchmarks
- Never guess unknown values
- Never use casual tone
- Never give legal advice`;

  return prompt;
}

/**
 * AI Pay Statement Explanation
 * POST /api/ai/pay-explanation
 */
aiRouter.post(
  "/pay-explanation",
  zValidator("json", payExplanationRequestSchema),
  async (c) => {
    const data = c.req.valid("json");

    // Check for OpenAI API key
    if (!env.OPENAI_API_KEY) {
      return c.json({ error: "AI service not configured" }, 503);
    }

    try {
      const prompt = buildPayExplanationPrompt(data);

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "You are a professional payroll analyst. Respond only with valid JSON matching the specified format. Be factual and precise.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.3,
          max_tokens: 1000,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as Record<string, unknown>;
        console.error("OpenAI API error:", errorData);
        const errorObj = errorData.error as Record<string, unknown> | undefined;
        return c.json(
          { error: (errorObj?.message as string) || "AI service error" },
          response.status as ContentfulStatusCode
        );
      }

      const aiResponse = await response.json() as Record<string, unknown>;
      const choices = aiResponse.choices as Array<{ message?: { content?: string } }> | undefined;
      const content = choices?.[0]?.message?.content;

      if (!content) {
        return c.json({ error: "No response from AI service" }, 500);
      }

      // Parse the JSON response from AI
      let explanation;
      try {
        // Clean potential markdown code blocks
        const cleanContent = content
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();
        explanation = JSON.parse(cleanContent);
      } catch (parseError) {
        console.error("Failed to parse AI response:", content);
        return c.json({ error: "Failed to parse AI response" }, 500);
      }

      // Calculate difference analysis if actual data provided
      let differenceAnalysis;
      if (data.actualData) {
        const projectedNet = data.projectedData.netPayCents || data.projectedData.grossPayCents;
        const actualNet = data.actualData.netPayCents || data.actualData.grossPayCents;
        const netDiff = actualNet - projectedNet;
        const grossDiff = data.actualData.grossPayCents - data.projectedData.grossPayCents;
        const tolerancePercent = 5; // 5% tolerance
        const isWithinTolerance =
          Math.abs(netDiff) <= projectedNet * (tolerancePercent / 100);

        differenceAnalysis = {
          netPayDifferenceCents: netDiff,
          grossPayDifferenceCents: grossDiff,
          isWithinTolerance,
          tolerancePercent,
          likelyCauses: explanation.differed || [],
        };
      }

      const result: PayExplanationResponse = {
        success: true,
        section: data.section,
        explanation: {
          header: explanation.header || "Pay Statement Analysis",
          keyDrivers: explanation.keyDrivers || [],
          matched: explanation.matched,
          differed: explanation.differed,
          benchmarkContext: explanation.benchmarkContext,
        },
        verificationStatus: (explanation.verificationStatus ||
          "ESTIMATED") as PayVerificationStatus,
        verificationNote: explanation.verificationNote,
        suggestedAction: explanation.suggestedAction,
        differenceAnalysis,
      };

      return c.json(result);
    } catch (error) {
      console.error("Pay explanation error:", error);
      return c.json({ error: "Failed to generate explanation" }, 500);
    }
  }
);

export { aiRouter };
