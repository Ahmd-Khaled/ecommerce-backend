import { OAuth2Client } from 'google-auth-library';
import { ApplicationException, ForbiddenException, UnauthorizedException } from '../../Utils/response/error.response';

const client = new OAuth2Client();

export async function verifyGoogleToken(idToken: string) {
  const audience = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!audience) throw new ApplicationException('Google login is not configured', 503);

  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience });
    payload = ticket.getPayload();
  } catch {
    throw new UnauthorizedException('Invalid or expired Google ID token');
  }
  if (!payload || !payload.sub || payload.sub.length > 255 ||
      !payload.email || payload.email.length > 254 ||
      !Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) {
    throw new UnauthorizedException('Invalid or expired Google ID token');
  }
  if (payload.email_verified !== true) {
    throw new ForbiddenException('Google email must be verified');
  }
  return { ...payload, email: payload.email.trim().toLowerCase() };
}
