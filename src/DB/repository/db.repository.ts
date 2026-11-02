import { DeleteResult, MongooseUpdateQueryOptions, Types, UpdateWriteOpResult } from "mongoose";
import { UpdateQuery } from "mongoose";
import { CreateOptions, HydratedDocument, Model, PopulateOptions, ProjectionType, QueryFilter, QueryOptions } from "mongoose";

export abstract class DatabaseRepository<
  TDocument,
  TVirtuals = {},
  THydratedDocument extends HydratedDocument<TDocument> = HydratedDocument<TDocument>
> {
  constructor(protected readonly model: Model<TDocument, {}, {}, TVirtuals, THydratedDocument>) { }

  // Create a new document
  async create({ data, options }
    : { data: Partial<TDocument>[], options?: CreateOptions | undefined })
    : Promise<HydratedDocument<TDocument>[] | undefined> {

    return await this.model.create(data as any, options);
  }

  async insertMany({ data }
    : { data: Partial<TDocument>[] })
    : Promise<HydratedDocument<TDocument>[]> {

    return await this.model.insertMany(data) as HydratedDocument<TDocument>[];
  }

  // Find matching documents
  async find({ filter, select, options }: {
    filter?: QueryFilter<TDocument>,
    select?: ProjectionType<TDocument> | null,
    options?: QueryOptions<TDocument> | null
  }) {
    const docs = this.model.find(filter).select(select || '');
    if (options?.populate) {
      docs.populate(options.populate as PopulateOptions[]);
    }

    return await docs.exec();
  }

  async paginate({
    filter = {},
    options = {},
    select = {},
    page = 1,
    limit = 10
  }: {
    filter?: QueryFilter<TDocument>,
    options?: QueryOptions<TDocument> | undefined,
    select?: ProjectionType<TDocument> | undefined,
    page?: number,
    limit?: number
  }) {
    let docsCount: number | undefined = undefined;
    let pages: number | undefined = undefined;

    page = Math.floor(page < 1 ? 1 : page);
    options.limit = Math.floor(limit < 1 || !limit ? 10 : limit);
    options.skip = (page - 1) * options.limit;
    docsCount = await this.model.countDocuments(filter);
    pages = Math.ceil(docsCount / options.limit);


    const docs = this.model.find(filter, select, options);
    if (options?.populate) {
      docs.populate(options.populate as PopulateOptions[]);
    }
    return {
      limit: options.limit,
      count: docsCount,
      pages,
      currentPage: page,
      docs: await docs.exec(),
    }

  }

  // Find a document
  async findOne({ filter, select, options }: {
    filter?: QueryFilter<TDocument>,
    select?: ProjectionType<TDocument> | null,
    options?: QueryOptions<TDocument> | null
  }) {
    const doc = this.model.findOne(filter).select(select || '');
    if (options?.populate) {
      doc?.populate(options.populate as PopulateOptions[]);
    }

    return await doc.exec();
  }


  async findOneAndUpdate({ filter, update, options }: {
    filter: QueryFilter<TDocument>,
    update: UpdateQuery<TDocument>,
    options?: QueryOptions<TDocument> | null
  }) {
    const doc = this.model.findOneAndUpdate(filter, update, options ?? {});
    if (options?.populate) {
      doc?.populate(options.populate as PopulateOptions[]);
    }

    return await doc.exec();
  }
  // Find a document
  async findById({ id, select, options }: {
    id: Types.ObjectId,
    select?: ProjectionType<TDocument> | null,
    options?: QueryOptions<TDocument> | null
  }) {
    const doc = this.model.findById(id).select(select || '');
    if (options?.populate) {
      doc?.populate(options.populate as PopulateOptions[]);
    }

    return await doc.exec();
  }

  async updateOne({ filter, update, options }: {
    filter: QueryFilter<TDocument>,
    update: UpdateQuery<TDocument>,
    options?: MongooseUpdateQueryOptions<TDocument> | null
  }): Promise<UpdateWriteOpResult> {
    return await this.model.updateOne(filter, { ...update, $inc: { __v: 1 } }, options);
  }

  async deleteOne({ filter }: {
    filter: QueryFilter<TDocument>,
  }): Promise<DeleteResult> {
    return await this.model.deleteOne(filter);
  }
  async deleteMany({ filter }: {
    filter: QueryFilter<TDocument>,
  }): Promise<DeleteResult> {
    return await this.model.deleteMany(filter);
  }
  async findOneAndDelete({ filter }: {
    filter: QueryFilter<TDocument>,
  }): Promise<HydratedDocument<TDocument> | null> {
    return await this.model.findOneAndDelete(filter);
  }
}









