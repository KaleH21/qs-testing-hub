// k6 load script for qs-net-management-be. Configured by env (the UI server sets these):
//   BASE_URL, K6_WEB_USER, K6_WEB_PASS, K6_STORE_ID, PROFILE, ENDPOINTS (comma names),
//   RATE_SCALE (multiplies every req/s target), RUN_DIR (where summary.json goes).
import http from "k6/http";
import { check } from "k6";
import { Rate, Counter, Trend } from "k6/metrics";
import exec from "k6/execution";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:3020").replace(
  /\/+$/,
  "",
);
// Agreed scope: local only. Repeated here so a direct `k6 run` cannot hit a remote server.
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(BASE_URL)) {
  throw new Error(
    `BASE_URL ${BASE_URL} is not local; this tool only runs against this machine`,
  );
}

const SLO = JSON.parse(open("../config/slo.json"));
const PROFILES = JSON.parse(open("../config/profiles.json"));
const ALL = JSON.parse(open("../config/endpoints.json"));
const PROFILE_NAME = __ENV.PROFILE || "smoke";
const PROFILE = PROFILES[PROFILE_NAME];
if (!PROFILE) throw new Error(`Unknown PROFILE ${PROFILE_NAME}`);
const SCALE = Number(__ENV.RATE_SCALE || 1);
if (!(SCALE > 0 && SCALE <= 20))
  throw new Error("RATE_SCALE must be in (0, 20]");

const wanted = (__ENV.ENDPOINTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ENDPOINTS = wanted.length
  ? ALL.filter((e) => wanted.includes(e.name))
  : ALL;
if (!ENDPOINTS.length)
  throw new Error(`No endpoint matches ENDPOINTS=${__ENV.ENDPOINTS}`);
const TOTAL_WEIGHT = ENDPOINTS.reduce((s, e) => s + e.weight, 0);

// success: 2xx and, for mobile, body.success !== false (mobile errors come back as HTTP 200).
// available: the server answered without a 5xx and without a network error/timeout.
const apiSuccess = new Rate("api_success");
const apiAvailable = new Rate("api_available");
// Evidence for the diagnosis: why a request failed, and how big responses are.
const apiErrors = new Counter("api_errors");
const apiRespBytes = new Trend("api_resp_bytes");
const ERROR_KINDS = [
  "timeout",
  "rate_limited",
  "server_error",
  "client_error",
  "body_error",
];

const scaled = (n) => Math.max(0, Math.round(n * SCALE));
const peak = Math.max(
  ...PROFILE.stages.map((s) => s.target),
  PROFILE.startRate || 1,
);
// Kept as a const: inside handleSummary `options.scenarios` is undefined in k6 v2.
const MAX_VUS = Math.max(20, scaled(peak) * 10);

// The run is cut into equal time windows (tag `win`) so the report can see when
// latency started to climb and at what req/s (saturation point, slow drift).
const toMs = (d) =>
  [...String(d).matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)].reduce(
    (s, [, n, u]) => s + n * { ms: 1, s: 1e3, m: 6e4, h: 36e5 }[u],
    0,
  );
const STAGES = PROFILE.stages.map((s) => ({
  target: s.target,
  ms: toMs(s.duration),
}));
const TOTAL_MS = STAGES.reduce((s, x) => s + x.ms, 0);
const WINDOWS = 12;
const WINDOW_MS = TOTAL_MS / WINDOWS;

const thresholds = {
  "http_req_duration{scenario:load}": [`p(95)<${SLO.p95Ms}`],
  api_success: [`rate>=${SLO.successRate}`],
  api_available: [`rate>=${SLO.availability}`],
};
// The end-of-test summary only carries sub-metrics that have a threshold, so every
// endpoint gets its own set; this is what feeds the per-API table in the UI.
for (const e of ENDPOINTS) {
  thresholds[`http_req_duration{name:${e.name}}`] = [`p(95)<${SLO.p95Ms}`];
  thresholds[`api_success{name:${e.name}}`] = [`rate>=${SLO.successRate}`];
  thresholds[`api_available{name:${e.name}}`] = [`rate>=${SLO.availability}`];
  thresholds[`http_reqs{name:${e.name}}`] = ["count>=0"];
  thresholds[`api_resp_bytes{name:${e.name}}`] = ["avg>=0"];
  for (const k of ERROR_KINDS)
    thresholds[`api_errors{name:${e.name},kind:${k}}`] = ["count>=0"];
}
for (let w = 0; w < WINDOWS; w++) {
  thresholds[`http_req_duration{win:${w}}`] = ["p(95)>=0"];
  thresholds[`http_reqs{win:${w}}`] = ["count>=0"];
  thresholds[`api_success{win:${w}}`] = ["rate>=0"];
}

export const options = {
  scenarios: {
    load: {
      executor: "ramping-arrival-rate",
      startRate: scaled(PROFILE.startRate || 1),
      timeUnit: "1s",
      preAllocatedVUs: Math.max(5, scaled(peak)),
      maxVUs: MAX_VUS,
      stages: PROFILE.stages.map((s) => ({
        target: scaled(s.target),
        duration: s.duration,
      })),
    },
  },
  thresholds,
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
  setupTimeout: "60s",
};

const json = (res) => {
  try {
    return res.json();
  } catch {
    return null;
  }
};
const listOf = (body) =>
  body && body.data && Array.isArray(body.data.data) ? body.data.data : [];

export function setup() {
  const tags = { name: "setup" };
  const login = http.post(
    `${BASE_URL}/api/v1/access/login`,
    JSON.stringify({
      username: __ENV.K6_WEB_USER,
      password: __ENV.K6_WEB_PASS,
    }),
    { headers: { "Content-Type": "application/json" }, tags },
  );
  const lb = json(login);
  if (login.status !== 200 || !lb || !lb.data || !lb.data.accessToken) {
    throw new Error(
      `Login failed (${login.status}): ${String(login.body).slice(0, 200)}. Run "npm run seed".`,
    );
  }
  const token = lb.data.accessToken;
  const auth = { headers: { authorization: token }, tags }; // no "Bearer" prefix: see auth.middleware.js
  const storeId = Number(__ENV.K6_STORE_ID);

  const devices = listOf(
    json(http.get(`${BASE_URL}/api/v1/devices?page=1&pageSize=1000`, auth)),
  )
    .filter(
      (d) =>
        d.deviceId &&
        d.isEnabled &&
        !d.apiV2Enabled &&
        (!storeId || d.storeId === storeId),
    )
    .map((d) => ({ deviceId: d.deviceId, storeId: d.storeId }));
  if (!devices.length)
    throw new Error(`No usable kiosk (apiV2Enabled=0) in store ${storeId}`);

  const members = listOf(
    json(
      http.get(
        `${BASE_URL}/api/v1/members?page=1&pageSize=200&storeId=${devices[0].storeId}`,
        auth,
      ),
    ),
  ).map((m) => ({ id: m.id, externalId: m.externalId }));
  if (!members.length)
    throw new Error(
      `Store ${devices[0].storeId} has no members to use for member endpoints`,
    );

  return {
    token,
    accountId: lb.data.user.id,
    storeId: devices[0].storeId,
    devices,
    members,
  };
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pad = (n) => String(n).padStart(2, "0");
const uuid = () =>
  "k6-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

function chooseEndpoint() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const e of ENDPOINTS) if ((r -= e.weight) < 0) return e;
  return ENDPOINTS[ENDPOINTS.length - 1];
}

let warned = 0;

export default function (data) {
  const e = chooseEndpoint();
  const d = new Date();
  const member = pick(data.members);
  const vars = {
    storeId: data.storeId,
    accountId: data.accountId,
    deviceId: pick(data.devices).deviceId,
    memberId: member.id,
    externalId: member.externalId,
    todayIso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    todayMDY: `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`,
    uuid: uuid(),
  };
  const fill = (s) =>
    s.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? String(vars[k]) : ""));

  const win = String(
    Math.min(
      WINDOWS - 1,
      Math.floor(exec.instance.currentTestRunDuration / WINDOW_MS),
    ),
  );
  const tags = { name: e.name, group: e.group, win };
  const headers =
    e.group === "web"
      ? { authorization: data.token }
      : { "Content-Type": "application/json" };
  const body = e.body ? fill(JSON.stringify(e.body)) : null;
  const res = http.request(e.method, BASE_URL + fill(e.path), body, {
    headers,
    tags,
    timeout: "30s",
  });

  const okStatus = res.status >= 200 && res.status < 300;
  const b = e.group === "mobile" && okStatus ? json(res) : null;
  const success = okStatus && !(b && b.success === false);
  const available = res.status !== 0 && res.status < 500;
  apiSuccess.add(success, tags);
  apiAvailable.add(available, tags);
  apiRespBytes.add(res.body ? res.body.length : 0, { name: e.name });
  // Mobile rate limiting comes back as HTTP 200 + error RATE_LIMITED (mobile-response.middleware).
  const kind =
    res.status === 0
      ? "timeout"
      : res.status === 429 || (b && b.error === "RATE_LIMITED")
        ? "rate_limited"
        : res.status >= 500
          ? "server_error"
          : res.status >= 400
            ? "client_error"
            : !success
              ? "body_error"
              : null;
  if (kind) apiErrors.add(1, { name: e.name, kind });
  check(res, { "request succeeded": () => success });

  if (!success && warned < 3) {
    warned++;
    console.warn(
      `[${e.name}] VU${exec.vu.idInTest} status=${res.status} ${res.error || ""} ${String(res.body || "").slice(0, 160)}`,
    );
  }
}

export function handleSummary(data) {
  const out = {};
  delete data.setup_data; // holds the access token and member ids: keep them out of results/
  data.k6perf = {
    windows: WINDOWS,
    windowMs: WINDOW_MS,
    startRate: PROFILE.startRate || 1,
    scale: SCALE,
    stages: STAGES,
    maxVUs: MAX_VUS,
  };
  if (__ENV.RUN_DIR)
    out[`${__ENV.RUN_DIR}/summary.json`] = JSON.stringify(data, null, 1);
  const m = data.metrics;
  const v = (k, f) => (m[k] && m[k].values ? m[k].values[f] : undefined);
  out.stdout =
    `\nrequests=${v("http_reqs", "count")} rps=${(v("http_reqs", "rate") || 0).toFixed(2)}` +
    ` p95=${(v("http_req_duration{scenario:load}", "p(95)") || 0).toFixed(1)}ms` +
    ` success=${((v("api_success", "rate") || 0) * 100).toFixed(2)}%` +
    ` availability=${((v("api_available", "rate") || 0) * 100).toFixed(3)}%\n`;
  return out;
}
