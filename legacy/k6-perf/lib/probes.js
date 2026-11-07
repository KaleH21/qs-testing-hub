"use strict";
// Server-side evidence collected around a run, without touching BE code:
//  - SQL: performance_schema digest snapshot before/after (read-only) -> what the DB spent time on
//  - CPU/RAM of the BE process and mysqld, sampled every second
const path = require("path");
const { spawn } = require("child_process");
const { ROOT, connectDb } = require("./local");

const DIGEST_SQL = `
  SELECT DIGEST AS digest, DIGEST_TEXT AS text, COUNT_STAR AS calls, SUM_TIMER_WAIT AS timer,
         SUM_ROWS_EXAMINED AS examined, SUM_ROWS_SENT AS sent, SUM_NO_INDEX_USED AS noIndex,
         SUM_NO_GOOD_INDEX_USED AS noGoodIndex
  FROM performance_schema.events_statements_summary_by_digest
  WHERE SCHEMA_NAME = ?`;

async function sqlSnapshot() {
  const db = await connectDb();
  try {
    const [rows] = await db.query(DIGEST_SQL, [db.dbName]);
    return rows.map((r) => ({ ...r, calls: Number(r.calls), timer: Number(r.timer), examined: Number(r.examined), sent: Number(r.sent), noIndex: Number(r.noIndex), noGoodIndex: Number(r.noGoodIndex) }));
  } finally {
    await db.end();
  }
}

/** Per-statement work done between two snapshots, heaviest first. Timer is picoseconds. */
function diffDigests(before, after, limit = 15) {
  const prev = new Map(before.map((r) => [r.digest, r]));
  const rows = [];
  for (const a of after) {
    const b = prev.get(a.digest) || { calls: 0, timer: 0, examined: 0, sent: 0, noIndex: 0, noGoodIndex: 0 };
    const calls = a.calls - b.calls;
    if (calls <= 0 || /events_statements_summary_by_digest/.test(a.text || "")) continue; // skip our own probe
    const totalMs = (a.timer - b.timer) / 1e9;
    rows.push({
      text: (a.text || "").slice(0, 2000),
      calls,
      totalMs,
      avgMs: totalMs / calls,
      examinedPerCall: (a.examined - b.examined) / calls,
      sentPerCall: (a.sent - b.sent) / calls,
      noIndex: a.noIndex - b.noIndex > 0 || a.noGoodIndex - b.noGoodIndex > 0,
    });
  }
  rows.sort((x, y) => y.totalMs - x.totalMs);
  const totalMs = rows.reduce((s, r) => s + r.totalMs, 0);
  return { totalMs, statements: rows.length, top: rows.slice(0, limit) };
}

/** Starts sampling the BE process; `stop()` resolves to [{t, beCpu, beMemMB}] (null where unknown). */
function startSampler(port) {
  // shortcut: Windows-only (PowerShell performance counters); elsewhere the run has no CPU/RAM data.
  if (process.platform !== "win32") return { stop: async () => null };
  const started = Date.now();
  const samples = [];
  const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "scripts", "sample-resources.ps1"), "-Port", String(port)]);
  let buf = "";
  const nn = (v, f = 1) => (v < 0 || !Number.isFinite(v) ? null : v / f);
  ps.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const [beCpu, beMem] = buf.slice(0, i).trim().split(" ").map(Number);
      buf = buf.slice(i + 1);
      if ([beCpu, beMem].some(Number.isNaN)) continue;
      samples.push({ t: Math.round((Date.now() - started) / 1000), beCpu: nn(beCpu), beMemMB: nn(beMem, 1048576) });
    }
  });
  ps.on("error", () => {});
  return {
    stop: async () => {
      ps.kill();
      return samples.length ? samples : null;
    },
  };
}

module.exports = { sqlSnapshot, diffDigests, startSampler };
