import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(registerDto: RegisterDto) {
    const { email, password, fullName } = registerDto;

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      throw new ConflictException('El correo electrónico ya está registrado');
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName,
        isVerified: false,
      },
    });

    // Create email verification token (expires in 24 hours)
    const token =
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    await this.prisma.verificationToken.create({
      data: {
        token,
        userId: user.id,
        expiresAt,
      },
    });

    // NOTE: Simulación de envío de correo en los logs.
    console.log(
      `[Email Mock] Enlace de verificación enviado a ${email}: /verify-email?token=${token}`,
    );

    return {
      message: 'Usuario registrado exitosamente. Por favor verifica tu correo.',
      userId: user.id,
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    // Find user
    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Check if is verified (opt-in requirement or full lock, let's keep it advisory or allow login but require verification screen)
    // For safety, we block login or just proceed. Let's allow and return verification state.

    // Generate JWT
    const payload = { sub: user.id, email: user.email };
    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        isVerified: user.isVerified,
      },
    };
  }

  async verifyEmail(token: string) {
    const record = await this.prisma.verificationToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!record) {
      throw new BadRequestException(
        'Token de verificación inválido o inexistente',
      );
    }

    if (new Date() > record.expiresAt) {
      // Remove expired token
      await this.prisma.verificationToken.delete({ where: { id: record.id } });
      throw new BadRequestException('El token de verificación ha expirado');
    }

    // Mark as verified
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { isVerified: true },
    });

    // Clean up verification token
    await this.prisma.verificationToken.delete({ where: { id: record.id } });

    return { message: 'Correo electrónico verificado con éxito' };
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const { email } = forgotPasswordDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // Security practice: do not leak if user exists or not, always return success message
    if (user) {
      // Generate reset token (expires in 24 hours)
      const token =
        Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15);
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      // Clean existing tokens first to avoid clutter
      await this.prisma.passwordResetToken.deleteMany({
        where: { userId: user.id },
      });

      await this.prisma.passwordResetToken.create({
        data: {
          token,
          userId: user.id,
          expiresAt,
        },
      });

      console.log(
        `[Email Mock] Enlace de recuperación enviado a ${email}: /new-password?token=${token}`,
      );
    }

    return {
      message:
        'Si el correo electrónico existe, se ha enviado un enlace para restablecer la contraseña.',
    };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const { token, password } = resetPasswordDto;

    const record = await this.prisma.passwordResetToken.findUnique({
      where: { token },
    });

    if (!record) {
      throw new BadRequestException(
        'Token de restablecimiento inválido o inexistente',
      );
    }

    if (new Date() > record.expiresAt) {
      await this.prisma.passwordResetToken.delete({ where: { id: record.id } });
      throw new BadRequestException('El token de restablecimiento ha expirado');
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Update password
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    });

    // Clean up reset token
    await this.prisma.passwordResetToken.delete({ where: { id: record.id } });

    return { message: 'Contraseña restablecida exitosamente' };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      isVerified: user.isVerified,
    };
  }

  async updateProfile(userId: string, updateProfileDto: UpdateProfileDto) {
    const { email, fullName, password } = updateProfileDto;
    const dataToUpdate: {
      fullName?: string;
      email?: string;
      isVerified?: boolean;
      passwordHash?: string;
    } = {};

    if (fullName !== undefined) {
      dataToUpdate.fullName = fullName;
    }

    if (email !== undefined) {
      // Check if email already in use
      const existingUser = await this.prisma.user.findUnique({
        where: { email },
      });
      if (existingUser && existingUser.id !== userId) {
        throw new ConflictException('El correo electrónico ya está en uso');
      }
      dataToUpdate.email = email;

      // If email changes, user becomes unverified
      if (existingUser?.email !== email) {
        dataToUpdate.isVerified = false;
      }
    }

    if (password !== undefined) {
      const salt = await bcrypt.genSalt(10);
      dataToUpdate.passwordHash = await bcrypt.hash(password, salt);
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: dataToUpdate,
    });

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      fullName: updatedUser.fullName,
      isVerified: updatedUser.isVerified,
    };
  }
}
