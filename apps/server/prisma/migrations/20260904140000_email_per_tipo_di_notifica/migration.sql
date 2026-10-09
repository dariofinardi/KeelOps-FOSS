-- Due canali, due interruttori: chi vuole meno posta non deve rinunciare anche
-- all'avviso dentro il prodotto. Chi ha già le sue preferenze parte con l'email
-- accesa, cioè con il comportamento di oggi.
ALTER TABLE "NotificationPreference" ADD COLUMN "email" BOOLEAN NOT NULL DEFAULT true;

-- La notifica che non compare nella campanella (canale in-app spento, email
-- accesa) resta comunque scritta: è il registro su cui i riepiloghi giornalieri
-- controllano di non ripetersi a ogni riavvio.
ALTER TABLE "Notification" ADD COLUMN "inApp" BOOLEAN NOT NULL DEFAULT true;
