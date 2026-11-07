"use strict";
// Streams ../../logs/*.log (morgan access lines) into results/baseline.json.
// Only aggregates are written: the log lines carry member data in REQ/RES.
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { LOGS_DIR, RESULTS_DIR } = require("../lib/local");
const { createBaseline } = require("../lib/report");

async function main() {
  const dir = process.argv[2] ? path.resolve(process.argv[2]) : LOGS_DIR;
  // .gz files are older copies of the same days as the .log files next to them.
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".log"));
  if (!files.length) throw new Error(`No .log files in ${dir}`);
  const agg = createBaseline();
  for (const f of files) {
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, f)), crlfDelay: Infinity });
    for await (const line of rl) agg.add(line);
  }
  const out = { source: dir, files: files.length, ...agg.result() };
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, "baseline.json"), JSON.stringify(out, null, 1));
  console.log(`baseline: ${out.endpoints.length} endpoints, ${out.days} days, peak ${out.peak.requests} req/min at ${out.peak.minute}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
