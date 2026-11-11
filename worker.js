// Rápida Verde · intermediário para os tempos do Metro de Lisboa
// Guarda a chave em Settings → Variables and Secrets → ML_BASIC (tipo Secret)
// ML_BASIC = Base64 de "ConsumerKey:ConsumerSecret"

const DEST = {"33":"Reboleira","34":"Amadora Este","35":"Pontinha","36":"Colégio Militar/Luz","37":"Laranjeiras","38":"São Sebastião","39":"Avenida","40":"Baixa-Chiado","41":"Terreiro do Paço","42":"Santa Apolónia","43":"Odivelas","44":"Lumiar","45":"Campo Grande","46":"Campo Pequeno","48":"Rato","50":"Telheiras","51":"Alvalade","52":"Alameda","53":"Martim Moniz","54":"Cais do Sodré","56":"Bela Vista","57":"Chelas","59":"Moscavide","60":"Aeroporto"};
const LINHA = { A: "azul", B: "amarela", C: "verde", D: "vermelha" };
const ORIGENS = ["https://phillghub.github.io"];
const API = "https://api.metrolisboa.pt:8243";

let tok = null, tokExp = 0;
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
      "Content-Type": "application/json; charset=utf-8"
    };
    if (req.method === "OPTIONS") return new Response(null, { headers });

    const u = new URL(req.url);
    if (u.searchParams.get("lista") === "estacoes") {
      try {
        let r = await fetch(`${API}/estadoServicoML/1.0.1/infoEstacao/todos`, { headers: { Authorization: "Bearer " + await token(env) } });
        if (r.status === 401) r = await fetch(`${API}/estadoServicoML/1.0.1/infoEstacao/todos`, { headers: { Authorization: "Bearer " + await token(env, true) } });
        const j = await r.json();
        const L = Array.isArray(j.resposta) ? j.resposta : [];
        const est = L.map(x => ({ id: x.stop_id, nome: x.stop_name, lat: Number(x.stop_lat), lon: Number(x.stop_lon), linhas: String(x.linha || "") }));
        return new Response(JSON.stringify({ ok: true, estacoes: est }), { headers: { ...headers, "Cache-Control": "max-age=86400" } });
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
          try {
            const r = await fetch(`${API}/estadoServicoML/1.0.1/tempoEspera/Estacao/${id}`, { headers: { Authorization: "Bearer " + t1 } });
            const j = await r.json();
            if (!Array.isArray(j.resposta)) return { id, cais: [] };
            return { id, cais: j.resposta.map(x => ({
              linha: LINHA[String(x.comboio || "").slice(-1)] || "?",
              destino: DEST[x.destino] || String(x.destino),
              comboios: [[x.comboio, x.tempoChegada1], [x.comboio2, x.tempoChegada2], [x.comboio3, x.tempoChegada3]]
                .filter(p => p[0] && !isNaN(Number(p[1]))).map(p => ({ id: String(p[0]), s: Number(p[1]) }))
            })) };
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
      return new Response(JSON.stringify({ ok: j.codigo === "200", estacao: est, atualizado: new Date().toISOString(), comboios, estado: await estadoLinhas(env) }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, erro: String(e.message || e) }), { status: 502, headers });
    }
  }
};
