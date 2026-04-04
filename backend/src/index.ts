import "@vibecodeapp/proxy"; // DO NOT REMOVE OTHERWISE VIBECODE PROXY WILL NOT WORK
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveStatic } from "@hono/node-server/serve-static";
import { bodyLimit } from "hono/body-limit";

import { auth } from "./auth";
import { env } from "./env";
import { standardRateLimit, authRateLimit, uploadRateLimit } from "./middleware/rate-limit";
import { uploadRouter } from "./routes/upload";
import { sampleRouter } from "./routes/sample";
import { flightsRouter } from "./routes/flights";
import { logbookImportsRouter } from "./routes/logbook-imports";
import { dashboardRouter } from "./routes/dashboard";
import { settingsRouter } from "./routes/settings";
import { tripsRouter } from "./routes/trips";
import { complianceRouter } from "./routes/compliance";
import { profileRouter } from "./routes/profile";
import { payPeriodsRouter } from "./routes/pay-periods";
import { scheduleRouter } from "./routes/schedule";
import { startJobProcessor } from "./lib/upload-job-processor";
import { payRulesRouter } from "./routes/pay-rules";
import { payEventsRouter } from "./routes/pay-events";
import { projectionsRouter } from "./routes/projections";
import { contractsRouter } from "./routes/contracts";
import { payStatementMirrorRouter } from "./routes/pay-statement-mirror";
import calendarRouter from "./routes/calendar";
import { customTermsRouter } from "./routes/custom-terms";
import { lapRouter } from "./routes/lap";
import { aiRouter } from "./routes/ai";
import taxRoutes from "./routes/tax";
import { payBenchmarksRouter } from "./routes/pay-benchmarks";
import { hotelDirectoryRouter } from "./routes/hotel-directory";
import { lifetimeEarningsRouter } from "./routes/lifetime-earnings";
import { supportRouter } from "./routes/support";
import { adminRouter } from "./routes/admin";
import { tripVersionRoutes, rosterChangesRoutes, recordsRoutes } from "./routes/trip-versions";
import { premiumEventsRouter } from "./routes/premium-events";
import { premiumCodesRouter } from "./routes/premium-codes";
import { passwordResetRouter } from "./routes/password-reset";
import { notificationsRouter } from "./routes/notifications";
import { referralsRouter } from "./routes/referrals";
import { subscriptionRouter } from "./routes/subscription";
import { stripeRouter } from "./routes/stripe";
import { logEventsRouter } from "./routes/log-events";
import { feedbackRouter } from "./routes/feedback";
import { uploadsRouter } from "./routes/uploads";
import { sickRouter } from "./routes/sick";
import sickTrackerRouter from "./routes/sick-tracker";
import { reserveScheduleRouter } from "./routes/reserve-schedule";
import { annualPlannerRouter } from "./routes/annual-planner";
import { yearPlanRouter } from "./routes/year-plan";
import { ocrRouter } from "./routes/ocr";
import payrollProfileRoute from "./routes/payroll-profile";
import { payAuditRouter } from "./routes/pay-audit";
import { bidPeriodBaselineRouter } from "./routes/bid-period-baseline";
import { type AppType } from "./types";
import { db } from "./db";
import { getBenchmarksForSeeding } from "./seeds/ups-benchmarks-2025";
import { seedPremiumCodes } from "./lib/premium-codes-seed";
import { seedReviewAccounts } from "./lib/review-accounts-seed";

// AppType context adds user and session to the context, will be null if the user or session is null
const app = new Hono<AppType>();

console.log("🔧 Initializing Hono application...");

// Global error handler - catches unhandled errors and logs them for debugging
app.onError((err, c) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const method = c.req.method;
  const path = c.req.path;
  const timestamp = new Date().toISOString();

  // Log detailed error for server-side debugging
  console.error(`[${timestamp}] ❌ ERROR [${requestId}] ${method} ${path}`);
  console.error(`  Message: ${err.message}`);
  console.error(`  Stack: ${err.stack}`);

  // Check if this is an HTTPException from Hono
  if (err.name === 'HTTPException' && 'status' in err) {
    const httpErr = err as any;
    return c.json(
      {
        error: httpErr.message || 'Request failed',
        requestId,
        status: httpErr.status,
      },
      httpErr.status
    );
  }

  // Return a structured error response (not generic "Internal Server Error")
  return c.json(
    {
      error: env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred',
      requestId,
      // Include stack trace in development for easier debugging
      ...(env.NODE_ENV === 'development' && { stack: err.stack }),
    },
    500
  );
});

app.use("*", logger());
app.use(
  "/*",
  cors({
    origin: (origin) => origin || "*", // Allow the requesting origin or fallback to *
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "expo-origin"], // expo-origin is required for Better Auth Expo plugin
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);

// Health check — used by uptime monitors to keep the server warm (before session/auth)
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

/** Authentication middleware
 * Extracts session from Better Auth and attaches user/session to context.
 * All routes can access c.get("user") and c.get("session")
 * NOTE: Skipped for /api/auth/* routes — Better Auth handles sessions itself there.
 */
app.use("*", async (c, next) => {
  // Skip session extraction for auth routes — Better Auth handles them directly.
  // Running auth.api.getSession on sign-in/sign-up requests is wasted work and
  // a potential failure point if the DB is under load.
  if (c.req.path.startsWith("/api/auth/")) {
    c.set("user", null);
    c.set("session", null);
    return next();
  }
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set("user", session?.user ?? null);
    c.set("session", session?.session ?? null);
  } catch {
    c.set("user", null);
    c.set("session", null);
  }
  return next();
});

// Better Auth handler
// Handles all authentication endpoints: /api/auth/sign-in, /api/auth/sign-up, etc.
console.log("🔐 Mounting Better Auth handler at /api/auth/*");

// Only rate limit actual auth attempts (sign-in, sign-up), not session checks
app.use("/api/auth/sign-in/*", authRateLimit);
app.use("/api/auth/sign-up/*", authRateLimit);

app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  try {
    const request = c.req.raw;
    // Workaround for Expo/React Native: native apps don't send Origin header,
    // but the expo client plugin sends expo-origin instead. We need to create
    // a new request with the origin header set from expo-origin.
    const expoOrigin = request.headers.get("expo-origin");
    if (!request.headers.get("origin") && expoOrigin) {
      const headers = new Headers(request.headers);
      headers.set("origin", expoOrigin);
      const modifiedRequest = new Request(request, { headers });
      return auth.handler(modifiedRequest);
    }
    return auth.handler(request);
  } catch (err) {
    console.error("[Auth] Handler threw unexpected error:", err);
    return c.json({ error: "Authentication service error. Please try again." }, 500);
  }
});

// Serve uploaded images statically
// Files in uploads/ directory are accessible at /uploads/* URLs
console.log("📁 Serving static files from uploads/ directory");
app.use("/uploads/*", serveStatic({ root: "./" }));
app.use("/uploads/contracts/*", serveStatic({ root: "./" }));

// Serve legal pages (privacy, terms) from public/ directory
console.log("📄 Serving legal pages from public/ directory");
app.use("/privacy.html", serveStatic({ root: "./public", path: "privacy.html" }));
app.use("/terms.html", serveStatic({ root: "./public", path: "terms.html" }));
app.use("/privacy", serveStatic({ root: "./public", path: "privacy.html" }));
app.use("/terms", serveStatic({ root: "./public", path: "terms.html" }));

// Serve images from frontend public/ directory (tutorial images etc.)
console.log("🖼️ Serving public images from ../mobile/public/ directory");
app.get("/images/:filename", async (c) => {
  const filename = c.req.param("filename");
  const filePath = `../mobile/public/${filename}`;
  try {
    const fs = await import("fs/promises");
    const data = await fs.readFile(filePath);
    const contentType = filename.endsWith(".png") ? "image/png" :
                        filename.endsWith(".jpeg") || filename.endsWith(".jpg") ? "image/jpeg" :
                        "application/octet-stream";
    return new Response(data, {
      headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000" }
    });
  } catch {
    return c.notFound();
  }
});
app.get("/", (c) => {
  // Redirect root to privacy for now (or could serve index.html)
  return c.redirect("/privacy");
});

// Mount route modules
// Upload routes need larger body size limit for base64 images
console.log("📤 Mounting upload routes at /api/upload");
app.use("/api/upload/*", uploadRateLimit); // Rate limit uploads
app.use("/api/upload/*", bodyLimit({ maxSize: 50 * 1024 * 1024 })); // 50MB for base64 encoded images
app.route("/api/upload", uploadRouter);

// Apply standard rate limit to all API routes
console.log("🛡️ Applying rate limiting to API routes");
app.use("/api/*", standardRateLimit);

console.log("📝 Mounting sample routes at /api/sample");
app.route("/api/sample", sampleRouter);

console.log("✈️ Mounting flights routes at /api/flights");
app.route("/api/flights", flightsRouter);
app.route("/api/logbook-imports", logbookImportsRouter);

console.log("📊 Mounting dashboard routes at /api/dashboard");
app.route("/api/dashboard", dashboardRouter);

console.log("⚙️ Mounting settings routes at /api/settings");
app.route("/api/settings", settingsRouter);

console.log("🗓️ Mounting trips routes at /api/trips");
app.route("/api/trips", tripsRouter);

console.log("📋 Mounting compliance routes at /api/compliance");
app.route("/api/compliance", complianceRouter);

console.log("👤 Mounting profile routes at /api/profile");
app.route("/api/profile", profileRouter);

console.log("💰 Mounting pay periods routes at /api/pay-periods");
app.route("/api/pay-periods", payPeriodsRouter);

console.log("📅 Mounting schedule routes at /api/schedule");
app.route("/api/schedule", scheduleRouter);

console.log("📋 Mounting pay rules routes at /api/pay-rules");
app.route("/api/pay-rules", payRulesRouter);

console.log("📝 Mounting pay events routes at /api/pay-events");
app.route("/api/pay-events", payEventsRouter);

console.log("📈 Mounting projections routes at /api/projections");
app.route("/api/projections", projectionsRouter);

console.log("📜 Mounting contracts routes at /api/contracts");
app.route("/api/contracts", contractsRouter);

console.log("🧾 Mounting pay statement mirror routes at /api/pay-statements");
app.route("/api/pay-statements", payStatementMirrorRouter);

console.log("📅 Mounting calendar sync routes at /api/calendar");
app.route("/api/calendar", calendarRouter);

console.log("📖 Mounting custom terms routes at /api/custom-terms");
app.route("/api/custom-terms", customTermsRouter);

console.log("⏰ Mounting LAP routes at /api/lap");
app.route("/api/lap", lapRouter);

console.log("🤖 Mounting AI proxy routes at /api/ai");
app.route("/api/ai", aiRouter);

console.log("💵 Mounting tax routes at /api/tax");
app.route("/api/tax", taxRoutes);

console.log("📊 Mounting pay benchmarks routes at /api/pay-benchmarks");
app.route("/api/pay-benchmarks", payBenchmarksRouter);

console.log("🏨 Mounting hotel directory routes at /api/hotel-directory");
app.route("/api/hotel-directory", hotelDirectoryRouter);

console.log("📊 Mounting lifetime earnings routes at /api/lifetime-earnings");
app.route("/api/lifetime-earnings", lifetimeEarningsRouter);

console.log("🎫 Mounting support routes at /api/support");
app.route("/api/support", supportRouter);

console.log("📤 Mounting uploads management routes at /api/uploads");
app.route("/api/uploads", uploadsRouter);

console.log("👑 Mounting admin routes at /api/admin");
app.route("/api/admin", adminRouter);

// Trip Version System routes (nested under /api/trips)
console.log("📋 Mounting trip version routes at /api/trips/:tripId/versions");
app.route("/api/trips", tripVersionRoutes);

console.log("📋 Mounting roster changes routes at /api/roster-changes");
app.route("/api/roster-changes", rosterChangesRoutes);

console.log("📋 Mounting audit records routes at /api/records");
app.route("/api/records", recordsRoutes);

console.log("💰 Mounting premium events routes at /api/premium-events");
app.route("/api/premium-events", premiumEventsRouter);

console.log("💎 Mounting premium codes routes at /api/premium-codes");
app.route("/api/premium-codes", premiumCodesRouter);

console.log("🔑 Mounting password reset routes at /api/password-reset");
app.route("/api/password-reset", passwordResetRouter);

console.log("🔔 Mounting notifications routes at /api/notifications");
app.route("/api/notifications", notificationsRouter);

console.log("👥 Mounting referrals routes at /api/referrals");
app.route("/api/referrals", referralsRouter);

console.log("💳 Mounting subscription routes at /api/subscription");
app.route("/api/subscription", subscriptionRouter);

console.log("💰 Mounting Stripe routes at /api/stripe");
app.route("/api/stripe", stripeRouter);

console.log("📋 Mounting log events routes at /api/log-events");
app.route("/api/log-events", logEventsRouter);

// AI Feedback & Learning
console.log("📝 Mounting feedback routes at /api/feedback");
app.route("/api/feedback", feedbackRouter);

// Sick Tracking (SIK) routes
console.log("🏥 Mounting sick tracking routes at /api/sick");
app.route("/api/sick", sickRouter);

// Sick Time Tracker (Personal record-keeping tool)
console.log("🏥 Mounting sick time tracker at /api/sick-tracker");
app.route("/api/sick-tracker", sickTrackerRouter);

// Reserve/Standby Schedule Support
console.log("📅 Mounting reserve schedule routes at /api/reserve-schedule");
app.route("/api/reserve-schedule", reserveScheduleRouter);

// Annual Pay Planner (Flagship PRO Feature)
console.log("📊 Mounting annual pay planner routes at /api/planner");
app.route("/api/planner", annualPlannerRouter);

// Year Plan (Shared Planning Entity — Benchmarks ↔ Planner)
console.log("🎯 Mounting year plan routes at /api/year-plan");
app.route("/api/year-plan", yearPlanRouter);

// OCR Proxy (forwards OCR.space requests from mobile)
console.log("🔍 Mounting OCR proxy routes at /api/ocr");
app.use("/api/ocr/*", bodyLimit({ maxSize: 50 * 1024 * 1024 })); // 50MB for base64 images
app.route("/api/ocr", ocrRouter);

// Payroll Profile (learned deduction profile from uploaded paystubs)
console.log("📋 Mounting payroll profile routes at /api/payroll-profile");
app.route("/api/payroll-profile", payrollProfileRoute);

// Pay Audit (Flight Register + Dayforce comparison)
console.log("🔎 Mounting pay audit routes at /api/pay-audit");
app.use("/api/pay-audit/*", bodyLimit({ maxSize: 50 * 1024 * 1024 })); // 50MB for base64 images
app.route("/api/pay-audit", payAuditRouter);
app.route("/api/bid-period-baseline", bidPeriodBaselineRouter);

// Detailed API health endpoint for debugging environment configuration
app.get("/api/health", (c) => {
  console.log("🔍 API Health check requested (detailed diagnostics)");

  // Environment name detection
  const nodeEnv = env.NODE_ENV || process.env.NODE_ENV || "unknown";
  const backendUrl = env.BACKEND_URL || process.env.BACKEND_URL || "http://localhost:3000";

  // Determine environment name from URL pattern
  let envName = "unknown";
  if (backendUrl.includes("preview-")) {
    const match = backendUrl.match(/preview-([a-z0-9]+)/);
    envName = match ? `preview-${match[1]}` : "preview";
  } else if (backendUrl.includes("localhost")) {
    envName = "local-dev";
  } else if (backendUrl.includes("staging")) {
    envName = "staging";
  } else if (backendUrl.includes("prod")) {
    envName = "production";
  } else {
    envName = `vibecode-${nodeEnv}`;
  }

  const buildVersion = "1.0.0";
  const buildTimestamp = new Date().toISOString();

  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    envName,
    nodeEnv,
    apiBaseUrl: backendUrl,
    apiPort: env.PORT || "3000",
    build: {
      version: buildVersion,
      serverStarted: buildTimestamp,
      runtime: "bun",
      nodeVersion: process.version,
    },
    debug: {
      hasOpenAiKey: !!env.OPENAI_API_KEY,
      hasResendKey: !!env.RESEND_API_KEY,
      databaseConfigured: !!env.DATABASE_URL,
    }
  });
});

// Start the server
console.log("⚙️  Starting server...");

// Ensure Prisma engine is connected before handling requests
await db.$connect();
console.log("🗄️  Database connected");

// Apply SQLite performance pragmas now that engine is ready
await db.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
await db.$queryRawUnsafe("PRAGMA foreign_keys = ON;");
await db.$queryRawUnsafe("PRAGMA busy_timeout = 10000;");
await db.$queryRawUnsafe("PRAGMA synchronous = NORMAL;");
await db.$queryRawUnsafe("PRAGMA cache_size = -32768;");
await db.$queryRawUnsafe("PRAGMA temp_store = MEMORY;");
await db.$queryRawUnsafe("PRAGMA optimize;");
console.log("🗄️  SQLite pragmas applied");

// Auto-seed benchmarks if missing (ensures production always has data)
try {
  const benchmarkCount = await db.payBenchmark.count();
  if (benchmarkCount === 0) {
    console.log("📊 No benchmarks found — seeding UPS benchmarks...");
    const benchmarks = getBenchmarksForSeeding();
    for (const benchmark of benchmarks) {
      await db.payBenchmark.create({ data: benchmark });
    }
    console.log(`✅ Seeded ${benchmarks.length} benchmark records`);
  } else {
    console.log(`📊 Benchmarks already present: ${benchmarkCount} records`);
  }
} catch (err) {
  console.error("⚠️  Benchmark seeding failed (non-fatal):", err);
}

// Auto-seed premium codes if missing (ensures production always has data)
try {
  const premiumCodeCount = await db.premiumCode.count();
  if (premiumCodeCount === 0) {
    console.log("💎 No premium codes found — seeding UPS premium codes...");
    const result = await seedPremiumCodes();
    console.log(`✅ Seeded ${result.created} premium codes, updated ${result.updated} existing`);
  } else {
    // Always re-sync to pick up any updated code definitions
    const result = await seedPremiumCodes();
    if (result.updated > 0) {
      console.log(`💎 Premium codes updated: ${result.updated} refreshed, ${result.created} new`);
    } else {
      console.log(`💎 Premium codes already present: ${premiumCodeCount} records`);
    }
  }
} catch (err) {
  console.error("⚠️  Premium code seeding failed (non-fatal):", err);
}

// Auto-seed review accounts (ensures Apple/Google reviewers can always sign in)
try {
  await seedReviewAccounts();
} catch (err) {
  console.error("⚠️  Review account seeding failed (non-fatal):", err);
}

// Start the job processor AFTER DB is fully connected and ready
startJobProcessor();

const server = serve({ fetch: app.fetch, port: Number(env.PORT) }, () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📍 Environment: ${env.NODE_ENV}`);
  console.log(`🚀 Server is running on port ${env.PORT}`);
  console.log(`🔗 Base URL: http://localhost:${env.PORT}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\n📚 Available endpoints:");
  console.log("  🔐 Auth:        /api/auth/*");
  console.log("  📤 Upload:      POST /api/upload/image");
  console.log("  ✈️ Flights:     GET/POST/DELETE /api/flights");
  console.log("  📊 Dashboard:   GET /api/dashboard");
  console.log("  ⚙️ Settings:    GET/PUT /api/settings");
  console.log("  🗓️ Trips:       CRUD /api/trips, duty-days, legs");
  console.log("  📋 Compliance:  GET /api/compliance/30-in-7");
  console.log("  👤 Profile:     GET/PUT /api/profile, GET /api/profile/stats");
  console.log("  💰 Pay Periods: GET /api/pay-periods/*");
  console.log("  📋 Pay Rules:   CRUD /api/pay-rules");
  console.log("  📝 Pay Events:  CRUD /api/pay-events");
  console.log("  📈 Projections: GET /api/projections");
  console.log("  💚 Health:      GET /health");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
});

// Graceful shutdown
const shutdown = async () => {
  console.log("Shutting down server...");
  await db.$disconnect();
  await db.$connect();
  await db.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
  await db.$disconnect();
  console.log("Successfully shutdown server");
  server.close();
  process.exit(0);
};

// Handle SIGINT (ctrl+c).
process.on("SIGINT", async () => {
  console.log("SIGINT received. Cleaning up...");
  await shutdown();
});

// Handle SIGTERM (normal shutdown).
process.on("SIGTERM", async () => {
  console.log("SIGTERM received. Cleaning up...");
  await shutdown();
});
