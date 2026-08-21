# Measured baseline, 2026-08-21

Numbers the content-intelligence PRD is built on. All measured against the
live workspace, not estimated. Reproduce with `scripts/_tmp-power.mjs`
(deleted after use — the queries are in this file's history).

## Corpus

| | |
|---|---|
| videos | 564 |
| platform posts | 564 (exactly one per video; nothing cross-posted) |
| post_snapshots | 5,254 |
| clients (live) | 13 — largest 100 videos, **median 39** |
| platforms | TikTok, Instagram, YouTube, YouTube Shorts |

## Coverage of the inputs analysis needs

| input | coverage |
|---|---|
| transcripts | 115 of 564 videos — **20%** |
| comments | 34 of 564 posts — **6%** (2,093 rows) |
| scored by the perf model | 350 of 564 — **62%** |
| AI output stored | 20 comment_themes, 1 weekly_read |

Transcripts and comments are the two inputs every interesting question
depends on, and both are mostly absent. No amount of analytical rigour
compensates for that, which is why coverage is phase one.

## The confidence problem, quantified

The current engine tests the same handful of splits for every client:
weekend vs weekday, longer vs shorter than the client's median, title
contains a number, published before noon. Subgroup sizes, per client, over
videos that are actually scored:

| client | scored | weekend / weekday | longer / shorter | number / none | smallest subgroup |
|---|---|---|---|---|---|
| Tilted Needle Team | 60 | 24 / 31 | 16 / 44 | 12 / 48 | 12 |
| EuroEyes Deutschland | 68 | **1** / 63 | 23 / 45 | 10 / 58 | **1** |
| Ameerh Naran | 47 | 8 / 37 | 20 / 27 | 7 / 40 | 7 |
| Euro Eyes London (LEC) | 41 | **0** / 38 | 13 / 28 | 7 / 34 | **0** |
| The Jet Business | 36 | 11 / 25 | 11 / 25 | 10 / 26 | 10 |
| yusufnik8 | 32 | 7 / 25 | 10 / 22 | 4 / 28 | 4 |
| Tilted Needle | 29 | 5 / 24 | 8 / 21 | **3** / 26 | 3 |
| Entree Bakery and Cafe | 25 | 8 / 17 | 7 / 18 | **2** / 23 | 2 |
| Alex Evagora | 12 | **0** / 12 | 1 / 11 | **0** / 12 | 0 |

**16 of 54 subgroups (30%) have fewer than 10 members.** Four are 0 or 1,
where the split does not exist at all.

This is not hypothetical. A real stored finding read:

> "Videos with titles containing a number have a median boost of 0.396x,
> compared to 0.674x for those without, based on 3 analyses."

Three videos. Reported in the same voice, and at the same apparent
confidence, as a finding resting on sixty.

Three separate faults compound here:

1. **No floor.** A split with 0 or 1 members on one side is reported rather
   than refused.
2. **No multiple-comparison control.** Four-plus splits are tested per
   client, for 13 clients, refreshed weekly. At a nominal 5% false-positive
   rate that is roughly 2-3 spurious findings per refresh across the
   workspace, indistinguishable from the real ones.
3. **No interval.** A median ratio with no dispersion and no sample size
   cannot be acted on, because nothing tells the reader whether 0.396 versus
   0.674 is a real gap or two noisy numbers.

## What this implies for the design

- A minimum subgroup size is not a nicety; 30% of current splits fail it.
- The engine must be able to return **nothing** for a client, and say why,
  without that reading as a malfunction. Alex Evagora, at 12 scored videos
  with two undefined splits, is a client where the honest output is "not
  enough work yet".
- Any claim shown to a user needs sample size and an interval attached, in
  words a marketer can act on.

## Corpus size, for cost arithmetic

Measured on what exists, then extrapolated to all 564 videos at the same
rate.

| | measured | extrapolated to 564 |
|---|---|---|
| transcript text | 972,534 chars over 115 videos (~243k tokens) | **~1.19M tokens** |
| comments | 2,093 rows over 34 posts, avg 62/post (~160k chars) | **~34,700 comments, ~665k tokens** |

Median transcript is 1,630 characters — roughly 400 tokens, or a minute of
speech. One outlier runs 99,785 characters, so any per-video prompt needs a
cap rather than assuming the median.

The practical consequence: embedding the **entire** corpus, transcripts and
comments together, is under two million tokens. At text-embedding-3-small
rates that is **about four cents**. Retrieval is not the expensive part of
this system and should not be designed as if it were.

## The performance history is thinner than the video count suggests

| | |
|---|---|
| snapshots | 5,254 |
| median per post | **3** |
| posts with >= 3 snapshots | 329 of 564 |

`MIN_POSTS_TO_RANK` is 3, and the median post has exactly 3 readings. So
scoring sits right on its own floor: 235 posts do not have enough history to
be scored at all, which is most of the gap between 564 videos and the 350
that carry a score.

This matters more than it looks. A "trend over time" needs repeated readings
per post, and half the corpus has barely enough for a single score. Any
trend design that assumes a dense time series per video is designing for
data this system does not have.
