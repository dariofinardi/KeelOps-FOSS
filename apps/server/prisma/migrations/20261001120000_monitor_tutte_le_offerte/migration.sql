-- Il monitor vendite (portale investitori) che vede tutte le offerte, non
-- solo quelle spuntate come da mostrare. Per persona, lo decide l'admin.
-- AlterTable
ALTER TABLE "User" ADD COLUMN "salesMonitorAllDeals" BOOLEAN NOT NULL DEFAULT false;
