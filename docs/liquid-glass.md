# Liquid Glass — what it costs, and what is actually achievable

You asked for the iPhone look, said a complete redesign is acceptable because
this is still a prototype, and asked me to research rather than start building.
This is the research. Nothing here has been implemented.

Everything below was checked against sources in August 2026, and the two
findings that decide the shape of the work are both things you cannot see from
a screenshot.

---

## Finding 1 — the refraction is Chrome-only, and not in any spec

This is the one that matters most, because it is invisible until someone opens
the app in Safari.

What separates Apple's Liquid Glass from ordinary frosted glass is *lensing*:
the material bends what is behind it, brightest at the rim, like the edge of a
real lens. On the web that requires an SVG `feDisplacementMap` applied through
`backdrop-filter: url(#filter)`.

The author of the most complete public implementation is unambiguous about
where that ends:

> "Only Chrome currently supports using SVG filters as `backdrop-filter`, which
> is essential for applying the Liquid Glass effect to UI components"

and adds that the feature "isn't part of the CSS spec."

So the defining optical effect of the look:

| Browser | Refraction | What people see |
|---|---|---|
| Chrome / Edge | yes | the intended look |
| **Safari** | **no** | flat frosted panel, no lensing |
| Firefox | no | flat frosted panel, no lensing |

The irony is worth stating plainly: **the Apple look does not work in Apple's
browser.** For a marketing agency whose staff and clients are heavily iPhone
and Mac, Safari is not an edge case — it is likely the majority of the people
you would be building this for. I have not measured your actual browser split
and would want to before committing; if Safari is over ~20% of sessions, the
premium effect is absent for most viewers while every viewer pays its cost.

There is also a performance note from the same author: dynamic size or shape
changes force a full displacement-map rebuild, which makes the effect expensive
on anything that resizes, animates, or scrolls — hover states, expanding rows,
responsive layout.

---

## Finding 2 — Apple shipped this, took the criticism, and walked it back

Not a matter of taste. A documented sequence:

- **iOS 26** ships Liquid Glass. Complaints follow: legibility problems, eye
  strain over long sessions, poor outdoor readability, and animation lag.
  Accessibility advocates described it as visual noise that increased cognitive
  load during sustained reading.
- **iOS 26.1** adds a **Clear / Tinted** toggle. Tinted "increases opacity while
  adding more contrast" — Apple's own retreat from full transparency.
- **iOS 26.2** goes further still.
- Apple's guidance for the Clear variant over media-rich backgrounds requires a
  **dimming layer** beneath the glass to keep it legible at all.

Two things follow from this, and they point in opposite directions.

The first is a caution: Apple has more design resource than anyone, applied
this to a phone OS — mostly short glances at large touch targets — and still
had to add an escape hatch within a point release. This app is the opposite
case: 293 rows of dense figures that people read all day.

The second is genuinely encouraging, and it is the reason I would not simply
say no. **The version Apple retreated to is almost exactly the version already
built here.** "Increases opacity while adding more contrast" describes the 92%
opacity already in `globals.css`. The dimming layer is the same instinct as
restricting frost to floating chrome. The current system is not a weaker
Liquid Glass — it is the settled one, arrived at independently.

---

## So what is actually achievable

Split the look into its parts, because they do not share a cost.

| Ingredient | Cross-browser? | Cost | Worth it |
|---|---|---|---|
| Blur + `saturate(180%)` | yes | free | **already built** |
| Specular rim highlight (`inset 0 1px 1px rgb(255 255 255 / .5)`) | yes | free | **yes — biggest gain per line** |
| Adaptive tint / dimming layer under glass | yes | small | yes, on overlays |
| Softer, rounder, more continuous corner radii | yes | free | yes |
| Depth via layered shadow rather than borders | yes | free | yes |
| **True refraction / lensing** | **Chrome only** | high | **no** |
| Chromatic aberration at the rim | Chrome only | high | no |

The honest summary: **you can have roughly 85% of the iPhone look, in every
browser, for very little** — and the remaining 15% is the part that only works
in one browser, costs the most, and degrades silently everywhere else.

Most of what reads as "iPhone" in the reference image you sent is not
refraction at all. It is the rim highlight, the corner radii, the shadow
layering, and the restraint of the palette. Those are all free and universal.

---

## What I would build, if you approve

In order of visual return per unit of risk:

1. **Specular rim highlights** on every floating surface — dropdowns, popovers,
   modals, the sticky timer bar, the mobile header. One inset box-shadow. This
   is the single change that most makes a surface read as glass rather than as
   a grey panel.
2. **A dimming scrim** beneath overlay glass, so contrast stops depending on
   what happens to be scrolled behind it. This is Apple's own fix.
3. **Continuous corner radii** — squircle-ish rather than plain rounded.
4. **Deeper shadow layering** on the hero surfaces, replacing borders with
   light.
5. **Stop there.** No SVG displacement.

That keeps every contrast pair in `scripts/contrast-test.mjs` valid, which
matters — the 34-pair test currently passes in both themes and a transparency
change is exactly what silently breaks it.

## What I would want from you before starting

1. **Your browser split.** If Safari is negligible, item 5 becomes arguable and
   I would reconsider refraction on non-scrolling chrome only. If it is not,
   the decision is already made.
2. **Whether the glass should reach cards.** My recommendation is still no, for
   the reasons in `design-system.md` — but you have seen a reference image where
   it does, and it is your product. If you want it on cards, I would want it
   behind a user-level toggle, exactly as Apple ended up doing.

---

## Sources

- kube.io — *Liquid Glass in the Browser: Refraction with CSS and SVG*:
  https://kube.io/blog/liquid-glass-css-svg/
- LogRocket — *How to create Liquid Glass effects with CSS and SVG*:
  https://blog.logrocket.com/how-create-liquid-glass-effects-css-and-svg/
- Engadget — *How to adjust the Liquid Glass effect in iOS 26.1*:
  https://www.engadget.com/mobile/smartphones/how-to-adjust-the-liquid-glass-effect-in-ios-261-203634681.html
- Tom's Guide — *iOS 26.1 lets you adjust Liquid Glass transparency*:
  https://www.tomsguide.com/phones/iphones/ios-26-1-lets-you-adjust-liquid-glass-transparency-on-your-iphone-heres-how-to-do-it
- BGR — *iOS 26.2 Finally Fixed Liquid Glass*:
  https://www.bgr.com/2070522/ios-26-2-fixed-liquid-glass-new-settings-options/
