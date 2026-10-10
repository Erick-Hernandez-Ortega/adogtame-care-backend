import { BirthInformation } from '../birth-information/birth-information';
import { Breed } from '../breed/breed';
import {
    AccountId,
    PetMembership,
    PetMembershipRole,
    PetMembershipStatus,
} from '../pet-membership/pet-membership';
import { Pet, PetId, PetSex, PetSpecies, PetStatus } from './pet';
import type {
    PetSex as PetSexType,
    PetSpecies as PetSpeciesType,
    RegisterPetInput,
} from './pet.types';

const UUID_PATTERN: RegExp = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OWNER_ACCOUNT_ID_V1: string = '550e8400-e29b-11d4-a716-446655440000';

function validPetInput(overrides: Partial<RegisterPetInput> = {}): RegisterPetInput {
    return {
        name: 'Luna',
        species: PetSpecies.DOG,
        breed: Breed.known('Labrador Retriever'),
        sex: PetSex.FEMALE,
        birthInformation: BirthInformation.exact('2021-06-14'),
        ownerAccountId: OWNER_ACCOUNT_ID_V1,
        ...overrides,
    };
}

describe('Pet', () => {
    it('archives without changing identity, profile, or historical memberships', () => {
        const registered: Pet = Pet.register(
            validPetInput({
                color: 'Golden',
                distinctiveMarks: 'White paw',
                microchip: 'chip',
            }),
        );
        const collaborator: PetMembership = PetMembership.createCollaborator(
            AccountId.from('550e8400-e29b-41d4-a716-446655440001'),
        );
        const pet: Pet = Pet.reconstitute({
            id: registered.id,
            name: registered.name,
            species: registered.species,
            breed: registered.breed,
            sex: registered.sex,
            birthInformation: registered.birthInformation,
            color: registered.color,
            distinctiveMarks: registered.distinctiveMarks,
            microchip: registered.microchip,
            status: registered.status,
            memberships: [
                ...registered.memberships,
                collaborator,
                PetMembership.createCollaborator(
                    AccountId.from('550e8400-e29b-41d4-a716-446655440002'),
                ).leaveAsCollaborator(),
            ],
        });
        const archived: Pet = pet.archive();

        expect(archived).not.toBe(pet);
        expect(pet.status).toBe('ACTIVE');
        expect(archived.status).toBe('ARCHIVED');

        for (const key of [
            'id',
            'name',
            'species',
            'breed',
            'sex',
            'birthInformation',
            'color',
            'distinctiveMarks',
            'microchip',
            'memberships',
        ] as const) {
            expect(archived[key]).toEqual(pet[key]);
        }

        expect(archived.id).toBe(pet.id);
        expect(archived.archive()).toBe(archived);
    });

    it('registers a pet with its profile and a persistent identity', () => {
        const pet: Pet = Pet.register(
            validPetInput({
                name: ' Luna ',
                color: ' Golden ',
                distinctiveMarks: ' White spot on chest ',
                microchip: ' 981020000123456 ',
            }),
        );

        expect(pet.id.value).toMatch(UUID_PATTERN);
        expect(pet.name).toBe('Luna');
        expect(pet.species).toBe(PetSpecies.DOG);
        expect(pet.breed.name).toBe('Labrador Retriever');
        expect(pet.sex).toBe(PetSex.FEMALE);
        expect(pet.birthInformation.date).toBe('2021-06-14');
        expect(pet.color).toBe('Golden');
        expect(pet.distinctiveMarks).toBe('White spot on chest');
        expect(pet.microchip).toBe('981020000123456');
    });

    it('generates a different identity for each registered pet', () => {
        const firstPet: Pet = Pet.register(validPetInput());
        const secondPet: Pet = Pet.register(validPetInput());

        expect(firstPet.id.value).not.toBe(secondPet.id.value);
    });

    it('starts in the active status', () => {
        const pet: Pet = Pet.register(validPetInput());

        expect(pet.status).toBe(PetStatus.ACTIVE);
    });

    it('starts with exactly one owner membership', () => {
        const pet: Pet = Pet.register(validPetInput());

        expect(pet.memberships).toHaveLength(1);
        expect(pet.memberships[0]).toMatchObject({
            role: PetMembershipRole.OWNER,
            status: PetMembershipStatus.ACTIVE,
            accountId: { value: OWNER_ACCOUNT_ID_V1 },
        });
        expect(pet.memberships[0].id.value).toMatch(UUID_PATTERN);
        expect(pet.memberships[0].id.value).not.toBe(pet.id.value);
    });

    it('protects its membership collection from external changes', () => {
        const pet: Pet = Pet.register(validPetInput());
        const memberships = [...pet.memberships];

        memberships.pop();

        expect(pet.memberships).toHaveLength(1);
    });

    it('rejects registering a pet without a valid owner account ID', () => {
        expect(() => Pet.register(validPetInput({ ownerAccountId: 'not-a-uuid' }))).toThrow(
            'Account ID must be a valid non-nil UUID',
        );
    });

    it('rejects an empty name', () => {
        expect(() => Pet.register(validPetInput({ name: '   ' }))).toThrow(
            'Pet name cannot be empty',
        );
    });

    it.each([
        ['color', { color: '  ' }],
        ['distinctive marks', { distinctiveMarks: '  ' }],
        ['microchip', { microchip: '  ' }],
    ])('rejects empty optional %s when provided', (_field: string, override) => {
        expect(() => Pet.register(validPetInput(override))).toThrow('cannot be empty');
    });

    it('rejects an unsupported species', () => {
        const unsupportedSpecies: PetSpeciesType = 'BIRD' as PetSpeciesType;

        expect(() => Pet.register(validPetInput({ species: unsupportedSpecies }))).toThrow(
            'Pet species is not supported',
        );
    });

    it('rejects an unsupported sex', () => {
        const unsupportedSex: PetSexType = 'UNSPECIFIED' as PetSexType;

        expect(() => Pet.register(validPetInput({ sex: unsupportedSex }))).toThrow(
            'Pet sex is not supported',
        );
    });

    it('corrects each profile concept and validates the final combination', () => {
        const original: Pet = Pet.register(validPetInput());
        const corrected: Pet = original.correctProfile({
            name: ' Nala ',
            species: PetSpecies.CAT,
            breed: Breed.custom(' Domestic shorthair '),
            sex: PetSex.UNKNOWN,
            birthInformation: BirthInformation.approximate('2020-01-02'),
            color: ' Black ',
            distinctiveMarks: ' White paws ',
            microchip: ' 12345 ',
        });

        expect(corrected).not.toBe(original);
        expect(corrected.id).toBe(original.id);
        expect(corrected.status).toBe(original.status);
        expect(corrected.memberships).toEqual(original.memberships);
        expect(corrected).toMatchObject({
            name: 'Nala',
            species: 'CAT',
            breed: { name: 'Domestic shorthair', kind: 'CUSTOM' },
            sex: 'UNKNOWN',
            birthInformation: { date: '2020-01-02', accuracy: 'APPROXIMATE' },
            color: 'Black',
            distinctiveMarks: 'White paws',
            microchip: '12345',
        });
        expect(original.name).toBe('Luna');
        expect(original.species).toBe('DOG');
    });

    it('preserves omitted fields and clears nullable fields', () => {
        const original: Pet = Pet.register(
            validPetInput({
                color: 'Golden',
                distinctiveMarks: 'White spot',
                microchip: '12345',
            }),
        );
        const corrected: Pet = original.correctProfile({ color: null });

        expect(corrected.color).toBeUndefined();
        expect(corrected.distinctiveMarks).toBe('White spot');
        expect(corrected.microchip).toBe('12345');
        expect(
            corrected.correctProfile({
                distinctiveMarks: null,
                microchip: null,
            }),
        ).toMatchObject({
            distinctiveMarks: undefined,
            microchip: undefined,
        });
    });

    it('returns the same aggregate for normalized and null no-ops', () => {
        const original: Pet = Pet.register(validPetInput());

        expect(original.correctProfile({ name: '  Luna  ', color: null })).toBe(original);
        expect(
            original.correctProfile({
                breed: Breed.known(' Labrador Retriever '),
                birthInformation: BirthInformation.exact('2021-06-14'),
            }),
        ).toBe(original);
    });

    it('does not partially mutate the aggregate after a late invalid field', () => {
        const original: Pet = Pet.register(validPetInput());

        expect(() => original.correctProfile({ name: 'Nala', microchip: '   ' })).toThrow(
            'Pet microchip cannot be empty',
        );
        expect(original.name).toBe('Luna');
        expect(original.microchip).toBeUndefined();
    });

    it('preserves reconstituted membership history through correction', () => {
        const original: Pet = Pet.register(validPetInput());
        const collaborator: PetMembership = PetMembership.createCollaborator(
            AccountId.from('a3ef9f14-9e82-45d6-a5ba-89d31c7aa2e1'),
        ).leaveAsCollaborator();
        const restored: Pet = Pet.reconstitute({
            id: original.id,
            name: original.name,
            species: original.species,
            breed: original.breed,
            sex: original.sex,
            birthInformation: original.birthInformation,
            color: original.color,
            distinctiveMarks: original.distinctiveMarks,
            microchip: original.microchip,
            status: original.status,
            memberships: [...original.memberships, collaborator],
        });

        const corrected: Pet = restored.correctProfile({ sex: PetSex.MALE });

        expect(corrected.memberships).toEqual(restored.memberships);
        expect(corrected.memberships[1]).toBe(collaborator);
    });
});

describe('Pet.restore', () => {
    it('restores an immutable aggregate while preserving identity, profile and membership history', () => {
        const original: Pet = Pet.register(
            validPetInput({
                color: 'Brown',
                distinctiveMarks: 'White paw',
                microchip: 'chip',
            }),
        );
        const inactive: PetMembership = PetMembership.createCollaborator(
            AccountId.from('a3ef9f14-9e82-45d6-a5ba-89d31c7aa2e1'),
        ).leaveAsCollaborator();
        const archived: Pet = Pet.reconstitute({
            id: original.id,
            name: original.name,
            species: original.species,
            breed: original.breed,
            sex: original.sex,
            birthInformation: original.birthInformation,
            color: original.color,
            distinctiveMarks: original.distinctiveMarks,
            microchip: original.microchip,
            status: PetStatus.ARCHIVED,
            memberships: [...original.memberships, inactive],
        });
        const restored: Pet = archived.restore();

        expect(restored).not.toBe(archived);
        expect(archived.status).toBe(PetStatus.ARCHIVED);
        expect(restored).toMatchObject({
            id: archived.id,
            name: archived.name,
            species: archived.species,
            breed: archived.breed,
            sex: archived.sex,
            birthInformation: archived.birthInformation,
            color: archived.color,
            distinctiveMarks: archived.distinctiveMarks,
            microchip: archived.microchip,
            memberships: archived.memberships,
            status: PetStatus.ACTIVE,
        });
        expect(restored.memberships[1]).toBe(inactive);
        expect(restored.restore()).toBe(restored);
        expect(original.restore()).toBe(original);
        expect(original.archive().restore()).toEqual(original);
    });
});

describe('PetId', () => {
    it('reconstitutes a valid existing ID', () => {
        expect(PetId.from('B30A4C42-84E5-4765-99D4-1EFB17F09C12').value).toBe(
            'b30a4c42-84e5-4765-99d4-1efb17f09c12',
        );
    });

    it('rejects malformed IDs', () => {
        expect(() => PetId.from('not-a-uuid')).toThrow('Pet ID must be a valid non-nil UUID');
    });
});
