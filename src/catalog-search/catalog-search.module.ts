import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { MetricsModule } from '../metrics/metrics.module';
import { RolesGuard } from '../auth/roles.guard';
import { CatalogSearchController } from './catalog-search.controller';
import { CatalogSearchService } from './catalog-search.service';
import { createSearchClient, SEARCH_CLIENT } from './elasticsearch.client';

@Module({
  imports: [StorageModule, MetricsModule],
  controllers: [CatalogSearchController],
  providers: [
    RolesGuard,
    CatalogSearchService,
    { provide: SEARCH_CLIENT, useFactory: createSearchClient },
  ],
})
export class CatalogSearchModule {}
