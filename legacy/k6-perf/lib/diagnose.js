"use strict";
// Rule-based diagnosis: turns a run's numbers into "likely cause" findings.
// Pure function, no I/O. Every finding says how sure it is: k6 only sees the outside
// of the BE, so most causes are hypotheses backed by evidence, not proof.

const SEV = { critical: 3, warning: 2, info: 1 };
const ms = (v) => (v == null ? "–" : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
const pct = (v, d = 1) => (v == null ? "–" : `${(v * 100).toFixed(d)}%`);
const kb = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
const quantile = (arr, q) => {
  const s = arr.filter((v) => v != null).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : null;
};

const BIG_BYTES = 200e3; // a response this big per call is a payload/pagination problem
const HOT_BE_CPU = 90; // % of one core: a single Node process is saturated near 100
const BUSY_DB = 0.8; // SQL time / wall time: ~1 means a query is running at every moment
const BIG_RAM_MB = 1024;

/** "[name] VU3 status=500 msg" lines that k6/main.js logs for the first failures of each VU. */
function failureSamples(logText) {
  const out = new Map();
  const re = /msg="\[([^\]]+)\] VU\d+ status=(\d+) ?((?:[^"\\]|\\.)*)"/g;
  for (const [, name, status, rest] of String(logText || "").matchAll(re)) {
    const list = out.get(name) || [];
    const text = `HTTP ${status} ${rest.replace(/\\"/g, '"').trim()}`.slice(0, 220);
    if (list.length < 3 && !list.includes(text)) list.push(text);
    out.set(name, list);
  }
  return out;
}

function resourceStats(samples) {
  if (!samples || !samples.length) return null;
  const be = samples.map((s) => s.beCpu);
  const mem = samples.map((s) => s.beMemMB).filter((v) => v != null);
  if (!mem.length && be.every((v) => v == null)) return null; // sampler never found the BE process
  return {
    beCpuP90: quantile(be, 0.9), beCpuMax: quantile(be, 1), beMemMax: quantile(mem, 1),
    beMemStart: mem.length ? quantile(mem.slice(0, Math.max(1, Math.floor(mem.length / 5))), 0.5) : null,
    beMemEnd: mem.length ? quantile(mem.slice(-Math.max(1, Math.floor(mem.length / 5))), 0.5) : null,
  };
}

/**
 * @param {object} p
 * @param {object} p.report   summaryToReport() output, endpoints enriched with {group, path, prodP95}
 * @param {object} p.slo      { p95Ms, successRate, availability }
 * @param {object} [p.sql]    diffDigests() output
 * @param {Array}  [p.resources] sampler output
 * @param {string} [p.logText] k6.log
 * @returns {Array<{severity, title, endpoint, evidence, cause, confidence, fix}>}
 */
function diagnose({ report, slo, sql, resources, logText }) {
  const findings = [];
  const add = (severity, f) => findings.push({ severity, endpoint: null, ...f });
  const eps = report.endpoints.filter((e) => e.count);
  const samples = failureSamples(logText);
  const res = resourceStats(resources);
  const beHot = res?.beCpuP90 != null && res.beCpuP90 >= HOT_BE_CPU;
  // Average number of SQL statements in flight (DB time / test time), from performance_schema.
  const dbLoad = sql?.totalMs != null && report.kpi.durationS ? sql.totalMs / (report.kpi.durationS * 1000) : null;
  const dbHot = dbLoad != null && dbLoad >= BUSY_DB;
  const sampleText = (name) => (samples.get(name)?.length ? ` Mẫu lỗi: ${samples.get(name).join(" | ")}` : "");
  const share = (n, e) => `${n.toLocaleString("en-US")} request (${pct(n / e.count)})`;

  // ---- 1. Errors: what kind, and the obvious reason for each kind -------------------------
  for (const e of eps) {
    const er = e.errors || {};
    const failsSlo = e.success != null && e.success < slo.successRate;
    if (er.rate_limited) add(failsSlo ? SEV.critical : SEV.warning, {
      endpoint: e.name, title: "Bị rate limit chặn (429)",
      evidence: `${share(er.rate_limited, e)} bị BE từ chối vì vượt giới hạn tần suất.`,
      cause: e.group === "mobile"
        ? "BE giới hạn mỗi IP 1.200 request/phút cho /api/mobile (mobileIpRateLimiter). k6 gửi mọi request từ 1 IP nên chạm giới hạn này. Đây là cơ chế bảo vệ, không phải API chậm."
        : "Rate limiter của BE chặn theo IP. k6 gửi mọi request từ 1 IP nên chạm giới hạn.",
      confidence: "Chắc chắn",
      fix: e.group === "mobile" ? "Khởi động lại BE với MOBILE_RATE_LIMIT_PER_MIN lớn hơn khi stress test, hoặc giảm hệ số tải." : "Giảm hệ số tải, hoặc nới giới hạn khi test.",
    });
    if (er.timeout) add(SEV.critical, {
      endpoint: e.name, title: "Timeout hoặc mất kết nối",
      evidence: `${share(er.timeout, e)} không nhận được phản hồi trong 30 giây hoặc bị từ chối kết nối.${beHot ? ` CPU Node đạt ${Math.round(res.beCpuMax)}% một nhân.` : ""}`,
      cause: beHot
        ? "Process Node của BE bão hoà CPU nên không kịp trả lời: request xếp hàng đến khi quá 30 giây."
        : "Server quá tải, treo, hoặc process BE bị restart giữa chừng (node --watch tự restart khi có file đổi).",
      confidence: beHot ? "Cao" : "Trung bình",
      fix: "Xem log BE ở thời điểm đó. Nếu CPU chạm 100% thì giảm tải hoặc chạy nhiều process (pm2 cluster).",
    });
    if (er.server_error) add(SEV.critical, {
      endpoint: e.name, title: "Lỗi server (5xx)",
      evidence: `${share(er.server_error, e)} trả lỗi 5xx.${sampleText(e.name)}`,
      cause: "Exception trong code hoặc lỗi DB (deadlock, hết connection trong pool, timeout truy vấn). Đây là lỗi làm giảm độ sẵn sàng.",
      confidence: "Cao",
      fix: "Đọc thông báo lỗi ở trên và log BE (pm2 logs) để thấy stack trace.",
    });
    if (er.body_error) add(failsSlo ? SEV.critical : SEV.warning, {
      endpoint: e.name, title: "API trả success:false",
      evidence: `${share(er.body_error, e)} có HTTP 200 nhưng body báo success:false.${sampleText(e.name)}`,
      cause: "API mobile báo lỗi bằng HTTP 200. Thường do dữ liệu test không hợp lệ (thiếu tham số, member/device không thuộc store) hoặc lỗi nghiệp vụ, không phải do tải.",
      confidence: "Cao",
      fix: "Đối chiếu thông báo lỗi; sửa body trong config/endpoints.json nếu do dữ liệu test.",
    });
    if (er.client_error) add(SEV.warning, {
      endpoint: e.name, title: "Lỗi phía client (4xx)",
      evidence: `${share(er.client_error, e)} trả 4xx (không tính 429).${sampleText(e.name)}`,
      cause: "Request sai (400), token hết hạn hoặc thiếu quyền (401/403), hoặc không tồn tại (404). Thường do cấu hình test.",
      confidence: "Cao",
      fix: "Kiểm tra path/body trong config/endpoints.json và tài khoản test (npm run seed).",
    });
  }

  // ---- 2. Latency: queueing vs. an inherently slow API -----------------------------------
  const heavy = eps.filter((e) => (e.med ?? 0) >= slo.p95Ms * 0.5 || (e.bytes ?? 0) >= BIG_BYTES);
  const queued = eps.filter((e) => e.med != null && e.med < 50 && e.p95 >= 300 && e.p95 >= 10 * e.med);
  if (queued.length >= 2) add(queued.some((e) => e.p95 >= slo.p95Ms) ? SEV.critical : SEV.warning, {
    title: "Request nhẹ phải xếp hàng chờ (nghẽn event loop)",
    evidence: `${queued.map((e) => `${e.name}: p50 ${ms(e.med)} nhưng p95 ${ms(e.p95)}`).join("; ")}.${res?.beCpuMax != null ? ` CPU Node cao nhất ${Math.round(res.beCpuMax)}% một nhân.` : ""}`,
    cause: `Các API này bình thường rất nhanh nhưng thỉnh thoảng phải chờ rất lâu, và nhiều API bị cùng lúc. BE chạy 1 process Node: khi một request nặng đang chạy hoặc đang serialize JSON lớn, mọi request khác phải chờ.${heavy.length ? ` Nghi phạm: ${heavy.map((h) => h.name).join(", ")}.` : ""}`,
    confidence: beHot || heavy.length ? "Cao" : "Trung bình",
    fix: "Phân trang và giảm payload của API nặng; chạy nhiều process (pm2 cluster mode); chuyển xử lý nặng sang worker thread.",
  });
  const queuedNames = new Set(queued.map((e) => e.name));
  for (const e of eps) {
    if (e.p95 == null || e.p95 < slo.p95Ms || queuedNames.has(e.name)) continue;
    const big = (e.bytes ?? 0) >= BIG_BYTES;
    const pageSize = Number(/pageSize=(\d+)/.exec(e.path || "")?.[1] || 0);
    const inherent = (e.med ?? 0) >= 0.3 * e.p95;
    add(SEV.critical, {
      endpoint: e.name,
      title: inherent ? "Vượt SLO: bản thân API chậm" : "Vượt SLO: thỉnh thoảng rất chậm (đuôi dài)",
      evidence: `p50 ${ms(e.med)} · p95 ${ms(e.p95)} · p99 ${ms(e.p99)}${e.bytes != null ? ` · response ≈ ${kb(e.bytes)}/lần` : ""}${e.prodP95 != null ? ` · prod p95 ${ms(e.prodP95)}` : ""}.`,
      cause: big
        ? `Response quá lớn (≈ ${kb(e.bytes)} JSON mỗi lần)${pageSize >= 1000 ? `, vì request xin pageSize=${pageSize.toLocaleString("en-US")}, tức lấy toàn bộ dữ liệu không phân trang` : ""}. Truy vấn, dựng object và serialize JSON đều tốn thời gian, và chặn các request khác.`
        : inherent
          ? `Phần lớn request đều chậm, nên chậm nằm trong chính API: truy vấn DB nặng hoặc xử lý nhiều.${dbHot ? " DB bận gần như liên tục trong lúc test, nên nghiêng về truy vấn (xem Top SQL)." : " Xem bảng Top SQL để tìm câu tốn thời gian."}`
          : "Đa số request nhanh nhưng một phần chờ rất lâu: tranh chấp với request khác, chờ khoá DB, hoặc GC của Node.",
      confidence: big ? "Cao" : "Trung bình",
      fix: big ? "Thêm phân trang thật (pageSize nhỏ), chỉ trả cột cần thiết, hoặc cache nếu dữ liệu ít đổi." : inherent ? "Tối ưu truy vấn hoặc thêm index (xem Top SQL); cache kết quả nếu được." : "Xem cùng thời điểm trong Timeline; kiểm tra API nặng chạy song song.",
    });
  }
  for (const e of eps) {
    if ((e.bytes ?? 0) >= BIG_BYTES && e.p95 < slo.p95Ms) add(SEV.info, {
      endpoint: e.name, title: "Response lớn (chưa vượt SLO)",
      evidence: `≈ ${kb(e.bytes)} mỗi lần, p95 ${ms(e.p95)}.`,
      cause: "Payload lớn tốn CPU để serialize và băng thông; khi tải tăng sẽ là API chậm đầu tiên.",
      confidence: "Trung bình",
      fix: "Cân nhắc phân trang hoặc giảm cột trả về.",
    });
  }

  // ---- 3. Load shape: saturation point, missed target rate, slow drift -------------------
  // Windows with few requests have a meaningless p95 (one slow call flips it), so skip them.
  const win = (report.windows || []).filter((w) => w.count >= 20);
  const bad = (w) => (w.p95 ?? 0) >= slo.p95Ms || (w.success ?? 1) < slo.successRate;
  const firstBad = win.findIndex(bad);
  // Saturation = it breaks once load rises AND stays broken; a p95 that flips back and forth
  // is noise from a few slow calls (reported by the queueing / per-API findings instead).
  const after = firstBad > 0 ? win.slice(firstBad) : [];
  const saturated = firstBad > 0 && after.filter(bad).length >= (2 / 3) * after.length && win[firstBad].target >= 1.2 * win[firstBad - 1].target;
  if (saturated) {
    const ok = win[firstBad - 1], b = win[firstBad];
    add(SEV.warning, {
      title: "Điểm bão hoà",
      evidence: `Đạt SLO tới khoảng ${ok.rps.toFixed(1)} req/s (giây ${Math.round(ok.startS)}–${Math.round(ok.endS)}). Từ giây ${Math.round(b.startS)} (≈ ${b.rps.toFixed(1)} req/s, mục tiêu ${b.target.toFixed(1)}) p95 lên ${ms(b.p95)}, thành công ${pct(b.success, 2)}.`,
      cause: "Vượt mức tải này hệ thống không còn đáp ứng SLO trên máy hiện tại. Đây là năng lực tối đa đo được.",
      confidence: "Cao",
      fix: "Xử lý các nguyên nhân ở trên rồi chạy lại để xem điểm bão hoà dịch lên bao nhiêu.",
    });
  } else if (firstBad > 0 && win.filter(bad).length >= 2 && !saturated) add(SEV.info, {
    title: "Latency dao động, không theo mức tải",
    evidence: `${win.filter(bad).length}/${win.length} khoảng thời gian vượt SLO, xen kẽ với khoảng đạt SLO ở cùng mức tải (p95 theo thời gian: ${win.map((w) => ms(w.p95)).join(", ")}).`,
    cause: "Không phải bão hoà: hệ thống chịu được mức tải này, nhưng thỉnh thoảng một vài request rất nặng làm mọi thứ chậm theo trong khoảng đó.",
    confidence: "Trung bình",
    fix: "Xử lý các API nặng ở trên; xem Timeline để khớp thời điểm chậm với request nặng.",
  });
  else if (firstBad === 0 && win.length >= 3 && win.every(bad)) add(SEV.info, {
    title: "Vượt SLO ngay từ đầu, kể cả lúc tải thấp",
    evidence: `Cửa sổ đầu tiên (≈ ${win[0].rps.toFixed(1)} req/s) đã có p95 ${ms(win[0].p95)}.`,
    cause: "Chậm không phụ thuộc mức tải: có API vốn đã chậm (xem các mục theo API).",
    confidence: "Cao",
    fix: "Tối ưu từng API vượt SLO trước khi đo năng lực chịu tải.",
  });
  if (report.kpi.dropped > 0) add(SEV.warning, {
    title: "k6 không đạt tốc độ mục tiêu",
    evidence: `${report.kpi.dropped.toLocaleString("en-US")} lượt request bị bỏ vì k6 hết VU${report.kpi.maxVUs ? ` (tối đa ${report.kpi.maxVUs})` : ""}.`,
    cause: "API trả lời chậm nên mỗi VU bị giữ lâu, k6 hết VU để gửi đúng số req/s. Tải thật đã thấp hơn kế hoạch, nên số liệu đang đẹp hơn thực tế.",
    confidence: "Chắc chắn",
    fix: "Coi đây là dấu hiệu quá tải. Muốn ép đủ tải thì tăng maxVUs trong k6/main.js.",
  });
  const peak = Math.max(0, ...win.map((w) => w.target));
  const steady = win.filter((w) => w.target >= 0.9 * peak);
  if (steady.length >= 6) {
    const third = Math.floor(steady.length / 3);
    const early = quantile(steady.slice(0, third).map((w) => w.p95), 0.5);
    const late = quantile(steady.slice(-third).map((w) => w.p95), 0.5);
    const memGrow = res?.beMemStart && res?.beMemEnd ? res.beMemEnd / res.beMemStart : null;
    if (early != null && late != null && late >= 1.5 * early && late - early >= 100) add(SEV.warning, {
      title: "Chậm dần theo thời gian ở cùng mức tải",
      evidence: `p95 đầu giai đoạn ổn định ${ms(early)} → cuối giai đoạn ${ms(late)}.${memGrow ? ` RAM Node ${Math.round(res.beMemStart)} → ${Math.round(res.beMemEnd)} MB.` : ""}`,
      cause: memGrow && memGrow >= 1.3 ? "Bộ nhớ Node tăng liên tục cùng lúc với latency: dấu hiệu rò rỉ bộ nhớ (cache không giới hạn, listener không gỡ)." : "Tài nguyên cạn dần: connection pool, bảng tạm hoặc dữ liệu phình ra trong lúc test.",
      confidence: memGrow && memGrow >= 1.3 ? "Trung bình" : "Thấp",
      fix: "Chạy soak dài hơn và theo dõi RAM; chụp heap snapshot của BE nếu RAM tăng mãi.",
    });
  }

  // ---- 4. Server resources (only when the sampler saw the processes) ---------------------
  if (beHot) add(SEV.warning, {
    title: "Node BE bão hoà CPU",
    evidence: `CPU process BE: 90% thời gian ≤ ${Math.round(res.beCpuP90)}%, cao nhất ${Math.round(res.beCpuMax)}% một nhân.`,
    cause: "BE chạy 1 process Node nên chỉ dùng được 1 nhân CPU. Ở mức gần 100%, mọi request phải chờ nhau.",
    confidence: "Cao",
    fix: "Chạy nhiều process (pm2 -i max) hoặc tối ưu đoạn code tốn CPU (serialize JSON lớn, vòng lặp trên mảng lớn).",
  });
  if (dbHot) add(SEV.warning, {
    title: "DB bận liên tục",
    evidence: `Tổng thời gian SQL ${ms(sql.totalMs)} trong ${Math.round(report.kpi.durationS)} s test: trung bình ${dbLoad.toFixed(2)} truy vấn đang chạy ở mọi thời điểm.`,
    cause: "MySQL gần như không lúc nào rảnh: truy vấn nặng, quét nhiều dòng hoặc thiếu index. Request phải chờ DB.",
    confidence: "Cao",
    fix: "Xem bảng Top SQL; thêm index cho cột trong WHERE/JOIN của các câu đứng đầu.",
  });
  if (res?.beMemMax >= BIG_RAM_MB) add(SEV.warning, {
    title: "Node BE dùng nhiều RAM",
    evidence: `RAM riêng của process BE lên tới ${Math.round(res.beMemMax).toLocaleString("en-US")} MB.`,
    cause: `Giữ nhiều dữ liệu trong bộ nhớ: response JSON rất lớn${heavy.some((h) => (h.bytes ?? 0) >= BIG_BYTES) ? ` (${heavy.filter((h) => (h.bytes ?? 0) >= BIG_BYTES).map((h) => `${h.name} ≈ ${kb(h.bytes)}`).join(", ")})` : ""} được dựng thành object rồi serialize, hoặc cache không giới hạn. GC phải chạy nhiều, làm mọi request chậm theo; gần giới hạn heap thì process sẽ crash.`,
    confidence: "Trung bình",
    fix: "Phân trang các API trả dữ liệu lớn; kiểm tra cache trong bộ nhớ có giới hạn kích thước chưa.",
  });
  if ((res || dbLoad != null) && !beHot && !dbHot && eps.some((e) => e.p95 >= slo.p95Ms)) add(SEV.info, {
    title: "CPU và DB không quá tải nhưng vẫn chậm",
    evidence: [res?.beCpuMax != null ? `CPU Node cao nhất ${Math.round(res.beCpuMax)}% một nhân` : null, dbLoad != null ? `DB bận trung bình ${dbLoad.toFixed(2)} truy vấn đồng thời` : null].filter(Boolean).join("; ") + ".",
    cause: "Thời gian chủ yếu là chờ, không phải tính: request chờ nhau trong 1 process Node (xem mục xếp hàng), chờ khoá DB, hoặc I/O ổ đĩa. Một vài request rất nặng đủ làm các request khác phải đợi dù tổng tải không cao.",
    confidence: "Thấp",
    fix: "Xử lý các API nặng trước; xem Top SQL theo thời gian trung bình mỗi lần gọi.",
  });

  // ---- 5. SQL evidence -------------------------------------------------------------------
  for (const s of (sql?.top || []).filter((x) => x.noIndex && x.examinedPerCall >= 1000).slice(0, 3)) add(SEV.warning, {
    title: "Truy vấn không dùng index",
    evidence: `${s.calls.toLocaleString("en-US")} lần, TB ${ms(s.avgMs)}, quét ≈ ${Math.round(s.examinedPerCall).toLocaleString("en-US")} dòng/lần, trả ≈ ${Math.round(s.sentPerCall).toLocaleString("en-US")} dòng. SQL: ${s.text.slice(0, 180)}…`,
    cause: "MySQL phải quét toàn bảng (full scan) vì không có index phù hợp.",
    confidence: "Cao",
    fix: "Thêm index cho cột lọc/JOIN của câu này (EXPLAIN để xác nhận).",
  });
  const top = sql?.top?.[0];
  if (top && sql.totalMs > 0 && top.totalMs / sql.totalMs >= 0.5 && top.totalMs >= 1000) add(SEV.info, {
    title: "Một truy vấn chiếm phần lớn thời gian DB",
    evidence: `${pct(top.totalMs / sql.totalMs, 0)} tổng thời gian DB trong lúc test (${ms(top.totalMs)}, ${top.calls.toLocaleString("en-US")} lần). SQL: ${top.text.slice(0, 180)}…`,
    cause: "Tối ưu riêng câu này sẽ giảm tải DB nhiều nhất.",
    confidence: "Cao",
    fix: "EXPLAIN câu này; thêm index, giảm cột, hoặc cache kết quả.",
  });

  // ---- 6. Local vs production ------------------------------------------------------------
  for (const e of eps) {
    if (e.prodP95 == null || e.p95 == null) continue;
    if (e.prodP95 >= slo.p95Ms && e.p95 < e.prodP95 / 3) add(SEV.info, {
      endpoint: e.name, title: "Local nhanh hơn production nhiều",
      evidence: `Local p95 ${ms(e.p95)}, production p95 ${ms(e.prodP95)}.`,
      cause: "Kết quả local có thể quá lạc quan: DB local ít dữ liệu hơn (dừng ở ngày backup, truy vấn \"today\" trả rỗng) và prod chịu tải từ nhiều store cùng lúc.",
      confidence: "Trung bình",
      fix: "Đừng kết luận API này ổn chỉ từ local; đối chiếu với tab Baseline prod.",
    });
    else if (e.p95 >= 3 * e.prodP95 && e.p95 >= 300 && !queuedNames.has(e.name)) add(SEV.info, {
      endpoint: e.name, title: "Local chậm hơn production nhiều",
      evidence: `Local p95 ${ms(e.p95)}, production p95 ${ms(e.prodP95)}.`,
      cause: "Máy local yếu hơn server prod, hoặc trong lần test API này bị chen bởi API nặng khác (prod có nhiều traffic nhẹ hơn).",
      confidence: "Thấp",
      fix: "Chạy lại chỉ với API này để tách khỏi ảnh hưởng của API khác.",
    });
  }

  return findings.sort((a, b) => b.severity - a.severity);
}

module.exports = { diagnose, failureSamples, resourceStats, SEV };
