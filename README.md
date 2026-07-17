# Inbox Triage

Sorts an overloaded Gmail inbox on its own: labels every incoming email by
category, archives newsletters, and sends a Telegram message when something
actually needs attention. Runs on a schedule with no manual step. No paid
services.

Built with Google Apps Script and a free-tier LLM as the classifier.

---

## The problem

A snapshot of the inbox before anything was built:

- 300 emails over 2.5 months
- 97% unread
- 75% newsletters and promotions

The inbox had stopped working as a tool. A recruiter reply or a message from
an apartment host would sit unread under fifty promotions. The cost isn't the
reading time — it's the important email you miss.

## How it works

Three stages. Each email passes through them in order.

**Rules → Classifier → Actions**

1. **Rules.** Known senders are matched by address and labeled instantly, with
   no API call. In testing this covered 80% of the flow — most of an inbox is a
   short list of repeat senders.
2. **Classifier.** Only unknown senders go to the LLM, sent in one batch, which
   returns a category, a priority, and a one-line summary as JSON.
3. **Actions.** The script applies the colored label, archives newsletters,
   and sends a Telegram message for the three categories worth interrupting for
   (personal, career, travel).

Splitting rules from the classifier is the point. Rules are free, instant, and
predictable; the model is only there for the small share of mail that rules
can't place.

See [docs/architecture.md](docs/architecture.md) for the design decisions.

## What the output looks like

Every processed email becomes a row in a Google Sheet log:

```
timestamp         source   from                     category   priority  summary
2026-07-16 01:43  rule     news@store.example       NEWSLETTER  P3       promo digest
2026-07-16 01:43  personal a.friend@example.com      PERSONAL    P3       message from a contact
2026-07-16 01:47  gemini   recruiter@company.example CAREER      P1       interview invitation
```

A Telegram message for the categories worth interrupting for:

```
🔥 Career · P1
From: recruiter@company.example
Subject: Interview invitation — Operations role
Summary: recruiter proposes a call this week
```

## Results

Measured over ~44 hours of live classification (logging only, inbox untouched):

| | before | after |
|---|---|---|
| Newsletters in the inbox | 75% | archived out |
| Sorting | by hand | automatic |
| Handled by rules, no LLM | — | 80% |
| Cost | — | $0 / month |

## Categories

Personal · Career · Bills & payments · Accounts & security · Travel ·
Newsletters. Each gets its own colored Gmail label.

## Stack

Google Apps Script · Gmail API · a free-tier LLM (Gemini) · Telegram Bot API.
Everything runs inside a Google account plus one Telegram bot. Nothing is
hosted or paid for.

## Behavior when things go wrong

The system is built so a failure is boring, not destructive:

- Only newsletters are ever archived. That rule is enforced in code, so a wrong
  guess from the model can't hide an important email.
- Uncertain mail is labeled *unclear* and left in the inbox untouched, for a
  human to look at.
- If the model is unreachable, rule-based sorting still runs and the rest waits
  for the next pass.
- Nothing is ever deleted. Archiving is reversible.

When the LLM provider retired the model version mid-project, the pipeline
degraded exactly this way: unknown mail piled up under *unclear*, nothing was
lost, and the fix was one line. That episode is written up in
[docs/architecture.md](docs/architecture.md).

## Setup

Full walkthrough in [SETUP.md](SETUP.md) — about 40 minutes, no prior Apps
Script experience assumed.

## Author

Nataliya Velednitskaya — Operations & AI Automation
[nv-operations.netlify.app](https://nv-operations.netlify.app)
