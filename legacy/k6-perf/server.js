"use strict";
// Local UI server: starts k6 runs, streams their log, serves reports. No dependencies.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { ROOT, RESULTS_DIR, toolEnv, isLocalUrl } = require("./lib/local");
const { summaryToReport, baselineKey } = require("./lib/report");
const { sqlSnapshot, diffDigests, startSampler } = require("./lib/probes");
const { diagnose } = require("./lib/diagnose");

const os = require("os");
const PORT = Number(process.env.PORT) || 4000;
// Default: this machine only. `--lan` lets the LAN *view* reports; starting/stopping
// runs stays loopback-only because the tool has no login (see isLocalReq).
const LAN = process.argv.includes("--lan");
const HOST = LAN ? "0.0.0.0" : "127.0.0.1";
const isLocalReq = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
const K6_API = "127.0.0.1:6565";
const K6_BIN = fs.existsSync(path.join(ROOT, "bin", "k6.exe")) ? path.join(ROOT, "bin", "k6.exe")
  : fs.existsSync(path.join(ROOT, "bin", "k6")) ? path.join(ROOT, "bin", "k6") : "k6";
const UI_DIR = path.join(ROOT, "ui");
const ID_RE = /^[\w-]+$/;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const config = () => ({
  endpoints: readJson(path.join(ROOT, "config/endpoints.json"), []),
  profiles: readJson(path.join(ROOT, "config/profiles.json"), {}),
  slo: readJson(path.join(ROOT, "config/slo.json"), {}),
});
const runDir = (id) => path.join(RESULTS_DIR, id);
const writeMeta = (id, meta) => fs.writeFileSync(path.join(runDir(id), "meta.json"), JSON.stringify(meta, null, 1));

// ---- the one active run -----------------------------------------------------------
let active = null; // { id, child, log: string[], listeners: Set<res> }

async function startRun({ profile, endpoints, rateScale }) {
  const env = toolEnv();
  const cfg = config();
  if (active) throw httpError(409, `Run ${active.id} is still running`);
  if (!isLocalUrl(env.BASE_URL)) throw httpError(400, `BASE_URL ${env.BASE_URL} is not local; this tool only runs locally`);
  if (!env.K6_WEB_USER || !env.K6_WEB_PASS) throw httpError(400, 'No test account in .env: run "npm run seed" first');
  if (!cfg.profiles[profile]) throw httpError(400, `Unknown profile ${profile}`);
  const known = new Set(cfg.endpoints.map((e) => e.name));
  const picked = Array.isArray(endpoints) ? endpoints.filter((n) => known.has(n)) : [];
  if (!picked.length) throw httpError(400, "Pick at least one endpoint");
  const scale = Number(rateScale ?? 1);
  if (!(scale > 0 && scale <= 20)) throw httpError(400, "rateScale must be in (0, 20]");

  const now = new Date();
  const p2 = (n) => String(n).padStart(2, "0"); // local time, so ids match the clock on the wall
  const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
  const id = `${stamp}_${profile}`;
  fs.mkdirSync(runDir(id), { recursive: true });
  const rel = path.relative(ROOT, runDir(id)).split(path.sep).join("/");
  const meta = {
    id, profile, profileLabel: cfg.profiles[profile].label, endpoints: picked, rateScale: scale,
    baseUrl: env.BASE_URL, storeId: env.K6_STORE_ID || null, slo: cfg.slo,
    status: "running", startedAt: now.toISOString(),
  };
  writeMeta(id, meta);
  // Claim the slot before any await so two clicks cannot start two runs.
  active = { id, child: null, log: [], listeners: new Set(), stopRequested: false, finishing: false };

  // Server-side evidence for the diagnosis; a failure here must not block the run.
  const sqlBefore = await sqlSnapshot().catch((e) => ({ error: e.message }));
  const sampler = startSampler(Number(new URL(env.BASE_URL).port) || 80);

  const child = spawn(K6_BIN, ["run", "--address", K6_API, "k6/main.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      BASE_URL: env.BASE_URL, K6_WEB_USER: env.K6_WEB_USER, K6_WEB_PASS: env.K6_WEB_PASS, K6_STORE_ID: env.K6_STORE_ID || "",
      PROFILE: profile, ENDPOINTS: picked.join(","), RATE_SCALE: String(scale), RUN_DIR: rel,
      K6_WEB_DASHBOARD: "true", K6_WEB_DASHBOARD_OPEN: "false", K6_WEB_DASHBOARD_HOST: "127.0.0.1",
      K6_WEB_DASHBOARD_EXPORT: `${rel}/dashboard.html`, K6_NO_COLOR: "true",
    },
  });
  const logFile = fs.createWriteStream(path.join(runDir(id), "k6.log"));
  active.child = child;
  const onData = (buf) => {
    // k6 redraws its progress bar with \r; keep the last frame only.
    const text = buf.toString().replace(/\r(?!\n)/g, "\n");
    logFile.write(text);
    active.log.push(text);
    for (const res of active.listeners) res.write(`data: ${JSON.stringify(text)}\n\n`);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  const finish = async (code, err) => {
    if (!active || active.id !== id || active.finishing) return; // 'error' and 'close' can both fire
    active.finishing = true;
    logFile.end(err ? `\n${err.message}\n` : "");
    const resources = await sampler.stop();
    if (resources) fs.writeFileSync(path.join(runDir(id), "resources.json"), JSON.stringify(resources));
    const sqlAfter = Array.isArray(sqlBefore) ? await sqlSnapshot().catch((e) => ({ error: e.message })) : null;
    const sql = Array.isArray(sqlAfter) ? diffDigests(sqlBefore, sqlAfter) : { error: sqlBefore.error || sqlAfter?.error };
    fs.writeFileSync(path.join(runDir(id), "sql.json"), JSON.stringify(sql, null, 1));
    const hasSummary = fs.existsSync(path.join(runDir(id), "summary.json"));
    // k6 exits 99 when thresholds fail: that is a finished run with a FAIL verdict.
    const status = hasSummary ? (active.stopRequested ? "stopped" : "done") : "failed";
    writeMeta(id, { ...meta, status, exitCode: code, error: err?.message, finishedAt: new Date().toISOString() });
    for (const res of active.listeners) res.end(`event: end\ndata: ${JSON.stringify(status)}\n\n`);
    active = null;
  };
  child.on("error", (err) => finish(null, err.code === "ENOENT" ? new Error(`k6 not found (${K6_BIN})`) : err));
  child.on("close", (code) => finish(code));
  return meta;
}

async function stopRun(id) {
  if (!active || active.id !== id) throw httpError(404, "Run is not running");
  active.stopRequested = true;
  try {
    // Graceful stop through k6's REST API keeps the end-of-test summary.
    const r = await fetch(`http://${K6_API}/v1/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { type: "status", id: "default", attributes: { stopped: true } } }),
    });
    if (!r.ok) throw new Error(String(r.status));
  } catch {
    active.child?.kill();
  }
}

// ---- reports ----------------------------------------------------------------------
function listRuns() {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  return fs.readdirSync(RESULTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && ID_RE.test(d.name))
    .map((d) => {
      const meta = readJson(path.join(runDir(d.name), "meta.json"));
      if (!meta) return null;
      const summary = readJson(path.join(runDir(d.name), "summary.json"));
      const report = summary ? summaryToReport(summary) : null;
      return { ...meta, kpi: report?.kpi ?? null, pass: report?.pass ?? null };
    })
    .filter(Boolean)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function getRun(id) {
  const meta = readJson(path.join(runDir(id), "meta.json"));
  if (!meta) throw httpError(404, "Run not found");
  const summary = readJson(path.join(runDir(id), "summary.json"));
  const report = summary ? summaryToReport(summary) : null;
  if (report) {
    const base = new Map((readJson(path.join(RESULTS_DIR, "baseline.json"))?.endpoints || []).map((e) => [e.key, e]));
    const defs = new Map(config().endpoints.map((e) => [e.name, e]));
    for (const row of report.endpoints) {
      const def = defs.get(row.name);
      const b = def && base.get(baselineKey(def));
      row.group = def?.group;
      row.method = def?.method ?? null;
      row.path = def?.path ?? null;
      row.prodP95 = b ? b.p95 : null;
    }
  }
  const sql = readJson(path.join(runDir(id), "sql.json"));
  const resources = readJson(path.join(runDir(id), "resources.json"));
  let diagnosis = null;
  if (report) {
    const logFile = path.join(runDir(id), "k6.log");
    const logText = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
    diagnosis = diagnose({ report, slo: meta.slo || config().slo, sql: sql?.top ? sql : null, resources, logText });
  }
  return { meta, report, diagnosis, sql, resources, hasDashboard: fs.existsSync(path.join(runDir(id), "dashboard.html")) };
}

// ---- http -------------------------------------------------------------------------
function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => {
      s += c;
      if (s.length > 1e5) reject(httpError(413, "Body too large"));
    });
    req.on("end", () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch {
        reject(httpError(400, "Invalid JSON"));
      }
    });
  });
const sendFile = (res, file) => {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: "Not found" });
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
};

async function route(req, res) {
  const url = new URL(req.url, `http://${HOST}`);
  const p = url.pathname;
  let m;
  if (req.method !== "GET" && !isLocalReq(req)) throw httpError(403, "Xem qua LAN chỉ được xem báo cáo. Chạy/dừng test trên máy chạy tool.");
  if (req.method === "GET" && p === "/api/config") {
    const env = toolEnv();
    return send(res, 200, { ...config(), baseUrl: env.BASE_URL, storeId: env.K6_STORE_ID || null, seeded: !!env.K6_WEB_PASS, active: active?.id ?? null, canRun: isLocalReq(req) });
  }
  if (req.method === "GET" && p === "/api/runs") return send(res, 200, listRuns());
  if (req.method === "POST" && p === "/api/runs") return send(res, 201, await startRun(await readBody(req)));
  if (req.method === "GET" && p === "/api/baseline") return send(res, 200, readJson(path.join(RESULTS_DIR, "baseline.json")));
  if ((m = p.match(/^\/api\/runs\/([\w-]+)$/)) && req.method === "GET") return send(res, 200, getRun(m[1]));
  if ((m = p.match(/^\/api\/runs\/([\w-]+)\/stop$/)) && req.method === "POST") {
    await stopRun(m[1]);
    return send(res, 202, { ok: true });
  }
  if ((m = p.match(/^\/api\/runs\/([\w-]+)\/log$/)) && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    if (active && active.id === m[1]) {
      for (const text of active.log) res.write(`data: ${JSON.stringify(text)}\n\n`);
      active.listeners.add(res);
      req.on("close", () => active?.listeners.delete(res));
      return;
    }
    const log = fs.existsSync(path.join(runDir(m[1]), "k6.log")) ? fs.readFileSync(path.join(runDir(m[1]), "k6.log"), "utf8") : "";
    return res.end(`data: ${JSON.stringify(log)}\n\nevent: end\ndata: "done"\n\n`);
  }
  if ((m = p.match(/^\/runs\/([\w-]+)\/dashboard\.html$/))) return sendFile(res, path.join(runDir(m[1]), "dashboard.html"));
  if (req.method === "GET") {
    const file = path.normalize(path.join(UI_DIR, p === "/" ? "index.html" : p));
    if (!file.startsWith(UI_DIR + path.sep)) return send(res, 404, { error: "Not found" });
    return sendFile(res, file);
  }
  send(res, 404, { error: "Not found" });
}

http
  .createServer((req, res) =>
    route(req, res).catch((err) => send(res, err.status || 500, { error: err.message }))
  )
  .listen(PORT, HOST, () => {
    console.log(`k6-perf UI: http://127.0.0.1:${PORT}  (k6: ${K6_BIN})`);
    if (!LAN) return;
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
    for (const ip of ips) console.log(`LAN (chỉ xem): http://${ip}:${PORT}`);
  });
