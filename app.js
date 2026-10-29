const $ = (s) => document.querySelector(s);
const dateInput = $("#date");
let fixtures = [];

// ---------- Utilidades ----------
const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const f1 = (n) => n.toFixed(1);
const hhmm = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

async function sofa(path) {
  const key = "sofa:" + path;
  const cached = sessionStorage.getItem(key);
  if (cached) return JSON.parse(cached);
  const r = await fetch("/api/sofa/" + path);
  if (!r.ok) throw new Error(r.status === 403 ? "O Sofascore bloqueou a requisição (403). Tente de novo mais tarde ou de outra rede." : "Erro " + r.status + " ao consultar o Sofascore.");
  const j = await r.json();
  sessionStorage.setItem(key, JSON.stringify(j));
  return j;
}

// Converte um evento do Sofascore para o formato usado pela interface
const img = (p) => "/api/sofa-img/" + p;
function normEvent(e) {
  const ut = e.tournament?.uniqueTournament;
  return {
    fixture: { id: e.id, timestamp: e.startTimestamp, date: new Date(e.startTimestamp * 1000).toISOString() },
    league: { name: e.tournament?.name || "Outros", country: e.tournament?.category?.name || "Mundo", logo: ut ? img("unique-tournament/" + ut.id + "/image") : "" },
    teams: {
      home: { id: e.homeTeam.id, name: e.homeTeam.name, logo: img("team/" + e.homeTeam.id + "/image") },
      away: { id: e.awayTeam.id, name: e.awayTeam.name, logo: img("team/" + e.awayTeam.id + "/image") },
    },
    goals: { home: e.homeScore?.current ?? null, away: e.awayScore?.current ?? null },
  };
}

// ---------- Lista de jogos (esquerda) ----------
async function loadDay() {
  $("#leagues").innerHTML = '<div class="spinner"></div>';
  $("#detail").innerHTML = '<div class="empty">Selecione uma partida à esquerda para ver os palpites.</div>';
  try {
    fixtures = (await sofa("sport/football/scheduled-events/" + dateInput.value)).events.map(normEvent);
    renderList();
  } catch (e) {
    $("#leagues").innerHTML = `<div class="err">${e.message}</div>`;
  }
}

function renderList() {
  const q = $("#filter").value.trim().toLowerCase();
  const groups = {};
  fixtures
    .filter((f) => !q || (f.teams.home.name + f.teams.away.name + f.league.name + f.league.country).toLowerCase().includes(q))
    .forEach((f) => {
      const k = f.league.country + " — " + f.league.name;
      (groups[k] ||= { logo: f.league.logo, list: [] }).list.push(f);
    });

  const names = Object.keys(groups).sort((a, b) => a.localeCompare(b));
  if (!names.length) { $("#leagues").innerHTML = '<p class="muted">Nenhum jogo encontrado.</p>'; return; }

  $("#leagues").innerHTML = names.map((n) => `
    <details ${q ? "open" : ""}>
      <summary><img src="${groups[n].logo || ""}" alt="">${n}<span class="count">${groups[n].list.length}</span></summary>
      ${groups[n].list.sort((a, b) => a.fixture.timestamp - b.fixture.timestamp).map((f) => `
        <div class="match" data-id="${f.fixture.id}">
          <span class="time">${hhmm(f.fixture.date)}</span>
          <span class="teams">${f.teams.home.name}<br>${f.teams.away.name}</span>
          <span class="score">${f.goals.home ?? ""}<br>${f.goals.away ?? ""}</span>
        </div>`).join("")}
    </details>`).join("");

  document.querySelectorAll(".match").forEach((el) =>
    el.addEventListener("click", () => {
      document.querySelectorAll(".match.active").forEach((x) => x.classList.remove("active"));
      el.classList.add("active");
      openMatch(fixtures.find((f) => f.fixture.id == el.dataset.id));
    })
  );
}

// ---------- Estatísticas dos últimos 5 jogos ----------
async function teamLast5(team) {
  const ev = (await sofa("team/" + team.id + "/events/last/0")).events || [];
  const games = ev
    .filter((e) => e.status?.type === "finished" && e.homeScore?.current != null)
    .sort((x, y) => y.startTimestamp - x.startTimestamp)
    .slice(0, 5);
  const rows = await Promise.all(
    games.map(async (g) => {
      const isHome = g.homeTeam.id === team.id;
      const gf = isHome ? g.homeScore.current : g.awayScore.current;
      const ga = isHome ? g.awayScore.current : g.homeScore.current;
      let corners = null, cards = null;
      try {
        const st = await sofa("event/" + g.id + "/statistics");
        const all = (st.statistics || []).find((p) => p.period === "ALL") || (st.statistics || [])[0];
        const items = (all?.groups || []).flatMap((x) => x.statisticsItems || []);
        const sum = (...names) => items.filter((i) => names.includes(i.name)).reduce(
          (t, i) => t + (Number(i.homeValue ?? parseFloat(i.home)) || 0) + (Number(i.awayValue ?? parseFloat(i.away)) || 0), 0);
        if (items.some((i) => i.name === "Corner kicks")) corners = sum("Corner kicks");
        if (items.some((i) => i.name === "Yellow cards" || i.name === "Red cards")) cards = sum("Yellow cards", "Red cards");
      } catch (_) {}
      return {
        adversario: (isHome ? g.awayTeam : g.homeTeam).name,
        local: isHome ? "casa" : "fora",
        placar: gf + "x" + ga,
        gf, ga, total: gf + ga, corners, cards,
        res: gf > ga ? "V" : gf < ga ? "D" : "E",
      };
    })
  );
  const nz = (k) => rows.map((r) => r[k]).filter((v) => v !== null);
  return {
    nome: team.name, logo: team.logo, jogos: rows,
    golsPro: avg(rows.map((r) => r.gf)), golsContra: avg(rows.map((r) => r.ga)),
    golsTotal: avg(rows.map((r) => r.total)),
    escanteios: avg(nz("corners")), cartoes: avg(nz("cards")),
    temStats: nz("corners").length > 0,
  };
}

// ---------- Painel da partida ----------
async function openMatch(f) {
  const d = $("#detail");
  d.innerHTML = `
    <div class="title">
      <div class="team"><img src="${f.teams.home.logo}">${f.teams.home.name}</div>
      <div class="vs">×</div>
      <div class="team"><img src="${f.teams.away.logo}">${f.teams.away.name}</div>
    </div>
    <div class="sub">${f.league.name} · ${hhmm(f.fixture.date)}</div>
    <div id="stats"><div class="spinner"></div><p class="muted" style="margin-top:0">Buscando os últimos 5 jogos de cada time...</p></div>
    <div id="ai"></div>`;

  try {
    const [h, a] = await Promise.all([teamLast5(f.teams.home), teamLast5(f.teams.away)]);
    // Média combinada: média dos totais de jogo dos dois times
    const comb = {
      gols: (h.golsTotal + a.golsTotal) / 2,
      escanteios: (h.escanteios + a.escanteios) / 2,
      cartoes: (h.cartoes + a.cartoes) / 2,
    };
    renderStats(h, a, comb);
    askAI(f, h, a, comb);
  } catch (e) {
    $("#stats").innerHTML = `<div class="err">${e.message}</div>`;
  }
}

function teamCard(t) {
  return `<div class="card">
    <h3>${t.nome} — últimos 5</h3>
    <div class="chips">${t.jogos.map((j) => `<span class="chip ${j.res}">${j.res}</span>`).join("")}</div>
    <table>
      <tr><td>Gols marcados (média)</td><td>${f1(t.golsPro)}</td></tr>
      <tr><td>Gols sofridos (média)</td><td>${f1(t.golsContra)}</td></tr>
      <tr><td>Gols por jogo (total)</td><td>${f1(t.golsTotal)}</td></tr>
      <tr><td>Escanteios por jogo (total)</td><td>${t.temStats ? f1(t.escanteios) : "—"}</td></tr>
      <tr><td>Cartões por jogo (total)</td><td>${t.temStats ? f1(t.cartoes) : "—"}</td></tr>
    </table>
    <div class="last5">${t.jogos.map((j) => `${j.placar} vs ${j.adversario} (${j.local})`).join("<br>")}</div>
  </div>`;
}

function renderStats(h, a, c) {
  $("#stats").innerHTML = `
    <div class="bigs">
      <div class="big"><div class="n">${f1(c.gols)}</div><div class="l">Média de gols</div></div>
      <div class="big"><div class="n">${h.temStats ? f1(c.escanteios) : "—"}</div><div class="l">Média de escanteios</div></div>
      <div class="big"><div class="n">${h.temStats ? f1(c.cartoes) : "—"}</div><div class="l">Média de cartões</div></div>
    </div>
    <div class="grid">${teamCard(h)}${teamCard(a)}</div>`;
}

// ---------- IA (NVIDIA via proxy) ----------
async function askAI(f, h, a, c) {
  const box = $("#ai");
  box.innerHTML = '<div class="card ai"><h3>🤖 Palpites da IA</h3><div class="spinner"></div></div>';
  const resumo = (t) => ({
    time: t.nome, golsMarcadosMedia: +f1(t.golsPro), golsSofridosMedia: +f1(t.golsContra),
    escanteiosTotaisMedia: t.temStats ? +f1(t.escanteios) : null, cartoesTotaisMedia: t.temStats ? +f1(t.cartoes) : null,
    ultimos5: t.jogos.map((j) => `${j.placar} vs ${j.adversario} (${j.local})`),
  });
  const prompt = `Partida: ${f.teams.home.name} (casa) x ${f.teams.away.name} (fora) — ${f.league.name}.
Dados reais dos últimos 5 jogos de cada equipe:
${JSON.stringify({ mandante: resumo(h), visitante: resumo(a), mediaCombinada: { gols: +f1(c.gols), escanteios: +f1(c.escanteios), cartoes: +f1(c.cartoes) } })}

Com base SOMENTE nesses dados, responda neste JSON exato:
{"resultado":{"palpite":"Casa|Empate|Fora ou dupla chance","confianca":0-100,"motivo":"..."},
"gols":{"palpite":"ex: Mais de 2.5","confianca":0-100,"motivo":"..."},
"ambasMarcam":{"palpite":"Sim|Não","confianca":0-100,"motivo":"..."},
"escanteios":{"palpite":"ex: Mais de 9.5","confianca":0-100,"motivo":"..."},
"cartoes":{"palpite":"ex: Mais de 4.5","confianca":0-100,"motivo":"..."},
"analise":"resumo de 2 a 3 frases"}`;

  try {
    const r = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || j.error || j.detail || "Erro na API da IA");
    const txt = j.choices[0].message.content.replace(/```json|```/g, "").trim();
    const p = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
    const row = (nome, x) => x ? `<div class="pick"><div>${nome}: <b>${x.palpite}</b><small>${x.motivo}</small></div><span class="conf">${x.confianca}%</span></div>` : "";
    box.innerHTML = `<div class="card ai"><h3>🤖 Palpites da IA</h3>
      ${row("Resultado", p.resultado)}${row("Gols", p.gols)}${row("Ambas marcam", p.ambasMarcam)}${row("Escanteios", p.escanteios)}${row("Cartões", p.cartoes)}
      <div class="analysis">${p.analise || ""}</div></div>
      <p class="disclaimer">Palpites são estimativas estatísticas, não garantia de resultado. Aposte com responsabilidade.</p>`;
  } catch (e) {
    box.innerHTML = `<div class="card ai"><h3>🤖 Palpites da IA</h3><div class="err">${e.message}</div></div>`;
  }
}

// ---------- Eventos ----------
function shift(days) {
  const d = new Date(dateInput.value + "T12:00:00");
  d.setDate(d.getDate() + days);
  dateInput.value = toISO(d);
  loadDay();
}
$("#prev").onclick = () => shift(-1);
$("#next").onclick = () => shift(1);
dateInput.onchange = loadDay;
$("#filter").oninput = renderList;

dateInput.value = toISO(new Date());
loadDay();
