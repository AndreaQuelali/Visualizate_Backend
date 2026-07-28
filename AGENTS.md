# AGENTS.md — Visualizate Backend

> Guía de orientación para agentes de IA (Copilot, Antigravity, Claude, Codex, etc.)
> que trabajen en este repositorio. Léela **antes** de modificar o generar código.

---

## 1. Visión general del proyecto

**Visualizate** es una plataforma de creación de contenido visual. Este repositorio
contiene el **API backend** construido con:

| Capa             | Tecnología                                        |
| ---------------- | ------------------------------------------------- |
| Framework        | NestJS v11 (TypeScript)                           |
| ORM              | Prisma v7 + `@prisma/adapter-pg`                  |
| Base de datos    | PostgreSQL 15                                     |
| Colas asíncronas | BullMQ sobre Redis 7                              |
| Object storage   | MinIO (compatible S3)                             |
| Motor de render  | Playwright + Sharp _(skeleton — sin implementar)_ |
| Correo           | Nodemailer → Mailpit (dev) / SMTP (prod)          |
| Auth             | JWT (Passport) + bcryptjs                         |
| Docs API         | Swagger (`/api`)                                  |

---

## 2. Estructura de directorios

```
src/
├── config/
│   └── env.validation.ts       # Esquema Joi de validación de variables de entorno
├── infrastructure/             # Módulos de infraestructura reutilizables
│   ├── bull/                   # BullModule: configuración de Redis/BullMQ
│   ├── database/               # DatabaseModule + PrismaService
│   ├── mail/                   # MailModule + MailService (Nodemailer)
│   └── storage/                # StorageModule + StorageService (MinIO)
└── modules/                    # Módulos de negocio (dominio)
    ├── auth/                   # Autenticación completa (JWT, BCrypt, verificación e-mail)
    │   ├── dto/                # DTOs de validación (class-validator)
    │   ├── guards/             # JwtAuthGuard
    │   └── strategies/         # JwtStrategy (Passport)
    └── render/                 # Skeleton del motor de renderizado (Playwright + Sharp)
```

**Regla de capas:**

- `infrastructure/` ← adaptadores técnicos; sin lógica de negocio.
- `modules/` ← lógica de dominio; puede importar `infrastructure/`.
- Nunca importar módulos de `modules/` desde `infrastructure/`.

---

## 3. Variables de entorno

Siempre validadas al arrancar mediante `src/config/env.validation.ts` (Joi).
Copia `.env.example` → `.env` y ajusta los valores. **Nunca commits del `.env` real.**

| Variable                  | Default                      | Descripción                                  |
| ------------------------- | ---------------------------- | -------------------------------------------- |
| `NODE_ENV`                | `development`                | Entorno: `development`, `production`, `test` |
| `PORT`                    | `3000`                       | Puerto HTTP del servidor                     |
| `DATABASE_URL`            | —                            | URL de conexión de Prisma/PostgreSQL         |
| `JWT_SECRET`              | —                            | Secreto para firmar tokens JWT               |
| `JWT_EXPIRES_IN_SECONDS`  | `86400`                      | Vigencia del token (segundos)                |
| `REDIS_HOST`              | `localhost`                  | Host de Redis                                |
| `REDIS_PORT`              | `6379`                       | Puerto de Redis                              |
| `REDIS_PASSWORD`          | ``                           | Contraseña de Redis (opcional)               |
| `MINIO_ENDPOINT`          | `localhost`                  | Host de MinIO                                |
| `MINIO_PORT`              | `9000`                       | Puerto API de MinIO                          |
| `MINIO_USE_SSL`           | `false`                      | TLS en MinIO                                 |
| `MINIO_ACCESS_KEY`        | `minioadmin`                 | Access key MinIO                             |
| `MINIO_SECRET_KEY`        | `minioadmin`                 | Secret key MinIO                             |
| `MINIO_BUCKET`            | `visualizate`                | Bucket por defecto                           |
| `SMTP_HOST`               | `localhost`                  | Host SMTP                                    |
| `SMTP_PORT`               | `1025`                       | Puerto SMTP (Mailpit dev)                    |
| `SMTP_SECURE`             | `false`                      | TLS SMTP (true en prod)                      |
| `SMTP_USER` / `SMTP_PASS` | ``                           | Credenciales SMTP (prod)                     |
| `SMTP_FROM`               | `Visualizate <no-reply@...>` | Dirección remitente                          |
| `FRONTEND_URL`            | `http://localhost:5173`      | URL del frontend (links en correos)          |

**Puertos del docker-compose local (evitar conflictos):**

| Servicio       | Puerto host |
| -------------- | ----------- |
| PostgreSQL     | `5434`      |
| Redis          | `6380`      |
| MinIO API      | `9002`      |
| MinIO Console  | `9003`      |
| Mailpit SMTP   | `1025`      |
| Mailpit Web UI | `8025`      |

---

## 4. Comandos esenciales

```bash
# Instalar dependencias (también regenera el cliente Prisma via postinstall)
npm install

# Desarrollo con hot-reload
npm run start:dev

# Build de producción
npm run build

# Levantar infraestructura (Postgres, Redis, MinIO, Mailpit)
docker compose up -d

# Gestión de base de datos (Prisma v7)
npm run prisma:generate           # Regenerar cliente Prisma
npm run prisma:migrate            # Crear/aplicar migración en dev
npm run prisma:migrate:prod       # Aplicar migraciones en prod (deploy)
npm run prisma:studio             # GUI de base de datos
npm run prisma:reset              # Reset completo (⚠️ destruye datos)

# Calidad de código
npm run lint                      # ESLint con auto-fix
npm run format                    # Prettier
npm run test                      # Jest (unit)
npm run test:e2e                  # Jest (e2e)
npm run test:cov                  # Cobertura
```

---

## 5. Convenciones de código

### 5.1 TypeScript / NestJS

- Sigue **strictamente** el `tsconfig.json` del proyecto (strict mode activado).
- No usar `any` explícito (`@typescript-eslint/no-explicit-any: error`).
- Manejar todas las promesas (`no-floating-promises: warn`).
- Los módulos deben seguir la arquitectura en capas descrita en §2.

### 5.2 Validación

- Todos los endpoints que reciban un body deben tener su **DTO** en `dto/` usando
  `class-validator` + `class-transformer`.
- El `ValidationPipe` global está habilitado con `whitelist: true` y `transform: true`.

### 5.3 Prisma v7

- La URL de base de datos **no** se configura en `schema.prisma` sino en `prisma.config.ts`.
- El `PrismaService` usa `@prisma/adapter-pg` para conexión nativa. No usar
  `PrismaClient` directamente fuera de `PrismaService`.
- Toda nueva entidad requiere: modelo en `schema.prisma` + migración nombrada
  (`npm run prisma:migrate -- --name <nombre_descriptivo>`).

### 5.4 Correo electrónico

- Toda lógica de envío pasa por `MailService` (`infrastructure/mail/`).
- Los templates HTML de correo están embebidos en `MailService`. Si crecen,
  extraerlos a un directorio `src/infrastructure/mail/templates/`.

### 5.5 Autenticación

- El token de verificación actual usa `Math.random()`. Cuando se implemente
  seguridad de producción, **migrar** a `crypto.randomBytes()`.
- Los tokens de reset/verificación expiran en **24 horas**.
- Al cambiar el e-mail del usuario, `isVerified` se reinicia a `false`.

### 5.6 Módulo Render

- `RenderModule` es un **skeleton**. Playwright y Sharp están instalados.
- Implementar servicios dentro de `src/modules/render/` sin tocar `AppModule`.

---

## 6. Commits y Pull Requests

Este repo usa **Conventional Commits** validados por Commitlint + Husky:

```
feat: descripción corta de la nueva funcionalidad
fix: descripción del bug corregido
chore: tarea de mantenimiento o configuración
refactor: refactor sin cambio de comportamiento
test: añadir o corregir tests
docs: cambios solo en documentación
```

El hook `pre-commit` ejecuta lint-staged (ESLint + Prettier) sobre los archivos
en staging. No omitir los hooks con `--no-verify` salvo emergencia documentada.

---

## 7. Swagger / Documentación de API

Disponible en **`http://localhost:3000/api`** con el servidor corriendo.

- Todos los endpoints nuevos deben tener decoradores `@ApiOperation`,
  `@ApiResponse` y `@ApiTags`.
- Los endpoints protegidos deben incluir `@ApiBearerAuth()` + `@UseGuards(JwtAuthGuard)`.

---

## 8. Patrones prohibidos

| ❌ Prohibido                               | ✅ Alternativa             |
| ------------------------------------------ | -------------------------- |
| `process.env.VAR` directamente             | `ConfigService.get('VAR')` |
| `new PrismaClient()` en servicios          | Inyectar `PrismaService`   |
| Enviar correos directamente con Nodemailer | Usar `MailService`         |
| Lógica de negocio en controladores         | Mover a servicio           |
| Secrets en código fuente                   | Variables de entorno       |
| `any` explícito                            | Tipos concretos o generics |

---

## 9. Endpoints actuales

| Método  | Ruta                        | Auth | Descripción                      |
| ------- | --------------------------- | ---- | -------------------------------- |
| `POST`  | `/auth/register`            | —    | Registrar nuevo usuario          |
| `POST`  | `/auth/login`               | —    | Iniciar sesión → JWT             |
| `GET`   | `/auth/verify-email?token=` | —    | Verificar correo                 |
| `POST`  | `/auth/forgot-password`     | —    | Solicitar reset de contraseña    |
| `POST`  | `/auth/reset-password`      | —    | Restablecer contraseña con token |
| `GET`   | `/auth/profile`             | JWT  | Obtener perfil del usuario       |
| `PATCH` | `/auth/profile`             | JWT  | Actualizar perfil del usuario    |

---

## 10. Checklist antes de hacer PR

- [ ] El código compila sin errores (`npm run build`)
- [ ] Los linters pasan (`npm run lint`)
- [ ] Se añadieron/actualizaron tests si aplica
- [ ] Los nuevos endpoints tienen decoradores Swagger completos
- [ ] Las nuevas entidades tienen su migración de Prisma
- [ ] No se incluyen secrets ni `.env` reales
- [ ] El mensaje de commit sigue Conventional Commits
