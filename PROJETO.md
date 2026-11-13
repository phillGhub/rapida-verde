# Transportes (ex-Rápida Verde) — estado do projeto

App geral de transportes: Metro de Lisboa (4 linhas), comboios (CP e Fertagus, via Infraestruturas de Portugal), Carris Metropolitana (tempo real) e Rodoviária do Oeste (horários). Mantém o modo de viagem da Rápida Verde (`rapida-verde.html`), feito para quem faz Bombarral ⇄ Lisboa (Campo Grande) na Rápida Verde (RDO – Rodoviária do Oeste) e continua de Metro na Linha Amarela (Campo Grande → Entre Campos ou Rato, e volta).

## Onde está tudo
- **App (iPhone, ecrã principal):** https://phillghub.github.io/rapida-verde/
- **Código:** github.com/phillGhub/rapida-verde (GitHub Pages, branch `main`, raiz). Atualiza-se carregando ficheiros em `/upload/main`.
- **Worker do Metro (Cloudflare):** https://rapidametro.filipe-sevinate.workers.dev — publicado automaticamente a partir do `worker.js` + `wrangler.json` do repositório. Chave do Metro guardada como secret `ML_BASIC` (Base64 de ConsumerKey:ConsumerSecret) — NÃO está no repositório.
- **Apple Watch / Atalhos:** "Próximo Autocarro" (lê `agora.json`) e "Metro Campo Grande" (API do Metro direta).

## Ficheiros
| Ficheiro | Para quê |
|---|---|
| `index.html` | App geral: separadores Perto / Metro / Comboios / Autocarros / Ajustes, favoritos ⭐ |
| `rapida-verde.html` | Modo viagem da Rápida Verde (GPS, chegada estimada, Metro Linha Amarela) |
| `manifest.json`, `sw.js`, `icon-*.png`, `apple-touch-icon.png` | App instalável e a funcionar sem rede |
| `worker.js`, `wrangler.json` | Intermediário Cloudflare: API do Metro (chave secreta) + reencaminhamento `?p=cm&u=/v2/…` (Carris Metropolitana) e `?p=ip&u=/negocios-e-servicos/…` (comboios IP) |
| `.github/workflows/carris.yml` | Processo noturno (GitHub Actions): descarrega o GTFS da Carris (Lisboa) e publica ficheiros por paragem no ramo `dados` (lidos via raw.githubusercontent.com) |
| `rdo.json` | Todas as carreiras da Rodoviária do Oeste (128 carreiras, 704 paragens), tiradas do PDF oficial `rdo_schedules_A5.pdf` (em vigor desde 18/07/2025). O calendário escolar está em `ESCOLA` no `index.html`. |
| `w.json`, `agora.json` | Horários para os Atalhos (resposta pré-calculada por minuto) |

## O que a app faz
- Horários oficiais da Rápida Verde (em vigor desde 01/10/2025), dias úteis / fins de semana / feriados nacionais 2026–27; destino de cada autocarro e aviso dos diretos que **não param no Bombarral**.
- GPS: deteta o sentido, a paragem (gravável pelo utilizador), a entrada no autocarro e qual o horário; mapa esquemático do percurso (A8, ~70 km), velocidade, km feitos/em falta; histórico de viagens.
- Chegada estimada: trânsito típico por troço e hora + meteorologia (Open-Meteo) + aprendizagem com o histórico + trânsito em direto opcional (TomTom, chave guardada só no telemóvel).
- Metro (Linha Amarela): deteção da estação (Campo Grande / Entre Campos / Rato) e do sentido; próximos comboios; hora de chegada a Entre Campos/Rato; no regresso, ligação ao autocarro que apanhas no Campo Grande; avisos de perturbações e esperas longas; mapa da linha ao vivo (posições estimadas, refresca a cada 2 s, dados a cada 10 s).

## Dados e APIs
- RDO: sem dados em tempo real nem API pública (horários vêm do PDF oficial).
- Metro de Lisboa: API oficial EstadoServicoML (api.metrolisboa.pt:8243) — `tempoEspera/Estacao/{id}`, `estadoLinha/todos`, `infoDestinos/todos`, `infoEstacao/todos`. Destinos Linha Amarela: 43 Odivelas, 44 Lumiar, 45 Campo Grande, 46 Campo Pequeno, 48 Rato. Comboios terminados em B = Amarela, C = Verde.
- Comboios: Infraestruturas de Portugal — `estacao-nome/{nome}` e `partidas-chegadas/{NodeID}/{início}/{fim}/{tipos}` (API não oficial do site; CP e Fertagus, com atrasos e supressões).
- Carris Metropolitana: api.carrismetropolitana.pt/v2 — `stops`, `lines`, `arrivals/by_stop/{id}`.
- Carris (Lisboa): GTFS oficial gateway.carris.pt/gateway/gtfs/api/v2.11/GTFS (horários). Tempo real só como posições de veículos (GTFS-RT, portal de programadores da Carris) — ainda não ligado.
- Waze, Citymapper e Carris (Lisboa): sem API pública utilizável.

## Limites conhecidos
- App web no iPhone: sem GPS com o ecrã bloqueado, sem notificações automáticas. Para isso: app nativa (conta Apple Developer 99 €/ano, compilação via GitHub Actions + TestFlight, sem Mac).
- O utilizador não tem Mac e trabalha sobretudo no iPhone.

## Segurança (revisão de 13/11/2026)
- Segredos só na Cloudflare: `ML_BASIC` (Metro) e `TT_KEY` (TomTom). Nada no repositório nem no histórico.
- Worker: só aceita pedidos com origem/referer `https://phillghub.github.io`; limite de 90 pedidos/min por IP (o mapa da linha conta a dobrar); só reencaminha para Carris Metropolitana `/v2/…`, IP `/negocios-e-servicos/…` e TomTom (routing e incidentes); nunca devolve a chave do TomTom; não guarda erros em cache.
- App: todo o texto vindo de APIs é escapado; `Content-Security-Policy` limita os sites contactados; ao OpenStreetMap só vai a posição arredondada (~100 m).
- Limites conhecidos: a origem pode ser falsificada por quem quiser abusar (o limite por minuto é por instância do Worker); o domínio phillghub.github.io é partilhado por todos os sites GitHub Pages da conta.
