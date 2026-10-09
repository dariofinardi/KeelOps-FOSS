# `vendor/` — dipendenze che non stanno su npm

Pacchetti installati da un file dentro il repository invece che dal registry.
Non è una scorciatoia: è l'unico modo di avere **insieme** una versione corretta
e un deploy che non dipende da un sito esterno.

## `xlsx-0.20.3.tgz` — SheetJS Community Edition

**Perché non da npm.** SheetJS ha lasciato il registry dopo la **0.18.5**, che è
quindi l'ultima pubblicata lì — e porta due vulnerabilità note che su npm non
verranno mai corrette:

| CVE | Cosa | Corretta in |
|---|---|---|
| CVE-2023-30533 | prototype pollution nel parser | 0.19.3 |
| CVE-2024-22363 | ReDoS | 0.20.2 |

Le versioni successive si distribuiscono solo da `https://cdn.sheetjs.com`.
Puntare il `package.json` a quell'indirizzo funzionerebbe, ma `deploy.sh` lancia
`pnpm install --frozen-lockfile` a ogni pubblicazione: il giorno che quel sito
non risponde, il deploy si ferma. Il file sta qui per questo.

**Licenza: Apache-2.0** (nel pacchetto, `package/LICENSE`), come le versioni
precedenti. Uso commerciale e software chiuso ammessi; l'obbligo è conservare
avviso di copyright e licenza — il file di licenza viaggia dentro il pacchetto.

**Impronta del file** (`sha256`), da confrontare se un giorno lo si riscarica:

    8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8

Chi lo usa: `apps/web`, solo per **leggere** i fogli nell'anteprima degli
allegati (`features/attachments/AttachmentViewer.tsx`). Gli export li scrive il
server con `exceljs`, che invece su npm c'è ed è mantenuto.

## Aggiornarlo

```bash
curl -O https://cdn.sheetjs.com/xlsx-<versione>/xlsx-<versione>.tgz
tar -xzOf xlsx-<versione>.tgz package/package.json | grep '"license"'   # dev'essere Apache-2.0
sha256sum xlsx-<versione>.tgz                                          # da riportare qui sopra
mv xlsx-<versione>.tgz vendor/ && rm vendor/xlsx-0.20.3.tgz
pnpm --filter @kancrm/web add file:../../vendor/xlsx-<versione>.tgz
```

Poi `pnpm check` e la prova vera: aprire l'anteprima di un `.xlsx` da un task.
