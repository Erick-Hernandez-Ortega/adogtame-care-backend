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

## Invitation visibility and date/cursor hardening (L-01–L-03)

Cancellation returns exactly `404 { "code": "INVITATION_NOT_FOUND", "message":
"Invitation was not found" }` for both a missing invitation and one whose pet is
missing, archived or inaccessible to the requester. This includes collaborators,
inactive owners, nonmembers and unauthorized retries, regardless of invitation
status. Application maps both persistence outcomes to the same invitation error;
the existing authorization checks and Invitation → Pet → Membership locks remain.
Accept/Reject already scope lookup to the authenticated recipient email before
lifecycle evaluation and return the same missing-invitation response for a mismatch.
Their recipient-visible conflicts, expiry and idempotent outcomes remain unchanged.
Pet-scoped invitation creation retains PET_NOT_FOUND for inaccessible pets.

Weight-history cursor measurement dates and timestamp dates now reuse the shared
Gregorian civil-date validator (years 0001–9999). Year zero, impossible dates and
extra characters are rejected before reader access. Microsecond precision and the
existing opaque format are preserved. Shared pagination rejects NUL and unpaired
UTF-16 surrogates in every ordering key before querying PostgreSQL; valid Unicode
pairs and other PostgreSQL-compatible text remain accepted. Tampered values return
the existing 400 INVALID_REQUEST: `Cursor is invalid` for weight history and
`Request query is invalid` for shared pagination. Cursors remain unsigned positions.

CareActivity validates the timezone-converted local date on creation and
reconstitution, explicitly requesting the Gregorian calendar and era from Intl.
BC dates and dates beyond 9999 are rejected instead of losing their era or returning
an unsupported day. Recording returns 400 INVALID_ACTIVITY_COMPLETED_AT with
`Activity local date must be within years 0001-9999`, before persistence access.
For example, `0001-01-01T00:00:00Z` is invalid in America/New_York, while
`0001-01-01T01:00:00Z` is valid in Etc/GMT+1 and has local day `0001-01-01`.
UTC parsing, future-instant rejection and ordinary DST behavior remain unchanged.
No persisted rows are rewritten; previously invalid stored combinations fail domain
reconstitution and require explicit data correction outside this slice.

Unit tests cover missing/inaccessible outcome mapping, pre-reader rejection,
Unicode preservation, civil boundaries, era handling and application error mapping.
PostgreSQL integration tests cover invitation access outcomes, rejected activity
inserts and agreement with SQL local dates at the first supported day. HTTP tests
compare exact invitation responses, reject tampered cursors with controlled errors,
and record/filter year-0001 local activity dates. OpenAPI retains 55 operations and
specifies the uniform invitation 404 and local-date requirement.

## Account enumeration (M-05)

Login performs exactly one Argon2 verification after looking up a syntactically
valid email, whether or not the account exists. The application passes an absent
credential through the existing PasswordHasher port; the Argon2id adapter verifies
the submitted password against a fixed dummy hash precomputed once, outside request
handling. It uses the same current library defaults as registration: Argon2id v19,
64 MiB memory, three iterations, parallelism four, a 16-byte salt and 32-byte hash.
Tests compare its encoded parameters with newly generated hashes; regenerate the
dummy hash if real hashing parameters change. No per-request dummy hashing occurs.

An absent account is always rejected, regardless of the verification result, and
never receives a token. Unknown emails and wrong passwords retain exactly
`401 { "code": "INVALID_CREDENTIALS", "message": "Email or password is incorrect" }`.
Existing input validation, successful login and throttling remain unchanged.
Equivalent password-verification work removes the missing-Argon2 timing shortcut;
it does not guarantee identical total latency across database and runtime conditions.

### Known/pending: registration oracle

Registration deliberately retains its current contract: a new email returns 201
with account ID/email; an equivalent registered email returns
`409 EMAIL_ALREADY_REGISTERED`. This is a deterministic account-existence oracle,
so M-05 remains partially open. Login hardening and throttling do not remove it.
There is no email-verification workflow yet. A product decision is required before
changing registration responses or onboarding:

- Retain the explicit conflict: preserves current clients and clear duplicate-email
  guidance, while accepting the enumeration risk. Throttling only bounds probing.
- Return the same generic acknowledgement for both outcomes, with comparable work
  and no account details: breaks the 201/409 contract and hides the direct oracle.
  Without email verification or private email follow-up, users cannot tell whether
  an account was created or get private guidance when the address is already taken.
  Never overwrite existing credentials or authenticate an existing account merely
  because registration was submitted.
- Introduce email ownership verification before account activation, with a generic
  acknowledgement and comparable work for new/existing addresses: provides useful
  private onboarding guidance and stronger enumeration protection, but requires an
  approved verification/email lifecycle and delivery implementation (eventually
  Resend). It changes onboarding and cannot be delivered by this login-only slice.

Application unit tests assert one verification for absent/wrong credentials and no
token for an absent account even if the verifier returns true. Real Argon2 tests
check dummy-hash reuse, validity, parameters and absence of per-login hashing.
`test/identity/authenticate-account.integration-spec.ts` exercises the wired use
case, real hasher and PostgreSQL account lookup, including unchanged rows/timestamps.
`test/auth.e2e-spec.ts` compares exact unknown/wrong-password HTTP responses; existing
registration and OpenAPI tests preserve the 409 and token contracts. Tests assert
work and observable results rather than noisy wall-clock thresholds.

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

M-01 through M-04 were addressed by earlier slices. M-05 login verification is
addressed; the registration oracle remains known/pending as described above. H-01 and
informational items remain unchanged. L-01 through L-03 are addressed above.
There are no persistence schema, aggregate boundary, locking or timestamp changes.
Readiness and login defaults are the bounded policies requested for this slice; deployment ingress, CORS, retention and new dependencies remain pending.
