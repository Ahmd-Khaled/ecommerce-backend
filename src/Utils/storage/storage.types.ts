export type StorageModule = 'users' | 'products' | 'categories' | 'banners';
export interface StoredFile {
  key: string;
  url: string;
  module: StorageModule;
  ownerId: string;
  uploadedBy: string;
  field: string;
  size: number;
  width: number;
  height: number;
  mime: 'image/webp';
  createdAt: string;
}
export interface FileStorage {
  stage(): Promise<string>;
  finalize(source: string, file: StoredFile): Promise<void>;
  readMetadata(key: string): Promise<StoredFile>;
  remove(key: string): Promise<void>;
}
export interface UploadField {
  name: string;
  folder: string;
  maxCount: number;
  maxBytes: number;
  multiple?: boolean;
}
export interface UploadPolicy {
  module: StorageModule;
  param?: string;
  fields: UploadField[];
  numbers?: string[];
  booleans?: string[];
  json?: string[];
  nullable?: string[];
}
