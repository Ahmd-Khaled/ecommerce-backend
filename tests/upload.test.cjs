const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const sharp = require('sharp');
const { z } = require('zod');
const { Types } = require('mongoose');
const { uploadRoute, uploadId } = require('../dist/Middlewares/upload.middlewares');
const { productUpload, categoryUpload, avatarUpload } = require('../dist/Utils/storage/upload.policies');
const { storageService, mediaRouter } = require('../dist/Utils/storage/storage.service');
const { localStorage, safePath } = require('../dist/Utils/storage/local.storage');
const { reconcileUploads, activeUploads } = require('../dist/Utils/storage/upload.cleanup');
const { createProductSchema } = require('../dist/Modules/product/product.validation');
const { createCategorySchema } = require('../dist/Modules/category/category.validation');
const { updateProfileSchema } = require('../dist/Modules/auth/auth.validation');
const { globalErrorHandler } = require('../dist/Utils/response/error.response');
const { checkFilename } = require('../dist/Utils/storage/file.inspection');
const { convertMultipart } = require('../dist/Middlewares/multipart.validation');

let root, server, base, png;
const owner = new Types.ObjectId();
let calls = [], rows = new Map();
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ecommerce-upload-test-'));
  process.env.STORAGE_ROOT = root;
  process.env.STORAGE_PUBLIC_URL = 'https://assets.example.test/media';
  png = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#ff8800' } }).png().toBuffer();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (req.headers.authorization === 'test') req.user = { _id: owner }; next(); });
  const persist = async (req, res) => {
    const id = uploadId(req)?.toString() ?? owner.toString();
    calls.push({ id, body: req.body });
    for (const url of [req.body.image, req.body.avatar, ...(req.body.images ?? [])].filter(Boolean)) rows.set(url, true);
    res.json({ id, ...req.body });
  };
  app.post('/products', uploadRoute(productUpload, { body: createProductSchema }, persist));
  app.post('/categories', uploadRoute(categoryUpload, createCategorySchema, persist));
  app.patch('/profile', uploadRoute(avatarUpload, updateProfileSchema, persist));
  app.post('/fail', uploadRoute(categoryUpload, createCategorySchema, async () => { throw new Error('Database failed'); }));
  app.post('/small', uploadRoute({ ...categoryUpload, fields: [{ ...categoryUpload.fields[0], maxBytes: 40 }] }, createCategorySchema, persist));
  app.post('/named', uploadRoute({ module: 'users', fields: [
    { name: 'front', folder: 'avatar', maxCount: 1, maxBytes: 10000 },
    { name: 'back', folder: 'avatar', maxCount: 2, maxBytes: 10000, multiple: true },
  ] }, { body: z.strictObject({ front: z.url(), back: z.array(z.url()).length(2) }) }, persist));
  app.use('/media', mediaRouter);
  app.use(globalErrorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  // mkdtemp returned this test-owned directory, never a configured production root.
  assert.ok(path.basename(root).startsWith('ecommerce-upload-test-'));
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
beforeEach(t => {
  calls = []; rows = new Map();
  t.mock.method(storageService, 'owner', async () => ({ value: undefined }));
  t.mock.method(storageService, 'referenced', async file => rows.has(file.url));
  t.mock.method(storageService, 'visible', async file => rows.has(file.url));
});
function category(file = png, name = 'photo.png', mime = 'image/png', field = 'image') {
  const form = new FormData();
  form.append('name', 'Books'); form.append('slug', 'books');
  if (file) form.append(field, new Blob([file], { type: mime }), name);
  return form;
}
async function send(route, body, method = 'POST', auth = true) {
  const result = await fetch(base + route, { method, headers: auth ? { authorization: 'test' } : {}, body });
  return { status: result.status, body: await result.json() };
}
async function emptyStaging() {
  // The response can arrive just before the wrapper's finally block completes.
  for (let i = 0; i < 100; i++) {
    const entries = await fs.readdir(path.join(root, 'staging')).catch(() => []);
    if (!entries.length) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Staging was not cleaned');
}

test('single image is decoded, normalized, stored under the record ID, and served with safe headers', async () => {
  const result = await send('/categories', category());
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.match(result.body.image, new RegExp(`/categories/${result.body.id}/image/.*\\.webp$`));
  const key = new URL(result.body.image).pathname.slice('/media/'.length);
  const metadata = await localStorage.readMetadata(key);
  assert.equal(metadata.uploadedBy, owner.toString());
  assert.equal(metadata.width, 4); assert.equal(metadata.height, 3);
  const decoded = await sharp(await safePath(key)).metadata();
  assert.equal(decoded.format, 'webp'); assert.equal(decoded.exif, undefined);
  const served = await fetch(base + '/media/' + key);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(served.headers.get('content-type'), 'image/webp');
  rows.clear();
  assert.equal((await fetch(base + '/media/' + key)).status, 404);
  assert.equal((await fetch(base + '/media/staging/private/file.png')).status, 404);
  await emptyStaging();
});

test('multiple product files and typed form fields validate together', async () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({ name: 'Camera', slug: 'camera', description: 'Camera description', sku: 'CAM-123', price: '12.50', stock: '3', category: owner.toString() })) form.append(key, value);
  form.append('images', new Blob([png], { type: 'image/png' }), 'one.png');
  form.append('images', new Blob([png], { type: 'image/png' }), 'two.png');
  const result = await send('/products', form);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.price, 12.5); assert.equal(result.body.stock, 3);
  assert.equal(result.body.images.length, 2);
  assert.notEqual(result.body.images[0], result.body.images[1]);
  assert.ok(result.body.images.every(url => url.includes(`/products/${result.body.id}/images/`)));
  await emptyStaging();
});

test('avatar ownership comes from authentication; named fields use independent counts', async () => {
  const form = new FormData();
  form.append('firstName', 'Ahmed');
  form.append('avatar', new Blob([png], { type: 'image/png' }), 'avatar.png');
  const result = await send('/profile', form, 'PATCH');
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.match(result.body.avatar, new RegExp(`/users/${owner}/avatar/`));
  const named = new FormData();
  for (const key of ['front', 'back', 'back']) named.append(key, new Blob([png], { type: 'image/png' }), 'photo.png');
  const accepted = await send('/named', named);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.back.length, 2);
  await emptyStaging();
});

test('rejects unauthenticated uploads, spoofed MIME/signatures, malformed images, and dangerous filenames', async () => {
  assert.equal((await send('/categories', category(), 'POST', false)).status, 401);
  for (const [data, name, mime] of [
    [png, 'photo.jpg', 'image/jpeg'], [Buffer.from('not an image'), 'photo.png', 'image/png'],
    [png.subarray(0, 30), 'photo.png', 'image/png'], [Buffer.alloc(0), 'photo.png', 'image/png'],
    [png, 'photo.svg', 'image/svg+xml'], [png, 'photo.png:evil', 'image/png'],
    [png, '../photo.png', 'image/png'], [png, 'CON.png', 'image/png'],
  ]) {
    const result = await send('/categories', category(data, name, mime));
    assert.equal(result.status, 400, `${name}: ${JSON.stringify(result.body)}`);
  }
  assert.equal(calls.length, 0);
  await emptyStaging();
});

test('rejects unknown, duplicate, conflicting and excessive fields/files before persistence', async () => {
  const unknown = category(); unknown.append('admin', 'true');
  const duplicate = category(); duplicate.append('name', 'Other');
  const conflict = category(); conflict.append('image', 'https://example.com/photo.png');
  const count = category(); count.append('image', new Blob([png], { type: 'image/png' }), 'two.png');
  const nested = category(); nested.append('name[999999999]', 'Other');
  for (const form of [unknown, duplicate, conflict, count, nested, category(png, 'photo.png', 'image/png', 'wrong')]) {
    const result = await send('/categories', form);
    assert.equal(result.status, 400, JSON.stringify(result.body));
  }
  assert.equal((await send('/small', category())).status, 413);
  assert.equal(calls.length, 0);
  await emptyStaging();
});

test('explicit form conversion preserves false and null and rejects invalid primitives', async () => {
  const form = category(); form.append('isActive', 'false'); form.append('sortOrder', '3');
  const accepted = await send('/categories', form);
  assert.equal(accepted.status, 200); assert.equal(accepted.body.isActive, false); assert.equal(accepted.body.sortOrder, 3);
  const body = { compareAtPrice: 'null', stock: '0', isActive: 'false', images: '["https://example.com/a.png"]' };
  convertMultipart(body, productUpload);
  assert.deepEqual(body, { compareAtPrice: null, stock: 0, isActive: false, images: ['https://example.com/a.png'] });
  for (const value of ['yes', '0', 'False', '']) assert.throws(() => convertMultipart({ isActive: value }, productUpload));
  for (const value of ['', 'Infinity', 'NaN', '1abc']) assert.throws(() => convertMultipart({ price: value }, productUpload));
  assert.throws(() => convertMultipart({ images: '[bad' }, productUpload));
  await emptyStaging();
});

test('JSON URLs remain compatible, managed URL injection and non-HTTP URLs are rejected', async () => {
  const request = body => fetch(base + '/categories', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await request({ name: 'Books', slug: 'books', image: 'https://example.com/a.png' })).status, 200);
  for (const image of ['file:///a.png', 'https://assets.example.test/media/categories/anything', 'https://assets.example.test/m%65dia/anything']) {
    assert.equal((await request({ name: 'Books', slug: 'books', image })).status, 400);
  }
});

test('pixel limit rejects decompression-heavy images', async () => {
  process.env.UPLOAD_MAX_PIXELS = '10';
  try { assert.equal((await send('/categories', category())).status, 400); }
  finally { delete process.env.UPLOAD_MAX_PIXELS; }
  await emptyStaging();
});

test('JPEG and WebP are accepted, animated WebP is rejected, and trailing payloads are removed', async () => {
  for (const [format, mime, ext] of [['jpeg', 'image/jpeg', 'jpg'], ['webp', 'image/webp', 'webp']]) {
    const data = await sharp(png)[format]().toBuffer();
    assert.equal((await send('/categories', category(data, `photo.${ext}`, mime))).status, 200);
  }
  const animated = await sharp(Buffer.from([255, 0, 0, 0, 255, 0]), { raw: { width: 1, height: 2, channels: 3, pageHeight: 1 } }).webp({ loop: 0 }).toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  assert.equal((await send('/categories', category(animated, 'animated.webp', 'image/webp'))).status, 400);
  const marker = Buffer.from('<script>untrusted-trailing-content</script>');
  const result = await send('/categories', category(Buffer.concat([png, marker])));
  assert.equal(result.status, 200);
  const stored = await fs.readFile(await safePath(new URL(result.body.image).pathname.slice(7)));
  assert.equal(stored.includes(marker), false);
  await emptyStaging();
});

test('aborted and timed-out multipart requests release staging and upload capacity', async () => {
  const http = require('node:http');
  async function incomplete(abort) {
    await new Promise((resolve, reject) => {
      const request = http.request(base + '/categories', { method: 'POST', headers: {
        authorization: 'test', 'content-type': 'multipart/form-data; boundary=upload-test',
      } });
      request.on('error', () => {});
      request.on('close', resolve);
      request.on('response', response => { response.resume(); response.once('end', resolve); });
      request.write('--upload-test\r\nContent-Disposition: form-data; name="image"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n');
      request.write(png);
      const guard = setTimeout(() => { request.destroy(); reject(new Error('Upload did not time out')); }, 4000);
      request.once('close', () => clearTimeout(guard));
      if (abort) setTimeout(() => request.destroy(), 50);
    });
    await emptyStaging();
    assert.equal(activeUploads.size, 0);
  }
  await incomplete(true);
  process.env.UPLOAD_TIMEOUT_MS = '1000';
  try { await incomplete(false); } finally { delete process.env.UPLOAD_TIMEOUT_MS; }
  assert.equal((await send('/categories', category())).status, 200);
  await emptyStaging();
});

test('failed persistence leaves a non-public orphan for safe reconciliation; active/referenced files survive', async () => {
  assert.equal((await send('/fail', category())).status, 500);
  await emptyStaging();
  const files = [];
  const walk = async directory => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filename);
      else if (entry.name.endsWith('.webp.json')) files.push(filename);
    }
  };
  await walk(root);
  assert.ok(files.length > 0);
  const keep = JSON.parse(await fs.readFile(files[0], 'utf8'));
  rows.set(keep.url, true);
  const active = JSON.parse(await fs.readFile(files[1], 'utf8'));
  activeUploads.add(active.key);
  const old = new Date(Date.now() - 48 * 3600000);
  for (const file of files) await fs.utimes(file, old, old);
  await reconcileUploads();
  assert.ok(await fs.stat(await safePath(keep.key)));
  assert.ok(await fs.stat(await safePath(active.key)));
  for (const file of files.slice(2)) await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  activeUploads.delete(active.key);
});

test('path helpers refuse traversal and unsafe filenames', async () => {
  await assert.rejects(safePath('../outside'));
  await assert.rejects(safePath('users/../../outside'));
  await assert.rejects(localStorage.remove('../outside'));
  for (const name of ['a:b.png', 'a\\b.png', '/a.png', '.hidden.png', 'x.png ', 'NUL.png']) assert.throws(() => checkFilename(name, 'image/png'));
});

test('storage rejects junction escapes and reconciliation removes only expired staging', async () => {
  const target = path.join(root, 'junction-target');
  const junction = path.join(root, 'junction');
  await fs.mkdir(target);
  await fs.symlink(target, junction, process.platform === 'win32' ? 'junction' : 'dir');
  try { await assert.rejects(safePath('junction/file')); }
  finally { await fs.unlink(junction); }
  const oldStage = await localStorage.stage();
  const freshStage = await localStorage.stage();
  const old = new Date(Date.now() - 48 * 3600000);
  await fs.utimes(await safePath(oldStage), old, old);
  await reconcileUploads();
  await assert.rejects(fs.stat(await safePath(oldStage)), { code: 'ENOENT' });
  assert.ok(await fs.stat(await safePath(freshStage)));
  await require('../dist/Utils/storage/local.storage').removeStage(freshStage);
});

test('declared and streamed total byte budgets are bounded', async () => {
  const http = require('node:http');
  const declared = await new Promise((resolve, reject) => {
    const request = http.request(base + '/small', { method: 'POST', headers: {
      authorization: 'test', 'content-type': 'multipart/form-data; boundary=budget', 'content-length': 300000,
    } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject);
    request.end('short');
  });
  assert.equal(declared, 413);
  await new Promise((resolve, reject) => {
    const request = http.request(base + '/small', { method: 'POST', headers: {
      authorization: 'test', 'content-type': 'multipart/form-data; boundary=budget',
    } });
    request.on('error', () => {});
    request.on('close', resolve);
    request.on('response', response => { response.resume(); response.on('end', resolve); });
    const deadline = setTimeout(() => { request.destroy(); reject(new Error('Byte budget did not stop the request')); }, 4000);
    request.on('close', () => clearTimeout(deadline));
    request.write(Buffer.alloc(300000, 'x'));
    request.end();
  });
  await emptyStaging();
  assert.equal(calls.length, 0);
});

test('storage failures hide internal paths and busy upload capacity fails closed', async t => {
  t.mock.method(localStorage, 'stage', async () => { throw new Error('EACCES secret/path'); });
  const failure = await send('/categories', category());
  assert.equal(failure.status, 500);
  assert.equal(failure.body.message, 'File upload failed');
  assert.equal(JSON.stringify(failure.body).includes('secret/path'), false);
  t.mock.restoreAll();
  process.env.UPLOAD_CONCURRENCY = '1';
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  t.mock.method(storageService, 'owner', async () => {
    entered();
    await new Promise(resolve => { release = resolve; });
    return { value: undefined };
  });
  const profile = new FormData(); profile.append('firstName', 'Ahmed');
  const waiting = send('/profile', profile, 'PATCH');
  try {
    await started;
    assert.equal((await send('/categories', category())).status, 503);
  } finally { release(); delete process.env.UPLOAD_CONCURRENCY; }
  assert.equal((await waiting).status, 200);
  await emptyStaging();
});
