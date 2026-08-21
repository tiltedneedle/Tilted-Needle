# The confidence engine's first run against real data

2026-08-22. Command: `node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/run-inference.mjs`

## The headline: it found nothing, and that is the correct answer

```
scored posts        350
clients             9
with a transcript   144
sigma               1.685

family              16 registered, 13 ran (>= 3 clients)
BH at q=0.10        0 survive
rows a client would see as "worth acting on": 0
canaries            none fired
```

The engine this replaces would have printed a confident multiplier for nearly
every one of those 13 hypotheses against every one of the 9 clients. Measured
in simulation, it produces a headline from pure noise **86% of the time**. This
one prints nothing, because nothing in this corpus is supported at 350 posts.

That is the deliverable. An analysis engine's hardest requirement is not
finding patterns — it is declining to.

## Full results

| hypothesis | clients | pooled | tau² | I² | p |
|---|---|---|---|---|---|
| `r_length_seconds` | 8 | 0.218 | 0.006 | 13% | 0.0210 |
| `h_cta_present` | 3 | 0.16x | 4.150 | 84% | 0.0410 |
| `h_hook_numeral` | 8 | 0.63x | 0.471 | 44% | 0.0935 |
| `h_posted_before_noon` | 7 | 1.38x | 0.157 | 30% | 0.1549 |
| `h_posted_weekend` | 6 | 1.40x | 0.000 | 0% | 0.1879 |
| `h_hook_second_person` | 6 | 1.19x | 0.000 | 0% | 0.5542 |
| `h_title_question` | 8 | 0.91x | 0.151 | 33% | 0.6227 |
| `h_hook_question` | 5 | 0.88x | 0.000 | 0% | 0.7386 |
| `r_hook_word_count` | 8 | −0.020 | 0.024 | 24% | 0.8366 |
| `h_title_numeral` | 7 | 1.05x | 0.335 | 46% | 0.8386 |
| `r_title_length` | 9 | 0.012 | 0.019 | 40% | 0.8621 |
| `r_time_to_first_noun` | 8 | 0.013 | 0.000 | 0% | 0.8806 |
| `r_words_per_second` | 8 | −0.013 | 0.000 | 0% | 0.8906 |
| `h_hook_greeting` | — | — | — | — | did not run |
| `h_hook_imperative` | — | — | — | — | did not run |
| `h_loop_marker` | — | — | — | — | did not run |

## Four things worth reading out of this

**σ = 1.685, confirming the 1.679 measured a day earlier.** The PRD's
simulations originally assumed 0.8–1.2. At 1.685 every effect is far harder to
detect than the design assumed, which is most of why the table above is empty.
This is not a tuning problem; it is what the data is like.

**The near-misses are near-misses, not suppressed findings.** The smallest p is
0.021. BH at q=0.10 with m=13 requires p ≤ 0.0077 for the smallest of the
family. Uncorrected, `r_length_seconds` would have been reported as
"significant at 0.05" — and with 13 hypotheses in play, one p below 0.05 is
what chance produces.

**`h_cta_present` has I² = 84% and τ² = 4.15.** Three clients contributed and
they violently disagree about calls to action. Had this cleared BH it would
still have been suppressed as `mixed`, because a pooled average across clients
pointing in opposite directions is not advice — it is a number that would harm
whichever clients sit on the wrong side of it.

**Three hypotheses could not run at all**, having fewer than 3 clients with both
sides populated: `h_hook_greeting` (only 4 of 185 videos open with a greeting),
`h_loop_marker` (9), and `h_hook_imperative` (0 — nobody in this library opens
with a command). They are excluded from `m`, so they cost the surviving
hypotheses nothing.

## What would change this

Coverage, not tuning. 144 of 350 scored posts carry a transcript, so the eleven
transcript-derived hypotheses run on 41% of the library. The ASR lane is
draining that backlog now. Nothing here should be relaxed to produce findings —
the thresholds are what stop the engine from repeating its predecessor's 86%
noise rate.
