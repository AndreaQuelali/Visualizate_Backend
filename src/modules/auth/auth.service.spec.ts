import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { MailService } from '../../infrastructure/mail/mail.service';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const prismaUserFindUnique = jest.fn();
const prismaUserCreate = jest.fn();
const prismaVerificationTokenCreate = jest.fn();
const prismaPasswordResetTokenDeleteMany = jest.fn();
const prismaPasswordResetTokenCreate = jest.fn();

const mockPrisma = {
  user: {
    findUnique: prismaUserFindUnique,
    create: prismaUserCreate,
    update: jest.fn(),
  },
  verificationToken: {
    findUnique: jest.fn(),
    create: prismaVerificationTokenCreate,
    delete: jest.fn(),
  },
  passwordResetToken: {
    findUnique: jest.fn(),
    deleteMany: prismaPasswordResetTokenDeleteMany,
    create: prismaPasswordResetTokenCreate,
    delete: jest.fn(),
  },
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock.jwt.token'),
  signAsync: jest.fn().mockResolvedValue('mock.jwt.token'),
};

const mockMailService = {
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
};

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: MailService, useValue: mockMailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // ── register ──────────────────────────────────────────────────────────────

  describe('register()', () => {
    const dto = {
      email: 'test@example.com',
      password: 'Password1!',
      fullName: 'Juan Pérez',
    };

    it('debe registrar un usuario nuevo y enviar correo de verificación', async () => {
      prismaUserFindUnique.mockResolvedValueOnce(null); // no existe
      prismaUserCreate.mockResolvedValueOnce({
        id: 'user-id-1',
        email: dto.email,
        fullName: dto.fullName,
      });
      prismaVerificationTokenCreate.mockResolvedValueOnce({});

      const result = await service.register(dto);

      expect(result.message).toMatch(/registrado exitosamente/i);
      expect(result.userId).toBe('user-id-1');
      expect(mockMailService.sendVerificationEmail).toHaveBeenCalledWith(
        dto.email,
        dto.fullName,
        expect.any(String),
      );
    });

    it('debe lanzar ConflictException si el correo ya está registrado', async () => {
      prismaUserFindUnique.mockResolvedValueOnce({
        id: 'existing-user',
        email: dto.email,
      });

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });
  });

  // ── login ─────────────────────────────────────────────────────────────────

  describe('login()', () => {
    const dto = { email: 'test@example.com', password: 'Password1!' };

    it('debe retornar un token JWT con credenciales válidas', async () => {
      const passwordHash = await bcrypt.hash(dto.password, 10);
      prismaUserFindUnique.mockResolvedValueOnce({
        id: 'user-id-1',
        email: dto.email,
        fullName: 'Juan Pérez',
        passwordHash,
        isVerified: true,
      });

      const result = await service.login(dto);

      expect(result).toHaveProperty('accessToken', 'mock.jwt.token');
    });

    it('debe lanzar UnauthorizedException si el usuario no existe', async () => {
      prismaUserFindUnique.mockResolvedValueOnce(null);
      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('debe lanzar UnauthorizedException si la contraseña es incorrecta', async () => {
      const passwordHash = await bcrypt.hash('otra_contraseña', 10);
      prismaUserFindUnique.mockResolvedValueOnce({
        id: 'user-id-1',
        email: dto.email,
        passwordHash,
        fullName: 'Juan Pérez',
        isVerified: true,
      });

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── forgotPassword ────────────────────────────────────────────────────────

  describe('forgotPassword()', () => {
    it('debe enviar correo de recuperación si el usuario existe', async () => {
      prismaUserFindUnique.mockResolvedValueOnce({
        id: 'user-id-1',
        email: 'test@example.com',
        fullName: 'Juan Pérez',
      });
      prismaPasswordResetTokenDeleteMany.mockResolvedValueOnce({});
      prismaPasswordResetTokenCreate.mockResolvedValueOnce({});

      const result = await service.forgotPassword({
        email: 'test@example.com',
      });

      expect(result.message).toMatch(/si el correo electrónico existe/i);
      expect(mockMailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'test@example.com',
        'Juan Pérez',
        expect.any(String),
      );
    });

    it('debe devolver el mismo mensaje aunque el usuario no exista (no revelar info)', async () => {
      prismaUserFindUnique.mockResolvedValueOnce(null);

      const result = await service.forgotPassword({
        email: 'noexiste@example.com',
      });

      expect(result.message).toMatch(/si el correo electrónico existe/i);
      expect(mockMailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });
});
