# k6 Perf Lab

Tool load test các API của `qs-net-management-be` bằng k6, có giao diện xem báo cáo. **Chỉ chạy được trên máy local**: cả server lẫn script k6 đều từ chối mọi `BASE_URL` không phải `localhost`/`127.0.0.1`.

Không cần `npm install`. Node ≥ 18 là đủ; k6 v2.3.0 đã nằm sẵn ở `bin/k6.exe`. Thư mục `bin/` nằm trong `.gitignore`. Nếu mất file, tải lại tại <https://github.com/grafana/k6/releases> hoặc chạy `winget install k6`.

## Chạy lần đầu

```powershell
cd tool\k6-perf
npm run seed       # tạo tài khoản test k6_perf_store trong DB local, ghi thông tin vào .env
npm run baseline   # đọc ..\..\logs\*.log, tạo results\baseline.json (p50/p95/p99 thật của production)
npm start          # mở http://127.0.0.1:4000
```

BE phải đang chạy ở `BASE_URL`. Mặc định là `http://localhost:3020`, lấy theo `DEV_APP_PORT` trong `qs-net-management-be/.env`.

Có thể chạy không cần UI:

```powershell
$env:PROFILE="smoke"; $env:RUN_DIR="results/cli"; .\bin\k6.exe run k6\main.js
```

Khi chạy theo cách này, phải tự set `K6_WEB_USER`, `K6_WEB_PASS` và `K6_STORE_ID` lấy từ `.env`.

## Xem báo cáo qua mạng LAN

```powershell
npm run start:lan   # in ra địa chỉ LAN, ví dụ http://192.168.1.88:4000
```

- Máy khác trong LAN **chỉ xem được**: danh sách lần chạy, chi tiết, so sánh, baseline, Timeline. Tab "Chạy mới", nút Dừng và Live dashboard bị ẩn. Server cũng trả 403 cho mọi lệnh không phải GET đến từ máy khác. Chạy và dừng test chỉ làm được trên máy chạy tool (`http://127.0.0.1:4000`).
- Không có đăng nhập: **ai trong cùng mạng cũng xem được**. Chỉ bật chế độ này trong mạng nội bộ tin cậy. Báo cáo không chứa mật khẩu hay token, nhưng có số liệu hiệu năng và store id.
- Nếu máy khác không vào được, mở cổng 4000 trên Windows Firewall (PowerShell chạy quyền Admin):
  ```powershell
  New-NetFirewallRule -DisplayName "k6 Perf Lab" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow
  ```

## Giao diện

| Màn hình | Nội dung |
|---|---|
| **Lần chạy** | Lịch sử các lần chạy, biểu đồ xu hướng p95 và tỉ lệ thành công, PASS/FAIL theo SLO. Tick 2 dòng để so sánh |
| **Chạy mới** | Chọn profile, hệ số tải và API cần test. Khi đang chạy: log trực tiếp, nút Dừng (vẫn có báo cáo cho phần đã chạy), link Live dashboard của k6 |
| **Chi tiết** | 6 ô KPI (3 ô SLO), **Nguyên nhân có khả năng**, biểu đồ p95 local so với production, bảng theo từng API (sắp xếp được, có Size và phân loại lỗi), CPU/RAM của BE và MySQL, **Top SQL**, nút Timeline mở dashboard HTML k6 tự export (RPS, latency, VU theo thời gian) |
| **So sánh** | Δ p95, Δ tỉ lệ thành công theo từng API giữa 2 lần chạy |
| **Baseline prod** | Thống kê từ access log thật: đỉnh req/phút, p50/p95/p99, tỉ lệ 4xx/5xx của mọi endpoint |

## Chẩn đoán nguyên nhân (`lib/diagnose.js`)

Mỗi báo cáo tự liệt kê các nguyên nhân có khả năng, sắp theo mức độ (nghiêm trọng, cảnh báo, lưu ý). Mỗi mục gồm dấu hiệu, nguyên nhân, độ tin cậy và việc nên làm. Dữ liệu dùng để suy luận:

| Nguồn | Thu thập | Dùng để |
|---|---|---|
| k6 (`summary.json`) | Thời gian phản hồi, kích thước response, phân loại lỗi (timeout / 429 / 5xx / 4xx / `success:false`) theo từng API; số liệu theo 12 cửa sổ thời gian; số request bị bỏ vì hết VU | Lỗi do đâu, API chậm sẵn hay phải xếp hàng, điểm bão hoà, chậm dần theo thời gian |
| `k6.log` | 3 thông báo lỗi đầu tiên của mỗi VU | Mẫu lỗi đi kèm finding |
| MySQL `performance_schema` (`sql.json`) | Chụp trước và sau lần chạy, chỉ đọc | Top SQL tốn thời gian, câu không dùng index, độ bận DB (tổng thời gian SQL / thời gian test) |
| CPU/RAM (`resources.json`) | `scripts/sample-resources.ps1` đọc performance counter mỗi giây cho process đang giữ cổng BE | Node bão hoà CPU, RAM quá lớn, hay chậm do chờ |

Giới hạn:
- k6 chỉ nhìn được từ bên ngoài BE, nên phần lớn kết luận là **giả thuyết có bằng chứng**, kèm độ tin cậy.
- Top SQL gồm **mọi** truy vấn vào DB trong lúc test (kể cả từ FE hoặc cron), không riêng k6, và không biết câu nào thuộc API nào. Muốn biết phải thêm tracing vào BE.
- CPU/RAM chỉ đo được trên Windows có tên performance counter tiếng Anh. Nếu không đo được thì báo cáo chỉ thiếu phần này.
- Không đo CPU của MySQL: MySQL chạy dạng Windows service nên counter của nó luôn trả về 0 khi không có quyền admin. Độ bận DB được tính từ `performance_schema`.

## SLO (`config/slo.json`)

| Chỉ tiêu | Ngưỡng | Cách đo |
|---|---|---|
| Thời gian phản hồi | p95 < 1000 ms | `http_req_duration`, tính cho toàn bộ và cho từng API |
| Thành công | ≥ 99% | `api_success`: HTTP 2xx, và với mobile thì body **không** có `success:false`. Lý do: API mobile trả lỗi bằng HTTP 200 |
| Sẵn sàng | ≥ 99,9% | `api_available`: server có trả lời, không phải 5xx, không timeout hay lỗi kết nối. 429 vẫn tính là "sẵn sàng" nhưng **không** tính là "thành công" |

Một lần chạy chỉ được PASS khi mọi ngưỡng đều đạt, cả ngưỡng toàn bộ lẫn ngưỡng của từng API.

## Profile (`config/profiles.json`)

Mọi profile dùng executor `ramping-arrival-rate`, tức là giữ đúng số req/s, kể cả khi API chậm đi. Mỗi request chọn ngẫu nhiên 1 API theo `weight`, và `weight` lấy theo tỉ lệ traffic thật trong log.

| Profile | Tải |
|---|---|
| smoke | 1 req/s trong 30 giây |
| load | Tăng lên 12 req/s rồi giữ 5 phút. Đỉnh thật là khoảng 9,4 req/s |
| stress | 12 → 25 → 50 → 100 req/s, mỗi bậc 2 phút |
| spike | Tăng vọt từ 5 lên 60 req/s trong 10 giây |
| soak | 12 req/s trong 1 giờ. Access token sống 15 ngày nên không cần refresh |

**Giới hạn của BE:** `/api/mobile` cho mỗi IP tối đa 1.200 request/phút (khoảng 20 req/s). k6 chạy từ một IP, nên ở stress và spike, các API mobile sẽ bị 429. Muốn đo năng lực thật thì khởi động lại BE với biến môi trường này (không phải sửa code):

```powershell
$env:MOBILE_RATE_LIMIT_PER_MIN="1000000"; node server.js   # chạy trong qs-net-management-be
```

## API được test (`config/endpoints.json`)

Gồm 6 API mobile và 9 API web nhiều traffic nhất trong log, **đều là API đọc**. Placeholder trong `path`/`body`: `{{storeId}} {{deviceId}} {{memberId}} {{externalId}} {{accountId}} {{todayIso}} {{todayMDY}} {{uuid}}`. `setup()` tự lấy giá trị cho các placeholder này, bằng cách đăng nhập rồi đọc danh sách device và member của store test.

Muốn thêm API thì thêm một dòng vào file. Lưu ý:
- Web dùng header `authorization: <token>`, **không có** `Bearer`.
- Mobile chỉ cần `deviceId` trong body. Kiosk được chọn phải có `apiV2Enabled = 0`.
- Chưa đưa `buy-ticket` và `upload-image` vào, vì đây là API ghi: có chống trùng theo member/giá/thiết bị, có cộng bonus, có ghi file vào `uploads/`. Chạy load sẽ làm bẩn DB local và phần lớn request sẽ bị từ chối vì trùng. Muốn test 2 API này cần làm bộ data test riêng kèm script dọn dữ liệu.

## Tác động lên DB local

- `npm run seed` tạo 1 account `k6_perf_store` (`isTest=1`) và 1 dòng trong `account_stores`, gắn vào store có nhiều ticket nhất. Có thể đổi store bằng `K6_STORE_ID` trong `.env`. Xoá bằng `npm run seed:remove`.
- Mỗi lần chạy, `setup()` đăng nhập một lần, nên bảng `tokens` có thêm 1 dòng.
- `members/get-data` và `members/pin-data` ghi tiến độ đồng bộ vào bảng `member_sync_status`, giống hệt kiosk thật.

## Kết quả

Mỗi lần chạy lưu ở `results/<runId>/`, gồm `meta.json`, `summary.json`, `dashboard.html` và `k6.log`. Access token và danh sách member đã được bỏ khỏi `summary.json`. Muốn xoá lần chạy nào thì xoá thư mục tương ứng.

## Cấu trúc

```
server.js          UI server (node:http, 127.0.0.1:4000; --lan cho LAN xem; mỗi lúc chỉ 1 lần chạy)
k6/main.js         script k6 duy nhất, nhận cấu hình qua biến môi trường
lib/report.js      chuyển summary thành bảng, parse access log (có unit test)
lib/local.js       đọc .env, đường dẫn, kết nối DB local, kiểm tra URL là local
lib/diagnose.js    quy tắc suy luận nguyên nhân (có unit test)
lib/probes.js      chụp SQL từ performance_schema, lấy mẫu CPU/RAM trong lúc chạy
scripts/seed.js    tạo hoặc xoá tài khoản test
scripts/baseline.js  tạo results/baseline.json từ access log
scripts/sample-resources.ps1  in CPU/RAM của BE và mysqld mỗi giây
ui/                index.html, app.js, vendor/chart.umd.min.js
test/              npm test (node:test)
```
