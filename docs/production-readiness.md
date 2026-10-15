# Production readiness (#54)

## Review and scope

Startup already used global ConfigModule validation with Zod. The HTTP entry point
already enabled Nest shutdown hooks, and DatabaseService already implemented
OnApplicationShutdown to await postgres.js pool closure. This slice preserves
those mechanisms, adds safe configuration diagnostics, a database health endpoint,
structured operational logs, and lifecycle verification. No business behavior,
aggregate boundary, repository outcome, authorization rule, locking order or
technical timestamp changes. Operational health belongs to `src/infrastructure`,
separate from the pet medical Health bounded context in `src/health`.

No dependencies, compose services, external systems, schema changes or migrations
are introduced. The approved #53 pagination, routine limits and authentication-first
parser contracts remain intact. The API now exposes 52 operations: four public
operations and the existing 48 protected operations. The new public health route
requires no extension to the protected-route exception filter.

## Startup configuration

ConfigModule loads `.env`, with process variables taking precedence, and validates
before constructing dependent services or listening. Unknown process variables
are permitted. Existing rules and defaults remain:

| Variable                     | Validation                                  | Default     |
| ---------------------------- | ------------------------------------------- | ----------- |
| NODE_ENV                     | development, test or production             | development |
| PORT                         | Integer 1–65535, numeric strings converted  | 3000        |
| DATABASE_URL                 | postgres:// or postgresql:// URL            | Required    |
| JWT_ACCESS_TOKEN_SECRET      | String of at least 32 characters            | Required    |
| JWT_ACCESS_TOKEN_TTL_SECONDS | Positive integer, numeric strings converted | 3600        |
| THROTTLE_LIMIT | Positive integer, requests/minute per IP across API routes | 100 |
| AUTH_THROTTLE_LIMIT | Positive integer, requests/minute per IP per auth endpoint | 10 |

Defaults apply to omitted optional variables, not empty strings. Set a randomly
generated JWT secret before running; `.env.example` intentionally leaves it empty.
Invalid configuration fails startup with a nonzero exit and lists affected variable
names without embedding supplied values or Zod issue payloads. No new secret
rotation policy or environment-specific restrictions are imposed.

Database connections remain lazy. Configuration validation checks shape, not
credentials, connectivity or migration state. A listening process can therefore
have an unavailable database. Use the readiness endpoint and `pnpm db:check` for
connectivity; apply migrations separately before routing application traffic.

## Database health endpoint

Public `GET /health` executes `SELECT 1` through the existing DatabaseService and
Drizzle/postgres.js pool on every request. It creates no separate pool, transaction,
row locks, domain records or writes. There are no query options or input fields;
like the welcome endpoint, it does not introduce strict request validation.

- Connected: `200 { "status": "ok" }`.
- Database check rejected: `503 { "code": "DATABASE_UNAVAILABLE", "message": "Database is unavailable" }`.

Failures log a fixed event and return no exception text, connection URL, credentials,
SQL details or stack. Successful probes do not emit application log events. Responses
contain no host, version, account or pet data. This is database readiness, not a
migration verifier, schema check or separate process-only liveness endpoint. It uses
the existing driver's connection/query behavior; this slice adds no custom probe
deadline or global database timeout. A stalled query can delay the response. Configure
probe timing in the eventual deployment environment rather than assuming an immediate
503 for every network failure. Swagger documents both responses under Application;
`GET /`, `/docs` and `/docs-json` keep their existing behavior.

## Logging and shutdown

The HTTP bootstrap and `pnpm db:check` configure Nest's built-in ConsoleLogger with
JSON enabled. Existing Nest Logger calls, including Nest framework/error logs, use
that output. Entries include level, timestamp, pid, context and message. Application
messages use stable event fields:

- `application_started`, with the configured port, after successful listen.
- `application_start_failed`, if bootstrap rejects.
- `database_connection_succeeded` or `database_connection_failed` for db:check.
- `database_health_check_failed` for a rejected readiness check.
- `database_pool_closed`, after pool shutdown completes.

New operational messages deliberately omit raw errors and configuration values.
This is not request/access logging, a redaction system for arbitrary exceptions,
log storage or a retention policy. Existing unexpected exceptions still follow
Nest's exception handling and server-side diagnostics. No request bodies, tokens,
passwords or medical data are added to operational events.

`enableShutdownHooks()` handles operating-system termination signals, including
SIGINT/SIGTERM. Nest closes the HTTP server before OnApplicationShutdown awaits
`client.end()`. The existing pool closure drains pending work without a new forced
shutdown deadline. A rejected listen closes the created application context. Tests
and scripts must call `application.close()`; db:check closes its context in finally.
The process manager must forward signals to Node and allow time to drain; a stuck
request/query may delay shutdown. SIGKILL and abrupt machine termination cannot
run hooks. No application-level retry, supervisor or process manager is added.

## Run and deploy

Local development uses Node.js 20+ (NestJS 11's minimum), pnpm and Docker PostgreSQL:

```bash
cp .env.example .env
# Set JWT_ACCESS_TOKEN_SECRET in .env before starting.
pnpm db:up
pnpm db:migrate
pnpm db:check
pnpm start:dev
```

For a generic remote release, provision the existing Neon PostgreSQL environment
and supply its connection string with Neon's TLS parameters, a fresh environment
secret, `NODE_ENV=production`, and the desired PORT/TTL. Do not reuse local Docker
credentials. Process variables may supply all configuration; no .env file is required.

In a preparation stage with development dependencies available:

```bash
pnpm install --frozen-lockfile --prod=false
pnpm lint
pnpm test
pnpm build
pnpm db:migrations:check
pnpm db:migrate
pnpm db:check
pnpm start:prod
```

Run reviewed migrations once per release through a controlled step before starting
the compatible version, not independently from every API replica. Start production
with the compiled `dist/` and production dependencies; Drizzle Kit and build tools
are needed in the preparation/migration stage. Verify GET /health before sending
traffic. Apply any feature-specific compatibility instructions, such as the write
pause described in [medication lifecycle](pet-medication-lifecycle.md). Review SQL
for locking and compatibility before deployment. Roll back application code only
when compatible with the applied schema; do not erase historical facts by dropping
columns or rewriting applied migration history.

No deployment provider, CORS origins, trusted-proxy configuration, log retention or
secret rotation schedule is chosen. The subsequent security slice applies Helmet
defaults and in-memory throttling: 100 requests/minute per IP across API routes,
plus 10/minute per IP on each auth endpoint. GET /health is exempt. The validated
THROTTLE_LIMIT and AUTH_THROTTLE_LIMIT settings override these defaults. Counters
are process-local and reset on restart. Behind a proxy, review IP identification
and trusted-proxy configuration before deployment; see [API security](api-security.md)
for that note, 429 contracts and isolated test limits. Swagger remains available
with the default Helmet CSP in every environment.

## Migration workflow

1. Edit the owning context's `infrastructure/persistence/drizzle/*.schema.ts`.
2. Run `pnpm db:generate`; inspect generated SQL and metadata in `drizzle/`.
3. Append only established extra statements where required, such as the existing
   `set_updated_at()` row trigger in `0017_mean_bishop.sql`. Do not hand-author
   schema changes instead of generation, or edit already applied migrations.
4. Run `pnpm db:migrations:check`. This checks migration metadata consistency;
   review SQL separately for data preservation, constraints and release compatibility.
5. Apply with `pnpm db:migrate` against the intended DATABASE_URL. Run relevant
   PostgreSQL integration tests and API tests against a migrated test database.

Keep SQL and Drizzle metadata together in version control. Do not create empty
migrations when the schema has not changed, generate migrations during API startup,
or apply local exploratory schema changes directly to remote environments.

## Verification

Configuration unit tests cover defaults, required values, invalid URLs, environments,
ports and TTLs, and safe field-only errors. Production readiness integration tests
close unused pools and open a real PostgreSQL connection, close the Nest context and verify that subsequent
queries fail with CONNECTION_ENDED. HTTP tests exercise public connected readiness,
a real closed-pool 503 and the preserved welcome route. Entrypoint process tests
exercise invalid configuration without exposing supplied values, JSON startup logs,
and SIGINT/SIGTERM pool closure using the actual HTTP bootstrap. They run source
entrypoints with the existing ts-node tooling and require child-process execution
and local socket binding. OpenAPI tests assert the
52-operation contract and exact health schemas. Existing security HTTP tests still
exercise all 48 protected routes.

```bash
pnpm format
pnpm lint
pnpm build
pnpm exec tsc --noEmit -p tsconfig.json
pnpm test --runInBand
pnpm test:integration --runInBand production-readiness
pnpm test:e2e --runInBand production-readiness openapi api-security
```

PostgreSQL checks need reachable PostgreSQL. HTTP tests need local socket binding;
those capabilities may be unavailable in a restricted sandbox. No test provisions
new infrastructure or changes production records for readiness.

During this slice's sandbox verification, all 99 unit suites (1,341 tests), both
database lifecycle integration tests and the OpenAPI contract assertion passed.
HTTP execution was blocked by `listen EPERM`. Child entrypoint tests could not
capture subprocess diagnostics in this sandbox; their signal tests also encountered
`listen EPERM`. A standalone `pnpm db:check` reported `database_connection_failed`
and then `database_pool_closed`; connectivity through that entrypoint remains
unverified. Run the full e2e commands in an environment permitting subprocesses
and local sockets before deployment.
