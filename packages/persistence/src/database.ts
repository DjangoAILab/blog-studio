import { DatabaseSync } from 'node:sqlite';

import { migrateStudioDatabase } from './migrations.js';

export type StudioDatabase = DatabaseSync;

export function openStudioDatabase(path: string): StudioDatabase {
  const database = new DatabaseSync(path, {
    enableForeignKeyConstraints: true,
    timeout: 5_000,
  });
  try {
    migrateStudioDatabase(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
