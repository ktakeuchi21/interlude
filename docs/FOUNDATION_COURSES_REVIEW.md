# Completed foundation courses

Reviewed September 15, 2026. The two new courses contain eight lessons each, in the original planned order. Every lesson has 600–800 spoken words, a practical objective, section-level citations, a takeaway, reflection, optional challenge, and a scenario-based recall question. Their combined narration is 71,329 UTF-8 bytes before the speech provider's handling. The established eight product lessons are unchanged.

The software course follows the fictional Fieldnotes app through client/server responsibilities, persistent state, retry and conflict semantics, assistant context, reviewable changes, code review, debugging, credentials, and a feature brief. Healthcare examples use fictional Northstar and clinic workflows; they distinguish administrative assistance from clinical decisions, coverage determinations, and promotional approval. Exercises request synthetic examples rather than patient records.

Primary-source retrieval records are in `FOUNDATION_SOURCE_MANIFEST.json`; raw source captures are not distributed in this repository. MDN, GitHub, Google Engineering Practices, Playwright, OWASP, AHRQ, FDA, CMS, and NIST materials were retrieved and inspected. The two HHS pages were inspected through the web tool after direct downloading returned 403; the manifest explicitly distinguishes this from a locally retained full-page snapshot. The unavailable ONC slide link was excluded from the teaching.

Claim review boundaries:

- HTTP idempotency concerns intended effects; the lessons do not claim that choosing an HTTP method alone prevents duplicate writes.
- A browser-visible save is distinguished from durable, owner-authorized storage. Review and tests are described in terms of observable behavior, not assurances from a coding assistant.
- AHRQ's ambulatory health IT workflow guidance is explicitly applied by analogy to commercialization examples.
- FDA's June 2020 patient-input document is nonbinding methodological guidance in its stated development/regulatory context. The lesson does not present it as approval of commercial research methods.
- FDA promotional guidance supports the brief factual statements about misleading claims and fair presentation. Fictional review workflows and routing choices are proposals, not regulatory approval or universal company policy.
- CMS-0057-F's drug exclusion is stated specifically; the later proposal mentioned by CMS is not presented as a final requirement. The lesson asks readers to verify current applicability before implementing a policy.
- HHS minimum-necessary exceptions are acknowledged. Removing names is not described as sufficient de-identification.
- NIST is voluntary risk guidance. All numerical scenarios and suggested evaluation decisions are explicitly illustrative, with no claimed deployment results or guaranteed savings.

Original examples supply most of the teaching. No long source passages are reproduced. This is an implementation-time editorial review, not an external clinical, legal, or regulatory expert review.

Validation: catalog checks cover all 24 lesson identities, planned titles/order, distinct objectives/quizzes, narration bounds, and source references. The 125-test suite, TypeScript checks, lint, and production build passed before publication. A date-dependent test fixture was corrected to use its current preparation date; production evidence-date validation remains unchanged. Saved narration is deployment data and is not included here; passing script validation does not imply that audio exists in a new deployment.
