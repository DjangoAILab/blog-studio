import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

if (process.argv[2] !== 'generate') process.exit(2);
await mkdir(join(process.cwd(), 'public', 'assets'), { recursive: true });
await writeFile(join(process.cwd(), 'public', 'index.html'), '<h1>built</h1>');
await writeFile(join(process.cwd(), 'public', 'assets', 'app.css'), 'body{}');
