import { BirthInformation } from '../../domain/birth-information/birth-information';
import type { BirthDateAccuracy } from '../../domain/birth-information/birth-information.types';
import { Breed } from '../../domain/breed/breed';
import type { BreedKind } from '../../domain/breed/breed.types';
import { PetMembershipRole } from '../../domain/pet-membership/pet-membership';
import { Pet } from '../../domain/pet/pet';
import type { PetSex, PetSpecies } from '../../domain/pet/pet.types';
import { PetNotFoundError } from '../errors/pet-not-found.error';
import type { PetDetail } from '../persistence/pet-query.repository';
import type { PetRepository } from '../persistence/pet.repository';

export interface UpdatePetProfileCommand {
    petId: string;
    authenticatedAccountId: string;
    name?: string;
    species?: PetSpecies;
    breed?: { name: string; kind: BreedKind };
    sex?: PetSex;
    birthInformation?: { date: string; accuracy: BirthDateAccuracy };
    color?: string | null;
    distinctiveMarks?: string | null;
    microchip?: string | null;
}

export class InvalidPetProfileError extends Error {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
        this.name = 'InvalidPetProfileError';
    }
}

export class UpdatePetProfile {
    constructor(private readonly petRepository: PetRepository) {}

    async execute(command: UpdatePetProfileCommand): Promise<PetDetail> {
        let breed: Breed | undefined;
        let birthInformation: BirthInformation | undefined;

        try {
            if (command.breed !== undefined) {
                breed =
                    command.breed.kind === 'KNOWN'
                        ? Breed.known(command.breed.name)
                        : Breed.custom(command.breed.name);
            }

            if (command.birthInformation !== undefined) {
                birthInformation =
                    command.birthInformation.accuracy === 'EXACT'
                        ? BirthInformation.exact(command.birthInformation.date)
                        : BirthInformation.approximate(command.birthInformation.date);
            }
        } catch (error: unknown) {
            if (error instanceof TypeError || error instanceof RangeError) {
                throw new InvalidPetProfileError(error);
            }

            throw error;
        }

        const pet: Pet | null = await this.petRepository.correctProfileIfOwned(
            command.petId,
            command.authenticatedAccountId,
            (currentPet: Pet): Pet => {
                try {
                    return currentPet.correctProfile({
                        name: command.name,
                        species: command.species,
                        breed,
                        sex: command.sex,
                        birthInformation,
                        color: command.color,
                        distinctiveMarks: command.distinctiveMarks,
                        microchip: command.microchip,
                    });
                } catch (error: unknown) {
                    if (error instanceof TypeError || error instanceof RangeError) {
                        throw new InvalidPetProfileError(error);
                    }

                    throw error;
                }
            },
        );

        if (pet === null) {
            throw new PetNotFoundError();
        }

        return {
            id: pet.id.value,
            name: pet.name,
            species: pet.species,
            breed: { name: pet.breed.name, kind: pet.breed.kind },
            sex: pet.sex,
            birthInformation: {
                date: pet.birthInformation.date,
                accuracy: pet.birthInformation.accuracy,
            },
            color: pet.color ?? null,
            distinctiveMarks: pet.distinctiveMarks ?? null,
            microchip: pet.microchip ?? null,
            status: pet.status,
            role: PetMembershipRole.OWNER,
        };
    }
}
