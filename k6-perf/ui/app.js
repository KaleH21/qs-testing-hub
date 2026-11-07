"use strict";
const $view = document.getElementById("view");
let CFG = null;
let charts = [];
let stream = null;

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ms = (v) => (v == null ? "–" : v >= 1000 ? (v / 1000).toFixed(2) + " s" : v.toFixed(v < 10 ? 2 : 0) + " ms");
const pct = (v, d = 2) => (v == null ? "–" : (v * 100).toFixed(d) + "%");
const num = (v, d = 0) => (v == null ? "–" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));
const bytes = (v) => (v == null ? "–" : v > 1e9 ? (v / 1e9).toFixed(2) + " GB" : v > 1e6 ? (v / 1e6).toFixed(1) + " MB" : (v / 1e3).toFixed(0) + " KB");
const when = (iso) => (iso ? new Date(iso).toLocaleString("vi-VN", { hour12: false }) : "–");
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { "Content-Type": "application/json" } });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
  return body;
}

function verdict(meta, pass) {
  if (meta.status === "running") return `<span class="badge b-run">ĐANG CHẠY</span>`;
  if (meta.status === "failed") return `<span class="badge b-fail">LỖI</span>`;
  if (pass == null) return `<span class="badge b-none">–</span>`;
  const tag = meta.status === "stopped" ? " (dừng)" : "";
  return pass ? `<span class="badge b-pass">PASS${tag}</span>` : `<span class="badge b-fail">FAIL${tag}</span>`;
}
// API name plus the real method + URL it calls ({{…}} are filled per request, see README).
const urlOf = (r) => (r?.path ? `${r.method} ${r.path}` : "");
const nameCell = (r) => `<td class="l name">${esc(r.name)}${r.path ? `<div class="url"><span class="m">${esc(r.method)}</span>${esc(r.path)}</div>` : ""}</td>`;
// ---------- glossary tooltips ----------
const GLOSSARY = {
  p50: "Trung vị: 50% request nhanh hơn mức này. Đại diện cho trải nghiệm \"bình thường\".",
  p90: "90% request nhanh hơn mức này, 10% còn lại chậm hơn.",
  p95: "95% request nhanh hơn mức này, chỉ 5% chậm hơn. Đây là chỉ số dùng cho SLO (phải dưới 1 giây).",
  p99: "99% request nhanh hơn mức này. Phản ánh 1% request chậm nhất, tức trường hợp xấu mà một số người dùng gặp.",
  avg: "Trung bình cộng thời gian phản hồi. Dễ bị vài request rất chậm kéo lệch, nên ưu tiên xem p95.",
  max: "Request chậm nhất trong cả lần chạy.",
  "req/s": "Request mỗi giây (throughput): số request thực sự gửi đi và nhận được phản hồi trong mỗi giây.",
  Request: "Tổng số request HTTP đã gửi.",
  SLO: "Service Level Objective, mục tiêu chất lượng đã chốt: p95 < 1 giây, thành công ≥ 99%, sẵn sàng ≥ 99,9%.",
  "Thành công": "Tỉ lệ request trả HTTP 2xx. Với API mobile, body còn phải KHÔNG có success:false (mobile báo lỗi bằng HTTP 200). Ngưỡng ≥ 99%.",
  "Sẵn sàng": "Tỉ lệ request server có trả lời: không lỗi 5xx, không timeout hay lỗi kết nối. Lỗi 429 (bị giới hạn) vẫn tính là sẵn sàng. Ngưỡng ≥ 99,9%.",
  VU: "Virtual User, \"người dùng ảo\" của k6, mỗi VU gửi request song song. Profile giữ tốc độ req/s cố định nên k6 tự thêm VU khi API chậm đi.",
  "4xx": "Tỉ lệ lỗi phía client (400 sai dữ liệu, 401 chưa đăng nhập, 404 không tồn tại, 429 bị giới hạn…).",
  "5xx": "Tỉ lệ lỗi phía server (500 lỗi code, 502/503 server không phục vụ được). Đây là lỗi làm giảm độ sẵn sàng.",
  "p95 prod": "p95 thật trên production, tính từ access log (xem tab Baseline prod). Dùng để so với kết quả local.",
  "Kết quả": "PASS khi mọi ngưỡng SLO đều đạt, cả ngưỡng tổng lẫn ngưỡng của từng API. FAIL nếu chỉ cần một ngưỡng không đạt.",
  "×Tải": "Hệ số tải: nhân mọi mức req/s của profile. Ví dụ 2 là gấp đôi tải.",
  "Hệ số tải": "Nhân mọi mức req/s của profile. Ví dụ load 12 req/s × 2 = 24 req/s.",
  Profile: "Kịch bản tải: smoke, load, stress, spike, soak. Rê chuột vào tên từng profile để xem giải thích.",
  smoke: "Kiểm tra nhanh 1 req/s trong 30 giây: script, đăng nhập và API có chạy đúng không. Chạy trước mọi test khác.",
  load: "Tải bình thường lúc cao điểm: tăng lên 12 req/s rồi giữ 5 phút (đỉnh thật trên prod khoảng 9,4 req/s).",
  stress: "Tăng tải theo bậc 12 → 25 → 50 → 100 req/s để tìm ngưỡng hệ thống bắt đầu chậm hoặc lỗi.",
  spike: "Tải tăng vọt từ 5 lên 60 req/s trong 10 giây, giống nhiều kiosk khởi động cùng lúc.",
  soak: "Giữ 12 req/s trong 1 giờ để phát hiện rò rỉ bộ nhớ hoặc cạn connection pool.",
  "tỉ trọng": "Tỉ lệ API này được chọn trong hỗn hợp request, lấy theo số request thật trong log. Tỉ trọng càng cao thì API càng được gọi nhiều.",
  "Δ": "Chênh lệch của B so với A, tính theo %: (B − A) / A. Đỏ là B tệ hơn quá 10%, xanh là tốt hơn quá 10%.",
  "đ.p.": "Điểm phần trăm: hiệu số giữa hai tỉ lệ. Ví dụ 99% → 98% là −1 đ.p.",
  "Đỉnh tải": "Phút có nhiều request nhất trong toàn bộ log. Dùng để chọn mức tải cho profile load.",
  "Dữ liệu": "Tổng dung lượng response nhận về; dòng dưới là dung lượng gửi đi và số VU tối đa đã dùng.",
  "Có trong tool": "✓ nếu endpoint này đã có trong bộ test k6 (config/endpoints.json).",
  "Độ tin cậy": "Mức chắc chắn của kết luận. Chắc chắn/Cao: có bằng chứng trực tiếp. Trung bình/Thấp: suy luận từ dấu hiệu, cần kiểm tra thêm. k6 chỉ nhìn từ bên ngoài BE nên phần lớn là giả thuyết có bằng chứng.",
  Size: "Kích thước trung bình của response (JSON chưa nén) mỗi lần gọi. Trên ~200 KB là dấu hiệu trả quá nhiều dữ liệu / không phân trang.",
  "Lỗi": "Phân loại request lỗi: timeout (không trả lời trong 30 s), 429 (bị rate limit), 5xx (lỗi server), 4xx (request sai), body (HTTP 200 nhưng success:false).",
  CPU: "% của MỘT nhân CPU mà process Node BE dùng. BE chạy 1 process nên ~100% là bão hoà. MySQL không đo CPU được (chạy dạng service, cần quyền admin); độ bận DB lấy từ tổng thời gian SQL ở bảng Top SQL.",
  "Top SQL": "Các câu SQL tốn nhiều thời gian nhất trong lúc test, lấy từ performance_schema của MySQL (trước/sau lần chạy). Gồm mọi truy vấn vào DB trong lúc đó, kể cả từ FE hay cron, không riêng k6.",
  "Dòng quét": "Số dòng MySQL phải đọc cho mỗi lần chạy câu này. Quét nhiều mà trả ít là dấu hiệu thiếu index.",
};
const SEV_LABEL = { 3: ["Nghiêm trọng", "b-fail"], 2: ["Cảnh báo", "b-run"], 1: ["Lưu ý", "b-none"] };
const ERR_LABEL = { timeout: "timeout", rate_limited: "429", server_error: "5xx", client_error: "4xx", body_error: "body" };
const errorsCell = (e) => Object.entries(e || {}).filter(([, n]) => n).map(([k, n]) => `<span class="bad">${ERR_LABEL[k]}×${num(n)}</span>`).join(" · ") || "–";
// Glossary term with a dotted underline; falls back to plain text when the term is unknown.
const t = (key, label = key) => (GLOSSARY[key] ? `<span class="term" tabindex="0" data-tip="${esc(GLOSSARY[key])}">${esc(label)}</span>` : esc(label));

const passCell = (p) => (p == null ? `<span class="badge b-none">không có request</span>` : p ? `<span class="badge b-pass">PASS</span>` : `<span class="badge b-fail">FAIL</span>`);

function newChart(canvas, config) {
  Chart.defaults.color = css("--muted");
  Chart.defaults.borderColor = css("--line");
  Chart.defaults.font.family = css("--sans");
  const c = new Chart(canvas, config);
  charts.push(c);
  return c;
}

// Dashed reference line (SLO by default) across a chart; skipped when off the visible range.
const sloLine = (value, axis = "x", label = `SLO ${ms(value)}`) => ({
  id: "slo",
  afterDatasetsDraw(chart) {
    const scale = chart.scales[axis];
    if (!scale || value == null) return;
    const { ctx, chartArea: a } = chart;
    const px = scale.getPixelForValue(value);
    if (axis === "x" ? px < a.left || px > a.right : px < a.top || px > a.bottom) return;
    ctx.save();
    ctx.strokeStyle = css("--fail");
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    if (axis === "x") { ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); } else { ctx.moveTo(a.left, px); ctx.lineTo(a.right, px); }
    ctx.stroke();
    ctx.fillStyle = css("--fail");
    ctx.font = "11px " + css("--sans");
    ctx.fillText(label, axis === "x" ? px + 4 : a.left + 4, axis === "x" ? a.top + 10 : px - 4);
    ctx.restore();
  },
});

function sortable(table, rows, columns, render) {
  let key = null, dir = -1;
  table.querySelectorAll("th[data-k]").forEach((th) => {
    th.classList.add("sort");
    th.addEventListener("click", () => {
      dir = key === th.dataset.k ? -dir : -1;
      key = th.dataset.k;
      const col = columns[key];
      rows.sort((a, b) => {
        const x = col(a), y = col(b);
        return (typeof x === "string" ? x.localeCompare(y) : (x ?? -Infinity) - (y ?? -Infinity)) * dir;
      });
      table.querySelector("tbody").innerHTML = rows.map(render).join("");
    });
  });
}

// ---------- views ----------
async function viewRuns() {
  const runs = await api("/api/runs");
  if (!runs.length) {
    $view.innerHTML = `<h1>Lần chạy</h1><div class="panel empty">Chưa có lần chạy nào. <a href="#new">Chạy test đầu tiên</a> (nên bắt đầu bằng <b>smoke</b>).</div>`;
    return;
  }
  const done = runs.filter((r) => r.kpi).slice(0, 30).reverse();
  $view.innerHTML = `
    <div class="row"><div class="grow"><h1>Lần chạy</h1><p class="sub">${runs.length} lần chạy · ${t("SLO")}: ${t("p95")} &lt; ${ms(CFG.slo.p95Ms)}, ${t("Thành công", "thành công")} ≥ ${pct(CFG.slo.successRate, 1)}, ${t("Sẵn sàng", "sẵn sàng")} ≥ ${pct(CFG.slo.availability, 1)}</p></div>
      <button class="btn" id="cmp" disabled>So sánh 2 lần đã chọn</button>${CFG.canRun ? `<a class="btn primary" href="#new">Chạy mới</a>` : ""}</div>
    ${done.length > 1 ? `<div class="panel"><h2>Xu hướng p95 và tỉ lệ thành công</h2><div class="chart" style="height:240px"><canvas id="trend"></canvas></div></div>` : ""}
    <div class="panel table-wrap"><table>
      <thead><tr><th></th><th class="l">Thời gian</th><th class="l">${t("Profile")}</th><th>${t("×Tải")}</th><th>${t("Request")}</th><th>${t("req/s")}</th><th>${t("p95")}</th><th>${t("p99")}</th><th>${t("Thành công")}</th><th>${t("Sẵn sàng")}</th><th>${t("Kết quả")}</th></tr></thead>
      <tbody>${runs.map((r) => `
        <tr class="link" data-id="${esc(r.id)}">
          <td><input type="checkbox" data-pick="${esc(r.id)}" aria-label="Chọn để so sánh" ${r.kpi ? "" : "disabled"}></td>
          <td class="l">${when(r.startedAt)}</td><td class="l">${t(r.profile)}</td><td>${r.rateScale}</td>
          <td>${num(r.kpi?.requests)}</td><td>${num(r.kpi?.rps, 1)}</td>
          <td class="${r.kpi?.p95 > CFG.slo.p95Ms ? "bad" : ""}">${ms(r.kpi?.p95)}</td><td>${ms(r.kpi?.p99)}</td>
          <td class="${r.kpi && r.kpi.success < CFG.slo.successRate ? "bad" : ""}">${pct(r.kpi?.success)}</td>
          <td class="${r.kpi && r.kpi.available < CFG.slo.availability ? "bad" : ""}">${pct(r.kpi?.available, 3)}</td>
          <td>${verdict(r, r.pass)}</td></tr>`).join("")}</tbody></table></div>`;

  const picked = new Set();
  $view.querySelectorAll("tr.link").forEach((tr) => tr.addEventListener("click", (e) => {
    if (e.target.matches("input")) return;
    location.hash = `#run/${tr.dataset.id}`;
  }));
  const btn = document.getElementById("cmp");
  $view.querySelectorAll("[data-pick]").forEach((cb) => cb.addEventListener("change", () => {
    cb.checked ? picked.add(cb.dataset.pick) : picked.delete(cb.dataset.pick);
    btn.disabled = picked.size !== 2;
  }));
  btn.addEventListener("click", () => { const [a, b] = [...picked].sort(); location.hash = `#compare/${a}/${b}`; });

  if (done.length > 1) {
    newChart(document.getElementById("trend"), {
      type: "line",
      data: {
        labels: done.map((r) => `${when(r.startedAt).slice(0, 16)} ${r.profile}`),
        datasets: [
          { label: "p95 (ms)", data: done.map((r) => r.kpi.p95), borderColor: css("--series-a"), backgroundColor: css("--series-a"), yAxisID: "y", tension: 0.2 },
          { label: "Thành công (%)", data: done.map((r) => r.kpi.success * 100), borderColor: css("--pass"), backgroundColor: css("--pass"), yAxisID: "y1", tension: 0.2 },
        ],
      },
      options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        scales: { x: { ticks: { display: false } }, y: { beginAtZero: true, title: { display: true, text: "ms" } },
          y1: { position: "right", min: 0, max: 100, grid: { drawOnChartArea: false }, title: { display: true, text: "%" } } } },
      plugins: [sloLine(CFG.slo.p95Ms, "y")],
    });
  }
}

function viewNew() {
  if (!CFG.canRun) {
    $view.innerHTML = `<h1>Chạy mới</h1><div class="note">Bạn đang xem qua mạng LAN: chỉ xem được báo cáo. Muốn chạy test, mở tool trên chính máy đang chạy nó (http://127.0.0.1:4000).</div>`;
    return;
  }
  const byGroup = (g) => CFG.endpoints.filter((e) => e.group === g);
  const firstProfile = Object.keys(CFG.profiles)[0];
  $view.innerHTML = `
    <h1>Chạy mới</h1><p class="sub">Target <span class="num">${esc(CFG.baseUrl)}</span> · store <span class="num">${esc(CFG.storeId ?? "?")}</span></p>
    ${CFG.seeded ? "" : `<div class="err">Chưa có tài khoản test. Chạy <code>npm run seed</code> trong <code>tool/k6-perf</code> rồi tải lại trang.</div>`}
    ${CFG.active ? `<div class="note">Đang có lần chạy <a href="#run/${esc(CFG.active)}">${esc(CFG.active)}</a>. Mỗi lúc chỉ chạy được 1 test.</div>` : ""}
    <div class="panel"><h2>1. Profile tải</h2><div class="profiles">
      ${Object.entries(CFG.profiles).map(([k, p]) => `<label class="choice"><input type="radio" name="profile" value="${esc(k)}" ${k === firstProfile ? "checked" : ""}><div><b>${t(k)}</b><span>${esc(p.label)}</span></div></label>`).join("")}
    </div>
    <div class="row" style="margin-top:12px"><label for="scale">${t("Hệ số tải")} (nhân mọi mức ${t("req/s")})</label><input id="scale" type="number" min="0.1" max="20" step="0.1" value="1" style="width:90px"></div>
    <p class="sub" style="margin:8px 0 0">Lưu ý: BE giới hạn mỗi IP 1.200 request/phút cho <code>/api/mobile</code> (≈ 20 req/s). Muốn stress cao hơn, khởi động lại BE với <code>MOBILE_RATE_LIMIT_PER_MIN</code> lớn hơn, nếu không sẽ thấy lỗi 429.</p></div>
    <div class="panel"><h2>2. API cần test</h2>
      ${["mobile", "web"].map((g) => `
        <div class="row" style="margin:6px 0"><b>${g === "web" ? "Web (qs-net-management)" : "Mobile (kiosk)"}</b><button class="btn" data-all="${g}" type="button">Chọn / bỏ hết</button></div>
        <div class="eps">${byGroup(g).map((e) => `<label><input type="checkbox" name="ep" value="${esc(e.name)}" data-g="${g}" checked>${esc(e.name)}<em>${t("tỉ trọng")} ${e.weight}</em></label>`).join("")}</div>`).join("")}
    </div>
    <div class="row"><button class="btn primary" id="start" ${CFG.seeded && !CFG.active ? "" : "disabled"}>Bắt đầu</button><span id="msg" class="bad"></span></div>`;

  $view.querySelectorAll("[data-all]").forEach((b) => b.addEventListener("click", () => {
    const boxes = [...$view.querySelectorAll(`input[data-g="${b.dataset.all}"]`)];
    const on = !boxes.every((x) => x.checked);
    boxes.forEach((x) => (x.checked = on));
  }));
  document.getElementById("start").addEventListener("click", async (ev) => {
    ev.target.disabled = true;
    try {
      const meta = await api("/api/runs", { method: "POST", body: JSON.stringify({
        profile: $view.querySelector("input[name=profile]:checked").value,
        rateScale: Number(document.getElementById("scale").value),
        endpoints: [...$view.querySelectorAll("input[name=ep]:checked")].map((x) => x.value),
      }) });
      location.hash = `#run/${meta.id}`;
    } catch (e) {
      document.getElementById("msg").textContent = e.message;
      ev.target.disabled = false;
    }
  });
}

function diagnosisPanel(findings, report) {
  if (!findings) return "";
  const head = `<h2>Nguyên nhân có khả năng <span class="sub">(${findings.length} phát hiện · tự động suy luận, xem ${t("Độ tin cậy", "độ tin cậy")})</span></h2>`;
  if (!findings.length) return `<div class="panel">${head}<p class="good" style="margin:0">Không phát hiện vấn đề: mọi API đạt SLO, không có lỗi, không thấy dấu hiệu nghẽn.</p></div>`;
  const byName = new Map(report.endpoints.map((e) => [e.name, e]));
  const counts = [3, 2, 1].map((s) => [s, findings.filter((f) => f.severity === s).length]).filter(([, n]) => n);
  return `<div class="panel">${head}
    <div class="row" style="margin-bottom:10px">${counts.map(([s, n]) => `<span class="badge ${SEV_LABEL[s][1]}">${n} ${SEV_LABEL[s][0].toLowerCase()}</span>`).join("")}</div>
    ${findings.map((f) => { const e = f.endpoint && byName.get(f.endpoint); return `
    <div class="finding sev-${f.severity}">
      <div class="row"><span class="badge ${SEV_LABEL[f.severity][1]}">${SEV_LABEL[f.severity][0]}</span><b>${esc(f.title)}</b>
        ${f.endpoint ? `<span class="num ep">${esc(f.endpoint)}</span>` : `<span class="sub">toàn hệ thống</span>`}
        <span class="conf">Độ tin cậy: <b>${esc(f.confidence)}</b></span></div>
      ${e?.path ? `<div class="url"><span class="m">${esc(e.method)}</span>${esc(e.path)}</div>` : ""}
      <dl><dt>Dấu hiệu</dt><dd>${esc(f.evidence)}</dd><dt>Nguyên nhân</dt><dd>${esc(f.cause)}</dd><dt>Nên làm</dt><dd>${esc(f.fix)}</dd></dl>
    </div>`; }).join("")}</div>`;
}

function sqlPanel(sql, durationS) {
  if (!sql) return "";
  if (sql.error) return `<div class="panel"><h2>${t("Top SQL")}</h2><p class="sub" style="margin:0">Không đọc được performance_schema: ${esc(sql.error)}</p></div>`;
  if (!sql.top?.length) return "";
  return `<div class="panel table-wrap"><h2>${t("Top SQL")} trong lúc test <span class="sub">(${num(sql.statements)} loại câu, tổng ${ms(sql.totalMs)} thời gian DB${durationS ? ` ≈ trung bình ${(sql.totalMs / durationS / 1000).toFixed(2)} truy vấn chạy đồng thời` : ""})</span></h2>
    <table><thead><tr><th>#</th><th class="l">SQL</th><th>Lần gọi</th><th>Tổng</th><th>TB/lần</th><th>% thời gian DB</th><th>${t("Dòng quét")}/lần</th><th>Trả/lần</th><th class="l">Index</th></tr></thead><tbody>
    ${sql.top.map((s, i) => `<tr><td class="num">${i + 1}</td><td class="l sql" tabindex="0" data-tip="${esc(s.text.slice(0, 700))}">${esc(s.text.slice(0, 140))}${s.text.length > 140 ? "…" : ""}</td>
      <td>${num(s.calls)}</td><td>${ms(s.totalMs)}</td><td class="${s.avgMs >= 100 ? "bad" : ""}">${ms(s.avgMs)}</td><td>${pct(sql.totalMs ? s.totalMs / sql.totalMs : 0, 1)}</td>
      <td class="${s.examinedPerCall >= 1000 && s.examinedPerCall > 10 * (s.sentPerCall || 1) ? "bad" : ""}">${num(s.examinedPerCall)}</td><td>${num(s.sentPerCall)}</td>
      <td class="l">${s.noIndex ? `<span class="badge b-fail">không dùng index</span>` : "✓"}</td></tr>`).join("")}
    </tbody></table></div>`;
}

async function viewRun(id) {
  const { meta, report, diagnosis, sql, resources, hasDashboard } = await api(`/api/runs/${encodeURIComponent(id)}`);
  const running = meta.status === "running";
  const slo = meta.slo || CFG.slo;
  const k = report?.kpi;
  const tile = (label, value, target, ok) => `<div class="kpi ${ok == null ? "" : ok ? "pass" : "fail"}"><div class="l">${label}</div><div class="v">${value}</div><div class="t">${target}</div></div>`;

  $view.innerHTML = `
    <div class="row"><div class="grow"><h1>${esc(meta.id)} ${verdict(meta, report?.pass)}</h1>
      <p class="sub">${esc(meta.profileLabel)} · ×${meta.rateScale} · ${meta.endpoints.length} API · bắt đầu ${when(meta.startedAt)}${meta.finishedAt ? ` · xong ${when(meta.finishedAt)}` : ""}</p></div>
      ${running && CFG.canRun ? `<a class="btn" href="http://127.0.0.1:5665" target="_blank" rel="noopener" data-tip="Dashboard thời gian thực của k6 (cổng 5665): RPS, latency, VU cập nhật từng giây. Chỉ mở được khi test đang chạy và trên máy chạy tool.">Live dashboard</a><button class="btn danger" id="stop" data-tip="Dừng test ngay. k6 vẫn ghi báo cáo cho phần đã chạy (trạng thái: dừng).">Dừng</button>` : ""}
      ${hasDashboard ? `<a class="btn" href="/runs/${esc(meta.id)}/dashboard.html" target="_blank" rel="noopener" data-tip="Báo cáo HTML k6 tự xuất khi chạy xong: biểu đồ RPS, latency, số VU và lỗi theo từng giây. Dùng để xem API bắt đầu chậm ở thời điểm nào.">Timeline (k6 dashboard)</a>` : ""}
      ${report ? `<a class="btn" href="#compare/${esc(meta.id)}/" data-tip="Mở màn So sánh, với lần chạy này là A.">So sánh với…</a>` : ""}</div>
    ${meta.status === "failed" ? `<div class="err">k6 dừng mà không có báo cáo${meta.error ? `: ${esc(meta.error)}` : ""}. Xem log bên dưới.</div>` : ""}
    ${k ? `<div class="kpis">
      ${tile(`${t("p95")} toàn bộ`, ms(k.p95), `${t("SLO")} &lt; ${ms(slo.p95Ms)}`, k.p95 < slo.p95Ms)}
      ${tile(t("Thành công"), pct(k.success), `${t("SLO")} ≥ ${pct(slo.successRate, 1)}`, k.success >= slo.successRate)}
      ${tile(t("Sẵn sàng"), pct(k.available, 3), `${t("SLO")} ≥ ${pct(slo.availability, 1)}`, k.available >= slo.availability)}
      ${tile(t("Request"), num(k.requests), `${num(k.rps, 2)} ${t("req/s")} · ${num(k.durationS, 0)} s`)}
      ${tile(`${t("p99")} / ${t("avg")}`, ms(k.p99), `${t("avg")} ${ms(k.avg)}`)}
      ${tile(t("Dữ liệu"), bytes(k.dataReceived), `nhận · gửi ${bytes(k.dataSent)} · tối đa ${num(k.vusMax)} ${t("VU")}`)}
    </div>
    ${diagnosisPanel(diagnosis, report)}
    <div class="panel"><h2>p95 theo API: local (k6) so với production (log thật)</h2><div class="chart" style="height:${Math.max(220, report.endpoints.length * 34 + 60)}px"><canvas id="p95"></canvas></div></div>
    <div class="panel table-wrap"><h2>Thống kê theo API</h2><table id="eps"><thead><tr>
      <th class="l" data-k="name">API</th><th data-k="count">${t("Request")}</th><th data-k="rps">${t("req/s")}</th><th data-k="avg">${t("avg")}</th><th data-k="med">${t("p50")}</th><th data-k="p90">${t("p90")}</th>
      <th data-k="p95">${t("p95")}</th><th data-k="p99">${t("p99")}</th><th data-k="max">${t("max")}</th><th data-k="success">${t("Thành công")}</th><th data-k="available">${t("Sẵn sàng")}</th>
      <th data-k="bytes">${t("Size")}</th><th class="l">${t("Lỗi")}</th><th data-k="prodP95">${t("p95 prod")}</th><th data-k="pass">${t("Kết quả")}</th></tr></thead><tbody></tbody></table></div>
    ${resources ? `<div class="panel"><h2>Tài nguyên process Node BE trong lúc test (${t("CPU")}, RAM)</h2><div class="chart" style="height:260px"><canvas id="res"></canvas></div></div>` : ""}
    ${sqlPanel(sql, k.durationS)}` : ""}
    <div class="panel">${running ? `<h2>Log</h2><pre class="log" id="log"></pre>` : `<details><summary>Log k6</summary><pre class="log" id="log" style="margin-top:10px"></pre></details>`}</div>`;

  if (report) {
    const rows = report.endpoints;
    const render = (r) => `<tr>${nameCell(r)}<td>${num(r.count)}</td><td>${num(r.rps, 2)}</td><td>${ms(r.avg)}</td><td>${ms(r.med)}</td><td>${ms(r.p90)}</td>
      <td class="${r.count && r.p95 >= slo.p95Ms ? "bad" : ""}">${ms(r.p95)}</td><td>${ms(r.p99)}</td><td>${ms(r.max)}</td>
      <td class="${r.success != null && r.success < slo.successRate ? "bad" : ""}">${pct(r.success)}${r.failures ? ` <span class="sub">(${num(r.failures)} lỗi)</span>` : ""}</td>
      <td class="${r.available != null && r.available < slo.availability ? "bad" : ""}">${pct(r.available, 3)}</td>
      <td class="${(r.bytes ?? 0) >= 200e3 ? "bad" : ""}">${r.bytes == null ? "–" : bytes(r.bytes)}</td><td class="l">${errorsCell(r.errors)}</td>
      <td>${ms(r.prodP95)}</td><td>${passCell(r.pass)}</td></tr>`;
    const table = document.getElementById("eps");
    table.querySelector("tbody").innerHTML = rows.map(render).join("");
    sortable(table, rows, Object.fromEntries(["name", "count", "rps", "avg", "med", "p90", "p95", "p99", "max", "success", "available", "bytes", "prodP95"].map((c) => [c, (r) => r[c]]).concat([["pass", (r) => (r.pass == null ? -1 : +r.pass)]])), render);

    const hit = rows.filter((r) => r.count);
    newChart(document.getElementById("p95"), {
      type: "bar",
      data: { labels: hit.map((r) => r.name), datasets: [
        { label: "p95 local (k6)", data: hit.map((r) => r.p95), backgroundColor: hit.map((r) => (r.p95 >= slo.p95Ms ? css("--fail") : css("--series-a"))), borderRadius: 3 },
        { label: "p95 production", data: hit.map((r) => r.prodP95), backgroundColor: css("--series-b"), borderRadius: 3 },
      ] },
      options: { indexAxis: "y", maintainAspectRatio: false, scales: { x: { beginAtZero: true, title: { display: true, text: "ms" } } },
        plugins: { tooltip: { callbacks: { title: (c) => [hit[c[0].dataIndex].name, urlOf(hit[c[0].dataIndex])], label: (c) => `${c.dataset.label}: ${ms(c.raw)}` } } } },
      plugins: [sloLine(slo.p95Ms, "x")],
    });

    if (resources) {
      newChart(document.getElementById("res"), {
        type: "line",
        data: { labels: resources.map((s) => `${s.t}s`), datasets: [
          { label: "CPU Node BE (%)", data: resources.map((s) => s.beCpu), borderColor: css("--series-a"), backgroundColor: css("--series-a"), yAxisID: "y", pointRadius: 0, tension: 0.2 },
          { label: "RAM Node BE (MB)", data: resources.map((s) => s.beMemMB), borderColor: css("--series-b"), backgroundColor: css("--series-b"), borderDash: [4, 3], yAxisID: "y1", pointRadius: 0, tension: 0.2 },
        ] },
        options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
          scales: { x: { ticks: { maxTicksLimit: 12 } }, y: { beginAtZero: true, title: { display: true, text: "% một nhân" } },
            y1: { position: "right", beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: "MB" } } } },
        plugins: [sloLine(100, "y", "100% = 1 nhân bão hoà")],
      });
    }
  }

  const log = document.getElementById("log");
  stream = new EventSource(`/api/runs/${encodeURIComponent(id)}/log`);
  stream.onmessage = (e) => {
    const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
    log.textContent += JSON.parse(e.data);
    if (log.textContent.length > 200000) log.textContent = log.textContent.slice(-150000);
    if (stick) log.scrollTop = log.scrollHeight;
  };
  stream.addEventListener("end", () => {
    stream.close();
    if (running) setTimeout(route, 300); // re-render with the report
  });
  stream.onerror = () => stream.close();
  document.getElementById("stop")?.addEventListener("click", async (ev) => {
    ev.target.disabled = true;
    ev.target.textContent = "Đang dừng…";
    await api(`/api/runs/${encodeURIComponent(id)}/stop`, { method: "POST" }).catch((e) => alert(e.message));
  });
}

async function viewCompare(a, b) {
  const runs = (await api("/api/runs")).filter((r) => r.kpi);
  const opt = (sel) => runs.map((r) => `<option value="${esc(r.id)}" ${r.id === sel ? "selected" : ""}>${esc(r.id)}</option>`).join("");
  $view.innerHTML = `<h1>So sánh</h1><p class="sub">${t("Δ")}% = (B − A) / A. Đỏ là B chậm hơn hoặc tệ hơn A quá 10%. Tỉ lệ được so theo ${t("đ.p.")}</p>
    <div class="panel row"><label>A <select id="a"><option value="">—</option>${opt(a)}</select></label><label>B <select id="b"><option value="">—</option>${opt(b)}</select></label></div><div id="cmpBody"></div>`;
  const go = () => { const x = document.getElementById("a").value, y = document.getElementById("b").value; location.hash = `#compare/${x}/${y}`; };
  document.getElementById("a").addEventListener("change", go);
  document.getElementById("b").addEventListener("change", go);
  if (!a || !b) return;

  const [A, B] = await Promise.all([a, b].map((id) => api(`/api/runs/${encodeURIComponent(id)}`)));
  if (!A.report || !B.report) return;
  const delta = (x, y, worseWhenUp = true) => {
    if (x == null || y == null || !x) return "–";
    const d = (y - x) / x;
    const cls = Math.abs(d) < 0.1 ? "" : (d > 0) === worseWhenUp ? "bad" : "good";
    return `<span class="${cls}">${d > 0 ? "+" : ""}${(d * 100).toFixed(1)}%</span>`;
  };
  const rate = (x, y) => (x == null || y == null ? "–" : `<span class="${y < x - 0.001 ? "bad" : y > x + 0.001 ? "good" : ""}">${((y - x) * 100).toFixed(2)} đ.p.</span>`);
  const names = [...new Set([...A.report.endpoints, ...B.report.endpoints].map((r) => r.name))];
  const get = (rep, n) => rep.endpoints.find((r) => r.name === n) || {};
  const ka = A.report.kpi, kb = B.report.kpi;
  document.getElementById("cmpBody").innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="l">${t("p95")}</div><div class="v">${ms(ka.p95)} → ${ms(kb.p95)}</div><div class="t">${delta(ka.p95, kb.p95)}</div></div>
      <div class="kpi"><div class="l">${t("Thành công")}</div><div class="v">${pct(ka.success)} → ${pct(kb.success)}</div><div class="t">${rate(ka.success, kb.success)}</div></div>
      <div class="kpi"><div class="l">${t("req/s")}</div><div class="v">${num(ka.rps, 1)} → ${num(kb.rps, 1)}</div><div class="t">${delta(ka.rps, kb.rps, false)}</div></div>
      <div class="kpi"><div class="l">${t("Kết quả")}</div><div class="v">${verdict(A.meta, A.report.pass)} → ${verdict(B.meta, B.report.pass)}</div><div class="t">${esc(A.meta.profile)} → ${esc(B.meta.profile)}</div></div>
    </div>
    <div class="panel"><div class="chart" style="height:${Math.max(220, names.length * 34 + 60)}px"><canvas id="cmpChart"></canvas></div></div>
    <div class="panel table-wrap"><table><thead><tr><th class="l">API</th><th>${t("p95")} A</th><th>${t("p95")} B</th><th>${t("Δ")} p95</th><th>${t("p99")} A</th><th>${t("p99")} B</th><th>${t("Thành công")} A</th><th>${t("Thành công")} B</th><th>${t("Δ")} (${t("đ.p.")})</th><th>${t("Kết quả")} A → B</th></tr></thead><tbody>
    ${names.map((n) => { const x = get(A.report, n), y = get(B.report, n); const def = x.path ? x : y; return `<tr>${nameCell({ name: n, method: def.method, path: def.path })}<td>${ms(x.p95)}</td><td>${ms(y.p95)}</td><td>${delta(x.p95, y.p95)}</td><td>${ms(x.p99)}</td><td>${ms(y.p99)}</td><td>${pct(x.success)}</td><td>${pct(y.success)}</td><td>${rate(x.success, y.success)}</td><td>${passCell(x.pass)} → ${passCell(y.pass)}</td></tr>`; }).join("")}
    </tbody></table></div>`;
  newChart(document.getElementById("cmpChart"), {
    type: "bar",
    data: { labels: names, datasets: [
      { label: `A p95`, data: names.map((n) => get(A.report, n).p95), backgroundColor: css("--series-b"), borderRadius: 3 },
      { label: `B p95`, data: names.map((n) => get(B.report, n).p95), backgroundColor: css("--series-a"), borderRadius: 3 },
    ] },
    options: { indexAxis: "y", maintainAspectRatio: false, scales: { x: { beginAtZero: true, title: { display: true, text: "ms" } } },
      plugins: { tooltip: { callbacks: { title: (c) => { const n = names[c[0].dataIndex], r = get(A.report, n).path ? get(A.report, n) : get(B.report, n); return [n, urlOf(r)]; }, label: (c) => `${c.dataset.label}: ${ms(c.raw)}` } } } },
    plugins: [sloLine(CFG.slo.p95Ms, "x")],
  });
}

async function viewBaseline() {
  const b = await api("/api/baseline");
  if (!b) {
    $view.innerHTML = `<h1>Baseline production</h1><div class="panel empty">Chưa có baseline. Chạy <code>npm run baseline</code> trong <code>tool/k6-perf</code> (đọc <code>logs/*.log</code>).</div>`;
    return;
  }
  const tested = new Set(CFG.endpoints.map((e) => `${e.method} ${e.path.split("?")[0]}`));
  const top = b.endpoints.slice(0, 15);
  $view.innerHTML = `
    <h1>Baseline production</h1><p class="sub">Từ ${b.files} file log, ${b.days} ngày · tạo lúc ${when(b.generatedAt)}</p>
    <div class="kpis">
      <div class="kpi"><div class="l">${t("Đỉnh tải")}</div><div class="v">${num(b.peak.requests)}/phút</div><div class="t">≈ ${num(b.peak.requests / 60, 1)} ${t("req/s")} lúc ${esc(b.peak.minute)}</div></div>
      <div class="kpi"><div class="l">Tổng ${t("Request", "request")}</div><div class="v">${num(b.endpoints.reduce((s, e) => s + e.count, 0))}</div><div class="t">${b.endpoints.length} endpoint</div></div>
      <div class="kpi link" id="kSlow" role="button" tabindex="0" data-tip="Số endpoint (có ≥ 100 request) mà p95 trên production ≥ 1 giây, tức vi phạm SLO. Bấm để lọc bảng bên dưới theo các endpoint này."><div class="l">Endpoint vượt SLO p95 ↓</div><div class="v">${b.endpoints.filter((e) => e.count >= 100 && e.p95 >= CFG.slo.p95Ms).length}</div><div class="t">trong số endpoint có ≥ 100 request</div></div>
    </div>
    <div class="panel"><h2>p95 production của 15 endpoint nhiều traffic nhất</h2><div class="chart" style="height:${top.length * 30 + 60}px"><canvas id="bc"></canvas></div></div>
    <div class="panel"><h2>Tất cả endpoint</h2>
      <div class="filters">
        <input type="search" id="fQ" placeholder="Tìm theo path…" aria-label="Tìm theo path">
        <select id="fGroup" aria-label="Nhóm API"><option value="">Mọi nhóm</option><option value="mobile">Mobile (/api/mobile)</option><option value="web">Web (/api/v1)</option><option value="other">Khác (bot quét .env, .git…)</option></select>
        <select id="fMethod" aria-label="Method"><option value="">Mọi method</option>${[...new Set(b.endpoints.map((e) => e.key.split(" ")[0]))].sort().map((m) => `<option>${esc(m)}</option>`).join("")}</select>
        <select id="fMin" aria-label="Số request tối thiểu"><option value="0">Mọi lưu lượng</option><option value="100">≥ 100 request</option><option value="1000">≥ 1.000 request</option><option value="10000">≥ 10.000 request</option></select>
        <label class="chk"><input type="checkbox" id="fSlow">${t("p95")} vượt ${t("SLO")}</label>
        <label class="chk"><input type="checkbox" id="fErr">Có lỗi ${t("5xx")}</label>
        <label class="chk"><input type="checkbox" id="fTested">Có trong tool</label>
        <button class="btn" id="fReset" type="button">Xoá lọc</button>
      </div>
      <div class="table-wrap"><table id="bt"><thead><tr><th>#</th><th class="l" data-k="key">Endpoint</th><th data-k="count">${t("Request")}</th><th data-k="p50">${t("p50")}</th><th data-k="p95">${t("p95")}</th><th data-k="p99">${t("p99")}</th><th data-k="rate4xx">${t("4xx")}</th><th data-k="rate5xx">${t("5xx")}</th><th class="l">${t("Có trong tool")}</th></tr></thead><tbody></tbody></table></div>
      <div class="pager">
        <span id="pInfo" class="grow"></span>
        <label>Mỗi trang <select id="pSize"><option>25</option><option>50</option><option>100</option></select></label>
        <button class="btn" id="pPrev" type="button" aria-label="Trang trước">‹</button><span id="pNum" class="num"></span><button class="btn" id="pNext" type="button" aria-label="Trang sau">›</button>
      </div></div>`;
  const groupOf = (key) => { const p = key.slice(key.indexOf(" ") + 1); return p.startsWith("/api/mobile") ? "mobile" : p.startsWith("/api/v1") ? "web" : "other"; };
  const st = { sortKey: "count", dir: -1, page: 1, size: 25 };
  const val = (id) => document.getElementById(id);
  const render = (e, i) => `<tr><td class="num">${i}</td><td class="l name">${esc(e.key)}</td><td>${num(e.count)}</td><td>${ms(e.p50)}</td><td class="${e.p95 >= CFG.slo.p95Ms ? "bad" : ""}">${ms(e.p95)}</td><td>${ms(e.p99)}</td><td>${pct(e.rate4xx)}</td><td class="${e.rate5xx > 1 - CFG.slo.availability ? "bad" : ""}">${pct(e.rate5xx)}</td><td class="l">${tested.has(e.key) ? "✓" : ""}</td></tr>`;
  const table = val("bt");
  const draw = () => {
    const q = val("fQ").value.trim().toLowerCase(), group = val("fGroup").value, method = val("fMethod").value, min = Number(val("fMin").value);
    const slow = val("fSlow").checked, err = val("fErr").checked, onlyTested = val("fTested").checked;
    const rows = b.endpoints.filter((e) =>
      (!q || e.key.toLowerCase().includes(q)) && (!group || groupOf(e.key) === group) && (!method || e.key.startsWith(method + " ")) &&
      e.count >= min && (!slow || e.p95 >= CFG.slo.p95Ms) && (!err || e.rate5xx > 0) && (!onlyTested || tested.has(e.key)));
    const k = st.sortKey;
    rows.sort((a, c) => (k === "key" ? a.key.localeCompare(c.key) : (a[k] ?? -Infinity) - (c[k] ?? -Infinity)) * st.dir);
    const pages = Math.max(1, Math.ceil(rows.length / st.size));
    st.page = Math.min(st.page, pages);
    const from = (st.page - 1) * st.size;
    const shown = rows.slice(from, from + st.size);
    table.querySelector("tbody").innerHTML = shown.length
      ? shown.map((e, i) => render(e, from + i + 1)).join("")
      : `<tr><td colspan="9" class="empty">Không có endpoint nào khớp bộ lọc.</td></tr>`;
    val("pInfo").textContent = rows.length ? `${num(from + 1)}–${num(from + shown.length)} / ${num(rows.length)} endpoint${rows.length < b.endpoints.length ? ` (lọc từ ${num(b.endpoints.length)})` : ""}` : "";
    val("pNum").textContent = `${st.page} / ${pages}`;
    val("pPrev").disabled = st.page <= 1;
    val("pNext").disabled = st.page >= pages;
    table.querySelectorAll("th[data-k]").forEach((th) => th.setAttribute("aria-sort", th.dataset.k === k ? (st.dir < 0 ? "descending" : "ascending") : "none"));
  };
  const refilter = () => { st.page = 1; draw(); };
  ["fQ"].forEach((id) => val(id).addEventListener("input", refilter));
  ["fGroup", "fMethod", "fMin", "fSlow", "fErr", "fTested"].forEach((id) => val(id).addEventListener("change", refilter));
  val("fReset").addEventListener("click", () => {
    val("fQ").value = ""; val("fGroup").value = ""; val("fMethod").value = ""; val("fMin").value = "0";
    val("fSlow").checked = val("fErr").checked = val("fTested").checked = false;
    refilter();
  });
  val("pSize").addEventListener("change", (e) => { st.size = Number(e.target.value); refilter(); });
  val("pPrev").addEventListener("click", () => { st.page--; draw(); });
  val("pNext").addEventListener("click", () => { st.page++; draw(); });
  table.querySelectorAll("th[data-k]").forEach((th) => {
    th.classList.add("sort");
    th.addEventListener("click", () => {
      st.dir = st.sortKey === th.dataset.k ? -st.dir : th.dataset.k === "key" ? 1 : -1;
      st.sortKey = th.dataset.k;
      draw();
    });
  });
  // The "vượt SLO" tile jumps straight to that filter.
  const showSlow = () => { val("fSlow").checked = true; val("fMin").value = "100"; refilter(); table.scrollIntoView({ behavior: "smooth" }); };
  val("kSlow").addEventListener("click", showSlow);
  val("kSlow").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showSlow(); } });
  draw();
  newChart(document.getElementById("bc"), {
    type: "bar",
    data: { labels: top.map((e) => e.key), datasets: [{ label: "p95 production", data: top.map((e) => e.p95), backgroundColor: top.map((e) => (e.p95 >= CFG.slo.p95Ms ? css("--fail") : css("--series-a"))), borderRadius: 3 }] },
    options: { indexAxis: "y", maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `p95 ${ms(c.raw)} · ${num(top[c.dataIndex].count)} request` } } },
      scales: { x: { beginAtZero: true, title: { display: true, text: "ms" } } } },
    plugins: [sloLine(CFG.slo.p95Ms, "x")],
  });
}

// ---------- tooltip engine ----------
// One fixed-position bubble for every [data-tip], so table scroll containers cannot
// clip it. Shown on hover and on keyboard focus (Tab), hidden on Escape/scroll.
const tip = Object.assign(document.createElement("div"), { id: "tip", hidden: true });
tip.setAttribute("role", "tooltip");
document.body.appendChild(tip);
let tipFor = null;
function showTip(el) {
  tipFor?.removeAttribute("aria-describedby");
  tipFor = el;
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  el.setAttribute("aria-describedby", "tip");
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth, h = tip.offsetHeight;
  const top = r.bottom + 8 + h > innerHeight - 8 ? r.top - h - 8 : r.bottom + 8;
  tip.style.top = `${Math.max(8, top)}px`;
  tip.style.left = `${Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8)}px`;
}
function hideTip() {
  tipFor?.removeAttribute("aria-describedby");
  tipFor = null;
  tip.hidden = true;
}
document.addEventListener("mouseover", (e) => {
  const el = e.target.closest("[data-tip]");
  if (el && el !== tipFor) showTip(el);
  else if (!el && tipFor && tipFor !== document.activeElement) hideTip();
});
document.addEventListener("focusin", (e) => { const el = e.target.closest("[data-tip]"); el ? showTip(el) : hideTip(); });
document.addEventListener("focusout", hideTip);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideTip(); });
window.addEventListener("scroll", hideTip, true);

// ---------- router ----------
async function route() {
  hideTip();
  charts.forEach((c) => c.destroy());
  charts = [];
  stream?.close();
  const [name, a, b] = (location.hash.slice(1) || "runs").split("/").map(decodeURIComponent);
  document.querySelectorAll("[data-nav]").forEach((x) => x.classList.toggle("on", x.dataset.nav === (name === "run" ? "runs" : name)));
  try {
    CFG = await api("/api/config");
    document.getElementById("env").textContent = `${CFG.baseUrl} · store ${CFG.storeId ?? "?"}${CFG.canRun ? "" : " · chỉ xem (LAN)"}`;
    document.querySelector('[data-nav="new"]').hidden = !CFG.canRun;
    if (name === "new") viewNew();
    else if (name === "run") await viewRun(a);
    else if (name === "compare") await viewCompare(a, b);
    else if (name === "baseline") await viewBaseline();
    else await viewRuns();
  } catch (e) {
    $view.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}
window.addEventListener("hashchange", route);
route();
