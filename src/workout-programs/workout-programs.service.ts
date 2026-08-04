import { Injectable } from '@nestjs/common';
import { count } from 'drizzle-orm';
import { db } from '../db/drizzle';
import { muscles } from '../db/schema';

@Injectable()
export class WorkoutProgramsService {
  async getHello(): Promise<string> {
    const result = await db.select({ count: count() }).from(muscles);
    return String(result[0]?.count ?? 0);
  }
}
