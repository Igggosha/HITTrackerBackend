import { Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module';
import {
  createSearchClient,
  SEARCH_CLIENT,
} from '../catalog-search/elasticsearch.client';
import { IndexWriterService } from './index-writer.service';
import { SearchIndexerService } from './search-indexer.service';

@Module({
  imports: [MetricsModule],
  providers: [
    IndexWriterService,
    SearchIndexerService,
    {
      provide: SEARCH_CLIENT,
      useFactory: () => {
        const client = createSearchClient(
          process.env.SEARCH_WRITER_USERNAME,
          process.env.SEARCH_WRITER_PASSWORD,
        );
        if (!client)
          throw new Error('SEARCH_URL is required for search indexer');
        return client;
      },
    },
  ],
})
export class SearchIndexerModule {}
