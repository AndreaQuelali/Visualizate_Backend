import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

@Module({
  imports: [ConfigModule],
  providers: [
    StorageService,
    {
      provide: 'MINIO_CONFIG',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        endPoint: config.get<string>('MINIO_ENDPOINT', 'localhost'),
        port: config.get<number>('MINIO_PORT', 9000),
        useSSL: config.get<boolean>('MINIO_USE_SSL', false),
        accessKey: config.get<string>('MINIO_ACCESS_KEY', ''),
        secretKey: config.get<string>('MINIO_SECRET_KEY', ''),
      }),
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
