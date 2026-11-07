"use strict";
// Creates the local `store` account k6 logs in with, bound to the busiest live store
// (or K6_STORE_ID from .env). `--remove` deletes every k6_perf_* test account.
// Writes only to the LOCAL dev DB named in qs-net-management-be/.env.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ROOT, parseEnv, beRequire, connectDb } = require("../lib/local");

const USERNAME = "k6_perf_store";

// Busiest live store that has a kiosk without the device-key gate.
const BUSIEST_STORE_SQL = `
  SELECT t.storeId FROM tickets t
  JOIN stores s ON s.id = t.storeId AND s.shutdownAt IS NULL
  WHERE EXISTS (SELECT 1 FROM devices d WHERE d.storeId = t.storeId AND d.apiV2Enabled = 0 AND d.isEnabled = 1)
  GROUP BY t.storeId ORDER BY COUNT(*) DESC LIMIT 1`;

const setEnvValues = (file, values) => {
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "BASE_URL=http://localhost:3020\n";
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text.trimEnd()}\n${k}=${v}\n`;
  }
  fs.writeFileSync(file, text);
};

async function main() {
  const db = await connectDb();
  try {
    const TEST_IDS = "SELECT id FROM (SELECT id FROM accounts WHERE username LIKE 'k6\\_perf\\_%' AND isTest = 1) x";
    if (process.argv.includes("--remove")) {
      await db.execute(`DELETE FROM account_stores WHERE accountId IN (${TEST_IDS})`);
      const [r] = await db.execute("DELETE FROM accounts WHERE username LIKE 'k6\\_perf\\_%' AND isTest = 1");
      console.log(`Removed ${r.affectedRows} k6 test account(s)`);
      return;
    }
    const envFile = path.join(ROOT, ".env");
    const env = parseEnv(envFile);
    let storeId = Number(env.K6_STORE_ID) || null;
    if (!storeId) [[{ storeId } = {}]] = await db.query(BUSIEST_STORE_SQL);
    if (!storeId) throw new Error("No live store with a kiosk found; set K6_STORE_ID in .env");

    const password = env.K6_WEB_USER === USERNAME && env.K6_WEB_PASS ? env.K6_WEB_PASS : crypto.randomBytes(12).toString("base64url");
    const hash = await beRequire("bcrypt").hash(password, 10);
    // Real store accounts reach their store through account_stores (auth.middleware
    // `authorization`), not accounts.storeId; copy the owner (parentId) of an existing one.
    const [[owner = {}]] = await db.execute(
      "SELECT a.parentId FROM accounts a JOIN account_stores x ON x.accountId = a.id WHERE x.storeId = ? AND a.type = 'store' LIMIT 1",
      [storeId]
    );
    const [rows] = await db.execute("SELECT id FROM accounts WHERE username = ?", [USERNAME]);
    let accountId = rows[0]?.id;
    if (accountId) {
      await db.execute(
        "UPDATE accounts SET password = ?, type = 'store', storeId = NULL, parentId = ?, deletedAt = NULL, mustChangePassword = 0 WHERE id = ?",
        [hash, owner.parentId ?? null, accountId]
      );
    } else {
      const [r] = await db.execute(
        "INSERT INTO accounts (username, type, password, fullname, parentId, isTest, createdAt, updatedAt) VALUES (?, 'store', ?, 'k6 perf test', ?, 1, NOW(), NOW())",
        [USERNAME, hash, owner.parentId ?? null]
      );
      accountId = r.insertId;
    }
    await db.execute("DELETE FROM account_stores WHERE accountId = ?", [accountId]);
    await db.execute("INSERT INTO account_stores (accountId, storeId, createdAt, updatedAt) VALUES (?, ?, NOW(), NOW())", [accountId, storeId]);
    setEnvValues(envFile, { K6_WEB_USER: USERNAME, K6_WEB_PASS: password, K6_STORE_ID: storeId });
    console.log(`Account ${USERNAME} (store ${storeId}) ready; credentials in ${envFile}`);
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
