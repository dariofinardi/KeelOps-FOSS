/**
 * Tiny translation table for the plugin's user-facing pages (instructions and
 * consent). Italian is the key, like everywhere else in the product; unknown
 * keys fall back to the Italian text. No dependencies, on purpose.
 */
const CATALOGS = {
  en: {
    "Collega un assistente AI a KeelOps": "Connect an AI assistant to KeelOps",
    "Claude, ChatGPT e Mistral possono {leggere} KeelOps attraverso questo connettore MCP: nessuno strumento scrive, e ogni assistente vede solo ciò che vede {chi} — il suo perimetro, mai quello degli altri.":
      "Claude, ChatGPT and Mistral can {leggere} KeelOps through this MCP connector: no tool writes, and every assistant sees only what {chi} sees — their perimeter, never other people's.",
    "leggere": "read",
    "l'utente che lo autorizza": "the user who authorizes it",
    "L'indirizzo da incollare": "The address to paste",
    "Copia": "Copy",
    "Copiato": "Copied",
    "Sei dentro come {nome}: autorizzando un assistente, leggerà come te.":
      "You are signed in as {nome}: an assistant you authorize will read as you.",
    "Non risulti dentro KeelOps da questo browser: accedi prima al gestionale, il consenso ne avrà bisogno.":
      "You do not appear signed in to KeelOps in this browser: sign in first, the consent step will need it.",
    "Dove si incolla": "Where to paste it",
    "Settings → Connectors → {voce} → incolla l'indirizzo.": "Settings → Connectors → {voce} → paste the address.",
    "Settings → Connectors (serve la Developer mode, piani a pagamento) → incolla l'indirizzo.":
      "Settings → Connectors (Developer mode required, paid plans) → paste the address.",
    "Intelligence → Connectors → {voce} → incolla l'indirizzo.": "Intelligence → Connectors → {voce} → paste the address.",
    "Il provider scopre da sé la configurazione OAuth, si registra da solo e apre la pagina di consenso di KeelOps: lì serve una sessione attiva in questo browser. Da quel momento l'assistente usa un suo token, revocabile, che vale otto ore e si rinnova da sé.":
      "The provider discovers the OAuth configuration by itself, registers on its own and opens the KeelOps consent page: an active session in this browser is needed there. From then on the assistant uses its own revocable token, valid for eight hours and self-renewing.",
    "Cosa può fare, e cosa no": "What it can do, and what it cannot",
    "solo {lettura}: nessuno strumento modifica nulla;": "{lettura} only: no tool changes anything;",
    "lettura": "read",
    "risponde nel {perimetro} che ha autorizzato: le offerte altrui e le ore degli altri restano fuori;":
      "it answers inside the {perimetro} of whoever authorized it: other people's deals and hours stay out;",
    "perimetro dell'utente": "user's perimeter",
    "questa è la versione {base}: i testi arrivano all'assistente così come sono. Per i client non fidati è previsto il plugin con pseudonimizzazione.":
      "this is the {base} version: texts reach the assistant as they are. For untrusted clients the pseudonymization plugin is planned.",
    "base": "base",
    "Collegare un assistente a KeelOps?": "Connect an assistant to KeelOps?",
    "{client} chiede di leggere KeelOps come {nome}.": "{client} asks to read KeelOps as {nome}.",
    "solo lettura: nessuno strumento scrive;": "read-only: no tool writes;",
    "vedrà solo ciò che vedi tu: il tuo perimetro, non quello degli altri;":
      "it will see only what you see: your perimeter, not other people's;",
    "revocabile spegnendo il plugin o il connettore.": "revocable by turning off the plugin or the connector.",
    "revocabile in ogni momento da «Connessioni attive» nella pagina Interfaccia MCP.": "revocable at any time from “Active connections” on the MCP interface page.",
    "Nega": "Deny",
    "Autorizza": "Authorize",
    "Serve una sessione KeelOps": "A KeelOps session is needed",
    "Il consenso riconosce l'utente dal cookie di KeelOps: accedi prima al gestionale in questa stessa finestra, poi torna indietro e riprova.":
      "Consent recognizes the user from the KeelOps cookie: sign in to the app in this same window first, then go back and retry.",
    "Vai all'accesso di KeelOps": "Go to KeelOps sign-in",
    "Assistenti AI": "AI assistants",
    "Interfaccia MCP": "MCP interface",
    "Connessioni attive": "Active connections",
    "Revocare spegne subito i token dell'assistente: per ricollegarlo si rifà l'autorizzazione dall'app.":
      "Revoking kills the assistant's tokens immediately: to reconnect it, run the authorization again from the app.",
    "autorizzato il {quando}": "authorized on {quando}",
    "Revoca": "Revoke",
    "Un attimo…": "One moment…",
    "Torna alle istruzioni": "Back to the instructions",
    "Richiesta scaduta": "Request expired",
    "Ogni richiesta di consenso vale pochi minuti e si usa una volta sola. Torna all'assistente e rilancia la connessione.":
      "Each consent request lasts a few minutes and can be used once. Go back to the assistant and start the connection again.",
    "Client sconosciuto": "Unknown client",
    "L'assistente non risulta registrato: torna all'app e rilancia la connessione, si registrerà da sé.":
      "The assistant does not appear to be registered: go back to the app and start the connection again, it will register itself.",
    "Indirizzo di ritorno non registrato": "Return address not registered",
    "Torno all'assistente…": "Taking you back to the assistant…",
    "Se non succede nulla, continua da qui.": "If nothing happens, continue from here.",
    "L'indirizzo di ritorno non corrisponde a quello registrato dall'assistente: rilancia la connessione dall'app.":
      "The return address does not match the one the assistant registered: start the connection again from the app.",
  },
  fr: {
    "Claude, ChatGPT e Mistral possono {leggere} KeelOps attraverso questo connettore MCP: nessuno strumento scrive, e ogni assistente vede solo ciò che vede {chi} — il suo perimetro, mai quello degli altri.":
      "Claude, ChatGPT et Mistral peuvent {leggere} KeelOps par ce connecteur MCP : aucun outil n'écrit, et chaque assistant ne voit que ce que voit {chi} — son périmètre, jamais celui des autres.",
    "Sei dentro come {nome}: autorizzando un assistente, leggerà come te.":
      "Tu es connecté en tant que {nome} : un assistant que tu autorises lira comme toi.",
    "Non risulti dentro KeelOps da questo browser: accedi prima al gestionale, il consenso ne avrà bisogno.":
      "Tu n'apparais pas connecté à KeelOps dans ce navigateur : connecte-toi d'abord, l'étape de consentement en aura besoin.",
    "Settings → Connectors → {voce} → incolla l'indirizzo.":
      "Settings → Connectors → {voce} → colle l'adresse.",
    "Settings → Connectors (serve la Developer mode, piani a pagamento) → incolla l'indirizzo.":
      "Settings → Connectors (Developer mode requis, offres payantes) → colle l'adresse.",
    "Intelligence → Connectors → {voce} → incolla l'indirizzo.":
      "Intelligence → Connectors → {voce} → colle l'adresse.",
    "Il provider scopre da sé la configurazione OAuth, si registra da solo e apre la pagina di consenso di KeelOps: lì serve una sessione attiva in questo browser. Da quel momento l'assistente usa un suo token, revocabile, che vale otto ore e si rinnova da sé.":
      "Le fournisseur découvre seul la configuration OAuth, s'enregistre seul et ouvre la page de consentement de KeelOps : il y faut une session active dans ce navigateur. Ensuite l'assistant utilise son propre jeton, révocable, valable huit heures et qui se renouvelle seul.",
    "solo {lettura}: nessuno strumento modifica nulla;":
      "{lettura} seule : aucun outil ne modifie rien ;",
    "risponde nel {perimetro} che ha autorizzato: le offerte altrui e le ore degli altri restano fuori;":
      "il répond dans le {perimetro} de la personne qui l'a autorisé : les offres et les heures des autres restent dehors ;",
    "questa è la versione {base}: i testi arrivano all'assistente così come sono. Per i client non fidati è previsto il plugin con pseudonimizzazione.":
      "c'est la version {base} : les textes arrivent à l'assistant tels quels. Pour les clients non fiables, le plugin avec pseudonymisation est prévu.",
    "Collegare un assistente a KeelOps?":
      "Connecter un assistant à KeelOps ?",
    "{client} chiede di leggere KeelOps come {nome}.":
      "{client} demande à lire KeelOps en tant que {nome}.",
    "solo lettura: nessuno strumento scrive;":
      "lecture seule : aucun outil n'écrit ;",
    "vedrà solo ciò che vedi tu: il tuo perimetro, non quello degli altri;":
      "il ne verra que ce que tu vois : ton périmètre, pas celui des autres ;",
    "revocabile spegnendo il plugin o il connettore.":
      "révocable en éteignant le plugin ou le connecteur.",
    "Il consenso riconosce l'utente dal cookie di KeelOps: accedi prima al gestionale in questa stessa finestra, poi torna indietro e riprova.":
      "Le consentement reconnaît l'utilisateur grâce au cookie de KeelOps : connecte-toi d'abord à l'application dans cette même fenêtre, puis reviens en arrière et réessaie.",
    "Assistenti AI":
      "Assistants IA",
    "Revocare spegne subito i token dell'assistente: per ricollegarlo si rifà l'autorizzazione dall'app.":
      "Révoquer éteint tout de suite les jetons de l'assistant : pour le reconnecter, on refait l'autorisation depuis l'application.",
    "Ogni richiesta di consenso vale pochi minuti e si usa una volta sola. Torna all'assistente e rilancia la connessione.":
      "Chaque demande de consentement vaut quelques minutes et ne sert qu'une fois. Reviens à l'assistant et relance la connexion.",
    "Client sconosciuto":
      "Client inconnu",
    "L'assistente non risulta registrato: torna all'app e rilancia la connessione, si registrerà da sé.":
      "L'assistant n'apparaît pas enregistré : reviens à l'application et relance la connexion, il s'enregistrera seul.",
    "Indirizzo di ritorno non registrato":
      "Adresse de retour non enregistrée",
    "L'indirizzo di ritorno non corrisponde a quello registrato dall'assistente: rilancia la connessione dall'app.":
      "L'adresse de retour ne correspond pas à celle enregistrée par l'assistant : relance la connexion depuis l'application.",
    "revocabile in ogni momento da «Connessioni attive» nella pagina Interfaccia MCP.": "révocable à tout moment depuis « Connexions actives » sur la page Interface MCP.",
    "Interfaccia MCP": "Interface MCP",
    "Torno all'assistente…": "Retour vers l'assistant…",
    "Se non succede nulla, continua da qui.": "Si rien ne se passe, continuez ici.",
    "Un attimo…": "Un instant…",
    "Torna alle istruzioni": "Retour aux instructions",
    "Richiesta scaduta": "Demande expirée",
    "Connessioni attive": "Connexions actives",
    "Revoca": "Révoquer",
    "autorizzato il {quando}": "autorisé le {quando}",
    "Collega un assistente AI a KeelOps": "Connecter un assistant IA à KeelOps",
    "leggere": "lire", "l'utente che lo autorizza": "l'utilisateur qui l'autorise",
    "L'indirizzo da incollare": "L'adresse à coller", "Copia": "Copier", "Copiato": "Copié",
    "Dove si incolla": "Où la coller",
    "Cosa può fare, e cosa no": "Ce qu'il peut faire, et ce qu'il ne peut pas",
    "lettura": "lecture", "perimetro dell'utente": "périmètre de l'utilisateur", "base": "base",
    "Nega": "Refuser", "Autorizza": "Autoriser",
    "Serve una sessione KeelOps": "Une session KeelOps est nécessaire",
    "Vai all'accesso di KeelOps": "Aller à la connexion KeelOps",
  },
  de: {
    "Claude, ChatGPT e Mistral possono {leggere} KeelOps attraverso questo connettore MCP: nessuno strumento scrive, e ogni assistente vede solo ciò che vede {chi} — il suo perimetro, mai quello degli altri.":
      "Claude, ChatGPT und Mistral können KeelOps über diesen MCP-Connector {leggere}: Kein Werkzeug schreibt, und jeder Assistent sieht nur, was {chi} sieht — den eigenen Bereich, nie den der anderen.",
    "Sei dentro come {nome}: autorizzando un assistente, leggerà come te.":
      "Du bist als {nome} angemeldet: Ein Assistent, den du autorisierst, liest wie du.",
    "Non risulti dentro KeelOps da questo browser: accedi prima al gestionale, il consenso ne avrà bisogno.":
      "In diesem Browser bist du nicht bei KeelOps angemeldet: Melde dich zuerst an, die Zustimmung braucht das.",
    "Settings → Connectors → {voce} → incolla l'indirizzo.":
      "Settings → Connectors → {voce} → Adresse einfügen.",
    "Settings → Connectors (serve la Developer mode, piani a pagamento) → incolla l'indirizzo.":
      "Settings → Connectors (Developer mode nötig, kostenpflichtige Pläne) → Adresse einfügen.",
    "Intelligence → Connectors → {voce} → incolla l'indirizzo.":
      "Intelligence → Connectors → {voce} → Adresse einfügen.",
    "Il provider scopre da sé la configurazione OAuth, si registra da solo e apre la pagina di consenso di KeelOps: lì serve una sessione attiva in questo browser. Da quel momento l'assistente usa un suo token, revocabile, che vale otto ore e si rinnova da sé.":
      "Der Anbieter findet die OAuth-Konfiguration selbst, registriert sich selbst und öffnet die Zustimmungsseite von KeelOps: Dort braucht es eine aktive Sitzung in diesem Browser. Danach nutzt der Assistent ein eigenes, widerrufbares Token, das acht Stunden gilt und sich selbst erneuert.",
    "solo {lettura}: nessuno strumento modifica nulla;":
      "nur {lettura}: Kein Werkzeug ändert etwas;",
    "risponde nel {perimetro} che ha autorizzato: le offerte altrui e le ore degli altri restano fuori;":
      "er antwortet im {perimetro} der Person, die ihn autorisiert hat: Angebote und Stunden anderer bleiben draußen;",
    "questa è la versione {base}: i testi arrivano all'assistente così come sono. Per i client non fidati è previsto il plugin con pseudonimizzazione.":
      "dies ist die {base}-Version: Texte erreichen den Assistenten, wie sie sind. Für nicht vertrauenswürdige Clients ist das Plugin mit Pseudonymisierung vorgesehen.",
    "Collegare un assistente a KeelOps?":
      "Einen Assistenten mit KeelOps verbinden?",
    "{client} chiede di leggere KeelOps come {nome}.":
      "{client} möchte KeelOps als {nome} lesen.",
    "solo lettura: nessuno strumento scrive;":
      "nur lesen: Kein Werkzeug schreibt;",
    "vedrà solo ciò che vedi tu: il tuo perimetro, non quello degli altri;":
      "er sieht nur, was du siehst: deinen Bereich, nicht den der anderen;",
    "revocabile spegnendo il plugin o il connettore.":
      "widerrufbar, indem man das Plugin oder den Connector abschaltet.",
    "Il consenso riconosce l'utente dal cookie di KeelOps: accedi prima al gestionale in questa stessa finestra, poi torna indietro e riprova.":
      "Die Zustimmung erkennt die Person am KeelOps-Cookie: Melde dich zuerst in diesem Fenster an, geh dann zurück und versuch es erneut.",
    "Assistenti AI":
      "KI-Assistenten",
    "Revocare spegne subito i token dell'assistente: per ricollegarlo si rifà l'autorizzazione dall'app.":
      "Widerrufen schaltet die Tokens des Assistenten sofort ab: Zum erneuten Verbinden autorisiert man ihn wieder aus der App.",
    "Ogni richiesta di consenso vale pochi minuti e si usa una volta sola. Torna all'assistente e rilancia la connessione.":
      "Jede Zustimmungsanfrage gilt wenige Minuten und nur einmal. Geh zurück zum Assistenten und starte die Verbindung neu.",
    "Client sconosciuto":
      "Unbekannter Client",
    "L'assistente non risulta registrato: torna all'app e rilancia la connessione, si registrerà da sé.":
      "Der Assistent ist nicht registriert: Geh zurück zur App und starte die Verbindung neu, er registriert sich selbst.",
    "Indirizzo di ritorno non registrato":
      "Rücksprungadresse nicht registriert",
    "L'indirizzo di ritorno non corrisponde a quello registrato dall'assistente: rilancia la connessione dall'app.":
      "Die Rücksprungadresse stimmt nicht mit der vom Assistenten registrierten überein: Starte die Verbindung aus der App neu.",
    "revocabile in ogni momento da «Connessioni attive» nella pagina Interfaccia MCP.": "jederzeit widerrufbar über „Aktive Verbindungen“ auf der Seite MCP-Oberfläche.",
    "Interfaccia MCP": "MCP-Oberfläche",
    "Torno all'assistente…": "Zurück zum Assistenten…",
    "Se non succede nulla, continua da qui.": "Wenn nichts passiert, hier weitermachen.",
    "Un attimo…": "Einen Moment…",
    "Torna alle istruzioni": "Zurück zur Anleitung",
    "Richiesta scaduta": "Anfrage abgelaufen",
    "Connessioni attive": "Aktive Verbindungen",
    "Revoca": "Widerrufen",
    "autorizzato il {quando}": "autorisiert am {quando}",
    "Collega un assistente AI a KeelOps": "Einen KI-Assistenten mit KeelOps verbinden",
    "leggere": "lesen", "l'utente che lo autorizza": "der autorisierende Nutzer",
    "L'indirizzo da incollare": "Die einzufügende Adresse", "Copia": "Kopieren", "Copiato": "Kopiert",
    "Dove si incolla": "Wo einfügen",
    "Cosa può fare, e cosa no": "Was er kann — und was nicht",
    "lettura": "Lesen", "perimetro dell'utente": "Sichtbereich des Nutzers", "base": "Basis",
    "Nega": "Ablehnen", "Autorizza": "Autorisieren",
    "Serve una sessione KeelOps": "Eine KeelOps-Sitzung ist nötig",
    "Vai all'accesso di KeelOps": "Zur KeelOps-Anmeldung",
  },
  es: {
    "Claude, ChatGPT e Mistral possono {leggere} KeelOps attraverso questo connettore MCP: nessuno strumento scrive, e ogni assistente vede solo ciò che vede {chi} — il suo perimetro, mai quello degli altri.":
      "Claude, ChatGPT y Mistral pueden {leggere} KeelOps a través de este conector MCP: ninguna herramienta escribe, y cada asistente ve solo lo que ve {chi} — su perímetro, nunca el de los demás.",
    "Sei dentro come {nome}: autorizzando un assistente, leggerà come te.":
      "Has entrado como {nome}: un asistente que autorices leerá como tú.",
    "Non risulti dentro KeelOps da questo browser: accedi prima al gestionale, il consenso ne avrà bisogno.":
      "No constas dentro de KeelOps en este navegador: entra primero, el consentimiento lo necesitará.",
    "Settings → Connectors → {voce} → incolla l'indirizzo.":
      "Settings → Connectors → {voce} → pega la dirección.",
    "Settings → Connectors (serve la Developer mode, piani a pagamento) → incolla l'indirizzo.":
      "Settings → Connectors (hace falta el Developer mode, planes de pago) → pega la dirección.",
    "Intelligence → Connectors → {voce} → incolla l'indirizzo.":
      "Intelligence → Connectors → {voce} → pega la dirección.",
    "Il provider scopre da sé la configurazione OAuth, si registra da solo e apre la pagina di consenso di KeelOps: lì serve una sessione attiva in questo browser. Da quel momento l'assistente usa un suo token, revocabile, che vale otto ore e si rinnova da sé.":
      "El proveedor descubre solo la configuración OAuth, se registra solo y abre la página de consentimiento de KeelOps: allí hace falta una sesión activa en este navegador. Desde entonces el asistente usa su propio token, revocable, válido ocho horas y que se renueva solo.",
    "solo {lettura}: nessuno strumento modifica nulla;":
      "solo {lettura}: ninguna herramienta modifica nada;",
    "risponde nel {perimetro} che ha autorizzato: le offerte altrui e le ore degli altri restano fuori;":
      "responde dentro del {perimetro} de quien lo autorizó: las ofertas y las horas de los demás quedan fuera;",
    "questa è la versione {base}: i testi arrivano all'assistente così come sono. Per i client non fidati è previsto il plugin con pseudonimizzazione.":
      "esta es la versión {base}: los textos llegan al asistente tal cual. Para los clientes no fiables está previsto el plugin con seudonimización.",
    "Collegare un assistente a KeelOps?":
      "¿Conectar un asistente a KeelOps?",
    "{client} chiede di leggere KeelOps come {nome}.":
      "{client} pide leer KeelOps como {nome}.",
    "solo lettura: nessuno strumento scrive;":
      "solo lectura: ninguna herramienta escribe;",
    "vedrà solo ciò che vedi tu: il tuo perimetro, non quello degli altri;":
      "verá solo lo que ves tú: tu perímetro, no el de los demás;",
    "revocabile spegnendo il plugin o il connettore.":
      "revocable apagando el plugin o el conector.",
    "Il consenso riconosce l'utente dal cookie di KeelOps: accedi prima al gestionale in questa stessa finestra, poi torna indietro e riprova.":
      "El consentimiento reconoce al usuario por la cookie de KeelOps: entra primero en la aplicación en esta misma ventana, luego vuelve atrás e inténtalo de nuevo.",
    "Assistenti AI":
      "Asistentes de IA",
    "Revocare spegne subito i token dell'assistente: per ricollegarlo si rifà l'autorizzazione dall'app.":
      "Revocar apaga enseguida los tokens del asistente: para volver a conectarlo se repite la autorización desde la app.",
    "Ogni richiesta di consenso vale pochi minuti e si usa una volta sola. Torna all'assistente e rilancia la connessione.":
      "Cada solicitud de consentimiento vale pocos minutos y se usa una sola vez. Vuelve al asistente y relanza la conexión.",
    "Client sconosciuto":
      "Cliente desconocido",
    "L'assistente non risulta registrato: torna all'app e rilancia la connessione, si registrerà da sé.":
      "El asistente no consta como registrado: vuelve a la app y relanza la conexión, se registrará solo.",
    "Indirizzo di ritorno non registrato":
      "Dirección de retorno no registrada",
    "L'indirizzo di ritorno non corrisponde a quello registrato dall'assistente: rilancia la connessione dall'app.":
      "La dirección de retorno no coincide con la registrada por el asistente: relanza la conexión desde la app.",
    "revocabile in ogni momento da «Connessioni attive» nella pagina Interfaccia MCP.": "revocable en cualquier momento desde «Conexiones activas» en la página Interfaz MCP.",
    "Interfaccia MCP": "Interfaz MCP",
    "Torno all'assistente…": "Volviendo al asistente…",
    "Se non succede nulla, continua da qui.": "Si no pasa nada, continúa desde aquí.",
    "Un attimo…": "Un momento…",
    "Torna alle istruzioni": "Volver a las instrucciones",
    "Richiesta scaduta": "Solicitud caducada",
    "Connessioni attive": "Conexiones activas",
    "Revoca": "Revocar",
    "autorizzato il {quando}": "autorizado el {quando}",
    "Collega un assistente AI a KeelOps": "Conecta un asistente de IA a KeelOps",
    "leggere": "leer", "l'utente che lo autorizza": "el usuario que lo autoriza",
    "L'indirizzo da incollare": "La dirección a pegar", "Copia": "Copiar", "Copiato": "Copiado",
    "Dove si incolla": "Dónde pegarla",
    "Cosa può fare, e cosa no": "Qué puede hacer y qué no",
    "lettura": "lectura", "perimetro dell'utente": "perímetro del usuario", "base": "base",
    "Nega": "Denegar", "Autorizza": "Autorizar",
    "Serve una sessione KeelOps": "Se necesita una sesión de KeelOps",
    "Vai all'accesso di KeelOps": "Ir al acceso de KeelOps",
  },
  pt: {
    "Claude, ChatGPT e Mistral possono {leggere} KeelOps attraverso questo connettore MCP: nessuno strumento scrive, e ogni assistente vede solo ciò che vede {chi} — il suo perimetro, mai quello degli altri.":
      "O Claude, o ChatGPT e o Mistral podem {leggere} o KeelOps através deste conector MCP: nenhuma ferramenta escreve, e cada assistente vê apenas o que vê {chi} — o seu perímetro, nunca o dos outros.",
    "Sei dentro come {nome}: autorizzando un assistente, leggerà come te.":
      "Tem sessão iniciada como {nome}: um assistente que autorizar lerá como si.",
    "Non risulti dentro KeelOps da questo browser: accedi prima al gestionale, il consenso ne avrà bisogno.":
      "Não tem sessão iniciada no KeelOps neste navegador: inicie sessão primeiro, o consentimento vai precisar dela.",
    "Settings → Connectors → {voce} → incolla l'indirizzo.":
      "Settings → Connectors → {voce} → cole o endereço.",
    "Settings → Connectors (serve la Developer mode, piani a pagamento) → incolla l'indirizzo.":
      "Settings → Connectors (é necessário o Developer mode, planos pagos) → cole o endereço.",
    "Intelligence → Connectors → {voce} → incolla l'indirizzo.":
      "Intelligence → Connectors → {voce} → cole o endereço.",
    "Il provider scopre da sé la configurazione OAuth, si registra da solo e apre la pagina di consenso di KeelOps: lì serve una sessione attiva in questo browser. Da quel momento l'assistente usa un suo token, revocabile, che vale otto ore e si rinnova da sé.":
      "O fornecedor descobre sozinho a configuração OAuth, regista-se sozinho e abre a página de consentimento do KeelOps: aí é necessária uma sessão ativa neste navegador. A partir desse momento o assistente usa um token próprio, revogável, válido por oito horas e que se renova sozinho.",
    "solo {lettura}: nessuno strumento modifica nulla;":
      "só de {lettura}: nenhuma ferramenta altera nada;",
    "risponde nel {perimetro} che ha autorizzato: le offerte altrui e le ore degli altri restano fuori;":
      "responde dentro do {perimetro} que o autorizou: as propostas e as horas dos outros ficam de fora;",
    "questa è la versione {base}: i testi arrivano all'assistente così come sono. Per i client non fidati è previsto il plugin con pseudonimizzazione.":
      "esta é a versão {base}: os textos chegam ao assistente tal como estão. Para os clientes não fidedignos está previsto o plugin com pseudonimização.",
    "Collegare un assistente a KeelOps?":
      "Ligar um assistente ao KeelOps?",
    "{client} chiede di leggere KeelOps come {nome}.":
      "{client} pede para ler o KeelOps como {nome}.",
    "solo lettura: nessuno strumento scrive;":
      "só de leitura: nenhuma ferramenta escreve;",
    "vedrà solo ciò che vedi tu: il tuo perimetro, non quello degli altri;":
      "verá apenas o que vê: o seu perímetro, não o dos outros;",
    "revocabile spegnendo il plugin o il connettore.":
      "revogável desativando o plugin ou o conector.",
    "Il consenso riconosce l'utente dal cookie di KeelOps: accedi prima al gestionale in questa stessa finestra, poi torna indietro e riprova.":
      "O consentimento reconhece o utilizador pelo cookie do KeelOps: inicie sessão primeiro na aplicação nesta mesma janela, depois volte atrás e tente novamente.",
    "Assistenti AI":
      "Assistentes de IA",
    "Revocare spegne subito i token dell'assistente: per ricollegarlo si rifà l'autorizzazione dall'app.":
      "Revogar desativa de imediato os tokens do assistente: para o voltar a ligar, repita a autorização a partir da app.",
    "Ogni richiesta di consenso vale pochi minuti e si usa una volta sola. Torna all'assistente e rilancia la connessione.":
      "Cada pedido de consentimento é válido por poucos minutos e usa-se uma só vez. Volte ao assistente e reinicie a ligação.",
    "Client sconosciuto":
      "Cliente desconhecido",
    "L'assistente non risulta registrato: torna all'app e rilancia la connessione, si registrerà da sé.":
      "O assistente não consta como registado: volte à app e reinicie a ligação, ele registar-se-á sozinho.",
    "Indirizzo di ritorno non registrato":
      "Endereço de retorno não registado",
    "L'indirizzo di ritorno non corrisponde a quello registrato dall'assistente: rilancia la connessione dall'app.":
      "O endereço de retorno não corresponde ao registado pelo assistente: reinicie a ligação a partir da app.",
    "revocabile in ogni momento da «Connessioni attive» nella pagina Interfaccia MCP.": "revogável a qualquer momento em «Ligações ativas» na página Interface MCP.",
    "Interfaccia MCP": "Interface MCP",
    "Torno all'assistente…": "A voltar ao assistente…",
    "Se non succede nulla, continua da qui.": "Se nada acontecer, continue a partir daqui.",
    "Un attimo…": "Um momento…",
    "Torna alle istruzioni": "Voltar às instruções",
    "Richiesta scaduta": "Pedido expirado",
    "Connessioni attive": "Ligações ativas",
    "Revoca": "Revogar",
    "autorizzato il {quando}": "autorizado a {quando}",
    "Collega un assistente AI a KeelOps": "Ligue um assistente de IA ao KeelOps",
    "leggere": "ler", "l'utente che lo autorizza": "o utilizador que o autoriza",
    "L'indirizzo da incollare": "O endereço a colar", "Copia": "Copiar", "Copiato": "Copiado",
    "Dove si incolla": "Onde colar",
    "Cosa può fare, e cosa no": "O que pode fazer, e o que não pode",
    "lettura": "leitura", "perimetro dell'utente": "perímetro do utilizador", "base": "base",
    "Nega": "Recusar", "Autorizza": "Autorizar",
    "Serve una sessione KeelOps": "É necessária uma sessão do KeelOps",
    "Vai all'accesso di KeelOps": "Ir para o início de sessão do KeelOps",
  },
};

const SUPPORTED = ["it", "en", "fr", "de", "es", "pt"];

/** Resolve the page language: the signed-in user's choice, else Accept-Language. */
export function pageLocale(req, user) {
  const preferred = String(user?.locale ?? "").slice(0, 2).toLowerCase();
  if (SUPPORTED.includes(preferred)) return preferred;
  for (const part of String(req.headers["accept-language"] ?? "").split(",")) {
    const tag = part.trim().slice(0, 2).toLowerCase();
    if (SUPPORTED.includes(tag)) return tag;
  }
  return "en";
}

/** Translate: Italian key, {name} placeholders. Unknown key = Italian text. */
export function translate(locale, key, params = {}) {
  const text = locale === "it" ? key : (CATALOGS[locale]?.[key] ?? CATALOGS.en?.[key] ?? key);
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    name in params ? String(params[name]) : match);
}
