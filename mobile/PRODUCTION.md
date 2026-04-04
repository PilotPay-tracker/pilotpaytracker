# Production Deployment Guide

This document outlines the critical steps needed before launching to the App Store and Google Play.

## Production Readiness Status

### ✅ Completed Security Measures

| Feature | Status | Description |
|---------|--------|-------------|
| Error Boundaries | ✅ Done | App won't crash on component errors |
| Rate Limiting | ✅ Done | Backend protected against abuse |
| API Keys Secured | ✅ Done | Moved from frontend to backend-only |
| AI Proxy Endpoints | ✅ Done | `/api/ai/*` routes proxy AI requests |

### Rate Limiting Configuration
- **Standard API**: 100 requests/minute
- **Auth**: 10 attempts/15 minutes
- **Uploads**: 20/hour
- **AI operations**: 30/hour

---

## Pre-Launch Checklist

### 1. Environment Variables ✅ DONE

API keys have been moved from frontend to backend:

**Frontend `.env` (safe - no secrets):**
```env
# API keys moved to backend for security
# Frontend calls backend proxy endpoints for AI operations
```

**Backend `.env` (keep secret):**
```env
DATABASE_URL=file:dev.db
BETTER_AUTH_SECRET=<your-secret>
PORT=3000

# AI API Keys (backend only)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-...
GROK_API_KEY=xai-...
GOOGLE_API_KEY=...
ELEVENLABS_API_KEY=...
```

### 2. Rotate BETTER_AUTH_SECRET for Production

**IMPORTANT**: Before going live, generate a new auth secret:

```bash
# Generate a secure 32+ character secret
openssl rand -base64 32
```

Update `backend/.env` with the new secret. This will invalidate all existing sessions (users will need to log in again).

### 3. Error Tracking - Sentry Setup

To add crash reporting, sign up at [sentry.io](https://sentry.io) and follow these steps:

1. Create a new project for React Native/Expo
2. Copy your DSN
3. The ErrorBoundary component (`src/components/ErrorBoundary.tsx`) already has an `onError` callback that can be connected to Sentry:

```typescript
// In _layout.tsx, update ErrorBoundary to send errors to Sentry:
<ErrorBoundary onError={(error, info) => {
  // Sentry.captureException(error);
}}>
```

### 4. AI API Proxy Endpoints

Your app now has secure backend endpoints for AI operations:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ai/openai/chat` | POST | OpenAI chat completions |
| `/api/ai/anthropic/messages` | POST | Anthropic Claude messages |
| `/api/ai/elevenlabs/tts` | POST | ElevenLabs text-to-speech |
| `/api/ai/status` | GET | Check which AI services are configured |

All AI endpoints require authentication and are rate-limited to 30 requests/hour.

---

## Before TestFlight/Internal Testing

- [ ] Remove all console.log statements (or use production logger)
- [ ] Test on slow network (throttle in simulator)
- [ ] Test with 50+ concurrent users
- [ ] Verify all features work offline or show proper errors
- [ ] Add privacy policy and terms of service screens
- [ ] Test deep links work correctly

## App Store Requirements

- [ ] App icons (all sizes)
- [ ] Screenshots for all device sizes
- [ ] App description and keywords
- [ ] Privacy policy URL
- [ ] Support URL
- [ ] Age rating questionnaire

## Production Database Considerations

For thousands of users, consider:
- PostgreSQL instead of SQLite
- Database connection pooling
- Regular backups
- Database monitoring

## Monitoring Recommendations

- **Sentry** - Error tracking and crash reporting
- **Mixpanel/Amplitude** - User analytics
- **UptimeRobot** - Backend uptime monitoring

---

## Quick Security Audit

Run before each release:

```bash
# Check for exposed secrets in frontend
grep -r "EXPO_PUBLIC.*KEY" .env

# Check for hardcoded localhost URLs
grep -r "localhost" src/

# Verify rate limiting is active
grep -r "rateLimit" backend/src/
```

---

## Contact

For deployment support through Vibecode, use the "Share" button and select "Submit to App Store".
