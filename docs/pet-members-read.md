# Pet member reads

`GET /pets/:petId/members` uses the existing Application read boundary,
`PetQueryRepository.findAccessibleMembers`. Its SQL statement checks the pet
status and requester access while selecting only active memberships. It returns
membership IDs, account IDs, and roles without reconstituting domain objects.
The requester participates in the same result set, so authorized reads contain
at least that membership.

Application composes this projection with one batch call to the consumer-oriented
`AccountLookup.findEmailsByAccountIds` port. The Identity adapter selects only
account IDs and emails and uses `Email.from`, matching the normalization of the
individual lookup. This keeps account persistence knowledge within Identity
and avoids one query per member. Application preserves the reader's order even
if Identity returns accounts in a different order.

The order is owner first, then `pet_memberships.created_at ASC`, then membership
ID ascending. Reactivation preserves the original membership ID and creation
time, so this ordering reflects the creation of the historical relationship,
not the start of its latest active period.

## Read consistency

A successful read runs two SQL statements in autocommit under PostgreSQL's
default `READ COMMITTED` isolation. Access, pet status, and current memberships
are evaluated in the first statement's snapshot. Emails come from the second
statement's snapshot. Membership changes committed between these statements
do not change the already selected list; an email change may be reflected in
the response. Subsequent requests evaluate access again.

This is the intended behavior for an ordinary read. It requires no row locks,
write transaction, or shared snapshot across requests. A cross-context JOIN
would provide a single statement snapshot but would couple the Pet Management
reader to Identity's account schema; the existing batch port provides the
required behavior with two queries.

## Separate persistence debt

`pet_memberships.account_id` currently has no foreign key to `accounts.id`.
A membership can therefore reference an absent account. If an active member
has no corresponding account, `ListPetMembers` fails with an internal error.
It does not return a partial list or invent an email.

Review referential integrity and the handling of any existing orphaned rows
in a separate persistence task. This slice introduces no foreign key,
migration, or new index. The existing unique constraint on `(pet_id, account_id)`
supports requester lookup and membership selection by its `pet_id` prefix;
sorting the small member list does not justify an additional index.
