# Deployment policy for shtel7001/sh

This repository is a Vercel monorepo. The main goal is to avoid wasting the Hobby plan deployment quota.

## Required workflow

1. Do all iterative work on the `dev` branch.
2. Do not push repeated fix/test commits to `main`.
3. Batch UI, API, mobile, data-source, and bug fixes together on `dev`.
4. Validate source and behavior before updating `main`.
5. Move the finished result to `main` only once per completed user-requested revision.
6. After a `main` update, check whether Vercel Git auto-deployment already exists before creating any manual deployment.
7. Never call a forced/manual Vercel deployment when the same commit SHA already has an automatic deployment.
8. Prefer promoting an existing READY deployment over rebuilding it.
9. Preview deployments are intentionally disabled on linked Vercel projects. Do not re-enable them unless explicitly requested.
10. Affected-project deployments are enabled so projects with unrelated root-directory changes should be skipped.
11. The legacy Vercel project named `sh` is still used by older `sh-shtel-9338.vercel.app/...` pages. Do not delete or disconnect it without explicit approval.
12. If Vercel reports the free deployment quota is exhausted, do not retry deployments repeatedly. Keep changes on `dev` and wait for quota reset or use an explicitly approved alternative host.

## Practical rule

Default sequence: dev edits -> validation -> one final main update -> inspect Git auto-deployment -> use that deployment.

Avoid: main edit -> auto deploy -> manual deploy -> another main edit -> another deploy.