import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { Resend } from "resend";
import { type AppType } from "../types";
import { db } from "../db";
import { env } from "../env";
import { helpDeskChatRequestSchema } from "@/shared/contracts";

const supportRouter = new Hono<AppType>();

// Initialize Resend client if API key is available
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

// ============================================
// UPS SCHEDULE IMPORT INSTRUCTIONS
// ============================================

const UPS_IMPORT_INSTRUCTIONS = `
### METHOD 1: Crew Access - Trip Info (RECOMMENDED)
This is the most accurate method for importing schedules.

**Step-by-step:**
1. Open UPS Crew Access on your phone or computer
2. Go to "My Schedule" or "Trip Info"
3. Select the trip you want to import
4. Take a screenshot that shows the FULL trip information including:
   - Trip number
   - All duty days with dates
   - Flight legs with times (OUT/IN times)
   - Layover information
   - Credit times
5. In the app, go to the "Add" tab (+ icon)
6. Tap "Upload Schedule"
7. Select your screenshot
8. The app will automatically parse the schedule and create your trip

**Pro Tips:**
- Make sure the screenshot is clear and readable
- Include ALL pages if the trip spans multiple screens
- The app works best with Trip Info screenshots that show the full trip details

### METHOD 2: Trip Board Screenshot
Good for quickly importing multiple trips at once.

**Step-by-step:**
1. Open UPS Crew Access
2. Navigate to your "Trip Board" or monthly schedule view
3. Take a screenshot showing your trips
4. In the app, go to "Add" tab → "Upload Schedule"
5. Select your Trip Board screenshot
6. Review the parsed trips and confirm

**Note:** Trip Board imports show less detail than Trip Info - you may want to add actuals later.

### METHOD 3: Trip Details View
For detailed single-trip imports.

**Step-by-step:**
1. In Crew Access, open a specific trip
2. Go to "Trip Details" which shows each leg
3. Screenshot the full details page
4. Upload in the app via "Add" → "Upload Schedule"`;

// Generate UPS-specific system prompt
function getHelpDeskPrompt(): string {
  return `You are a helpful AI assistant for UPS Pilot Pay Tracker, an app built by a UPS pilot for UPS pilots to track pay, schedules, and flight data.

## YOUR ROLE
- Answer questions about the app's features clearly and concisely
- Provide step-by-step tutorials when users ask "how do I..."
- Help troubleshoot common issues
- If you cannot solve a problem, suggest submitting a support ticket

## USER'S AIRLINE
The user flies for **UPS Airlines** and uses **Crew Access** for scheduling.

## KEY APP FEATURES
1. **Schedule Import** - Import trips from Crew Access screenshots
2. **Pay Tracking** - Track credit time, block time, and projected pay
3. **Trip Management** - View and manage your trips with duty days and legs
4. **Pay Events** - Log schedule changes that affect pay (reassignments, extensions, etc.)
5. **Contract References** - Upload and search CBA documents
6. **30-in-7 Compliance** - Track FDP limits
7. **Per Diem** - Track TAFB-based per diem

## SCHEDULE IMPORT TUTORIALS
${UPS_IMPORT_INSTRUCTIONS}

## COMMON ISSUES & SOLUTIONS

### "My schedule didn't parse correctly"
- Make sure the screenshot is clear and not blurry
- Ensure all text is visible (no cutoffs)
- Try taking a new screenshot with better lighting
- If it still fails, you can manually enter the trip

### "Times are showing wrong"
- Check your timezone settings in the app
- Times are typically shown in local time - the app converts to UTC internally

### "Missing legs or duty days"
- Make sure you captured the entire trip in your screenshot
- Try taking separate screenshots for each page if needed

### "How do I add actual times (OOOI)?"
- Go to Trips tab
- Select your trip
- Tap on a leg
- Enter your actual OUT, OFF, ON, IN times
- This helps calculate accurate block time vs credit time

### "Where do I see my projected pay?"
- Go to the main Dashboard tab
- Your current pay period shows projected earnings
- Tap to see a detailed breakdown

## WHEN TO SUGGEST A SUPPORT TICKET
Suggest submitting a ticket if:
- The user reports a bug you cannot troubleshoot
- The issue involves account/login problems
- Data appears corrupted or missing
- The user is frustrated after multiple failed attempts
- You're unsure how to help with their specific issue

## RESPONSE STYLE
- Be concise but thorough
- Use numbered steps for tutorials
- Be encouraging and helpful
- Use simple language (the user may not be technical)
- If unsure, ask clarifying questions
- Never make up features that don't exist`;
}

// ============================================
// POST /api/support/help-desk - AI Help Desk Chat
// ============================================
supportRouter.post(
  "/help-desk",
  zValidator("json", helpDeskChatRequestSchema),
  async (c) => {
    const user = c.get("user");

    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { message, conversationHistory = [] } = c.req.valid("json");

    // Check for OpenAI API key
    if (!env.OPENAI_API_KEY) {
      return c.json({ error: "AI service not configured" }, 503);
    }

    try {
      // Get user's airline from their profile
      const profile = await db.profile.findUnique({
        where: { userId: user.id },
        select: { airline: true },
      });

      // Generate UPS-specific system prompt
      const systemPrompt = getHelpDeskPrompt();

      // Build messages array for OpenAI
      const messages = [
        { role: "system", content: systemPrompt },
        ...conversationHistory.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user", content: message },
      ];

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages,
          temperature: 0.7,
          max_tokens: 1000,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as Record<string, unknown>;
        console.error("OpenAI API error:", errorData);
        const errorObj = errorData.error as Record<string, unknown> | undefined;
        return c.json(
          { error: (errorObj?.message as string) || "AI service error" },
          500
        );
      }

      const aiResponse = await response.json() as Record<string, unknown>;
      const choices = aiResponse.choices as Array<{ message?: { content?: string } }> | undefined;
      const content = choices?.[0]?.message?.content;

      if (!content) {
        return c.json({ error: "No response from AI service" }, 500);
      }

      // Check if we should suggest a ticket
      const shouldSuggestTicket =
        message.toLowerCase().includes("bug") ||
        message.toLowerCase().includes("broken") ||
        message.toLowerCase().includes("not working") ||
        message.toLowerCase().includes("error") ||
        message.toLowerCase().includes("help") ||
        content.toLowerCase().includes("submit a ticket") ||
        content.toLowerCase().includes("support ticket");

      // Determine ticket category based on message
      let ticketCategory = "other";
      if (message.toLowerCase().includes("bug") || message.toLowerCase().includes("error")) {
        ticketCategory = "bug";
      } else if (message.toLowerCase().includes("feature") || message.toLowerCase().includes("wish")) {
        ticketCategory = "feature";
      } else if (message.toLowerCase().includes("how") || message.toLowerCase().includes("?")) {
        ticketCategory = "question";
      }

      return c.json({
        success: true,
        response: content,
        suggestTicket: shouldSuggestTicket,
        ticketCategory,
      });
    } catch (error) {
      console.error("Help desk error:", error);
      return c.json({ error: "Failed to process request" }, 500);
    }
  }
);

// ============================================
// POST /api/support/report-issue - Submit an issue report
// ============================================
supportRouter.post("/report-issue", async (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json<{
    category: string;
    description: string;
    deviceInfo?: string;
    appVersion?: string;
  }>();

  const { category, description, deviceInfo, appVersion } = body;

  if (!category || !description) {
    return c.json({ error: "Category and description are required" }, 400);
  }

  // Create issue report in database
  const issue = await db.issueReport.create({
    data: {
      userId: user.id,
      category,
      description,
      deviceInfo: deviceInfo ?? null,
      appVersion: appVersion ?? null,
      status: "open",
    },
  });

  console.log(`[Support] Issue reported by user ${user.id}: ${category}`);

  // Send email notification to support
  const supportEmail = env.SUPPORT_EMAIL;
  if (supportEmail && resend) {
    try {
      // Format the email content
      const emailSubject = `[Pilot Pay Tracker] New ${category} Report - #${issue.id.slice(0, 8)}`;

      // Send email via Resend
      const { data, error } = await resend.emails.send({
        from: "Pilot Pay Tracker <support@resend.dev>",
        to: [supportEmail],
        subject: emailSubject,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #0f172a 0%, #1e3a5a 100%); padding: 20px; border-radius: 12px 12px 0 0;">
              <h1 style="color: #f59e0b; margin: 0; font-size: 24px;">New Support Ticket</h1>
            </div>

            <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
              <div style="background: white; padding: 16px; border-radius: 8px; margin-bottom: 16px; border-left: 4px solid #f59e0b;">
                <p style="margin: 0 0 8px 0; color: #64748b; font-size: 12px; text-transform: uppercase;">Ticket ID</p>
                <p style="margin: 0; color: #0f172a; font-weight: 600;">${issue.id}</p>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
                <div style="background: white; padding: 16px; border-radius: 8px;">
                  <p style="margin: 0 0 8px 0; color: #64748b; font-size: 12px; text-transform: uppercase;">Category</p>
                  <p style="margin: 0; color: #0f172a; font-weight: 600;">${category.toUpperCase()}</p>
                </div>
                <div style="background: white; padding: 16px; border-radius: 8px;">
                  <p style="margin: 0 0 8px 0; color: #64748b; font-size: 12px; text-transform: uppercase;">Date</p>
                  <p style="margin: 0; color: #0f172a; font-weight: 600;">${new Date().toLocaleString()}</p>
                </div>
              </div>

              <div style="background: white; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                <p style="margin: 0 0 8px 0; color: #64748b; font-size: 12px; text-transform: uppercase;">User Email</p>
                <p style="margin: 0; color: #0f172a; font-weight: 600;">${user.email || "Not provided"}</p>
              </div>

              <div style="background: white; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                <p style="margin: 0 0 8px 0; color: #64748b; font-size: 12px; text-transform: uppercase;">Description</p>
                <p style="margin: 0; color: #0f172a; white-space: pre-wrap;">${description}</p>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div style="background: white; padding: 16px; border-radius: 8px;">
                  <p style="margin: 0 0 8px 0; color: #64748b; font-size: 12px; text-transform: uppercase;">Device Info</p>
                  <p style="margin: 0; color: #0f172a; font-size: 14px;">${deviceInfo || "Not provided"}</p>
                </div>
                <div style="background: white; padding: 16px; border-radius: 8px;">
                  <p style="margin: 0 0 8px 0; color: #64748b; font-size: 12px; text-transform: uppercase;">App Version</p>
                  <p style="margin: 0; color: #0f172a; font-size: 14px;">${appVersion || "Not provided"}</p>
                </div>
              </div>
            </div>

            <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 16px;">
              Reply to this user via the admin dashboard or directly at their email address.
            </p>
          </div>
        `,
        text: `
New Support Ticket Submitted
=============================

Ticket ID: ${issue.id}
Category: ${category.toUpperCase()}
Date: ${new Date().toLocaleString()}

User Email: ${user.email || "Not provided"}

Description:
${description}

Device Info: ${deviceInfo || "Not provided"}
App Version: ${appVersion || "Not provided"}

---
Reply to this user via the admin dashboard or directly.
        `.trim(),
      });

      if (error) {
        console.error("[Support] Failed to send email:", error);
        await db.issueReport.update({
          where: { id: issue.id },
          data: {
            adminNotes: `Email failed: ${error.message}`,
          },
        });
      } else {
        console.log(`[Support] Email sent successfully to ${supportEmail}, ID: ${data?.id}`);
        await db.issueReport.update({
          where: { id: issue.id },
          data: {
            adminNotes: `Email sent to ${supportEmail}`,
          },
        });
      }

    } catch (emailError) {
      console.error("[Support] Failed to send email notification:", emailError);
      // Don't fail the request if email fails
    }
  } else if (supportEmail && !resend) {
    console.log(`[Support] Resend not configured - would send to: ${supportEmail}`);
  }

  return c.json({
    success: true,
    issueId: issue.id,
    message: "Issue reported successfully. We'll look into it.",
  });
});

// ============================================
// GET /api/support/my-issues - Get user's issue reports
// ============================================
supportRouter.get("/my-issues", async (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const issues = await db.issueReport.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return c.json({ issues });
});

export { supportRouter };
