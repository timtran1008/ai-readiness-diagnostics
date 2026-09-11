/**
 * Tim on AI — Scorecard MVP backend (scorecard.html → Sheet → email → one-click invite)
 * Spec: Things/02_Areas/P101_personal-brand/1-engines/scorecard/scorecard-mvp-spec-2026-09-11.md
 *
 * SETUP (Tim, ~5 min):
 *   1. sheets.new → name it "Scorecard — Leads". Leave the first tab as is; the script creates
 *      the "Leads" tab + headers on first run.
 *   2. Extensions → Apps Script → replace Code.gs with this file → Ctrl+S.
 *   3. Project Settings → Script Properties → add GEMINI_API_KEY (aistudio.google.com/apikey). Free tier is enough.
 *   4. Run testJudge() once → grant permissions → check the log shows a ceiling. Then testEmail() → check inbox.
 *   5. Deploy → New deployment → Web app → Execute as: Me · Who has access: Anyone → copy URL.
 *   6. Paste the URL into scorecard.html at GOOGLE_SCRIPT_URL → commit → push.
 *   7. Reload the Sheet: menu "Scorecard" appears (onOpen). A "Judge log" tab fills with every judge call (no PII) — use it to calibrate the rubric.
 *
 * FLOW (Tim, 11 Sep 10:10–10:40): page posts {action:'judge', prompts[]} → Gemini classifies task complexity only →
 *   ceiling simple → Cấp 1 · else page asks first-response usability → >80% Cấp 3, else Cấp 2 → {action:'lead'} → row + email.
 *
 * Deploying account = sending account (timqtran1008@gmail.com). MailApp free quota: 100 emails/day.
 */

var SHEET_NAME = 'Leads';
var HEADERS = ['Timestamp', 'Name', 'Email', 'Level', 'Segment', 'Ceiling', 'Ceiling prompt', 'Judge reason',
               'Follow-ups', 'In system', 'Paying', 'Input mode', 'Src', 'Prompts (JSON)', 'Picked tasks', 'Judge error',
               'Auto-email sent', 'Trạng thái', 'Ghi chú'];
var COL = { STATUS: 18, NOTE: 19, EMAIL: 3, NAME: 2, LEVEL: 4, SENT: 17 }; // 1-based
var JUDGE_LOG = 'Judge log';
var JUDGE_LOG_HEADERS = ['Timestamp', 'Src', 'N prompts', 'Ceiling', 'Ceiling idx', 'Per-prompt', 'Reason', 'Prompts (JSON)', 'Error'];
var SENDER = 'Tim Trần — Tim on AI';

// ═══ SESSION FACTS — P101/context.md 11 Sep: NOT a class, a sharing session (Tim 08:55). Formula: where you are → why stuck → cost you don't see → solution → Tim demo → Q&A. Weeknight online, Cấp 1–2 Tuesdays / Cấp 3 Thursdays; dates + price/seats pending Tim ═══
var WORKSHOP = {
  date: 'buổi tối trong tuần — Cấp 1–2: tối thứ Ba, Cấp 3: tối thứ Năm (ngày cụ thể mình chốt với nhóm đăng ký)',
  format: 'online. Đi theo một mạch: bạn đang ở đâu → vì sao kẹt ở đó → cái giá bạn chưa nhìn thấy → cách gỡ → mình demo cách gỡ đó → hỏi đáp',
  seats: '8 chỗ',
  price: '2.500.000đ / chỗ'
};

// ═══ RESULT COPY — same text as scorecard.html BANDS (DRAFT — Tim edits both places, or edit here and mirror) ═══
var BANDS = {
  '1': { title: 'Cấp 1 — Hỏi', segment: 'A',
         body: 'Bạn dùng AI như một cái Google biết nói: hỏi, nhận, copy. Toàn việc một câu một việc. Không sao — hầu hết dân văn phòng đang ở đây, và đây là cấp dễ lên trình nhất: chỉ cần dám giao việc lớn hơn.',
         next: 'Tuần này chọn một việc lớn hơn bạn vẫn đang tự làm vì "AI không làm nổi đâu" — kế hoạch, đề xuất, báo cáo — giao cho AI, kèm đủ bối cảnh, xem nó đi được tới đâu. AI miễn phí cũng đủ để thử.',
         done: 'Buổi chia sẻ online tối thứ Ba của mình bắt đầu đúng từ chỗ bạn đang đứng. Thông tin trong email.' },
  '2': { title: 'Cấp 2 — Ra lệnh', segment: 'A',
         body: 'Bạn đã dám giao AI việc lớn — đó là bước nhiều người chưa qua. Nhưng bản đầu tiên chưa dùng được, bạn còn phải sửa nhiều, và mỗi lần lại dặn từ đầu. Cái thiếu không phải là prompt hay hơn. Cái thiếu là AI chưa biết thế nào là "đạt" theo chuẩn của bạn.',
         next: 'Lần sau giao việc, kèm 1 sản phẩm mẫu bạn thấy đạt (email cũ, slide cũ, báo cáo cũ) và nói: "làm theo chuẩn này". Việc phức tạp thì mở đầu bằng: "Trước khi làm, hỏi mình 5 câu để hiểu rõ việc." Chấm output bằng mẫu, không chấm bằng cảm giác.',
         done: 'Cấp 3 là chỗ buổi chia sẻ tối thứ Ba đưa bạn tới. Thông tin trong email.' },
  '3': { title: 'Cấp 3 — Dựng', segment: 'B',
         body: 'Bạn giao việc lớn và bản đầu tiên đã dùng được. Tức là AI đã biết chuẩn của bạn — bối cảnh, mẫu, tiêu chí đã có sẵn đâu đó. Bài này đo được tới đây. Từ Cấp 3 trở lên, câu hỏi không còn là "prompt thế nào" mà là hệ thống của bạn chạy được bao nhiêu việc mà không cần bạn ngồi đó.',
         next: 'Đếm xem bạn có bao nhiêu việc lặp lại đang chạy bằng một câu lệnh ngắn từ prompt/project đã lưu. Dưới 3 → tuần này dựng thêm 1. Từ 3 trở lên → buổi tối thứ Năm là chỗ để so hệ thống của bạn với người khác.',
         done: 'Buổi chia sẻ tối thứ Năm của mình dành riêng cho nhóm Cấp 3. Thông tin trong email.' },
  near: 'Riêng bạn: bản đầu đã dùng được rồi — tức là bạn dặn AI tốt. Cái còn thiếu là một chỗ để AI nhớ chuẩn của bạn mà không cần bạn dặn lại: Project, Gem, hay một file bối cảnh. Dựng cái đó xong là Cấp 3.',
  nearNext: 'Lấy đúng prompt vừa rồi, tách phần bối cảnh + chuẩn ra thành một file hoặc Project instructions. Lần sau chỉ gõ việc, không gõ lại bối cảnh. Một việc thôi, tuần này.'
};

// ═══════════════════════════════════════════════════════════
// 1. doPost — router: 'judge' (Gate 1, no PII) · 'lead' (row + email)
// ═══════════════════════════════════════════════════════════
function doPost(e) {
  var out = { ok: false };
  try {
    var d = JSON.parse(e.postData.contents);
    out = d.action === 'judge' ? handleJudge_(d) : handleLead_(d);
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'tim-on-ai-scorecard' })).setMimeType(ContentService.MimeType.JSON);
}

// Abuse caps (Execute as Me + Anyone = open endpoint). CacheService counters, 6 h window.
var CAP_JUDGE_PER_6H = 150;   // Gemini free tier ≈ 250 req/day; fallback self-pick takes over past this
var CAP_EMAIL_PER_6H = 40;    // MailApp quota 100/day
function bump_(key, cap) {
  var c = CacheService.getScriptCache();
  var n = Number(c.get(key) || 0) + 1;
  c.put(key, String(n), 21600);
  return n <= cap;
}

function handleJudge_(d) {
  var prompts = (d.prompts || []).map(function (p) { return String(p || '').trim().slice(0, 2000); }).filter(function (p) { return p.length >= 8; }).slice(0, 5);
  if (prompts.length < 3) throw new Error('Cần ít nhất 3 prompt');
  if (!bump_('judge6h', CAP_JUDGE_PER_6H)) return { ok: false, error: 'judge_cap' };
  var verdict = null, error = '';
  try { verdict = runJudge_(prompts); } catch (err) { error = String(err); }
  try { logJudge_(d.src, prompts, verdict, error); } catch (_) {}
  if (!verdict) return { ok: false, error: error };
  return { ok: true, verdict: verdict };
}

function handleLead_(d) {
  var level = String(d.level || '1');
  if (!BANDS[level]) level = '1';
  var email = String(d.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email không hợp lệ');

  var sheet = getSheet_();
  var row = [
    d.timestamp || new Date().toISOString(),
    String(d.name || '').slice(0, 120),
    email,
    level,
    String(d.segment || BANDS[level].segment),
    String(d.ceiling || ''),
    String(d.ceiling_prompt || '').slice(0, 2000),
    String(d.judge_reason || '').slice(0, 1000),
    String(d.followups || ''), String(d.in_system || ''), String(d.paying || ''), String(d.input_mode || ''),
    String(d.src || ''),
    JSON.stringify(d.prompts || []).slice(0, 12000),
    (d.picked || []).join(' | ').slice(0, 2000),
    String(d.judge_error || ''),
    '', 'Mới', ''
  ];
  sheet.appendRow(row);                               // persist FIRST — never lose a lead
  var r = sheet.getLastRow();

  var sent = '✗';
  try {
    var c = CacheService.getScriptCache();
    if (c.get('sent:' + email.toLowerCase())) throw new Error('duplicate_within_6h');   // one result email per address per 6 h
    if (!bump_('email6h', CAP_EMAIL_PER_6H)) throw new Error('email_cap');
    c.put('sent:' + email.toLowerCase(), '1', 21600);
    sendResultEmail_(email, row[1], level, String(d.ceiling_prompt || ''), String(d.judge_reason || ''), String(d.followups || ''), String(d.in_system || ''));
    sent = '✓';
  } catch (err) {
    sheet.getRange(r, COL.NOTE).setValue('email_failed: ' + err);
  }
  sheet.getRange(r, COL.SENT).setValue(sent);
  return { ok: true, emailed: sent === '✓' };
}

// ═══════════════════════════════════════════════════════════
// 1b. Gemini judge — TASK COMPLEXITY ONLY (Tim 10:35: "the prompt is to check task complexity only")
//     Domain codes per TQE instrument v0.5 §3 (Code D): simple / complicated / complex.
// ═══════════════════════════════════════════════════════════
var JUDGE_MODEL = 'gemini-2.5-flash';

function runJudge_(prompts) {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY chưa được cấu hình trong Script Properties');

  var listed = prompts.map(function (p, i) { return '### Prompt ' + (i + 1) + '\n' + p; }).join('\n\n');
  var prompt = [
    'Bạn là giám khảo. Người dùng dán câu ĐẦU TIÊN họ gõ trong ' + prompts.length + ' cuộc chat gần nhất với AI.',
    'Nhiệm vụ DUY NHẤT: phân loại ĐỘ PHỨC TẠP CỦA VIỆC được giao trong mỗi prompt. KHÔNG chấm prompt viết hay hay dở, KHÔNG chấm có bối cảnh hay không — chỉ chấm việc đó thuộc loại nào.',
    '',
    '## Ba loại việc',
    'simple — một chỉ dẫn, một kết quả; không cần chuyên môn để biết đạt hay chưa. Ví dụ: dịch, tóm tắt một đoạn, sửa ngữ pháp, viết caption, hỏi kiến thức, hỏi cách dùng, chào hỏi, trò chuyện, xin gợi ý tên, làm toán đơn giản.',
    'complicated — nhiều phần, cần chuyên môn, NHƯNG câu trả lời đúng biết được trước: có chuẩn, mẫu, quy định hoặc người quản lý nói được thế nào là đạt. Ví dụ: lập kế hoạch đào tạo 3 tháng, viết đề xuất cho sếp, báo cáo theo mẫu, phân tích dữ liệu theo câu hỏi cụ thể, soạn hợp đồng theo điều khoản cho sẵn, dựng outline bài trình bày 30 phút cho ban giám đốc.',
    'complex — "đạt" chưa ai định nghĩa được trước, làm ra rồi mới biết; người làm phải tự đặt tiêu chí. Ví dụ: dựng một app/tool từ ý tưởng, thiết kế chiến lược chưa có tiền lệ, thử nghiệm hướng kinh doanh mới, viết cái gì đó "hay" mà không có mẫu.',
    '',
    '## Quy tắc',
    '- Chấm VIỆC được giao, không chấm cách viết. Prompt ngắn cũng có thể là việc complicated ("lên kế hoạch onboarding cho 20 nhân viên mới" là complicated dù chỉ 1 dòng). Prompt dài kể lể vẫn có thể là việc simple.',
    '- Phân vân giữa simple và complicated → chọn simple. Phân vân giữa complicated và complex → chọn complicated. (Bài này là sàng lọc, chấm chặt.)',
    '- Prompt vô nghĩa, rỗng, chỉ chào hỏi → domain "simple".',
    '- Nếu đoạn dán là câu TRẢ LỜI của AI hoặc cả cuộc hội thoại (không phải câu người dùng gõ): suy ra việc người dùng đã yêu cầu nếu thấy được, rồi chấm việc đó; không suy ra được → "simple".',
    '- ceiling = loại cao nhất trong các prompt (complex > complicated > simple). ceiling_index = số thứ tự của prompt đại diện cho ceiling, đánh số như trong danh sách (Prompt 1 = 1); nếu nhiều prompt cùng loại, chọn cái rõ nhất.',
    '- reason_vn: 1–2 câu tiếng Việt, nói với người dùng (dùng "bạn", "mình" = giám khảo), nêu việc lớn nhất bạn thấy và vì sao nó thuộc loại đó. Không dùng từ simple/complicated/complex trong câu — nói bằng lời thường: "việc một bước", "việc nhiều phần có chuẩn rõ", "việc chưa ai định nghĩa đạt là gì".',
    '',
    '## Prompt của người dùng',
    listed,
    '',
    'Trả về DUY NHẤT một JSON object đúng schema:',
    '{"prompts":[{"i":1,"domain":"simple|complicated|complex","task_vn":"việc gì, 5-10 từ"}],"ceiling":"simple|complicated|complex","ceiling_index":1,"reason_vn":"..."}'
  ].join('\n');

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + JUDGE_MODEL + ':generateContent?key=' + key;
  var body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } } };
  var order = { simple: 0, complicated: 1, complex: 2 };

  var lastErr = null;
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var resp = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
      if (resp.getResponseCode() !== 200) throw new Error('Gemini HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 300));
      var text = JSON.parse(resp.getContentText()).candidates[0].content.parts[0].text;
      var v = JSON.parse(text);
      if (!Array.isArray(v.prompts) || !v.prompts.length) throw new Error('Judge JSON thiếu prompts');
      // Recompute ceiling from per-prompt domains — never trust the model's own max.
      var best = 0, bestIdx = 0;
      v.prompts.forEach(function (p, k) {
        var dom = order.hasOwnProperty(p.domain) ? p.domain : 'simple';
        p.domain = dom;
        var i = (typeof p.i === 'number' && p.i >= 1 && p.i <= prompts.length) ? p.i - 1 : k;  // model is 1-based, page is 0-based
        if (k === 0 || order[dom] > best) { best = order[dom]; bestIdx = i; }
        else if (order[dom] === best && Number(v.ceiling_index) - 1 === i) bestIdx = i; // model's pick among ties
      });
      v.ceiling = Object.keys(order)[best];
      v.ceiling_index = bestIdx;
      v.reason_vn = String(v.reason_vn || '').slice(0, 600);
      return v;
    } catch (err) {
      lastErr = err;
      Utilities.sleep(1500);
    }
  }
  throw lastErr;
}

function logJudge_(src, prompts, verdict, error) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(JUDGE_LOG);
  if (!sh) { sh = ss.insertSheet(JUDGE_LOG); sh.appendRow(JUDGE_LOG_HEADERS); sh.setFrozenRows(1); sh.getRange(1, 1, 1, JUDGE_LOG_HEADERS.length).setFontWeight('bold'); }
  sh.appendRow([
    new Date().toISOString(), String(src || ''), prompts.length,
    verdict ? verdict.ceiling : '', verdict ? verdict.ceiling_index : '',
    verdict ? verdict.prompts.map(function (p) { return p.domain + ':' + (p.task_vn || ''); }).join(' | ') : '',
    verdict ? verdict.reason_vn : '',
    JSON.stringify(prompts).slice(0, 12000), error || ''
  ]);
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sh;
}

// ═══════════════════════════════════════════════════════════
// 2. Result email — plain text, VN, Chú Tim voice (DRAFT — Tim edits)
// ═══════════════════════════════════════════════════════════
function sendResultEmail_(email, name, level, ceilingPrompt, judgeReason, followups, inSystem) {
  var B = BANDS[level];
  var first = firstName_(name);
  var subject = 'Kết quả scorecard của bạn: ' + B.title;
  var FU = { '0-1': 'gõ thêm 0–1 lần là dùng được', '2-4': 'phải gõ thêm 2–4 lần', '5+': 'phải gõ thêm 5 lần trở lên', 'gave-up': 'cuối cùng bỏ, tự làm' };
  var qLine = followups ? ' Trong cuộc chat đó bạn ' + (FU[followups] || followups) + '.' : '';
  var near = level === '2' && followups === '0-1';
  var bodyText = B.body + (near ? ' ' + BANDS.near : '');
  var nextText = near ? BANDS.nearNext : B.next;
  var body =
    'Chào ' + first + ',\n\n' +
    'Kết quả của bạn: ' + B.title + '.\n\n' +
    bodyText + '\n\n' +
    'Mình thấy gì trong prompt của bạn: ' + (judgeReason || 'Việc lớn nhất bạn giao AI là cái dưới đây.') + qLine + '\n' +
    (ceilingPrompt ? '> ' + ceilingPrompt.replace(/\n/g, '\n> ') + '\n\n' : '\n') +
    'Một việc tiếp theo: ' + nextText + '\n\n' +
    '---\n\n' +
    B.done + '\n\n' +
    'Buổi chia sẻ Tim on AI\n' +
    '· Thời gian: ' + WORKSHOP.date + '\n' +
    '· Hình thức: ' + WORKSHOP.format + '\n' +
    '· Sĩ số: ' + WORKSHOP.seats + '\n' +
    '· Học phí: ' + WORKSHOP.price + '\n\n' +
    'Muốn giữ chỗ? Trả lời email này một chữ "Đăng ký" là đủ, mình gửi bước tiếp theo.\n\n' +
    'Thỉnh thoảng mình gửi bài mới về cách dùng AI trong công việc. Không muốn nhận nữa thì trả lời "Thôi" là mình dừng.\n\n' +
    'Tim';
  MailApp.sendEmail({ to: email, subject: subject, body: body, name: SENDER });
}

// ═══════════════════════════════════════════════════════════
// 3. Menu — one-click workshop invite for selected rows
// ═══════════════════════════════════════════════════════════
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Scorecard')
    .addItem('Gửi lời mời workshop cho dòng đã chọn', 'sendInviteToSelected')
    .addToUi();
}

function sendInviteToSelected() {
  var ui = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== SHEET_NAME) { ui.alert('Chọn dòng trong tab "' + SHEET_NAME + '" trước.'); return; }
  var ranges = sheet.getSelection().getActiveRangeList().getRanges();
  var sent = 0, skipped = [];
  ranges.forEach(function (rg) {
    for (var r = rg.getRow(); r <= rg.getLastRow(); r++) {
      if (r === 1) continue;
      var vals = sheet.getRange(r, 1, 1, HEADERS.length).getValues()[0];
      var email = String(vals[COL.EMAIL - 1] || '').trim();
      if (!email) { skipped.push(r + ': không có email'); continue; }
      try {
        sendInviteEmail_(email, String(vals[COL.NAME - 1] || ''), String(vals[COL.LEVEL - 1] || '1'));
        sheet.getRange(r, COL.STATUS).setValue('Đã mời workshop');
        sheet.getRange(r, COL.NOTE).setValue(('Mời ' + new Date().toISOString().slice(0, 10) + '. ' + String(vals[COL.NOTE - 1] || '')).trim());
        sent++;
      } catch (err) { skipped.push(r + ': ' + err); }
    }
  });
  ui.alert('Đã gửi ' + sent + ' lời mời.' + (skipped.length ? '\nBỏ qua:\n' + skipped.join('\n') : ''));
}

// ═══ Invite email (DRAFT — Tim edits) ═══
function sendInviteEmail_(email, name, level) {
  var first = firstName_(name);
  var track = level === '3'
    ? 'Bạn ở nhóm Cấp 3, nên buổi tối thứ Năm đi thẳng vào chuyện dựng: file bối cảnh, prompt dùng lại được, quy trình chạy được — trên việc thật của bạn.'
    : 'Bạn ở nhóm Cấp ' + level + ', nên buổi tối thứ Ba bắt đầu từ chỗ bạn đang đứng: một việc lặp lại của bạn, làm xong trong buổi, mang về dùng ngay.';
  var subject = 'Mời bạn: workshop Tim on AI, ' + WORKSHOP.date.split(' (')[0];
  var body =
    'Chào ' + first + ',\n\n' +
    'Hôm trước bạn làm scorecard của mình. Mình mở workshop cho đúng nhóm đó, và mình giữ cho bạn một chỗ nếu bạn muốn.\n\n' +
    track + '\n\n' +
    '· Thời gian: ' + WORKSHOP.date + '\n' +
    '· Hình thức: ' + WORKSHOP.format + '\n' +
    '· Sĩ số: ' + WORKSHOP.seats + ' — hết là mình đóng, không mở thêm\n' +
    '· Học phí: ' + WORKSHOP.price + '\n\n' +
    'Giữ chỗ: trả lời email này "Đăng ký". Mình gửi hướng dẫn thanh toán và một câu hỏi chuẩn bị trước buổi.\n\n' +
    'Không hợp lúc này cũng không sao — nói mình một tiếng để mình nhường chỗ cho người khác.\n\n' +
    'Tim';
  MailApp.sendEmail({ to: email, subject: subject, body: body, name: SENDER });
}

function firstName_(name) {
  var n = String(name || '').trim();
  return n ? n.split(/\s+/).pop() : 'bạn';
}

// ═══════════════════════════════════════════════════════════
// TEST — run from the editor; sends both emails to the deploying account
// ═══════════════════════════════════════════════════════════
function testEmail() {
  var me = Session.getEffectiveUser().getEmail();
  sendResultEmail_(me, 'Trần Quang Tim', '2', 'Lên kế hoạch onboarding 3 tháng cho 20 nhân viên mới phòng sales', 'Việc lớn nhất mình thấy là kế hoạch onboarding — việc nhiều phần, có chuẩn rõ.', '0-1', 'no');
  sendInviteEmail_(me, 'Trần Quang Tim', '2');
  Logger.log('Sent result + invite test emails to ' + me);
}

function testJudge() {
  var v = runJudge_([
    'dịch giúp mình đoạn này sang tiếng Anh: Kính gửi anh, em xin phép gửi báo cáo tuần',
    'Lên kế hoạch onboarding 3 tháng cho 20 nhân viên mới phòng sales, có mốc đánh giá từng tháng',
    'viết caption facebook cho ảnh team building',
    'tóm tắt file này'
  ]);
  Logger.log(JSON.stringify(v, null, 2));
}
