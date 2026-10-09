import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { formatDate, t, todayISO } from "./i18n";
import { Kanban } from "./kanban";
import { FinestraNome, FinestraStati, useConferma } from "./dialogs";
import {
  FILTRI_VUOTI,
  type Board,
  type BoardTask,
  type DashboardTask,
  type Filtri,
  type GruppoDashboard,
  type UserRef,
} from "./types";
// Lo script con cui una pagina in una cornice dice la propria altezza (SDK).
import { avviaRiquadro } from "../../../keelops-sdk/ui.mjs";

const CHIAVE_SCHEDA = "kancrm-board-active";
const CHIAVE_FILTRI = "kancrm-personale-filtri";
const GRUPPI: GruppoDashboard[] = ["overdue", "today", "tomorrow", "next", "none"];
const gruppoDaParametro = (v: string | null): GruppoDashboard =>
  (GRUPPI as string[]).includes(v ?? "") ? (v as GruppoDashboard) : "overdue";

/** Il giorno ISO a `n` giorni da `iso`. */
function piuGiorni(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * I filtri di una bacheca applicati alle sue card: testo in titolo e
 * descrizione, colonna, scadenza (scadute / oggi / entro sette giorni / senza).
 * Una funzione pura: la prova sta nella sua semplicità.
 */
export function applicaFiltri(tasks: BoardTask[], filtri: Filtri, oggi = todayISO()): BoardTask[] {
  const parole = filtri.q.toLowerCase().split(/\s+/).filter(Boolean);
  const settimana = piuGiorni(oggi, 7);
  return tasks.filter((task) => {
    if (filtri.colonna && task.boardStatusId !== filtri.colonna) return false;
    if (filtri.scadenza) {
      const d = task.dueDate;
      if (filtri.scadenza === "none" ? d !== null : d === null) return false;
      if (filtri.scadenza === "overdue" && d! >= oggi) return false;
      if (filtri.scadenza === "today" && d !== oggi) return false;
      if (filtri.scadenza === "week" && (d! < oggi || d! >= settimana)) return false;
    }
    if (parole.length > 0) {
      const testo = `${task.title} ${task.description ?? ""}`.toLowerCase();
      if (!parole.every((p) => testo.includes(p))) return false;
    }
    return true;
  });
}

/** Legge/salva in localStorage senza far cadere la pagina se non c'è. */
const memoria = {
  get(chiave: string): string | null {
    try {
      return localStorage.getItem(chiave);
    } catch {
      return null;
    }
  },
  set(chiave: string, valore: string) {
    try {
      localStorage.setItem(chiave, valore);
    } catch {
      /* niente memoria: si vive senza */
    }
  },
};

export function App() {
  const params = new URLSearchParams(window.location.search);
  const ancora = params.get("ancora");
  if (ancora === "dashboard") return <Riquadro />;
  // dentro un gruppo della giornata («Personali» accanto a Miei e Supervisionati)
  if (ancora === "dashboardGroups")
    return <Riquadro gruppo={gruppoDaParametro(params.get("gruppo"))} />;
  return <Pagina bachecaChiesta={params.get("bacheca")} />;
}

/**
 * La pagina intera, come `PersonalePage` del core: schede delle bacheche
 * (attiva ricordata, `?bacheca=<id>` ha la precedenza), barra con rinomina,
 * colonne, ordine standard, elimina; la kanban sotto.
 */
function Pagina({ bachecaChiesta }: { bachecaChiesta: string | null }) {
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(
    bachecaChiesta ?? memoria.get(CHIAVE_SCHEDA),
  );
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [users, setUsers] = useState<UserRef[]>([]);
  const [ordini, setOrdini] = useState<Record<string, string[]>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [nameDialog, setNameDialog] = useState<{ modo: "new" | "rename"; board?: Board } | null>(
    null,
  );
  const [statiDi, setStatiDi] = useState<Board | null>(null);
  const conferma = useConferma();
  // I filtri, ricordati per bacheca come ogni filtro dell'applicazione.
  const [filtri, setFiltriStato] = useState<Filtri>(FILTRI_VUOTI);

  const segnala = (err: unknown) => {
    if (err instanceof ApiError && err.status === 401)
      setErrore(t("Sessione scaduta: accedi di nuovo a KeelOps."));
    else setErrore(err instanceof Error ? err.message : t("Errore imprevisto"));
  };

  const caricaBoards = useCallback(async () => {
    try {
      setBoards(await api.boards());
    } catch (err) {
      segnala(err);
    }
  }, []);

  useEffect(() => {
    void caricaBoards();
    api
      .users()
      .then(setUsers)
      .catch(() => setUsers([]));
    // La preferenza sull'ordine delle colonne sta nel profilo del core: se non
    // risponde (una versione vecchia), si va con l'ordine della bacheca.
    api
      .columnOrders()
      .then(setOrdini)
      .catch(() => setOrdini({}));
  }, [caricaBoards]);

  const mine = (boards ?? []).slice().sort((a, b) => a.order - b.order);
  // La bacheca aperta: quella ricordata se c'è ancora, altrimenti la prima.
  // Un valore derivato, non un effetto: niente disegno intermedio senza bacheca.
  const active = mine.find((b) => b.id === activeId) ?? mine[0] ?? null;
  useEffect(() => {
    if (active) memoria.set(CHIAVE_SCHEDA, active.id);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    try {
      const salvati = JSON.parse(
        memoria.get(`${CHIAVE_FILTRI}:${active.id}`) ?? "null",
      ) as Partial<Filtri> | null;
      setFiltriStato({ ...FILTRI_VUOTI, ...(salvati ?? {}) });
    } catch {
      setFiltriStato(FILTRI_VUOTI);
    }
  }, [active]);
  const setFiltri = (cambio: Partial<Filtri>) => {
    if (!active) return;
    const next = { ...filtri, ...cambio };
    setFiltriStato(next);
    memoria.set(`${CHIAVE_FILTRI}:${active.id}`, JSON.stringify(next));
  };
  const filtriAttivi = filtri.q !== "" || filtri.colonna !== "" || filtri.scadenza !== "";
  const visibili = filtriAttivi ? applicaFiltri(tasks, filtri) : tasks;

  const caricaTasks = useCallback(async () => {
    if (!active) return setTasks([]);
    try {
      setTasks(await api.tasks(active.id, showArchived));
    } catch (err) {
      segnala(err);
    }
  }, [active, showArchived]);
  useEffect(() => {
    void caricaTasks();
  }, [caricaTasks]);

  const chiaveOrdine = active ? `board:${active.id}` : "";
  const setOrdine = (order: string[]) => {
    setOrdini((prev) => {
      const next = { ...prev };
      if (order.length > 0) next[chiaveOrdine] = order;
      else delete next[chiaveOrdine];
      return next;
    });
    api.setColumnOrder(chiaveOrdine, order).catch(segnala);
  };

  const eliminaBoard = async (board: Board) => {
    const ok = await conferma.chiedi({
      titolo: t("Eliminare la board?"),
      messaggio: t('"{{name}}" e i suoi task verranno eliminati.', { name: board.name }),
      conferma: t("Elimina"),
      pericolo: true,
    });
    if (!ok) return;
    try {
      await api.deleteBoard(board.id);
      setActiveId(null);
      await caricaBoards();
    } catch (err) {
      segnala(err);
    }
  };

  if (errore && !boards)
    return (
      <div className="pagina">
        <p className="errore">{errore}</p>
      </div>
    );
  if (!boards)
    return (
      <div className="pagina">
        <p className="tenue">…</p>
      </div>
    );

  return (
    <div className="pagina">
      <div className="schede">
        {mine.map((board) => (
          <button
            key={board.id}
            type="button"
            className={`scheda${board.id === active?.id ? " attiva" : ""}`}
            onClick={() => setActiveId(board.id)}
          >
            {board.name}
          </button>
        ))}
        <button
          type="button"
          className="bottone piccolo"
          onClick={() => setNameDialog({ modo: "new" })}
        >
          + {t("Nuova board")}
        </button>
      </div>

      {errore && <p className="errore">{errore}</p>}

      {active ? (
        <>
          <div className="barra">
            <h2>{active.name}</h2>
            <label className="spunta">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              {t("Mostra archiviati")}
            </label>
            <div className="spinta">
              <button
                type="button"
                className="bottone piccolo"
                onClick={() => setNameDialog({ modo: "rename", board: active })}
              >
                {t("Rinomina")}
              </button>
              {(ordini[chiaveOrdine]?.length ?? 0) > 0 && (
                <button
                  type="button"
                  className="bottone piccolo"
                  title={t("Ordine standard")}
                  onClick={() => setOrdine([])}
                >
                  {t("Ordine standard")}
                </button>
              )}
              <button type="button" className="bottone piccolo" onClick={() => setStatiDi(active)}>
                {t("Stati")}
              </button>
              <button
                type="button"
                className="bottone leggero icona pericolo"
                title={t("Elimina board")}
                onClick={() => void eliminaBoard(active)}
              >
                <svg className="icona" viewBox="0 0 24 24">
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
              </button>
            </div>
          </div>
          <div className="filtri" role="search">
            <input
              className="ingresso"
              type="search"
              placeholder={t("Cerca nelle card…")}
              aria-label={t("Cerca nelle card…")}
              value={filtri.q}
              onChange={(e) => setFiltri({ q: e.target.value })}
            />
            <select
              className="ingresso"
              aria-label={t("Filtra per colonna")}
              value={filtri.colonna}
              onChange={(e) => setFiltri({ colonna: e.target.value })}
            >
              <option value="">{t("Tutte le colonne")}</option>
              {[...active.statuses]
                .sort((a, b) => a.order - b.order)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
            <select
              className="ingresso"
              aria-label={t("Filtra per scadenza")}
              value={filtri.scadenza}
              onChange={(e) => setFiltri({ scadenza: e.target.value as Filtri["scadenza"] })}
            >
              <option value="">{t("Qualsiasi scadenza")}</option>
              <option value="overdue">{t("Scadute")}</option>
              <option value="today">{t("Oggi")}</option>
              <option value="week">{t("Questa settimana")}</option>
              <option value="none">{t("Senza scadenza")}</option>
            </select>
            {filtriAttivi && (
              <>
                <span className="conteggio">
                  {t("{{n}} di {{m}} card", { n: visibili.length, m: tasks.length })}
                </span>
                <button
                  type="button"
                  className="bottone piccolo"
                  onClick={() => setFiltri(FILTRI_VUOTI)}
                >
                  {t("Azzera filtri")}
                </button>
              </>
            )}
          </div>
          {filtriAttivi && visibili.length === 0 && tasks.length > 0 && (
            <p className="tenue" style={{ margin: 0, fontSize: "0.875rem" }}>
              {t("Nessuna card corrisponde ai filtri.")}
            </p>
          )}
          <Kanban
            board={active}
            tasks={visibili}
            users={users}
            ordineSalvato={ordini[chiaveOrdine]}
            onOrdine={setOrdine}
            onChange={() => void caricaTasks()}
          />
        </>
      ) : (
        <div className="vuoto">
          {t('Nessuna board personale. Crea la tua prima bacheca con "Nuova board".')}
        </div>
      )}

      {nameDialog && (
        <FinestraNome
          modo={nameDialog.modo}
          board={nameDialog.board}
          onClose={() => setNameDialog(null)}
          onDone={(board) => {
            setActiveId(board.id);
            void caricaBoards();
          }}
        />
      )}
      {statiDi && (
        <FinestraStati
          board={statiDi}
          onClose={() => setStatiDi(null)}
          onSaved={() => {
            void caricaBoards();
            void caricaTasks();
          }}
        />
      )}
      {conferma.nodo}
    </div>
  );
}

/**
 * Il riquadro nella giornata (`?ancora=dashboard`): le mie card aperte, con
 * bacheca e colonna, ciascuna un collegamento alla pagina intera. Dice la
 * propria altezza al guscio con lo script dell'SDK, così la cornice non lascia
 * né un buco né una barra di scorrimento dentro un'altra.
 */
function Riquadro({ gruppo }: { gruppo?: GruppoDashboard }) {
  const [dati, setDati] = useState<{ tasks: DashboardTask[]; me: UserRef } | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  useEffect(() => {
    api
      .dashboard(gruppo)
      .then((d) => {
        setDati(d);
        // Il riquadro della giornata senza card non si mostra: lo dice al
        // guscio, che nasconde la cornice (contratto `keelops:vuoto`). Dentro
        // un gruppo l'intestazione è del gruppo, e il messaggio resta.
        if (!gruppo && window.parent !== window)
          window.parent.postMessage(
            { tipo: "keelops:vuoto", vuoto: d.tasks.length === 0 },
            window.location.origin,
          );
      })
      .catch((err) => setErrore(err instanceof Error ? err.message : t("Errore imprevisto")));
    // Si chiama, non si inietta: questa pagina è già codice che gira. Un
    // `<script>` costruito qui dentro è inline, e in produzione la CSP
    // (`script-src 'self'`) non lo esegue — in sviluppo sì, perché lì la CSP è
    // spenta, e il riquadro restava dell'altezza sbagliata solo in produzione
    // senza che niente lo dicesse (09/09/2026).
    avviaRiquadro();
  }, [gruppo]);
  const apri = (boardId: string) => `/estensioni/Personale?bacheca=${encodeURIComponent(boardId)}`;
  return (
    <div className="pagina riquadro">
      {/* dentro un gruppo della giornata l'intestazione è quella del gruppo: qui solo l'elenco */}
      {!gruppo && (
        <div className="riquadro-testa">
          <span>{t("Le mie bacheche")}</span>
          {dati && (
            <span className="tenue" style={{ fontWeight: 400 }}>
              {dati.tasks.length}
            </span>
          )}
        </div>
      )}
      {errore && <p className="errore">{errore}</p>}
      {dati && dati.tasks.length === 0 && (
        <p className="tenue" style={{ margin: 0, fontSize: "0.875rem" }}>
          {gruppo ? t("Nessuna card personale qui.") : t("Niente in sospeso sulle tue bacheche.")}
        </p>
      )}
      {dati && dati.tasks.length > 0 && (
        <ul className="riquadro-elenco">
          {dati.tasks.map((task) => (
            <li key={task.id}>
              {/* target=_top: il collegamento cambia la pagina del guscio, non la cornice */}
              <a href={apri(task.boardId)} target="_top" title={t("Apri la bacheca")}>
                {task.title}
              </a>
              <span className="pillola">
                <span className="pallino" style={{ backgroundColor: task.status.color }} />
                {task.boardName} · {task.status.name}
              </span>
              {task.dueDate && (
                <span className="tenue" style={{ fontSize: "0.75rem" }}>
                  {formatDate(task.dueDate)}
                  {task.dueTime ? ` · ${task.dueTime}` : ""}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
