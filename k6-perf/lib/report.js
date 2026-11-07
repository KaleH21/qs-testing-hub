"use strict";
// Pure functions turning raw data into report rows. Shared by server.js, the
// baseline script and the tests; no I/O here.

const val = (m, key, field) => m[key]?.values?.[field];
const failed = (m, key) => Object.values(m[key]?.thresholds || {}).some((t) => !t.ok);
const ERROR_KINDS = ["timeout", "rate_limited", "server_error", "client_error", "body_error"];

/** Target req/s at time `t` (ms) of a ramping-arrival-rate profile (linear ramps). */
function targetAt(stages, startRate, t) {
  let from = startRate, at = 0;
  for (const s of stages) {
    if (t <= at + s.ms) return from + (s.target - from) * (s.ms ? (t - at) / s.ms : 1);
    at += s.ms;
    from = s.target;
  }
  return from;
}

/** Per-time-window stats written by k6/main.js (tag `win`); [] for runs made before windows existed. */
function windowsOf(summary) {
  const m = summary.metrics || {};
  const x = summary.k6perf;
  if (!x) return [];
  return Array.from({ length: x.windows }, (_, i) => {
    const count = val(m, `http_reqs{win:${i}}`, "count") || 0;
    return {
      i,
      startS: (i * x.windowMs) / 1000,
      endS: ((i + 1) * x.windowMs) / 1000,
      count,
      rps: count / (x.windowMs / 1000),
      target: targetAt(x.stages, x.startRate, (i + 0.5) * x.windowMs) * x.scale,
      p95: count ? val(m, `http_req_duration{win:${i}}`, "p(95)") : null,
      success: count ? val(m, `api_success{win:${i}}`, "rate") : null,
    };
  });
}

/** k6 summary.json -> { kpi, endpoints[], pass } for the UI. */
function summaryToReport(summary) {
  const m = summary.metrics || {};
  const names = Object.keys(m)
    .map((k) => k.match(/^http_reqs\{name:(.+)\}$/)?.[1])
    .filter(Boolean);
  const durationS = (summary.state?.testRunDurationMs || 0) / 1000;

  const endpoints = names
    .map((name) => {
      const d = `http_req_duration{name:${name}}`;
      const s = `api_success{name:${name}}`;
      const a = `api_available{name:${name}}`;
      const count = val(m, `http_reqs{name:${name}}`, "count") || 0;
      return {
        name,
        count,
        rps: durationS ? count / durationS : 0,
        avg: val(m, d, "avg"),
        min: val(m, d, "min"),
        med: val(m, d, "med"),
        p90: val(m, d, "p(90)"),
        p95: val(m, d, "p(95)"),
        p99: val(m, d, "p(99)"),
        max: val(m, d, "max"),
        success: count ? val(m, s, "rate") : null,
        available: count ? val(m, a, "rate") : null,
        failures: val(m, s, "fails") || 0,
        bytes: count ? val(m, `api_resp_bytes{name:${name}}`, "avg") ?? null : null,
        errors: Object.fromEntries(ERROR_KINDS.map((k) => [k, val(m, `api_errors{name:${name},kind:${k}}`, "count") || 0])),
        // An endpoint the run never hit has no verdict, not a PASS.
        pass: count ? !(failed(m, d) || failed(m, s) || failed(m, a)) : null,
      };
    })
    .sort((x, y) => (y.p95 ?? -1) - (x.p95 ?? -1));

  const kpi = {
    durationS,
    requests: val(m, "http_reqs", "count") || 0,
    rps: val(m, "http_reqs", "rate") || 0,
    p95: val(m, "http_req_duration{scenario:load}", "p(95)"),
    p99: val(m, "http_req_duration{scenario:load}", "p(99)"),
    avg: val(m, "http_req_duration{scenario:load}", "avg"),
    success: val(m, "api_success", "rate"),
    available: val(m, "api_available", "rate"),
    checks: val(m, "checks", "rate"),
    vusMax: val(m, "vus_max", "max"),
    dataReceived: val(m, "data_received", "count") || 0,
    dataSent: val(m, "data_sent", "count") || 0,
    dropped: val(m, "dropped_iterations", "count") || 0,
    maxVUs: summary.k6perf?.maxVUs ?? null,
  };
  const pass = !Object.keys(m).some((k) => failed(m, k));
  return { kpi, endpoints, pass, windows: windowsOf(summary) };
}

// --- production access-log baseline -------------------------------------------------

// morgan line: "[30/Oct/2026:00:00:01 +0000] POST /api/mobile/tickets/buy-ticket 200 47.627 ms - REQ: ..."
const LINE_RE = /^\[(\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}):\d{2} [^\]]*\] (GET|POST|PUT|PATCH|DELETE) (\/api\/\S*) (\d{3}) ([\d.]+) ms/;

const normalizePath = (p) =>
  p
    .split("?")[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "/:id")
    .replace(/\/\d+(?=\/|$)/g, "/:id");

/** One log line -> { minute, key, status, ms } or null when it is not an access line. */
function parseLogLine(line) {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  return { minute: m[1], key: `${m[2]} ${normalizePath(m[3])}`, status: Number(m[4]), ms: Number(m[5]) };
}

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null);

/** Incremental aggregator so the log files can be streamed line by line. */
function createBaseline() {
  const byKey = new Map();
  const perMinute = new Map();
  return {
    add(line) {
      const r = parseLogLine(line);
      if (!r) return;
      let e = byKey.get(r.key);
      if (!e) byKey.set(r.key, (e = { ms: [], s4xx: 0, s5xx: 0 }));
      e.ms.push(r.ms);
      if (r.status >= 500) e.s5xx++;
      else if (r.status >= 400) e.s4xx++;
      perMinute.set(r.minute, (perMinute.get(r.minute) || 0) + 1);
    },
    result() {
      let peak = { minute: null, requests: 0 };
      for (const [minute, requests] of perMinute) if (requests > peak.requests) peak = { minute, requests };
      const endpoints = [...byKey].map(([key, e]) => {
        const s = Float64Array.from(e.ms).sort();
        return {
          key,
          count: s.length,
          p50: percentile(s, 0.5),
          p95: percentile(s, 0.95),
          p99: percentile(s, 0.99),
          rate4xx: e.s4xx / s.length,
          rate5xx: e.s5xx / s.length,
        };
      });
      endpoints.sort((a, b) => b.count - a.count);
      return { generatedAt: new Date().toISOString(), days: new Set([...perMinute.keys()].map((m) => m.slice(0, 11))).size, peak, endpoints };
    },
  };
}

/** endpoints.json entry -> baseline key, e.g. "POST /api/mobile/devices/config". */
const baselineKey = (e) => `${e.method} ${normalizePath(e.path)}`;

module.exports = { summaryToReport, parseLogLine, createBaseline, baselineKey, normalizePath, targetAt, ERROR_KINDS };
