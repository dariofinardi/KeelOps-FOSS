/**
 * **The edition, as the MCP tools see it** (08/10/2026).
 *
 * A community core has no timesheet, no support requests and no won-deal
 * analysis. A tool built on them is **hidden**, not answered empty: "you
 * worked 0 hours" would be false. Mixed tools drop the fields that have no
 * data behind them.
 *
 * The functions come from `ctx.funzioni` and travel on the user object the
 * routes build (`user.funzioni`): `buildTools(db, user, …)` keeps its
 * signature, which MCP-pro calls too. No `funzioni` (standalone mode, an
 * older core) means everything — the behaviour before editions.
 */

/** The user's core has `funzione` (`timesheet`, `ticket`, `analisi-offerte`…). */
export const ha = (user, funzione) => !user?.funzioni || user.funzioni.has(funzione);

/** The tool can be offered: it declares no `richiede`, or the core has it. */
export const offribile = (tool, user) => !tool.richiede || ha(user, tool.richiede);

/** Keep `campi` only if `condizione`: for spreading into a result. */
export const se = (condizione, campi) => (condizione ? campi : {});
