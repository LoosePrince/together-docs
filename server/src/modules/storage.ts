import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { GetObjectCommand, S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config.js';

export interface StorageDriver {
  put(key: string, content: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  createReadStream(key: string): Promise<Readable>;
}
const local: StorageDriver = {
  async put(key, content) {
    const root = path.resolve(config.localStorageDir);
    const target = path.resolve(root, key);
    if (!target.startsWith(root + path.sep)) throw new Error('非法存储路径');
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target)) await fs.promises.writeFile(target, content, { flag: 'wx' });
  },
  async get(key) { return fs.promises.readFile(path.resolve(config.localStorageDir, key)); },
  async createReadStream(key) { return Readable.from(await this.get(key)); },
};

let s3: S3Client | undefined;
const s3Driver: StorageDriver = {
  async put(key, content) {
    if (!config.s3.bucket) throw new Error('请配置 S3_BUCKET');
    s3 ||= new S3Client(config.s3);
    await s3.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: content }));
  },
  async get(key) {
    if (!config.s3.bucket) throw new Error('请配置 S3_BUCKET');
    s3 ||= new S3Client(config.s3);
    const response = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    return Buffer.from(await response.Body!.transformToByteArray());
  },
  async createReadStream(key) { return Readable.from(await this.get(key)); },
};
export const storage = config.storageDriver === 's3' ? s3Driver : local;
