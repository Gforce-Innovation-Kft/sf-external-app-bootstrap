# Google Cloud migration

On 2026-11-10 GForce Google Cloud moved into a Terraform-managed landing zone
(`gforce-google-cloud`). The old projects `claude-integration-501116`, `gforce-salesforce-cicd`,
`gforce-sf-platform` and `gen-lang-client-0257489838` are shutting down, and `gforce-google-infra`
is being deleted. The shutdown leaves a 30-day undelete window. This repo reads and writes its
Salesforce JWT secrets in `gforce-salesforce-cicd`, so its two workflows stop working at shutdown.

## What this repo touches

| Item                                     | File in this repo                                                                       | Old location                                                      | New target                                                           | Breaks at shutdown |
| ---------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------ |
| Secret project `GCP_PROJECT_ID`          | `.github/workflows/setup-external-app.yml`, `.github/workflows/setup-connected-app.yml` | `gforce-salesforce-cicd`                                          | `gforce-shared-credentials`                                          | Yes                |
| Workload Identity provider (variable)    | both workflows (`vars.GCP_WORKLOAD_IDENTITY_PROVIDER`)                                  | pool `github-pool`, provider `github-provider`                    | pool `github` in `gforce-shared-platform`, provider `github-actions` | Yes                |
| Secret `salesforce-devhub`               | `setup-external-app.yml` (`devhub`), `setup-connected-app.yml` (read-only)              | `gforce-salesforce-cicd`                                          | `gforce-shared-credentials` `salesforce-devhub-jwt`                  | Yes                |
| Secret `salesforce-integration`          | `setup-external-app.yml` (`integration`)                                                | `gforce-salesforce-cicd`                                          | `gforce-shared-credentials` `salesforce-integration-jwt`             | Yes                |
| Secret `salesforce-demo-prod`            | `setup-external-app.yml` (`demo-prod`)                                                  | `gforce-salesforce-cicd`                                          | `gforce-shared-credentials` `salesforce-demo-production-jwt`         | Yes                |
| Secret `salesforce-devhub-connected-app` | `setup-connected-app.yml` (write)                                                       | `gforce-salesforce-cicd`, container made by `gforce-google-infra` | not in the inventory; needs a decision                               | Yes                |
| Secret writes (`syncGcpSecret.ts`)       | `src/syncGcpSecret.ts`, `test/syncGcpSecret.test.ts` (fixtures use the old names)       | `gforce-salesforce-cicd`                                          | `gforce-shared-credentials`                                          | Fixtures only      |
| Trust for this repo                      | WIF `trusted_repositories` in `gforce-google-infra`                                     | provider `github-provider` (retiring)                             | `principalSet` grant for this repo in the `shared` root              | Yes                |

## What to change in this repo

- [ ] Set repository variable `GCP_WORKLOAD_IDENTITY_PROVIDER` to the `shared` output
      `workload_identity_provider` of `gforce-google-cloud`. Never write the value or the project
      number into a file.
- [ ] Ask for this repo's `principalSet` grant in the `shared` root, including write access to the
      secrets that `sync:secret` updates (the `gcp-secrets-admin` job needs `secretVersionAdder`).
- [ ] Set `GCP_PROJECT_ID` to `gforce-shared-credentials` in both workflows.
- [ ] Replace the `salesforce-${{ inputs.org-env }}` secret-name mapping in `resolve-env` with an
      explicit one: `devhub` to `salesforce-devhub-jwt`, `integration` to
      `salesforce-integration-jwt`, `demo-prod` to `salesforce-demo-production-jwt`.
- [ ] Decide the new name and container for `salesforce-devhub-connected-app` (it is not in the
      inventory), and create it in `gforce-google-cloud` before the first run.
- [ ] Check whether the new provider still requires the job `environment:` claims (`devhub`,
      `integration`, `production`, `gcp-secrets-admin`). The workflows rely on that claim today.
- [ ] Update the old names in `test/syncGcpSecret.test.ts`, `src/syncGcpSecret.ts` comments, and
      the `README.md` and `CLAUDE.md` text that points at `gforce-google-infra`.
- [ ] Confirm the values are in the new containers (raw PEM `jwt_key`) before switching.

Inventory: [plan-2-inventory PR](https://github.com/Gforce-Innovation-Kft/gforce-google-cloud/pull/7).
