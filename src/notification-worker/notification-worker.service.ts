import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { NotificationDeliveryService } from '../notifications/notification-delivery.service';
import { NotificationReminderService } from '../notifications/notification-reminder.service';

@Injectable()
export class NotificationWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationWorkerService.name);
  private running = false;
  private loop?: Promise<void>;
  private wake?: () => void;
  private nextReminderScan = 0;
  private readonly interval = Number(
    process.env.NOTIFICATION_POLL_INTERVAL_MS ?? 5_000,
  );

  constructor(
    private readonly deliveries: NotificationDeliveryService,
    private readonly reminders: NotificationReminderService,
  ) {}

  onModuleInit() {
    this.running = true;
    this.loop = this.run();
  }

  private async run() {
    while (this.running) {
      try {
        if (Date.now() >= this.nextReminderScan) {
          const reminders = await this.reminders.createDue();
          this.nextReminderScan = Date.now() + 60_000;
          if (reminders.created) {
            this.logger.log({ event: 'notification_reminders', ...reminders });
          }
        }
        const result = await this.deliveries.processBatch();
        if (result.claimed) {
          this.logger.log({ event: 'notification_batch', ...result });
        }
        if (result.claimed === 100) continue;
      } catch (error) {
        this.logger.error(
          `notification worker error: ${error instanceof Error ? error.name : 'unknown'}`,
        );
      }
      if (!this.running) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.interval);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.wake = undefined;
    }
  }

  async onModuleDestroy() {
    this.running = false;
    this.wake?.();
    await this.loop;
  }
}
