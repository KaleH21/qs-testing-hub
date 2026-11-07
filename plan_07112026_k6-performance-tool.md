# Plan: Tool kiểm thử hiệu năng API bằng k6 (có giao diện báo cáo)

Ngày: 07/11/2026
Phạm vi: chỉ lập kế hoạch, chưa viết code. Tool nằm ở `tool/k6-perf/`, độc lập với `qs-net-management-be` và `qs-net-management`. Tool không sửa code của hai project này.

---

## 1. Tóm tắt

- **Mục tiêu:** chạy load test bằng k6 lên các API của `qs-net-management-be`, lưu kết quả của từng lần chạy, và xem báo cáo trên một trang web local. Trang báo cáo có bảng thống kê theo từng API, biểu đồ, và so sánh giữa hai lần chạy hoặc với số liệu production thật.
- **Cách làm:**
  - k6 tạo tải.
  - Một server Node nhỏ, **không cần cài thêm package npm**, dùng để bấm chạy test và đọc kết quả.
  - Một trang HTML tĩnh hiển thị báo cáo.
  - Biểu đồ theo thời gian (RPS và latency theo từng giây) lấy từ **web dashboard có sẵn của k6**, nên không phải tự vẽ.
- **Không dùng** Grafana, InfluxDB hay k6 Cloud: quá nặng so với nhu cầu của một team. Có thể nâng cấp sau (mục 9).
- **Ước lượng:** khoảng 4,5 ngày dev, gồm cả lần test thật đầu tiên (mục 8).
- **Rủi ro lớn nhất:** chạy nhầm vào production. Load test có thể làm sập server đang phục vụ kiosk, và các API ghi sẽ tạo ticket giả trong DB. Tool phải chặn việc này ngay trong code (mục 6).

---

## 2. Hiện trạng (đã xác minh trong code và log)

### 2.1. Backend

| Điểm | Chi tiết | Ảnh hưởng tới tool |
|---|---|---|
| Stack | Express 4, MySQL (Sequelize), chạy **1 process pm2** | Kết quả staging chỉ đáng tin khi máy staging có cấu hình gần giống prod |
| Số route | 196 route `v1` và 44 route `mobile`, khai báo dạng bảng trong [routes/v1/index.js](../qs-net-management-be/src/api/routes/v1/index.js) và [routes/mobile/index.js](../qs-net-management-be/src/api/routes/mobile/index.js) | Không thể test hết. Chỉ chọn các API nóng (mục 2.2) |
| Swagger | Chỉ có 4 chỗ `@swagger` | Không sinh được danh sách endpoint từ OpenAPI. Phải tự khai báo trong `endpoints.json` |
| Auth web | `POST /api/v1/login` trả về `accessToken`. Header gửi lên là `authorization: <token>`, **không có tiền tố `Bearer`** ([auth.middleware.js:79](../qs-net-management-be/src/middlewares/auth.middleware.js#L79)) | Script k6 phải gửi đúng định dạng header này |
| Rate limit login | `authRateLimiter`: 20 lần mỗi 15 phút cho mỗi IP ([rate-limit.middleware.js](../qs-net-management-be/src/middlewares/rate-limit.middleware.js)) | **Chỉ login 1 lần trong `setup()`**, rồi dùng chung token cho mọi VU. Nếu mỗi VU tự login thì bị 429 ngay |
| Rate limit mobile | Khoá theo `deviceId + IP` | Nếu mọi VU dùng chung 1 `deviceId` thì sẽ bị 429. Cần **mỗi VU một thiết bị test** (mục 7) |
| Mỗi request có auth | Thực hiện 2 query DB: kiểm tra token còn hợp lệ, và kiểm tra account | Đây là chi phí cố định của mọi API. Nên đo riêng |

### 2.2. Traffic thật (lấy từ `logs/`, 32 ngày, morgan có ghi thời gian xử lý)

Đỉnh tải theo phút là **728 req/phút (khoảng 12 req/s)**, vào lúc 14/09/2026 09:50.

| Endpoint | Số request | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| `POST /api/mobile/devices/config` | 415.218 | 1,9 ms | 3,4 ms | 7 ms |
| `POST /api/mobile/tickets/upload-image` | 400.391 | 89 ms | **1.556 ms** | 1.918 ms |
| `POST /api/mobile/devices/register-fcm-token` | 215.957 | – | – | – |
| `POST /api/mobile/members/get-detail` | 140.249 | 22 ms | 84 ms | 140 ms |
| `POST /api/mobile/tickets/buy-ticket` | 126.115 | **619 ms** | 1.686 ms | 2.041 ms |
| `POST /api/mobile/members/get-data` | 116.225 | – | – | – |
| `GET /api/v1/dashboard` | 6.540 | 189 ms | **7.691 ms** | 9.618 ms |
| `GET /api/v1/tickets`, `accounts/getAllStaff`, `stores`, `levels`, `members`, `fixed-costs`, `baccarat-players` | 4–13 nghìn mỗi endpoint | – | – | – |

Ô "–" là chưa tính. Script baseline ở mục 4.4 sẽ tính đủ.

Kết luận:
- Khoảng 90% traffic đến từ **kiosk (mobile API)**, không phải từ web.
- Ba điểm nghi chậm nên test đầu tiên: `buy-ticket`, `upload-image` và `dashboard`.

---

## 3. Kiến trúc

```
tool/k6-perf/
├── README.md               cách cài, cách chạy, giải thích ý nghĩa các chỉ số
├── package.json            không có dependency; scripts: start, baseline, test
├── .env.example            tài khoản test (file .env thật nằm trong .gitignore)
├── server.js               node:http, phục vụ ui/, cung cấp API: list/get/start run, SSE log
├── config/
│   ├── targets.json        { local, staging, prod } → baseUrl, allowLoad, allowWrite
│   ├── endpoints.json      danh mục API cần test (mục 4.2)
│   └── profiles.json       smoke / load / stress / spike / soak → stages
├── k6/
│   └── main.js             1 script k6 duy nhất, nhận cấu hình qua biến môi trường
├── scripts/
│   └── baseline.js         đọc logs/*.log, xuất results/baseline.json (chỉ số tổng hợp)
├── ui/
│   ├── index.html          1 trang, chuyển màn hình bằng hash (#runs, #run/:id, #compare, #baseline)
│   ├── app.js
│   └── vendor/chart.umd.min.js   Chart.js tải sẵn về, để dùng được khi không có mạng
├── test/
│   └── *.test.js           node:test cho phần parse log và phần chuyển summary thành bảng
└── results/                (nằm trong .gitignore)
    └── <runId>/            runId = 20261107-143005_staging_load
        ├── meta.json       target, profile, danh sách endpoint, git sha của BE, người chạy
        ├── summary.json    do handleSummary() của k6 ghi ra
        ├── dashboard.html  file export từ web dashboard của k6 (biểu đồ theo thời gian)
        └── k6.log
```

**Luồng chạy:**

1. Người dùng chọn target, profile và các endpoint trên UI, rồi bấm Start.
2. `server.js` gọi `k6 run` bằng `spawn`, kèm các biến môi trường:
   - `K6_WEB_DASHBOARD=true`
   - `K6_WEB_DASHBOARD_EXPORT=results/<id>/dashboard.html`
3. Trong lúc chạy:
   - UI nhận log theo thời gian thực qua SSE.
   - Nút "Live" mở web dashboard của k6 tại `http://localhost:5665`.
4. Khi chạy xong, k6 ghi `summary.json`. UI đọc file này để hiển thị báo cáo.

Vì sao chọn cách này:
- k6 đã có sẵn dashboard real-time và tự export HTML. Phần còn thiếu chỉ là **bảng theo từng API, lịch sử các lần chạy, so sánh và baseline**. Tool chỉ viết phần này.
- Server không cần Express. `node:http`, `fs` và `child_process` là đủ, nên không phải `npm install`.
- Server chỉ lắng nghe trên `127.0.0.1`, nên **không cần làm đăng nhập** cho tool.

---

## 4. Chi tiết từng phần

### 4.1. `k6/main.js`

- **Đọc cấu hình:** dùng `open()` để đọc `endpoints.json` và `profiles.json`. Nhận `TARGET`, `PROFILE`, `ENDPOINTS` (danh sách tên, cách nhau bằng dấu phẩy) và `RUN_DIR` qua `__ENV`.
- **`setup()`:**
  - Login web 1 lần để lấy `accessToken`.
  - Login cho các thiết bị test mobile (mục 7).
  - Trả về các token để dùng chung.
- **`default()`:**
  - Chọn endpoint theo `weight` (tỉ lệ lấy từ traffic thật ở mục 2.2).
  - Gửi request với tag `name: <tên endpoint>`. Path có `:id` thì vẫn gộp chung một nhóm.
  - Gọi `check()` để kiểm tra status 2xx, và với mobile thì kiểm tra thêm `success === true`. Lý do: middleware mobile trả về **HTTP 200 kèm `success:false`** khi có lỗi ([mobile-response.middleware.js](../qs-net-management-be/src/middlewares/mobile-response.middleware.js)). Nếu chỉ nhìn status code thì sẽ không thấy lỗi.
- **Lấy số liệu riêng cho từng API:** summary của k6 chỉ ghi sub-metric nào có threshold. Vì vậy script tự sinh threshold cho mỗi endpoint đã chọn:
  ```js
  thresholds[`http_req_duration{name:${e.name}}`] = [`p(95)<${e.sloP95Ms}`];
  thresholds[`http_req_failed{name:${e.name}}`]   = ['rate<0.01'];
  thresholds[`http_reqs{name:${e.name}}`]         = ['count>=0']; // chỉ để có số request trong summary
  summaryTrendStats = ['avg','min','med','max','p(90)','p(95)','p(99)'];
  ```
- **`handleSummary(data)`:** ghi `summary.json` vào `RUN_DIR`, đồng thời vẫn in phần tóm tắt ra stdout.

### 4.2. `config/endpoints.json` (ví dụ 1 mục)

```json
{
  "name": "mobile.buy-ticket",
  "method": "POST",
  "path": "/api/mobile/tickets/buy-ticket",
  "auth": "mobile",
  "write": true,
  "weight": 126,
  "sloP95Ms": 1500,
  "body": { "deviceId": "{{deviceId}}", "ticket": "20", "level": "20,40,50,100", "ticketId": "{{deviceId}}_{{uuid}}" }
}
```

- Chỉ hỗ trợ 3 placeholder: `{{deviceId}}`, `{{uuid}}` và `{{storeId}}`. Không làm template engine.
- Đợt đầu gồm khoảng 15 endpoint: 9 mobile đầu bảng ở mục 2.2 và 6 endpoint web (`dashboard`, `tickets`, `accounts/getAllStaff`, `stores`, `members`, `baccarat-players`).
- Riêng `upload-image` (multipart): đợt đầu dùng 1 file ảnh mẫu khoảng 90 KB, đúng cỡ trung bình trong log.
- `sloP95Ms` ban đầu đặt bằng **p95 production × 1,2**. Đặt như vậy để lần chạy đầu không đỏ toàn bộ. Sau đó team chốt SLO thật.

### 4.3. `config/profiles.json`

| Profile | Mục đích | Cấu hình đề xuất |
|---|---|---|
| `smoke` | Kiểm tra script và auth chạy đúng | 1 VU, 30 giây |
| `load` | Tải bình thường lúc cao điểm | Tăng dần lên tải tương đương **12 req/s** (đỉnh thật), giữ 10 phút |
| `stress` | Tìm ngưỡng chịu tải | Tăng bậc 12 → 25 → 50 → 100 req/s, mỗi bậc 3 phút |
| `spike` | Nhiều kiosk mở lên cùng lúc | Tăng vọt từ 5 lên 60 req/s trong 10 giây, giữ 1 phút |
| `soak` | Phát hiện rò rỉ bộ nhớ hoặc connection pool | 12 req/s trong 1 giờ |

Các profile dùng executor `ramping-arrival-rate`, tức là giữ số req/s cố định thay vì giữ số VU cố định. Nhờ vậy khi API chậm đi thì vẫn đo được độ trễ thật, không bị "tự giảm tải" như khi dùng VU cố định.

### 4.4. `scripts/baseline.js`

- Đọc từng dòng `logs/*.log` theo dạng stream.
- Dùng regex `^\[(.+?)\] (GET|POST|...) (\S+) (\d{3}) ([\d.]+) ms` để tách từng dòng.
- Chuẩn hoá path: thay id dạng số hoặc uuid bằng `:id`, và bỏ query string.
- Ghi ra `results/baseline.json`, gồm:
  - Theo từng endpoint: số request, p50, p95, p99, tỉ lệ lỗi 4xx và 5xx.
  - Số req/phút lúc đỉnh.
- **Chỉ ghi số liệu tổng hợp.** Log có chứa phần `REQ/RES` với tên và dữ liệu của member, nên không được chép nội dung này sang file kết quả.

### 4.5. `server.js` (khoảng 150 dòng)

| Route | Việc làm |
|---|---|
| `GET /` và các file trong `ui/` | Trả file tĩnh |
| `GET /api/runs` | Liệt kê các thư mục trong `results/`, trả về meta và các chỉ số chính |
| `GET /api/runs/:id` | Trả `meta.json` và `summary.json` |
| `POST /api/runs` | Kiểm tra guard (mục 6), rồi `spawn('k6', [...])`. **Mỗi lúc chỉ cho chạy 1 test** |
| `GET /api/runs/:id/log` | Gửi log qua SSE |
| `POST /api/runs/:id/stop` | Gửi tín hiệu dừng cho process k6 |
| `GET /runs/:id/dashboard.html` | Trả file dashboard đã export |
| `GET /api/baseline` | Trả `baseline.json` |

Phải kiểm tra `:id` bằng regex `^[\w-]+$` để chặn path traversal.

### 4.6. Giao diện (`ui/`)

Một trang HTML dùng JS thuần và Chart.js. Có chế độ sáng và tối.

1. **Danh sách lần chạy (`#runs`):** bảng gồm thời gian, target, profile, số req/s đạt được, tổng số request, p95, tỉ lệ lỗi, và badge **PASS/FAIL** theo threshold. Có nút "New run" và checkbox để chọn 2 lần chạy cần so sánh.
2. **Chạy mới:** chọn target, profile và endpoint (mặc định tick theo nhóm read hoặc write), có thể nhập đè req/s và thời gian chạy. Khi đang chạy, hiển thị log trực tiếp, nút Stop và link Live dashboard.
3. **Chi tiết một lần chạy (`#run/:id`):**
   - Hàng ô KPI: req/s, p95, p99, % lỗi, % check đạt, số data nhận và gửi.
   - **Bảng theo từng API** (sắp xếp được, mặc định theo p95 giảm dần): tên, số request, req/s, avg, p50, p90, p95, p99, max, % lỗi, SLO, PASS/FAIL, **p95 production** và **chênh lệch so với production**.
   - Biểu đồ cột ngang p95 của từng API, có vạch SLO.
   - Nút "Timeline", mở `dashboard.html` của k6 để xem RPS, latency và VU theo thời gian.
4. **So sánh (`#compare?a=&b=`):** bảng theo từng API, hiển thị p95 và % lỗi của A và B kèm Δ%. Màu xanh là nhanh hơn, màu đỏ là chậm hơn quá 10%.
5. **Baseline production (`#baseline`):** bảng số liệu từ log thật và biểu đồ top 15 endpoint theo số request.

---

## 5. Cài đặt

```powershell
winget install k6 --source winget   # Hiện máy chưa có k6. Node 24 đã có sẵn.
cd tool/k6-perf
copy .env.example .env              # điền tài khoản test
npm run baseline                    # tạo baseline.json từ ../../logs
npm start                           # mở http://127.0.0.1:4000
```

Vẫn chạy được không cần UI: `k6 run -e TARGET=staging -e PROFILE=smoke k6/main.js`.

---

## 6. Guard an toàn (bắt buộc, kiểm tra trong `server.js` và lặp lại trong `main.js`)

| Quy tắc | Lý do |
|---|---|
| `targets.prod.allowLoad = false`: với prod chỉ cho chạy `smoke` và chỉ endpoint có `write:false` | Production đang phục vụ kiosk thật. Một lần chạy stress có thể làm gián đoạn store |
| Endpoint có `write:true` chỉ được chạy trên target có `allowWrite:true` (local và staging) | `buy-ticket`, `upload-image` và `register-user` sẽ tạo dữ liệu thật trong DB |
| `main.js` tự kiểm tra lại `baseUrl` và từ chối chạy nếu URL là của prod mà profile khác `smoke` | Phòng trường hợp chạy k6 trực tiếp từ CLI, không qua server |
| Đọc mật khẩu từ `.env`, không ghi mật khẩu vào `meta.json` và log | `results/` có thể bị chia sẻ cho người khác |
| Dùng 1 store test riêng trên staging, kèm script dọn dữ liệu (xoá ticket theo `storeId` test) | Để DB staging không phình lên sau mỗi lần chạy |

---

## 7. Môi trường test (cần chuẩn bị trước khi làm phần 4)

- **Staging:**
  - Restore `db_backup/backup.sql` vào một MySQL riêng.
  - Chạy BE bằng 1 process pm2, trên máy có CPU, RAM và cấu hình MySQL giống prod.
  - Nếu máy yếu hơn prod thì số liệu chỉ dùng để **so sánh giữa các lần chạy**, không dùng làm số tuyệt đối.
- **Tài khoản web:** 1 tài khoản `admin` và 1 tài khoản `store` để test.
- **Thiết bị test cho mobile:** cần N `deviceId` đã đăng ký vào store test, N lớn hơn hoặc bằng số VU tối đa. Mỗi VU dùng một thiết bị, vì rate limit mobile khoá theo device + IP. Viết thêm một script seed nhỏ để tạo các thiết bị này.
- **Monitor phía server trong lúc chạy:** dùng `pm2 monit` để xem CPU và RAM, và `SHOW PROCESSLIST` để xem MySQL. Việc này làm tay. Tool không thu thập số liệu server (mục 9).

---

## 8. Các bước triển khai và ước lượng

| Bước | Việc | Thời gian |
|---|---|---|
| P0 | Cài k6, dựng staging, tạo tài khoản và thiết bị test, viết script seed và dọn dữ liệu | 0,5 ngày |
| P1 | `main.js`, ba file config, `handleSummary`, chạy `smoke` qua CLI thành công | 1 ngày |
| P2 | `server.js` và UI: danh sách lần chạy, chạy mới, chi tiết | 1,5 ngày |
| P3 | `baseline.js`, màn so sánh và màn baseline, unit test | 0,5 ngày |
| P4 | Chạy thật `load`, `stress` và `spike` trên staging, viết báo cáo phát hiện (`plan/`) | 1 ngày |

**Tiêu chí hoàn thành:**
- Chạy `smoke` bằng UI thì nhận được PASS, và có đủ bảng theo từng API.
- So sánh được hai lần chạy.
- Chọn prod kèm `load` thì bị từ chối kèm thông báo rõ lý do.
- `npm test` chạy qua: parse log mẫu và chuyển summary mẫu thành bảng.

**Giả thuyết cần kiểm chứng ở bước P4** (rút ra từ log):
- `GET /api/v1/dashboard` có p95 khoảng 7,7 giây.
- `buy-ticket` có p50 khoảng 620 ms.
- `upload-image` có p95 khoảng 1,5 giây (có thể do `sharp` xử lý ảnh).
- Mỗi request có auth tốn thêm 2 query DB.

---

## 9. Cố ý không làm (có thể thêm sau)

- **Grafana + InfluxDB/Prometheus** để lưu time series dài hạn và xem trên dashboard chung. Nên làm khi cần theo dõi liên tục, hoặc khi cần gộp số liệu CPU và DB của server.
- **Chạy trong CI** để chặn PR làm chậm API. `main.js` đã chạy được từ CLI nên chỉ cần thêm 1 job.
- **k6 phân tán hoặc k6 Cloud:** không cần, vì tải thật chỉ khoảng 12 req/s. Một máy là đủ.
- **Tự sinh danh sách endpoint từ route table:** không làm, vì phải `require` route file, kéo theo việc load DB. Tự khai báo khoảng 15 endpoint đơn giản hơn.
- **Đăng nhập cho tool:** không làm, vì tool chỉ bind `127.0.0.1`.

---

## 10. Đã chốt (07/11/2026). Tool đã viết xong ở `tool/k6-perf/` (xem README)

1. **Môi trường:** dùng luôn máy local, gồm BE `localhost:3020` (process pm2/node đang chạy sẵn) và MySQL `goscan` (bản restore từ backup). Không dựng staging riêng.
2. **Access token** sống **15 ngày**, refresh token sống 30 ngày ([authUtils.js:20](../qs-net-management-be/src/common/utils/auth/authUtils.js#L20)). Vì vậy profile `soak` không cần refresh.
3. **Chỉ chạy local:** bỏ hẳn target prod và staging. Cả `server.js` lẫn `k6/main.js` đều từ chối URL không phải localhost.
4. **SLO:** p95 < 1 giây, tỉ lệ thành công ≥ 99%, tỉ lệ sẵn sàng ≥ 99,9% (không 5xx, không timeout). Xem `config/slo.json`.

**Khác với plan ban đầu:**
- Login thật nằm ở `/api/v1/access/login`, không phải `/api/v1/login`.
- Tài khoản test thuộc loại `store`, được gắn vào store qua bảng `account_stores`. Lý do: dashboard chỉ chạy nhánh nặng khi `userType=store`.
- Mobile dùng kiosk có sẵn (`apiV2Enabled=0`), nên không cần seed thiết bị.
- Đợt này chỉ test API đọc, gồm 6 mobile và 9 web. Chưa test `buy-ticket` và `upload-image` (lý do ở README).
- Bỏ guard cho prod và cho API ghi, vì không còn cần nữa.
