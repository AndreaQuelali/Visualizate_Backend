# CLAUDE.md — Visualizate Backend

> Instrucciones específicas para **Claude** (y asistentes compatibles) al trabajar
> en este repositorio. Complementa `AGENTS.md`; léelos ambos.

---

## Contexto del proyecto

Backend REST API del proyecto **Visualizate**, una plataforma de creación de
contenido visual. Stack: **NestJS 11 · TypeScript · Prisma 7 · PostgreSQL 15 ·
BullMQ/Redis · MinIO · Nodemailer · JWT**.

El módulo de autenticación completo está implementado. El módulo de render
(Playwright + Sharp) es un skeleton listo para expandir.

---

## Cómo explorar el código antes de responder

1. **Leer primero `AGENTS.md`** para entender la arquitectura, capas y convenciones.
2. Revisar `src/app.module.ts` para ver todos los módulos registrados.
3. Revisar `src/config/env.validation.ts` para conocer las variables de entorno y sus defaults.
4. Para entender un módulo: leer `*.module.ts` → `*.service.ts` → `*.controller.ts`.
5. Para entender el esquema de datos: leer `prisma/schema.prisma`.

---

## Reglas de generación de código

### ✅ Siempre hacer

- Generar código **TypeScript estricto**: tipos explícitos, sin `any`.
- Usar `ConfigService` para leer variables de entorno, nunca `process.env` directamente.
- Inyectar `PrismaService` como dependencia; nunca instanciar `PrismaClient` directamente.
- Enviar correos siempre a través de `MailService`.
- Añadir decoradores Swagger (`@ApiOperation`, `@ApiResponse`, `@ApiTags`) en
  todos los endpoints nuevos.
- Crear DTOs con `class-validator` para cada body de entrada.
- Crear la migración de Prisma cuando se modifique `schema.prisma`.
- Seguir la convención de carpetas: nuevos módulos de negocio en `src/modules/`,
  nuevos adaptadores técnicos en `src/infrastructure/`.

### ❌ Nunca hacer

- Escribir `process.env.VARIABLE` en servicios o módulos NestJS.
- Instanciar `new PrismaClient()` fuera de `PrismaService`.
- Poner lógica de negocio en controladores (solo llamar al servicio correspondiente).
- Usar `Math.random()` para generar nuevos tokens de seguridad
  (usar `crypto.randomBytes(32).toString('hex')`).
- Saltarse la validación con `@ts-ignore` o `as any`.
- Incluir secrets o datos reales en código fuente o ejemplos.

---

## Convenciones de nomenclatura

| Artefacto     | Convención                 | Ejemplo                      |
| ------------- | -------------------------- | ---------------------------- |
| Módulo NestJS | `kebab-case.module.ts`     | `user-profile.module.ts`     |
| Servicio      | `kebab-case.service.ts`    | `user-profile.service.ts`    |
| Controlador   | `kebab-case.controller.ts` | `user-profile.controller.ts` |
| DTO           | `kebab-case.dto.ts`        | `create-invoice.dto.ts`      |
| Guard         | `kebab-case.guard.ts`      | `roles.guard.ts`             |
| Strategy      | `kebab-case.strategy.ts`   | `google-oauth.strategy.ts`   |
| Tabla Prisma  | `snake_case` (`@@map`)     | `@@map("user_profiles")`     |
| Campo Prisma  | `camelCase` en schema      | `fullName`, `passwordHash`   |

---

## Añadir un nuevo módulo de negocio

Patrón estándar. Ejemplo: módulo `invoice`:

```
src/modules/invoice/
├── invoice.module.ts
├── invoice.controller.ts
├── invoice.service.ts
└── dto/
    ├── create-invoice.dto.ts
    └── update-invoice.dto.ts
```

1. Crear los archivos con las clases decoradas apropiadamente.
2. Registrar `InvoiceModule` en `src/app.module.ts` → array `imports`.
3. Si necesita acceso a la base de datos, `DatabaseModule` ya está global;
   inyectar `PrismaService` directamente.
4. Si necesita colas, importar `BullModule` y registrar la cola en el módulo.

---

## Trabajar con Prisma v7

```typescript
// ✅ Correcto: inyectar PrismaService
constructor(private readonly prisma: PrismaService) {}

// ✅ Crear migración tras modificar schema.prisma
// (comando — no ejecutar automáticamente sin confirmar con el usuario)
// npm run prisma:migrate -- --name add_invoice_table

// ❌ Incorrecto: instanciar directamente
const prisma = new PrismaClient(); // NUNCA
```

La URL de base de datos se configura en `prisma.config.ts`, **no** en
`schema.prisma`. El `datasource db` en el schema no lleva `url`.

---

## Autenticación y seguridad

- El guard de JWT se llama `JwtAuthGuard` → importar desde `./guards/jwt-auth.guard`.
- El payload del token tiene la forma `{ sub: string, email: string }`.
- Para acceder al usuario en un controlador protegido:
  ```typescript
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req: RequestWithUser) {
    return this.myService.doSomething(req.user.id);
  }
  ```
- Para tokens de seguridad (verificación, reset), usar `crypto`:
  ```typescript
  import { randomBytes } from 'crypto';
  const token = randomBytes(32).toString('hex');
  ```

---

## Correo electrónico

`MailService` ajusta el transporte automáticamente según `NODE_ENV`:

- **development** → Mailpit en `localhost:1025` (UI en `http://localhost:8025`)
- **production** → SMTP externo configurado vía variables de entorno

Para nuevos tipos de correo, añadir un método a `MailService`:

```typescript
async sendWelcomeEmail(to: string, name: string): Promise<void> { ... }
```

No crear instancias de `nodemailer` fuera de `MailService`.

---

## Colas con BullMQ

`BullModule` (infrastructure) ya está configurado globalmente. Para usar en un
módulo nuevo:

```typescript
// En el módulo de negocio:
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [BullModule.registerQueue({ name: 'render' })],
  // ...
})
export class RenderModule {}
```

---

## Formato de respuestas de error

NestJS ya convierte las excepciones estándar automáticamente. Usar las clases
del paquete `@nestjs/common`:

```typescript
throw new ConflictException('El correo ya está registrado');
throw new UnauthorizedException('Credenciales inválidas');
throw new BadRequestException('Token inválido o expirado');
throw new NotFoundException('Recurso no encontrado');
```

No crear objetos de error manuales con `{ statusCode, message }`.

---

## Tests

- Tests unitarios con Jest + `@nestjs/testing` → en `*.spec.ts` junto al archivo.
- Tests e2e en `test/` → `*.e2e-spec.ts`.
- Mockear `PrismaService` y demás dependencias externas en tests unitarios.
- No conectar a bases de datos reales en tests unitarios.

---

## Checklist rápido al generar código

```
□ ¿Tipos TypeScript explícitos, sin `any`?
□ ¿ConfigService para variables de entorno?
□ ¿PrismaService inyectado, no instanciado?
□ ¿DTO con class-validator para el body?
□ ¿Decoradores Swagger completos?
□ ¿Migración de Prisma si cambié el schema?
□ ¿Sin secrets en código?
□ ¿Lógica en el servicio, no en el controlador?
```
