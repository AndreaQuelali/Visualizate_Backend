import { Injectable, Inject } from '@nestjs/common';
import { Client } from 'minio';

interface MinioConfig {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
}

@Injectable()
export class StorageService {
  private readonly client: Client;

  constructor(@Inject('MINIO_CONFIG') private readonly config: MinioConfig) {
    this.client = new Client(this.config);
  }

  getClient(): Client {
    return this.client;
  }
}
