"use strict";
// Shared helpers for the Node side (server + scripts). Reads the BE's own .env and
// node_modules instead of adding dependencies to this tool.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BE_DIR = path.resolve(ROOT, "../../qs-net-management-be");
const LOGS_DIR = path.resolve(ROOT, "../../logs");
const RESULTS_DIR = path.join(ROOT, "results");

const parseEnv = (file) => {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][\w]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
};

const toolEnv = () => ({ BASE_URL: "http://localhost:3020", ...parseEnv(path.join(ROOT, ".env")) });

// "Only local" rule from the plan: refuse any target that is not this machine.
const isLocalUrl = (url) => {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

const beRequire = (m) => require(path.join(BE_DIR, "node_modules", m));

/** Connection to the LOCAL dev DB named in qs-net-management-be/.env (mysql2 from the BE). */
async function connectDb() {
  const be = parseEnv(path.join(BE_DIR, ".env"));
  const prefix = (be.NODE_ENV || "dev") === "dev" ? "DEV" : "PROD";
  const host = be[`${prefix}_DB_HOST`] || "localhost";
  if (!["localhost", "127.0.0.1"].includes(host)) throw new Error(`DB host ${host} is not local`);
  const database = be[`${prefix}_DB_NAME`] || "qs_netm";
  const db = await beRequire("mysql2/promise").createConnection({ host, user: be[`${prefix}_DB_USER`] || "root", password: be[`${prefix}_DB_PASSWORD`], database });
  db.dbName = database;
  return db;
}

module.exports = { ROOT, BE_DIR, LOGS_DIR, RESULTS_DIR, parseEnv, toolEnv, isLocalUrl, beRequire, connectDb };
