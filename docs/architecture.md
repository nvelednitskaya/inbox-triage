Architecture

Rules → Classifier → Actions

The pipeline has three stages, and each email goes through them in order.

Rules match known senders by address substring and assign a category with
no API call. This is the cheapest and most predictable stage, and it handles
most of the volume — in testing, 80% of mail. An inbox is mostly a short list
of senders you already recognize.

The classifier only sees what the rules couldn't place. Unknown senders are
collected and sent to the LLM in a single batch. The model returns, per email,
a category, a priority, and a one-line summary, as JSON. Batching keeps the
call count low, which matters on a free tier with per-minute limits.

Actions apply the result: a colored Gmail label, archiving for newsletters,
and a Telegram message for the three categories worth an interruption.

Why split rules from the model

It would be simpler to send every email to the model. Splitting is a
deliberate choice:


Cost. Rules are free. Sending 80% of mail to the model would spend the
free-tier quota on senders whose category never changes.
Predictability. A rule always produces the same answer. The model is used
only where judgment is actually required.
Speed. Rule matches are instant and don't depend on an external service.


The design principle: use the model for the small share of decisions that need
judgment, and handle the rest with something you can reason about.

Safety choices

These are enforced in code, not left to the model's judgment:


Only newsletters are archived. The archive action checks an allow-list. A
wrong category from the model cannot move an important email out of the
inbox — the worst case is a wrong label, which is visible and reversible.
Uncertainty is explicit. When the model isn't confident, the email is
labeled unclear and left in the inbox. It is not marked processed, so it
gets another pass rather than being silently filed away.
Nothing is deleted. Archiving is reversible; there is no delete path in
the code at all.
Secrets stay out of the code. API key, bot token, and chat id live in
Script Properties, not in the source.


What happened when the model version was retired

Partway through the project the LLM provider retired the model version the
script was calling. Every classification request started returning a 404.

The pipeline degraded the way it was designed to:


Rule-matched mail kept sorting normally — that stage doesn't touch the model.
Unknown senders couldn't be classified, so they were labeled unclear and
left in the inbox.
Because unclear mail isn't marked processed, nothing was lost and nothing
was miscategorized. It simply waited.


The log made the cause obvious: a block of rows with source = error and the
404 text in the summary column. The fix was one line — the current model name —
plus a small listModels helper that asks the API which models the key can
actually use, so the next time a name changes the answer takes seconds to find.

The takeaway isn't that the outage was avoided. It's that when a dependency
broke, the failure was contained to one stage, visible in the log, and
harmless to the inbox.

Limits and next steps


Drafting replies. The model already produces a summary; the natural next
step is a draft reply for career mail, saved to Gmail drafts for a human to
send.
Unsubscribe digest. The log shows which senders generate the most
newsletters. A weekly summary of top unsubscribe candidates would cut the
noise at the source rather than just filing it.
Portability. The same three stages map onto a workflow tool like n8n if
the pipeline ever needs to run outside a Google account.
