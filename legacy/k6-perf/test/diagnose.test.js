"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { diagnose, failureSamples, SEV } = require("../lib/diagnose");
const { diffDigests } = require("../lib/probes");
const { targetAt } = require("../lib/report");

const SLO = { p95Ms: 1000, successRate: 0.99, availability: 0.999 };
const ep = (o) => ({ name: "x", group: "web", count: 100, med: 20, p95: 60, p99: 80, success: 1, bytes: 1000, errors: {}, ...o });
const run = (endpoints, extra = {}) => diagnose({ report: { kpi: { dropped: 0 }, endpoints, windows: [], ...extra }, slo: SLO, ...extra });
const titles = (f) => f.map((x) => x.title);

test("healthy run has no findings", () => {
  assert.deepEqual(run([ep({ name: "a" }), ep({ name: "b" })]), []);
});

test("mobile 429 is blamed on the per-IP limiter, with certainty", () => {
  const [f] = run([ep({ name: "m", group: "mobile", success: 0.9, errors: { rate_limited: 10 } })]);
  assert.equal(f.title, "Bị rate limit chặn (429)");
  assert.equal(f.severity, SEV.critical);
  assert.equal(f.confidence, "Chắc chắn");
  assert.match(f.cause, /1\.200 request\/phút/);
});

test("cheap endpoints with long tails + a heavy one => event-loop queueing, heavy one named", () => {
  const f = run([
    ep({ name: "heavy", med: 1400, p95: 1700, bytes: 300e3, path: "/api/v1/members?pageSize=999999999" }),
    ep({ name: "cheap1", med: 5, p95: 757 }),
    ep({ name: "cheap2", med: 10, p95: 1032 }),
  ]);
  const q = f.find((x) => x.title.startsWith("Request nhẹ"));
  assert.ok(q, titles(f).join(","));
  assert.match(q.cause, /Nghi phạm: heavy/);
  assert.equal(q.confidence, "Cao");
  const h = f.find((x) => x.endpoint === "heavy");
  assert.match(h.cause, /pageSize=999,999,999/);
  assert.ok(!f.some((x) => x.endpoint === "cheap1" && x.title.startsWith("Vượt SLO")), "queued endpoints are not double-reported");
});

test("windows: saturation point is the first window that breaks the SLO", () => {
  const w = (i, rps, p95) => ({ i, startS: i * 60, endS: i * 60 + 60, count: rps * 60, rps, target: rps, p95, success: 1 });
  const f = run([ep({})], { windows: [w(0, 12, 200), w(1, 25, 400), w(2, 50, 1800)] });
  const s = f.find((x) => x.title === "Điểm bão hoà");
  assert.match(s.evidence, /25\.0 req\/s/);
  assert.match(s.evidence, /giây 120/);
});

test("failureSamples reads k6 console warnings", () => {
  const log = 'time="t" level=warning msg="[mobile.tickets] VU3 status=200  {\\"success\\":false,\\"message\\":\\"bad\\"}" source=console\n';
  assert.deepEqual(failureSamples(log).get("mobile.tickets"), ['HTTP 200 {"success":false,"message":"bad"}']);
});

test("diffDigests keeps only work done during the run, heaviest first", () => {
  const before = [{ digest: "a", text: "SELECT a", calls: 10, timer: 1e9, examined: 10, sent: 1, noIndex: 0, noGoodIndex: 0 }];
  const after = [
    { digest: "a", text: "SELECT a", calls: 12, timer: 3e9, examined: 20, sent: 3, noIndex: 0, noGoodIndex: 0 },
    { digest: "b", text: "SELECT b", calls: 5, timer: 50e9, examined: 5e5, sent: 5, noIndex: 5, noGoodIndex: 0 },
    { digest: "c", text: "SELECT ... events_statements_summary_by_digest", calls: 1, timer: 1e9, examined: 1, sent: 1, noIndex: 0, noGoodIndex: 0 },
  ];
  const d = diffDigests(before, after);
  assert.deepEqual(d.top.map((r) => [r.text, r.calls, r.totalMs]), [["SELECT b", 5, 50], ["SELECT a", 2, 2]]);
  assert.equal(d.top[0].noIndex, true);
  const f = diagnose({ report: { kpi: { dropped: 0 }, endpoints: [], windows: [] }, slo: SLO, sql: d });
  assert.ok(titles(f).includes("Truy vấn không dùng index"));
});

test("targetAt interpolates ramping stages", () => {
  const stages = [{ target: 12, ms: 60000 }, { target: 12, ms: 60000 }];
  assert.equal(targetAt(stages, 0, 30000), 6);
  assert.equal(targetAt(stages, 0, 90000), 12);
});

test("server evidence: busy DB from SQL time, big RAM from sampler", () => {
  const f = diagnose({
    report: { kpi: { dropped: 0, durationS: 100 }, endpoints: [ep({ name: "big", bytes: 7e6, med: 1400, p95: 1800 })], windows: [] },
    slo: SLO,
    sql: { totalMs: 90000, top: [] },
    resources: [{ t: 1, beCpu: 20, beMemMB: 900 }, { t: 2, beCpu: 30, beMemMB: 1200 }],
  });
  const t = titles(f);
  assert.ok(t.includes("DB bận liên tục"), t.join(","));
  assert.match(f.find((x) => x.title === "Node BE dùng nhiều RAM").cause, /big ≈ 7\.0 MB/);
  assert.ok(!t.some((x) => x.startsWith("CPU và DB")), "no 'not overloaded' finding when DB is busy");
});

test("sampler that never found the BE yields no resource findings", () => {
  const f = diagnose({ report: { kpi: { dropped: 0, durationS: 10 }, endpoints: [ep({ p95: 1500, med: 1400 })], windows: [] }, slo: SLO, resources: [{ t: 1, beCpu: null, beMemMB: null }] });
  assert.ok(!titles(f).some((x) => x.startsWith("CPU")));
});

test("windows: a p95 that flips back and forth at steady load is noise, not saturation", () => {
  const w = (i, p95) => ({ i, startS: i * 30, endS: i * 30 + 30, count: 360, rps: 12, target: 12, p95, success: 1 });
  const f = run([ep({})], { windows: [w(0, 400), w(1, 1260), w(2, 469), w(3, 1332), w(4, 278), w(5, 907), w(6, 213)] });
  assert.ok(!titles(f).includes("Điểm bão hoà"));
  assert.ok(titles(f).includes("Latency dao động, không theo mức tải"));
  const sparse = run([ep({})], { windows: [{ i: 0, count: 12, rps: 5, target: 5, p95: 100 }, { i: 1, count: 12, rps: 5, target: 5, p95: 1400 }] });
  assert.deepEqual(sparse, [], "windows with few requests are ignored");
});
