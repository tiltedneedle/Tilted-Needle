# Design system — understated luxury

The brief: sophisticated, refined, impeccably crafted; wealth communicated
through restraint and precision rather than through spectacle. This records
what was decided, what was measured, and what is deliberately *not* here.

---

## The governing rule

**Restraint is a rule, not a mood.** Concretely:

- The accent appears on primary actions, live metrics, and the active nav item.
  Nowhere else. A second red on a screen halves the meaning of the first.
- Weight is 600, never 700. Bold is the loudest lever in typography, and this
  product does not raise its voice.
- Colour is withheld until it means something. A dashboard that tints every
  card is one where nothing is urgent.
- Depth is a hairline and a shallow contact shadow. Never a glow.

---

## Glassmorphism — evaluated, then limited

You asked whether a glass look would suit the system. **Partly, and only on
chrome.** The research is unambiguous: content-dense interfaces — data tables
especially — are the worst possible fit, because text over a translucent
surface has a contrast ratio that changes with whatever scrolls behind it.
This app is 293 rows of dense data.

So frosted surfaces are applied to things that *float above* content and
benefit from letting it through:

| Frosted | Never frosted |
|---|---|
| Popovers and dropdowns | Cards |
| The sticky timer bar | Tables and list rows |
| The mobile header | Anything holding a number |

Two details that separate this from the version that photographs well and
fails in use:

- **92% opacity, not 65%.** Below ~90 the contrast of text over a scrolling
  list depends on what happens to be behind it at that moment. A contrast
  ratio you cannot predict is one you cannot claim.
- **`saturate(180%)` with the blur.** `backdrop-filter` averages colour toward
  neutral; pushing saturation back up is the difference between frosted glass
  and smudged perspex.

---

## Colour

**Two reds, and the reason is measured rather than aesthetic.** A red bright
enough to read as text on near-black (`#e5484d`, 5.06:1) carries white text at
only 3.91:1 — a fail. A red dark enough for white text (`#d92d38`, 4.79:1)
disappears against a dark page. So each theme takes the one that works:

- **Light:** white on deep red
- **Dark:** near-black on bright red

Dark-on-bright is also simply what an expensive dark interface does with a
saturated accent.

**All 34 text/surface pairs are checked by script across both themes.** The
first run reported six failures, including two pre-existing ones nobody had
measured: the old success green (4.34:1) and amber (4.39:1) on white. It now
reports none.

### The sidebar needed its own tokens

It is a dark surface in **both** themes, so `--fg` would be dark-on-dark in
light mode. It worked until now only because the colour was hardcoded to
white. It now carries `--sidebar-fg`, `--sidebar-muted` and `--sidebar-accent`
— the last being the *bright* red, because the deep one measures 4.13:1
against near-black.

---

## Depth

Two stacked shadows rather than one: a tight contact shadow under a wide
diffuse one reads as an object resting on a surface, where a single soft blur
reads as a glow.

In dark mode the diffuse half does nothing against near-black, so elevation is
carried by a **lightness ladder** instead — page → card → elevated → hover,
each a few points up. That is how premium dark interfaces signal height, and
it is why the neutral scale starts at `#0a0a0b` rather than pure black: `#000`
leaves nowhere to go, and the first step above it already looks grey.

---

## Type

- **Inter** for the interface. Drawn for small sizes, and neutral enough to
  disappear — which is the point. Plus Jakarta Sans has rounder shapes that
  read as *startup product* rather than as an instrument.
- **Instrument Serif** for display numerals **and nothing else**. A serif makes
  a figure look composed rather than merely large. In a table it would stop
  being a signal and become a theme.
- Headings at 600 with −0.021em optical tracking; the larger the type, the
  tighter it wants to be.

Radii tightened from 12/20 to **10/14**. A 20px corner is consumer-app soft.
Nested elements take ~4px less than their parent or the two curves fight.

---

## Chart colour — validated, not assumed

Platform brand colours were treated as exempt from the design rules on the
grounds that a platform's colour is *data*. That is true of **identity** and
false of a **chart mark**, and running the palette validator rather than
reasoning about it made the difference obvious:

```
[FAIL] Lightness band   outside band: [["#00f2ea", 0.868]]
```

TikTok's brand cyan is measurably too light for a dark surface. It was the
brightest thing on the home page, pulling the eye off every other series.

So the two jobs are two constants:

| Constant | Used for | TikTok |
|---|---|---|
| `PLATFORM_COLORS` | dots, chips, icons — identity | `#00f2ea` (brand) |
| `CHART_COLORS` | lines, bars, meters — marks | `#1aa9a3` (validated) |

A 6px dot at any lightness is recognisable and comfortable; a 200px line is
not. YouTube and Instagram passed unaltered, so a chart still reads as the
platform it describes.

On white the new teal lands at **2.9:1 against a 3:1 bar**. That WARN is
discharged rather than waved through — the checker permits it where charts
carry visible labels, and every chart here is directly labelled. Darkening
further to win the point outright **fails the chroma floor** instead, and the
teal starts reading grey.

## Regression check

The risk this pass carried: bigger type, a 30px serif, wider tracking and more
padding are each capable of pushing a layout back over the edge fixed earlier.

**24 routes swept at 360px with phone emulation — zero overflow, zero clipped
elements.** The token architecture held.

---

## Needs your attention

Nothing here is blocking, but these are judgement calls you may want to
overrule:

1. **The serif numerals are the most opinionated choice in the set.** They are
   what makes the dashboards look composed rather than merely tidy, and they
   are also the first thing to remove if you dislike it — one class, one file.
2. **Light mode is no longer cream.** It is paper white with hairline rules,
   which reads as stationery rather than as a friendly product. This is a
   real change of character, not just a palette swap.
3. **`OPERATING_TZ` is still unset in Vercel**, so `/data` shows a red drift
   banner until it is. Unrelated to design, but visible.
4. **Charts still use platform brand colours** (TikTok cyan, Instagram pink).
   They are deliberately exempt from the one-accent rule — a platform's colour
   is data, not decoration — but it does mean the momentum row is the most
   colourful thing on the home page.

---

## What was left alone, on purpose

- **Platform brand colours**, per above.
- **Status colours** (success/warning/danger/info). They are semantic; making
  them all red for brand consistency would destroy the meaning.
- **Density.** This is an instrument used all day. Generous whitespace was
  added between *sections* and inside cards, not between rows — a list of 293
  videos that needs twice the scrolling is worse, not more luxurious.
