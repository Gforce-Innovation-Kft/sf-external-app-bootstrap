/**
 * Shared, dependency-free argv parsing for this package's CLI entry points.
 * All commands use `--flag value` / `--flag` syntax so usage stays uniform
 * whether invoked locally or from a CI step.
 */

/** Reads `--name value` from argv; throws if absent and no `fallback` is given. */
export function arg(name: string, fallback?: string): string {
  const value = optionalArg(name);
  if (value !== undefined) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required argument: --${name}`);
}

/** Reads `--name value` from argv, or `undefined` if absent. */
export function optionalArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] !== undefined ? process.argv[idx + 1] : undefined;
}

/** Whether the valueless `--name` switch is present in argv. */
export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
