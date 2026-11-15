import * as fs from 'node:fs/promises';
import { localStorage, removeStage, safePath, keyPattern } from './local.storage';
import { storageConfig } from './storage.config';
import { storageService } from './storage.service';

export const activeUploads = new Set<string>();
let running = false;
export async function reconcileUploads() {
  if (running) return;
  running = true;
  const cutoff = Date.now() - storageConfig().retentionMs;
  try {
    const walk = async (relative: string): Promise<void> => {
      const directory = await safePath(relative);
      const entries = await fs
        .readdir(directory, { withFileTypes: true })
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return [];
          throw error;
        });
      for (const entry of entries) {
        const key = `${relative}/${entry.name}`;
        if (entry.isSymbolicLink() || activeUploads.has(key)) continue;
        const stat = await fs.lstat(await safePath(key));
        if (relative === 'staging') {
          if (entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name) && stat.mtimeMs < cutoff)
            await removeStage(key);
        } else if (entry.isDirectory()) await walk(key);
        else if (key.endsWith('.webp.json') && stat.mtimeMs < cutoff) {
          const fileKey = key.slice(0, -5);
          if (!keyPattern.test(fileKey) || activeUploads.has(fileKey)) continue;
          const metadata = await localStorage.readMetadata(fileKey);
          // Database errors abort cleanup; uncertainty must never delete files.
          if (!(await storageService.referenced(metadata))) await localStorage.remove(fileKey);
        }
      }
    };
    for (const directory of ['staging', 'users', 'products', 'categories', 'banners']) await walk(directory);
  } finally {
    running = false;
  }
}

export function startUploadCleanup() {
  const run = () => {
    void reconcileUploads().catch(() => console.error('Upload reconciliation failed; will retry'));
  };
  run();
  const timer = setInterval(run, 3600000);
  timer.unref();
  return () => clearInterval(timer);
}
