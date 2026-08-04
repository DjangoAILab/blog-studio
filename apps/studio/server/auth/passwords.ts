import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';

const FORMAT = 'blog-studio-scrypt-v1';
const KEY_LENGTH = 32;
const COST = 32_768;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const MAX_MEMORY = 64 * 1024 * 1024;
const MINIMUM_LENGTH = 12;
const MAXIMUM_UTF8_BYTES = 1024;

export class PasswordPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'PasswordPolicyError';
  }
}

export function validateOwnerPassword(password: string): void {
  if (password.length < MINIMUM_LENGTH) {
    throw new PasswordPolicyError(
      `Password must contain at least ${MINIMUM_LENGTH} characters`,
    );
  }
  if (Buffer.byteLength(password, 'utf8') > MAXIMUM_UTF8_BYTES) {
    throw new PasswordPolicyError(
      `Password must contain at most ${MAXIMUM_UTF8_BYTES} UTF-8 bytes`,
    );
  }
  if (password.trim().length === 0) {
    throw new PasswordPolicyError('Password must not contain only whitespace');
  }
  if (/\0/.test(password)) {
    throw new PasswordPolicyError('Password must not contain NUL characters');
  }
}

function derive(password: string, salt: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      {
        N: COST,
        r: BLOCK_SIZE,
        p: PARALLELIZATION,
        maxmem: MAX_MEMORY,
      },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

export async function hashOwnerPassword(password: string): Promise<string> {
  validateOwnerPassword(password);
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return [
    FORMAT,
    `N=${COST},r=${BLOCK_SIZE},p=${PARALLELIZATION}`,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyOwnerPassword(
  password: string,
  verifier: string,
): Promise<boolean> {
  const [format, parameters, encodedSalt, encodedKey, extra] =
    verifier.split('$');
  if (
    format !== FORMAT ||
    parameters !== `N=${COST},r=${BLOCK_SIZE},p=${PARALLELIZATION}` ||
    !encodedSalt ||
    !encodedKey ||
    extra !== undefined
  ) {
    return false;
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(encodedSalt, 'base64url');
    expected = Buffer.from(encodedKey, 'base64url');
  } catch {
    return false;
  }
  if (salt.byteLength !== 16 || expected.byteLength !== KEY_LENGTH)
    return false;
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected);
}
