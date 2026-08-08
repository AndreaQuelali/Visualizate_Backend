import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';
    const host =
      this.configService.get<string>('SMTP_HOST') ||
      (isProd ? 'smtp.gmail.com' : 'localhost');
    const port =
      Number(this.configService.get<number>('SMTP_PORT')) ||
      (isProd ? 465 : 1025);
    const secure =
      this.configService.get<boolean>('SMTP_SECURE') ?? (isProd ? true : false);
    const user = this.configService.get<string>('SMTP_USER') || '';
    const pass = this.configService.get<string>('SMTP_PASS') || '';

    this.logger.log(
      `Inicializando servicio de correo en entorno '${this.configService.get('NODE_ENV')}' utilizando SMTP en ${host}:${port}`,
    );

    const transportOptions: nodemailer.TransportOptions = {
      host,
      port,
      secure,
      ...(user && pass
        ? {
            auth: {
              user,
              pass,
            },
          }
        : {}),
    } as nodemailer.TransportOptions;

    this.transporter = nodemailer.createTransport(transportOptions);
  }

  /**
   * Envía correo de verificación de cuenta con enlace y plantilla HTML en español.
   */
  async sendVerificationEmail(
    to: string,
    fullName: string,
    token: string,
  ): Promise<void> {
    const from =
      this.configService.get<string>('SMTP_FROM') ||
      'Visualizate <no-reply@visualizate.local>';
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    const verifyLink = `${frontendUrl}/verify-email?token=${token}`;

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7fa; color: #333; margin: 0; padding: 20px; }
          .card { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
          .logo { font-size: 24px; font-weight: bold; color: #4f46e5; text-align: center; margin-bottom: 24px; }
          h2 { color: #1e293b; margin-top: 0; }
          p { line-height: 1.6; color: #475569; }
          .btn-container { text-align: center; margin: 32px 0; }
          .btn { background-color: #4f46e5; color: #ffffff !important; font-weight: 600; text-decoration: none; padding: 14px 28px; border-radius: 8px; display: inline-block; }
          .footer { margin-top: 32px; font-size: 12px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 16px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="logo">Visualizate</div>
          <h2>¡Hola, ${fullName}! 👋</h2>
          <p>Gracias por registrarte en Visualizate. Para completar la creación de tu cuenta y acceder a todas las funciones, confirma tu dirección de correo electrónico haciendo clic en el siguiente botón:</p>
          <div class="btn-container">
            <a href="${verifyLink}" target="_blank" class="btn">Verificar mi correo</a>
          </div>
          <p>O copia y pega el siguiente enlace en tu navegador:</p>
          <p><a href="${verifyLink}">${verifyLink}</a></p>
          <p>Este enlace expirará en 24 horas.</p>
          <div class="footer">
            Si no creaste esta cuenta, puedes ignorar este mensaje de forma segura.<br>
            © ${new Date().getFullYear()} Visualizate. Todos los derechos reservados.
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      await this.transporter.sendMail({
        from,
        to,
        subject: 'Confirma tu correo electrónico - Visualizate',
        text: `Hola ${fullName}, confirma tu correo ingresando a: ${verifyLink}`,
        html: htmlContent,
      });
      this.logger.log(`Correo de verificación enviado a ${to}`);
    } catch (error) {
      this.logger.error(
        `Error al enviar correo de verificación a ${to}:`,
        error,
      );
    }
  }

  /**
   * Envía correo de invitación a un espacio de trabajo.
   */
  async sendWorkspaceInvitationEmail(
    to: string,
    workspaceName: string,
    inviterName: string,
    role: string,
    token: string,
  ): Promise<void> {
    const from =
      this.configService.get<string>('SMTP_FROM') ||
      'Visualizate <no-reply@visualizate.local>';
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    const inviteLink = `${frontendUrl}/workspaces/accept-invitation?token=${token}`;

    const roleLabel: Record<string, string> = {
      ADMIN: 'Administrador',
      DESIGNER: 'Diseñador',
      ORGANIZER: 'Organizador',
    };

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7fa; color: #333; margin: 0; padding: 20px; }
          .card { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
          .logo { font-size: 24px; font-weight: bold; color: #4f46e5; text-align: center; margin-bottom: 24px; }
          h2 { color: #1e293b; margin-top: 0; }
          p { line-height: 1.6; color: #475569; }
          .btn-container { text-align: center; margin: 32px 0; }
          .btn { background-color: #4f46e5; color: #ffffff !important; font-weight: 600; text-decoration: none; padding: 14px 28px; border-radius: 8px; display: inline-block; }
          .footer { margin-top: 32px; font-size: 12px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 16px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="logo">Visualizate</div>
          <h2>Te invitaron a un espacio de trabajo</h2>
          <p><strong>${inviterName}</strong> te ha invitado a unirte a <strong>${workspaceName}</strong> como <strong>${roleLabel[role] ?? role}</strong>.</p>
          <p>Haz clic en el botón para aceptar la invitación:</p>
          <div class="btn-container">
            <a href="${inviteLink}" target="_blank" class="btn">Aceptar invitación</a>
          </div>
          <p>O copia y pega el siguiente enlace en tu navegador:</p>
          <p><a href="${inviteLink}">${inviteLink}</a></p>
          <p>Este enlace expirará en 7 días.</p>
          <div class="footer">
            Si no esperabas esta invitación, puedes ignorar este mensaje.<br>
            © ${new Date().getFullYear()} Visualizate. Todos los derechos reservados.
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      await this.transporter.sendMail({
        from,
        to,
        subject: `Invitación a ${workspaceName} - Visualizate`,
        text: `${inviterName} te invitó a ${workspaceName}. Acepta en: ${inviteLink}`,
        html: htmlContent,
      });
      this.logger.log(`Correo de invitación enviado a ${to}`);
    } catch (error) {
      this.logger.error(`Error al enviar invitación a ${to}:`, error);
    }
  }

  /**
   * Envía correo de restablecimiento de contraseña con enlace y plantilla HTML en español.
   */
  async sendPasswordResetEmail(
    to: string,
    fullName: string,
    token: string,
  ): Promise<void> {
    const from =
      this.configService.get<string>('SMTP_FROM') ||
      'Visualizate <no-reply@visualizate.local>';
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    const resetLink = `${frontendUrl}/new-password?token=${token}`;

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7fa; color: #333; margin: 0; padding: 20px; }
          .card { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
          .logo { font-size: 24px; font-weight: bold; color: #4f46e5; text-align: center; margin-bottom: 24px; }
          h2 { color: #1e293b; margin-top: 0; }
          p { line-height: 1.6; color: #475569; }
          .btn-container { text-align: center; margin: 32px 0; }
          .btn { background-color: #4f46e5; color: #ffffff !important; font-weight: 600; text-decoration: none; padding: 14px 28px; border-radius: 8px; display: inline-block; }
          .footer { margin-top: 32px; font-size: 12px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 16px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="logo">Visualizate</div>
          <h2>Restablecimiento de contraseña</h2>
          <p>Hola ${fullName}, recibimos una solicitud para restablecer la contraseña de tu cuenta en Visualizate.</p>
          <p>Para crear una nueva contraseña, haz clic en el botón de abajo:</p>
          <div class="btn-container">
            <a href="${resetLink}" target="_blank" class="btn">Restablecer mi contraseña</a>
          </div>
          <p>O copia y pega el siguiente enlace en tu navegador:</p>
          <p><a href="${resetLink}">${resetLink}</a></p>
          <p>Este enlace es válido por 24 horas.</p>
          <div class="footer">
            Si no solicitaste este cambio, puedes ignorar este mensaje y tu contraseña continuará siendo la misma.<br>
            © ${new Date().getFullYear()} Visualizate. Todos los derechos reservados.
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      await this.transporter.sendMail({
        from,
        to,
        subject: 'Restablece tu contraseña - Visualizate',
        text: `Hola ${fullName}, restablece tu contraseña ingresando a: ${resetLink}`,
        html: htmlContent,
      });
      this.logger.log(`Correo de restablecimiento enviado a ${to}`);
    } catch (error) {
      this.logger.error(
        `Error al enviar correo de restablecimiento a ${to}:`,
        error,
      );
    }
  }
}
