import { createHash, randomBytes } from 'node:crypto';

import {
  OwnerNotInitializedError,
  type OwnerCredential,
  type SqliteOwnerCredentialRepository,
  type SqliteOwnerSessionRepository,
} from '@blog-studio/persistence';

import { hashOwnerPassword, verifyOwnerPassword } from './passwords.js';

export interface AuthenticatedOwnerSession {
  readonly token: string;
  readonly expiresAt: string;
  readonly credentialGeneration: number;
}

export class OwnerAuthenticationFailedError extends Error {
  public constructor() {
    super('Authentication failed');
    this.name = 'OwnerAuthenticationFailedError';
  }
}

export class OwnerSessionInvalidError extends Error {
  public constructor() {
    super('Owner session is invalid or expired');
    this.name = 'OwnerSessionInvalidError';
  }
}

export function hashOwnerSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export class OwnerAuthService {
  readonly #now: () => Date;
  readonly #sessionTtlMs: number;

  public constructor(
    private readonly credentials: SqliteOwnerCredentialRepository,
    private readonly sessions: SqliteOwnerSessionRepository,
    options: {
      readonly now?: () => Date;
      readonly sessionTtlMs?: number;
    } = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#sessionTtlMs = options.sessionTtlMs ?? 7 * 24 * 60 * 60_000;
    if (this.#sessionTtlMs < 60_000) {
      throw new Error('Owner session TTL must be at least one minute');
    }
  }

  public status(): {
    readonly initialized: boolean;
    readonly generation?: number;
  } {
    const credential = this.credentials.get();
    return credential
      ? { initialized: true, generation: credential.generation }
      : { initialized: false };
  }

  public async initialize(password: string): Promise<OwnerCredential> {
    const verifier = await hashOwnerPassword(password);
    return this.credentials.initialize(verifier, this.#now().toISOString());
  }

  public async login(password: string): Promise<AuthenticatedOwnerSession> {
    const credential = this.credentials.get();
    if (!credential) throw new OwnerNotInitializedError();
    if (!(await verifyOwnerPassword(password, credential.verifier))) {
      throw new OwnerAuthenticationFailedError();
    }
    return this.#createSession(credential.generation);
  }

  public validateSession(token: string): boolean {
    const at = this.#now().toISOString();
    const hash = hashOwnerSessionToken(token);
    const session = this.sessions.getValid(hash, at);
    if (!session) return false;
    this.sessions.touch(hash, at);
    return true;
  }

  public logout(token: string): boolean {
    return this.sessions.delete(hashOwnerSessionToken(token));
  }

  public async changePassword(input: {
    readonly sessionToken: string;
    readonly currentPassword: string;
    readonly newPassword: string;
  }): Promise<AuthenticatedOwnerSession> {
    if (!this.validateSession(input.sessionToken)) {
      throw new OwnerSessionInvalidError();
    }
    const credential = this.credentials.get();
    if (!credential) throw new OwnerNotInitializedError();
    if (
      !(await verifyOwnerPassword(input.currentPassword, credential.verifier))
    ) {
      throw new OwnerAuthenticationFailedError();
    }
    const verifier = await hashOwnerPassword(input.newPassword);
    const rotated = this.credentials.rotate({
      verifier,
      expectedGeneration: credential.generation,
      at: this.#now().toISOString(),
    });
    return this.#createSession(rotated.generation);
  }

  public async resetPassword(password: string): Promise<OwnerCredential> {
    const credential = this.credentials.get();
    if (!credential) throw new OwnerNotInitializedError();
    const verifier = await hashOwnerPassword(password);
    return this.credentials.rotate({
      verifier,
      expectedGeneration: credential.generation,
      at: this.#now().toISOString(),
    });
  }

  #createSession(generation: number): AuthenticatedOwnerSession {
    const token = randomBytes(32).toString('base64url');
    const created = this.#now();
    const expiresAt = new Date(
      created.getTime() + this.#sessionTtlMs,
    ).toISOString();
    this.sessions.create({
      tokenHash: hashOwnerSessionToken(token),
      credentialGeneration: generation,
      createdAt: created.toISOString(),
      expiresAt,
      lastSeenAt: created.toISOString(),
    });
    return { token, expiresAt, credentialGeneration: generation };
  }
}
