"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { summaryToReport, parseLogLine, createBaseline, baselineKey } = require("../lib/report");
const { isLocalUrl } = require("../lib/local");

const trend = (p95, ok = true) => ({ type: "trend", values: { avg: 10, min: 1, med: 9, max: 50, "p(90)": 20, "p(95)": p95, "p(99)": 40 }, thresholds: { "p(95)<1000": { ok } } });
const rate = (r, ok = true) => ({ type: "rate", values: { rate: r, passes: 0, fails: 2 }, thresholds: { "rate>=0.99": { ok } } });
const count = (c) => ({ type: "counter", values: { count: c, rate: c / 10 }, thresholds: { "count>=0": { ok: true } } });

test("summaryToReport builds per-endpoint rows and verdicts", () => {
  const r = summaryToReport({
    state: { testRunDurationMs: 10000 },
    metrics: {
      http_reqs: { values: { count: 30, rate: 3 } },
      "http_reqs{name:a}": count(20),
      "http_req_duration{name:a}": trend(1500, false),
      "api_success{name:a}": rate(1),
      "api_available{name:a}": rate(1),
      "http_reqs{name:b}": count(10),
      "http_req_duration{name:b}": trend(100),
      "api_success{name:b}": rate(1),
      "api_available{name:b}": rate(1),
      "http_reqs{name:unused}": count(0),
      "http_req_duration{name:unused}": trend(0),
    },
  });
  assert.deepEqual(r.endpoints.map((e) => e.name), ["a", "b", "unused"]); // sorted by p95 desc
  assert.equal(r.endpoints[0].pass, false);
  assert.equal(r.endpoints[0].rps, 2);
  assert.equal(r.endpoints[1].pass, true);
  assert.equal(r.endpoints[2].pass, null, "an endpoint with no requests gets no verdict");
  assert.equal(r.pass, false);
  assert.equal(r.kpi.requests, 30);
});

test("parseLogLine reads morgan lines and normalizes ids", () => {
  const r = parseLogLine("[30/Oct/2026:00:00:01 +0000] GET /api/v1/stores/123/devices?x=1 200 47.6 ms - REQ: {}");
  assert.deepEqual(r, { minute: "30/Oct/2026:00:00", key: "GET /api/v1/stores/:id/devices", status: 200, ms: 47.6 });
  assert.equal(parseLogLine("[auto-end-baccarat] tick"), null);
});

test("createBaseline aggregates percentiles, errors and peak minute", () => {
  const b = createBaseline();
  for (let i = 1; i <= 100; i++) b.add(`[01/Nov/2026:10:0${i % 2}:00 +0000] POST /api/mobile/x ${i === 100 ? 500 : 200} ${i} ms`);
  const r = b.result();
  assert.equal(r.endpoints[0].count, 100);
  assert.equal(r.endpoints[0].p50, 51);
  assert.equal(r.endpoints[0].p95, 96);
  assert.equal(r.endpoints[0].rate5xx, 0.01);
  assert.equal(r.peak.requests, 50);
  assert.equal(baselineKey({ method: "GET", path: "/api/v1/tickets?storeId={{storeId}}" }), "GET /api/v1/tickets");
});

test("isLocalUrl only accepts this machine", () => {
  assert.equal(isLocalUrl("http://localhost:3020"), true);
  assert.equal(isLocalUrl("http://127.0.0.1:3020"), true);
  assert.equal(isLocalUrl("https://api.goscan.ai"), false);
  assert.equal(isLocalUrl("http://localhost.evil.com"), false);
  assert.equal(isLocalUrl("garbage"), false);
});
