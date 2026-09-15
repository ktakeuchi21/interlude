# Contributing

Interlude is a personal project, with no promised release schedule or support SLA. Small, clearly explained issues and changes are easiest to review. Please discuss major changes first.

## Work locally

Follow [Setup](docs/SETUP.md), use Node 24, preserve the lockfile, and run the documented checks. Tests use synthetic data. Never commit a key, service-account JSON, database, learning export, audio file or owner-specific publication.

## Design constraints

Keep sessions finite and the next useful action obvious. Preserve old lesson versions and user work. Count learning separately from completion. Keep narration and runtime API accounting separate. An unknown provider outcome must not become an automatic retry or a cleared reservation.

For changed behavior, explain the concrete trigger, the resulting behavior and relevant validation. Schema changes require a new reviewed migration. Authentication changes must account for the trusted dispatcher and local-only test fixture.

## Source-based teaching

Cite inspected primary sources. Distinguish original examples from reported outcomes. Preserve evidence dates and exact version references. Do not upload full third-party articles or private source captures with a contribution.

## Reporting

Use issues for reproducible non-sensitive problems and feature ideas. Do not post credentials, learning exports or private logs. See [SECURITY.md](SECURITY.md) for security concerns. The repository currently has no general license for its original code or lesson text; do not assume publication grants broader reuse rights.
