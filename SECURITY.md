# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Write to
**[security contact address to be defined]** with:

- what you found and where (file, route, version — the version is in the app's
  Help page and in `packages/shared/src/version.ts`);
- how to reproduce it, or a proof of concept;
- what an attacker could do with it.

We answer within five working days, tell you when a fix is planned, and credit
you in the release notes unless you prefer otherwise. Please give us a reasonable
time to release the fix before making the problem public.

## Supported versions

Only the latest release receives security fixes. KeelOps is released often and
the database moves forward with every release: update rather than patching an old
copy.

## What is in scope

The KeelOps server and web application in this repository, and the free plugins
in `plugins/` (`Personale`, `TasksMap`, `mcp`) together with the plugin SDK.
Vulnerabilities in third-party dependencies should be reported upstream; tell us
too if KeelOps is affected in a way that needs a change here.

## Hardening an installation

- Serve KeelOps only over HTTPS, behind a reverse proxy: session cookies are
  `Secure`, and the server sends HSTS and a strict Content Security Policy.
- Keep the `.env`, the password pepper file (`PASSWORD_PEPPER_FILE`) and `data/`
  outside the folder you update, readable only by the service user.
- Give the database user rights on the KeelOps database only.
- Keep administrators few: an administrator works with normal rights until they
  ask for a time-limited elevation.
