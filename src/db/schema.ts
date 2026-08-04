import { pgTable, serial, varchar, text } from 'drizzle-orm/pg-core';

export const muscles = pgTable('muscles', {
  id: serial('id').primaryKey(),
  commonName: varchar('common_name', { length: 255 }).notNull(),
  physiologicalName: varchar('physiological_name', { length: 255 }).notNull(),
});

export const exercises = pgTable('exercises', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
});
