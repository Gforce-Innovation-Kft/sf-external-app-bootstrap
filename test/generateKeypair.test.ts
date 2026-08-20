import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strictEqual, throws } from 'node:assert';
import { generateKeypair, parseKeySize } from '../src/generateKeypair';

describe('generateKeypair', () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'sf-jwt-test-'));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('generates a 4096-bit RSA keypair by default', function () {
    this.timeout(15000);
    const result = generateKeypair({ envName: 'unittest', outDir });

    strictEqual(result.keySize, 4096);
    strictEqual(existsSync(result.keyPath), true);
    strictEqual(existsSync(result.certPath), true);
    strictEqual(readFileSync(result.keyPath, 'utf8').includes('PRIVATE KEY'), true);
    strictEqual(readFileSync(result.certPath, 'utf8').includes('CERTIFICATE'), true);
  });

  it('throws when a keypair already exists and force is not set', function () {
    this.timeout(15000);
    generateKeypair({ envName: 'unittest', outDir });

    throws(() => generateKeypair({ envName: 'unittest', outDir }), /already exists/);
  });

  it('overwrites an existing keypair when force is true', function () {
    this.timeout(15000);
    generateKeypair({ envName: 'unittest', outDir, keySize: 2048 });

    const result = generateKeypair({ envName: 'unittest', outDir, keySize: 4096, force: true });
    strictEqual(result.keySize, 4096);
  });

  it('rejects unsupported key sizes', () => {
    throws(() => parseKeySize('1024'), /Invalid key size/);
  });
});
