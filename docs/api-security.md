# API security and hardening (#53)

The API has 55 operations: six public operations (`GET /`, `GET /health`,
`GET /health/live`, `GET /health/ready`, registration and login) and 49 Bearer-protected operations. The baseline already uses the installed `helmet@8.3.0` and `@nestjs/throttler@6.7.1`. No other dependency, external
system, database migration, CORS policy, retention rule or deployment change is introduced.

## Authorization review

| Boundary | Authorization and visibility |
| --- | --- |
| Identity | Registration and login are public. Passwords are hashed with Argon2id. Login does not distinguish an unknown email from a wrong password. Protected requests verify JWT signature/expiry and require a persisted account. |
| Pet lists, detail and members | ACTIVE membership grants access to ACTIVE and ARCHIVED pets. Member lists include only ACTIVE relationships. Missing pets, outsiders and inactive memberships share `404 PET_NOT_FOUND`. |
| Pet profile and owner administration | ACTIVE OWNER of an ACTIVE pet is required for profile changes, invitations, member removal and promotion. Access is checked before resolving another member. |
| Archive and Restore | ACTIVE OWNER is required; lifecycle retries are idempotent only after authorization. Restore is the deliberate archived-write exception. |
| Leave | Own historical membership is required, including on archived pets. Inactive retries succeed; the last active owner cannot leave. |
| Invitations | Accept/Reject require the authenticated recipient email to match the invitation; lifecycle and expiry rules remain unchanged. Cancel requires active owner access to the active pet. Acceptance cannot grant archived access. Current Identity has no email-verification workflow; hardening does not invent one. |
| Health and Care reads | ACTIVE OWNER or COLLABORATOR can read ACTIVE/ARCHIVED pets. Authorship does not grant continued access. Filters and empty/exhausted pages do not bypass membership checks. |
| Health and Care writes | ACTIVE OWNER or COLLABORATOR on ACTIVE pets. Archived pets are read-only. Pet authorization precedes record lookup; only authorized members can receive a record-specific 404. |

No new 403 distinction is introduced. Existing owner invariant conflicts and
invitation lifecycle outcomes remain unchanged. Recording retains existing domain
validation before persistence access; correction validates semantic values after
authorized locked loading. Structural HTTP validation follows authentication.

Mutations retain Pet → requester Membership → target record locks under READ COMMITTED.
Invitation operations retain their documented Invitation-first ordering where applicable;
see [Pet archive](pet-archive.md). No locking, timestamp, authorship or no-op write
behavior changes. Domain remains independent of NestJS, HTTP and Drizzle.

## Pagination

Every list now accepts optional `limit` (default 20, integer 1–100) and opaque
`cursor`, returning `{ items, nextCursor }`; the last page uses `nextCursor: null`.
This includes pets, members, allergies, conditions, medications, veterinary visits,
routines and activities, alongside the existing weight/vaccination history pages.
This replaces the former bare pet array and the former member `members` field.
Clients must follow `nextCursor` to retrieve complete collections.

Unknown, repeated, nested, noncanonical numeric limits and malformed cursors return
400 INVALID_REQUEST. The new cursors are canonical base64url versioned positions,
bounded to 2,048 characters and scoped to the list, account, pet and activity filters.
They are opaque continuation values, not credentials or signed authorization grants.
Every page rechecks access. Weight/vaccination retain their existing cursor format.
Limits may change between pages; filters must remain the same.

Ordering is preserved: pets by name/ID ascending; members by owner-first rank,
creation time/ID ascending; other lists use their existing descending date/creation
and ID ordering, including microseconds and condition dates with nulls last.
Readers apply keyset predicates and LIMIT (page size plus one) in PostgreSQL. Empty
pages retain an authorization sentinel. No unbounded application array is fetched
by a paginated endpoint. Activity local-day filters run before LIMIT, comparing
`completed_at AT TIME ZONE timezone` as a date in each record's stored IANA timezone.
Domain still derives the returned localDay. This preserves DST and inclusive bounds.

Pages use independent statement snapshots, without row locks or timestamp changes.
Concurrent insertions, deletions, renames, promotions or corrected ordering dates may
change later pages; pagination is not a historical snapshot. A deleted cursor record
does not invalidate its saved position. Existing indexes remain unchanged; large
histories may still require query-plan tuning, especially local-day filters.

## Input and resource bounds

The installed Nest Express adapter uses the parser's existing **100 KB** JSON and
URL-encoded body limit. It is retained, not increased. Oversized protected requests
now authenticate first and return 413 INVALID_REQUEST to authenticated callers.
Malformed/scalar JSON returns 400 INVALID_REQUEST after authentication. Missing or
invalid Bearer tokens take precedence with 401 UNAUTHENTICATED on every protected
operation, including GET and DELETE parser failures. Unknown routes are not added
to the authentication contract.

Health/Care domain text bounds remain unchanged: names/titles/reasons 255 Unicode
code points, ordinary notes/instructions 2,000, veterinary observations 5,000, and
existing medication dosage/frequency/reason bounds. HTTP shapes remain strict and
reject unexpected properties. Domain retains trimming, nonempty, date, timezone,
UUID and business validation. No clinical data moves into Pet Management.

Previously unbounded Pet profile transport strings now allow at most 255 trimmed
Unicode code points for name, breed name, color and microchip, and 2,000 for
distinctive marks. Raw UTF-16 input is also bounded to twice these values. Identity
and invitation transport email strings are capped at 508 UTF-16 units and password
inputs at 256, bounding work before normalization/hashing; these are transport
ceilings, not a change to email grammar or the registration password policy
(12–128 Unicode code points). No persisted text is rewritten.

Routine frequency now rejects more than 24 suggested times, more than seven weekdays,
and duplicates in either collection. Exact HH:mm and supported weekdays remain domain
rules; order, null/omission normalization, DAILY/WEEKLY semantics and independence
from timesPerPeriod remain unchanged. Creation, correction and reconstitution share
the value object. Existing invalid persisted suggestions require correction before
reconstitution; no silent deduplication or data migration is performed.

## Error handling and security controls

Controllers expose explicit application errors. The global exception filter converts
unexpected exceptions to the existing generic 500 response before calling Nest's
base filter. It logs only `{ event: "unexpected_request_failed", status: 500 }`.
No exception object, message, stack, cause, query, parameters, constraint, email,
hash, token, URL, path or clinical text is passed to the logger. This also covers
unexpected authentication failures while handling parser errors. Parser input is never passed to the logger.
Readiness failures log only `{ event: "database_health_check_failed" }` and return
the existing generic DATABASE_UNAVAILABLE 503.

### Security headers

The HTTP entry point and every e2e app bootstrap call the same
`configureSecurityHeaders` function before initialization and Swagger setup. Helmet
uses its defaults, including CSP, HSTS, nosniff, frame protection and removal of
X-Powered-By. Headers apply to API successes/errors and Swagger assets. Swagger's
scripts are served from the same origin; its inline styles are permitted by the
default CSP. No docs-only relaxation is needed. Swagger remains available at
`/docs` and `/docs-json` in every environment. Helmet's default HSTS and
upgrade-insecure-requests directive are retained; serve production over HTTPS.

### Rate limiting

The existing Nest Throttler guard and in-memory storage enforce 60,000 ms
lifetime/block durations:

- Global: **100 requests/minute per source**, shared across controller routes.
- Authentication: **10/minute per source per endpoint**, for registration and login.
- Login account: **10/minute per normalized email**, shared across source addresses.
  Normalization uses Identity's `Email.from` (trim/lowercase). Only bounded valid
  email values get an account bucket; malformed bodies still consume source budgets.
  Keys contain a SHA-256 digest instead of the raw email. No key or digest is logged.
- Readiness: **10/minute per source**, independent of the global/auth budgets.
- `/health` and `/health/live` are exempt liveness endpoints with no DB access.

Validated positive integer `THROTTLE_LIMIT`, `AUTH_THROTTLE_LIMIT`,
`LOGIN_ACCOUNT_THROTTLE_LIMIT` and `READINESS_THROTTLE_LIMIT` override the defaults.
No environment automatically disables protection. The global guard runs before
authentication and controller validation. Protected JSON parser failures run that
same guard/storage/global key in the exception filter before authentication's
crypto or account query. Every such request consumes one global hit; parser failures
never reach controller guards and are not counted twice. An exhausted budget
returns 429 before authentication. Other requests reaching guards count regardless
of success. Swagger/static middleware and unknown routes remain outside guards.

The filter returns exactly `429 { "code": "RATE_LIMIT_EXCEEDED", "message": "Too many requests" }`
and copies named-budget Retry-After headers to the standard `Retry-After` header
(seconds). OpenAPI documents 429 on all controller operations except liveness.

IPv4 addresses remain independent. IPv6 clients share their **/64 subnet** budget,
including equivalent compressed/expanded spellings. Express proxy trust remains
disabled; client-supplied forwarding headers cannot select the source. Behind a
reverse proxy, clients may share its budget. Configure only a known trusted proxy
topology in a separately approved deployment change.

Counters remain process-local, reset on restart and are not shared across replicas.
Account throttling can temporarily block a legitimate account targeted by others;
it expires with the same one-minute budget. No permanent account state changes.
No new dependency, distributed limiter, storage service or infrastructure is added.
The original proposal for new Helmet/rate-limiting dependencies remains pending;
this slice preserves the already installed and active implementations.

### Liveness and readiness

`GET /health` now serves liveness, with `/health/live` as an explicit alias. Both
return 200 `{ "status": "ok" }` without touching PostgreSQL, including during DB
failure. Database monitors must move from `/health` to `/health/ready`.
Readiness returns the same 200 body on success or generic DATABASE_UNAVAILABLE 503
on failure, saturation or timeout; an exhausted source budget returns 429 first.

Readiness shares the existing database pool, with at most one queued/running probe
per process. A one-second response deadline includes pool acquisition. The single
slot remains occupied until the driver settles even if the response times out,
so repeated deadlines cannot enqueue unbounded probes. An acquired probe runs
`SET LOCAL statement_timeout = '1000ms'` and `SELECT 1` in a read-only-in-practice
transaction (no data writes); the setting resets on completion/rollback. This does
not impose a global database deadline or verify schema/migrations. Successful probes
do not log; failed probes log only the fixed event above.

### Test isolation

`test/setup-environment.ts` sets all four validated throttle limits to 1,000,000
for ordinary test fixtures. HTTP security tests explicitly omit those overrides
and validate production defaults in each fresh app. Rate-limiting integration tests
use real guard metadata/storage without a socket or database. Exception integration
tests use the real filter, Express adapter and throttle storage, with an authentication
test double, to prove parser rejection precedes authentication after exhaustion.

## Verification

Colocated unit tests cover routine limits/duplicates, page defaults, maximums,
opaque cursor round trips, invalid tokens, scope isolation, projections and use-case
orchestration. PostgreSQL list tests cover ordering, membership, archive preservation,
empty pages and histories beyond the default page size. HTTP tests cover page traversal,
cross-pet cursors and strict validation. api-security.e2e-spec.ts derives all protected
operations from OpenAPI and exercises missing/invalid/valid authentication against
malformed, scalar and oversized JSON, plus pagination and generic unexpected errors.
OpenAPI regression tests retain 55 operations and check pagination and 429 contracts.

`test/rate-limiting.integration-spec.ts` exercises the real Throttler guard and
in-memory storage with production controller metadata without an HTTP socket or
database. It covers auth limits, retry after expiry, IP isolation, the shared global
budget, /64 isolation, normalized-email account limits, readiness limits and liveness
exemption. `test/security-errors.integration-spec.ts` verifies real Drizzle exception
redaction, parser exhaustion before authentication, authentication failure redaction
and closed-pool readiness/liveness. Run
`pnpm test:integration --runInBand rate-limiting security-errors`.
The PostgreSQL readiness tests also cover probe-slot release and a saturated pool
with a deadline while retaining exactly one pending probe.

Run pnpm lint, pnpm build, pnpm exec tsc --noEmit -p tsconfig.json and pnpm test.
Run `pnpm test:e2e --runInBand http-security openapi api-security` for HTTP security checks.
Database tests require migrated PostgreSQL; HTTP tests require permission to bind
local sockets. A sandbox without those capabilities cannot verify their runtime results.

M-01 through M-04 are addressed here. H-01, M-05, low findings and informational
items are unchanged. No domain, persistence schema, aggregate, locking or timestamp
behavior changes. Readiness and login defaults are the bounded policies requested
for this slice; deployment ingress, CORS, retention and new dependencies remain pending.
