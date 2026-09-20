# Adogtame Care Backend

**English** | [Español](README.es.md)

Adogtame Care backend built with NestJS, TypeScript, PostgreSQL, and Drizzle
ORM.

## Requirements

- Node.js
- pnpm
- Docker with Docker Compose

## Setup

Install the dependencies and create the local environment file:

```bash
pnpm install
cp .env.example .env
```

Configuration is validated when the application starts. `DATABASE_URL` must
use the `postgres://` or `postgresql://` protocol.

## Local PostgreSQL

Start PostgreSQL 18 and wait until the container is healthy:

```bash
pnpm db:up
```

Available commands:

| Command          | Description                                                          |
| ---------------- | -------------------------------------------------------------------- |
| `pnpm db:up`     | Starts PostgreSQL and waits for its healthcheck.                     |
| `pnpm db:down`   | Stops the containers while preserving the volume.                    |
| `pnpm db:status` | Shows the PostgreSQL service status.                                 |
| `pnpm db:logs`   | Follows the PostgreSQL logs.                                         |
| `pnpm db:check`  | Starts the NestJS context and checks the connection with `SELECT 1`. |

The credentials in `.env.example` and `compose.yaml` are intended exclusively
for local development.

## Development

```bash
pnpm start:dev
```

The API listens on the port defined by `PORT`.

## Migrations

Drizzle schemas will live in:

```text
src/<bounded-context>/infrastructure/persistence/drizzle/*.schema.ts
```

Once the first domain schema exists, generate and review the migration before
applying it:

```bash
pnpm db:generate
pnpm db:migrations:check
pnpm db:migrate
```

Versioned SQL migrations will be stored in `drizzle/`. No empty migration is
generated before a domain schema exists.

## Verification

```bash
pnpm lint
pnpm test
pnpm build
```
