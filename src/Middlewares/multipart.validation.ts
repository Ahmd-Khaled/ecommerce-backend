import { BadRequestException } from '../Utils/response/error.response';
import type { UploadPolicy } from '../Utils/storage/storage.types';

export function convertMultipart(body: Record<string, unknown>, policy: UploadPolicy) {
  for (const [key, value] of Object.entries(body)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key) || typeof value !== 'string')
      throw new BadRequestException('Duplicate or invalid form field');
    if (policy.nullable?.includes(key) && value === 'null') body[key] = null;
    else if (policy.numbers?.includes(key)) {
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)))
        throw new BadRequestException(`Invalid number: ${key}`);
      body[key] = Number(value);
    } else if (policy.booleans?.includes(key)) {
      if (value !== 'true' && value !== 'false')
        throw new BadRequestException(`Invalid boolean: ${key}`);
      body[key] = value === 'true';
    } else if (policy.json?.includes(key)) {
      try {
        body[key] = JSON.parse(value);
      } catch {
        throw new BadRequestException(`Invalid JSON: ${key}`);
      }
    }
  }
}
