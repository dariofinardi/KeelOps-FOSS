// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { ActivityCategory } from "@kancrm/shared";
import { prisma } from "../db";
import { config } from "./../config";

/**
 * **I gruppi, prestati ai plugin** (22/09/2026, per l'area qualità di QABox).
 *
 * Un plugin che governa un mestiere ha bisogno di sapere **chi lo fa**: chi
 * misura, chi firma. In KeelOps quella risposta è un gruppo, e finora un
 * gruppo lo creava solo l'amministratore a mano — il che vuol dire che un
 * plugin appena installato non funzionava, e nessuno sapeva perché.
 *
 * Qui il core lo crea per conto suo, una volta, e **lo marca**: la riga porta
 * il `nick` del plugin che l'ha chiesta e la chiave con cui lui la ritrova.
 * Il marchio non è decorazione: è la sola cosa che permetterà, il giorno in
 * cui si potrà disinstallare un plugin, di rispondere a «cosa ha lasciato nel
 * core?» senza tirare a indovinare.
 *
 * Quello che il marchio **non** fa: non toglie il gruppo all'amministratore.
 * Resta un gruppo come gli altri — si rinomina, ci si mettono le persone, si
 * cancella. Se viene cancellato il plugin non lo fa risorgere da sé: lo dice,
 * e chi di dovere decide.
 */

export interface GruppoPerPlugin {
  id: string;
  nome: string;
  area: string | null;
  /** La chiave con cui il plugin lo ritrova, anche dopo un cambio di nome. */
  chiave: string;
  /** Com'è finito qui: appena creato, già suo, o adottato perché esisteva col suo nome. */
  origine: "creato" | "esistente" | "adottato";
}

export interface NuovoGruppoDaPlugin {
  /** Stabile nel tempo: è l'identità del gruppo per il plugin (`qualita`). */
  chiave: string;
  /** Il nome che legge una persona. L'amministratore può cambiarlo. */
  nome: string;
  /** L'area che il gruppo governa, se ne governa una (`QUALITY`). */
  area?: string | null;
}

const CHIAVE_VALIDA = /^[a-z][a-z0-9_-]{0,63}$/;

function controlla(nick: string | null | undefined, chiave: string): string {
  if (!nick) throw new Error("un gruppo di plugin vuole il nick del plugin: dichiaralo nel manifesto");
  if (!CHIAVE_VALIDA.test(chiave)) {
    throw new Error(`chiave "${chiave}" non valida: minuscole, cifre, trattino e trattino basso`);
  }
  return chiave;
}

const dto = (
  g: { id: string; name: string; managedArea: string | null; pluginRef: string | null },
  origine: GruppoPerPlugin["origine"],
): GruppoPerPlugin => ({
  id: g.id,
  nome: g.name,
  area: g.managedArea,
  chiave: g.pluginRef ?? "",
  origine,
});

/**
 * Il gruppo di quel plugin con quella chiave, o `null` se non c'è (mai
 * cercato per nome: il nome è dell'amministratore e cambia).
 */
export async function leggiGruppoDelPlugin(
  nick: string | null | undefined,
  chiave: string,
): Promise<GruppoPerPlugin | null> {
  controlla(nick, chiave);
  const g = await prisma.group.findFirst({ where: { pluginNick: nick, pluginRef: chiave } });
  return g ? dto(g, "esistente") : null;
}

/**
 * Crea il gruppo se manca, e lo torna. Idempotente sulla coppia (nick,
 * chiave), non sul nome.
 *
 * **L'adozione**: se esiste già un gruppo con quel nome e nessun plugin lo
 * rivendica, questo lo prende invece di crearne un secondo — è quasi sempre
 * il gruppo che un amministratore aveva fatto a mano, e due gruppi «Qualità»
 * sono peggio di qualunque sorpresa. I membri non si toccano: il marchio è
 * l'unica cosa che cambia (più l'area, se non ne aveva una).
 */
export async function assicuraGruppoPerPlugin(
  nick: string | null | undefined,
  input: NuovoGruppoDaPlugin,
): Promise<GruppoPerPlugin> {
  const chiave = controlla(nick, input.chiave);
  const nome = String(input.nome ?? "").trim();
  if (!nome) throw new Error("un gruppo vuole un nome");
  const area = input.area ?? null;
  if (area !== null && !(Object.values(ActivityCategory) as string[]).includes(area)) {
    throw new Error(`area "${area}" sconosciuta`);
  }

  const gia = await prisma.group.findFirst({ where: { pluginNick: nick, pluginRef: chiave } });
  if (gia) return dto(gia, "esistente");

  const omonimo = await prisma.group.findUnique({ where: { name: nome } });
  if (omonimo) {
    if (omonimo.pluginNick && omonimo.pluginNick !== nick) {
      throw new Error(`il gruppo "${nome}" è già del plugin ${omonimo.pluginNick}`);
    }
    const adottato = await prisma.group.update({
      where: { id: omonimo.id },
      data: {
        pluginNick: nick,
        pluginRef: chiave,
        // un'area già scelta da una persona non si sovrascrive
        ...(omonimo.managedArea === null && area !== null ? { managedArea: area } : {}),
      },
    });
    return dto(adottato, "adottato");
  }

  // Nella dimostrazione non si scrive niente, come per i task e gli allegati.
  if (config.demo) throw new Error("Nella dimostrazione non si creano gruppi.");
  const creato = await prisma.group.create({
    data: { name: nome, managedArea: area, pluginNick: nick, pluginRef: chiave },
  });
  return dto(creato, "creato");
}

/** I membri di un gruppo del plugin: chi c'è dentro e chi lo gestisce. */
export async function membriGruppoDelPlugin(
  nick: string | null | undefined,
  chiave: string,
): Promise<Array<{ id: string; name: string; isManager: boolean }>> {
  controlla(nick, chiave);
  const g = await prisma.group.findFirst({
    where: { pluginNick: nick, pluginRef: chiave },
    include: { members: { include: { user: true } } },
  });
  if (!g) return [];
  return g.members
    .filter((m) => m.user.isActive)
    .map((m) => ({ id: m.user.id, name: m.user.name, isManager: m.isManager }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * **Cosa ha lasciato un plugin nel core.** Serve alla disinstallazione, che
 * ancora non c'è: il conto si può chiedere oggi, e il giorno che servirà
 * risponderà con dei numeri invece che con un'alzata di spalle.
 */
export async function inventarioDelPlugin(nick: string): Promise<{
  nick: string;
  gruppi: number;
  task: number;
  allegati: number;
}> {
  const [gruppi, task, allegati] = await Promise.all([
    prisma.group.count({ where: { pluginNick: nick } }),
    prisma.task.count({ where: { pluginNick: nick } }),
    prisma.attachment.count({ where: { pluginNick: nick } }),
  ]);
  return { nick, gruppi, task, allegati };
}

/**
 * **Questa persona sta nel gruppo di quel plugin?** Risposta secca, per il
 * menù: chi non c'è non vede la voce. L'amministratore c'è sempre — è chi
 * mette dentro gli altri, e una voce che sparisce a chi deve configurarla è
 * un vicolo cieco.
 */
export async function utenteNelGruppoDelPlugin(nick: string, userId: string): Promise<boolean> {
  const riga = await prisma.groupMember.findFirst({
    where: { userId, group: { pluginNick: nick } },
    select: { userId: true },
  });
  return Boolean(riga);
}
