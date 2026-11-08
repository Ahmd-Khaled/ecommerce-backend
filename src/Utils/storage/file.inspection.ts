import path from 'node:path';
import sharp from 'sharp';
import { BadRequestException } from '../response/error.response';
import { storageConfig } from './storage.config';

// Avoid libvips retaining open file handles after processing (notably on Windows).
sharp.cache({ files: 0 });

const formats: Record<string, { mime: string; extensions: string[] }> = {
  jpg: { mime: 'image/jpeg', extensions: ['.jpg', '.jpeg'] },
  png: { mime: 'image/png', extensions: ['.png'] },
  webp: { mime: 'image/webp', extensions: ['.webp'] },
};

export function checkFilename(name: string, mime: string) {
  if (
    name.length > 180 ||
    /[\x00-\x1f\x7f<>:"/\\|?*]/.test(name) ||
    name.startsWith('.') ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  ) {
    throw new BadRequestException('Unsafe upload filename');
  }
  const ext = path.extname(name).toLowerCase();
  if (
    !Object.values(formats).some(
      (format) => format.mime === mime && format.extensions.includes(ext),
    )
  ) {
    throw new BadRequestException('Only JPEG, PNG and WebP images are allowed');
  }
}

export async function inspectImage(file: Express.Multer.File, output: string, maxBytes: number) {
  if (!file.size || file.size > maxBytes) throw new BadRequestException('Invalid image size');
  checkFilename(file.originalname, file.mimetype);
  const config = storageConfig();
  try {
    // Node 22+ supports require(esm); file-type has no top-level await.
    const { fileTypeFromFile } = require('file-type') as {
      fileTypeFromFile(path: string): Promise<{ ext: string; mime: string } | undefined>;
    };
    const detected = await fileTypeFromFile(file.path);
    const format = detected && formats[detected.ext];
    if (
      !format ||
      detected!.mime !== file.mimetype ||
      !format.extensions.includes(path.extname(file.originalname).toLowerCase())
    )
      throw new Error('Signature mismatch');
    const options = {
      limitInputPixels: config.maxPixels,
      failOn: 'warning' as const,
    };
    const metadata = await sharp(file.path, options).metadata();
    if (metadata.format !== (detected!.ext === 'jpg' ? 'jpeg' : detected!.ext))
      throw new Error('Decoded format mismatch');
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width > config.maxDimension ||
      metadata.height > config.maxDimension ||
      (metadata.pages ?? 1) !== 1
    )
      throw new Error('Image dimensions or animation rejected');
    const result = await sharp(file.path, options)
      .rotate()
      .webp({ quality: 85 })
      .timeout({ seconds: 10 })
      .toFile(output);
    if (result.size > maxBytes) throw new Error('Processed image exceeds limit');
    return { size: result.size, width: result.width, height: result.height };
  } catch {
    throw new BadRequestException('Invalid, unsupported, or oversized image content');
  }
}
