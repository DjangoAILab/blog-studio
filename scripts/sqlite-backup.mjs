import { chmod, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';

const [sourceArgument, destinationArgument] = process.argv.slice(2);
if (!sourceArgument || !destinationArgument) {
  throw new Error('Usage: sqlite-backup.mjs <source> <destination>');
}
const sourcePath = resolve(sourceArgument);
const destinationPath = resolve(destinationArgument);
if (sourcePath === destinationPath) {
  throw new Error('SQLite backup destination must differ from the source');
}
await mkdir(dirname(destinationPath), { recursive: true });
const database = new DatabaseSync(sourcePath, {
  readOnly: true,
  timeout: 5_000,
});
try {
  await backup(database, destinationPath, { rate: 64 });
} finally {
  database.close();
}
await chmod(destinationPath, 0o600);
