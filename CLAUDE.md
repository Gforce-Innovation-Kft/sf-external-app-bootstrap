# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A small TypeScript CLI that bootstraps a Salesforce **External Client App** (JWT bearer flow) via the Metadata API, using `@salesforce/core`. It replicates the same app definition — consistently — across multiple orgs (e.g. `demo-integration`, `demo-prod`) from one source of truth instead of clicking through Setup by hand.

## Commands

```bash
npm install                # install deps

npm test                   # run the full mocha suite (tsx-transpiled, no build step)
npx tsx node_modules/mocha/bin/mocha.js test/generateKeypair.test.ts   # single test file
npm test -- --grep "defaults label"                                   # single test by name

npm run typecheck          # tsc --noEmit, scoped to src/ only (see Gotchas)

npm run generate:jwt -- --env <name> [--force] [--key-size 4096|2048] [--out-dir <path>]
npm run setup-app -- --org <alias> --app-name <name> --preauth-username <user> [--cert-file <path>]
npm run integration:test -- <username> <client-id> <key-dir> [instance-url]
```

`setup-app` requires the target org to already be authenticated via the Salesforce CLI (`sf org login jwt|web`) — `getConnection.ts` only reads the session the `sf` CLI already cached, it does not perform its own auth exchange.

## Architecture

Two independent pipelines that meet at a certificate:

1. **`generateKeypair.ts`** — standalone. Shells out to system `openssl` (must be on `PATH`; not bundled) to produce a self-signed RSA keypair at `~/.sf-jwt/<envName>/{server.key,server.crt}`. Has no dependency on the rest of the codebase.
2. **`cli.ts` → `getConnection.ts` → `setupExternalApp.ts`** — the setup pipeline. `cli.ts` parses argv (via the shared `cliArgs.ts` helpers), resolves a `Connection` for the target org, then calls `setupExternalApp`, which idempotently creates-or-updates a chain of Metadata API components in this order: `ExternalClientApplication` → `ExtlClntAppOauthSettings` → `ExtlClntAppGlobalOauthSettings` (carries the certificate + callback URL) → a pre-auth `PermissionSet` → its `PermissionSetAssignment` to `preAuthUsername` → `ExtlClntAppOauthConfigurablePolicies` (wires the permission set as the pre-authorization policy). It finishes by reading back the auto-generated `consumerKey`.

`scripts/verify-login-container.sh` (wrapped by `npm run integration:test`) is a third, separate piece: it proves a generated keypair + the `consumerKey` from step 2 actually work by running `sf org login jwt` inside a throwaway Docker container, never touching the host's `~/.sf` state.

## Gotchas (non-obvious, has caused real failures)

- **The cert path default is derived from `--app-name`, not from `generate:jwt`'s `--env`.** `cli.ts` defaults `--cert-file` to `~/.sf-jwt/<app-name, lowercased>/server.crt`. If you generate a keypair under a different `--env` than the app name, `setup-app` silently uses whatever (possibly stale) cert already sits at the app-name-derived path instead of your new key. Always pass `--cert-file` explicitly unless `--env` and `--app-name` match exactly.
- **The printed `consumerKey=...` line is a label, not the value.** When passing it as the `client-id` arg to `integration:test`, strip the `consumerKey=` prefix — including it produces a "client identifier invalid" error from Salesforce.
- **`ExternalClientApplication` / `ExtlClntAppOauthSettings` / `ExtlClntAppGlobalOauthSettings` / `ExtlClntAppOauthConfigurablePolicies` aren't in `@salesforce/core`'s `MetadataType` union yet** (newer API objects, older SDK type defs). `setupExternalApp.ts` casts them once, up top, via a `MetadataApiType` alias derived from the real method signature — reuse those constants rather than adding new raw string literals.
- **`npm run typecheck` only covers `src/`** (via `tsconfig.build.json`), not `test/`. The test suite imports `@salesforce/core/testSetup`, a subpath export that classic (`moduleResolution: "node"`) resolution can't see; fixing it properly means migrating to `node16`/`nodenext`, which would force explicit `.js` extensions on every relative import repo-wide — a deliberately deferred, separate migration.
- **Certificates can be supplied as a path or a raw value** (`certPemPath` XOR `certPem` — a discriminated union, exactly one). `cli.ts` reads `SF_JWT_CERT_PEM` from the environment for the value form, useful when a secret manager injects the PEM directly in CI instead of writing it to disk.
