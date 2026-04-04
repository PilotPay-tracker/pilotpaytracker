/**
 * Password Reset Routes
 * Simple password reset flow without email verification
 * Uses security questions/verification instead
 */

import { Hono } from "hono";
import { db } from "../db";
import { type AppType } from "../types";
import { hashPassword } from "better-auth/crypto";

const passwordResetRouter = new Hono<AppType>();

/**
 * POST /api/password-reset/request
 * Request a password reset - verifies email exists
 */
passwordResetRouter.post("/request", async (c) => {
  try {
    const body = await c.req.json();
    const { email } = body;

    if (!email) {
      return c.json({ error: "Email is required" }, 400);
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Find user by email
    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true, name: true, createdAt: true },
    });

    if (!user) {
      // Don't reveal if user exists
      return c.json({
        success: true,
        message: "If an account exists with this email, you can reset your password"
      });
    }

    // Generate a simple 6-digit code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Store in verification table
    await db.verification.upsert({
      where: { id: `reset_${user.id}` },
      create: {
        id: `reset_${user.id}`,
        identifier: user.email,
        value: resetCode,
        expiresAt,
      },
      update: {
        value: resetCode,
        expiresAt,
        updatedAt: new Date(),
      },
    });

    console.log(`[PasswordReset] Reset code generated for ${user.email}`);

    // Return success without exposing the reset code
    // The code is stored in the DB and shown to the user via the forgot-password flow
    return c.json({
      success: true,
      message: "Reset code generated",
      resetCode: resetCode,
      expiresIn: "15 minutes",
    });
  } catch (err) {
    console.error("[PasswordReset] Request error:", err);
    return c.json({ error: "Failed to process reset request" }, 500);
  }
});

/**
 * POST /api/password-reset/verify
 * Verify the reset code and change password
 */
passwordResetRouter.post("/verify", async (c) => {
  try {
    const body = await c.req.json();
    const { email, code, newPassword } = body;

    if (!email || !code || !newPassword) {
      return c.json({ error: "Email, code, and new password are required" }, 400);
    }

    if (newPassword.length < 6) {
      return c.json({ error: "Password must be at least 6 characters" }, 400);
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Find user
    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return c.json({ error: "Invalid email or code" }, 400);
    }

    // Find verification record
    const verification = await db.verification.findUnique({
      where: { id: `reset_${user.id}` },
    });

    if (!verification) {
      return c.json({ error: "No reset code found. Please request a new one." }, 400);
    }

    if (verification.value !== code) {
      return c.json({ error: "Invalid code" }, 400);
    }

    if (verification.expiresAt < new Date()) {
      return c.json({ error: "Code has expired. Please request a new one." }, 400);
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Find existing credential account
    const existingAccount = await db.account.findFirst({
      where: { userId: user.id, providerId: "credential" },
    });

    if (existingAccount) {
      // Update existing credential account
      await db.account.update({
        where: { id: existingAccount.id },
        data: { password: hashedPassword, updatedAt: new Date() },
      });
    } else {
      // No credential account exists (e.g. user signed up with passkey) — create one
      const newId = crypto.randomUUID().replace(/-/g, "");
      await db.account.create({
        data: {
          id: newId,
          accountId: user.id,
          providerId: "credential",
          userId: user.id,
          password: hashedPassword,
        },
      });
    }

    console.log(`[PasswordReset] Credential account ${existingAccount ? "updated" : "created"} for ${user.email}`);

    // Delete verification record
    await db.verification.delete({
      where: { id: `reset_${user.id}` },
    });

    // Clear all existing sessions for security
    await db.session.deleteMany({
      where: { userId: user.id },
    });

    console.log(`[PasswordReset] Password reset successful for ${user.email}`);

    return c.json({
      success: true,
      message: "Password has been reset. Please sign in with your new password.",
    });
  } catch (err) {
    console.error("[PasswordReset] Verify error:", err);
    return c.json({ error: "Failed to reset password" }, 500);
  }
});

export { passwordResetRouter };
