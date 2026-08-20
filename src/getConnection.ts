import { Connection, Org } from '@salesforce/core';

/**
 * Resolves a live Connection for an org already authenticated via the sf CLI
 * (e.g. `sf org login jwt` or `sf org login web`), by alias or username.
 * Does not perform its own auth exchange — it reads the session the CLI
 * already cached on disk.
 */
export async function getConnection(aliasOrUsername: string): Promise<Connection> {
  const org = await Org.create({ aliasOrUsername });
  return org.getConnection();
}
