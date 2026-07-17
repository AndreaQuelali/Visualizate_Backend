# Guía de Configuración y Arranque — VisualiZate Backend

Esta guía detalla los pasos que un nuevo desarrollador de backend debe seguir para levantar localmente el entorno de desarrollo del backend del proyecto **VisualiZate**.

---

## 🛠️ Requisitos Previos

Asegúrate de tener instalados los siguientes componentes en tu sistema local:

1. **Node.js**: Versión `>= 20.0.0` (Recomendado: `>= 22.0.0` / LTS).
2. **PostgreSQL**: Instancia activa local o remota (Puerto: `5432`).
3. **Redis**: Requerido por BullMQ para manejar colas de trabajos en segundo plano (Puerto: `6379`).
4. **MinIO** (o AWS S3 local): Requerido por el módulo Storage para almacenar contenido multimedia (Puerto API: `9000`).

---

## 🚀 Pasos para Iniciar el Proyecto

### 1. Clonar el repositorio y navegar
Si es la primera vez, navega a la carpeta correspondiente tras clonar el repositorio:
```bash
cd Visualizate_Backend
```

### 2. Instalar dependencias
Instala los paquetes de Node utilizando `npm`:
```bash
npm install
```
> [!NOTE]
> Al finalizar la instalación, se ejecutará el script `postinstall` que regenerará automáticamente los tipos del cliente Prisma en tu máquina local.

---

### 3. Configurar variables de entorno

1. Duplica el archivo de ejemplo para crear tu entorno local:
   ```bash
   cp .env.example .env
   ```
2. Abre el archivo `.env` recién creado y ajusta los valores correspondientes a tus credenciales locales de **PostgreSQL**, **Redis** y **MinIO**, por ejemplo:
   ```env
   DATABASE_URL="postgresql://postgres:tu_password@localhost:5432/visualizate?schema=public"
   JWT_SECRET="un_secreto_muy_seguro_generado_aqui"
   REDIS_HOST="localhost"
   REDIS_PORT=6379
   ```

---

### 4. Configurar la base de datos (Prisma ORM V7)

El proyecto utiliza **Prisma V7**, el cual incluye cambios importantes respecto a versiones previas. La configuración se separa de la siguiente forma:
* **CLI (Migraciones)**: Las tareas de línea de comandos leen la URL de base de datos directamente de `prisma.config.ts`.
* **Runtime**: La aplicación se conecta usando el driver nacional pool y un adaptador (`@prisma/adapter-pg`) inyectado en `PrismaService` mediante variables ambientales de NestJS.

Para crear la estructura inicial en tu base de datos local y sincronizar el cliente:

1. **Validar y Sincronizar el Schema**:
   ```bash
   npx prisma validate
   ```
2. **Generar Cliente Local**:
   ```bash
   npm run prisma:generate
   ```
3. **Aplicar Migraciones Iniciales** *(cuando existan primeros modelos de datos)*:
   ```bash
   npm run prisma:migrate -- --name nombre_de_la_migracion
   ```

---

### 5. Levantar el Backend en desarrollo

Arranca el servidor NestJS en modo "Watch/Desarrollo" (recarga automática al cambiar archivos):

```bash
npm run start:dev
```

El servidor levantará por defecto en `http://localhost:3000`.

---

## 📄 Documentación API (Swagger)

Una vez que la aplicación esté corriendo, puedes acceder a la interfaz de desarrollo interactiva y probar los endpoints disponibles en:

👉 **[http://localhost:3000/api](http://localhost:3000/api)**

---

## 🧹 Calidad de Código y Estructura

El repositorio cuenta con estrictos lineamientos automáticos. Antes de hacer commits, el código pasa por Husky y lint-staged para asegurar consistencia:

- **Escanear y auto-corregir errores sintácticos (Linter)**:
  ```bash
  npm run lint
  ```
- **Formatear el código**:
  ```bash
  npm run format
  ```
- **Comprobar sintaxis y compilar servidor para producción**:
  ```bash
  npm run build
  ```

### 🤝 Estructura de Mensajes Commit (Conventional Commits)
Este proyecto valida el formato de tus mensajes de commit usando Commitlint. Tus mensajes deben seguir el siguiente estándar:
* `feat: ...` para nuevas funcionalidades.
* `fix: ...` para resolución de bugs.
* `chore: ...` para mantenimiento o cambios no-operacionales.
