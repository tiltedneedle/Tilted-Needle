# Song identity — which API, and why

The goal: a song used on two videos is recorded as **the same song**, so the
future "why did this trend" engine is working from clean data rather than
spelling variants.

Everything below was tested against the live APIs on 14 Aug 2026, not taken
from documentation or blog posts. Several widely-repeated recommendations did
not survive contact.

---

## The answer

**Deezer to search · ISRC as the key · MusicBrainz to resolve · AcousticBrainz
for features.** All free, no API key, no OAuth. Total cost **£0**.

```
person types  →  Deezer search        (free, no auth, fails honestly)
person picks  →  store ISRC + our own song id
   later      →  MusicBrainz /isrc/   (free, no key)  →  ONE recording MBID
   later      →  AcousticBrainz dump  (free, offline) →  BPM, key, energy…
```

---

## Spotify is out, on three independent counts

1. **Audio features are permanently deprecated** (27 Nov 2024) for any app
   created since — tempo, energy, danceability, valence, key. That is exactly
   what the trending engine would want.
2. **May 2025:** extended access requires **250,000 monthly active users**.
3. **February 2026:** Spotify is moving away from the Client Credentials flow
   for metadata, and Development Mode now requires a **Premium account**.

The third also collides with this project's hard *no-OAuth* rule, which is
enforced by a schema constraint. Spotify is not a close call.

---

## The finding that changed the design

The obvious plan — "look the song up in MusicBrainz and store the MBID" — is
wrong in two ways that only appear when you actually run it.

### 1. MusicBrainz recording MBIDs fragment

A search for *Blinding Lights / The Weeknd* returns **30 recording MBIDs**,
three of them scoring 100%. Recordings are per-master, per-remaster, per-live
version. Keying on one would move the fragmentation from strings to UUIDs
rather than removing it.

Works are the better level — two of those three shared work
`04ccb6fa-84ed-49fe-94ae-15050bb86b91` — but the third had **no work link at
all**, so work coverage is incomplete.

### 2. MusicBrainz returns 100% confidence for nonsense

This is the serious one. Its score is a Lucene relevance score normalised to
the result set, **not** a confidence measure. Live results:

| query | MusicBrainz | Deezer |
|---|---|---|
| `zzzqqq nonexistent track xyzzy 9999` | **100%** "XYZZY — Paul Nagle" | no match |
| `the quickest corporate jet deal` | **100%** "The Quickest — Lil Cuete" | no match |
| `Hay fever doesnt just affect your nose` | **100%** "Your Hay Fever — Empty Set" | no match |
| `original sound - yusufnik8` | **100%** "Original Sound — Aether" | no match |

The middle two are **real video titles from this system** — precisely what
somebody would paste into a song field by accident.

Any auto-matching pipeline built on that score produces confidently wrong data
at scale, which is worse than free text, because free text at least *looks*
uncertain. **Deezer fails honestly**, returning nothing rather than a wrong
answer, and that single property is why it wins the search role.

---

## ISRC is the key, not a vendor id

The International Standard Recording Code is the actual industry identifier for
a recording, and it is what makes the chain work. Verified live:

- Deezer's `/track/{id}` exposes `isrc` — `USUG11904206` for Blinding Lights
- MusicBrainz `/ws/2/isrc/USUG11904206` returns **exactly one** recording MBID

So the same lookup that returns 30 ambiguous results by *name* returns one
unambiguous result by *ISRC*. That MBID is the join key into the AcousticBrainz
dump.

Deezer also returns **BPM** (170.84) and duration directly, so one audio
feature arrives free at pick time with no second call.

---

## Why our own primary key anyway

The `songs` table gets its own UUID. ISRC, Deezer id and MBID are **columns on
it, not the key**:

- A song can legitimately have several ISRCs (re-releases, regional issues)
- Non-catalogue audio has **no** ISRC at all, and still needs a row
- It keeps us off any single vendor's terms of service

---

## "Original sound" is a category, not a failure

A large share of social video audio is original, unlicensed, or a sped-up edit
that exists in no catalogue. Deezer correctly returns nothing for
`original sound - yusufnik8`.

That must be a **first-class value**, not a null. If the trending engine sees
40% of rows as missing data it will treat them as noise, when "this used
original audio" is very likely a real predictor.

---

## The future engine, and why this matters now

AcousticBrainz shut down in 2022, but its dump is still downloadable: **~7
million deduplicated recordings keyed by MusicBrainz ID**, zstd-compressed
across 30 archives, with BPM, key, energy, danceability and mood vectors.

Because it is keyed by MBID, and ISRC resolves to exactly one MBID, **storing
the ISRC today buys the entire feature set later — offline, free, no API.**
Anything the dump misses can be analysed with **Essentia**, the open-source
toolkit Spotify itself used to derive those values, on the Oracle box at
compute cost only.

Store only a song name today and every one of those joins has to be
re-litigated later against an API that confidently mismatches.

---

## Paid options, and why none is worth it

| Service | What it offers | Verdict |
|---|---|---|
| **ReccoBeats** | Most-cited drop-in for audio features | Methodology undocumented, unbenchmarked — a poor foundation for a system meant to *explain* results |
| **Cyanite.ai** | Strong AI tagging, mood/genre | Real product; unnecessary while AcousticBrainz + Essentia cover it free |
| **AudD / ACRCloud** | Audio **fingerprinting** from a clip | Solves a different problem — identifying a song from audio we do not have |
| **Apple Music API** | Full catalogue | Needs a paid developer account and JWT auth |

Fingerprinting is worth revisiting only if you ever want to identify the song
from the video file itself. Nothing here needs it, because a person is choosing
the track at the point they log the video.

---

## Rate limits

- **Deezer** — no key, generous; a type-ahead should still debounce ~300ms
- **MusicBrainz** — ~1 request/second per IP, and it **requires** a descriptive
  User-Agent. Fine, because the ISRC lookup happens once per song ever, not per
  video, and it can be deferred to the background worker rather than blocking
  the picker

---

## Proposed shape

```
songs
  id            uuid pk          -- ours
  title         text
  artist        text
  isrc          text unique      -- the real key, nullable
  deezer_id     bigint
  mb_recording  uuid             -- resolved from ISRC, later
  bpm           numeric          -- free from Deezer at pick time
  duration_sec  int
  kind          text             -- 'catalogue' | 'original' | 'unknown'

content_items.song_id  uuid → songs.id
```

`music_used` stays as the free-text human label so nothing is lost, and the
foreign key carries the identity.

**Timing note:** `music_used` is currently empty on all 463 videos. Doing this
before any data exists avoids ever having to reconcile free text — which is the
expensive version of this problem.
