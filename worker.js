// Rápida Verde · intermediário para os tempos do Metro de Lisboa
// Guarda a chave em Settings → Variables and Secrets → ML_BASIC (tipo Secret)
// ML_BASIC = Base64 de "ConsumerKey:ConsumerSecret"

const DEST = {"33":"Reboleira","34":"Amadora Este","35":"Pontinha","36":"Colégio Militar/Luz","37":"Laranjeiras","38":"São Sebastião","39":"Avenida","40":"Baixa-Chiado","41":"Terreiro do Paço","42":"Santa Apolónia","43":"Odivelas","44":"Lumiar","45":"Campo Grande","46":"Campo Pequeno","48":"Rato","50":"Telheiras","51":"Alvalade","52":"Alameda","53":"Martim Moniz","54":"Cais do Sodré","56":"Bela Vista","57":"Chelas","59":"Moscavide","60":"Aeroporto"};
const LINHA = { A: "azul", B: "amarela", C: "verde", D: "vermelha" };
const ORIGENS = ["https://phillghub.github.io"];
const API = "https://api.metrolisboa.pt:8243";

let tok = null, tokExp = 0;

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

    const est = (new URL(req.url).searchParams.get("estacao") || "CG").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    try {
      const pedir = t => fetch(`${API}/estadoServicoML/1.0.1/tempoEspera/Estacao/${est}`, { headers: { Authorization: "Bearer " + t } });
      let r = await pedir(await token(env));
      if (r.status === 401) r = await pedir(await token(env, true));
      const j = await r.json();
      const comboios = (j.resposta || []).map(x => ({
        linha: LINHA[String(x.comboio || "").slice(-1)] || "?",
        destino: DEST[x.destino] || String(x.destino),
        s: [x.tempoChegada1, x.tempoChegada2, x.tempoChegada3].map(Number).filter(n => !isNaN(n))
      }));
      return new Response(JSON.stringify({ ok: j.codigo === "200", estacao: est, atualizado: new Date().toISOString(), comboios }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, erro: String(e.message || e) }), { status: 502, headers });
    }
  }
};
