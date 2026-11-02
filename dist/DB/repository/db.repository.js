"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseRepository = void 0;
class DatabaseRepository {
    model;
    constructor(model) {
        this.model = model;
    }
    async create({ data, options }) {
        return await this.model.create(data, options);
    }
    async insertMany({ data }) {
        return await this.model.insertMany(data);
    }
    async find({ filter, select, options }) {
        const docs = this.model.find(filter).select(select || '');
        if (options?.populate) {
            docs.populate(options.populate);
        }
        return await docs.exec();
    }
    async paginate({ filter = {}, options = {}, select = {}, page = 1, limit = 10 }) {
        let docsCount = undefined;
        let pages = undefined;
        page = Math.floor(page < 1 ? 1 : page);
        options.limit = Math.floor(limit < 1 || !limit ? 10 : limit);
        options.skip = (page - 1) * options.limit;
        docsCount = await this.model.countDocuments(filter);
        pages = Math.ceil(docsCount / options.limit);
        const docs = this.model.find(filter, select, options);
        if (options?.populate) {
            docs.populate(options.populate);
        }
        return {
            limit: options.limit,
            count: docsCount,
            pages,
            currentPage: page,
            docs: await docs.exec(),
        };
    }
    async findOne({ filter, select, options }) {
        const doc = this.model.findOne(filter).select(select || '');
        if (options?.populate) {
            doc?.populate(options.populate);
        }
        return await doc.exec();
    }
    async findOneAndUpdate({ filter, update, options }) {
        const doc = this.model.findOneAndUpdate(filter, update, options ?? {});
        if (options?.populate) {
            doc?.populate(options.populate);
        }
        return await doc.exec();
    }
    async findById({ id, select, options }) {
        const doc = this.model.findById(id).select(select || '');
        if (options?.populate) {
            doc?.populate(options.populate);
        }
        return await doc.exec();
    }
    async updateOne({ filter, update, options }) {
        return await this.model.updateOne(filter, { ...update, $inc: { __v: 1 } }, options);
    }
    async deleteOne({ filter }) {
        return await this.model.deleteOne(filter);
    }
    async deleteMany({ filter }) {
        return await this.model.deleteMany(filter);
    }
    async findOneAndDelete({ filter }) {
        return await this.model.findOneAndDelete(filter);
    }
}
exports.DatabaseRepository = DatabaseRepository;
