# sf-external-app-bootstrap

Bootstraps a Salesforce **External Client App** (JWT bearer flow) consistently across orgs via the Metadata API, using [`@salesforce/core`](https://github.com/salesforcecli/core). Define the app once, replicate it to as many orgs as you need, instead of clicking through Setup by hand each time.

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

## npm scripts

| Script             | Does                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `generate:jwt`     | Generates a self-signed RSA keypair (`src/generateKeypair.ts`)                                 |
| `setup-app`        | Creates/updates the External Client App in an org (`src/cli.ts`)                               |
| `sync:secret`      | Writes a keypair + org details to GCP Secret Manager (`src/syncGcpSecret.ts`)                  |
| `test`             | Runs the mocha test suite                                                                      |
| `typecheck`        | `tsc --noEmit` over `src/`                                                                     |
| `format`           | `prettier --write .`                                                                           |
| `format:check`     | `prettier --check .` — also runs in CI and the pre-commit hook                                 |
| `integration:test` | Runs `scripts/verify-login-container.sh` — verifies JWT login in a disposable Docker container |

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

| Flag                            | Default                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `--org <alias>`                 | _(required)_                                                                  |
| `--app-name <name>`             | `TestQA`                                                                      |
| `--preauth-username <username>` | _(required)_ — no sensible default, org-specific                              |
| `--cert-file <path>`            | `~/.sf-jwt/<app-name, lowercased>/server.crt`                                 |
| `--contact-email`               | `gabor.demeter@gforceinnovation.com`                                          |
| `--permission-set <name>`       | `<app-name>_Preauthorized`                                                    |
| env `SF_JWT_CERT_PEM`           | if set, sends the certificate as a raw value instead of reading `--cert-file` |

## CI/CD

Two GitHub Actions workflows automate this repo — see `CLAUDE.md` for the full job-by-job rationale.

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

## Architecture

See `CLAUDE.md` for the module layout, the Metadata API call sequence, and known gotchas.
