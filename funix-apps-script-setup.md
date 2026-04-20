# Funix 4 Cái Biết — Google Sheet + Apps Script Setup

One-time setup. ~3 minutes. Do once, wire URL into both HTML files, done.

## Step 1 — Create the sheet (30 sec)

1. Open https://sheets.new
2. Rename it: **"Funix 4 Cái Biết — Responses"**
3. Rename tab `Sheet1` → `Responses`
4. Paste these 25 headers into row 1 (already tab-separated):

```
timestamp	instrument	phase	client	clientId	program	cohort	name	role	email	pulse_confidence	pulse_7day_usage	pulse_blockers	mcq_score	mcq_total	mcq_dim_T	mcq_dim_O	mcq_dim_E	mcq_answers_json	artifact_kimi_sheets	artifact_kimi_slides	confidence_post	commitment	nps	eight_week_intent	feedback_like	feedback_improve
```

## Step 2 — Add Apps Script (90 sec)

1. In the sheet, click **Extensions → Apps Script**
2. Delete whatever's in `Code.gs`
3. Paste this:

```javascript
function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Responses');
    var d = JSON.parse(e.postData.contents);

    sheet.appendRow([
      d.timestamp || new Date().toISOString(),
      d.instrument || '',
      d.phase || '',
      d.client || '',
      d.clientId || '',
      d.program || '',
      d.cohort || '',
      d.name || '',
      d.role || '',
      d.email || '',
      d.pulse_confidence || '',
      (d.pulse_7day_usage || []).join(' | '),
      (d.pulse_blockers || []).join(' | '),
      d.mcq_score != null ? d.mcq_score : '',
      d.mcq_total || '',
      d.mcq_dim_T != null ? d.mcq_dim_T : '',
      d.mcq_dim_O != null ? d.mcq_dim_O : '',
      d.mcq_dim_E != null ? d.mcq_dim_E : '',
      JSON.stringify(d.mcq_answers || []),
      d.artifact_kimi_sheets || '',
      d.artifact_kimi_slides || '',
      d.confidence_post || '',
      [d.commitment_when, d.commitment_do].filter(Boolean).join(' / '),
      d.nps != null ? d.nps : '',
      d.eight_week_intent || '',
      d.feedback_like || '',
      d.feedback_improve || ''
    ]);

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

4. Press **Ctrl+S** to save

## Step 3 — Deploy as web app (60 sec)

1. Click **Deploy → New deployment**
2. Settings icon (top-left of dialog) → **Web app**
3. Description: `Funix 4 Cai Biet v1`
4. Execute as: **Me (your Gmail)**
5. Who has access: **Anyone**
6. Click **Deploy**
7. First time only: Google will ask for permissions — review + allow
8. Copy the **Web app URL** (looks like `https://script.google.com/macros/s/AKfycb.../exec`)

## Step 4 — Share URL back to Claude

Paste the URL in chat. Claude will wire it into both HTML files (`funix-4biet-pre.html` + `funix-4biet-post.html`), commit, push. GitHub Pages redeploys in ~1 min.

## Step 5 — Share sheet with Funix (optional)

1. In the sheet, click **Share**
2. Add Hiền's email + "Viewer"
3. Toggle "Anyone with the link can view" if Funix team has multiple people

---

## How to read the data

Each row = 1 submission. Filter columns:

- `phase = pre` → pre-test submissions
- `phase = post` → post-test submissions
- Match pre + post by `email` (case-insensitive) → compute lift = post.mcq_score − pre.mcq_score
- Dimension breakdown: `mcq_dim_T`, `mcq_dim_O`, `mcq_dim_E` (each 0-3)
- Direct artifact evidence: `artifact_kimi_sheets`, `artifact_kimi_slides`
- NPS: column `nps` (0-10), Promoters = 9-10, Detractors = 0-6
