# Pet medication lifecycle

`PetMedication` records an indication and its currently reported closure. OPEN means no closure recorded; COMPLETED and DISCONTINUED are reports, not clinical certification, adherence, or administered doses. A real restart or new indication creates a new independent record. No dates infer status.

## Dates and corrections

`endedDate` is nullable and explicitly supplied at closure, never automatically set. Known closure dates cannot exceed today UTC. Completion requires an ending on or after a known indicated start; discontinuation may precede that start. Neither must match the planned end. PATCH preserves status and corrects applicable closure details; Reopen clears an erroneous closure permanently without transition history. Equivalent normalized retries do not write; different repeated reports conflict. Retries identify current state, not an original command across intervening transitions.

## Authorization and consistency

ACTIVE owners and collaborators may write ACTIVE pets regardless of authorship and read ACTIVE or ARCHIVED pets. Writes acquire Pet → requester Membership → Medication locks under READ COMMITTED. The aggregate enforces business rules; persistence provides authorized atomic loading and saving through application-owned contracts. The existing Health Clock supplies UTC today only when a non-null closure date needs temporal validation. Reconstitution and preserved historical dates use structural validation.

## Migration and deployment

Migration `0016_green_skullbuster.sql` adds status with a constant OPEN default and NOT NULL, plus nullable ended_date and discontinuation_reason. Existing records receive no inferred ending or reason. There is no UPDATE backfill, preserving historical timestamps and authorship. Existing indexes remain sufficient. PostgreSQL checks complement the domain's status, civil-range, applicable-reason, and completion-chronology invariants; current-day validation stays in Domain.

Pause Medication writes briefly while applying the migration and deploying the updated application. Older writers cannot validate completion chronology and could encounter a database error on a previously accepted PATCH. Mutation and List responses add three required fields, so consumers using exact response shapes must be updated. OpenAPI contains 42 operations. Keep lifecycle columns and their data during an application rollback; dropping them would destroy reported facts.
