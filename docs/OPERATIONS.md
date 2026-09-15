# Operations and cost controls

## Application limits

| Resource | Implemented guard |
| --- | --- |
| OpenAI API commitments | $8 per UTC calendar month |
| Chirp narration | 900,000 conservative UTF-8 bytes in a rolling 32-day window |
| Audio storage | 2 GB of committed or reserved bytes |
| Concurrent generation | One fenced claim, with a ten-minute expiry |
| Selected listening queue | At most three lessons |
| Spoken input | Up to 30 seconds per recording |

These limits describe the code, not provider invoices. They do not include all infrastructure costs or other applications using the same account. Review provider pricing and the source's dated pricing assumptions before enabling paid work. A stale or unknown rate can intentionally stop generation.

OpenAI accounting uses integer millionths of a dollar, conditional SQL reservations, stable operation IDs, and retained evidence. Held and uncertain work counts toward the cap. Saved output can reconcile an interrupted operation without resending it. Owner-entered cost evidence is recorded separately from estimates and can become stale when the underlying record changes.

Google usage is a separate ledger. The byte count intentionally overestimates character count for some text. A rolling 32-day window is conservative across calendar-month boundaries; it is not Google's billing-period definition. Replaying stored audio never synthesizes it again.

## Audio recovery

Each job pins its input, voice, segment identities, and storage paths. Returned audio must pass PCM/WAV validation before it is saved. Both recovery segments and the final WAV count toward storage; assembly streams the saved segments.

If work times out:

1. Check Settings for a running or expired preparation.
2. Once expired, release the preparation. This fences old work; it does not clear usage.
3. Use **Check saved lesson audio** for the interrupted lesson, or the appropriate preview recovery control.
4. If matching stored segments exist, recover them without another provider call.
5. If a segment has no saved result, retain its usage and investigate. The current Chirp flow does not automatically retry or provide a completed replacement-authorization workflow.

The older OpenAI narration ledger has a separate reviewed replacement mechanism. Do not assume it applies to Chirp. Do not change a missing result to “complete,” erase its reservation, or switch providers to bypass the hold.

## Weekly maintenance

The plan-based workflow is described in [WEEKLY_PLAN_REFRESH.md](WEEKLY_PLAN_REFRESH.md). It prepares a finite set and examines at most one due lesson. The optional manual in-app API workflow is separate and can incur API usage.

## Data ownership and exports

D1 contains lesson versions, progress, notes, exercises, source evidence, jobs and accounting. R2 contains private stored artifacts. The Settings export provides learning data and saved lesson content; it is not a backup of every audio blob or deployment secret.

Keep exports and provider billing records outside public source control. No production database, activity record, cost history or audio file is distributed in this repository.
