# Tim on AI Scorecard — Setup (fully automatic)

One-time setup, ~10 phút. Sau đó toàn bộ vòng đời chạy tự động:
người làm bài → chấm MCQ (Cấp 1–2) → Gemini chấm portfolio (Cấp 3–4, bộ 12 tiêu chí) → lưu Sheet → email kết quả + chẩn đoán + khuyến nghị gửi từ Gmail của Tim → scorecard hiện ngay trên màn hình.

> Tài khoản deploy Apps Script = tài khoản GỬI EMAIL. Deploy bằng timqtran1008@gmail.com thì email kết quả đi từ địa chỉ đó (tên hiển thị: "Tim Trần — Tim on AI").

## Step 1 — Google Sheet (2 phút)

1. Mở https://sheets.new → đặt tên **"Tim on AI Scorecard — Responses"**
2. Đổi tên tab `Sheet1` → `Responses`
3. Dán 27 header này vào hàng 1 (đã tab-separated):

```
timestamp	instrument	client	clientId	program	cohort	name	role	email	mcq_score	mcq_total	mcq_dim_T	mcq_dim_O	mcq_dim_E	mcq_answers_json	band_label	subscription_tier	stage2_eligible	s2_project	s2_master_prompt	s2_quality_memory	s2_tasks	s2_l4_evidence	judge_json	judge_error	final_level	manual_review
```

(Script tự tạo thêm tab `Issues` khi có lỗi email/judge — không cần tạo trước.)

## Step 2 — Gemini API key (1 phút)

1. Mở https://aistudio.google.com/apikey (đăng nhập cùng Google account)
2. **Create API key** → copy
3. Free tier đủ dùng (gemini-2.5-flash, ~1.500 lượt/ngày)

## Step 3 — Apps Script (3 phút)

1. Trong Sheet: **Extensions → Apps Script**
2. Xóa nội dung `Code.gs`, dán toàn bộ file `ai-scorecard-apps-script.gs`
3. **Project Settings (bánh răng) → Script Properties → Add script property:**
   - Property: `GEMINI_API_KEY` — Value: key vừa tạo
4. Ctrl+S

## Step 4 — Test trước khi deploy (2 phút)

Trong editor Apps Script:
1. Chọn hàm `testEmail` → Run → cấp quyền lần đầu → check inbox: email scorecard mẫu phải tới, đúng format, đúng tên người gửi
2. Chọn hàm `testEmailL4` → Run → check inbox: email phải có thêm khối **"Xác minh Cấp 4"** kèm câu lệnh probe để người dùng dán vào công cụ họ đã xây
3. Chọn hàm `testJudge` → Run → xem Logs: phải ra JSON verdict có `l3_confirmed`, `gates`, `l4_flagged`

## Step 5 — Deploy web app (1 phút)

1. **Deploy → New deployment → Web app**
2. Execute as: **Me** · Who has access: **Anyone**
3. Copy **Web app URL** (`https://script.google.com/macros/s/.../exec`)

## Step 6 — Nối URL vào form

Trong `ai-scorecard.html`, thay dòng:
```js
const GOOGLE_SCRIPT_URL = 'PASTE_APPS_SCRIPT_WEB_APP_URL_HERE';
```
bằng URL vừa copy → commit + push repo `ai-readiness-diagnostics` → GitHub Pages tự deploy sau ~1 phút tại:
`https://timtran1008.github.io/ai-readiness-diagnostics/ai-scorecard.html`

Tham số tùy chọn trên URL (đi vào Sheet, dùng tách cohort):
`?cohort=q3-2026&program=scorecard&clientId=...`

## Step 7 — E2E test cuối

Mở trang thật, tự làm 1 bài đầy đủ (điền cả portfolio) → kiểm 4 điểm:
1. Scorecard hiện trên màn hình với đúng cấp
2. Email kết quả về inbox, từ đúng địa chỉ
3. Sheet có row mới, cột `final_level` + `judge_json` có dữ liệu
4. Làm thêm 1 bài chỉ trả lời MCQ + gói free → phải ra Cấp 1/2, không gọi judge

---

## Logic chấm (tham chiếu)

| Bước | Luật | Nguồn |
|---|---|---|
| Cấp 1 vs 2 | MCQ <5/9 → Cấp 1 · ≥5 → Cấp 2 (5–6 tạm, 7–9 vững) | `assessment-measurement-note-v4.md` |
| Điều kiện xét Cấp 3 | MCQ **≥7/9** ("L2 vững") **và** gói trả phí **và** có nộp portfolio | ICBS clarification §1 (recognition→production gate) |
| Cấp 3 | Qua **cả 3 CỔNG bắt buộc** (T-GATE / O-GATE / E-GATE), non-compensatory — hỏng 1 cổng → giữ Cấp 1/2. Tín hiệu phụ mơ hồ → manual_review, KHÔNG tự đánh rớt. **Kết quả Cấp 3 là SƠ BỘ, chờ buổi trao đổi xác nhận.** | ICBS clarification §1 (Task-eligibility + Quality gate) |
| Cấp 4 | **KHÔNG cấp tự động.** Đủ 3 dấu hiệu Build → `l4_flagged` + `manual_review` (ứng viên Cấp 4). Email tự động kèm **câu lệnh probe** (proof-of-configuration) → người dùng dán vào công cụ đã xây, **chụp màn hình** câu trả lời, reply. Tim xem ảnh → xác nhận. Buổi bảo vệ trực tiếp chỉ là fallback khi ảnh mơ hồ. | ICBS clarification §4.3 + §2.68 (proof-of-reach analog) |
| Judge nghi ngờ / lỗi / cờ Cấp 4 | `manual_review = REVIEW` trong Sheet + email ghi "kết quả sơ bộ, Tim sẽ xem lại" | blueprint §5 manual-review contract |

Khi nào cần rà tay: lọc Sheet cột `manual_review = REVIEW`.

## Chưa làm (chờ dữ liệu thật)

- **Calibration judge:** cần 3–5 portfolio đã biết trình độ (khách C104 cũ) chạy qua `testJudge` để so với đánh giá tay của Tim (mục tiêu khớp ≥4/5) trước khi tin hoàn toàn vào verdict.
- **Angoff cut-score:** ngưỡng xét Cấp 3 đã nâng 6→**7/9** ("L2 vững", bỏ mâu thuẫn "L2 tạm nhưng đủ điều kiện lên Cấp 3"). Vẫn là ngưỡng tạm — chạy Angoff (3 người chấm độc lập) sau lớp đầu để hiệu chỉnh.
- **Retry policy:** chưa chặn người nộp lại nhiều lần (dedupe theo email khi đọc dữ liệu).
