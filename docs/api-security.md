# API security and hardening (#53)

The API has 53 operations: four public operations (`GET /`, `GET /health`, registration
and login) and 49 Bearer-protected operations. This slice uses the approved, already
installed `helmet@8.3.0` and `@nestjs/throttler@6.7.1`. No other dependency, external
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

Controllers expose explicit application errors. Unexpected exceptions propagate to
Nest's base filter, which returns the generic 500 Internal server error; stack traces,
SQL/constraint details and internal exception messages are not response fields.
The authentication-first parser filter uses fixed public messages and delegates all
other errors to the base filter. Server-side logging remains available.

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

The global Nest Throttler guard uses its built-in in-memory storage and two budgets
with a 60,000 ms lifetime/block duration:

- Global: **100 requests/minute per IP**, shared across controller routes.
- Authentication: **10 requests/minute per IP per endpoint**, in addition to the
  global budget. This covers registration (`POST /accounts`) and login
  (`POST /auth/login`); there are currently no password/reset/refresh/token routes.
  Future credential/token endpoints must opt in with `AuthenticationRateLimit`.
- `GET /health` skips both budgets so readiness probes remain available under load.

Validated positive integer `THROTTLE_LIMIT` and `AUTH_THROTTLE_LIMIT` settings can
override the respective defaults (100 and 10). No environment automatically disables
protection. The global guard executes before authentication and controller validation;
once a budget is exhausted, 429 takes precedence. Requests that reach guards count
regardless of success, invalid credentials or invalid body shape. Express parser
failures occur before guards and retain the authentication-first contracts above.
Swagger/static middleware and unknown routes do not pass through controller guards.

The existing exception filter maps ThrottlerException to exactly
`429 { "code": "RATE_LIMIT_EXCEEDED", "message": "Too many requests" }`, with the
standard `Retry-After` header in seconds. Throttler's rate-limit headers are retained
(the auth budget uses the `-auth` suffix). OpenAPI documents 429 on all controller
operations except health. No counter is stored in PostgreSQL; replicas do not share
budgets and process restarts reset them. There is no Redis or distributed limiter.

IP tracking uses Express `request.ip`, with IPv6 tracked per full address. Trust
proxy is not configured or changed: forwarded headers alone cannot choose the IP.
Behind a reverse proxy, requests may therefore share the proxy's budget. Before
such a deployment, configure trust only for the actual trusted proxy topology and
ensure the proxy replaces untrusted forwarding headers. Do not blindly enable
trust proxy or derive identity directly from client-supplied X-Forwarded-For.

### Test isolation

`test/setup-environment.ts` supplies high, validated limits (1,000,000) for ordinary
API tests so fixture registration and large validation matrices are not accidentally
throttled. This applies only in the test process. `test/http-security.e2e-spec.ts`
overrides ConfigService in each fresh test app with validated production defaults
(omitting the two test limit overrides) and uses fresh in-memory counters. The
process environment and production configuration remain unchanged. It
checks headers and Swagger assets, the eleventh login/registration request returning
429, spoofed forwarding headers, a global budget shared across routes, and exempt
health probes. Security tests use invalid transport bodies to avoid creating accounts
or hashing passwords; only the unrelated database readiness probe is stubbed.

## Verification

Colocated unit tests cover routine limits/duplicates, page defaults, maximums,
opaque cursor round trips, invalid tokens, scope isolation, projections and use-case
orchestration. PostgreSQL list tests cover ordering, membership, archive preservation,
empty pages and histories beyond the default page size. HTTP tests cover page traversal,
cross-pet cursors and strict validation. api-security.e2e-spec.ts derives all protected
operations from OpenAPI and exercises missing/invalid/valid authentication against
malformed, scalar and oversized JSON, plus pagination and generic unexpected errors.
OpenAPI regression tests retain 53 operations and check pagination and 429 contracts.

`test/rate-limiting.integration-spec.ts` exercises the real Throttler guard and
in-memory storage with production controller metadata without an HTTP socket or
database. It covers auth limits, retry after expiry, IP isolation, the shared global
budget and health exemption. Run `pnpm test:integration --runInBand rate-limiting`.

Run pnpm lint, pnpm build, pnpm exec tsc --noEmit -p tsconfig.json and pnpm test.
Run `pnpm test:e2e --runInBand http-security openapi api-security` for HTTP security checks.
Database tests require migrated PostgreSQL; HTTP tests require permission to bind
local sockets. A sandbox without those capabilities cannot verify their runtime results.
