const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { CategoryModel } = require('../dist/DB/models/category/category.model');
const { ProductModel } = require('../dist/DB/models/product/product.model');
const { categoryRepository: repo } = require('../dist/DB/repository/category.repository');
const { productRepository: products } = require('../dist/DB/repository/product.repository');
const { categoryService: service } = require('../dist/Modules/category/category.service');
const { productService } = require('../dist/Modules/product/product.service');

// Never connect to the application database. Each run owns a unique test database.
test('category hierarchy transactions on a real replica set', { skip: !process.env.MONGO_TEST_URI }, async t => {
  const dbName = `category_test_${new mongoose.Types.ObjectId()}`;
  await mongoose.connect(process.env.MONGO_TEST_URI, { dbName, serverSelectionTimeoutMS: 5000 });
  t.after(async () => {
    if (mongoose.connection.name === dbName) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  await Promise.all([CategoryModel.init(), ProductModel.init()]);
  const owner = new mongoose.Types.ObjectId();
  const create = (parent) => {
    const slug = new mongoose.Types.ObjectId().toString();
    return service.createCategory({ name: 'Category', slug, ...(parent && { parent: String(parent) }) }, owner);
  };
  const productInput = category => ({ name: 'Product', slug: new mongoose.Types.ObjectId().toString(),
    description: 'Product description', sku: new mongoose.Types.ObjectId().toString(), price: 10,
    stock: 1, images: ['https://example.com/product.png'], category: String(category) });

  await t.test('concurrent first writes initialize the guard safely', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => create()));
    assert.equal(results.length, 6);
    assert.equal(await mongoose.connection.collection('category_hierarchy_guards').countDocuments(), 1);
  });

  await t.test('opposing reparent operations cannot form a cycle', async () => {
    const [a, b] = await Promise.all([create(), create()]);
    const results = await Promise.allSettled([
      service.updateCategory(String(a._id), { parent: String(b._id) }),
      service.updateCategory(String(b._id), { parent: String(a._id) }),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const failure = results.find(r => r.status === 'rejected').reason;
    assert.equal(failure.statusCode, 400);
    assert.match(failure.message, /circular/);
  });

  await t.test('disjoint writes cannot create a longer cycle', async () => {
    const a = await create(), b = await create(a._id), c = await create(), d = await create(c._id);
    const results = await Promise.allSettled([
      service.updateCategory(String(a._id), { parent: String(d._id) }),
      service.updateCategory(String(c._id), { parent: String(b._id) }),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.statusCode, 400);
  });

  for (const move of [false, true]) {
    await t.test(`deletion races safely with child ${move ? 'reparenting' : 'creation'}`, async () => {
      const parent = await create(), child = move ? await create() : null;
      const results = await Promise.allSettled([
        service.deleteCategory(String(parent._id)),
        move ? service.updateCategory(String(child._id), { parent: String(parent._id) }) : create(parent._id),
      ]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      const exists = await CategoryModel.exists({ _id: parent._id });
      const children = await CategoryModel.countDocuments({ parent: parent._id });
      assert.ok(exists || children === 0);
      assert.equal(results.find(r => r.status === 'rejected').reason.statusCode, exists ? 400 : 404);
    });
  }

  await t.test('ancestor deactivation is ordered against hierarchy validation', async sub => {
    const ancestor = await create(), parent = await create(ancestor._id);
    const original = repo.updateCategory.bind(repo);
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    sub.mock.method(repo, 'updateCategory', async (...args) => {
      const result = await original(...args);
      entered();
      await gate;
      return result;
    });
    const deactivate = service.updateCategory(String(ancestor._id), { isActive: false });
    await started;
    const child = create(parent._id);
    release();
    await deactivate;
    await assert.rejects(child, { statusCode: 400, message: 'Cannot assign an inactive parent category' });
  });

  for (const reassign of [false, true]) {
    await t.test(`product ${reassign ? 'reassignment' : 'creation'} cannot race past deletion`, async () => {
      const target = await create();
      const existing = reassign ? await productService.createProduct(productInput((await create())._id), owner) : null;
      const results = await Promise.allSettled([
        service.deleteCategory(String(target._id)),
        reassign ? productService.updateProduct(String(existing._id), { category: String(target._id) })
          : productService.createProduct(productInput(target._id), owner),
      ]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      const exists = await CategoryModel.exists({ _id: target._id });
      assert.ok(exists || await ProductModel.countDocuments({ category: target._id }) === 0);
    });
  }

  for (const method of ['createCategory', 'updateCategory', 'deleteCategory']) {
    await t.test(`${method} rolls back after a successful database write`, async sub => {
      const category = await create();
      const original = repo[method].bind(repo);
      const failure = new Error('Injected failure after write');
      const before = await CategoryModel.find().lean();
      const guardBefore = await mongoose.connection.collection('category_hierarchy_guards').findOne({});
      sub.mock.method(repo, method, async (...args) => { await original(...args); throw failure; });
      const operation = method === 'createCategory' ? create(category._id)
        : method === 'updateCategory' ? service.updateCategory(String(category._id), { name: 'Changed' })
        : service.deleteCategory(String(category._id));
      await assert.rejects(operation, error => error === failure);
      assert.deepEqual(await CategoryModel.find().lean(), before);
      assert.deepEqual(await mongoose.connection.collection('category_hierarchy_guards').findOne({}), guardBefore);
    });
  }

  await t.test('public tree and product counts share a snapshot across concurrent writes', async sub => {
    const root = await create(), child = await create(root._id);
    await productService.createProduct(productInput(child._id), owner);
    const original = products.countProductsByCategory.bind(products);
    let changed = false;
    sub.mock.method(products, 'countProductsByCategory', async (...args) => {
      if (!changed) {
        changed = true;
        await service.updateCategory(String(child._id), { parent: null });
        await productService.createProduct(productInput(child._id), owner);
      }
      return original(...args);
    });
    const tree = await service.getCategoryTree();
    const node = tree.find(row => row._id.equals(root._id));
    assert.equal(node.children.length, 1);
    assert.equal(node.totalProductCount, 1);
    const next = await service.getCategoryTree();
    assert.equal(next.find(row => row._id.equals(root._id)).children.length, 0);
    assert.equal(next.find(row => row._id.equals(child._id)).totalProductCount, 2);
  });
});
