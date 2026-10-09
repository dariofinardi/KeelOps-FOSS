-- Stato che segnala all'amministrazione un'attività da fatturare (consegna beta,
-- consegna in produzione, collaudo…): entrandoci, il task avvisa chi deve fatturare.
ALTER TABLE "TaskStatus" ADD COLUMN "isBillingMilestone" BOOLEAN NOT NULL DEFAULT 0;
