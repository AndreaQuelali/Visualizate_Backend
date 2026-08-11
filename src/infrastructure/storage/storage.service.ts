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
}
