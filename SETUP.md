# Setup

About 40 minutes. No prior Apps Script experience needed.

What you'll end up with: a script that runs every 30 minutes, sorts new mail
into colored Gmail labels, archives newsletters, and messages you on Telegram
for the categories that matter.

---

## 1. Get a Gemini API key (5 min)

1. Go to **aistudio.google.com** and sign in.
2. **Get API key → Create API key.** No credit card needed; the free tier is on
   by default.
3. Copy the key somewhere temporary. It goes into Script Properties later, not
   into the code.

## 2. Create the script (5 min)

1. Go to **script.google.com → New project.**
2. Rename it (click the title): `Inbox Triage`.
3. Delete the placeholder `function myFunction() {}` and paste all of `Code.gs`.
4. Save (Ctrl+S).

## 3. Fill in your senders (5 min)

Two lists near the top of the file:

- **`PERSONAL_SENDERS`** — addresses whose mail always goes to *Personal*. A
  substring is enough: `'jane@'` matches any domain.
- **`SENDER_RULES`** — a sender substring mapped to a category. This is what
  makes the pipeline mostly free: known senders are handled here, with no API
  call. Fill it with your own repeat senders. The file ships with generic
  examples — replace them.

## 4. Enable the Gmail API (2 min)

Plain Apps Script can't color labels, so add the advanced service:

1. In the editor, left panel **Services → +**.
2. Pick **Gmail API → Add**. `Gmail` should now appear under Services.

## 5. Add your keys (3 min)

1. Left panel **Project Settings → Script Properties → Add script property.**
2. Add:
   - `GEMINI_API_KEY` — the key from step 1
   - `TELEGRAM_TOKEN` — your bot token (see step 6; can be added later)
   - `TELEGRAM_CHAT_ID` — your numeric chat id (see step 6)
3. Save. Without the Telegram values the script still runs, just silently.

## 6. Create a Telegram bot (10 min)

1. In Telegram, open **@BotFather → `/newbot`**. Give it a name and a username
   ending in `bot`. It returns a **token** — put it in `TELEGRAM_TOKEN`.
2. Open your new bot and press **Start** (a bot can't message you first).
3. Open **@userinfobot → Start** — it returns your numeric **Id**. Put it in
   `TELEGRAM_CHAT_ID`.
4. Verify: run the `testTelegram` function. If a message arrives, the link
   works.

## 7. Create the colored labels (2 min)

1. In the function dropdown at the top, pick **setupLabels → Run.**
2. First run asks for authorization: **Review permissions → your account →
   Advanced → Go to Inbox Triage → Allow.** The "unverified app" screen is
   normal for a personal script.
3. Check Gmail — six colored labels should appear.

## 8. Test run (5 min)

1. Pick **testRun → Run.**
2. The execution log prints a link to a Google Sheet named *Inbox Triage — Log*.
3. Open it: one row per email, with category, priority, summary, and which
   stage decided (`rule` / `personal` / `gemini`). Your mail is untouched —
   `DRY_RUN` is `true`.

Common first-run errors:
- `No GEMINI_API_KEY` — step 5 not finished.
- `Gemini HTTP 404` — the model name is stale. Run `listModels` and copy an
  available `flash-lite` or `flash` name into `GEMINI_MODEL`.
- `Gmail is not defined` — step 4 (Gmail API service) not added.

## 9. Turn on the schedule (1 min)

Run **setupTrigger** once. Under **Triggers** (clock icon) you should see
`triageInbox` running every 30 minutes.

## 10. Watch it for a few days, then go live

Leave `DRY_RUN = true` for a few days and read the log. When a sender is
mislabeled, add it to `SENDER_RULES` or `PERSONAL_SENDERS`. When you trust it,
set `DRY_RUN = false` and save — the script starts labeling, archiving, and
notifying for real.

On the first live runs the script works through the mail already sitting in the
inbox. Sorting old mail into labels is fine, but you don't want a Telegram
message for each one, so notifications are limited to mail newer than
`NOTIFY_MAX_AGE_HOURS` (6 by default). Older mail still gets labeled and
archived, just silently.

## Undo

- Stop everything: Triggers → delete the trigger.
- Bring an email back: open it under its label → Move to inbox.
- Nothing is ever deleted, so nothing can be lost.
