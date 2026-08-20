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
npm run format              # prettier --write .
npm run format:check        # prettier --check . (also runs in CI and the pre-commit hook via lint-staged)

npm run generate:jwt -- --env <name> [--force] [--key-size 4096|2048] [--out-dir <path>]
npm run setup-app -- --org <alias> --app-name <name> --preauth-username <user> [--cert-file <path>]
npm run integration:test -- <username> <client-id> <key-dir> [instance-url]
npm run sync:secret -- --gcp-project-id <id> --gcp-secret-name <name> --username <u> --client-id <id> --key-file <path>
```

`setup-app` requires the target org to already be authenticated via the Salesforce CLI (`sf org login jwt|web`) — `getConnection.ts` only reads the session the `sf` CLI already cached, it does not perform its own auth exchange.

## Architecture

Two independent pipelines that meet at a certificate:

1. **`generateKeypair.ts`** — standalone. Shells out to system `openssl` (must be on `PATH`; not bundled) to produce a self-signed RSA keypair at `~/.sf-jwt/<envName>/{server.key,server.crt}`. Has no dependency on the rest of the codebase.
2. **`cli.ts` → `getConnection.ts` → `setupExternalApp.ts`** — the setup pipeline. `cli.ts` parses argv (via the shared `cliArgs.ts` helpers), resolves a `Connection` for the target org, then calls `setupExternalApp`, which idempotently creates-or-updates a chain of Metadata API components in this order: `ExternalClientApplication` → `ExtlClntAppOauthSettings` → `ExtlClntAppGlobalOauthSettings` (carries the certificate + callback URL) → a pre-auth `PermissionSet` → its `PermissionSetAssignment` to `preAuthUsername` → `ExtlClntAppOauthConfigurablePolicies` (wires the permission set as the pre-authorization policy). It finishes by reading back the auto-generated `consumerKey`.

`scripts/verify-login-container.sh` (wrapped by `npm run integration:test`) is a third, separate piece: it proves a generated keypair + the `consumerKey` from step 2 actually work by running `sf org login jwt` inside a throwaway Docker container, never touching the host's `~/.sf` state.

3. **`syncGcpSecret.ts`** — also standalone. Adds a new version to an existing `salesforce-<env>` secret in GCP Secret Manager (project `gforce-salesforce-cicd`, provisioned by the sibling `gforce-google-infra` repo) — the JSON bundle shape is `{username, client_id, instance_url, jwt_key}` (`jwt_key` is raw PEM, not base64). Never creates the secret container itself — only `secretVersionAdder`, by design (see `.github/workflows/setup-external-app.yml`'s `gcp-secrets-admin` job).

### CI: `.github/workflows/setup-external-app.yml`

A `workflow_dispatch` pipeline that runs the whole bootstrap loop against a real org, end to end: log in via `shared-github-actions`' `sf-org-login` action (`credential-source: gcp`, reading the org's existing JWT credential from GCP Secret Manager over Direct Workload Identity Federation) → `generate:jwt` a fresh keypair → `setup-app` → `integration:test` → `sync:secret` to write the fresh keypair back. Three jobs, not one, because a job can only declare one GitHub `environment:` and the read (`devhub`/`integration`/`production` claim) and write (`gcp-secrets-admin` claim) steps need different WIF identities; the new private key crosses the job boundary as a 1-day-retention artifact. Needs this repo listed in `gforce-google-infra`'s WIF `trusted_repositories`, and the matching GitHub Environments + `GCP_WORKLOAD_IDENTITY_PROVIDER` repo variable already exist here.

## Gotchas (non-obvious, has caused real failures)

- **The cert path default is derived from `--app-name`, not from `generate:jwt`'s `--env`.** `cli.ts` defaults `--cert-file` to `~/.sf-jwt/<app-name, lowercased>/server.crt`. If you generate a keypair under a different `--env` than the app name, `setup-app` silently uses whatever (possibly stale) cert already sits at the app-name-derived path instead of your new key. Always pass `--cert-file` explicitly unless `--env` and `--app-name` match exactly.
- **The printed `consumerKey=...` line is a label, not the value.** When passing it as the `client-id` arg to `integration:test`, strip the `consumerKey=` prefix — including it produces a "client identifier invalid" error from Salesforce.
- **`ExternalClientApplication` / `ExtlClntAppOauthSettings` / `ExtlClntAppGlobalOauthSettings` / `ExtlClntAppOauthConfigurablePolicies` aren't in `@salesforce/core`'s `MetadataType` union yet** (newer API objects, older SDK type defs). `setupExternalApp.ts` casts them once, up top, via a `MetadataApiType` alias derived from the real method signature — reuse those constants rather than adding new raw string literals. Each of these four components follows the same read-then-create-or-update shape, so `setupExternalApp.ts` funnels them through one exported `upsertMetadata(connection, type, metadata)` helper instead of repeating the branch per component — reuse it for any new metadata type added to the chain rather than hand-rolling another if/else.
- **`npm run typecheck` only covers `src/`** (via `tsconfig.build.json`), not `test/`. The test suite imports `@salesforce/core/testSetup`, a subpath export that classic (`moduleResolution: "node"`) resolution can't see; fixing it properly means migrating to `node16`/`nodenext`, which would force explicit `.js` extensions on every relative import repo-wide — a deliberately deferred, separate migration.
- **Certificates can be supplied as a path or a raw value** (`certPemPath` XOR `certPem` — a discriminated union, exactly one). `cli.ts` reads `SF_JWT_CERT_PEM` from the environment for the value form, useful when a secret manager injects the PEM directly in CI instead of writing it to disk.
