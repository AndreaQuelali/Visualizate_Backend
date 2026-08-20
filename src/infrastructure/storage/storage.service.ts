import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import { randomUUID } from 'crypto';

interface MinioConfig {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
}

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: Client;
  private readonly bucket: string;

  constructor(
    @Inject('MINIO_CONFIG') private readonly config: MinioConfig,
    private readonly configService: ConfigService,
  ) {
    this.client = new Client(this.config);
    this.bucket =
      this.configService.get<string>('MINIO_BUCKET') || 'visualizate';
  }

  getClient(): Client {
    return this.client;
  }

  async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket, '');
      this.logger.log(`Bucket '${this.bucket}' creado`);
    }
  }

  /**
   * Uploads a file buffer to MinIO and returns a public-ish object URL.
   */
  async uploadFile(file: UploadedFile, folder = 'logos'): Promise<string> {
    await this.ensureBucket();

    const ext = file.originalname.includes('.')
      ? file.originalname.split('.').pop()
      : 'bin';
    const objectName = `${folder}/${randomUUID()}.${ext}`;

    await this.client.putObject(
      this.bucket,
      objectName,
      file.buffer,
      file.size,
      { 'Content-Type': file.mimetype },
    );

    const protocol = this.config.useSSL ? 'https' : 'http';
    const url = `${protocol}://${this.config.endPoint}:${this.config.port}/${this.bucket}/${objectName}`;
    this.logger.log(`Archivo subido: ${objectName}`);
    return url;
  }

  /** Stores a buffer under an explicit object key. */
  async putObject(
    key: string,
    buffer: Buffer,
    mimetype: string,
  ): Promise<void> {
    await this.ensureBucket();
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      'Content-Type': mimetype,
    });
  }

  async removeObject(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
  }

  /** Throws when the object store is unreachable (used by /health). */
  async ping(): Promise<void> {
    await this.client.bucketExists(this.bucket);
  }

  /** Removes every object under a prefix and returns how many were deleted. */
  async removePrefix(prefix: string): Promise<number> {
    const keys: string[] = [];
    const stream = this.client.listObjectsV2(this.bucket, prefix, true);
    for await (const obj of stream as AsyncIterable<{ name?: string }>) {
      if (obj.name) keys.push(obj.name);
    }
    if (keys.length > 0) await this.client.removeObjects(this.bucket, keys);
    return keys.length;
  }

  /** Removes the object an URL created by `uploadFile` points to. */
  async removeByUrl(url: string): Promise<void> {
    const marker = `/${this.bucket}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return;
    await this.removeObject(url.slice(idx + marker.length));
  }

  /**
   * Short-lived signed URL for reading a private object.
   * `responseHeaders` lets the caller force e.g. a download filename.
   */
  async getPresignedUrl(
    key: string,
    expirySeconds = 3600,
    responseHeaders?: Record<string, string>,
  ): Promise<string> {
    return this.client.presignedGetObject(
      this.bucket,
      key,
      expirySeconds,
      responseHeaders,
    );
  }

  /** Origin (scheme://host:port) that signed URLs point to. */
  getOrigin(): string {
    const protocol = this.config.useSSL ? 'https' : 'http';
    return `${protocol}://${this.config.endPoint}:${this.config.port}`;
  }
}
