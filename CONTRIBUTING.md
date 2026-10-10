# Contributing to KeelOps

Thank you for wanting to improve KeelOps. A few things to know before you open a
pull request.

## The licence, and the CLA

KeelOps community edition is free software under the **GNU Affero General Public
License v3.0** (see `LICENSE`). Jugaad s.r.l. also distributes a commercial
edition built on the same code.

To make that possible, every contributor signs the
**[Contributor License Agreement](CLA.md)** once. In short:

- you keep the copyright on your work;
- you give Jugaad a licence to use your contribution, in the community edition
  and in the commercial one;
- Jugaad promises that what it puts in the community edition stays available
  under the AGPL.

A bot asks you to sign on your first pull request: you reply with one sentence.
If you contribute for a company, the company signs too (see `CLA.md`, section 8, and `CLA-ORGANISATION.md`).

## Before you start

- **Open an issue first** for anything larger than a fix: KeelOps does few things
  on purpose, and a feature that does not fit is better discussed before it is
  written.
- Small, focused pull requests are reviewed faster than large ones.

## Working on the code

- Node ≥ 20 and pnpm. `pnpm install`, then `pnpm dev` (server on :3001, web on :5173).
- **`pnpm check` must be green** before you open the pull request: lint, types
  and tests of every package.
- TypeScript everywhere, `strict`. Every endpoint validates its input with a zod
  schema from `packages/shared`.
- Database changes come with a Prisma migration — for SQLite **and** MariaDB.
- Plugins go through the SDK (`plugins/keelops-sdk`): see its documentation.
- Commit messages in English: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`,
  with a body that explains why.

## How a pull request lands

This repository is the **published copy** of the community edition: KeelOps is
developed in one place, together with the commercial modules, and the community
tree is generated from it. So a pull request here is reviewed here, and once
accepted it is applied to the source repository **with you as the author** and
comes back in the next publication, usually within days. The commit you see on
`main` will say "Generated from the KeelOps repository": your name stays in the
commit's author field and in the pull request. It also means `main` moves in
bigger steps than one merge at a time; rebase on it before you open a pull
request.

## Reporting a security problem

Do not open a public issue: see `SECURITY.md`.
