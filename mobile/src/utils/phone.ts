/**
 * Phone Utilities
 * Provides phone number normalization and calling functionality
 */

import { Linking } from 'react-native';

/**
 * Normalize a phone number to digits and plus sign only
 */
export function normalizePhone(input: string): string {
  const s = (input || '').trim();
  // Keep digits + plus sign only
  const cleaned = s.replace(/[^\d+]/g, '');
  return cleaned;
}

/**
 * Format phone number for display
 * Attempts to format US numbers as (XXX) XXX-XXXX
 */
export function formatPhoneForDisplay(phone: string): string {
  const normalized = normalizePhone(phone);

  // US number without country code
  if (normalized.length === 10) {
    return `(${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${normalized.slice(6)}`;
  }

  // US number with +1
  if (normalized.length === 11 && normalized.startsWith('1')) {
    return `+1 (${normalized.slice(1, 4)}) ${normalized.slice(4, 7)}-${normalized.slice(7)}`;
  }

  // International or other format - return as-is
  return normalized;
}

/**
 * Check if we can open phone URLs
 */
export async function canCallPhone(): Promise<boolean> {
  try {
    return await Linking.canOpenURL('tel:+1234567890');
  } catch {
    return false;
  }
}

/**
 * Initiate a phone call
 */
export async function callPhone(phone: string): Promise<boolean> {
  const p = normalizePhone(phone);
  if (!p) return false;

  const url = `tel:${p}`;

  try {
    const can = await Linking.canOpenURL(url);
    if (can) {
      await Linking.openURL(url);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Open SMS to a phone number
 */
export async function sendSMS(phone: string, body?: string): Promise<boolean> {
  const p = normalizePhone(phone);
  if (!p) return false;

  let url = `sms:${p}`;
  if (body) {
    url += `?body=${encodeURIComponent(body)}`;
  }

  try {
    const can = await Linking.canOpenURL(url);
    if (can) {
      await Linking.openURL(url);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Validate phone number (basic check)
 */
export function isValidPhone(phone: string): boolean {
  const normalized = normalizePhone(phone);
  // At least 10 digits for a valid phone number
  const digitsOnly = normalized.replace(/\+/g, '');
  return digitsOnly.length >= 10;
}
