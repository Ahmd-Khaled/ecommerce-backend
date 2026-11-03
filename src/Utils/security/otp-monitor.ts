// Emit only threshold crossings from the atomic database attempt count.
// Never include request bodies, email addresses, passwords, or OTPs.
export const monitorOTPFailure = (failure: {
  flow: "confirm-email" | "reset-password";
  userId: string;
  ip: string | undefined;
  attempts: number | null;
  maxAttempts: number;
}): void => {
  if (failure.attempts !== 3 && failure.attempts !== failure.maxAttempts) return;

  console.warn(JSON.stringify({
    event: "otp_repeated_failure",
    severity: "warning",
    timestamp: new Date().toISOString(),
    flow: failure.flow,
    userId: failure.userId,
    ip: failure.ip ?? "unknown",
    attempts: failure.attempts,
    maxAttempts: failure.maxAttempts,
    attemptLimitReached: failure.attempts === failure.maxAttempts,
  }));
};
