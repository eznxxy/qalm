import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

/** docs/api-conventions.md § Security: bcrypt, cost >= 12. */
export const BCRYPT_COST = 12;

/** Password policy: >= 8 chars, at least one letter and one digit. */
export const PASSWORD_POLICY_MESSAGE =
  'must be at least 8 characters and contain at least one letter and one digit';

export function passwordMeetsPolicy(password: string): boolean {
  return (
    typeof password === 'string' &&
    password.length >= 8 &&
    /[a-zA-Z]/.test(password) &&
    /[0-9]/.test(password)
  );
}

/**
 * One-time-generated bcrypt hash of an unrelated pad string. Used as the
 * timing pad when an unknown email is presented, so response timing matches
 * the wrong-password path (conventions: byte-identical 401 behavior — this
 * covers the timing side). Not a secret and not a valid password hash of any
 * real account.
 */
export const TIMING_PAD_HASH = '$2b$12$srgjotc6qp0K0qgNedtR5.vS039t/pSKvvhrjQbK7v6VFgAZ5uOg2';

/**
 * Password hashing. Pure dependency-free service so tests can stub it and the
 * slow real hash is exercised only where intended (integration tests).
 */
@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_COST);
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  /** Constant-work pad for the unknown-email path (uniform 401s). */
  async timingDummy(): Promise<boolean> {
    return bcrypt.compare('definitely-not-the-password', TIMING_PAD_HASH);
  }
}
