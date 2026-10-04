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

The API exposes 26 operations.

| Route                                         | Description             | Bearer token |
| --------------------------------------------- | ----------------------- | ------------ |
| `GET /`                                       | Welcome message         | No           |
| `POST /accounts`                              | Register account        | No           |
| `POST /auth/login`                            | Get access token        | No           |
| `GET /pets`                                   | List accessible pets    | Yes          |
| `GET /pets/{petId}`                           | Get pet profile         | Yes          |
| `GET /pets/{petId}/members`                   | List current pet members | Yes         |
| `DELETE /pets/{petId}/members/{membershipId}` | Remove pet member access | Yes |
| `POST /pets/{petId}/members/{membershipId}/promote` | Promote collaborator to owner | Yes |
| `PATCH /pets/{petId}`                         | Correct pet profile     | Yes          |
| `POST /pets`                                  | Register pet            | Yes          |
| `POST /pets/{petId}/invitations`              | Invite collaborator     | Yes          |
| `POST /pets/{petId}/archive` | Archive a pet | Yes |
| `POST /pets/{petId}/restore` | Restore a pet | Yes |
| `POST /pets/{petId}/leave`                    | Leave a pet   | Yes          |
| `POST /pets/{petId}/health/allergies` | Record a known pet allergy | Yes |
| `POST /pets/{petId}/health/weight-records`    | Record pet weight (kg)  | Yes          |
| `GET /pets/{petId}/health/weight-records`     | List pet weight history | Yes          |
| `PATCH /pets/{petId}/health/weight-records/{weightRecordId}` | Correct pet weight record | Yes |
| `DELETE /pets/{petId}/health/weight-records/{weightRecordId}` | Delete pet weight record | Yes |
| `POST /pets/{petId}/health/vaccination-records` | Record pet vaccination | Yes |
| `GET /pets/{petId}/health/vaccination-records` | List pet vaccination history | Yes |
| `PATCH /pets/{petId}/health/vaccination-records/{vaccinationRecordId}` | Correct vaccination record | Yes |
| `DELETE /pets/{petId}/health/vaccination-records/{vaccinationRecordId}` | Delete vaccination record | Yes |
| `POST /pet-invitations/{invitationId}/accept` | Accept invitation       | Yes          |
| `POST /pet-invitations/{invitationId}/reject` | Reject invitation       | Yes          |
| `POST /pet-invitations/{invitationId}/cancel` | Cancel invitation       | Yes          |

To archive a pet, send `POST /pets/{petId}/archive` as an active owner. Success is `204 No Content`, including retries on an archived pet after owner authorization is checked again. A retry performs no UPDATE and preserves `pets.updated_at`; a real transition changes it through the existing database trigger. Archive preserves the profile, memberships, pending invitations, and Health history. Collaborators, inactive members, absent memberships, and missing pets receive `404 PET_NOT_FOUND`. The pet ID must be a non-nil UUID. Send no query parameters and no body or `{}`; invalid structure returns `400 INVALID_REQUEST`. A missing or invalid Bearer token returns `401 UNAUTHENTICATED`.

To restore an archived pet, send `POST /pets/{petId}/restore` as an active owner. Archive transitions `ACTIVE → ARCHIVED`; Restore transitions `ARCHIVED → ACTIVE`. Both return `204 No Content` and are idempotent after active owner authorization: an authorized retry performs no UPDATE or timestamp change. Restore preserves profile, memberships (including inactive members), all invitation states and expiration dates, and Health history. A pending, unexpired invitation can be accepted again under the existing acceptance rules; expired invitations are not revived. Restore uses the same Bearer, non-nil UUID, empty query and absent/empty body contract and `400 INVALID_REQUEST`, `401 UNAUTHENTICATED`, and `404 PET_NOT_FOUND` errors as Archive.

`GET /pets` includes active and archived pets with an active requester membership and exposes `status` in each summary. `GET /pets/{petId}` also permits both states for active members. Archived pets remain readable through Members and Health history, and Leave remains available. Profile updates, invitations, member removal/promotion, and all Health writes require an active pet. Pending invitations are preserved; accepting a pending, unexpired invitation for an archived pet returns `409 INVITATION_NOT_ACCEPTABLE` without granting access. Cancellation requires an active pet; rejection remains available according to the invitation lifecycle. See [pet archive](docs/pet-archive.md) for lock ordering and concurrency.

To list current members, send `GET /pets/{petId}/members` with a Bearer token and no body or query parameters. Active owners and collaborators can read active or archived pets. The complete `200` response is `{"members":[{"membershipId":"...","accountId":"...","email":"owner@example.com","role":"OWNER"}]}`. Only active memberships are included, including the requester and all owners; pending invitations are excluded. Owners appear first, followed by collaborators, with each role ordered by membership creation time and then membership ID ascending. An invalid or nil UUID or unexpected query parameter returns `400 INVALID_REQUEST`; a missing or invalid token returns `401 UNAUTHENTICATED`. Missing pets, absent memberships, and inactive requester memberships return `404 PET_NOT_FOUND`.

To remove another pet member, send `DELETE /pets/{petId}/members/{membershipId}` as an active owner of an active pet. Identify the target by the persistent `membershipId` returned by List Pet Members. Both owners and collaborators can be removed; only status changes to `INACTIVE`, preserving the membership ID, account ID, role, and creation time. Success is `204` without a response body, including retries on another inactive owner or collaborator. A retry performs no UPDATE and preserves `updated_at`; a real transition changes `updated_at`. Self-removal returns `409 SELF_REMOVAL_NOT_SUPPORTED`, even for the last owner; use `POST /pets/{petId}/leave`. Missing, archived, or inaccessible pets return `404 PET_NOT_FOUND` before target resolution or idempotence. Only after owner authorization does a missing target or one from another pet return `404 PET_MEMBER_NOT_FOUND`. Authorization is checked again on every retry. Both path IDs must be valid non-nil UUIDs. Send no query parameters and no body or `{}`; invalid structure returns `400 INVALID_REQUEST`. A missing or invalid Bearer token returns `401 UNAUTHENTICATED`. The domain retains `LAST_OWNER_CANNOT_BE_REMOVED` as an internal defensive outcome, not a normal HTTP case: an authorized requester distinct from the target remains an active owner. See [member removal](docs/pet-member-removal.md) for the transaction protocol and concurrency behavior.

To promote a collaborator, send `POST /pets/{petId}/members/{membershipId}/promote` as an active owner of an active pet. An active collaborator becomes an active owner in the same membership, retaining its membership ID, account ID, and creation time. An active owner, including the requester, returns `204` without an UPDATE or `updated_at` change. An inactive member returns `409 PET_MEMBER_INACTIVE` and is not reactivated. A missing, archived, or inaccessible pet returns `404 PET_NOT_FOUND` before target resolution; a missing member or one from another pet then returns `404 PET_MEMBER_NOT_FOUND`. Both path IDs must be non-nil UUIDs. Send no query parameters and no body or `{}`; invalid structure returns `400 INVALID_REQUEST`. A missing or invalid Bearer token returns `401 UNAUTHENTICATED`.

To correct a pet profile, send `PATCH /pets/{petId}` as an active owner of an active pet. Include at least one of `name`, `species`, `breed`, `sex`, `birthInformation`, `color`, `distinctiveMarks`, or `microchip`. The nested `breed` and `birthInformation` objects use the same complete shapes as registration. Omitted fields are preserved; send `null` to clear `color`, `distinctiveMarks`, or `microchip`. The `200` response has the same shape as `GET /pets/{petId}`, with `role: "OWNER"`. A normalized no-op does not change `updated_at`. Invalid request structure returns `400 INVALID_REQUEST`; domain-invalid values return `422 INVALID_PET`. Missing, archived, or inaccessible pets return `404 PET_NOT_FOUND`.

To record a known allergy in Health, send `POST /pets/{petId}/health/allergies` with a Bearer token and JSON such as `{"allergen":"Penicillin","category":"MEDICATION","severity":"SEVERE","notes":"Previous reaction reported by veterinarian."}`. Active owners and collaborators of active pets receive `201` with `id`, `petId`, `allergen`, `category`, `severity`, nullable `notes`, and `recordedByAccountId` from the authenticated account. Allergen is trimmed, preserves casing, and must contain 1–255 Unicode characters. Category is `FOOD`, `MEDICATION`, `ENVIRONMENTAL`, or `OTHER`; severity is required and must be `MILD`, `MODERATE`, `SEVERE`, or `UNKNOWN`. Severity describes known or reported gravity rather than a formal diagnosis. Optional notes are trimmed and limited to 2,000 Unicode characters; omission or null means absence, while present empty text is invalid. The body is strict. Structural errors return `400 INVALID_REQUEST`; semantic errors return `400 INVALID_ALLERGEN`, `INVALID_ALLERGY_CATEGORY`, `INVALID_ALLERGY_SEVERITY`, or `INVALID_ALLERGY_NOTES`. Missing/invalid authentication returns `401 UNAUTHENTICATED`; missing, archived, or inaccessible pets return `404 PET_NOT_FOUND`. Duplicates are allowed. Allergies have no clinical identification date or lifecycle status. Technical timestamps stay in persistence, and Archive/Restore preserve the allergy data. Access checks and INSERT are atomic under Pet → Membership locks. Only creation is available.

To record a weight, send `POST /pets/{petId}/health/weight-records` with a Bearer token and JSON such as `{"weightKg":"12.3456","measuredDate":"2026-09-26"}`. Weight is a positive decimal string in kilograms with at most four decimal places. The measured date is a valid calendar date no later than today in UTC. An active owner or collaborator of an active pet receives `201` with the record ID, pet ID, canonical `weightKg`, `measuredDate`, and `recordedByAccountId`. An inaccessible or archived pet returns `404 PET_NOT_FOUND`.

To read weight history, send `GET /pets/{petId}/health/weight-records` with a Bearer token. Active owners and collaborators can read active or archived pets. Results are ordered by measured date, newest first. Optional `limit` defaults to 20 (maximum 100); pass the opaque `nextCursor` as `cursor` for the next page. The `200` response contains `items` and `nextCursor` (`null` on the last page). Each item contains `id`, decimal string `weightKg`, `measuredDate`, and `recordedByAccountId`. Missing or inaccessible pets return `404 PET_NOT_FOUND`.

To correct a record, send `PATCH /pets/{petId}/health/weight-records/{weightRecordId}` with `weightKg`, `measuredDate`, or both. The response is `200` with the canonical values and original recorder. To permanently delete it, send `DELETE` to the same path without a body or with `{}`; the response is `204`. Both actions require an active owner or collaborator of an active pet, regardless of who recorded the weight. Missing or inaccessible pets return `404 PET_NOT_FOUND`; a missing record or one belonging to another pet returns `404 WEIGHT_RECORD_NOT_FOUND` once pet access is confirmed.

To record a vaccination, send `POST /pets/{petId}/health/vaccination-records` with a Bearer token and JSON such as `{"vaccineName":"Rabies","appliedDate":"2026-09-20","nextDueDate":"2027-09-20"}`. `nextDueDate` may be omitted or `null`; the `201` response always includes it, using `null` when unknown. The vaccine name is trimmed, preserves casing, and allows up to 255 characters. Applied date must be a valid date no later than today UTC; a known next due date must be after it, even if already overdue. Active owners and collaborators of an active pet may create multiple identical records. Missing, archived, or inaccessible pets return `404 PET_NOT_FOUND`.

To read vaccination history, send `GET /pets/{petId}/health/vaccination-records` with a Bearer token. Active owners and collaborators can read active or archived pets. Records are ordered by application date, newest first, with stable ordering for ties. Optional `limit` defaults to 20 (maximum 100); pass the opaque `nextCursor` as `cursor` for the next page. The `200` response contains `items` and `nextCursor` (`null` on the last page). Each item contains `id`, `vaccineName`, `appliedDate`, nullable `nextDueDate`, and `recordedByAccountId`. Missing or inaccessible pets return `404 PET_NOT_FOUND`.

To correct a vaccination record, send `PATCH /pets/{petId}/health/vaccination-records/{vaccinationRecordId}` with at least one of `vaccineName`, `appliedDate`, or `nextDueDate`. Omit `nextDueDate` to preserve it; send `null` to clear it. The final applied and due dates must remain valid. A normalized no-op returns `200` without changing `updated_at`. The response includes the original `recordedByAccountId`. To permanently remove a record, send `DELETE` to the same route without a body or with `{}`; success is `204` without a body, and a repeated DELETE returns `404 VACCINATION_RECORD_NOT_FOUND`. Both actions require an active owner or collaborator of an active pet, regardless of who recorded the vaccination. An archived or inaccessible pet returns `404 PET_NOT_FOUND`; a missing record or one belonging to another pet returns `404 VACCINATION_RECORD_NOT_FOUND` after pet access is confirmed.

To leave a pet, send `POST /pets/{petId}/leave` with a Bearer token, no query parameters, and no body or `{}`. Owners and collaborators may leave active or archived pets. An active owner may leave only if another active owner remains; the last active owner receives `409 LAST_OWNER_CANNOT_LEAVE` without a change. Success is `204 No Content`, including retries on an inactive membership. Leave changes only membership status to `INACTIVE`, preserving the membership ID, account ID, role, and creation time. A real transition updates `updated_at`; retries perform no UPDATE. A departed member loses access and is excluded from List Pet Members. A new accepted invitation can reactivate the same historical membership as a collaborator, including a departed owner. Missing pets or absent own memberships return `404 PET_NOT_FOUND`. An invalid or nil pet UUID, unexpected query parameters, or a nonempty body returns `400 INVALID_REQUEST`; a missing or invalid token returns `401 UNAUTHENTICATED`.

Leave now returns `204` without a representation, replacing its previous `200` JSON response. Clients must no longer expect membership data in the response. See [Pet leave](docs/pet-leave.md) for the domain decision and transaction locking protocol.

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

See [Pet member reads](docs/pet-members-read.md) for the email lookup boundary,
read consistency, and the separate technical debt concerning the missing
membership-to-account foreign key.

## Verification

```bash
pnpm lint
pnpm test
pnpm build
```
