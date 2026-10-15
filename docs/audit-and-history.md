# Audit and history review (#52)

The current model retains original authorship, technical row timestamps and selected
business history. It does not provide a complete record of who changed each field,
earlier values, or deletions. This review covers all 12 application tables in Pet
Management, Identity, Health and Care. No audit log subsystem is introduced.

## Coverage

Every table below has required `created_at` and `updated_at` timestamptz columns
and an enabled `BEFORE UPDATE FOR EACH ROW` trigger invoking `set_updated_at()`
after migration `0020_robust_dorian_gray.sql`.

| Table | Account attribution | History retained and limits |
| --- | --- | --- |
| `accounts` | `id` identifies the account, not an administrative actor. | Account registration persists identity and timestamps. No account update/delete API or credential-change history exists. |
| `pets` | No dedicated creator or latest-editor field. Registration creates the initial owner membership atomically. | Profile and current ACTIVE/ARCHIVED status survive archive/restore. Previous profile values, lifecycle actors and separate archive/restore times are not stored. An owner membership does not establish who performed later actions. |
| `pet_memberships` | `account_id` identifies the person related to the pet, not the person making an administrative change. | The same membership ID, pet/account pair and creation time survive leave, removal, promotion and reactivation. Only current role/status and latest update time remain; previous roles, active periods, and removal/promotion actors are not stored. |
| `pet_invitations` | `invited_by_account_id` is the original inviter; `invited_email` is the intended recipient. | Creation and expiration instants, current lifecycle status and latest technical update time remain. Acceptance/rejection/cancellation actors and a sequence of transitions are not stored. |
| `health_weight_records` | `recorded_by_account_id` is the authenticated original recorder. | Measurement date and current weight remain until permanent deletion. Corrections preserve the recorder; previous values and latest editor are not stored. |
| `health_vaccination_records` | `recorded_by_account_id` is the authenticated original recorder. | Applied date and optional next due date remain until permanent deletion. Corrections preserve the recorder without storing earlier values. |
| `health_pet_allergies` | `recorded_by_account_id` is the authenticated original recorder. | Current reported allergy data remains until permanent deletion; no clinical onset date, lifecycle or revision history exists. |
| `health_pet_medical_conditions` | `recorded_by_account_id` is the authenticated original recorder. | Current ACTIVE/RESOLVED status, optional diagnosis/resolution dates and current details remain until deletion. Reopen clears the resolution date; it does not retain prior resolutions or their actors. |
| `health_pet_medications` | `recorded_by_account_id` is the authenticated original recorder. | Current indication and OPEN/COMPLETED/DISCONTINUED report remain until deletion. Reopen clears ending/reason permanently; earlier closure reports and their actors are not retained. A real restart is another independent record. |
| `health_pet_veterinary_visits` | `recorded_by_account_id` is the authenticated original recorder. | Visit date and current encounter details remain until permanent deletion; previous corrections and latest editor are not stored. |
| `care_routines` | `recorded_by_account_id` is the authenticated original recorder. | Current routine and suggestions remain; updates preserve authorship without schedule versions. No routine deletion/deactivation API exists. |
| `care_activities` | `completed_by` is the authenticated completing account. | Independent completion records retain UTC `completed_at`, recorder timezone and notes. No correction/deletion API exists. Local day is derived in the recorded timezone, independently of later routine changes. |

All six Health recording paths and Care routine creation already derive authorship
from authentication, rather than accepting an author in the request body. Activity
completion already does the same through `completedBy`. Corrections and lifecycle
operations preserve original authorship even when another authorized member performs
them. There is no missing recorder in those established contracts. Adding recorder
fields to Pet or treating membership account IDs as administrative actors would
require new semantics and cannot reconstruct historical actors.

Health and Care account references have restrictive foreign keys to Identity;
pet references are restrictive, and activities also reference routines restrictively.
Pet Management's membership `account_id` and invitation `invited_by_account_id`
currently lack account foreign keys. The membership issue is already tracked in
[pet member reads](pet-members-read.md). Existing orphan handling and new cross-context
constraints remain separate persistence work; this review does not infer or repair
historical identities.

## Timestamp semantics and the closed gap

The one missing timestamp/trigger pair was `pet_invitations.updated_at`. Migration
`0020_robust_dorian_gray.sql` is generated with `pnpm db:generate`, with only the
existing `set_updated_at()` trigger appended, following `0017_mean_bishop.sql`.
No repository, application or domain change is needed: existing status UPDATEs now
invoke the trigger. Timestamp management stays entirely in persistence.

New invitation `updated_at` defaults to PostgreSQL transaction `now()`, matching
other technical timestamp defaults. Invitation `created_at` and `expires_at` retain
their existing application Clock values and lifecycle meaning; they are not replaced
or forced equal to the new technical timestamp. Existing invitations receive the
migration transaction time as their update baseline. This is not evidence of their
last historical transition, which cannot be recovered. There is no explicit UPDATE
backfill, change of status, or rewrite of creation/expiration dates. Migration `0005`
likewise established technical timestamp baselines for preexisting accounts, pets
and memberships; those original times cannot be reconstructed either.

`set_updated_at()` assigns `statement_timestamp()` on every physical UPDATE, including
direct SQL and same-value UPDATEs, overriding a supplied update timestamp. It does
not identify an actor, record prior values, represent commit time, or guarantee a
globally ordered event sequence. Other tables' creation/update defaults start equal
at transaction time; occurrence dates and completion instants are independent facts.

Application no-ops avoid physical UPDATEs and preserve timestamps: normalized
corrections, archive/restore retries, inactive leave/removal, already-owner promotion,
equivalent medication transitions, and terminal invitation retries follow their
existing contracts. Rejected authorization and rolled-back mutations leave no
timestamp change. Reads acquire no mutation locks and update no timestamps.

Invitation acceptance, rejection, cancellation and persisted expiry now update the
technical timestamp while preserving the inviter and lifecycle dates. Expiry is
evaluated lazily by existing operations, including replacement of an expired pending
invitation; `expires_at` is the deadline, while `updated_at` is when expiry was
persisted. Time passing alone does not issue an UPDATE. There is no scheduler.

## Archive, deletion and access

Pet archive retains the profile, memberships, invitations, all Health records,
routines and activities. Restore preserves them too. Only the pet status and pet
update timestamp change on a real transition; related timestamps remain intact.
There is no dedicated `archived_at`, `archived_by`, or archive/restore event history.
Membership removal/leave deactivates the historical relationship rather than deleting
it; later involvement reuses the same relationship identity.

All six Health DELETE operations physically remove erroneous records. Their IDs,
authorship, clinical facts and technical timestamps disappear, with no deletion actor,
deletion time, reason, tombstone or restoration. This is the explicit existing API
behavior, including [veterinary visit deletion](pet-veterinary-visits.md#delete-45)
and [medication lifecycle corrections](pet-medication-lifecycle.md). Clinical resolution
and reported medication closure instead retain the record in its current state.
No retention or soft-delete policy is introduced by this slice.

Authorship never grants enduring access. Active pet membership authorizes reads,
including archived history; Health and Care writes require an ACTIVE pet. Existing
owner-only administrative rules and the last-owner invariant remain unchanged.
Leave remains available for archived pets; invitation rejection retains its separate
recipient/lifecycle rules. Ordinary mutations retain Pet → requester Membership →
record locking. Invitation mutations retain their documented Invitation-first order
where applicable, avoiding lock inversion; see [pet archive](pet-archive.md).

## API and verification

The API still exposes 51 operations. Technical timestamps remain private; DTOs,
readers, response shapes, Swagger/OpenAPI and authentication-before-validation route
rules are unchanged. No domain imports NestJS or Drizzle to implement this change.

`test/audit-and-history.integration-spec.ts` verifies required timestamp columns and
enabled row triggers across all 12 tables against PostgreSQL catalogs. It exercises
invitation defaults, all terminal transitions and their retries, lazy expiry through
each action and replacement, unchanged authorship/lifecycle dates, denied access,
statement-time assignment and rollback. Existing domain/application, integration and
HTTP tests continue covering recorder derivation, cross-author corrections, no-ops,
permanent deletions, historical membership identity, archive preservation and access.
`test/openapi.e2e-spec.ts` remains the regression check for the unchanged public API.

An editor/deleter trail, previous-value history, historical membership intervals or
retention rules would need separately approved requirements. None is necessary to
close the missing invitation timestamp gap, and none is implemented here.
