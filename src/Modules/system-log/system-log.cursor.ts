import { createHmac, timingSafeEqual } from 'node:crypto';
import * as z from 'zod';
import { BadRequestException } from '../../Utils/response/error.response';
const schema = z.strictObject({ v: z.literal(1), from: z.iso.datetime(), to: z.iso.datetime(),
  cutoff: z.iso.datetime(), expires: z.number().int(), fingerprint: z.string().length(64),
  date: z.iso.datetime(), id: z.uuid() });
export type LogCursor = z.infer<typeof schema>;
export const signCursor = (cursor: LogCursor, secret: string) => {
  const payload = Buffer.from(JSON.stringify(cursor)).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
};
export const readCursor = (value: string, secret: string, now: number): LogCursor => {
  try {
    if (value.length > 4096) throw new Error();
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra) throw new Error();
    const expected = createHmac('sha256', secret).update(payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const cursor = schema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    if (cursor.expires <= now) throw new Error();
    return cursor;
  } catch { throw new BadRequestException('Invalid cursor'); }
};
