/** @type {import('next').NextConfig} */

// In the Vibecode sandbox the backend URL is injected as BACKEND_URL.
// Next.js requires NEXT_PUBLIC_ prefix for client-side access.
// Forward it here so both server components and client hooks see it.
const backendUrl =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.BACKEND_URL ||
  'http://localhost:3000'

const nextConfig = {
  env: {
    NEXT_PUBLIC_BACKEND_URL: backendUrl,
  },
}

module.exports = nextConfig
