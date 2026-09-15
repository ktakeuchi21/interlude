# Setup and deployment

## Local development

Use Node 24 and npm. From the repository root:

```sh
npm run install:ci
npm run build
npm run db:migrate:local
npm run dev
```

`db:migrate:local` applies pending SQL migrations using Wrangler's local migration tracking. Re-running it skips previously applied migrations. It only targets the local database, under `.wrangler/state`; it does not connect to a production database. Build first so the script can read the generated binding configuration.

Open the Local URL printed by Vite. The normal port is 5173, but the printed URL takes precedence. Local sign-in uses the loopback-only `local_seedy` fixture provided by the vendored development plugin. Runtime data and generated output are ignored by Git.

For an existing checkout whose migrations were previously applied manually without a migration ledger, do not run the new migration command against that database blindly. Use a separate fresh local checkout/database or reconcile its migration records after backing it up.

## Optional providers

You can read the seed lessons, save progress, and use exercises without AI credentials. No saved narration is shipped with this source.

The application reads:

| Secret | Enables |
| --- | --- |
| `OPENAI_API_KEY` | Optional runtime questions, research, preparation, and transcription |
| `GOOGLE_TTS_SERVICE_ACCOUNT_JSON` | Chirp narration through a dedicated Google service account |

The public `.env.example` contains names only. For local Worker development, place actual values in an ignored `.dev.vars` file using Wrangler's environment-file format. Provider calls from a credentialed local app are real requests; the automated test suite instead uses synthetic credentials and transports.

For Google, set the two **non-secret** identifiers in `lib/google-project.ts` to your project ID and service-account email. The JSON secret must match them. The OAuth token URI and synthesis destination remain fixed Google endpoints. Do not put the private key in that TypeScript file or in a committed environment file.

Enable Cloud Text-to-Speech and configure billing/IAM for your own Google project. Verify applicable pricing and allowances in that account. In Settings, prepare a short sample and full preview, then select a voice before preparing lesson audio.

## Sites deployment

This repository includes logical D1 and R2 bindings in `.openai/hosting.json`, but no production Site ID. A fork must register its own Site and keep its resulting deployment identity in its private deployment checkout. Do not substitute someone else's Site ID.

Use the Sites build/publish workflow for the registered project, configure server secrets through its secret management interface, apply the generated migrations, and preserve owner-only access. A release consists of the exact source revision, its matching build archive, and the managed runtime environment. The public-source check intentionally rejects owner-specific configuration; a private deployment checkout and this public source repository serve different purposes.

## Hosting elsewhere

The UI and domain logic are reusable source, but this is not a one-click generic Workers deployment. Production sign-in currently relies on the Sites dispatcher. Another host must implement verified identity, strip client-supplied trusted headers, protect first-owner enrollment, bind D1/R2, serve private media, and apply migrations. Do not expose the current Worker directly with spoofable identity headers.

## Changes and checks

Schema changes belong in `db/schema.ts`; generate a new migration with `npm run db:generate`. Review it and apply only pending migrations. Do not rewrite published migration files.

```sh
npm run typecheck
npm run lint
npm test
npm run test:worker
npm run check:public
npm run build
```

With a local dev server running, the HTTP suite is optional:

```sh
INTERLUDE_TEST_URL=http://localhost:5173 node --test tests/http.test.mjs
```

It refuses non-loopback hosts and creates labeled local test records. Use a disposable local database when exercising it. Device checks are in [IPHONE_TEST.md](IPHONE_TEST.md).
