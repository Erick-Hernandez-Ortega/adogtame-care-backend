# Adogtame Care Backend

[English](README.md) | **Español**

Backend de Adogtame Care construido con NestJS, TypeScript, PostgreSQL y
Drizzle ORM.

## Requisitos

- Node.js
- pnpm
- Docker con Docker Compose

## Configuración

Instala las dependencias y crea el archivo de entorno local:

```bash
pnpm install
cp .env.example .env
```

La configuración se valida al iniciar la aplicación. `DATABASE_URL` debe usar
el protocolo `postgres://` o `postgresql://`.

## PostgreSQL local

Inicia PostgreSQL 18 y espera hasta que el contenedor esté saludable:

```bash
pnpm db:up
```

Comandos disponibles:

| Comando          | Descripción                                                       |
| ---------------- | ----------------------------------------------------------------- |
| `pnpm db:up`     | Inicia PostgreSQL y espera su healthcheck.                        |
| `pnpm db:down`   | Detiene los contenedores y conserva el volumen.                   |
| `pnpm db:status` | Muestra el estado del servicio PostgreSQL.                        |
| `pnpm db:logs`   | Sigue los logs de PostgreSQL.                                     |
| `pnpm db:check`  | Arranca el contexto NestJS y verifica la conexión con `SELECT 1`. |

Las credenciales incluidas en `.env.example` y `compose.yaml` son exclusivas
para desarrollo local.

## Desarrollo

```bash
pnpm start:dev
```

La API escucha en el puerto definido por `PORT`.

## Migraciones

Los esquemas Drizzle vivirán en:

```text
src/<bounded-context>/infrastructure/persistence/drizzle/*.schema.ts
```

Cuando exista el primer esquema de dominio, genera y revisa la migración antes
de aplicarla:

```bash
pnpm db:generate
pnpm db:migrations:check
pnpm db:migrate
```

Las migraciones SQL versionadas se guardarán en `drizzle/`. No se genera una
migración vacía mientras no exista un esquema de dominio.

## Verificación

```bash
pnpm lint
pnpm test
pnpm build
```
