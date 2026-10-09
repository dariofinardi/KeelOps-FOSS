# `vendor/` — dependencies that are not on npm

Packages installed from a file inside the repository instead of from the registry.
It is not a shortcut: it is the only way to have **both** a correct version and
a deploy that does not depend on an external site.

## `xlsx-0.20.3.tgz` — SheetJS Community Edition

**Why not from npm.** SheetJS left the registry after **0.18.5**, which is
therefore the last version published there — and it carries two known
vulnerabilities that will never be fixed on npm:

| CVE            | What                              | Fixed in |
| -------------- | --------------------------------- | -------- |
| CVE-2023-30533 | prototype pollution in the parser | 0.19.3   |
| CVE-2024-22363 | ReDoS                             | 0.20.2   |

Later versions are distributed only from `https://cdn.sheetjs.com`.
Pointing `package.json` at that address would work, but `deploy.sh` runs
`pnpm install --frozen-lockfile` on every release: the day that site does not
answer, the deploy stops. That is why the file is here.

**License: Apache-2.0** (inside the package, `package/LICENSE`), like the
previous versions. Commercial use and closed-source software are allowed; the
obligation is to keep the copyright and license notice — the license file
travels inside the package.

**File fingerprint** (`sha256`), to compare against if it is ever downloaded again:

    8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8

Who uses it: `apps/web`, only to **read** spreadsheets in the attachment
preview (`features/attachments/AttachmentViewer.tsx`). Exports are written by
the server with `exceljs`, which is on npm and maintained.

## Updating it

```bash
curl -O https://cdn.sheetjs.com/xlsx-<versione>/xlsx-<versione>.tgz
tar -xzOf xlsx-<versione>.tgz package/package.json | grep '"license"'   # must be Apache-2.0
sha256sum xlsx-<versione>.tgz                                          # to be recorded above
mv xlsx-<versione>.tgz vendor/ && rm vendor/xlsx-0.20.3.tgz
pnpm --filter @kancrm/web add file:../../vendor/xlsx-<versione>.tgz
```

Then `pnpm check` and the real test: open the preview of an `.xlsx` from a task.
