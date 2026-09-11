/**
 * Tim on AI Scorecard — fully automatic backend
 * Flow: doPost(payload) → recompute Stage 1 band (MCQ, L1/L2)
 *       → Gemini judge on Stage 2 open text (L3/L4, 12 disqualifiers + L4 Build check)
 *       → append row to Sheet → email scorecard from this account → return JSON to page.
 *
 * Setup (see ai-scorecard-setup.md):
 *   1. Script Properties → GEMINI_API_KEY = <key from aistudio.google.com>
 *   2. Sheet tab named 'Responses' with headers from the setup doc
 *   3. Deploy → Web app → Execute as Me → Anyone
 *
 * Crash-proof rule: any judge/email failure NEVER loses the submission —
 * the Sheet row is written first, errors are logged into the row.
 */

var LEVELS = {
  1: { name: 'Cấp 1 — Hỏi (Ask)',            color: '#e84d3d' },
  2: { name: 'Cấp 2 — Chỉ dẫn (Instruct)',   color: '#f59e0b' },
  3: { name: 'Cấp 3 — Hệ thống hóa (Systematize)', color: '#4a6cf7' },
  4: { name: 'Cấp 4 — Xây dựng (Build)',      color: '#00b894' }
};

var RECOMMENDATIONS = {
  1: [
    'Bắt đầu với cấu trúc prompt tối thiểu 3-5 phần: vai trò, bối cảnh, nhiệm vụ, yêu cầu cụ thể, ràng buộc.',
    'Chọn 1 việc lặp lại hàng tuần (email, tóm tắt, báo cáo) và dùng AI cho đúng việc đó trong 2 tuần liên tục.',
    'Luyện thói quen kiểm tra: mọi con số, tên riêng trong output AI phải tự giải thích được trước khi gửi đi.'
  ],
  2: [
    'Bạn đã viết được prompt có cấu trúc — bước tiếp theo là ngừng viết lại từ đầu mỗi lần: xây 1 Master Prompt cho công việc lặp lại nhiều nhất.',
    'Viết ra "thế nào là đạt" cho công việc đó (kèm ví dụ xấu / anti-pattern) và lưu vào nơi AI tự đọc được mỗi phiên (Project / Gem / file context).',
    'Mục tiêu 30 ngày: 3 việc lặp lại chạy bằng 1 câu lệnh ngắn, ra kết quả dùng được ngay trong 1 lần chạy.'
  ],
  3: [
    'Hệ thống của bạn đã chạy — bước tiếp theo là để AI LÀM chứ không chỉ NÓI: chọn 1 quy trình và chuyển thành công cụ chạy được (agent, script, automation).',
    'Thiết kế chốt chặn chất lượng: quy tắc rõ ràng cho AI biết khi nào dừng lại hỏi bạn thay vì tự quyết.',
    'Nhân bản hệ thống cho đồng đội: 1 người dùng là prompt, cả team dùng là tài sản.'
  ],
  4: [
    'Bạn đã xây được công cụ chạy thật — hướng tiếp theo là vận hành nhiều quy trình phối hợp nhau (Cấp 5 — Productize).',
    'Chuẩn hóa vòng PDCA cho từng công cụ: đo kết quả đầu ra, không chỉ đo "có chạy hay không".',
    'Đây là trình độ phù hợp để dẫn dắt AI adoption cho team — trao đổi với Tim về lộ trình mentor/lead.'
  ]
};

// Câu lệnh xác minh Cấp 4 — người dùng dán vào chính công cụ AI họ đã xây (proof-of-configuration).
var L4_PROBE_PROMPT =
  'Bạn đang chạy trong hệ thống mà tôi đã thiết lập. Trả lời CHÍNH XÁC theo cấu hình thật của bạn — không phỏng đoán, không trả lời chung chung. Mục nào không có trong cấu hình, ghi rõ "không có".\n\n' +
  '1. Tên & vai trò: Trích nguyên văn 1–2 câu đầu trong system instructions / context của bạn.\n' +
  '2. Tiêu chuẩn chất lượng: Trích nguyên văn tiêu chuẩn "thế nào là đạt" đã lưu trong cấu hình (kể cả ví dụ xấu / anti-pattern nếu có).\n' +
  '3. Nguồn ngữ cảnh: Liệt kê tên các file / tài liệu / ngữ cảnh bạn đọc được trong phiên này.\n' +
  '4. Việc lặp lại: 3 loại yêu cầu bạn xử lý thường xuyên nhất, và output tương ứng của mỗi loại.\n' +
  '5. Chốt chặn: Nêu chính xác quy tắc khi nào bạn DỪNG và hỏi người dùng thay vì tự quyết. Trích nguyên văn nếu quy tắc nằm trong cấu hình.\n\n' +
  'Trả lời ngắn gọn, đúng sự thật theo cấu hình. Không bịa.';

// ═══════════════════════════════════════════════════════════
// ENTRY
// ═══════════════════════════════════════════════════════════

function doPost(e) {
  var out = { ok: false };
  try {
    var d = JSON.parse(e.postData.contents);

    // ── Stage 1 band (deterministic, mirrors assessment-measurement-note v4) ──
    var score = Number(d.mcq_score) || 0;
    var band = score <= 4 ? 1 : 2;                       // <5 → L1, ≥5 → L2
    var bandLabel = score <= 4 ? 'L1' : (score <= 6 ? 'L2 tạm' : 'L2 vững');

    // ── Stage 2 eligibility ──
    var tier = String(d.subscription_tier || 'free');
    var hasS2 = [d.s2_master_prompt, d.s2_quality_memory, d.s2_tasks]
      .some(function (t) { return String(t || '').trim().length >= 40; });
    var eligible = score >= 7 && tier !== 'free' && hasS2;   // ≥7 = "L2 vững" mới đủ xét Cấp 3 (6 vẫn "L2 tạm")

    var judge = null, judgeError = '';
    if (eligible) {
      try {
        judge = runGeminiJudge_(d);
      } catch (err) {
        judgeError = String(err);
      }
    }

    // ── Final level ──
    var level = band;
    var manualReview = false;
    var l4Flagged = false;
    if (judge) {
      if (judge.l3_confirmed) level = 3;          // Cấp 4 KHÔNG cấp tự động — chỉ xác nhận qua buổi bảo vệ
      l4Flagged = !!judge.l4_flagged;
      manualReview = !!judge.manual_review || l4Flagged;
    } else if (eligible && judgeError) {
      manualReview = true; // judge down → provisional Stage 1 result, Tim reviews
    }

    var diagnostic = buildDiagnostic_(d, judge, eligible, tier, score);
    if (l4Flagged) diagnostic.push('Hồ sơ của bạn có dấu hiệu Cấp 4 (đã xây công cụ AI tự chạy). Xem phần "Xác minh Cấp 4" cuối email để tự xác nhận trong 2 phút.');
    var recommendation = RECOMMENDATIONS[level];

    // ── Persist FIRST (never lose a submission) ──
    appendRow_(d, score, bandLabel, tier, eligible, judge, judgeError, level, manualReview);

    // ── Email the scorecard ──
    var emailed = false, emailError = '';
    try {
      sendScorecardEmail_(d, score, level, diagnostic, recommendation, manualReview, l4Flagged);
      emailed = true;
    } catch (err) {
      emailError = String(err);
      logIssue_('email_failed: ' + emailError + ' → ' + d.email);
    }

    out = {
      ok: true,
      level: level,
      level_name: LEVELS[level].name,
      band_label: bandLabel,
      mcq_score: score,
      dims: { T: d.mcq_dim_T, O: d.mcq_dim_O, E: d.mcq_dim_E },
      stage2_ran: !!judge,
      manual_review: manualReview,
      diagnostic: diagnostic,
      recommendation: recommendation,
      emailed: emailed
    };
  } catch (err) {
    out = { ok: false, error: String(err) };
    logIssue_('doPost_failed: ' + String(err));
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════════════════════════════
// GEMINI JUDGE — 12 disqualifiers (T/O/E) + L4 Build check
// ═══════════════════════════════════════════════════════════

function runGeminiJudge_(d) {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY chưa được cấu hình trong Script Properties');

  var prompt = [
    'Bạn là giám khảo chấm trình độ AI theo khung TOE 5 cấp của Tim Trần.',
    'Thí sinh đã vượt vòng trắc nghiệm (Cấp 2) và nộp portfolio dạng văn bản để xét Cấp 3 (Hệ thống hóa) và Cấp 4 (Xây dựng).',
    '',
    '## Bài nộp của thí sinh',
    '### 1. Bối cảnh công việc/dự án:', clip_(d.s2_project),
    '### 2. Master prompt cho công việc này:', clip_(d.s2_master_prompt),
    '### 3. Tiêu chuẩn chất lượng + nơi lưu để AI tự đọc mỗi phiên:', clip_(d.s2_quality_memory),
    '### 4. 3 việc lặp lại chạy bằng câu lệnh ngắn:', clip_(d.s2_tasks),
    '### 5. Bằng chứng Cấp 4 (công cụ/automation đã xây):', clip_(d.s2_l4_evidence),
    '',
    '## Luật chấm Cấp 3 — mỗi chiều T/O/E có 1 CỔNG BẮT BUỘC (binding gate) + tín hiệu phụ.',
    'Quy tắc KHÔNG bù trừ (non-compensatory): Cấp 3 = CẢ 3 chiều đều qua cổng bắt buộc. Hỏng 1 cổng → giữ Cấp 1/2. Không lấy điểm mạnh chiều này bù cho cổng hỏng ở chiều kia. (Chỉ 3 cổng quyết định pass/fail — KHÔNG phải 12 tiêu chí.)',
    '',
    '### 3 cổng bắt buộc (chỉ những thứ này đánh rớt Cấp 3):',
    'T-GATE (master prompt): có artifact tái sử dụng, khớp bối cảnh Phần 1. HỎNG nếu: mỗi lần tự viết prompt mới / prompt nằm trong đầu / prompt generic dùng dự án nào cũng được.',
    'O-GATE (tiêu chuẩn chất lượng): "thế nào là đạt" được LƯU ở nơi AI đọc được mỗi phiên (Gem/Project/file). HỎNG nếu: tiêu chuẩn chỉ trong đầu, hoặc mỗi phiên phải gõ/dán lại.',
    'E-GATE (việc lặp lại): có ÍT NHẤT 2 việc thật chạy bằng câu lệnh ngắn ra kết quả dùng được. HỎNG nếu: chỉ 1 việc, hoặc toàn việc AI mặc định làm tốt (dịch, tóm tắt 1 đoạn).',
    '',
    '### Tín hiệu phụ (KHÔNG tự đánh rớt — chỉ ghi vào soft_signals + đẩy manual_review nếu mơ hồ):',
    'prompt thiếu thành phần (vai trò/bối cảnh/nhiệm vụ/ràng buộc); tiêu chuẩn chỉ có ví dụ tốt, thiếu anti-pattern; "câu lệnh ngắn" thực ra 100+ từ; thường phải chạy lại 2-3 lần mới đạt.',
    '',
    '## Cấp 4 — KHÔNG cấp tự động qua bài này.',
    'Cấp 4 (Xây dựng) chỉ xác nhận qua BUỔI BẢO VỆ trực tiếp + rubric ≥3/4 — không chấm được từ văn bản tự khai.',
    'Nếu đạt Cấp 3 VÀ Phần 5 có đủ 3 dấu hiệu Build → đặt l4_flagged=true (ứng viên Cấp 4, chờ bảo vệ). TUYỆT ĐỐI không tự nâng kết quả thành Cấp 4.',
    'B1: công cụ/quy trình CHẠY ĐƯỢC (agent, script, automation) — AI làm việc, không chỉ viết chữ.',
    'B2: chạy lặp lại thật (định kỳ hoặc người khác dùng), không phải demo 1 lần.',
    'B3: có chốt chặn chất lượng (quy tắc khi nào dừng hỏi người).',
    '',
    '## Nguyên tắc',
    '- Chỉ đánh rớt Cấp 3 ở 3 CỔNG BẮT BUỘC. Tín hiệu phụ mơ hồ → manual_review=true, KHÔNG tự đánh rớt.',
    '- Artifact PHẢI khớp bối cảnh Phần 1 — artifact generic do AI viết sẵn → coi như hỏng T-GATE.',
    '- Đây là bài SÀNG LỌC TỰ KHAI (self-report), không phải quan sát làm việc thật → mọi kết quả Cấp 3 là SƠ BỘ, chờ xác nhận.',
    '- confidence "low" khi bằng chứng mơ hồ → manual_review=true.',
    '- diagnostic_vn: 2-4 gạch đầu dòng tiếng Việt, giọng thẳng, nói với thí sinh (dùng "bạn"), nêu đúng cái đang thiếu và vì sao nó chặn cấp tiếp theo. KHÔNG dùng mã cổng (T-GATE...) trong câu.',
    '',
    'Trả về DUY NHẤT một JSON object đúng schema:',
    '{"gates":{"T":bool,"O":bool,"E":bool},"soft_signals":["..."],',
    '"l3_confirmed":bool,"l4_checks":{"B1":bool,"B2":bool,"B3":bool},"l4_flagged":bool,',
    '"manual_review":bool,"diagnostic_vn":["..."],"summary_vn":"1 câu tổng kết"}'
  ].join('\n');

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + key;
  var body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
  };

  var lastErr = null;
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var resp = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(body),
        muteHttpExceptions: true
      });
      if (resp.getResponseCode() !== 200) throw new Error('Gemini HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 300));
      var text = JSON.parse(resp.getContentText()).candidates[0].content.parts[0].text;
      var judge = JSON.parse(text);
      if (typeof judge.l3_confirmed !== 'boolean') throw new Error('Judge JSON thiếu l3_confirmed');
      judge.l4_flagged = !!(judge.l3_confirmed && judge.l4_flagged);
      return judge;
    } catch (err) {
      lastErr = err;
      Utilities.sleep(1500);
    }
  }
  throw lastErr;
}

function clip_(t) {
  t = String(t || '').trim();
  if (!t) return '(bỏ trống)';
  return t.length > 6000 ? t.slice(0, 6000) + '\n[...cắt bớt...]' : t;
}

// ═══════════════════════════════════════════════════════════
// DIAGNOSTIC (VN, plain-language)
// ═══════════════════════════════════════════════════════════

function buildDiagnostic_(d, judge, eligible, tier, score) {
  var out = [];

  // Stage 1 dimension reads
  var dims = [
    { k: 'T', v: Number(d.mcq_dim_T), msg: 'Độ phức tạp công việc (T): bạn đang giao cho AI việc quá đơn giản hoặc mô tả thiếu bối cảnh — AI chỉ mạnh bằng phần bối cảnh bạn đưa vào.' },
    { k: 'O', v: Number(d.mcq_dim_O), msg: 'Chất lượng đầu ra (O): khâu kiểm tra output đang là điểm yếu — con số, tên riêng, chi tiết không giải thích được cần được rà trước khi gửi đi.' },
    { k: 'E', v: Number(d.mcq_dim_E), msg: 'Cách viết prompt (E): prompt của bạn còn thiếu cấu trúc (vai trò, bối cảnh, nhiệm vụ, ràng buộc) nên kết quả trồi sụt.' }
  ];
  dims.filter(function (x) { return x.v <= 1; }).forEach(function (x) { out.push(x.msg); });

  if (judge && judge.diagnostic_vn && judge.diagnostic_vn.length) {
    out = out.concat(judge.diagnostic_vn);
  } else if (score >= 7 && tier === 'free') {
    out.push('Điểm trắc nghiệm của bạn đủ điều kiện xét Cấp 3, nhưng Cấp 3 cần các tính năng của gói AI trả phí (Project / Gem / context file bền vững) — hiện bạn dùng gói miễn phí nên tạm xếp Cấp 2.');
  } else if (score >= 7 && !eligible) {
    out.push('Điểm trắc nghiệm của bạn đủ điều kiện xét Cấp 3 — nhưng phần portfolio (master prompt, tiêu chuẩn chất lượng, 3 việc lặp lại) chưa được điền đủ để chấm.');
  }

  if (!out.length) out.push('Không có điểm yếu nổi bật ở vòng trắc nghiệm — hồ sơ của bạn nhất quán với cấp được xếp.');
  return out;
}

// ═══════════════════════════════════════════════════════════
// SHEET
// ═══════════════════════════════════════════════════════════

function appendRow_(d, score, bandLabel, tier, eligible, judge, judgeError, level, manualReview) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Responses');
  sheet.appendRow([
    d.timestamp || new Date().toISOString(),
    d.instrument || 'tim-ai-scorecard',
    d.client || '', d.clientId || '', d.program || '', d.cohort || '',
    String(d.name || ''), String(d.role || ''), String(d.email || ''),
    score, d.mcq_total || 9,
    d.mcq_dim_T, d.mcq_dim_O, d.mcq_dim_E,
    JSON.stringify(d.mcq_answers || []),
    bandLabel, tier, eligible ? 'yes' : 'no',
    String(d.s2_project || ''), String(d.s2_master_prompt || ''),
    String(d.s2_quality_memory || ''), String(d.s2_tasks || ''), String(d.s2_l4_evidence || ''),
    judge ? JSON.stringify(judge) : '', judgeError,
    'L' + level, manualReview ? 'REVIEW' : ''
  ]);
}

function logIssue_(msg) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var log = ss.getSheetByName('Issues') || ss.insertSheet('Issues');
    log.appendRow([new Date().toISOString(), msg]);
  } catch (e) { /* last resort: swallow */ }
}

// ═══════════════════════════════════════════════════════════
// EMAIL
// ═══════════════════════════════════════════════════════════

function sendScorecardEmail_(d, score, level, diagnostic, recommendation, manualReview, l4Flagged) {
  var email = String(d.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email không hợp lệ: ' + email);

  var L = LEVELS[level];
  var firstName = String(d.name || 'bạn').trim().split(/\s+/).pop();
  var subject = 'Kết quả Scorecard AI của bạn: ' + L.name.split(' (')[0];

  var reviewNote = manualReview
    ? '<p style="background:#fff8e6;border:1px solid #f0d48a;border-radius:8px;padding:12px 16px;font-size:14px;">⚠️ Một phần bài của bạn cần người chấm xem lại. Đây là kết quả sơ bộ — nếu có điều chỉnh, Tim sẽ email lại trong vài ngày tới.</p>'
    : '';

  var l4Block = l4Flagged
    ? '<h3 style="font-size:16px;color:#0B2046;border-bottom:3px solid #FFCC00;padding-bottom:6px;">Xác minh Cấp 4 (2 phút)</h3>' +
      '<p style="font-size:14px;line-height:1.6;">Bạn có dấu hiệu Cấp 4 — đã xây công cụ AI tự chạy. Cấp 4 không chấm được từ mô tả, nên bước xác nhận rất nhẹ:</p>' +
      '<ol style="font-size:14px;line-height:1.7;padding-left:20px;">' +
      '<li><strong>Nếu công cụ là chatbot / Gem / Project / custom GPT:</strong> dán nguyên văn câu lệnh dưới đây vào chính công cụ đó, rồi chụp màn hình câu trả lời — ảnh phải thấy <strong>TÊN hệ thống</strong> của bạn.</li>' +
      '<li><strong>Nếu là script / automation</strong> (Apps Script, n8n, Zapier...): chụp màn hình trigger / lịch sử chạy + đoạn code chứa quy tắc kiểm soát chất lượng.</li>' +
      '<li><strong>Reply thẳng email này kèm ảnh.</strong> Tim xem và xác nhận Cấp 4.</li>' +
      '</ol>' +
      '<div style="background:#f5f6fa;border:1px solid #e2e2ea;border-radius:6px;padding:14px 16px;margin:12px 0;font-family:Consolas,Menlo,monospace;font-size:12.5px;line-height:1.55;white-space:pre-wrap;color:#111111;">' +
      esc_(L4_PROBE_PROMPT) +
      '</div>'
    : '';

  var htmlBody =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#111111;border:1px solid #e3e1d8;border-radius:6px;overflow:hidden;">' +
    '<div style="background:#0B2046;border-bottom:4px solid #FFCC00;padding:18px 24px;">' +
    '  <span style="font-weight:900;font-size:18px;letter-spacing:-0.5px;color:#ffffff;">TIM <span style="color:#FFCC00;">ON AI</span></span>' +
    '  <span style="font-size:10px;letter-spacing:2px;color:rgba(255,255,255,0.5);text-transform:uppercase;">&nbsp;&nbsp;The Operationalizer</span>' +
    '</div>' +
    '<div style="padding:24px;">' +
    '<p>Chào ' + esc_(firstName) + ',</p>' +
    '<p>Cảm ơn bạn đã hoàn thành bài đánh giá trình độ AI của Tim on AI. Kết quả của bạn:</p>' +
    '<div style="text-align:center;background:#0B2046;border-radius:6px;padding:30px 20px;margin:20px 0;">' +
    '  <div style="font-size:12px;letter-spacing:2.5px;color:rgba(255,255,255,0.55);text-transform:uppercase;">Trình độ hiện tại</div>' +
    '  <div style="font-size:28px;font-weight:900;color:#FFCC00;margin:10px 0;">' + esc_(L.name) + '</div>' +
    '  <div style="font-size:14px;color:rgba(255,255,255,0.75);">Trắc nghiệm tình huống: <strong style="color:#ffffff;">' + score + '/9</strong>' +
    '   &nbsp;·&nbsp; T ' + d.mcq_dim_T + '/3 &nbsp;·&nbsp; O ' + d.mcq_dim_O + '/3 &nbsp;·&nbsp; E ' + d.mcq_dim_E + '/3</div>' +
    '</div>' +
    reviewNote +
    '<h3 style="font-size:16px;color:#0B2046;border-bottom:3px solid #FFCC00;padding-bottom:6px;">Chẩn đoán</h3>' +
    '<ul style="font-size:14px;line-height:1.7;padding-left:20px;">' +
    diagnostic.map(function (x) { return '<li>' + esc_(x) + '</li>'; }).join('') +
    '</ul>' +
    '<h3 style="font-size:16px;color:#0B2046;border-bottom:3px solid #FFCC00;padding-bottom:6px;">Khuyến nghị bước tiếp theo</h3>' +
    '<ol style="font-size:14px;line-height:1.7;padding-left:20px;">' +
    recommendation.map(function (x) { return '<li>' + esc_(x) + '</li>'; }).join('') +
    '</ol>' +
    l4Block +
    '<p style="font-size:12px;color:#999aab;border-top:1px solid #e2e2ea;padding-top:12px;margin-top:24px;">' +
    'Về thang đo: Cấp 1-2 đo qua trắc nghiệm tình huống (bạn NHẬN RA cách làm đúng). Cấp 3-4 chấm SƠ BỘ từ portfolio bạn tự mô tả — Cấp 3 cần một buổi trao đổi để xác nhận, Cấp 4 cần buổi bảo vệ trực tiếp. ' +
    'Đây là công cụ tự đánh giá thử nghiệm, dùng để gợi ý lộ trình học — không phải chứng chỉ, không dùng để tuyển dụng hay đánh giá nhân sự.</p>' +
    '<p style="font-size:14px;">Có câu hỏi về kết quả? Trả lời trực tiếp email này.<br><br>Tim Trần<br><span style="color:#8b90a1;">Tim on AI — The Operationalizer</span></p>' +
    '</div></div>';

  var plainBody = 'Chào ' + firstName + ',\n\nKết quả Scorecard AI của bạn: ' + L.name +
    '\nTrắc nghiệm: ' + score + '/9 (T ' + d.mcq_dim_T + '/3, O ' + d.mcq_dim_O + '/3, E ' + d.mcq_dim_E + '/3)\n\nChẩn đoán:\n' +
    diagnostic.map(function (x) { return '- ' + x; }).join('\n') +
    '\n\nKhuyến nghị:\n' + recommendation.map(function (x, i) { return (i + 1) + '. ' + x; }).join('\n') +
    (l4Flagged
      ? '\n\n--- XÁC MINH CẤP 4 (2 phút) ---\n' +
        'Bạn có dấu hiệu Cấp 4. Để xác nhận: dán câu lệnh dưới đây vào chính công cụ AI bạn đã xây (hoặc chụp trigger/lịch sử chạy nếu là script/automation), chụp màn hình câu trả lời (thấy tên hệ thống), rồi reply email này kèm ảnh.\n\n' +
        L4_PROBE_PROMPT + '\n'
      : '') +
    '\n\nTim Trần — Tim on AI';

  GmailApp.sendEmail(email, subject, plainBody, {
    htmlBody: htmlBody,
    name: 'Tim Trần — Tim on AI'
  });
}

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ═══════════════════════════════════════════════════════════
// TEST HELPERS (run manually in the editor)
// ═══════════════════════════════════════════════════════════

function testJudge() {
  var fake = {
    s2_project: 'Báo cáo tuần cho team sales 5 người, output PDF gửi sếp sáng thứ 2, "xong" = sếp không hỏi thêm về số liệu.',
    s2_master_prompt: 'Bạn là trợ lý báo cáo của trưởng nhóm sales... (dán master prompt thật để test)',
    s2_quality_memory: 'Style guide lưu trong Gemini Gem "Báo cáo tuần": số liệu phải có nguồn, không dùng từ "rất", ví dụ xấu: ...',
    s2_tasks: '1. "làm báo cáo tuần" → PDF hoàn chỉnh. 2. "soạn recap họp" → email recap. 3. "check số CRM" → bảng đối chiếu.',
    s2_l4_evidence: 'Apps Script tự kéo số từ Sheet, chạy sáng thứ 2, có rule: lệch >10% so tuần trước thì dừng và hỏi tôi.'
  };
  Logger.log(JSON.stringify(runGeminiJudge_(fake), null, 2));
}

function testEmail() {
  sendScorecardEmail_(
    { name: 'Tim Trần', email: Session.getActiveUser().getEmail(), mcq_dim_T: 3, mcq_dim_O: 2, mcq_dim_E: 3 },
    8, 3,
    ['Tiêu chuẩn chất lượng của bạn mới có ví dụ tốt, chưa có anti-pattern — đây là chỗ hay rơi chất lượng nhất.'],
    RECOMMENDATIONS[3], false, false
  );
}

function testEmailL4() {
  // Gửi email Cấp 3 + khối "Xác minh Cấp 4" để kiểm tra câu lệnh probe hiển thị đúng.
  sendScorecardEmail_(
    { name: 'Tim Trần', email: Session.getActiveUser().getEmail(), mcq_dim_T: 3, mcq_dim_O: 3, mcq_dim_E: 3 },
    9, 3,
    ['Hồ sơ của bạn có dấu hiệu Cấp 4 (đã xây công cụ AI tự chạy). Xem phần "Xác minh Cấp 4" cuối email để tự xác nhận trong 2 phút.'],
    RECOMMENDATIONS[3], true, true
  );
}
