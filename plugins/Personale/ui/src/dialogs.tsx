// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "./api";
import { formatDate, t } from "./i18n";
import {
  TEMPLATE_COLUMNS,
  type Board,
  type BoardTask,
  type TemplateKey,
  type UserRef,
} from "./types";

/**
 * Le finestre della pagina: nome della bacheca (nuova o rinomina), la card,
 * l'editor delle colonne, la conferma. Senza la libreria di componenti del
 * core — non attraversa la cornice — ma con le stesse mosse: Esc chiude,
 * il fuoco parte dal primo campo, e uscendo da un modulo sporco si chiede.
 */
export function Finestra({
  titolo,
  onClose,
  stretta,
  children,
}: {
  titolo: string;
  onClose: () => void;
  stretta?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="velo" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`finestra${stretta ? " stretta" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={titolo}
      >
        <h3>{titolo}</h3>
        {children}
      </div>
    </div>
  );
}

/** Una conferma: risolve true/false. Si usa con `useConferma`. */
export function useConferma() {
  const [stato, setStato] = useState<{
    titolo: string;
    messaggio: string;
    conferma: string;
    pericolo?: boolean;
    risolvi: (ok: boolean) => void;
  } | null>(null);
  const chiedi = (opts: {
    titolo: string;
    messaggio: string;
    conferma: string;
    pericolo?: boolean;
  }) => new Promise<boolean>((risolvi) => setStato({ ...opts, risolvi }));
  const nodo = stato ? (
    <Finestra
      titolo={stato.titolo}
      stretta
      onClose={() => {
        stato.risolvi(false);
        setStato(null);
      }}
    >
      <div className="corpo">
        <p className="tenue" style={{ margin: 0 }}>
          {stato.messaggio}
        </p>
        <div className="azioni">
          <button
            type="button"
            className="bottone"
            onClick={() => {
              stato.risolvi(false);
              setStato(null);
            }}
          >
            {t("Annulla")}
          </button>
          <button
            type="button"
            className={`bottone primario${stato.pericolo ? " pericolo" : ""}`}
            autoFocus
            onClick={() => {
              stato.risolvi(true);
              setStato(null);
            }}
          >
            {stato.conferma}
          </button>
        </div>
      </div>
    </Finestra>
  ) : null;
  return { chiedi, nodo };
}

const TEMPLATE_META: Array<{ key: TemplateKey; label: string; description: string }> = [
  { key: "empty", label: "Base", description: "Le tre colonne essenziali per iniziare." },
  {
    key: "review",
    label: "Con revisione",
    description: "Aggiunge un passaggio di controllo prima del fatto.",
  },
  { key: "gtd", label: "GTD", description: "Getting Things Done: dall'idea all'azione." },
  {
    key: "eisenhower",
    label: "Priorità",
    description: "Matrice di Eisenhower per urgenza e importanza.",
  },
  { key: "week", label: "Settimana", description: "Una colonna per ogni giorno lavorativo." },
];

export function FinestraNome({
  modo,
  board,
  onClose,
  onDone,
}: {
  modo: "new" | "rename";
  board?: Board;
  onClose: () => void;
  onDone: (board: Board) => void;
}) {
  const [nome, setNome] = useState(board?.name ?? "");
  const [template, setTemplate] = useState<TemplateKey>("empty");
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (nome.trim() === "") return;
    setInCorso(true);
    setErrore(null);
    try {
      const esito =
        modo === "new"
          ? await api.createBoard({ name: nome.trim(), template })
          : await api.renameBoard(board!.id, nome.trim());
      onDone(esito);
      onClose();
    } catch (err) {
      setErrore(err instanceof ApiError ? err.message : t("Errore imprevisto"));
    } finally {
      setInCorso(false);
    }
  };

  return (
    <Finestra titolo={modo === "new" ? t("Nuova board") : t("Rinomina board")} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="campo">
          <label htmlFor="board-name">{t("Nome")}</label>
          <input
            id="board-name"
            className="ingresso"
            required
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </div>
        {modo === "new" && (
          <div className="campo">
            <label>{t("Template")}</label>
            <div className="template-griglia">
              {TEMPLATE_META.map((tpl) => (
                <button
                  key={tpl.key}
                  type="button"
                  className={`template${template === tpl.key ? " scelto" : ""}`}
                  onClick={() => setTemplate(tpl.key)}
                >
                  <span className="etichetta">{t(tpl.label)}</span>
                  <span className="descrizione">{t(tpl.description)}</span>
                  <span className="colonne">
                    {TEMPLATE_COLUMNS[tpl.key].map((c) => (
                      <span key={c}>{c}</span>
                    ))}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {errore && <p className="errore">{errore}</p>}
        <div className="azioni">
          <button type="button" className="bottone" onClick={onClose}>
            {t("Annulla")}
          </button>
          <button type="submit" className="bottone primario" disabled={inCorso}>
            {modo === "new" ? t("Crea") : t("Salva")}
          </button>
        </div>
      </form>
    </Finestra>
  );
}

/** Crea o modifica una card: titolo, scadenza e ora, colonna, assegnatario, descrizione. */
export function FinestraCard({
  board,
  task,
  defaultStatusId,
  users,
  onClose,
  onSaved,
  onDeleted,
}: {
  board: Board;
  task: BoardTask | null;
  defaultStatusId?: string;
  users: UserRef[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const statuses = [...board.statuses].sort((a, b) => a.order - b.order);
  const initialStatusId = statuses.find((s) => s.isInitial)?.id ?? "";
  const [titolo, setTitolo] = useState(task?.title ?? "");
  const [descrizione, setDescrizione] = useState(task?.description ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [dueTime, setDueTime] = useState(task?.dueTime ?? "");
  const [statusId, setStatusId] = useState(
    task?.boardStatusId ?? defaultStatusId ?? initialStatusId,
  );
  const [assigneeId, setAssigneeId] = useState(task?.assignee?.id ?? "");
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const conferma = useConferma();

  const sporco =
    titolo !== (task?.title ?? "") ||
    descrizione !== (task?.description ?? "") ||
    dueDate !== (task?.dueDate ?? "") ||
    dueTime !== (task?.dueTime ?? "") ||
    assigneeId !== (task?.assignee?.id ?? "") ||
    statusId !== (task?.boardStatusId ?? defaultStatusId ?? initialStatusId);

  const salva = async () => {
    setInCorso(true);
    setErrore(null);
    const body = {
      title: titolo,
      description: descrizione.trim() === "" ? null : descrizione,
      dueDate: dueDate || null,
      dueTime: dueTime || null,
      boardStatusId: statusId,
      assigneeId: assigneeId || null,
    };
    try {
      if (task) await api.updateTask(board.id, task.id, body);
      else await api.createTask(board.id, body);
      onSaved();
      onClose();
    } catch (err) {
      setErrore(err instanceof ApiError ? err.message : t("Errore imprevisto"));
    } finally {
      setInCorso(false);
    }
  };

  // Uscendo da un modulo sporco non si perde niente in silenzio.
  const chiudi = () => {
    if (!sporco) return onClose();
    if (window.confirm(t("Le modifiche non salvate andranno perse. Continuare?"))) onClose();
  };

  const elimina = async () => {
    if (!task) return;
    const ok = await conferma.chiedi({
      titolo: t("Eliminare il task?"),
      messaggio: t('"{{title}}" verrà eliminato definitivamente.', { title: task.title }),
      conferma: t("Elimina"),
      pericolo: true,
    });
    if (!ok) return;
    await api.deleteTask(board.id, task.id);
    onDeleted();
    onClose();
  };

  return (
    <Finestra titolo={task ? t("Modifica task") : t("Nuovo task")} onClose={chiudi}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void salva();
        }}
      >
        <div className="campo">
          <label htmlFor="bt-title">{t("Titolo")}</label>
          <input
            id="bt-title"
            className="ingresso"
            required
            autoFocus
            value={titolo}
            onChange={(e) => setTitolo(e.target.value)}
          />
        </div>
        <div className="griglia2">
          <div className="campo">
            <label htmlFor="bt-date">{t("Scadenza")}</label>
            <input
              id="bt-date"
              type="date"
              className="ingresso"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="bt-time">{t("Ora")}</label>
            <input
              id="bt-time"
              type="time"
              className="ingresso"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="bt-status">{t("Stato")}</label>
            <select
              id="bt-status"
              className="ingresso"
              value={statusId}
              onChange={(e) => setStatusId(e.target.value)}
            >
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="bt-assignee">{t("Assegnatario")}</label>
            <select
              id="bt-assignee"
              className="ingresso"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">{t("Nessuno")}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="campo">
          <label htmlFor="bt-desc">{t("Descrizione")}</label>
          <textarea
            id="bt-desc"
            className="ingresso"
            value={descrizione}
            onChange={(e) => setDescrizione(e.target.value)}
          />
        </div>
        {errore && <p className="errore">{errore}</p>}
        <div className="azioni">
          {task && (
            <button
              type="button"
              className="bottone leggero pericolo sinistra"
              onClick={() => void elimina()}
            >
              {t("Elimina")}
            </button>
          )}
          <button type="button" className="bottone" onClick={chiudi}>
            {t("Annulla")}
          </button>
          <button type="submit" className="bottone primario" disabled={inCorso}>
            {task ? t("Salva") : t("Crea")}
          </button>
        </div>
      </form>
      {conferma.nodo}
    </Finestra>
  );
}

interface Riga {
  id?: string;
  name: string;
  color: string;
  isInitial: boolean;
  isClosed: boolean;
}

/** L'editor delle colonne: aggiungi, rinomina, riordina, iniziale/chiusa, colore. */
export function FinestraStati({
  board,
  onClose,
  onSaved,
}: {
  board: Board;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [righe, setRighe] = useState<Riga[]>(
    [...board.statuses]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        id: s.id,
        name: s.name,
        color: s.color,
        isInitial: s.isInitial,
        isClosed: s.isClosed,
      })),
  );
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const patch = (i: number, valori: Partial<Riga>) =>
    setRighe((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...valori } : r)));
  const iniziale = (i: number) =>
    setRighe((prev) => prev.map((r, idx) => ({ ...r, isInitial: idx === i })));
  const sposta = (i: number, delta: number) =>
    setRighe((prev) => {
      const next = [...prev];
      const j = i + delta;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const salva = async () => {
    setInCorso(true);
    setErrore(null);
    try {
      await api.replaceStatuses(
        board.id,
        righe.map(({ id, ...r }) => (id ? { id, ...r } : r)),
      );
      onSaved();
      onClose();
    } catch (err) {
      setErrore(err instanceof ApiError ? err.message : t("Errore imprevisto"));
    } finally {
      setInCorso(false);
    }
  };

  return (
    <Finestra titolo={t("Stati — {{name}}", { name: board.name })} onClose={onClose}>
      <div className="corpo">
        <p className="tenue" style={{ margin: 0, fontSize: "0.75rem" }}>
          {t("Un solo stato iniziale, almeno uno di chiusura.")}
        </p>
        {righe.map((riga, i) => (
          <div key={riga.id ?? `nuova-${i}`} className="riga-stato">
            <input
              type="color"
              value={riga.color}
              title={t("Colore")}
              onChange={(e) => patch(i, { color: e.target.value })}
            />
            <input
              className="ingresso"
              value={riga.name}
              placeholder={t("Nome stato")}
              onChange={(e) => patch(i, { name: e.target.value })}
            />
            <label title={t("Stato iniziale")}>
              <input type="radio" checked={riga.isInitial} onChange={() => iniziale(i)} />{" "}
              {t("iniz.")}
            </label>
            <label title={t("Stato di chiusura")}>
              <input
                type="checkbox"
                checked={riga.isClosed}
                onChange={(e) => patch(i, { isClosed: e.target.checked })}
              />{" "}
              {t("chiuso")}
            </label>
            <button type="button" title={t("Su")} disabled={i === 0} onClick={() => sposta(i, -1)}>
              ▲
            </button>
            <button
              type="button"
              title={t("Giù")}
              disabled={i === righe.length - 1}
              onClick={() => sposta(i, 1)}
            >
              ▼
            </button>
            <button
              type="button"
              className="pericolo"
              title={t("Rimuovi")}
              disabled={righe.length <= 1}
              onClick={() => setRighe((prev) => prev.filter((_, idx) => idx !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="bottone piccolo"
          style={{ alignSelf: "flex-start" }}
          onClick={() =>
            setRighe((prev) => [
              ...prev,
              { name: "", color: "#94a3b8", isInitial: false, isClosed: false },
            ])
          }
        >
          + {t("Aggiungi stato")}
        </button>
        {errore && <p className="errore">{errore}</p>}
        <div className="azioni">
          <button type="button" className="bottone" onClick={onClose}>
            {t("Annulla")}
          </button>
          <button
            type="button"
            className="bottone primario"
            disabled={inCorso}
            onClick={() => void salva()}
          >
            {inCorso ? t("Salvataggio…") : t("Salva")}
          </button>
        </div>
      </div>
    </Finestra>
  );
}

/** Scadenza e ora in una riga, colorata se oggi o passata. */
export function Scadenza({ task, oggi }: { task: BoardTask; oggi: string }) {
  if (!task.dueDate) return null;
  const stato = task.closedAt
    ? ""
    : task.dueDate < oggi
      ? "scaduto"
      : task.dueDate === oggi
        ? "oggi"
        : "";
  return (
    <span className={stato}>
      {formatDate(task.dueDate)}
      {task.dueTime ? ` · ${task.dueTime}` : ""}
    </span>
  );
}
