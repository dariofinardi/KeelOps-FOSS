-- Il ruolo esterno che segue le offerte si chiama "Monitor vendite", non
-- "finanziatore": la colonna prende il nome della cosa che rappresenta. La
-- rinomina conserva i valori già impostati.
ALTER TABLE "Task" RENAME COLUMN "visibleToFinanciers" TO "visibleToSalesMonitors";
