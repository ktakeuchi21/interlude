# AI for product managers: initial course review

Reviewed September 14, 2026 during implementation. This is agent research and editorial review, not external expert review or a live provider evaluation. The two existing immutable lesson versions are unchanged. Six new v1 lessons complete course positions 3–8.

| Lesson | Narration words | Source basis | Editorial checks |
| --- | ---: | --- | --- |
| Inference, latency, and cost | 717 | Google glossary; OpenAI latency and cost guides | Defines inference; separates task latency, first output and complete result; fictional cost arithmetic checked; no provider price promise. |
| Prompts, retrieval, and tools | 714 | OpenAI prompt, retrieval and function-calling guides | Separates instructions, context and execution; semantic relevance is not correctness; successful actions require an actual result. |
| Designing for uncertainty | 728 | Google PAIR trust and failure chapters | Confidence display is not evidence; review has a named task; recovery and action boundaries are explicit. |
| Evals and success criteria | 715 | OpenAI evaluation guide; Google PAIR data chapter | Separates tuning and comparison cases, severe failures and aggregate scores, observed trial rates and future guarantees; training-data-to-evaluation inference disclosed. |
| Pilots, adoption, and monitoring | 720 | OpenAI production guide; Google PAIR feedback; Google Rules of ML | Adoption is distinct from value; manual fallback, monitored data freshness, responsible owners and stop decisions are explicit; application of ML monitoring guidance is disclosed. |
| Your AI product brief | 724 | Google PAIR user needs; Anthropic workflow guidance | Integrates the prior lessons into an original seven-part brief; examples and benefits remain hypotheses; includes an owner and next decision. |

Every lesson contains a distinct objective, six narrated sections, a takeaway, one recall question with explanation, a reflection and a separately timed optional practical challenge. The scripts contain 600–800 words and fit the existing narration input bounds. Each source is used by at least one section. Exercises, citations and source notes remain outside the core audio script.

Source provenance is in AI_PRODUCT_SOURCE_MANIFEST.json. Raw third-party source captures are retained privately and are not distributed in this repository. The manifest records retrieval URLs, dates, byte counts and SHA-256 hashes. OpenAI documentation was retrieved as Markdown after the web reader rejected that content type. Google and Anthropic pages were inspected through the web reader; local HTML copies retain the material used for review. A compressed HTTP response was decoded before hashing the retained document. No raw source copies or credentials are bundled into the user-facing site.

The examples, pilot plans, rubrics, recovery designs, calculation and product-brief format are original hypothetical teaching. They are not reported implementations, legal requirements, product performance claims, or vendor-prescribed templates. Vendor recommendations are attributed. Anthropic's December 2024 guidance is used for the workflow distinction, not for a current framework recommendation. The evaluation lesson does not require OpenAI's retiring Evals platform.

Release verification: run the core suite, typecheck, lint and production build. The core suite checks all released seed lessons for length, source references, unique keys and valid quiz answers; focused pipeline fixtures intentionally retain the original two-lesson pilot. See docs/VERIFICATION.md for current validation boundaries.
