/**
 * Tim on AI — Scorecard MVP backend (scorecard.html → Sheet → email → one-click invite)
 * Spec: Things/02_Areas/P101_personal-brand/1-engines/scorecard/scorecard-mvp-spec-2026-09-11.md
 *
 * SETUP (Tim, ~5 min):
 *   1. sheets.new → name it "Scorecard — Leads". Leave the first tab as is; the script creates
 *      the "Leads" tab + headers on first run.
 *   2. Extensions → Apps Script → replace Code.gs with this file → Ctrl+S.
 *   3. Run testEmail() once from the editor → grant permissions → check your inbox.
 *   4. Deploy → New deployment → Web app → Execute as: Me · Who has access: Anyone → copy URL.
 *   5. Paste the URL into scorecard.html at GOOGLE_SCRIPT_URL → commit → push.
 *   6. Reload the Sheet: menu "Scorecard" appears (onOpen).
 *
 * Deploying account = sending account (timqtran1008@gmail.com). MailApp free quota: 100 emails/day.
 */

var SHEET_NAME = 'Leads';
var HEADERS = ['Timestamp', 'Name', 'Email', 'Level', 'Segment', 'Score %', 'T%', 'O%', 'E%',
               'Bottleneck', 'Src', 'Raw answers', 'Auto-email sent', 'Trạng thái', 'Ghi chú'];
var COL = { STATUS: 14, NOTE: 15, EMAIL: 3, NAME: 2, LEVEL: 4 }; // 1-based
var SENDER = 'Tim Trần — Tim on AI';

// ═══ WORKSHOP FACTS — P101/context.md 11 Sep 08:30: weeknight online classes, Cấp 1–2 Tuesdays / Cấp 3 Thursdays (no weekends), 8 seats, 2.5M/seat; Nov dates TBD ═══
var WORKSHOP = {
  date: 'buổi tối trong tuần — Cấp 1–2: tối thứ Ba, Cấp 3: tối thứ Năm (ngày cụ thể mình chốt với nhóm đăng ký)',
  format: 'online, làm việc trực tiếp trên tài liệu thật của bạn',
  seats: '8 chỗ',
  price: '2.500.000đ / chỗ'
};

// ═══ RESULT COPY — same text as scorecard.html §3 (Tim edits both places, or edit here and mirror) ═══
var BANDS = {
  '1':  { title: 'Cấp 1 — Hỏi',
          body: 'Bạn dùng AI như một cái Google biết nói: hỏi, nhận, copy. Mỗi lần làm task tương tự thì lại bắt đầu từ đầu. Không sao — hầu hết dân văn phòng đang ở đây, và đây là cấp dễ lên trình nhất.',
          done: 'Lớp online tối thứ Ba của mình bắt đầu đúng từ chỗ bạn đang đứng.' },
  '2':  { title: 'Cấp 2 — Ra lệnh',
          body: 'Bạn biết dặn AI cho rõ, có bối cảnh, có ví dụ. Output khá hơn — nhưng mỗi phiên bạn vẫn phải dặn kỹ càng lại từ đầu để ra được kết quả tốt. Cái thiếu không phải là prompt hay hơn, cái thiếu là làm thế nào để không phải gõ đi gõ lại.',
          done: 'Cấp 3 là chỗ lớp tối thứ Ba đưa bạn tới.' },
  '2+': { title: 'Cấp 2+ — sẵn sàng lên Cấp 3',
          body: 'Bài này đo được tới đây thôi. Cấp 3 trở lên mình cần nhìn vào hệ thống AI và cách bạn quản lý dữ liệu thì mới đánh giá được. Nếu bạn muốn mình đánh giá, liên hệ mình nhé.',
          done: 'Nhóm này có lớp riêng tối thứ Năm.' }
};
var BOTTLENECK = {
  T: 'Bạn giao cho AI toàn việc nhỏ. Bạn chưa tận dụng hết sức mạnh của AI, kể cả AI miễn phí.',
  O: 'Bạn giao việc cho AI mà nó không biết thế nào là chuẩn. Bạn đã thử cho nó 1 sản phẩm mẫu trước khi bảo nó thực hiện tác vụ chưa?',
  E: 'Bạn đang tốn quá nhiều công sức vào việc sửa output của AI. Nếu việc bạn giao là phức tạp, hãy luyện thói quen cho AI phỏng vấn để hiểu rõ tính chất công việc trước khi nó bắt tay vào làm nhé.'
};
var NEXT = {
  T: 'Tuần này, chọn một việc bạn vẫn đang tự làm vì "AI không làm nổi đâu" — giao cho AI, kèm đủ bối cảnh, xem nó đi được tới đâu.',
  O: 'Viết ra 3 dòng "thế nào là đạt" cho một việc bạn hay giao AI. Lần sau chấm output bằng 3 dòng đó, không chấm bằng cảm giác.',
  E: 'Lấy prompt bạn dùng nhiều nhất, thêm vào: vai trò, người đọc, ví dụ tốt, ví dụ xấu. Lưu lại. Lần sau dán, đừng gõ lại.'
};

// ═══════════════════════════════════════════════════════════
// 1. doPost — append the row, then email the result
// ═══════════════════════════════════════════════════════════
function doPost(e) {
  var out = { ok: false };
  try {
    var d = JSON.parse(e.postData.contents);
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
      String(d.segment || (level === '2+' ? 'B' : 'A')),
      Number(d.score_pct) || 0, Number(d.t_pct) || 0, Number(d.o_pct) || 0, Number(d.e_pct) || 0,
      String(d.bottleneck || ''),
      String(d.src || ''),
      JSON.stringify(d.raw || {}),
      '', 'Mới', ''
    ];
    sheet.appendRow(row);                               // persist FIRST — never lose a lead
    var r = sheet.getLastRow();

    var sent = '✗';
    try {
      sendResultEmail_(email, row[1], level, String(d.bottleneck || 'T'), Number(d.score_pct) || 0);
      sent = '✓';
    } catch (err) {
      sheet.getRange(r, COL.NOTE).setValue('email_failed: ' + err);
    }
    sheet.getRange(r, 13).setValue(sent);
    out = { ok: true, emailed: sent === '✓' };
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
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
function sendResultEmail_(email, name, level, bottleneck, scorePct) {
  var B = BANDS[level];
  var first = firstName_(name);
  var subject = 'Kết quả scorecard của bạn: Cấp ' + level;
  var body =
    'Chào ' + first + ',\n\n' +
    'Kết quả của bạn: ' + B.title + ' (' + scorePct + '% trên 12 tình huống).\n\n' +
    B.body + '\n\n' +
    'Điểm nghẽn: ' + (BOTTLENECK[bottleneck] || BOTTLENECK.T) + '\n\n' +
    'Một việc tiếp theo: ' + (NEXT[bottleneck] || NEXT.T) + '\n\n' +
    '---\n\n' +
    B.done + '\n\n' +
    'Workshop Tim on AI\n' +
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
  var track = level === '2+'
    ? 'Bạn ở nhóm Cấp 2+, nên buổi của bạn đi thẳng vào chuyện dựng: file bối cảnh, prompt dùng lại được, quy trình chạy được — trên việc thật của bạn.'
    : 'Bạn ở nhóm Cấp ' + level + ', nên buổi của bạn bắt đầu từ chỗ bạn đang đứng: một việc lặp lại của bạn, làm xong trong buổi, mang về dùng ngay.';
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
  sendResultEmail_(me, 'Trần Quang Tim', '2', 'E', 58);
  sendInviteEmail_(me, 'Trần Quang Tim', '2');
  Logger.log('Sent result + invite test emails to ' + me);
}
