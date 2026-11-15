import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { storageConfig } from './storage.config';
import type { FileStorage, StoredFile } from './storage.types';

export const keyPattern =
  /^(users\/[a-f0-9]{24}\/avatar|products\/[a-f0-9]{24}\/images|categories\/[a-f0-9]{24}\/image|banners\/[a-f0-9]{24}\/image)\/[a-f0-9-]{36}\.webp$/;

// The storage directory must be writable only by the application OS account.
// Check every existing ancestor, including junctions on Windows, before access.
export async function safePath(relative: string, createParents = false): Promise<string> {
  const root = storageConfig().root;
  if (
    relative
      .split('/')
      .some((part) => !/^[a-zA-Z0-9._-]+$/.test(part) || part === '.' || part === '..')
  )
    throw new Error('Invalid storage key');
  const target = path.resolve(root, ...relative.split('/'));
  if (!target.startsWith(root + path.sep)) throw new Error('Storage path escaped root');
  const parsed = path.parse(target);
  let current = parsed.root;
  const parts = target.slice(parsed.root.length).split(path.sep);
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]!);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory()))
        throw new Error('Unsafe storage path');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (createParents && i < parts.length - 1) {
        await fs.mkdir(current, { mode: 0o700 }).catch((mkdirError: NodeJS.ErrnoException) => {
          if (mkdirError.code !== 'EEXIST') throw mkdirError;
        });
        const created = await fs.lstat(current);
        if (created.isSymbolicLink() || !created.isDirectory())
          throw new Error('Unsafe storage path');
      }
    }
  }
  return target;
}

export const localStorage: FileStorage = {
  async stage() {
    const relative = `staging/${randomUUID()}`;
    await fs.mkdir(await safePath(relative, true), { mode: 0o700 });
    return relative;
  },
  async finalize(source, file) {
    if (!keyPattern.test(file.key)) throw new Error('Invalid storage key');
    const target = await safePath(file.key, true);
    // Write metadata first so a crash never leaves an untracked finalized file.
    await fs.writeFile(await safePath(file.key + '.json'), JSON.stringify(file), {
      flag: 'wx',
      mode: 0o600,
    });
    await fs.copyFile(source, target, constants.COPYFILE_EXCL);
  },
  async readMetadata(key) {
    if (!keyPattern.test(key)) throw new Error('Invalid storage key');
    const data = JSON.parse(await fs.readFile(await safePath(key + '.json'), 'utf8')) as StoredFile;
    if (data.key !== key || data.mime !== 'image/webp') throw new Error('Invalid storage metadata');
    return data;
  },
  async remove(key) {
    if (!keyPattern.test(key)) throw new Error('Invalid storage key');
    await fs.rm(await safePath(key), { force: true });
    await fs.rm(await safePath(key + '.json'), { force: true });
  },
};

export async function removeStage(relative: string) {
  if (!/^staging\/[a-f0-9-]{36}$/.test(relative)) throw new Error('Invalid staging key');
  const dir = await safePath(relative);
  // Only our flat, generated entries are removed; never recursively follow links.
  for (const name of await fs.readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [] as string[];
    throw error;
  })) {
    const file = await safePath(`${relative}/${name}`);
    if (!(await fs.lstat(file)).isFile()) throw new Error('Unexpected staging entry');
    await fs.unlink(file);
  }
  await fs.rmdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
