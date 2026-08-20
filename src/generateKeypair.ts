import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { arg, flag, optionalArg } from './cliArgs';

/** RSA modulus sizes this module will generate. 4096 is the default for new keypairs. */
export type RsaKeySize = 2048 | 4096;

export interface CertificateSubject {
  commonName?: string;
  organization?: string;
  country?: string;
}

export interface GenerateKeypairOptions {
  /** Environment/app identifier used for the default output dir and cert CN. */
  envName: string;
  /** Defaults to `~/.sf-jwt/<envName>`. */
  outDir?: string;
  /** Defaults to 4096. */
  keySize?: RsaKeySize;
  /** Certificate validity in days. Defaults to 730. */
  validityDays?: number;
  /** Overwrite an existing keypair at outDir. Defaults to false. */
  force?: boolean;
  subject?: CertificateSubject;
}

export interface GenerateKeypairResult {
  keyPath: string;
  certPath: string;
  keySize: RsaKeySize;
}

const DEFAULT_KEY_SIZE: RsaKeySize = 4096;
const ALLOWED_KEY_SIZES: readonly RsaKeySize[] = [2048, 4096];
const DEFAULT_VALIDITY_DAYS = 730;
const DEFAULT_ORGANIZATION = 'GForce Innovation';
const DEFAULT_COUNTRY = 'ES';

/** Parses a CLI `--key-size` value, throwing if it isn't one of `ALLOWED_KEY_SIZES`. */
export function parseKeySize(value: string): RsaKeySize {
  const parsed = Number(value);
  if (!ALLOWED_KEY_SIZES.includes(parsed as RsaKeySize)) {
    throw new Error(`Invalid key size '${value}'. Allowed: ${ALLOWED_KEY_SIZES.join(', ')}.`);
  }
  return parsed as RsaKeySize;
}

function parsePositiveInt(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name} '${value}'. Must be a positive integer.`);
  }
  return parsed;
}

/**
 * Generates a self-signed RSA keypair for the JWT bearer flow by shelling out
 * to `openssl` — the only supported implementation, since both dev machines
 * and CI runners already carry it and it avoids adding a crypto dependency.
 * Fully non-interactive (`-nodes`, `-subj`), so behavior is identical locally
 * and in CI: no prompts, deterministic output, throws (never exits) on failure
 * so callers control the process exit code.
 */
export function generateKeypair(options: GenerateKeypairOptions): GenerateKeypairResult {
  const { envName } = options;
  if (!envName) {
    throw new Error('envName is required.');
  }

  const outDir = options.outDir ?? join(homedir(), '.sf-jwt', envName);
  const keySize = options.keySize ?? DEFAULT_KEY_SIZE;
  const validityDays = options.validityDays ?? DEFAULT_VALIDITY_DAYS;
  const force = options.force ?? false;
  const commonName = options.subject?.commonName ?? `${envName}.gforceinnovation.com`;
  const organization = options.subject?.organization ?? DEFAULT_ORGANIZATION;
  const country = options.subject?.country ?? DEFAULT_COUNTRY;

  const keyPath = join(outDir, 'server.key');
  const certPath = join(outDir, 'server.crt');

  if (existsSync(keyPath) && existsSync(certPath) && !force) {
    throw new Error(`Keypair already exists at ${outDir} (pass force: true to overwrite).`);
  }

  mkdirSync(outDir, { recursive: true, mode: 0o700 });

  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-newkey',
        `rsa:${keySize}`,
        '-nodes',
        '-keyout',
        keyPath,
        '-x509',
        '-days',
        String(validityDays),
        '-out',
        certPath,
        '-subj',
        `/CN=${commonName}/O=${organization}/C=${country}`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`openssl req failed: ${message}`);
  }

  chmodSync(keyPath, 0o600);
  chmodSync(certPath, 0o644);

  return { keyPath, certPath, keySize };
}

function main(): void {
  const envName = arg('env');
  const keySizeArg = optionalArg('key-size');
  const validityDaysArg = optionalArg('validity-days');

  const result = generateKeypair({
    envName,
    outDir: optionalArg('out-dir'),
    force: flag('force'),
    keySize: keySizeArg ? parseKeySize(keySizeArg) : undefined,
    validityDays: validityDaysArg ? parsePositiveInt('--validity-days', validityDaysArg) : undefined,
    subject: {
      commonName: optionalArg('common-name'),
      organization: optionalArg('org-name'),
      country: optionalArg('country'),
    },
  });

  console.log(`Generated ${result.keyPath} and ${result.certPath} (RSA ${result.keySize})`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
