import type { Request, RequestHandler } from 'express';
import type { ZodType } from 'zod';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { rateLimit } from 'express-rate-limit';
import {
  ApplicationException,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '../Utils/response/error.response';
import { localStorage, removeStage, safePath } from '../Utils/storage/local.storage';
import { storageConfig } from '../Utils/storage/storage.config';
import { checkFilename, inspectImage } from '../Utils/storage/file.inspection';
import { activeUploads } from '../Utils/storage/upload.cleanup';
import { storageService } from '../Utils/storage/storage.service';
import type { StoredFile, UploadPolicy } from '../Utils/storage/storage.types';
import { convertMultipart } from './multipart.validation';
import { validations } from './validation.middlewares';

interface UploadContext {
  id: Types.ObjectId;
  expected?: { value: unknown };
}
const contexts = new WeakMap<object, UploadContext>();
export const uploadId = (req: object) => contexts.get(req)?.id;
export const uploadExpected = (req: object) => contexts.get(req)?.expected;
let concurrent = 0;
export const uploadLimiter = rateLimit({
  windowMs: 15 * 60000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => !req.is('multipart/form-data'),
});

function validateURLs(req: Request, policy: UploadPolicy) {
  for (const field of policy.fields) {
    const values = req.body?.[field.name];
    if (values === undefined) continue;
    if (policy.module === 'banners') throw new BadRequestException('Banner image must be an uploaded file');
    if (policy.module === 'users') throw new BadRequestException('Avatar must be an uploaded file');
    for (const value of Array.isArray(values) ? values : [values]) {
      if (typeof value !== 'string') continue; // Zod reports shape errors.
      let url: URL;
      let pathname: string;
      try {
        url = new URL(value);
        pathname = decodeURIComponent(url.pathname);
      } catch {
        throw new BadRequestException('Invalid image URL');
      }
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        /^\/media(?:\/|$)/i.test(pathname)
      ) {
        throw new BadRequestException('Use uploaded files or external HTTP(S) image URLs');
      }
    }
  }
}

export function uploadRoute(
  policy: UploadPolicy,
  schemas: { body?: ZodType; params?: ZodType },
  handler: RequestHandler<any, any, any>,
): RequestHandler {
  return async (req, res, next) => {
    let stage: string | undefined;
    let acquired = false;
    let executingHandler = false;
    const promoted: string[] = [];
    try {
      if (!req.is('multipart/form-data')) {
        validateURLs(req, policy);
        validations(schemas)(req, res, (error) => {
          if (error) throw error;
        });
        await handler(req, res, next);
        return;
      }
      const principal = policy.module === 'users' ? req.user : req.admin;
      if (!principal) throw new UnauthorizedException('Authentication required');
      const config = storageConfig();
      if (concurrent >= config.concurrency)
        throw new ApplicationException('Upload capacity reached; retry later', 503);
      concurrent++;
      acquired = true;
      if (schemas.params)
        validations({ params: schemas.params })(req, res, (error) => {
          if (error) throw error;
        });
      const param = policy.param ? req.params[policy.param] : undefined;
      const id =
        policy.module === 'users'
          ? principal._id
          : param
            ? new Types.ObjectId(String(param))
            : new Types.ObjectId();
      const context: UploadContext = { id };
      if (param || policy.module === 'users') {
        const owner = await storageService.owner(policy.module, id.toString());
        if (!owner) throw new NotFoundException('Upload owner not found');
        context.expected = owner;
      }
      contexts.set(req, context);
      const maxCount = policy.fields.reduce((sum, field) => sum + field.maxCount, 0);
      const maxBytes = Math.max(...policy.fields.map((field) => field.maxBytes));
      const maxTotal =
        policy.fields.reduce((sum, field) => sum + field.maxCount * field.maxBytes, 0) + 256 * 1024;
      if (Number(req.headers['content-length'] ?? 0) > maxTotal)
        throw new ApplicationException('Upload request too large', 413);
      stage = await localStorage.stage();
      activeUploads.add(stage);
      const destination = await safePath(stage);
      const parser = multer({
        preservePath: true,
        storage: multer.diskStorage({
          destination,
          filename: (_req, _file, cb) => cb(null, randomUUID()),
        }),
        limits: {
          fileSize: maxBytes,
          files: maxCount,
          fields: 20,
          fieldSize: 16384,
          parts: maxCount + 20,
          fieldNameSize: 64,
          headerPairs: 100,
          ...{ fieldNestingDepth: 0, fieldArrayIndexLimit: 0 },
        },
        fileFilter: (_req, file, cb) => {
          try {
            checkFilename(file.originalname, file.mimetype);
            cb(null, true);
          } catch (error) {
            cb(error as Error);
          }
        },
      }).fields(
        policy.fields.map((field) => ({
          name: field.name,
          maxCount: field.maxCount,
        })),
      );
      let total = 0;
      const countBytes = (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxTotal) req.destroy();
      };
      const timer = setTimeout(() => req.destroy(), config.timeoutMs);
      timer.unref();
      req.on('data', countBytes);
      try {
        await new Promise<void>((resolve, reject) =>
          parser(req, res, (error) => (error ? reject(error) : resolve())),
        );
      } catch (error) {
        if (error instanceof ApplicationException) throw error;
        const oversized = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
        throw new ApplicationException(
          oversized
            ? 'Uploaded file too large'
            : 'Invalid multipart upload or upload limit exceeded',
          oversized ? 413 : 400,
        );
      } finally {
        clearTimeout(timer);
        req.off('data', countBytes);
      }
      if (req.aborted || total > maxTotal)
        throw new BadRequestException('Upload interrupted or too large');
      convertMultipart(req.body, policy);
      validateURLs(req, policy);
      const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
      const pending: {
        source: Express.Multer.File;
        output: string;
        metadata: StoredFile;
        maxBytes: number;
      }[] = [];
      for (const field of policy.fields) {
        const entries = files[field.name] ?? [];
        if (!entries.length) continue;
        if (req.body[field.name] !== undefined)
          throw new BadRequestException(`Conflicting file and form field: ${field.name}`);
        const urls: string[] = [];
        for (const source of entries) {
          const name = randomUUID() + '.webp';
          const key = `${policy.module}/${id.toString()}/${field.folder}/${name}`;
          const url = `${config.publicUrl}/${key}`;
          urls.push(url);
          pending.push({
            source,
            output: await safePath(`${stage}/${name}`),
            maxBytes: field.maxBytes,
            metadata: {
              key,
              url,
              module: policy.module,
              ownerId: id.toString(),
              uploadedBy: principal._id.toString(),
              field: field.name,
              size: 0,
              width: 0,
              height: 0,
              mime: 'image/webp',
              createdAt: new Date().toISOString(),
            },
          });
        }
        req.body[field.name] = field.multiple ? urls : urls[0];
      }
      validations(schemas)(req, res, (error) => {
        if (error) throw error;
      });
      for (const item of pending) {
        Object.assign(item.metadata, await inspectImage(item.source, item.output, item.maxBytes));
      }
      if (req.aborted || res.destroyed) throw new BadRequestException('Upload interrupted');
      for (const item of pending) {
        activeUploads.add(item.metadata.key);
        promoted.push(item.metadata.key);
        await localStorage.finalize(item.output, item.metadata);
      }
      executingHandler = true;
      await handler(req, res, next);
    } catch (error) {
      next(
        acquired && !executingHandler && !(error instanceof ApplicationException)
          ? new ApplicationException('File upload failed', 500)
          : error,
      );
    } finally {
      contexts.delete(req);
      // Finalized files are reconciled after a grace period. A failed database
      // response can be an ambiguous commit, so immediate deletion is unsafe.
      for (const key of promoted) activeUploads.delete(key);
      if (stage) {
        try {
          await removeStage(stage);
        } catch {
          console.error('Staging cleanup failed; reconciliation will retry');
        }
        activeUploads.delete(stage);
      }
      if (acquired) concurrent--;
    }
  };
}
