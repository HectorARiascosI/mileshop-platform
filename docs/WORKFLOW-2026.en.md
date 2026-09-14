# Workflow 2026 for MileShop Platform

## 1. Objective

This document defines the professional engineering workflow for MileShop in 2026. The goal is to keep the repository auditable, reproducible, secure, and easy to troubleshoot.

## 2. Core principles

- no direct work on protected branches;
- every change has a clear scope;
- every PR must include risk and evidence;
- every release must be reversible;
- each service owns its data and boundary;
- architecture decisions must be explicit and documented.

## 3. Branch structure

```text
main
└── develop
    ├── feature/catalog-product-list
    ├── fix/gateway-timeout
    ├── release/2026.09.13
    └── hotfix/urgent-prod-fix
```

## 4. Branch policy

### Standard flow

- `main`: production branch, protected and deployable.
- `develop`: integration branch for validated features.
- `feature/*`: new functionality.
- `fix/*`: defect correction.
- `hotfix/*`: emergency production correction.
- `release/*`: final validation before production promotion.

Rules:

- never work directly on `main` or `develop`;
- use short-lived branches with a single purpose;
- all merges happen via pull request with review;
- production is promoted only from validated evidence.

## 5. PR requirements

Every PR must answer:

- what problem is being solved;
- what is the acceptance criteria;
- which services, contracts, or databases are affected;
- what migrations, backups, or rollback steps exist;
- which tests were executed;
- what risks remain after delivery.

Merge is allowed only if:

- CI is green;
- review is approved;
- no secrets or local artifacts are included;
- the scope remains disciplined and atomic.

## 6. Commit conventions

Use Conventional Commits:

```text
<type>(<scope>): <description>
```

Allowed types:

- `feat`
- `fix`
- `refactor`
- `test`
- `docs`
- `chore`
- `build`
- `ci`
- `perf`
- `revert`

Examples:

- `feat(catalog): expose active products endpoint`
- `fix(gateway): restore catalog timeout fallback`
- `docs(runtime): document local startup and health checks`
- `ci(repo): enforce quality gates on develop and main`

## 7. Required validation before merge

A branch is not ready for merge until all of the following pass:

```powershell
npm ci
npm run db:generate
npm run typecheck
npm run lint
npm run test
npm run build
npm audit --audit-level=high
docker compose -f infra/docker-compose.yml config
```

This should be run from the monorepo root, and any failing step blocks merge.

## 8. Release flow

```bash
git checkout develop
git pull --ff-only origin develop
git checkout -b release/2026.09.13
git push -u origin release/2026.09.13
```

The release branch is used for:

- final validation in a controlled context;
- smoke tests and health validation;
- rollback planning and evidence capture;
- production promotion with traceability.

## 9. Production promotion

```bash
git checkout main
git pull --ff-only origin main
git merge --no-ff release/2026.09.13
git push origin main
```

This process is only valid with review and verified release evidence.

## 10. Hotfix process

```bash
git checkout main
git pull --ff-only origin main
git checkout -b hotfix/gateway-catalog-timeout
git add .
git commit -m "fix(gateway): restore catalog timeout fallback"
git push -u origin hotfix/gateway-catalog-timeout
```

A hotfix must be minimal, proven, and later backported to `develop` when appropriate.

## 11. Operational maintainability

A professional repository must make it possible to answer the following without ambiguity:

- what changed;
- why it changed;
- how it was validated;
- how to rollback it;
- which part of the system owns the failure.

This is what distinguishes an ad hoc prototype from a production-grade engineering system.
