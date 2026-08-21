# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A small TypeScript CLI that bootstraps a Salesforce **External Client App** (JWT bearer flow) via the Metadata API, using `@salesforce/core`. It replicates the same app definition — consistently — across multiple orgs (e.g. `demo-integration`, `demo-prod`) from one source of truth instead of clicking through Setup by hand.

It also bootstraps a classic **Connected App** the same way, via `setupConnectedApp.ts`/`cliConnectedApp.ts`. This is a separate app type on purpose, not a duplicate: Dev Hub scratch-org creation (`sf org create scratch`) only recognizes a classic Connected App as the OAuth client — External Client Apps aren't supported for that operation. The two pipelines share their Metadata API plumbing (`metadataUpsert.ts`, `certificateInput.ts`, `ensurePreAuthPermissionSet.ts`) but are otherwise independent — each app gets its own keypair, consumer key, and pre-authorized permission set.

## Skills

This repo spans three distinct domains — invoke the matching skill instead of freelancing:

- **Salesforce / Apex / Metadata API** (the `*App.ts` pipelines, permission sets, org auth, anything touching `@salesforce/core`) → `fullstack-dev-skills:salesforce-developer`
- **TypeScript type design** (the `SetupExternalAppOptions`/`SetupConnectedAppOptions` option shapes, the `MetadataApiType` casts in `metadataUpsert.ts`, discriminated unions like `CertificateInput`) → `fullstack-dev-skills:typescript-pro`
- **`.github/workflows/*.yml`** (the WIF logins, container jobs, artifact handoffs between jobs) → `ci-cd` for authoring or debugging a pipeline, `actions` for checking a run's status/logs

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
npm run setup-app -- --org <alias> --app-name <name> --preauth-username <user> [--cert-file <path>] [--oauth-scopes Api,RefreshToken,Web]
npm run setup-connected-app -- --org <alias> --app-name <name> --preauth-username <user> [--cert-file <path>] [--oauth-scopes Api,RefreshToken,Web]
npm run integration:test -- <username> <client-id> <key-dir> [instance-url]
npm run integration:test:scratch-org -- <username> <client-id> <key-dir> [instance-url]
npm run sync:secret -- --gcp-project-id <id> --gcp-secret-name <name> --username <u> --client-id <id> --key-file <path>
```

`setup-app` requires the target org to already be authenticated via the Salesforce CLI (`sf org login jwt|web`) — `getConnection.ts` only reads the session the `sf` CLI already cached, it does not perform its own auth exchange.

## Architecture

Independent pipelines that meet at a certificate and share a set of Metadata API helpers:

1. **`generateKeypair.ts`** — standalone. Shells out to system `openssl` (must be on `PATH`; not bundled) to produce a self-signed RSA keypair at `~/.sf-jwt/<envName>/{server.key,server.crt}`. Has no dependency on the rest of the codebase.
2. **`cli.ts` → `getConnection.ts` → `setupExternalApp.ts`** — the External Client App setup pipeline. `cli.ts` parses argv (via the shared `cliArgs.ts` helpers), resolves a `Connection` for the target org, then calls `setupExternalApp`, which idempotently creates-or-updates a chain of Metadata API components in this order: `ExternalClientApplication` → `ExtlClntAppOauthSettings` → `ExtlClntAppGlobalOauthSettings` (carries the certificate + callback URL) → a pre-auth `PermissionSet` (via `ensurePreAuthPermissionSet.ts`) → `ExtlClntAppOauthConfigurablePolicies` (wires the permission set as the pre-authorization policy). It finishes by reading back the auto-generated `consumerKey`.
3. **`cliConnectedApp.ts` → `getConnection.ts` → `setupConnectedApp.ts`** — the classic Connected App setup pipeline, structurally identical to #2 but simpler: a Connected App is one metadata object (`ConnectedApp`, with `oauthConfig.certificate`/`scopes`/`isAdminApproved` and a root-level `permissionSetName` array), so there's no multi-component chain — just `ensurePreAuthPermissionSet.ts` (the permission set must exist first, since the Connected App references it by name) then one `upsertMetadata` call. Consumer key resolves from `oauthConfig.consumerKey` instead of a flat field. Unlike the ECA types, `'ConnectedApp'` is already a real `@salesforce/core` `MetadataType` — no cast needed.
4. **Shared helpers**, used by both pipelines above:
   - `metadataUpsert.ts` — `MetadataApiType`, `upsertMetadata` (read → exists? → create : update for one component), plus `firstOrSelf`/`exists`/`assertSaved`.
   - `certificateInput.ts` — the `CertificateInput` discriminated union (`certPemPath` XOR `certPem`) and `resolveCertificatePem`.
   - `ensurePreAuthPermissionSet.ts` — creates the pre-auth `PermissionSet` if missing and assigns it to `preAuthUsername` if not already assigned. Both app types pre-authorize this same way.

`scripts/verify-login-container.sh` (wrapped by `npm run integration:test`) proves a generated keypair + consumer key actually work by running `sf org login jwt` inside a throwaway Docker container, never touching the host's `~/.sf` state. `scripts/verify-scratch-org-container.sh` (wrapped by `npm run integration:test:scratch-org`) does the same but for the Connected App specifically: logs in as Dev Hub, then actually runs `sf org create scratch` + `sf org delete scratch` against a checked-in `scripts/scratch-org-def.json` — proving the real capability, not just that login works.

5. **`syncGcpSecret.ts`** — also standalone. Adds a new version to an existing `salesforce-<env>` secret in GCP Secret Manager (project `gforce-salesforce-cicd`, provisioned by the sibling `gforce-google-infra` repo) — the JSON bundle shape is `{username, client_id, instance_url, jwt_key}` (`jwt_key` is raw PEM, not base64). Never creates the secret container itself — only `secretVersionAdder`, by design (see `.github/workflows/setup-external-app.yml`'s `gcp-secrets-admin` job).

### CI: `.github/workflows/setup-external-app.yml`

A `workflow_dispatch` pipeline that runs the whole bootstrap loop against a real org, end to end: log in via `shared-github-actions`' `sf-org-login` action (`credential-source: gcp`, reading the org's existing JWT credential from GCP Secret Manager over Direct Workload Identity Federation) → `generate:jwt` a fresh keypair → `setup-app` → `integration:test` → `sync:secret` to write the fresh keypair back. Three jobs, not one, because a job can only declare one GitHub `environment:` and the read (`devhub`/`integration`/`production` claim) and write (`gcp-secrets-admin` claim) steps need different WIF identities; the new private key crosses the job boundary as a 1-day-retention artifact. Needs this repo listed in `gforce-google-infra`'s WIF `trusted_repositories`, and the matching GitHub Environments + `GCP_WORKLOAD_IDENTITY_PROVIDER` repo variable already exist here.

### CI: `.github/workflows/setup-connected-app.yml`

The Connected App equivalent, devhub-only (no `resolve-env` job — there's only one environment to target) and purely additive: `setup` logs into devhub using the _existing_ `salesforce-devhub` secret read-only, generates a fresh keypair under its own `--env` (`devhub-connected-app`, so it never collides with the ECA's keypair), and runs `setup-connected-app`. `verify` proves the new key can create-and-delete a real scratch org, not just log in. `sync-secret` writes the result to a **new** secret, `salesforce-devhub-connected-app` — `salesforce-devhub` is never written to. That new secret container must be provisioned once in `gforce-google-infra` before the first run (same "never creates the container" rule as `syncGcpSecret.ts` above).

## Gotchas (non-obvious, has caused real failures)

- **The cert path default is derived from `--app-name`, not from `generate:jwt`'s `--env`.** `cli.ts` defaults `--cert-file` to `~/.sf-jwt/<app-name, lowercased>/server.crt`. If you generate a keypair under a different `--env` than the app name, `setup-app` silently uses whatever (possibly stale) cert already sits at the app-name-derived path instead of your new key. Always pass `--cert-file` explicitly unless `--env` and `--app-name` match exactly.
- **The printed `consumerKey=...` line is a label, not the value.** When passing it as the `client-id` arg to `integration:test`, strip the `consumerKey=` prefix — including it produces a "client identifier invalid" error from Salesforce.
- **`ExternalClientApplication` / `ExtlClntAppOauthSettings` / `ExtlClntAppGlobalOauthSettings` / `ExtlClntAppOauthConfigurablePolicies` aren't in `@salesforce/core`'s `MetadataType` union yet** (newer API objects, older SDK type defs). `setupExternalApp.ts` casts them once, up top, via the `MetadataApiType` alias from `metadataUpsert.ts` (derived from the real method signature) — reuse those constants rather than adding new raw string literals. `ConnectedApp` and `PermissionSet` are classic types already in the real union, so `setupConnectedApp.ts`/`ensurePreAuthPermissionSet.ts` pass them as plain string literals, no cast needed. Every metadata component in both pipelines follows the same read-then-create-or-update shape, funneled through one exported `upsertMetadata(connection, type, metadata)` helper in `metadataUpsert.ts` — reuse it for any new metadata type rather than hand-rolling another if/else.
- **Dev Hub scratch-org creation needs a classic Connected App, not an External Client App.** `sf org create scratch` only recognizes a classic Connected App as the Dev Hub's OAuth client — ECAs aren't supported for that operation (as of API 65.0 / current `sf` CLI). This is why `setupConnectedApp.ts` exists as a second, independent pipeline rather than folding into `setupExternalApp.ts`: don't try to make the ECA "just work" for scratch orgs, and don't merge the two into one metadata type — they're genuinely different Metadata API objects with different shapes.
- **`npm run typecheck` only covers `src/`** (via `tsconfig.build.json`), not `test/`. The test suite imports `@salesforce/core/testSetup`, a subpath export that classic (`moduleResolution: "node"`) resolution can't see; fixing it properly means migrating to `node16`/`nodenext`, which would force explicit `.js` extensions on every relative import repo-wide — a deliberately deferred, separate migration.
- **Certificates can be supplied as a path or a raw value** (`certPemPath` XOR `certPem` — a discriminated union, exactly one). `cli.ts` reads `SF_JWT_CERT_PEM` from the environment for the value form, useful when a secret manager injects the PEM directly in CI instead of writing it to disk.
- **OAuth scopes default to `Api,RefreshToken` but are configurable** via `oauthScopes` (`--oauth-scopes a,b,c` on both CLIs). Add `Web` when the integration needs a web session rather than pure API access. The two pipelines store this differently: `setupExternalApp.ts` joins it into `ExtlClntAppOauthSettings.commaSeparatedOauthScopes` (a comma-separated string); `setupConnectedApp.ts` passes it straight through as `ConnectedApp.oauthConfig.scopes` (a string array) — don't assume the shapes match when touching either.
