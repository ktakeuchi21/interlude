# Interlude

**A personal learning app for the small moments between everything else.**

Interlude turns a spare few minutes into a focused lesson: read or listen, check what you remember, save a thought, and pick up where you left off. It is a full-stack progressive web app designed for an iPhone and a laptop, with one private owner per deployment.

Built by [Kai Takeuchi](https://github.com/ktakeuchi21), with AI-assisted development and editorial work through Codex.

## Why I made this

I kept reaching for my phone in the gaps in my day: waiting for something, taking a break, or getting ready to go somewhere. Those moments often became scrolling. At the same time, there were plenty of things I wanted to understand better—AI product management, software development, healthcare workflows, and eventually topics beyond work.

YouTube and podcasts gave me plenty to consume, but choosing something, switching apps, and remembering where I left off added friction. I wanted one place where I could open the app and immediately continue something worthwhile. For chores or a walk, that meant audio. On my laptop, it meant reading, reviewing a course, and saving an idea I could use.

Interlude is my attempt to make that choice easier. The aim is a regular learning habit and useful understanding, with natural stopping points. Finishing playback is recorded separately from remembering or applying an idea. There is no infinite feed or streak penalty.

## What it does

- **Start quickly:** Today surfaces an in-progress lesson or the next lesson in an active course.
- **Read or listen:** Original cited lessons, saved narration, adjustable speed starting at **1.5×**, seeking, and a persistent player. Tapping the footer player opens its lesson.
- **Keep sessions bounded:** Approximately five-minute lessons at normal speed and a deliberately selected queue of up to three lessons.
- **Practice optionally:** Recall questions, reflections, practical challenges, follow-up questions, and short spoken input with an editable transcript.
- **Follow your curiosity:** Search, pause and reorder courses, save topics and sources, and prepare standalone lessons from reviewed evidence.
- **See progress:** Durable cross-device positions, a contribution-style activity calendar, and separate completion, recall, and application records.
- **Keep evidence and history:** Dated citations, retained source provenance, immutable lesson versions, and exportable learning data.
- **Control costs:** Reserve usage before provider calls, reuse saved audio, retain uncertain attempts, and enforce application spending and storage limits.

### Starter library

| Course | Focus | Lessons |
| --- | --- | ---: |
| AI for product managers | Problem selection, inference, retrieval, uncertainty, evaluation, adoption, and a product brief | 8 |
| AI for software development | Client/server/data, APIs, assistant context, code review, tests, deployment, and a feature plan | 8 |
| AI in pharma & healthcare | Workflow mapping, commercial insights, field support, content review, patient access, evidence, and a pilot | 8 |

All **24 lesson texts** and their exercises are included. Generated audio belongs to an individual deployment and is not included in the repository. Healthcare examples are fictional teaching scenarios; they are not patient-specific advice or claims of deployed clinical outcomes.

## Stack and why

| Layer | Implementation | Why it fits this project |
| --- | --- | --- |
| Interface | TypeScript, React 19, Next.js App Router conventions | Shared types and reusable components across phone and laptop |
| Build/runtime adapter | Vite 8 + **vinext**, Cloudflare Vite plugin | Runs the Next-style application on a Workers-compatible runtime; retains the existing Sites integration |
| UI | Tailwind CSS 4, Radix/shadcn-style components, Lucide | Consistent responsive controls without building every primitive from scratch |
| Server | Cloudflare Workers through Sites | A small HTTP application with managed deployment; no separate always-on application server |
| Data | D1 SQLite, Drizzle schema and SQL migrations | Durable relational state with atomic updates and an inspectable schema |
| Audio and source artifacts | Private R2 object storage | Large files stay out of the relational database; audio is served through authorized routes |
| Narration | Google Cloud Text-to-Speech, Chirp 3 HD | Saved natural-sounding narration with separate conservative character accounting |
| Optional interactive AI | OpenAI Responses API and transcription | Bounded questions, research, lesson preparation, and short voice drafts |
| Content maintenance | Codex task + trusted publication artifacts | Lets the personal deployment use plan-based research and authoring, while keeping optional runtime API work separate |
| Checks | TypeScript, ESLint, Node test runner, SQLite fixtures, workerd | Tests state changes, evidence checks, recovery, and the actual Worker audio adapter |

This is a **Next-style app built with vinext**, not a standard `next build` deployment. Production authentication depends on the trusted Sites dispatcher. Another host needs a real authentication integration before it can safely run this application.

Read [Architecture and decisions](docs/ARCHITECTURE.md) for the tradeoffs, boundaries, and alternatives considered.

## Try it locally

Requirements: **Node.js 24** and npm. The versioned lockfile is included.

```sh
git clone https://github.com/ktakeuchi21/interlude.git
cd interlude
npm run install:ci
npm run build
npm run db:migrate:local
npm run dev
```

Open the Local URL printed by the dev server, normally `http://localhost:5173`. Local sign-in uses a clearly separated development identity; it does not sign into the private production account. Reading, progress, and exercises can be explored without provider credentials. Narration and optional AI actions require your own server-side configuration.

See [Setup and deployment](docs/SETUP.md) for migration behavior, Google project configuration, optional secrets, and production authentication requirements.

## Costs and content refresh

The personal design target is **less than $10 per month**. That is a target, not a guaranteed bill.

The implementation caps OpenAI API commitments at **$8 per UTC month**, Chirp at **900,000 conservative UTF-8 bytes over a rolling 32-day window**, and audio storage reservations at **2 GB**. These are application controls, not account-wide provider billing limits. Replaying an existing audio file does not synthesize it again. Hosting, storage, other account usage, taxes, and provider pricing still matter.

Original course authoring and the personal weekly refresh can run through a Codex task using the owner's plan. The configured personal workflow runs Mondays at 8 AM Mountain and requires an awake laptop with Codex running. **Cloning this repository does not install that automation.** The public publication list starts empty, and the scheduling setup is documented in [Weekly refresh](docs/WEEKLY_PLAN_REFRESH.md).

In-app AI questions, research, lesson generation, and transcription use configured **API** credentials and accounting. They do not automatically consume ChatGPT subscription credits. See [Operations and cost controls](docs/OPERATIONS.md).

## Status and limits

This is a working personal project under active development, published as a source reference rather than a multi-user service.

- The three foundation courses and core learning loop are implemented.
- Phone playback and cross-device use have been exercised in the personal deployment. Device behavior still needs checking on each target iOS/browser combination.
- Live generated audio is not bundled; a new deployment starts without it.
- Interrupted Chirp work can remain held if a provider result is missing. Saved-only recovery is available; automatic retries and a complete Chirp replacement workflow are intentionally absent.
- More live quality evaluation is needed for researched answers, generated lessons, transcription, and long-term cost assumptions.
- Offline downloads, Audible account integration, and multi-user accounts are outside the current implementation.

[Roadmap](docs/ROADMAP.md) · [Verification](docs/VERIFICATION.md) · [iPhone playback checklist](docs/IPHONE_TEST.md)

## Development

```sh
npm run typecheck
npm run lint
npm test
npm run test:worker
npm run check:public
npm run build
```

The core suite currently contains **127 tests**. Its providers and keys are synthetic; it does not send paid requests. GitHub Actions runs the checks and build without production secrets. See [Contributing](CONTRIBUTING.md) before changing state, accounting, or authentication.

## Repository map

```text
app/                 App Router pages, private API routes, authentication adapter
components/          Reader, player, library, exercises, settings, UI primitives
lib/                 Lessons, evidence, progress, provider and accounting logic
db/ + drizzle/       Schema and ordered migrations
public/              PWA manifest, icons, online-only service worker
scripts/             Local setup, tests, publication preparation, public-source check
tests/               Core fixtures and loopback-only HTTP tests
docs/                Product, architecture, setup, operations, source review, roadmap
```

This repository starts from a sanitized source snapshot. Production identifiers, owner-specific weekly publications, private operational logs, databases, credentials, and saved media are excluded. Public source does not grant access to the personal app.

## Attribution and reuse

Third-party notices are retained in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No general reuse license is granted for Interlude's original code or lesson text at this time. The public repository is available to inspect; third-party components retain their own licenses.
