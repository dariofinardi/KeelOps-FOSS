-- Area qualità: la quinta area di lavoro, con la sua lista di stati.
--
-- Solo dati: nessuna colonna cambia. Gli stati esistono perché un'area senza
-- stati non può ospitare task — `initialStatusFor` non saprebbe dove farli
-- nascere — ed è la stessa ragione per cui SALES, DEV e GENERAL hanno avuto i
-- loro il 22/07/2026. Chi non usa la qualità non li incontra: nessun task ci
-- finisce dentro da solo, e la lista resta ferma dov'è.
--
-- Gli id sono leggibili e non generati: sono dati di sistema, e ritrovarli per
-- nome in un backup vale più dell'eleganza di un cuid.
--
-- Il flusso segue una non conformità: si apre, si cerca la causa, si agisce, si
-- verifica che l'azione abbia funzionato, si chiude. «Da verificare» è lo stato
-- che distingue un sistema qualità da un elenco di cose da fare.

INSERT INTO `TaskStatus` (`id`, `name`, `category`, `color`, `order`, `isClosed`) VALUES
  ('sts_qua_aperta',        'Aperta',           'QUALITY', '#ef4444', 0, 0),
  ('sts_qua_in_analisi',    'In analisi',       'QUALITY', '#f59e0b', 1, 0),
  ('sts_qua_azioni',        'Azioni in corso',  'QUALITY', '#2563eb', 2, 0),
  ('sts_qua_da_verificare', 'Da verificare',    'QUALITY', '#a78bfa', 3, 0),
  ('sts_qua_chiusa',        'Chiusa',           'QUALITY', '#22c55e', 4, 1),
  ('sts_qua_annullata',     'Annullata',        'QUALITY', '#6b7280', 5, 1);
