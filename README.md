# sf-external-app-bootstrap

Bootstraps a Salesforce **External Client App** (JWT bearer flow) consistently across orgs via the Metadata API, using [`@salesforce/core`](https://github.com/salesforcecli/core). Define the app once, replicate it to as many orgs as you need, instead of clicking through Setup by hand each time.

It also bootstraps a classic **Connected App** for the same JWT flow — see [Connected App (for Dev Hub scratch orgs)](#connected-app-for-dev-hub-scratch-orgs) for why that's a separate app type, not a duplicate.

## Use cases

- **Bootstrap a new integration user in a sandbox or dev org.** `generate:jwt` + `setup-app` stands up an External Client App and pre-authorizes a service account in one command instead of clicking through Setup.
- **Replicate the same app definition across environments.** Run the same `setup-app` command against `demo-integration`, then `demo-prod` — one source of truth, no manual re-clicking per org, and re-running is always safe (everything is create-or-update).
- **Rotate a certificate before it expires, or after a suspected leak.** Regenerate the keypair under the same `--env`/`--app-name`, rerun `setup-app --cert-file <new-cert>` — the update path picks up the new certificate without deleting and recreating the app.
- **Unblock Dev Hub scratch-org creation.** If `sf org create scratch` fails against a Dev Hub whose JWT credential is an External Client App, bootstrap a companion classic Connected App with `setup-connected-app` instead — see [Connected App (for Dev Hub scratch orgs)](#connected-app-for-dev-hub-scratch-orgs).
- **Add a web-session scope for a browser-based OAuth flow.** Pass `--oauth-scopes Api,RefreshToken,Web` when the integration also needs Visualforce/Experience Cloud session access, not just API calls.
- **Automate credential rotation on a schedule instead of doing it by hand.** Trigger `setup-external-app.yml` / `setup-connected-app.yml` via `workflow_dispatch` (or add a `schedule:` trigger) to regenerate keys and sync them to GCP Secret Manager without touching the org UI — see [CI/CD](#cicd).

## Prerequisites

- Node.js (see `package.json` engines / your version manager)
- `openssl` on `PATH` (used to generate the JWT keypair)
- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) with the target org already authenticated (`sf org login jwt` or `sf org login web`) — this tool reads that cached session, it does not perform its own login
- Docker, only if you'll run `integration:test`

## Install

```bash
npm install
```

## Quick start

```bash
# 1. Generate a 4096-bit RSA keypair for the app
npm run generate:jwt -- --env my-app

# 2. Create (or update) the External Client App in an org and pre-authorize a user
npm run setup-app -- \
  --org my-org-alias \
  --app-name my-app \
  --preauth-username user@example.com

# 3. (optional) Verify the JWT login actually works, in a throwaway container
npm run integration:test -- \
  user@example.com \
  <consumerKey printed by step 2 — no "consumerKey=" prefix> \
  "$HOME/.sf-jwt/my-app" \
  https://login.salesforce.com
```

`--env` (step 1) and `--app-name` (step 2) should match, or the default certificate path won't line up — see `CLAUDE.md` for details. Use `--cert-file` on `setup-app` to point at a specific keypair explicitly.

## Connected App (for Dev Hub scratch orgs)

Dev Hub scratch-org creation (`sf org create scratch`) only recognizes a classic **Connected App** as the OAuth client — External Client Apps aren't supported for that operation. `setup-connected-app` bootstraps one the same way `setup-app` bootstraps an External Client App, so a devhub org can have both: the ECA for everything else, and this Connected App specifically to unblock scratch-org creation.

```bash
# 1. Generate a separate keypair — don't reuse the ECA's --env, they'd share a cert path
npm run generate:jwt -- --env my-app-connected

# 2. Create (or update) the Connected App and pre-authorize a user
npm run setup-connected-app -- \
  --org my-devhub-alias \
  --app-name my-app-connected \
  --preauth-username user@example.com

# 3. (optional) Verify the JWT login AND scratch-org creation work, in a throwaway container
npm run integration:test:scratch-org -- \
  user@example.com \
  <consumerKey printed by step 2 — no "consumerKey=" prefix> \
  "$HOME/.sf-jwt/my-app-connected" \
  https://login.salesforce.com
```

This is purely additive: it never touches an existing External Client App, its secrets, or its permission set — each app gets its own keypair, consumer key, and pre-authorized permission set.

## npm scripts

| Script                         | Does                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `generate:jwt`                 | Generates a self-signed RSA keypair (`src/generateKeypair.ts`)                                        |
| `setup-app`                    | Creates/updates the External Client App in an org (`src/cli.ts`)                                      |
| `setup-connected-app`          | Creates/updates the classic Connected App in an org (`src/cliConnectedApp.ts`)                        |
| `sync:secret`                  | Writes a keypair + org details to GCP Secret Manager (`src/syncGcpSecret.ts`)                         |
| `test`                         | Runs the mocha test suite                                                                             |
| `typecheck`                    | `tsc --noEmit` over `src/`                                                                            |
| `format`                       | `prettier --write .`                                                                                  |
| `format:check`                 | `prettier --check .` — also runs in CI and the pre-commit hook                                        |
| `integration:test`             | Runs `scripts/verify-login-container.sh` — verifies JWT login in a disposable Docker container        |
| `integration:test:scratch-org` | Runs `scripts/verify-scratch-org-container.sh` — verifies JWT login AND scratch-org creation/deletion |

## `generate:jwt` options

| Flag                                         | Default                                                   |
| -------------------------------------------- | --------------------------------------------------------- |
| `--env <name>`                               | _(required)_                                              |
| `--out-dir <path>`                           | `~/.sf-jwt/<env>`                                         |
| `--key-size <2048\|4096>`                    | `4096`                                                    |
| `--validity-days <n>`                        | `730`                                                     |
| `--force`                                    | overwrite an existing keypair                             |
| `--common-name` / `--org-name` / `--country` | `<env>.gforceinnovation.com` / `GForce Innovation` / `ES` |

## `setup-app` options

| Flag                            | Default                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `--org <alias>`                 | _(required)_                                                                                 |
| `--app-name <name>`             | `TestQA`                                                                                     |
| `--preauth-username <username>` | _(required)_ — no sensible default, org-specific                                             |
| `--cert-file <path>`            | `~/.sf-jwt/<app-name, lowercased>/server.crt`                                                |
| `--contact-email`               | `gabor.demeter@gforceinnovation.com`                                                         |
| `--permission-set <name>`       | `<app-name>_Preauthorized`                                                                   |
| `--oauth-scopes <a,b,c>`        | `Api,RefreshToken` — add `Web` when the integration needs a web session, not just API access |
| env `SF_JWT_CERT_PEM`           | if set, sends the certificate as a raw value instead of reading `--cert-file`                |

## `setup-connected-app` options

Same flags as `setup-app` (above) — `--org`, `--app-name`, `--preauth-username`, `--cert-file`, `--contact-email`, `--permission-set`, `--oauth-scopes`, env `SF_JWT_CERT_PEM` — pointed at `src/cliConnectedApp.ts` instead.

## CI/CD

Three GitHub Actions workflows automate this repo — see `CLAUDE.md` for the full job-by-job rationale.

**`CI`** (`.github/workflows/ci.yml`) runs on every push/PR to `main`: secret scan → format check → typecheck → unit tests. No Salesforce access required.

**`Setup External App`** (`.github/workflows/setup-external-app.yml`) is a `workflow_dispatch` pipeline — the CI equivalent of running the Quick start steps above by hand, plus a credential rotation at the end. Trigger it from the repo's Actions tab, or:

```bash
gh workflow run setup-external-app.yml \
  -f org-env=devhub \
  -f app-name=TestQA \
  -f preauth-username=user@example.com
```

| Step          | Does                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `resolve-env` | Maps `org-env` to a GitHub Environment (`devhub`/`integration`/`production`) and its `salesforce-<env>` GCP secret name                                                              |
| `setup`       | Logs in with the org's existing JWT credential (from GCP Secret Manager over Workload Identity Federation — no static secret in GitHub), generates a fresh keypair, runs `setup-app` |
| `verify`      | Proves the fresh key logs in, from a throwaway Docker container (`integration:test`)                                                                                                 |
| `sync-secret` | Runs only if `verify` passed — writes the fresh keypair + consumer key back to GCP Secret Manager as the new credential                                                              |

**One-time setup:** this repo must be listed in `gforce-google-infra`'s WIF `trusted_repositories`, and the GitHub Environments `devhub`/`integration`/`production`/`gcp-secrets-admin` must exist with the `GCP_WORKLOAD_IDENTITY_PROVIDER` repo variable set. Add required reviewers on `production` and `gcp-secrets-admin` if you want a human approval gate before a credential rotation lands.

**`Setup Connected App (Dev Hub)`** (`.github/workflows/setup-connected-app.yml`) is the same idea, scoped to devhub only, for the Connected App described above. It's purely additive: it reads the existing `salesforce-devhub` secret read-only (to authenticate the metadata call) and writes its own output to a **new**, separate secret — `salesforce-devhub` itself is never modified.

```bash
gh workflow run setup-connected-app.yml \
  -f app-name=TestQA-ScratchOrgAccess \
  -f preauth-username=user@example.com
```

| Step          | Does                                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup`       | Logs into devhub with the existing `salesforce-devhub` credential, generates a fresh keypair under its own `--env`, runs `setup-connected-app`  |
| `verify`      | Proves the fresh key can log in **and** create + delete a real scratch org (`integration:test:scratch-org`) — the actual capability being fixed |
| `sync-secret` | Runs only if `verify` passed — writes the fresh keypair + consumer key to the new `salesforce-devhub-connected-app` secret                      |

**One-time setup:** in addition to the prerequisites above, the `salesforce-devhub-connected-app` secret container must already exist in `gforce-google-infra` before this workflow's first run — `sync:secret` only adds versions to an existing secret, it never creates one.

## Architecture

See `CLAUDE.md` for the module layout, the Metadata API call sequence, and known gotchas.
