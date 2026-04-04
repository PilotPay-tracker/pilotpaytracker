/**
 * Custom Terms API Routes
 * User-defined terminology that merges with airline terminology packs
 */

import { Hono } from "hono";
import { db } from "../db";
import { type AppType } from "../types";
import { z } from "zod";

export const customTermsRouter = new Hono<AppType>();

// ============================================
// HELPER: Require authentication
// ============================================
function requireAuth(userId: string | undefined): string {
  if (!userId) {
    throw new Error("Unauthorized");
  }
  return userId;
}

// ============================================
// Validation schemas
// ============================================

const termCategorySchema = z.enum([
  "Scheduling",
  "Pay",
  "Reserve",
  "Trade",
  "Training",
  "Deadhead",
  "Duty",
  "Benefits",
  "Other",
]);

const createCustomTermSchema = z.object({
  displayTerm: z.string().min(1).max(100),
  category: termCategorySchema,
  neutralSummary: z.string().min(1).max(500),
  synonyms: z.array(z.string()).default([]),
  tags: z.array(z.string()).optional(),
  airlineId: z.string().optional(),
});

const updateCustomTermSchema = createCustomTermSchema.partial();

// ============================================
// GET /api/custom-terms - List user's custom terms
// ============================================
customTermsRouter.get("/", async (c) => {
  const userId = requireAuth(c.get("user")?.id);
  const airlineId = c.req.query("airlineId");
  const category = c.req.query("category");

  const where: {
    userId: string;
    airlineId?: string | null;
    category?: string;
  } = { userId };

  // Filter by airline (include global terms with null airlineId)
  if (airlineId) {
    where.airlineId = airlineId;
  }

  if (category) {
    where.category = category;
  }

  const terms = await db.userCustomTerm.findMany({
    where: airlineId
      ? {
          userId,
          OR: [{ airlineId }, { airlineId: null }],
          ...(category ? { category } : {}),
        }
      : where,
    orderBy: [{ category: "asc" }, { displayTerm: "asc" }],
  });

  return c.json({
    terms: terms.map((t) => ({
      id: t.id,
      termKey: t.termKey,
      displayTerm: t.displayTerm,
      category: t.category,
      neutralSummary: t.neutralSummary,
      synonyms: JSON.parse(t.synonyms || "[]"),
      tags: t.tags ? JSON.parse(t.tags) : [],
      airlineId: t.airlineId,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
  });
});

// ============================================
// GET /api/custom-terms/:id - Get single term
// ============================================
customTermsRouter.get("/:id", async (c) => {
  const userId = requireAuth(c.get("user")?.id);
  const id = c.req.param("id");

  const term = await db.userCustomTerm.findFirst({
    where: { id, userId },
  });

  if (!term) {
    return c.json({ error: "Term not found" }, 404);
  }

  return c.json({
    term: {
      id: term.id,
      termKey: term.termKey,
      displayTerm: term.displayTerm,
      category: term.category,
      neutralSummary: term.neutralSummary,
      synonyms: JSON.parse(term.synonyms || "[]"),
      tags: term.tags ? JSON.parse(term.tags) : [],
      airlineId: term.airlineId,
      createdAt: term.createdAt.toISOString(),
      updatedAt: term.updatedAt.toISOString(),
    },
  });
});

// ============================================
// POST /api/custom-terms - Create custom term
// ============================================
customTermsRouter.post("/", async (c) => {
  const userId = requireAuth(c.get("user")?.id);

  const body = await c.req.json();
  const parsed = createCustomTermSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }

  const { displayTerm, category, neutralSummary, synonyms, tags, airlineId } = parsed.data;

  // Generate termKey from displayTerm
  const termKey = displayTerm
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

  // Check for duplicate
  const existing = await db.userCustomTerm.findFirst({
    where: { userId, termKey },
  });

  if (existing) {
    return c.json({ error: "A term with this name already exists" }, 409);
  }

  const term = await db.userCustomTerm.create({
    data: {
      userId,
      termKey,
      displayTerm,
      category,
      neutralSummary,
      synonyms: JSON.stringify(synonyms),
      tags: tags ? JSON.stringify(tags) : null,
      airlineId: airlineId || null,
    },
  });

  return c.json(
    {
      term: {
        id: term.id,
        termKey: term.termKey,
        displayTerm: term.displayTerm,
        category: term.category,
        neutralSummary: term.neutralSummary,
        synonyms: JSON.parse(term.synonyms),
        tags: term.tags ? JSON.parse(term.tags) : [],
        airlineId: term.airlineId,
        createdAt: term.createdAt.toISOString(),
        updatedAt: term.updatedAt.toISOString(),
      },
    },
    201
  );
});

// ============================================
// PUT /api/custom-terms/:id - Update custom term
// ============================================
customTermsRouter.put("/:id", async (c) => {
  const userId = requireAuth(c.get("user")?.id);
  const id = c.req.param("id");

  const existing = await db.userCustomTerm.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    return c.json({ error: "Term not found" }, 404);
  }

  const body = await c.req.json();
  const parsed = updateCustomTermSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }

  const { displayTerm, category, neutralSummary, synonyms, tags, airlineId } = parsed.data;

  // If displayTerm changed, regenerate termKey
  let termKey = existing.termKey;
  if (displayTerm && displayTerm !== existing.displayTerm) {
    termKey = displayTerm
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");

    // Check for duplicate
    const duplicate = await db.userCustomTerm.findFirst({
      where: { userId, termKey, NOT: { id } },
    });

    if (duplicate) {
      return c.json({ error: "A term with this name already exists" }, 409);
    }
  }

  const term = await db.userCustomTerm.update({
    where: { id },
    data: {
      ...(displayTerm && { displayTerm, termKey }),
      ...(category && { category }),
      ...(neutralSummary && { neutralSummary }),
      ...(synonyms && { synonyms: JSON.stringify(synonyms) }),
      ...(tags !== undefined && { tags: tags ? JSON.stringify(tags) : null }),
      ...(airlineId !== undefined && { airlineId: airlineId || null }),
    },
  });

  return c.json({
    term: {
      id: term.id,
      termKey: term.termKey,
      displayTerm: term.displayTerm,
      category: term.category,
      neutralSummary: term.neutralSummary,
      synonyms: JSON.parse(term.synonyms),
      tags: term.tags ? JSON.parse(term.tags) : [],
      airlineId: term.airlineId,
      createdAt: term.createdAt.toISOString(),
      updatedAt: term.updatedAt.toISOString(),
    },
  });
});

// ============================================
// DELETE /api/custom-terms/:id - Delete custom term
// ============================================
customTermsRouter.delete("/:id", async (c) => {
  const userId = requireAuth(c.get("user")?.id);
  const id = c.req.param("id");

  const existing = await db.userCustomTerm.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    return c.json({ error: "Term not found" }, 404);
  }

  await db.userCustomTerm.delete({
    where: { id },
  });

  return c.json({ success: true });
});

// ============================================
// GET /api/custom-terms/search - Search terms
// ============================================
customTermsRouter.get("/search/:query", async (c) => {
  const userId = requireAuth(c.get("user")?.id);
  const query = c.req.param("query");
  const airlineId = c.req.query("airlineId");

  if (!query || query.length < 2) {
    return c.json({ terms: [] });
  }

  const queryLower = query.toLowerCase();

  // Get all user's terms
  const allTerms = await db.userCustomTerm.findMany({
    where: airlineId
      ? {
          userId,
          OR: [{ airlineId }, { airlineId: null }],
        }
      : { userId },
  });

  // Filter by search query (search displayTerm, neutralSummary, synonyms)
  const matchingTerms = allTerms.filter((t) => {
    const synonyms: string[] = JSON.parse(t.synonyms || "[]");
    return (
      t.displayTerm.toLowerCase().includes(queryLower) ||
      t.termKey.includes(queryLower) ||
      t.neutralSummary.toLowerCase().includes(queryLower) ||
      synonyms.some((s) => s.toLowerCase().includes(queryLower))
    );
  });

  return c.json({
    terms: matchingTerms.map((t) => ({
      id: t.id,
      termKey: t.termKey,
      displayTerm: t.displayTerm,
      category: t.category,
      neutralSummary: t.neutralSummary,
      synonyms: JSON.parse(t.synonyms || "[]"),
      tags: t.tags ? JSON.parse(t.tags) : [],
      airlineId: t.airlineId,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
  });
});
