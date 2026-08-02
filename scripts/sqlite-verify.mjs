import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [sourceArgument] = process.argv.slice(2);
if (!sourceArgument) throw new Error('Usage: sqlite-verify.mjs <database>');
const database = new DatabaseSync(resolve(sourceArgument), {
  readOnly: true,
  timeout: 5_000,
});
try {
  const result = database.prepare('PRAGMA integrity_check').get();
  if (!result || Object.values(result)[0] !== 'ok') {
    throw new Error(`SQLite integrity check failed: ${JSON.stringify(result)}`);
  }
} finally {
  database.close();
}
