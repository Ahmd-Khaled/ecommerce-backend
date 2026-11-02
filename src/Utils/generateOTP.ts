import { randomInt } from "node:crypto";

// ============================================================================
//  Helper Functions
// ============================================================================

/**
 * Generates a cryptographically secure 6-digit OTP.
 *
 * Examples:
 * 004821
 * 123456
 * 987654
 *
 * OTP is returned as a string to preserve leading zeros.
 */

export const generateOTP = (): string => {
  return randomInt(0, 1_000_000)
    .toString()
    .padStart(6, "0");
};