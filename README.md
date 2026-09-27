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

## API documentation

Open Swagger UI at `http://localhost:3000/docs` (use your configured `PORT` if
different). The OpenAPI JSON is at `/docs-json`. Both are available in every
environment.

To try protected routes, register with `POST /accounts` if needed, then call
`POST /auth/login` with your email and password. Copy `accessToken` from the
response, click **Authorize** in Swagger, and enter the token. Swagger adds the
Bearer prefix to requests automatically.

| Route                                         | Description             | Bearer token |
| --------------------------------------------- | ----------------------- | ------------ |
| `GET /`                                       | Welcome message         | No           |
| `POST /accounts`                              | Register account        | No           |
| `POST /auth/login`                            | Get access token        | No           |
| `GET /pets`                                   | List accessible pets    | Yes          |
| `GET /pets/{petId}`                           | Get pet profile         | Yes          |
| `POST /pets`                                  | Register pet            | Yes          |
| `POST /pets/{petId}/invitations`              | Invite collaborator     | Yes          |
| `POST /pets/{petId}/leave`                    | Leave as collaborator   | Yes          |
| `POST /pets/{petId}/health/weight-records`    | Record pet weight (kg)  | Yes          |
| `GET /pets/{petId}/health/weight-records`     | List pet weight history | Yes          |
| `POST /pet-invitations/{invitationId}/accept` | Accept invitation       | Yes          |
| `POST /pet-invitations/{invitationId}/reject` | Reject invitation       | Yes          |
| `POST /pet-invitations/{invitationId}/cancel` | Cancel invitation       | Yes          |

To record a weight, send `POST /pets/{petId}/health/weight-records` with a Bearer token and JSON such as `{"weightKg":"12.3456","measuredDate":"2026-09-26"}`. Weight is a positive decimal string in kilograms with at most four decimal places. The measured date is a valid calendar date no later than today in UTC. An active owner or collaborator of an active pet receives `201` with the record ID, pet ID, canonical `weightKg`, `measuredDate`, and `recordedByAccountId`. An inaccessible or archived pet returns `404 PET_NOT_FOUND`.

To read weight history, send `GET /pets/{petId}/health/weight-records` with a Bearer token. Active owners and collaborators can read active or archived pets. Results are ordered by measured date, newest first. Optional `limit` defaults to 20 (maximum 100); pass the opaque `nextCursor` as `cursor` for the next page. The `200` response contains `items` and `nextCursor` (`null` on the last page). Each item contains `id`, decimal string `weightKg`, `measuredDate`, and `recordedByAccountId`. Missing or inaccessible pets return `404 PET_NOT_FOUND`.

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
