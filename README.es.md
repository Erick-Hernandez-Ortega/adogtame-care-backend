# Adogtame Care Backend

[English](README.md) | **Español**

Backend de Adogtame Care construido con NestJS, TypeScript, PostgreSQL y
Drizzle ORM.

## Requisitos

- Node.js (v20 o posterior)
- pnpm
- Docker con Docker Compose

## Configuración

Instala las dependencias y crea el archivo de entorno local:

```bash
pnpm install
cp .env.example .env
```

La configuración se valida al iniciar la aplicación. `DATABASE_URL` debe usar
el protocolo `postgres://` o `postgresql://`, y `JWT_ACCESS_TOKEN_SECRET` debe
configurarse con una cadena aleatoria de al menos 32 caracteres.

## PostgreSQL local

Inicia PostgreSQL 18 y espera hasta que el contenedor esté saludable:

```bash
pnpm db:up
pnpm db:migrate
```

Comandos de base de datos disponibles:

| Comando                    | Descripción                                                       |
| -------------------------- | ----------------------------------------------------------------- |
| `pnpm db:up`               | Inicia PostgreSQL y espera su healthcheck.                        |
| `pnpm db:down`             | Detiene los contenedores y conserva el volumen.                   |
| `pnpm db:status`           | Muestra el estado del servicio PostgreSQL.                        |
| `pnpm db:logs`             | Sigue los logs de PostgreSQL.                                     |
| `pnpm db:check`            | Arranca el contexto NestJS y verifica la conexión con `SELECT 1`. |
| `pnpm db:generate`         | Genera migraciones SQL a partir de los esquemas de Drizzle.       |
| `pnpm db:migrate`          | Aplica las migraciones pendientes en PostgreSQL.                  |
| `pnpm db:migrations:check` | Verifica la consistencia de los metadatos de migración.           |

Las credenciales incluidas en `.env.example` y `compose.yaml` son exclusivas
para desarrollo local.

## Desarrollo

```bash
pnpm start:dev
```

La API escucha en el puerto definido por `PORT` (`3000` por defecto).

## Variables de entorno

| Variable                       | Regla                                                                  | Valor predeterminado |
| ------------------------------ | ---------------------------------------------------------------------- | -------------------- |
| `NODE_ENV`                     | `development`, `test` o `production`                                   | `development`        |
| `PORT`                         | Entero entre 1 y 65535                                                 | `3000`               |
| `DATABASE_URL`                 | URL `postgres://` o `postgresql://`                                    | Obligatoria          |
| `JWT_ACCESS_TOKEN_SECRET`      | Al menos 32 caracteres; genera un secreto aleatorio                    | Obligatoria          |
| `JWT_ACCESS_TOKEN_TTL_SECONDS` | Entero positivo                                                        | `3600`               |
| `THROTTLE_LIMIT`               | Entero positivo; solicitudes/minuto por IP entre rutas de la API       | `100`                |
| `AUTH_THROTTLE_LIMIT`          | Entero positivo; solicitudes/minuto por IP por endpoint de auth        | `10`                 |
| `LOGIN_ACCOUNT_THROTTLE_LIMIT` | Entero positivo; intentos de acceso/minuto por correo normalizado      | `10`                 |
| `READINESS_THROTTLE_LIMIT`     | Entero positivo; consultas de disponibilidad/minuto por IP             | `10`                 |

Las variables del proceso tienen prioridad sobre `.env`. Una configuración inválida
impide iniciar y reporta únicamente los nombres de las variables inválidas.

## Documentación de la API (Swagger / OpenAPI)

Todos los endpoints, esquemas de entrada/salida, reglas de validación, paginación y
códigos de error se encuentran documentados en OpenAPI:

- **Swagger UI:** `http://localhost:3000/docs` (usa el `PORT` configurado si es diferente)
- **OpenAPI JSON:** `http://localhost:3000/docs-json`

Para probar rutas protegidas en Swagger:
1. Registra una cuenta con `POST /accounts` (si hace falta).
2. Inicia sesión con `POST /auth/login` usando tu correo y contraseña.
3. Copia `accessToken` de la respuesta, pulsa **Authorize** en Swagger UI y pega el token.

## Arquitectura y documentación detallada

Las decisiones de diseño, protocolos de concurrencia y guías operativas están en `docs/`:

- [Seguridad y hardening de la API](docs/api-security.md)
- [Preparación para producción y despliegue](docs/production-readiness.md)
- [Auditoría e historial](docs/audit-and-history.md)
- [Archivado de mascotas](docs/pet-archive.md)
- [Abandonar una mascota](docs/pet-leave.md)
- [Remoción de miembros](docs/pet-member-removal.md)
- [Lectura de miembros](docs/pet-members-read.md)
- [Rutinas y actividades de cuidado](docs/pet-care.md)
- [Ciclo de vida de medicamentos](docs/pet-medication-lifecycle.md)
- [Visitas veterinarias](docs/pet-veterinary-visits.md)

## Verificación y formato

```bash
pnpm format
pnpm lint
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```
