# Adogtame Care Backend

**English** | [Español](README.es.md)

Adogtame Care backend built with NestJS, TypeScript, PostgreSQL, and Drizzle
ORM.

## Requirements

- Node.js (v20 or later)
- pnpm
- Docker with Docker Compose

## Setup

Install the dependencies and create the local environment file:

```bash
pnpm install
cp .env.example .env
```

Configuration is validated when the application starts. `DATABASE_URL` must
use the `postgres://` or `postgresql://` protocol, and `JWT_ACCESS_TOKEN_SECRET`
must be set to a random string of at least 32 characters.

## Local PostgreSQL

Start PostgreSQL 18 and wait until the container is healthy:

```bash
pnpm db:up
pnpm db:migrate
```

Available database commands:

| Command                    | Description                                                          |
| -------------------------- | -------------------------------------------------------------------- |
| `pnpm db:up`               | Starts PostgreSQL and waits for its healthcheck.                     |
| `pnpm db:down`             | Stops the containers while preserving the volume.                    |
| `pnpm db:status`           | Shows the PostgreSQL service status.                                 |
| `pnpm db:logs`             | Follows the PostgreSQL logs.                                         |
| `pnpm db:check`            | Starts the NestJS context and checks the connection with `SELECT 1`. |
| `pnpm db:generate`         | Generates SQL migrations from Drizzle schemas.                       |
| `pnpm db:migrate`          | Applies pending migrations to PostgreSQL.                            |
| `pnpm db:migrations:check` | Verifies Drizzle migration metadata consistency.                     |

The credentials in `.env.example` and `compose.yaml` are intended exclusively
for local development.

## Development

```bash
pnpm start:dev
```

The API listens on the port defined by `PORT` (default `3000`).

## Environment variables

| Variable                       | Rule                                                         | Default       |
| ------------------------------ | ------------------------------------------------------------ | ------------- |
| `NODE_ENV`                     | `development`, `test` or `production`                        | `development` |
| `PORT`                         | Integer from 1 to 65535                                      | `3000`        |
| `DATABASE_URL`                 | `postgres://` or `postgresql://` URL                         | Required      |
| `JWT_ACCESS_TOKEN_SECRET`      | At least 32 characters; generate a random secret             | Required      |
| `JWT_ACCESS_TOKEN_TTL_SECONDS` | Positive integer                                             | `3600`        |
| `THROTTLE_LIMIT`               | Positive integer; requests/minute per IP across API routes   | `100`         |
| `AUTH_THROTTLE_LIMIT`          | Positive integer; requests/minute per IP per auth endpoint   | `10`          |
| `LOGIN_ACCOUNT_THROTTLE_LIMIT` | Positive integer; login requests/minute per normalized email | `10`          |
| `READINESS_THROTTLE_LIMIT`     | Positive integer; readiness requests/minute per IP           | `10`          |

Process variables override `.env`. Invalid configuration prevents startup and
reports only the invalid variable names.

## API documentation (Swagger / OpenAPI)

All endpoints, request/response schemas, validation rules, pagination parameters,
and error codes are documented in OpenAPI:

- **Swagger UI:** `http://localhost:3000/docs` (use your configured `PORT` if different)
- **OpenAPI JSON:** `http://localhost:3000/docs-json`

To test protected endpoints in Swagger:
1. Register an account with `POST /accounts` (if needed).
2. Authenticate with `POST /auth/login` using your email and password.
3. Copy `accessToken` from the response, click **Authorize** in Swagger UI, and paste the token.

## Architecture and detailed documentation

Detailed design decisions, concurrency protocols, and operational guides are located in `docs/`:

- [API security and hardening](docs/api-security.md)
- [Production readiness and deployment](docs/production-readiness.md)
- [Audit and history](docs/audit-and-history.md)
- [Pet archive](docs/pet-archive.md)
- [Pet leave](docs/pet-leave.md)
- [Pet member removal](docs/pet-member-removal.md)
- [Pet member reads](docs/pet-members-read.md)
- [Pet care routines and activities](docs/pet-care.md)
- [Pet medication lifecycle](docs/pet-medication-lifecycle.md)
- [Pet veterinary visits](docs/pet-veterinary-visits.md)

## Verification and formatting

```bash
pnpm format
pnpm lint
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```
