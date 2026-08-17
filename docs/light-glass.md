# Light-mode glass — what the research actually found

You asked me to research the redesign for light mode and work out how to add
glass effects efficiently.

The research ran as a 31-agent workflow: four parallel research angles, two
repo audits, then an adversarial verification pass that tried to **refute**
each proposed change before it could reach the codebase. 78 findings were
produced. 15 got verified before the session limit stopped the run; **13 of
those 15 were refuted**, almost all with a salvageable correction.

That ratio is the headline. The diagnoses were frequently right and the
prescriptions frequently wrong, which is exactly what a verify pass is for.

Alongside it I ran my own pixel-level A/B rig against the live app, because
several of the questions are settled by measurement rather than argument.

---

## First: the premise I gave the research was wrong

I briefed the agents with this open problem:

> "In dark mode, glass reads because the surface is LIGHTER than the ground.
> In light mode a white surface on an alabaster ground has almost nowhere to
> go UP. So what makes a light surface read as glass?"

**This is false, and two independent sources caught it.**

My own measurement, sampling the rendered page 40px clear of every card:

| theme | card | ground | lift |
|---|---|---|---|
| **light** | rgb(254,254,254) | rgb(237,227,224) | **1.247:1** |
| **dark** | rgb(21,21,23) | rgb(27,17,19) | **1.013:1** |

Light mode has **more** separation than dark, not less — the field darkens
alabaster while cards stay near-white. A verifier reached the same conclusion
independently, calling the premise "a linear-Y illusion."

So **dark mode is the tonally flat theme**, and light mode was never the one in
trouble. Any future work on elevation should start there.

---

## The efficiency answer, measured

### The panel blur was invisible, and removing it was correct

Method: render the same viewport twice, change one value, diff the PNGs.

| mode | max delta | mean |
|---|---|---|
| light / Tinted (default) | 4/255 | 1.04 |
| light / Clear | 4/255 | 1.03 |
| dark / Tinted | 2/255 | 1.00 |
| **control — nothing changed** | **3/255** | 1.19 |

The control matters: the rig's own noise floor is 3/255, so every blur result
above sits **at the noise floor**. The blur was not faint, it was absent.

**Why**, and it is not luck: `blur()` only does visible work when there is
high-frequency detail behind the surface. Panels sit on the field, and the
field is deliberately three ellipses at `blur(90px)` — made low-frequency
earlier in this redesign so text contrast could not swing across one panel.
You cannot blur an already-blurred gradient into anything different. **The
property that makes the field safe to put text on is the same property that
makes blurring it pointless.**

The contrast case proves the rule. Same experiment on the **chrome** tier, a
popover over the filter bar: **49/255 across 96.5% of its pixels**. Chrome
floats over real text and rows — high frequency — so its blur earns every
pixel. One verifier put the ratio at 83×.

Shipped: `/content` went from 5 blurring surfaces in the viewport to 0.

### But the backdrop-filter declaration must stay — refuting an unverified finding

Three findings (#35, #36, #74) argued that `blur(0px)` still allocates the
render surface, so `.card` should get `backdrop-filter: none` plus
`isolation: isolate` to restore the stacking context. Those agents died to the
session limit before verification, so I tested it myself:

| substitute | max delta | verdict |
|---|---|---|
| `isolation: isolate` | **150/255** | real regression |
| `contain: paint` | **232/255** | worse — it clips overflow |
| *(noise floor)* | 3/255 | — |

Both fail badly, and the damage is concentrated in the **sidebar**, not in the
cards being changed. I could not establish the mechanism — my containing-block
theory does not survive either, since cards contain zero fixed-position
descendants. **The decision does not depend on the mechanism: the panel
`backdrop-filter` stays as `saturate(180%) blur(0px)`.**

This is the single most important outcome of the exercise. An unverified,
confident, well-argued finding would have shipped a 150/255 regression as a
performance win.

### saturate() stays

Tested in isolation — `saturate(180%)` vs `saturate(100%)`, filter present in
both so the stacking context is constant — the panel saturation measures
7/255 across 8% of pixels. Marginal, above the noise floor, and saturate is far
cheaper than blur. One finding called it a 1/255 no-op; my measurement
disagrees, and mine controls for the confound.

---

## What the verification killed

Recorded because a rejected list is as useful as an accepted one, and every one
of these sounded convincing.

| Proposal | Why it died |
|---|---|
| Add Apple's third filter stage, `brightness()` | Mechanism inverted. Modelled properly, the visible field swing through light chrome **decreases** (13.21 → 12.56 /255). The widely-repeated "add brightness for light glass" advice is wrong on a light ground. |
| Strengthen light-mode shadows toward dark's | Premise backwards — light shadows are already ~12× stronger in *visible presence*. Alpha is not presence: presence is `α · |ground − shadowColor|`. The per-theme split already shipped is right. |
| Tint `--surface` warm instead of pure white | Decision to keep `255 255 255` survives; the reasoning offered for changing it did not. |
| Luminance-adaptive panels | Apple explicitly forbids polarity-flipping on large surfaces. Also unbounded against the gate. |
| "Chroma subtraction" as the light elevation mechanism | Unit error — `max(rgb) − min(rgb)` is not chroma. In CIELAB the effect is ΔC*ab ≈ 5.6, not "19 points". |
| Lower light chrome alpha from 0.82 | Converges back to 0.82 when run through the gate properly, while adding cost. |
| `mix-blend-mode` for vibrancy | Would silently break the gate: `checkGlass` composites a **fixed** foreground hex and never blends it, so any blend mode makes the gate's model diverge from reality. Recorded as a settled non-action. |

**One integrity flag survived and was strengthened.** A set of precise-sounding
Liquid Glass numbers circulating in search results (specific white-overlay
percentages) could not be traced to Apple or to any primary source; one
load-bearing quote turned out to be a MacRumors forum comment presented as
technical documentation. Treat unsourced Liquid Glass numerics as fabricated
until traced.

---

## Findings that survived and are worth acting on

Not yet implemented — listed so the next pass has them.

1. **The specular rim is a measured no-op in light mode.** `--rim`
   `rgb(255 255 255 / 0.55)` moves the panel by ΔL* 0.13. The hairline
   `--rim-line` moves it ΔL* 7.24 — **24× more**. `design-system.md` currently
   claims the rim is "the single detail that most makes a surface read as
   glass"; that is true in dark and false in light, and the doc should say so.
   In Solid mode and under `prefers-reduced-transparency` the light rim delta
   is exactly **0.00**.

2. **The field alphas are per-blob peaks, not a page-wide wash.** Declared 0.16;
   the *median* effective alpha at a viewport pixel is **0.047**. The gate
   models all three blobs stacked — a state the layout cannot actually produce.
   Keep the pessimistic stack as the pass criterion (failing safe), but record
   that it is pessimistic rather than typical.

3. **Clear and Tinted are indistinguishable at light chrome** — 1.6/255 apart
   at the darkest field point, well below JND. The transparency toggle does
   almost nothing in light mode at the chrome tier. Either widen the split or
   say so in the UI.

4. **Dead code, confirmed by audit**: `.glass-chrome` / `.glass-panel` /
   `.glass-data` are referenced by no component — every real surface uses
   `.card` or inline tokens. `--shadow-glass-chrome` is likewise unused.

5. **`.card-interactive:hover` throws the rim away** — it replaces
   `--shadow-glass-panel` wholesale, dropping the `inset` highlight on hover.

6. **`--bg-elevated` equals `--panel` in light mode**, so the elevated tier does
   not exist there; dark mode has a real ladder. `--input-bg` inverts the well
   metaphor in light — a field is *brighter* than the card containing it.

7. **A stale hardcoded red** in the sidebar's active-nav wash matches neither
   accent token — it predates the claret change.

---

## What I would do next, in order

1. Correct the rim claim in `design-system.md` — it is measurably false in light.
2. Delete the three dead tier classes and `--shadow-glass-chrome`.
3. Fix `.card-interactive:hover` to preserve the rim.
4. Fix the stale sidebar red and `--input-bg`'s inverted well.
5. Record in the gate that the 3-blob stack is pessimistic, not typical.

Nothing in that list is a redesign. **Light mode does not need one** — that was
the question I set out to answer, and the measurements answered it no.

---

## Method note

31 agents, 2.6M tokens, 714 tool calls, ~69 minutes. Ten agents (the perf
verification and the final synthesis) were lost to a session limit, so this
document is my synthesis rather than the workflow's. The perf angle's findings
are therefore the **least** verified — which is precisely why I tested its
headline recommendation myself, and why that recommendation turned out to be
wrong.
