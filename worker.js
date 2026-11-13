// Transportes · intermediário para Metro de Lisboa, comboios (IP: CP + Fertagus) e Carris Metropolitana
// Guarda a chave em Settings → Variables and Secrets → ML_BASIC (tipo Secret)
// ML_BASIC = Base64 de "ConsumerKey:ConsumerSecret"
//
// Novo: ?p=cm&u=/v2/...                     → Carris Metropolitana (passa a resposta tal como vem)
//       ?p=ip&u=/negocios-e-servicos/...    → Infraestruturas de Portugal (partidas/chegadas de todos os comboios)
// Só reencaminha para estes dois sites e só para estes caminhos.
const PROXY = {
  cm: { base: "https://api.carrismetropolitana.pt", path: /^\/v2\/[A-Za-z0-9_\-\/]+$/ },
  ip: { base: "https://www.infraestruturasdeportugal.pt", path: /^\/negocios-e-servicos\/[^?#]+$/ }
};
function ttlFor(p, u) {
  if (p === "cm" && /^\/v2\/(stops|lines|routes)$/.test(u)) return 21600; // listas: 6 h
  if (p === "ip" && /estacao-nome/.test(u)) return 86400;
  return 15; // tempos em direto
}

const DEST = {"33":"Reboleira","34":"Amadora Este","35":"Pontinha","36":"Colégio Militar/Luz","37":"Laranjeiras","38":"São Sebastião","39":"Avenida","40":"Baixa-Chiado","41":"Terreiro do Paço","42":"Santa Apolónia","43":"Odivelas","44":"Lumiar","45":"Campo Grande","46":"Campo Pequeno","48":"Rato","50":"Telheiras","51":"Alvalade","52":"Alameda","53":"Martim Moniz","54":"Cais do Sodré","56":"Bela Vista","57":"Chelas","59":"Moscavide","60":"Aeroporto"};
const LINHA = { A: "azul", B: "amarela", C: "verde", D: "vermelha" };
const ORIGENS = ["https://phillghub.github.io"];
const API = "https://api.metrolisboa.pt:8243";

let tok = null, tokExp = 0;
const LIMITE = 90;                 // pedidos por minuto por IP (a app usa ~15; o mapa ao vivo ~10)
const CONTA = { min: 0, ip: new Map() };
const CACHE_EST = new Map();
const CACHE_VAR = new Map();       // tempos recentes por estação, para o mapa da linha       // respostas recentes por estação (poupa a chave do Metro)
let est8 = null, est8t = 0;

async function estadoLinhas(env) {
  if (est8 && Date.now() - est8t < 60000) return est8;
  try {
    const r = await fetch(`${API}/estadoServicoML/1.0.1/estadoLinha/todos`, { headers: { Authorization: "Bearer " + await token(env) } });
    const j = await r.json();
    const R = j.resposta || {};
    const out = {};
    for (const l of ["amarela", "azul", "verde", "vermelha"]) {
      if (R[l] == null) continue;
      const txt = String(R[l]).trim();
      out[l] = { ok: /^ok$/i.test(txt), texto: txt };
    }
    est8 = out; est8t = Date.now();
  } catch (e) { /* estado indisponível: segue sem ele */ }
  return est8 || {};
}

async function token(env, force) {
  if (!force && tok && Date.now() < tokExp - 60000) return tok;
  const r = await fetch(API + "/token", {
    method: "POST",
    headers: { "Authorization": "Basic " + env.ML_BASIC, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  if (!r.ok) throw new Error("token HTTP " + r.status);
  const j = await r.json();
  tok = j.access_token;
  tokExp = Date.now() + (j.expires_in || 3600) * 1000;
  return tok;
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const headers = {
      "Access-Control-Allow-Origin": ORIGENS.includes(origin) ? origin : ORIGENS[0],
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Vary": "Origin",
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    };
    if (req.method === "OPTIONS") return new Response(null, { headers });

    // Proteção 1: só responde a pedidos que venham da app (endereço de origem autorizado)
    const ref = req.headers.get("Referer") || "";
    if (!ORIGENS.includes(origin) && !ORIGENS.some(o => ref.startsWith(o + "/"))) {
      return new Response(JSON.stringify({ ok: false, erro: "acesso não autorizado" }), { status: 403, headers });
    }
    // Proteção 2: no máximo LIMITE pedidos por minuto por endereço IP
    const ip = req.headers.get("CF-Connecting-IP") || "?";
    const min = Math.floor(Date.now() / 60000);
    if (CONTA.min !== min) { CONTA.min = min; CONTA.ip = new Map(); }
    // pedidos que geram muitas chamadas ao Metro contam mais (o mapa da linha pede até 20 estações)
    const nv = (new URL(req.url).searchParams.get("varias") || "").split(",").filter(Boolean).length;
    const peso = nv ? Math.max(1, Math.ceil(nv / 4)) : 1;
    const n = (CONTA.ip.get(ip) || 0) + peso;
    CONTA.ip.set(ip, n);
    if (n > LIMITE) {
      return new Response(JSON.stringify({ ok: false, erro: "demasiados pedidos — espera um minuto" }), { status: 429, headers: { ...headers, "Retry-After": "60" } });
    }

    const u = new URL(req.url);
    // Trânsito (TomTom) com a chave guardada no Worker (secret TT_KEY): ?tt=<caminho e parâmetros sem a chave>
    const tt = u.searchParams.get("tt");
    if (tt !== null) {
      if (!env.TT_KEY) return new Response(JSON.stringify({ ok: false, erro: "falta a chave TT_KEY no Worker" }), { status: 500, headers });
      if (!/^\/(routing\/1\/calculateRoute|traffic\/services\/5\/incidentDetails)\//.test(tt) || tt.includes("key=") || tt.includes("..")) {
        return new Response(JSON.stringify({ ok: false, erro: "pedido não permitido" }), { status: 400, headers });
      }
      try {
        if (/[#\s]/.test(tt)) return new Response(JSON.stringify({ ok: false, erro: "pedido não permitido" }), { status: 400, headers });
        const r = await fetch("https://api.tomtom.com" + tt + (tt.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(env.TT_KEY), {
          cf: { cacheTtlByStatus: { "200-299": 120, "300-599": 0 }, cacheEverything: true }   // 2 min: várias pessoas a ver o mesmo percurso gastam 1 só pedido
        });
        if (!r.ok) {
          // nas respostas de erro, garante que a chave nunca aparece
          const t = (await r.text()).split(env.TT_KEY).join("***");
          return new Response(t, { status: r.status, headers });
        }
        return new Response(r.body, { status: r.status, headers: { ...headers, "Cache-Control": "max-age=60" } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, erro: String(e.message || e) }), { status: 502, headers });
      }
    }
    const p = u.searchParams.get("p");
    if (p && PROXY[p]) {
      const path = u.searchParams.get("u") || "";
      if (!PROXY[p].path.test(path) || path.includes("..")) {
        return new Response(JSON.stringify({ ok: false, erro: "caminho não permitido" }), { status: 400, headers });
      }
      const ttl = ttlFor(p, path);
      try {
        const r = await fetch(PROXY[p].base + path.split("/").map(encodeURIComponent).join("/").replace(/%2C/g, ",").replace(/%3A/g, ":"), {
          headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "Referer": PROXY[p].base + "/" },
          cf: { cacheTtl: ttl, cacheEverything: true }
        });
        // Passa o corpo sem o ler (gasta quase nada de CPU no Worker)
        return new Response(r.body, { status: r.status, headers: { ...headers, "Cache-Control": "max-age=" + Math.min(ttl, 3600) } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, erro: String(e.message || e) }), { status: 502, headers });
      }
    }
    if (u.searchParams.get("lista") === "estacoes") {
      if (globalThis.__lista && Date.now() - globalThis.__lista.t < 3600000) return new Response(globalThis.__lista.body, { headers: { ...headers, "Cache-Control": "max-age=86400" } });
      try {
        let r = await fetch(`${API}/estadoServicoML/1.0.1/infoEstacao/todos`, { headers: { Authorization: "Bearer " + await token(env) } });
        if (r.status === 401) r = await fetch(`${API}/estadoServicoML/1.0.1/infoEstacao/todos`, { headers: { Authorization: "Bearer " + await token(env, true) } });
        const j = await r.json();
        const L = Array.isArray(j.resposta) ? j.resposta : [];
        const est = L.map(x => ({ id: x.stop_id, nome: x.stop_name, lat: Number(x.stop_lat), lon: Number(x.stop_lon), linhas: String(x.linha || "") }));
        const body = JSON.stringify({ ok: true, estacoes: est });
        if (est.length) globalThis.__lista = { t: Date.now(), body };
        return new Response(body, { headers: { ...headers, "Cache-Control": "max-age=86400" } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, erro: String(e.message || e) }), { status: 502, headers });
      }
    }
    if (u.searchParams.get("varias")) {
      // Tempos de várias estações de uma vez (para o mapa da linha)
      if (globalThis.__varias && Date.now() - globalThis.__varias.t < 8000 && globalThis.__varias.q === u.searchParams.get("varias")) {
        return new Response(globalThis.__varias.body, { headers });
      }
      const ids = u.searchParams.get("varias").toUpperCase().split(",").map(s => s.replace(/[^A-Z]/g, "").slice(0, 3)).filter(Boolean).slice(0, 20);
      try {
        const t1 = await token(env);
        const res = await Promise.all(ids.map(async id => {
          const c = CACHE_VAR.get(id);
          if (c && Date.now() - c.t < 8000) return c.v;
          try {
            const r = await fetch(`${API}/estadoServicoML/1.0.1/tempoEspera/Estacao/${id}`, { headers: { Authorization: "Bearer " + t1 } });
            const j = await r.json();
            if (!Array.isArray(j.resposta)) return { id, cais: [] };
            const v = { id, cais: j.resposta.map(x => ({
              linha: LINHA[String(x.comboio || "").slice(-1)] || "?",
              destino: DEST[x.destino] || String(x.destino),
              comboios: [[x.comboio, x.tempoChegada1], [x.comboio2, x.tempoChegada2], [x.comboio3, x.tempoChegada3]]
                .filter(p => p[0] && !isNaN(Number(p[1]))).map(p => ({ id: String(p[0]), s: Number(p[1]) }))
            })) };
            CACHE_VAR.set(id, { t: Date.now(), v });
            if (CACHE_VAR.size > 80) CACHE_VAR.clear();
            return v;
          } catch (e) { return { id, cais: [], erro: String(e.message || e) }; }
        }));
        const body = JSON.stringify({ ok: true, atualizado: new Date().toISOString(), estacoes: res, estado: await estadoLinhas(env) });
        globalThis.__varias = { t: Date.now(), q: u.searchParams.get("varias"), body };
        return new Response(body, { headers });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, erro: String(e.message || e) }), { status: 502, headers });
      }
    }
    const est = (new URL(req.url).searchParams.get("estacao") || "CG").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    const c = CACHE_EST.get(est);
    if (c && Date.now() - c.t < 5000) return new Response(c.body, { headers });
    try {
      const pedir = t => fetch(`${API}/estadoServicoML/1.0.1/tempoEspera/Estacao/${est}`, { headers: { Authorization: "Bearer " + t } });
      let r = await pedir(await token(env));
      if (r.status === 401) r = await pedir(await token(env, true));
      const j = await r.json();
      if (!Array.isArray(j.resposta)) {
        return new Response(JSON.stringify({ ok: true, estacao: est, atualizado: new Date().toISOString(), comboios: [], aviso: String(j.resposta || "sem dados"), codigo: j.codigo, estado: await estadoLinhas(env) }), { headers });
      }
      const comboios = j.resposta.map(x => ({
        linha: LINHA[String(x.comboio || "").slice(-1)] || "?",
        destino: DEST[x.destino] || String(x.destino),
        s: [x.tempoChegada1, x.tempoChegada2, x.tempoChegada3].map(Number).filter(n => !isNaN(n))
      }));
      const body = JSON.stringify({ ok: j.codigo === "200", estacao: est, atualizado: new Date().toISOString(), comboios, estado: await estadoLinhas(env) });
      CACHE_EST.set(est, { t: Date.now(), body });
      if (CACHE_EST.size > 80) CACHE_EST.clear();
      return new Response(body, { headers });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, erro: String(e.message || e) }), { status: 502, headers });
    }
  }
};
