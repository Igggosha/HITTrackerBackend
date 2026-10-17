// EN: Provides one global OutboxService so domain mutations can atomically enqueue integration events.
// UK: Надає один глобальний OutboxService, щоб доменні зміни могли атомарно додавати інтеграційні події.

import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';

// Global because every feature service that changes state emits events; the
// service itself is stateless and always writes through the caller's
// transaction.
@Global()
@Module({
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
