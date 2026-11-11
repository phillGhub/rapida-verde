#!/usr/bin/env python3
# Carris (Lisboa): transforma o GTFS oficial em ficheiros pequenos para a app.
# Uso: python3 carris_gtfs.py [ficheiro_ou_url_do_gtfs] [pasta_de_saida]
import csv, io, json, os, sys, zipfile, urllib.request, datetime, collections, hashlib

SRC = sys.argv[1] if len(sys.argv) > 1 else "https://gateway.carris.pt/gateway/gtfs/api/v2.11/GTFS"
OUT = sys.argv[2] if len(sys.argv) > 2 else "out"
DIAS = 21  # dias de calendário gerados

if SRC.startswith("http"):
    req = urllib.request.Request(SRC, headers={"User-Agent": "Mozilla/5.0 (transportes-app)"})
    raw = urllib.request.urlopen(req, timeout=600).read()
else:
    raw = open(SRC, "rb").read()
z = zipfile.ZipFile(io.BytesIO(raw))
names = {os.path.basename(n): n for n in z.namelist()}

def rows(n):
    if n not in names:
        return
    with z.open(names[n]) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))

def tmin(s):
    h, m, *_ = (s or "").strip().split(":") + ["0"]
    return int(h) * 60 + int(m)

def w(path, obj):
    p = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))

# Linhas
routes = {}
for r in rows("routes.txt"):
    short = (r.get("route_short_name") or r.get("route_id") or "").strip()
    col = (r.get("route_color") or "").strip() or "F9C500"
    txt = (r.get("route_text_color") or "").strip() or "000000"
    routes[r["route_id"]] = [short, "#" + col.lstrip("#"), "#" + txt.lstrip("#"), (r.get("route_long_name") or "").strip()]

# Nomes das paragens (para o destino, quando a Carris não o indica)
stop_name = {s["stop_id"]: (s.get("stop_name") or "").strip() for s in rows("stops.txt")}

# Viagens
trips = {}
svc_ids = {}
for t in rows("trips.txt"):
    s = t["service_id"]
    if s not in svc_ids:
        svc_ids[s] = len(svc_ids)
    trips[t["trip_id"]] = (t["route_id"], svc_ids[s], (t.get("trip_headsign") or "").strip())

# Horários por viagem
st = collections.defaultdict(list)
for r in rows("stop_times.txt"):
    tid = r["trip_id"]
    if tid not in trips:
        continue
    tm = r.get("departure_time") or r.get("arrival_time")
    if not tm:
        continue
    st[tid].append((int(r["stop_sequence"]), r["stop_id"], tmin(tm)))

# Padrões (sequência de paragens) e entradas por paragem
patterns = {}       # tuple(stops) -> idx
pat_trips = collections.defaultdict(list)  # idx -> [(first_min, times, trip_id)]
for tid, L in st.items():
    L.sort()
    key = tuple(x[1] for x in L)
    if key not in patterns:
        patterns[key] = len(patterns)
    pat_trips[patterns[key]].append((L[0][2], [x[2] for x in L], tid))

per_stop = collections.defaultdict(list)
used = set()
stop_routes = collections.defaultdict(set)
pat_list = {v: k for k, v in patterns.items()}
for p, TL in pat_trips.items():
    TL.sort()
    stops_p = pat_list[p]
    used.update(stops_p)
    out_t = []
    for ti, (_, times, tid) in enumerate(TL):
        rid, svc, head = trips[tid]
        if not head:
            head = stop_name.get(stops_p[-1], "")
        out_t.append([svc] + times)
        for i, sid in enumerate(stops_p):
            if i == len(stops_p) - 1:
                continue  # última paragem: não há partidas
            per_stop[sid].append((times[i], rid, head, p, ti, svc, i))
            stop_routes[sid].add(rid)
    w(f"carris/p/{p}.json", {"s": list(stops_p), "t": out_t})

# Paragens
stops = []
for s in rows("stops.txt"):
    sid = s["stop_id"]
    if sid not in used:
        continue
    try:
        lat, lon = round(float(s["stop_lat"]), 6), round(float(s["stop_lon"]), 6)
    except Exception:
        continue
    lin = sorted({routes.get(r, [r])[0] for r in stop_routes[sid]}, key=lambda x: (len(x), x))
    stops.append([sid, (s.get("stop_name") or "").strip(), lat, lon, ",".join(lin), 1 if sid in per_stop else 0])
    if sid not in per_stop:
        continue
    E = sorted(per_stop[sid])
    heads = sorted({e[2] for e in E})
    hi = {h: i for i, h in enumerate(heads)}
    w(f"carris/s/{sid}.json", {"h": heads, "d": [[m, r, hi[h], p, ti, sv, i] for (m, r, h, p, ti, sv, i) in E]})

# Calendário: que serviços funcionam em cada dia
cal = {}
base = {}
for c in rows("calendar.txt"):
    if c["service_id"] in svc_ids:
        base[c["service_id"]] = c
exc = collections.defaultdict(dict)
for c in rows("calendar_dates.txt"):
    if c["service_id"] in svc_ids:
        exc[c["date"]][c["service_id"]] = c["exception_type"].strip()
dias = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
hoje = datetime.date.today() - datetime.timedelta(days=1)
for k in range(DIAS):
    d = hoje + datetime.timedelta(days=k)
    ds = d.strftime("%Y%m%d")
    on = set()
    for sid, c in base.items():
        if c["start_date"] <= ds <= c["end_date"] and c.get(dias[d.weekday()], "0").strip() == "1":
            on.add(sid)
    for sid, e in exc.get(ds, {}).items():
        if e == "1":
            on.add(sid)
        elif e == "2":
            on.discard(sid)
    cal[d.isoformat()] = sorted(svc_ids[s] for s in on)

w("carris/stops.json", stops)
w("carris/routes.json", routes)
w("carris/cal.json", cal)
w("carris/meta.json", {"gerado": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "sha1": hashlib.sha1(raw).hexdigest(),
                      "paragens": len(stops), "linhas": len(routes), "padroes": len(patterns), "viagens": len(st)})
print(f"ok: {len(stops)} paragens, {len(routes)} linhas, {len(patterns)} padrões, {len(st)} viagens")
