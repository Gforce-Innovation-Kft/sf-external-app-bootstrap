---
name: gforce-google-cloud
description: >
  GForce Google Cloud house rules: the folder and project map, naming, which identity each caller
  uses, how changes reach the cloud, and the spending limits.
  TRIGGER when: creating, deploying to, debugging, granting access in, or estimating cost for any
  GForce Google Cloud project (gforce-shared-platform, gforce-shared-credentials,
  gforce-playground, gforce-production), or writing Terraform or a GitHub workflow that touches
  Google Cloud.
  DO NOT TRIGGER when: the work is the Raspberry Pi homelab or a personal project, or it is only
  Google Workspace administration (use gforce-google-workspace).
version: 1.1.0
tags: [google-cloud, gcp, terraform, iam, finops, gforce]
---

# GForce Google Cloud Standard

Source of truth: the private repo `Gforce-Innovation-Kft/gforce-google-cloud`, its design spec in
`docs/superpowers/specs/` and its Terraform. Concrete IDs (organization, billing account, project
numbers) live there, never in this public skill. Read the spec before changing structure or access.

## The map

| Folder     | Project                     | Holds                                                                                  | Budget                                      |
| ---------- | --------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------- |
| Shared     | `gforce-shared-platform`    | Shared Docker registry, Terraform state, the GitHub trust, billing export, kill switch | $5/month, email                             |
| Shared     | `gforce-shared-credentials` | Secrets only                                                                           | (Shared)                                    |
| Playground | `gforce-playground`         | Agents, experiments, anything new                                                      | $20/month, **billing disconnected at 100%** |
| Production | `gforce-production`         | Only what must keep running                                                            | $10/month, email                            |

One region: `europe-west1`. Names: service account `<workload>-<component>`, secret
`<system>-<purpose>`, labels `environment`, `workload`, `repository`, `managed-by` on everything
(`managed-by` is the tool that last deploys it: `terraform` or `github-actions`). Shared registry:
`europe-west1-docker.pkg.dev/gforce-shared-platform/containers/<image>`.

## Which identity are you?

| Caller                     | Identity                                                                                     | Rights                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Claude Code on Gabor's Mac | `claude-reader@gforce-shared-platform`, gcloud profile `claude`                              | Read only. No secret values, no Terraform state                                   |
| Claude agent job           | `agent-runner@gforce-playground`                                                             | Playground only                                                                   |
| GitHub Actions             | The repository itself (`principalSet://…/attribute.repository/Gforce-Innovation-Kft/<repo>`) | Playground deploy; Production only from `main` through the shared deploy workflow |
| Terraform apply            | `terraform-deployer@gforce-shared-platform`, impersonated by Gabor on his Mac                | Everything structural                                                             |
| A running service          | Its own service account in its own environment's project                                     | The single secret, topic or bucket it uses                                        |

## Hard stops

- **You never change Shared or Production yourself, emergencies included.** Diagnose read-only,
  then give Gabor the exact command and the matching Terraform diff. He runs the command; you open
  the PR that codifies it. Your identity cannot write there, so attempting it only loses time.
- Never create, download or store a service account key.
- Never grant `roles/viewer`, `roles/editor` or `roles/owner`. Viewer reads bucket objects, and the
  Terraform state holds secrets.
- Changes reach main only through a pull request; never push to main, even when asked to "just
  push". GitHub Free gives these private repositories no branch protection, so this rule is the guard.
- Plan first, then apply: run `terraform plan -out=<root>.tfplan`, show Gabor what it adds, changes
  and destroys, and apply only that saved plan, only after he says so. `terraform apply` runs only
  on Gabor's Mac. CI runs fmt, validate and a read-only plan.
- IAM members come from `gforceinnovation.com` only. A `gmail.com` account is refused by policy;
  don't propose an exception.
- No Playground ↔ Production grants, in either direction.

| Thought                                                | Reality                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| "Production is losing data, faster if I fix it myself" | The fastest path is the one command Gabor can paste. Give it in your first reply.           |
| "It's one narrow binding, that's safe"                 | Narrow or not, it's a manual Production change. Gabor runs it, then it goes into Terraform. |
| "CI applying Terraform is standard practice"           | Not here. Apply is local after a reviewed plan.                                             |

## Adding a service: every line is required

1. Terraform in `environments/playground` (or `production`): a service account named after the
   workload; a grant on the **single** secret in `gforce-shared-credentials`; `run.developer` and
   `iam.serviceAccountUser` for the repository's `principalSet`.
2. No new identity pool, provider, deploy service account or registry. Use the existing GitHub trust
   and push to the shared `containers` registry. The repository's `principalSet` needs
   `artifactregistry.writer` on that registry: a change in the `shared` root, so Gabor applies it.
3. Deploy flags: `--region=europe-west1`, an explicit `--service-account`, the four labels, and a
   pinned secret version in Production. A service also gets `--min-instances=0` and
   `--max-instances=<1-3>`; a job gets `--task-timeout`, `--tasks` and `--max-retries` instead.
4. Gabor reviews the plan and applies it.

## Money

- Before adding anything that runs all the time (Cloud SQL ~$10, load balancer ~$18, Cloud NAT
  ~$32, VMs, GKE, static IPs), stop and ask. It would consume a whole budget.
- Exact spend: the BigQuery billing export in `gforce-shared-platform`.
- If Playground stops at once, the kill switch probably fired. Say so; never relink billing yourself.

## Upstream skills

Use `google/skills` for depth (foundation-builder, waf-security, waf-cost-optimization,
recipe-auth, cloud-run-basics). GForce wins on conflict:

- foundation-builder's self-granting of admin roles → Terraform only, applied by Gabor.
- foundation-builder's four-folder layout → the map above.
- Multi-region and high-availability defaults → one region, scale to zero.

Read `.claude/references/local-standards.md` in the consuming repo last. It wins on conflict,
except the non-overridable core in `standards/invariants.md`.
