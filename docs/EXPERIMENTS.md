# Building Interlude: experiments and lessons learned

This retrospective describes the build through September 15, 2026. Interlude has one intended learner: its owner. “We” refers to the owner working with Codex on product decisions, implementation, research, and testing.

These are development trials and iterations, not controlled experiments or an external assessment of teaching quality. Automated checks, browser observations, and owner-reported device results provide different kinds of evidence. None establishes that Interlude has already reduced scrolling or improved long-term recall.

## 1. Start with the learning loop

**Question:** Would opening a short lesson, reading or listening, and returning to it work well enough to justify building a larger catalog?

**Trial:** Begin with two product-management lessons. Exercise authentication, saved positions, narration, the queue, and reopening the app. Ask the owner to try phone playback and cross-device use before expanding the content.

**Observed:** Browser checks covered playback and continuity. The owner reported successful device tests, including the requested lock-screen, headphone, interruption, and sync checks. No device model, OS version, or timing measurements were recorded, so this is owner-reported acceptance of that check set, not a universal iOS compatibility claim.

**Decision and lesson:** Expand to an eight-lesson product course, then add the two other eight-lesson foundation courses. The owner did not need to finish taking each course before development could continue. Technical acceptance, editorial readiness, and personal learning completion are different gates. All 24 lesson texts are included; generated narration remains a separate deployment artifact.

## 2. Make the next action obvious

**Question:** Could Today remove the need to browse a course just to find the next lesson?

**Trial:** Replace the generic entry point with a card based on the open or most recent unfinished lesson, then the next released lesson in an active path. Show the actual title and saved place. Preserve the exact lesson version when resuming.

**Observed:** The owner explicitly requested this after using the app. Focused tests cover recency, paused courses, ordered advancement, old versions, and caught-up states. The home page in the [screenshot gallery](../README.md#a-look-inside) demonstrates this with synthetic data.

**Decision and lesson:** Treat the current lesson as the main action. Exploration stays available in the library. A separate owner screenshot exposed touching home cards; a shared grid gap replaced competing card margins. Both changes came from specific friction, not a general visual redesign. We did not measure a conversion-rate improvement.

## 3. Refine audio around everyday use

**Question:** What should happen when a person taps the small player while browsing elsewhere?

**Trial:** Make the footer open the full reader for its lesson without replacing the existing audio element or queue. Change a fresh player's default from 1× to the owner's preferred 1.5×, while retaining manual speed controls.

**Observed:** Browser checks confirmed the correct lesson opened with playback and queue continuity. The owner separately confirmed both requested changes worked. The initial phone acceptance and the later Google browser samples are separate evidence; the Google migration was not a new physical-device test.

**Decision and lesson:** Keep one media element across navigation and queue transitions. Navigation should not discard a listening session. The queue remains deliberately bounded at three lessons, with a stopping point at its end.

## 4. Compare narration approaches with real samples

**Question:** Could another voice provider fit the personal cost target and listening preference?

**Trial:** The initial course used saved OpenAI `tts-1` narration with the Alloy voice. Later, generate and play short Google Chirp 3 HD samples for Charon and Kore, then a complete Charon lesson preview. Select Charon for future lesson narration.

**Observed:** Both samples and the full preview played in the browser at 1.5× without a media error. Existing audio and progress were checked for preservation during the change. This was a personal voice selection, not a blind preference study or a benchmark proving one provider superior.

**Decision and lesson:** Store narration once per lesson version, serve it privately, and reuse it. Keep the Google ledger separate from earlier OpenAI usage. New production narration does not silently fall back to OpenAI. A provider allowance influenced the choice, but application counters and a target budget do not establish a zero bill. See [cost controls](OPERATIONS.md).

## 5. Test the runtime, not just the adapter logic

**Question:** Did the Google integration behave in the deployed Worker environment as it did with mocked transports?

**Trial:** The first live authorization attempt failed before a synthesis request was reserved or sent. Reproduce the request setup in workerd, then add a dedicated runtime check with synthetic RSA credentials and an in-process transport.

**Observed:** workerd rejected `redirect: "error"`. The mocked tests had not exposed this platform behavior. Using `redirect: "manual"` and rejecting non-success responses fixed the incompatibility while preventing credentials from being forwarded through redirects.

**Decision and lesson:** Keep a real workerd test in addition to the core suite. Unit coverage of signing and accounting cannot prove that runtime-specific request options will work. This failed attempt did not initiate billable narration.

## 6. Treat interrupted requests as uncertain work

**Question:** What does “try again” mean after an expensive request disappears before its result reaches the app?

**Trial:** Save narration segments as they arrive, reserve usage before calls, retain uncertain attempts, and offer saved-output recovery. Later, a real healthcare narration was interrupted and its final segment was missing.

**Observed:** That interruption exposed an HTML response that was not presented as a useful app error, plus the absence of a lesson-level Chirp recovery control. This public snapshot fixes those two gaps. It cannot recover a segment that was never saved, and a complete replacement workflow for missing Chirp results remains unfinished.

**Decision and lesson:** Recover stored work before making another provider request. A timeout is not evidence that a provider did nothing or charged nothing. Retaining the reservation can temporarily block further generation; that inconvenience is preferable to silently losing the accounting trail. The next improvement is explicit, bounded replacement with preserved attempt history—not an unqualified automatic retry.

## 7. Separate a refresh workflow from its schedule

**Question:** Could new learning material appear regularly without making all research and authoring runtime API work?

**Trial:** Build a durable, resumable weekly workflow and finite suggestions. Then select an owner-approved Codex task to research, review, and publish bounded content using the owner's plan. Keep optional in-app API preparation available as a separate route.

**Observed:** A manual refresh action alone did not supply a timer. A trusted publication was delivered successfully in the personal app, and a weekly task was configured. The future scheduled wake-up had not yet occurred at this retrospective's cutoff; manual delivery does not verify unattended execution.

**Decision and lesson:** The personal task runs Mondays at 8 AM Mountain with an awake laptop and Codex running. A public clone does not inherit it. Subscription-supported work in a task and API requests from the application are different execution and billing paths. See [weekly refresh](WEEKLY_PLAN_REFRESH.md) for that boundary and setup.

## 8. Preserve history when teaching material changes

**Question:** How can a lesson improve without changing what an old completion or note referred to?

**Trial:** Bind learning records to immutable lesson versions. Retain inspected source provenance and tie release checks to the exact draft and evidence. Keep recall and application records separate from completion; count bounded reading/listening intervals instead of time with a tab open.

**Observed:** Tests exercise immutable identities, stale-device writes, evidence binding, release gates, and active-time accounting. These are data-integrity checks. Source inspection and AI-assisted editorial review improve traceability but do not guarantee the lesson is correct or effective.

**Decision and lesson:** Updating content should not rewrite the learner's past. The calendar shows estimated activity without a streak penalty. Finishing, remembering, and applying are distinct; longitudinal retention and real-world application remain open product questions.

## 9. Keep optional media inside a bounded experience

**Question:** Could existing videos and podcasts complement original lessons without requiring constant app switching?

**Trial:** Add optional embedded video and podcast material with explicit loading and playback teardown. Exercise a 3Blue1Brown video and a Lenny's Reads audio supplement in the desktop browser.

**Observed:** Those tested desktop embeds played, and podcast seeking was exercised. This does not establish every provider's mobile, lock-screen, or background behavior. Optional-media completion is a manual record, separate from finishing an original lesson.

**Decision and lesson:** Keep original lessons self-contained and supplements optional. Audible account integration, offline listening, and a native app were considered in the broader product discussion but were not implemented or validated as alternatives in this build.

## 10. Make the public project reproducible

**Question:** Could someone understand and run the source without inheriting the personal deployment?

**Trial:** Create a sanitized public snapshot with setup instructions, architecture decisions, verification boundaries, CI, and a tracked-file audit. Exercise an isolated local build, migrations, migration reapplication, and loopback HTTP checks without production credentials.

**Observed:** The initial public release passed the 127-test core suite, 22 local HTTP checks, workerd check, typecheck, lint, build, migration checks, and public-source guard in GitHub Actions. The public repository starts with an empty personal publication list and example deployment configuration.

**Decision and lesson:** A public codebase needs an explanation of the system's trust boundary, not just an install command. Production identity still depends on Sites; moving to another host requires a real authentication adapter. Screenshot preparation also uses an isolated local database: synthetic progress, sample notes, and a silent audio fixture. The UI is real; the depicted learning history is illustrative.

## What still needs evidence

- Does opening Interlude actually replace scrolling over several weeks?
- Which ideas are remembered later and applied at work or at home?
- How useful and well-supported are live researched answers, generated lessons, and spoken-input transcripts across realistic cases?
- Does the scheduled task execute reliably when its prerequisites are met?
- What is the reconciled total monthly bill, including storage and hosting?
- Can missing Chirp results be replaced without duplicate work or loss of the accounting history?

These remain questions to investigate. See [Verification](VERIFICATION.md) for current coverage and [Roadmap](ROADMAP.md) for remaining implementation work.
