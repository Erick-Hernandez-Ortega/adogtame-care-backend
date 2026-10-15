export const RoutineType = {
    FEEDING: 'FEEDING',
    WALK: 'WALK',
    HYGIENE: 'HYGIENE',
    OTHER: 'OTHER',
} as const;
export type RoutineType = (typeof RoutineType)[keyof typeof RoutineType];

export class CareRoutineType {
    private constructor(readonly value: RoutineType) {}

    static from(value: string): CareRoutineType {
        if (
            !Object.values(RoutineType).some(
                (routineType: string): boolean => routineType === value,
            )
        ) {
            throw new TypeError('Routine type must be FEEDING, WALK, HYGIENE or OTHER');
        }

        return new CareRoutineType(value as RoutineType);
    }
}
