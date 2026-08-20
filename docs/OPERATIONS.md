# Operación — Visualizate API

Guía mínima para desplegar y operar la API y el worker de render.

## Procesos

| Proceso | Comando | Notas |
|---------|---------|-------|
| API | `RUN_WORKERS=false node dist/src/main` | Sin Chromium en memoria; escala horizontalmente. |
| Worker | `node dist/src/worker` | Consume las colas `render` y `review`. Necesita Chromium (la imagen Docker lo incluye). |
| Todo en uno (desarrollo) | `npm run start:dev` | `RUN_WORKERS=true` por defecto. |
| Migraciones | `npx prisma migrate deploy` | Ejecutar antes de arrancar una versión nueva. |

La imagen se construye con el `Dockerfile` de la raíz (base `mcr.microsoft.com/playwright`, que trae Chromium y sus librerías, más fuentes Noto/Liberation). La versión de la imagen debe coincidir con la de `playwright` en `package.json`.

### Límites de memoria recomendados

| Proceso | Mínimo | Recomendado | Por qué |
|---------|--------|-------------|---------|
| API | 256 MB | 512 MB | Node + Prisma; las subidas se leen en memoria (máx. 10 MB). |
| Worker | 1 GB | 2 GB con `RENDER_CONCURRENCY=2` | Un Chromium compartido; cada render abre un contexto aislado y `sharp` procesa salidas de hasta 64 millones de píxeles. Sube la memoria antes de subir la concurrencia. |

## Variables de entorno

Todas se validan al arrancar en `src/config/env.validation.ts`; una variable inválida impide el arranque.

| Variable | Defecto | Descripción |
|----------|---------|-------------|
| `DATABASE_URL`, `JWT_SECRET` | — (requeridas) | Conexión a PostgreSQL y secreto de los tokens. |
| `PORT` | 3000 | Puerto HTTP. |
| `RUN_WORKERS` | `true` | `false` en el contenedor de la API. |
| `LOG_LEVEL` | `info` | `fatal`…`trace`, `silent`. |
| `CORS_ORIGINS` | `http://localhost:5173` | Orígenes permitidos, separados por comas. |
| `BODY_LIMIT_MB` | 2 | Tamaño máximo de cuerpos JSON/formulario. |
| `METRICS_TOKEN` | vacío | Si se define, `GET /metrics` exige `Authorization: Bearer <token>`. |
| `THROTTLE_IP_LIMIT` | 300 | Peticiones por minuto y por IP (global). |
| `THROTTLE_USER_LIMIT` | 120 | Peticiones por minuto y por usuario autenticado. |
| `REDIS_*`, `MINIO_*` | ver `env.validation.ts` | Conexiones a Redis y MinIO. |
| `RENDER_CONCURRENCY` | 2 | Renders simultáneos por worker (1–8). |
| `RENDER_RETENTION_DAYS` | 30 | Días que se conservan los renders terminados. |
| `RENDER_MAX_ACTIVE`, `RENDER_MAX_PER_HOUR` | 3, 20 | Límites de tasa de exportación por espacio (429). |
| `OPENAI_API_KEY`, `AI_MODEL`, `AI_TIMEOUT_MS` | vacío, `gpt-4o`, 60000 | Revisión con IA; sin clave solo se aplican las reglas automáticas. |
| `REVIEW_CONCURRENCY`, `REVIEW_MAX_PER_PIECE_HOUR` | 2, 10 | Concurrencia y límite por pieza y hora. |
| `QUOTA_STORAGE_MB` | 200 | Almacenamiento de assets por espacio (402). |
| `QUOTA_ACTIVE_PIECES` | 500 | Piezas no archivadas por espacio (402). |
| `QUOTA_RENDERS_PER_MONTH` | 500 | Exportaciones por espacio y mes (402). |
| `REVIEW_MONTHLY_QUOTA` | 100 | Revisiones con IA por espacio y mes (429). |
| `SMTP_*` | ver `env.validation.ts` | Correo de invitaciones y verificación. |

> La spec nombra la clave de IA como `AI_API_KEY`; el proveedor implementado es OpenAI y la variable es `OPENAI_API_KEY`.

## Cuotas

Son **técnicas** (protección frente a abuso), iguales para todos los espacios y configurables por entorno. Superarlas devuelve:

- `402` con `{ code: "QUOTA_EXCEEDED", resource, limit, used, message }` para almacenamiento, piezas activas y exportaciones mensuales.
- `429` con `Retry-After` para los límites de tasa (exportaciones por hora, revisiones por pieza/hora y cuota mensual de IA).

`GET /workspaces/:id/dashboard` incluye el consumo del periodo.

## Observabilidad

- **Logs**: JSON por línea (pino). Cada petición lleva `req.id` (cabecera `x-request-id`, se respeta la entrante) y `workspaceId`; los trabajos de render y revisión registran `jobId`/`reviewId` y `workspaceId`. Se redactan `authorization` y `cookie`.
- **`GET /health`**: comprueba PostgreSQL, Redis y MinIO; responde `503` si alguno cae. No requiere autenticación ni cuenta para el límite de tasa.
- **`GET /metrics`** (Prometheus): `visualizate_render_jobs_total{format,status}`, `visualizate_render_duration_seconds`, `visualizate_ai_reviews_total{status}`, `visualizate_ai_review_duration_seconds`, `visualizate_queue_waiting_jobs{queue}` y las métricas por defecto de Node.

## Datos

- **Retención**: los renders terminados se borran (base de datos y MinIO) pasados `RENDER_RETENTION_DAYS` días. La limpieza corre al arrancar y cada 6 horas.
- **Borrado de un espacio**: eliminar un espacio borra en cascada sus filas y, después, todos los objetos bajo `workspaces/<id>/` (assets y renders) y su logo en MinIO. Si MinIO falla en ese momento, el error se registra y los objetos quedan huérfanos hasta una limpieza manual por prefijo.
- **Copias de seguridad de PostgreSQL**: diaria, con retención de al menos 7 días:

  ```bash
  pg_dump --format=custom --file=visualizate-$(date +%F).dump "$DATABASE_URL"
  # restaurar
  pg_restore --clean --if-exists --dbname="$DATABASE_URL" visualizate-YYYY-MM-DD.dump
  ```

  MinIO se respalda con `mc mirror` o versionado del bucket.
- **Privacidad de la IA**: cuando la IA está activa y configurada, cada revisión envía al proveedor una imagen reducida de la pieza (máx. 1568 px), la estructura del documento de la plantilla, los valores de los campos y los colores/fuentes de la marca. En la base de datos solo se conservan el resumen, el modelo, los tokens y las recomendaciones. Consulta la política de retención del proveedor para el tiempo que conserva las solicitudes. Un ADMIN puede desactivar la IA por espacio (`PUT /workspaces/:id/review-settings`).

## Seguridad

- `helmet` en todas las respuestas (CSP estricta solo en producción para no romper Swagger).
- CORS restringido a `CORS_ORIGINS`.
- Límite global por IP y por usuario; los endpoints públicos de autenticación permiten 10 peticiones por minuto y por IP.
- Las URLs firmadas de descarga duran 5 minutos y las miniaturas del dashboard 5 minutos.
- Las subidas se validan por contenido (no por extensión) y los SVG con scripts o eventos se rechazan.
- El almacén de contadores del límite de tasa es en memoria: con varias réplicas de la API el límite es por réplica.
