# Weekly refresh through a Codex task

The personal deployment uses an existing Codex task on an awake laptop for Monday 8 AM Mountain research and publication. This repository contains the supporting code and runbook, **not an installed automation**. Configure a schedule explicitly for your own task, time zone, account and private deployment.

## Bounded workflow

1. Read the current private deployment's source, learning state and existing weekly deliveries. Respect user edits, active course order, prior choices, and saved versions. Use a full authorized export when database projections truncate lesson JSON. Keep exports outside Git.
2. Build a private input file with `ownerId` and `state` matching that actual deployment. Run `node scripts/prepare-plan-week.mjs input.json output.json`. The helper performs no networking or paid generation.
3. It selects at most three suggestions and at most one active foundation lesson due after 28 days since its source review or last check. If the week is already delivered, verify any outstanding work and stop.
4. Retrieve and inspect current primary sources for a due lesson. Preserve exact relevant material, retrieval times, URLs and hashes. Record `unchanged` when no material change is supported, or `needs_sources` when evidence is insufficient.
5. Only for a supported material change, author and review the next version. Preserve the old objective, course and history. Follow `PlanPublication` in `lib/plan-publications.ts`: bind the prior version, content hash, review receipt and retained source copies. Never invent source material or inspection dates.
6. Append the completed artifact to `lib/plan-publications.json` **in the private deployment checkout**. Public source keeps that file empty because real artifacts contain an owner identity and personalized suggestions. Keep at most the latest eight build artifacts, pruning only after successful delivery; database history remains retained.
7. Validate and privately publish the exact source revision. Open the authorized app to import the artifact and verify the saved delivery in Settings and the weekly set on Today.
8. If a newly released lesson has no audio, prepare only its narration using the current Chirp voice and normal guards. Inspect unknown outcomes; do not automatically resubmit them.
9. Record the actual outcome. Notify the owner about a meaningful revision, failure, or required action; remain quiet when unchanged.

## Delivery semantics

A publication is trusted build content, not a public HTTP import endpoint. `plan_deliveries` stores one owner/week fingerprint and result. A repeated identical import resumes safely; a changed payload under an already claimed week is rejected. Existing weekly sets and choices survive. Invalid evidence leaves saved learning accessible while reporting that the new publication needs attention.

The build contains the prepared artifact before the app visit; database delivery happens on an authenticated state load. This is not an independent cloud cron job. Cloning, building, or viewing the public GitHub repository starts no scheduled or paid work.

The separate in-app manual refresh path uses the configured OpenAI API budget. A Codex-plan schedule should not silently invoke that paid API path.
