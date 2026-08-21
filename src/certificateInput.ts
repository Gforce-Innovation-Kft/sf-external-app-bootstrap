import { readFileSync } from 'node:fs';

/** Certificate is supplied as exactly one of a file path or its raw PEM content. */
export type CertificateInput =
  { certPemPath: string; certPem?: never } | { certPem: string; certPemPath?: never };

export function resolveCertificatePem(options: CertificateInput): string {
  if ('certPem' in options && options.certPem !== undefined) {
    return options.certPem;
  }
  if ('certPemPath' in options && options.certPemPath !== undefined) {
    return readFileSync(options.certPemPath, 'utf8');
  }
  throw new Error('Provide either certPem or certPemPath.');
}
