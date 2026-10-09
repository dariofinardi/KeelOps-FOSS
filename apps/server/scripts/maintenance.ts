/**
 * Accende o spegne la manutenzione SENZA passare dall'API: serve al deploy,
 * che deve poterlo fare anche mentre il servizio è fermo o sta riavviando.
 * Riusa il servizio vero (un punto solo, mai due copie della logica).
 *
 *   DATABASE_PATH=/percorso/app.db tsx scripts/maintenance.ts on --message "…"
 *   DATABASE_PATH=/percorso/app.db tsx scripts/maintenance.ts off
 *   DATABASE_PATH=/percorso/app.db tsx scripts/maintenance.ts status
 */
import { maintenanceState, setMaintenance } from "../src/modules/maintenance/service";

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
  const messageAt = process.argv.indexOf("--message");
  const message = messageAt > 0 ? process.argv[messageAt + 1] : undefined;

  if (command === "on") {
    const state = await setMaintenance(true, message);
    console.log(`manutenzione ACCESA${state.message ? ` — «${state.message}»` : ""}`);
  } else if (command === "off") {
    await setMaintenance(false);
    console.log("manutenzione SPENTA: KeelOps è online");
  } else if (command === "status") {
    const state = await maintenanceState();
    console.log(state.active ? `ACCESA dal ${state.since}` : "spenta");
  } else {
    console.error("uso: maintenance.ts on [--message \"…\"] | off | status");
    process.exit(2);
  }
}

main().then(() => process.exit(0), (err) => { console.error(err.message); process.exit(1); });
