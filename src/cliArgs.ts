/**
 * Shared, dependency-free argv parsing for this package's CLI entry points.
 * All commands use `--flag value` / `--flag` syntax so usage stays uniform
 * whether invoked locally or from a CI step.
 */

export function arg(name: string, fallback?: string): string {
  const value = optionalArg(name);
  if (value !== undefined) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required argument: --${name}`);
}

export function optionalArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] !== undefined ? process.argv[idx + 1] : undefined;
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
