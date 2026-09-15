# Verification

## Automated coverage

The public source snapshot includes 127 core tests. They exercise real SQLite query helpers with synthetic provider transports and data:

- catalog identity, course order, lesson size and citation references;
- owner checks, progress revisions, activity accounting and immutable history;
- source selection, exact evidence binding, reviewed release and weekly publication;
- atomic cost/storage reservations, expiration fencing and saved-result recovery;
- Google service-account signing and fixed credential destinations;
- bounded narration chunks, validated PCM/WAV and replay without synthesis;
- unknown Google outcomes retained without automatic retries;
- interrupted lesson recovery discovery and readable HTML-timeout handling.

`npm run test:worker` additionally exercises the OAuth/audio adapters in real workerd with generated synthetic RSA keys and an in-process transport. No actual key file or provider request is used.

CI runs typecheck, lint, the 127-test core suite, the workerd check, the public-source guard, the build, local migration tracking and 22 local HTTP tests. These checks do not establish provider billing, live model quality or physical-device behavior.

## Local HTTP checks

`tests/http.test.mjs` runs only against a loopback app. It checks authorization, same-origin writes, persistence, replay and missing-service behavior. It creates clearly labeled local records; use a disposable local database. It does not initiate paid AI generation.

## Live validation boundaries

The private app has been used for sign-in, lessons, cross-device persistence, playback and weekly publication. Saved Google narration has been sampled at 1.5× in a browser, and the original owner progress/media records were checked for preservation during updates. The owner also reported successful earlier phone tests.

That evidence applies to the tested deployment and devices. It is not a certification for every iOS version, a full evaluation of all generated lessons, or a verified monthly total bill. The public repository contains neither private test exports nor saved media.

An interrupted healthcare narration exposed two recovery gaps: an unhelpful HTML/JSON error and no lesson-level Chirp saved-audio check. Both are addressed in this snapshot. Safe replacement of a genuinely missing Chirp segment remains unfinished. See [Roadmap](ROADMAP.md).
