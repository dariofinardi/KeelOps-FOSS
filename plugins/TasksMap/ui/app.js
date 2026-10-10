// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

// TasksMap UI. External file on purpose: the core CSP allows same-origin
// scripts ('self') and blocks inline ones - no CSP weakening needed.
"use strict";
const TAVOLA = ["#1c7ed6","#0f9d58","#e8590c","#9c36b5","#c2255c","#0b7285","#5c940d",
                "#d9480f","#364fc7","#a61e4d","#087f5b","#b35c00","#5f3dc4","#2b8a3e"];
const $ = (id) => document.getElementById(id);
const t = (key, params) => window.i18n.t(key, params);
const canvas = $("canvas"), ctx = canvas.getContext("2d");
/**
 * La faccia in vigore per i colori della tela: la scrive `tema.js` dell'SDK
 * su `data-tema`, guardando l'applicazione che ospita la pagina. Prima si
 * leggeva `prefers-color-scheme`, che è il sistema operativo: con l'app in
 * chiaro su una macchina scura la mappa restava scura (07/09/2026).
 */
const scuro = () => document.documentElement.dataset.tema === "dark";

const state = {
  map: null, nodes: [], finestra: 7, selectedNode: null, hovered: -1,
  gruppo: localStorage.getItem("kancrm-mappa-gruppo") ?? "tema",   // grouping: tema | assegnatario
  selezione: null,   // selected group id ("t:3", "a:Nome")
  evidenzia: null,   // Set of node indices kept lit by the selection
  layers: { tema: true, ger: true, tempo: false, co: false, sug: false, chiusi: true },
  focus: null,   // { node, set }: only the tasks linked (even indirectly) to the clicked one
  match: null,   // Set of nodes matching the text filter (null = no filter)
  ordine: JSON.parse(localStorage.getItem("kancrm-mappa-ordine") ?? "null") ?? { campo: "nome", verso: 1 },
  ordineTemi: JSON.parse(localStorage.getItem("kancrm-mappa-ordine-temi") ?? "null") ?? { campo: "numero", verso: -1 },
  panX: 0, panY: 0, scala: 1, dragged: -1, panning: null,
};

function escapeHtml(s){ return String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;")
  .replaceAll(">","&gt;").replaceAll('"',"&quot;"); }

async function call(percorso){
  const r = await fetch(percorso);
  if (r.status === 401) {
    const info = await r.json().catch(() => ({}));
    document.body.innerHTML = `<div class="errore"><h2>${escapeHtml(t("Serve una sessione KeelOps"))}</h2>
      <p>${escapeHtml(t("Questa mappa riconosce l'utente dal cookie di KeelOps: accedi prima al gestionale, poi ricarica."))}</p>
      ${info.accedi ? `<p><a href="${escapeHtml(info.accedi)}">${escapeHtml(t("Vai all'accesso"))}</a></p>` : ""}</div>`;
    throw new Error("401");
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// the map opens from INSIDE a project (the three-dots menu passes ?progetto=)
const PROGETTO = new URLSearchParams(window.location.search).get("progetto");

function fmtDuration(ms){
  const sec = Math.max(0, Math.round(ms / 1000));
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
}

/**
 * While the server embeds the tasks, poll its progress and show a real bar:
 * done/total, elapsed, and the estimate the completed share implies.
 */
function startProgress(id){
  const started = performance.now();
  const tick = async () => {
    const elapsed = performance.now() - started;
    try {
      const s = await call(`api/mappa/${encodeURIComponent(id)}/stato`);
      if (s.attivo && s.totale) {
        const share = s.fatti / s.totale;
        $("prog-testo").textContent = t("leggo i task: {fatti} di {totale}", { fatti: s.fatti, totale: s.totale });
        $("prog-fill").classList.remove("indeterminata");
        $("prog-fill").style.width = `${Math.round(share * 100)}%`;
        $("prog-tempi").textContent = share > 0
          ? `${t("trascorso {tempo}", { tempo: fmtDuration(s.trascorsoMs) })} · ${t("stimato ancora {tempo}", { tempo: fmtDuration(s.trascorsoMs / share - s.trascorsoMs) })}`
          : t("trascorso {tempo}", { tempo: fmtDuration(s.trascorsoMs) });
        return;
      }
    } catch { /* a failed poll must never kill the map request */ }
    // nothing running (cache hit, or the build just finished): elapsed only
    $("prog-testo").textContent = t("preparo la mappa…");
    $("prog-fill").classList.add("indeterminata");
    $("prog-fill").style.width = "";
    $("prog-tempi").textContent = t("trascorso {tempo}", { tempo: fmtDuration(elapsed) });
  };
  tick();
  return setInterval(tick, 700);
}

async function loadMap(){
  if (!PROGETTO) return;
  $("veil").classList.add("acceso");
  const poll = startProgress(PROGETTO);
  try {
    state.map = await call(`api/mappa/${encodeURIComponent(PROGETTO)}?finestra=${state.finestra}`);
    window.i18n.set(state.map.lingua);
    state.selezione = null; state.evidenzia = null; setFocus(null); closePanel();
    const nome = state.map.progetto?.nome;
    if (nome) { $("progetto-nome").textContent = nome; document.title = `${nome} · Mappa dei task · KeelOps`; }
    const n = state.map.nodi.length;
    state.nodes = state.map.nodi.map((_, i) => ({
      x: Math.cos(i / n * 6.283) * 230 + (i * 37 % 83) - 41,
      y: Math.sin(i / n * 6.283) * 230 + (i * 53 % 79) - 39, vx: 0, vy: 0 }));
    renderLegend();
    state.captionBase = t("{n} task · temi da {fonte} · passa il mouse sui nodi, clicca per il dettaglio",
      { n, fonte: state.map.fonteTemi });
    applyQuery($("cerca").value);
  } finally { clearInterval(poll); $("veil").classList.remove("acceso"); }
}

/**
 * The map follows the tasks: every half minute, while the tab is visible,
 * ask the server for the stamp of the set as this user sees it now, and
 * reload when it moved (a task added, closed, retitled — or made visible).
 */
setInterval(async () => {
  if (!PROGETTO || !state.map?.impronta || document.visibilityState !== "visible") return;
  try {
    const { impronta } = await call(`api/mappa/${encodeURIComponent(PROGETTO)}/impronta`);
    if (impronta && impronta !== state.map.impronta) await loadMap();
  } catch { /* a failed poll is just a poll */ }
}, 30_000);

/** The groups the left card shows: by theme or by assignee, same shape. */
function buildGroups(){
  const grigio = scuro() ? "#5a636d" : "#aab2ba";
  if (state.gruppo === "assegnatario") {
    const per = new Map();
    state.map.nodi.forEach((nodo, i) => {
      const nome = nodo.assegnatario ?? t("Senza assegnatario");
      (per.get(nome) ?? per.set(nome, []).get(nome)).push(i);
    });
    return [...per.entries()].map(([nome, indices], ordinal) => ({
      id: `a:${nome}`, nome, indices,
      colore: nome === t("Senza assegnatario") ? grigio : TAVOLA[ordinal % TAVOLA.length] }));
  }
  const per = new Map();
  state.map.nodi.forEach((nodo, i) =>
    (per.get(nodo.tema) ?? per.set(nodo.tema, []).get(nodo.tema)).push(i));
  const groups = state.map.temi.map((nome, k) => ({
    id: `t:${k}`, nome, indices: per.get(k) ?? [], colore: TAVOLA[k % TAVOLA.length] }));
  if (per.get(-1)?.length)   // a zero counter is not shown, like everywhere else
    groups.push({ id: "t:-1", nome: t("fuori tema"), indices: per.get(-1), colore: grigio });
  return groups;
}

function clearSelection(){ state.selezione = null; state.evidenzia = null; }

function renderLegend(){
  const el = $("legend-corpo");
  $("legend").hidden = false;
  const { campo, verso } = state.ordineTemi;
  const groups = buildGroups().sort((a, b) =>
    (campo === "nome" ? a.nome.localeCompare(b.nome) : a.indices.length - b.indices.length) * verso);
  el.innerHTML = `<div class="gruppa">${[["tema", "Tema"], ["assegnatario", "Assegnatario"]].map(([modo, label]) => `
      <button data-modo="${modo}" aria-pressed="${state.gruppo === modo}">${escapeHtml(t(label))}</button>`).join("")}
    </div>
    <div class="ordina">${[["nome", "Nome"], ["numero", "Numero"]].map(([c, label]) => `
      <button data-campo="${c}" aria-pressed="${campo === c}">${escapeHtml(t(label))}${
        campo === c ? (verso === 1 ? FRECCIA_SU : FRECCIA_GIU) : ""}</button>`).join("")}
    </div>` +
  groups.map((g) => `
    <button class="voce" data-gruppo="${escapeHtml(g.id)}" aria-pressed="${state.selezione === g.id}">
      <span class="pallino" style="background:${g.colore}"></span>
      <span>${escapeHtml(g.nome)} (${g.indices.length})</span></button>`).join("");
  el.querySelectorAll(".gruppa button").forEach((b) => b.addEventListener("click", () => {
    state.gruppo = b.dataset.modo;
    localStorage.setItem("kancrm-mappa-gruppo", state.gruppo);
    clearSelection(); closePanel(); renderLegend();
  }));
  el.querySelectorAll(".ordina button").forEach((b) => b.addEventListener("click", () => {
    const c = b.dataset.campo;
    state.ordineTemi = { campo: c, verso: state.ordineTemi.campo === c ? -state.ordineTemi.verso : 1 };
    localStorage.setItem("kancrm-mappa-ordine-temi", JSON.stringify(state.ordineTemi));
    renderLegend();
  }));
  el.querySelectorAll(".voce").forEach((b) => b.addEventListener("click", () => {
    const group = buildGroups().find((g) => g.id === b.dataset.gruppo);
    if (!group || state.selezione === group.id) { clearSelection(); renderLegend(); closePanel(); return; }
    state.selezione = group.id;
    state.evidenzia = new Set(group.indices);
    renderLegend();
    navigate({ tipo: "gruppo", gruppo: group }, { reset: true });
  }));
}

/* ---------- panels ---------- */
function closePanel(){ $("pannello").classList.remove("aperto");
  $("pannello-corpo").innerHTML = ""; $("pannello-titolo").textContent = "";
  state.selectedNode = null; nav.stack = []; $("pannello-indietro").hidden = true; }
function openPanel(titolo){ $("pannello-titolo").textContent = titolo;
  $("pannello").classList.add("aperto"); }

/* ---------- panel navigation: a tiny view stack, back goes up ---------- */
const nav = { stack: [] };
function navigate(view, { reset = false, push = true } = {}){
  if (reset) nav.stack = [];
  if (push) nav.stack.push(view);
  if (view.tipo === "gruppo") groupPanel(view.gruppo); else openTask(view.i);
  $("pannello-indietro").hidden = nav.stack.length < 2;
}

const CAMPI_ORDINE = [["nome", "Nome"], ["creazione", "Creazione"], ["aggiornamento", "Aggiornamento"]];
const FRECCIA_SU = '<svg class="icona" viewBox="0 0 24 24"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>';
const FRECCIA_GIU = '<svg class="icona" viewBox="0 0 24 24"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>';

function sortMembers(members){
  const { campo, verso } = state.ordine;
  return [...members].sort((a, b) => {
    if (campo === "nome") return a.titolo.localeCompare(b.titolo) * verso;
    const va = campo === "creazione" ? a.apertura : a.aggiornamento;
    const vb = campo === "creazione" ? b.apertura : b.aggiornamento;
    return ((va ?? -Infinity) - (vb ?? -Infinity)) * verso;
  });
}

function groupPanel(group){
  const members = group.indices.map((i) => ({ ...state.map.nodi[i], i }));
  const openCount = members.filter((m) => !m.chiuso).length;
  const corpo = $("pannello-corpo");
  corpo.innerHTML = `
    <dl><dt>${escapeHtml(t("Task"))}</dt><dd>${members.length}</dd>
        <dt>${escapeHtml(t("Aperti"))}</dt><dd>${openCount}</dd>
        <dt>${escapeHtml(t("Chiusi"))}</dt><dd>${members.length - openCount}</dd></dl>
    <div class="ordina">${CAMPI_ORDINE.map(([campo, label]) => `
      <button data-campo="${campo}" aria-pressed="${state.ordine.campo === campo}">${escapeHtml(t(label))}${
        state.ordine.campo === campo ? (state.ordine.verso === 1 ? FRECCIA_SU : FRECCIA_GIU) : ""}</button>`).join("")}
    </div>
    <ul>${sortMembers(members).map((m) => `<li data-i="${m.i}" class="${m.chiuso ? "chiuso" : ""}">
      <span class="pallino" style="background:${group.colore}"></span>
      <span>${escapeHtml(m.titolo)}</span></li>`).join("")}</ul>`;
  openPanel(group.nome);
  // same field flips the direction, a new field starts ascending
  corpo.querySelectorAll(".ordina button").forEach((b) => b.addEventListener("click", () => {
    const campo = b.dataset.campo;
    state.ordine = { campo, verso: state.ordine.campo === campo ? -state.ordine.verso : 1 };
    localStorage.setItem("kancrm-mappa-ordine", JSON.stringify(state.ordine));
    groupPanel(group);
  }));
  corpo.querySelectorAll("li").forEach((li) =>
    li.addEventListener("click", () => navigate({ tipo: "task", i: Number(li.dataset.i) })));
}

async function openTask(i){
  state.selectedNode = i;
  const nodo = state.map.nodi[i];
  const corpo = $("pannello-corpo");
  corpo.innerHTML = `<p>${escapeHtml(t("carico…"))}</p>`;
  openPanel(nodo.titolo);
  try {
    const d = await call(`api/task/${encodeURIComponent(nodo.id)}`);
    openPanel(d.title);
    corpo.innerHTML = `
      <dl>
        ${d.project ? `<dt>${escapeHtml(t("Progetto"))}</dt><dd>${escapeHtml(d.project)}</dd>` : ""}
        ${d.status ? `<dt>${escapeHtml(t("Stato"))}</dt><dd>${escapeHtml(d.status)}</dd>` : ""}
        ${d.assignee ? `<dt>${escapeHtml(t("Assegnatario"))}</dt><dd>${escapeHtml(d.assignee)}</dd>` : ""}
        ${d.supervisor ? `<dt>${escapeHtml(t("Supervisore"))}</dt><dd>${escapeHtml(d.supervisor)}</dd>` : ""}
        <dt>${escapeHtml(t("Aperto"))}</dt><dd>${escapeHtml(d.createdAt ?? "—")}</dd>
        ${d.dueDate ? `<dt>${escapeHtml(t("Scadenza"))}</dt><dd>${escapeHtml(d.dueDate)}</dd>` : ""}
        ${d.closedAt ? `<dt>${escapeHtml(t("Chiuso"))}</dt><dd>${escapeHtml(d.closedAt)}</dd>` : ""}
        ${d.hours != null ? `<dt>${escapeHtml(t("Ore"))}</dt><dd>${d.hours}</dd>` : ""}
        <dt>${escapeHtml(t("Chat"))}</dt><dd>${escapeHtml(t("{n} messaggi", { n: d.comments }))}</dd>
        <dt>${escapeHtml(t("Allegati"))}</dt><dd>${d.attachments}</dd>
      </dl>
      <div class="azioni">
        <button id="bt-solo" data-i="${i}" aria-pressed="${state.focus?.node === i}">${
          escapeHtml(state.focus?.node === i ? t("Mostra tutto") : t("Solo i collegati"))}</button>
        ${d.apri ? `<a class="apri" href="${escapeHtml(d.apri)}" target="_blank" rel="noopener">${
          escapeHtml(t("Apri in KeelOps"))} <svg class="icona" viewBox="0 0 24 24"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg></a>` : ""}
      </div>
      ${d.text ? `<div class="descrizione">${escapeHtml(d.text)}</div>` : ""}`;
    corpo.querySelector("#bt-solo").addEventListener("click", () =>
      setFocus(state.focus?.node === i ? null : i));
  } catch {
    corpo.innerHTML = `<p>${escapeHtml(t("dettaglio non disponibile"))}</p>`;
  }
}

/* ---------- drawing and physics ---------- */
function baseVisible(i){ return state.layers.chiusi || !state.map.nodi[i].chiuso; }
function isVisible(i){ return baseVisible(i) && (!state.focus || state.focus.set.has(i)); }

/* ---------- text filter: matching nodes stay lit, the rest fades ---------- */

function applyQuery(query){
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length || !state.map) { state.match = null; }
  else {
    state.match = new Set();
    state.map.nodi.forEach((nodo, i) => {
      const testo = `${nodo.titolo} ${nodo.assegnatario ?? ""}`.toLowerCase();
      if (tokens.every((tok) => testo.includes(tok))) state.match.add(i);
    });
  }
  if (state.map) $("caption").textContent = state.match
    ? t("{n} task corrispondono a «{q}»", { n: state.match.size, q: query.trim() })
    : state.captionBase ?? "";
}

/* ---------- focus on the clicked task's connected component ---------- */

/** BFS over the ACTIVE layers' edges (undirected): what "linked" means on screen. */
function reachableFrom(start){
  const adj = new Map();
  const a = state.map.archi;
  const pools = [];
  if (state.layers.tema) pools.push(a.tema);
  if (state.layers.ger) pools.push(a.gerarchia);
  if (state.layers.tempo) pools.push(a.tempo);
  if (state.layers.co) pools.push(a.colavoro);
  if (state.layers.sug) pools.push(a.suggeriti);
  for (const pool of pools) for (const [i, j] of pool) {
    if (!baseVisible(i) || !baseVisible(j)) continue;
    (adj.get(i) ?? adj.set(i, []).get(i)).push(j);
    (adj.get(j) ?? adj.set(j, []).get(j)).push(i);
  }
  const seen = new Set([start]), coda = [start];
  while (coda.length) for (const next of adj.get(coda.pop()) ?? [])
    if (!seen.has(next)) { seen.add(next); coda.push(next); }
  return seen;
}

function setFocus(i){
  state.focus = i == null ? null : { node: i, set: reachableFrom(i) };
  const chip = $("focus-off");
  if (state.focus) {
    chip.hidden = false;
    chip.textContent = t("{n} collegati a «{titolo}» — mostra tutto",
      { n: state.focus.set.size, titolo: state.map.nodi[i].titolo });
  } else chip.hidden = true;
  const inPanel = document.getElementById("bt-solo");
  if (inPanel) {
    inPanel.setAttribute("aria-pressed", String(state.focus?.node === Number(inPanel.dataset.i)));
    inPanel.textContent = state.focus?.node === Number(inPanel.dataset.i) ? t("Mostra tutto") : t("Solo i collegati");
  }
}

/** the linked set depends on the active layers: recompute when they change */
function refreshFocus(){ if (state.focus) setFocus(state.focus.node); }
function activeEdges(){
  if (!state.map) return [];
  const a = state.map.archi, out = [];
  if (state.layers.tema) for (const [i, j] of a.tema) out.push([i, j, "tema"]);
  if (state.layers.ger) for (const [i, j, tipo] of a.gerarchia) out.push([i, j, tipo === "sequenza" ? "seq" : "ger"]);
  if (state.layers.tempo) for (const [i, j] of a.tempo) out.push([i, j, "tempo"]);
  if (state.layers.co) for (const [i, j] of a.colavoro) out.push([i, j, "co"]);
  if (state.layers.sug) for (const [i, j] of a.suggeriti) out.push([i, j, "sug"]);
  return out.filter(([i, j]) => isVisible(i) && isVisible(j));
}

function step(){
  if (!state.map) return;
  const nodes = state.nodes, n = nodes.length;
  for (let i = 0; i < n; i += 1) { if (!isVisible(i)) continue;
    for (let j = i + 1; j < n; j += 1) { if (!isVisible(j)) continue;
      const dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
      const d2 = dx * dx + dy * dy + 0.01;
      if (d2 < 90000) { const f = 9 / d2;
        nodes[i].vx -= dx * f; nodes[i].vy -= dy * f; nodes[j].vx += dx * f; nodes[j].vy += dy * f; } } }
  for (const [i, j] of activeEdges()) {
    const dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
    const d = Math.hypot(dx, dy) || 1, f = (d - 48) * 0.04;
    nodes[i].vx += dx / d * f; nodes[i].vy += dy / d * f;
    nodes[j].vx -= dx / d * f; nodes[j].vy -= dy / d * f;
  }
  const centers = new Map();
  state.map.nodi.forEach((nodo, i) => { if (nodo.tema < 0 || !isVisible(i)) return;
    const c = centers.get(nodo.tema) ?? { x: 0, y: 0, n: 0 };
    c.x += nodes[i].x; c.y += nodes[i].y; c.n += 1; centers.set(nodo.tema, c); });
  state.map.nodi.forEach((nodo, i) => { const c = centers.get(nodo.tema);
    if (!c || !isVisible(i)) return;
    nodes[i].vx += (c.x / c.n - nodes[i].x) * 0.004; nodes[i].vy += (c.y / c.n - nodes[i].y) * 0.004; });
  for (let i = 0; i < n; i += 1) { if (i === state.dragged) continue;
    nodes[i].vx *= 0.85; nodes[i].vy *= 0.85;
    nodes[i].x += nodes[i].vx; nodes[i].y += nodes[i].vy;
    nodes[i].x -= nodes[i].x * 0.002; nodes[i].y -= nodes[i].y * 0.002; }
}

function render(){
  const r = canvas.getBoundingClientRect();
  // Both sides: the area also changes height alone (a panel opening, the
  // window resized vertically), and a bitmap left at the old height was never
  // cleared below — old frames piled up there, stretched (24/09/2026).
  const w = Math.round(r.width * devicePixelRatio), h = Math.round(r.height * devicePixelRatio);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  if (!state.map) return;
  ctx.save(); ctx.translate(r.width / 2 + state.panX, r.height / 2 + state.panY); ctx.scale(state.scala, state.scala);
  const dark = scuro(), nodes = state.nodes;
  const STILI = {
    tema: [dark ? "rgba(140,180,210,.32)" : "rgba(28,74,99,.25)", 1.2, []],
    ger:  [dark ? "rgba(217,160,104,.75)" : "rgba(154,91,44,.65)", 1.8, []],
    seq:  [dark ? "rgba(217,160,104,.75)" : "rgba(154,91,44,.65)", 1.8, [6, 3]],
    tempo:[dark ? "rgba(150,160,170,.35)" : "rgba(92,101,112,.28)", 1, [2, 3]],
    co:   [dark ? "rgba(130,188,216,.5)" : "rgba(28,74,99,.4)", 1, [4, 3]],
    sug:  [dark ? "rgba(95,196,166,.8)" : "rgba(15,92,74,.6)", 1.6, [5, 4]],
  };
  for (const [i, j, tipo] of activeEdges()) {
    const [color, spessore, tratteggio] = STILI[tipo];
    const dentro = !state.evidenzia || (state.evidenzia.has(i) && state.evidenzia.has(j));
    const corrisponde = !state.match || (state.match.has(i) && state.match.has(j));
    ctx.globalAlpha = (dentro ? 1 : 0.12) * (corrisponde ? 1 : 0.08);
    ctx.strokeStyle = color; ctx.lineWidth = spessore; ctx.setLineDash(tratteggio);
    ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke();
    if (tipo === "sug" || tipo === "ger") {   // arrow on the parent → child direction
      const dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y, d = Math.hypot(dx, dy) || 1;
      const px = nodes[j].x - dx / d * 10, py = nodes[j].y - dy / d * 10;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(px - dy / d * 3.5, py + dx / d * 3.5);
      ctx.lineTo(nodes[j].x - dx / d * 4, nodes[j].y - dy / d * 4);
      ctx.lineTo(px + dy / d * 3.5, py - dx / d * 3.5); ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  state.map.nodi.forEach((nodo, i) => {
    if (!isVisible(i)) return;
    const color = nodo.tema >= 0 ? TAVOLA[nodo.tema % TAVOLA.length] : (dark ? "#5a636d" : "#aab2ba");
    const fuoriTema = Boolean(state.evidenzia) && !state.evidenzia.has(i);
    const trovato = state.match?.has(i) ?? false;
    ctx.globalAlpha = (nodo.chiuso ? 0.38 : 1) * (fuoriTema ? 0.15 : 1)
      * (state.match && !trovato ? 0.08 : 1);
    ctx.beginPath();
    ctx.arc(nodes[i].x, nodes[i].y, i === state.hovered || i === state.selectedNode || trovato ? 8 : 5.5, 0, 6.283);
    ctx.fillStyle = color; ctx.fill();
    if (i === state.hovered || i === state.selectedNode || trovato) {
      ctx.globalAlpha = 1; ctx.strokeStyle = dark ? "#e7eaed" : "#181d24"; ctx.lineWidth = 1.5; ctx.stroke();
    }
  });
  ctx.globalAlpha = 1; ctx.restore();
}
(function loop(){ step(); render(); requestAnimationFrame(loop); })();

/* ---------- interaction ---------- */
function fromScreen(ev){
  const r = canvas.getBoundingClientRect();
  return { x: (ev.clientX - r.left - r.width / 2 - state.panX) / state.scala,
           y: (ev.clientY - r.top - r.height / 2 - state.panY) / state.scala };
}
function nodeAt(p){
  if (!state.map) return -1;
  let best = -1, bd = 160;
  state.nodes.forEach((nodo, i) => { if (!isVisible(i)) return;
    const d = (nodo.x - p.x) ** 2 + (nodo.y - p.y) ** 2;
    if (d < bd) { bd = d; best = i; } });
  return best;
}
canvas.addEventListener("pointerdown", (ev) => {
  const i = nodeAt(fromScreen(ev));
  if (i >= 0) { state.dragged = i; state.moved = false; }
  else state.panning = { x: ev.clientX - state.panX, y: ev.clientY - state.panY };
  canvas.setPointerCapture(ev.pointerId);
});
canvas.addEventListener("pointermove", (ev) => {
  if (state.panning) { state.panX = ev.clientX - state.panning.x; state.panY = ev.clientY - state.panning.y; return; }
  const p = fromScreen(ev);
  if (state.dragged >= 0) {
    state.moved = true;
    state.nodes[state.dragged].x = p.x; state.nodes[state.dragged].y = p.y; return;
  }
  state.hovered = nodeAt(p);
  if (state.hovered >= 0 && state.map) {
    const nodo = state.map.nodi[state.hovered];
    const tema = nodo.tema >= 0 ? state.map.temi[nodo.tema] : t("fuori tema");
    $("caption").textContent = `${nodo.titolo}${nodo.chiuso ? " · chiuso" : ""}${nodo.assegnatario ? " · " + nodo.assegnatario : ""} · ${tema}`;
  }
});
canvas.addEventListener("pointerup", () => {
  if (state.dragged >= 0 && !state.moved)
    navigate({ tipo: "task", i: state.dragged }, { reset: true });   // plain click = open detail
  state.dragged = -1; state.panning = null;
});
canvas.addEventListener("wheel", (ev) => { ev.preventDefault();
  state.scala = Math.min(3, Math.max(0.3, state.scala * (ev.deltaY < 0 ? 1.1 : 0.9))); }, { passive: false });
addEventListener("keydown", (ev) => { if (ev.key === "Escape") {
  if ($("cerca").value) { $("cerca").value = ""; applyQuery(""); return; }
  clearSelection();
  if (state.map) renderLegend(); closePanel(); } });
$("cerca").addEventListener("input", () => applyQuery($("cerca").value));

for (const [id, chiave] of [["bt-tema","tema"],["bt-ger","ger"],["bt-tempo","tempo"],
                            ["bt-co","co"],["bt-sug","sug"],["bt-chiusi","chiusi"]]) {
  $(id).addEventListener("click", function(){
    state.layers[chiave] = !state.layers[chiave];
    this.setAttribute("aria-pressed", String(state.layers[chiave]));
    refreshFocus();
  });
}
document.querySelectorAll("[data-finestra]").forEach((b) => b.addEventListener("click", async () => {
  state.finestra = Number(b.dataset.finestra);
  document.querySelectorAll("[data-finestra]").forEach((x) =>
    x.setAttribute("aria-pressed", String(x === b)));
  state.layers.tempo = true; $("bt-tempo").setAttribute("aria-pressed", "true");
  if (PROGETTO) {
    const d = await call(`api/mappa/${encodeURIComponent(PROGETTO)}?finestra=${state.finestra}`);
    if (state.map) state.map.archi.tempo = d.archi.tempo;   // only the time layer changes
    refreshFocus();
  }
}));
$("focus-off").addEventListener("click", () => setFocus(null));
/* ---------- floating panels: draggable and collapsible, remembered ---------- */

function floating(el, headerId, collapseId, storageKey){
  const header = $(headerId);
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
  const main = document.querySelector("main");
  const remember = () => {
    const m = main.getBoundingClientRect(), r = el.getBoundingClientRect();
    localStorage.setItem(storageKey, JSON.stringify({
      x: r.left - m.left, y: r.top - m.top, chiuso: el.classList.contains("collassato") }));
  };
  const place = (x, y) => {
    const m = main.getBoundingClientRect(), r = el.getBoundingClientRect();
    el.style.left = `${Math.min(Math.max(x, 0), Math.max(0, m.width - r.width))}px`;
    el.style.top = `${Math.min(Math.max(y, 0), Math.max(0, m.height - 40))}px`;
    el.style.right = "auto";
  };
  if (saved) {
    if (saved.chiuso) el.classList.add("collassato");
    if (saved.x != null) place(saved.x, saved.y);
  }
  $(collapseId).addEventListener("click", () => {
    el.classList.toggle("collassato");
    $(collapseId).dataset.i18nTitle = el.classList.contains("collassato") ? "Espandi" : "Comprimi";
    window.i18n.apply();
    remember();
  });
  header.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest("button")) return;
    ev.preventDefault();
    const m = main.getBoundingClientRect(), r = el.getBoundingClientRect();
    const dx = ev.clientX - r.left, dy = ev.clientY - r.top;
    const move = (e) => place(e.clientX - m.left - dx, e.clientY - m.top - dy);
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); remember(); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  });
}
floating($("legend"), "legend-testata", "legend-collassa", "kancrm-mappa-legenda");
floating($("pannello"), "pannello-testata", "pannello-collassa", "kancrm-mappa-pannello");
$("pannello-indietro").addEventListener("click", () => {
  nav.stack.pop();
  const prev = nav.stack[nav.stack.length - 1];
  if (prev) navigate(prev, { push: false }); else closePanel();
});
$("pannello-chiudi").addEventListener("click", () => {
  if (state.selezione !== null) { clearSelection(); renderLegend(); }
  closePanel();
});

if (PROGETTO) loadMap().catch(() => {});
else $("caption").textContent = t("questa mappa si apre da un progetto: menu ⋯ nella pagina del progetto");
