import { createHash, randomUUID } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { backup, type DatabaseSync } from 'node:sqlite';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { openStudioDatabase } from '@blog-studio/persistence';
import {
  PiTranscriptError,
  validatePiTranscript,
} from '@blog-studio/agent-runtime-pi';

const dataSetVersion = 1;
const databaseFilename = 'studio.sqlite';
const sessionsDirectoryName = 'agent-sessions';
const attachmentsDirectoryName = 'agent-attachments';
const manifestFilename = 'manifest.json';

interface AgentDataManifestFile {
  readonly path: string;
  readonly byteSize: number;
  readonly sha256: string;
}

interface AgentDataManifest {
  readonly version: 1;
  readonly createdAt: string;
  readonly files: readonly AgentDataManifestFile[];
}

interface AgentSessionDataRow {
  readonly transcript_key: string;
  readonly pi_session_id: string;
}

interface AgentAttachmentDataRow {
  readonly storage_key: string;
  readonly sha256: string;
}

export interface AgentOperationalDataPaths {
  readonly databasePath: string;
  readonly sessionDirectory: string;
  readonly attachmentDirectory: string;
}

export interface CreateAgentOperationalBackupInput {
  readonly database: DatabaseSync;
  readonly sessionDirectory: string;
  readonly attachmentDirectory: string;
  readonly destinationDirectory: string;
  readonly createdAt?: string;
}

export class AgentDataIntegrityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AgentDataIntegrityError';
  }
}

async function exists(path: string): Promise<boolean> {
  return await lstat(path)
    .then(() => true)
    .catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    });
}

function portable(path: string): string {
  return path.split(sep).join('/');
}

function dataPath(root: string, key: string): string {
  if (!key || isAbsolute(key)) {
    throw new AgentDataIntegrityError(`Unsafe Agent data key: ${key}`);
  }
  const path = resolve(root, key);
  const fromRoot = relative(root, path);
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new AgentDataIntegrityError(`Unsafe Agent data key: ${key}`);
  }
  return path;
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function copyDirectoryOrCreate(source: string, destination: string) {
  if (await exists(source)) {
    const metadata = await lstat(source);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new AgentDataIntegrityError(`${source} must be a real directory`);
    }
    await cp(source, destination, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
  } else {
    await mkdir(destination, { recursive: true });
  }
}

async function filesBelow(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new AgentDataIntegrityError(
        `Agent data cannot contain symlinks: ${path}`,
      );
    }
    if (entry.isDirectory()) files.push(...(await filesBelow(root, path)));
    else if (entry.isFile()) files.push(portable(relative(root, path)));
    else
      throw new AgentDataIntegrityError(
        `Unsupported Agent data entry: ${path}`,
      );
  }
  return files.sort();
}

async function createManifest(
  root: string,
  createdAt: string,
): Promise<AgentDataManifest> {
  const paths = (await filesBelow(root)).filter(
    (path) => path !== manifestFilename,
  );
  return {
    version: dataSetVersion,
    createdAt,
    files: await Promise.all(
      paths.map(async (path) => {
        const absolutePath = dataPath(root, path);
        const metadata = await lstat(absolutePath);
        return {
          path,
          byteSize: metadata.size,
          sha256: await sha256(absolutePath),
        };
      }),
    ),
  };
}

function parseManifest(value: unknown): AgentDataManifest {
  if (
    value === null ||
    typeof value !== 'object' ||
    (value as { version?: unknown }).version !== dataSetVersion ||
    typeof (value as { createdAt?: unknown }).createdAt !== 'string' ||
    !Array.isArray((value as { files?: unknown }).files)
  ) {
    throw new AgentDataIntegrityError(
      'Agent backup manifest is invalid or incompatible',
    );
  }
  const manifest = value as AgentDataManifest;
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file.path !== 'string' ||
      !Number.isSafeInteger(file.byteSize) ||
      file.byteSize < 0 ||
      typeof file.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(file.sha256)
    ) {
      throw new AgentDataIntegrityError(
        'Agent backup manifest file entry is invalid',
      );
    }
  }
  return manifest;
}

async function verifyManifest(root: string): Promise<AgentDataManifest> {
  let manifest: AgentDataManifest;
  try {
    manifest = parseManifest(
      JSON.parse(await readFile(join(root, manifestFilename), 'utf8')),
    );
  } catch (error) {
    if (error instanceof AgentDataIntegrityError) throw error;
    throw new AgentDataIntegrityError(
      'Agent backup manifest is missing or unreadable',
    );
  }
  const actualFiles = (await filesBelow(root)).filter(
    (path) => path !== manifestFilename,
  );
  const expectedFiles = manifest.files.map((file) => file.path).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new AgentDataIntegrityError(
      'Agent backup file set does not match its manifest',
    );
  }
  for (const file of manifest.files) {
    const path = dataPath(root, file.path);
    const metadata = await lstat(path);
    if (
      metadata.size !== file.byteSize ||
      (await sha256(path)) !== file.sha256
    ) {
      throw new AgentDataIntegrityError(
        `Agent backup checksum mismatch: ${file.path}`,
      );
    }
  }
  return manifest;
}

function paths(root: string): AgentOperationalDataPaths {
  return {
    databasePath: join(root, databaseFilename),
    sessionDirectory: join(root, sessionsDirectoryName),
    attachmentDirectory: join(root, attachmentsDirectoryName),
  };
}

export async function verifyAgentOperationalData(
  data: AgentOperationalDataPaths,
): Promise<void> {
  const database = openStudioDatabase(data.databasePath);
  try {
    const integrity = database.prepare('PRAGMA integrity_check').get() as {
      readonly integrity_check: string;
    };
    if (integrity.integrity_check !== 'ok') {
      throw new AgentDataIntegrityError('Studio SQLite integrity check failed');
    }
    const sessions = database
      .prepare(
        'SELECT transcript_key, pi_session_id FROM agent_sessions ORDER BY transcript_key',
      )
      .all() as unknown as AgentSessionDataRow[];
    const referencedTranscripts = new Set<string>();
    for (const session of sessions) {
      const path = dataPath(data.sessionDirectory, session.transcript_key);
      referencedTranscripts.add(
        portable(relative(data.sessionDirectory, path)),
      );
      try {
        const identity = await validatePiTranscript(path);
        if (identity.sessionId !== session.pi_session_id) {
          throw new AgentDataIntegrityError(
            `Pi transcript identity mismatch: ${session.transcript_key}`,
          );
        }
      } catch (error) {
        if (error instanceof AgentDataIntegrityError) throw error;
        if (error instanceof PiTranscriptError) {
          throw new AgentDataIntegrityError(
            `Pi transcript is ${error.problem}: ${session.transcript_key}`,
          );
        }
        throw error;
      }
    }
    const transcriptFiles = (await filesBelow(data.sessionDirectory)).filter(
      (path) => path.endsWith('.jsonl'),
    );
    const orphan = transcriptFiles.find(
      (path) => !referencedTranscripts.has(path),
    );
    if (orphan)
      throw new AgentDataIntegrityError(`Pi transcript is orphaned: ${orphan}`);

    const attachments = database
      .prepare(
        'SELECT storage_key, sha256 FROM agent_attachments ORDER BY storage_key',
      )
      .all() as unknown as AgentAttachmentDataRow[];
    for (const attachment of attachments) {
      const path = dataPath(data.attachmentDirectory, attachment.storage_key);
      if (!(await exists(path))) {
        throw new AgentDataIntegrityError(
          `Agent attachment is missing: ${attachment.storage_key}`,
        );
      }
      if ((await sha256(path)) !== attachment.sha256) {
        throw new AgentDataIntegrityError(
          `Agent attachment checksum mismatch: ${attachment.storage_key}`,
        );
      }
    }
  } finally {
    database.close();
  }
}

export async function createAgentOperationalBackup(
  input: CreateAgentOperationalBackupInput,
): Promise<AgentOperationalDataPaths> {
  if (await exists(input.destinationDirectory)) {
    throw new AgentDataIntegrityError(
      'Agent backup destination already exists',
    );
  }
  const staging = `${input.destinationDirectory}.partial-${randomUUID()}`;
  await mkdir(dirname(input.destinationDirectory), { recursive: true });
  await mkdir(staging);
  const target = paths(staging);
  try {
    await backup(input.database, target.databasePath);
    await copyDirectoryOrCreate(
      input.sessionDirectory,
      target.sessionDirectory,
    );
    await copyDirectoryOrCreate(
      input.attachmentDirectory,
      target.attachmentDirectory,
    );
    const manifest = await createManifest(
      staging,
      input.createdAt ?? new Date().toISOString(),
    );
    await writeFile(
      join(staging, manifestFilename),
      `${JSON.stringify(manifest, null, 2)}\n`,
      {
        flag: 'wx',
        mode: 0o600,
      },
    );
    await rename(staging, input.destinationDirectory);
    return paths(input.destinationDirectory);
  } catch (error) {
    await rm(staging, { force: true, recursive: true });
    throw error;
  }
}

export async function restoreAgentOperationalBackup(input: {
  readonly backupDirectory: string;
  readonly destinationDirectory: string;
}): Promise<AgentOperationalDataPaths> {
  if (await exists(input.destinationDirectory)) {
    throw new AgentDataIntegrityError(
      'Agent restore destination already exists',
    );
  }
  await verifyManifest(input.backupDirectory);
  const staging = `${input.destinationDirectory}.partial-${randomUUID()}`;
  try {
    await cp(input.backupDirectory, staging, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    const restored = paths(staging);
    await verifyAgentOperationalData(restored);
    await rename(staging, input.destinationDirectory);
    return paths(input.destinationDirectory);
  } catch (error) {
    await rm(staging, { force: true, recursive: true });
    throw error;
  }
}
