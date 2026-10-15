import {
    pageRequest,
    pageResult,
    type PageQuery,
    type Page,
} from '../../../shared/application/pagination';
import type { AccessiblePetSummary, PetQueryRepository } from '../persistence/pet-query.repository';

export class ListMyPets {
    constructor(private readonly petQueryRepository: PetQueryRepository) {}

    async execute(accountId: string, query: PageQuery = {}): Promise<Page<AccessiblePetSummary>> {
        const scope: string = JSON.stringify(['pets', accountId]);
        const rows = await this.petQueryRepository.findAccessibleByAccountId(
            accountId,
            pageRequest(query, scope),
        );

        return pageResult(rows, query, scope);
    }
}
