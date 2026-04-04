/**
 * Web Auth Client
 * Uses Better Auth's React client for web (cookie-based sessions)
 */
import { createAuthClient } from 'better-auth/react';
import { AUTH_BACKEND_URL } from './api';

export const authClient = createAuthClient({
  baseURL: AUTH_BACKEND_URL,
});

export const { useSession, signIn, signUp, signOut } = authClient;
