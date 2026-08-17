# Redesign PRD — Glass, done properly

**Status:** proposal, awaiting approval. Nothing in here is built.
**Brief:** full glassmorphism, blur and all, at its best; palette my call, luxury.

---

## 1. Why the current glass reads as grey

The app already has `--glass-bg` at 92% opacity and `blur(20px)`. That is not a
weak version of the look you want — it is a *different* look, and the reason is
one line in `globals.css`:

```css
--bg: var(--ink-50);   /* a flat colour */
```

**Glass is a lens. A lens over a flat surface shows a flat surface.** At 92%
opacity there is almost nothing behind to admit, and `saturate(180%)` has no
colour to amplify. Every ingredient of the effect is present and every one of
them has nothing to act on.

So the headline change is not a blur value. It is that **the app needs a
background worth looking through**, and everything else follows from that.

---

## 2. The four constraints the design must satisfy

Each of these is a measured finding, not a preference. They are what separate a
glass UI that survives daily use from one that photographs well.

### 2.1 Blur must go UP as the background gets richer

Nielsen Norman Group's guidance is specific and runs opposite to instinct:

> "more background blur is better, especially with intricate backgrounds"

with 25px/30% giving "somewhat distinguishable edges" and 100px rendering the
backdrop properly out of focus. Their alternative is explicit: use "simple or
single-color backgrounds", *or* apply enough blur to survive "many possible
backgrounds on which the item may appear."

We are choosing a rich background, so we owe it heavier blur. **20px is not
enough once there is something behind it.**

### 2.2 The background must be low-frequency

The corollary nobody states but everything depends on. Text contrast over glass
varies with whatever sits behind that particular glyph. A busy background makes
contrast *unpredictable across a single panel* — the failure mode from the
original design-system research, and unfixable by blur alone at the edges.

So: **large, soft, slow gradients only.** No imagery, no noise, no patterns, no
high-frequency detail anywhere a panel can land. Rich in hue, flat in detail.

### 2.3 Blur count is a hard budget, not a style choice

Blur is the most expensive filter — every output pixel samples a wide kernel of
neighbours — and `backdrop-filter` is heavier still because it must read what is
behind. Mobile handles **3–5 simultaneous blurs**; stacking full-viewport glass
drops frames on mid-range Android.

This app renders **293 content rows**. Glass per row is 293 blurs and is simply
not available. shadcn/ui hit this exact wall (issue #327).

**Rule: glass belongs to containers, never to repeated children.** One glass
panel holding 293 opaque rows costs one blur. This is also better design — see
§4.

### 2.4 A transparency control is required, not optional

NN/g asks for it. Apple was forced into it: iOS 26.1 added a **Clear / Tinted**
toggle after sustained accessibility criticism, where Tinted "increases opacity
while adding more contrast", and 26.2 went further.

If Apple could not ship uniform glass without an escape hatch, neither can we.
This is a **P0 deliverable**, not a nice-to-have.

---

## 3. The palette

2026 luxury research is consistent on three points: three-to-five colours
maximum, muted or jewel tones over bright ones, and a metallic accent
referencing a real material. It is also consistent that **ebony-and-gold now
reads as dated** — the movement is toward jewel hues and soft smoke.

So: not black-and-gold. **Obsidian, garnet, and champagne, over a jewel-toned
field.**

### 3.1 Core

| Token | Value | Role |
|---|---|---|
| `--obsidian` | `#0a0a0b` | true base — already `--ink-950`, unchanged |
| `--garnet-600` | `#9b1c2e` | brand, deep |
| `--garnet-500` | `#c02338` | brand, primary action |
| `--garnet-400` | `#e5484d` | brand, bright — today's `--red-bright` |
| `--champagne-300` | `#d9c9a3` | metallic: rim light, hairlines |
| `--champagne-200` | `#eadfc4` | metallic, light mode |
| `--alabaster` | `#f7f5f1` | light-mode base — warm, not white |

The red already in the product moves **from alert-red toward garnet**. Today
`--accent` is `#d92d38`, which is within a hair of `--danger-500` `#c92a34`.
Brand and danger being the same colour is a real defect: a destructive button
and a primary button should never be the same hue. Garnet separates them.

### 3.2 The metallic does double duty

This is the neatest part of the scheme. Liquid Glass needs a **specular rim
highlight** — the bright hairline along a glass edge — and it is the single
detail that most makes a surface read as glass rather than as a grey panel.
Luxury design wants a **metallic accent**. They are the same pixel:

```css
--glass-rim: linear-gradient(
  to bottom,
  color-mix(in srgb, var(--champagne-300) 55%, transparent),
  transparent 40%
);
```

One token satisfies both requirements. It is also cross-browser and free —
unlike refraction (see §7).

### 3.3 The background field

Three blobs, fixed, behind everything, `filter: blur(90px)` so no edge can ever
be resolved:

| Blob | Dark mode | Light mode |
|---|---|---|
| A (top-left) | garnet `#9b1c2e` @ 18% | garnet @ 7% |
| B (right) | deep plum `#3b1e46` @ 16% | plum @ 5% |
| C (bottom) | deep teal `#0e3b45` @ 14% | teal @ 5% |

The teal is doing real work: `saturate(180%)` amplifies whatever hue it finds,
and a field of only warm reds saturates into something closer to raw meat than
to luxury. A cool counterpoint keeps the amplified result balanced. It is also
what stops the whole app reading as a single red wash.

Light mode uses the same three hues at roughly a third of the opacity over
alabaster — the *same* design, not a separate one, which is what keeps two
themes from drifting into two products.

---

## 4. The material hierarchy

Three tiers. A surface's tier is decided by **what it holds**, never by how
important it is.

| Tier | Opacity | Blur | Applies to |
|---|---|---|---|
| **Chrome** | 72% | 40px | sidebar, top bar, dropdowns, popovers, modals, sticky timer bar, toasts |
| **Panel** | 84% | 28px | stat/KPI cards, section containers, chart frames, the container around a table |
| **Data** | 96% | none | table rows, list rows, anything holding a number, chart plot areas |

The industry guidance matches exactly: put frost on navigation chrome and KPI
cards, keep data-dense surfaces near-opaque, because "tables, small numbers and
tight chart axes need a solid backing or the blur halos every glyph."

**Why this is more glass than it sounds.** The Data tier sits *inside* a Panel
which floats over the field. Someone looking at the app sees glass everywhere —
the sidebar, every card, every panel edge, every menu. What they never see is a
number sitting directly on a moving gradient. §2.3 is satisfied for free:
containers blur, contents do not.

Per-viewport blur budget: **≤5**. Sidebar + top bar + up to three panels in
view. Enforced by review, not by hope.

---

## 5. Depth

Glass without correct light is plastic. Every glass surface gets three layers:

```css
box-shadow:
  inset 0 1px 0 rgb(255 255 255 / .09),   /* specular rim -- see 3.2 */
  0 1px 2px rgb(0 0 0 / .28),             /* contact shadow */
  0 12px 32px -8px rgb(0 0 0 / .38);      /* ambient lift */
```

- **Contact + ambient, not one shadow.** A single shadow reads as a sticker; the
  tight dark one anchors the surface and the wide soft one gives it height.
- **Borders become light, not lines.** `--glass-border` drops to a near-invisible
  `rgb(255 255 255 / .07)` and the rim highlight does the defining. Hairline
  borders on a translucent surface are the most common tell of cheap glass.
- **Radii go up and continuous:** `--radius-sm` 10→**12px**, `--radius-md`
  14→**18px**, chrome **22px**. Larger radii are most of what reads as "iPhone"
  in the reference you sent — far more than refraction does.

---

## 6. Accessibility — the part that makes this shippable

Non-negotiable, and the reason this proposal can be defended rather than merely
liked.

### 6.1 The transparency setting (P0)

A three-way control in Settings, mirroring Apple's own retreat:

| Mode | Behaviour |
|---|---|
| **Clear** | as specified above |
| **Tinted** *(default)* | opacity +12pts on every tier, blur −8px |
| **Solid** | glass off entirely; tiers become flat `--panel` |

Plus automatic honouring of `prefers-reduced-transparency` and
`prefers-contrast: more` → Solid. Stored per user, alongside the existing
timezone preference so it needs no new plumbing.

**Tinted is the default deliberately.** It is where Apple landed after shipping
Clear to a billion devices. Clear is available for anyone who wants the full
effect on their own screen.

### 6.2 The contrast test has to change

`scripts/contrast-test.mjs` currently checks 34 pairs against **solid**
backgrounds. Over glass that is no longer a valid model: the effective
background is a composite of the field, the blob under that point, and the
glass tint.

The script must be extended to compute the composite and test each text token
against **the brightest and the darkest point of the field**, in all three
transparency modes, in both themes. A pair passes only if it clears **4.5:1 at
both extremes** — because a contrast ratio that depends on scroll position is
not a contrast ratio.

This is the single largest engineering item in the redesign and the one most
likely to force a token back toward opacity. That is the correct outcome: it
means the number is decided by measurement rather than by taste.

### 6.3 Motion

The field is **static**. No drifting blobs, no animated mesh. Sustained
peripheral motion under a page people read for hours is precisely the "cognitive
drag" complaint iOS 26 drew. It also costs a repaint per frame across the whole
viewport, which §2.3 does not have room for.

---

## 7. Explicitly out of scope

**True refraction / lensing.** Requires `backdrop-filter: url(#svg-filter)` with
an `feDisplacementMap`. Chrome-only, not in the CSS spec, silently absent in
Safari and Firefox, and it rebuilds the displacement map on every size change —
so it costs most on hover, expand, scroll and reflow.

For a marketing agency on iPhones and Macs, it would be absent for most viewers
while every viewer paid for it. The rim highlight, radii and shadow layering in
§3.2 and §5 deliver most of what reads as "iPhone" anyway, in every browser, for
free. Full reasoning in [liquid-glass.md](liquid-glass.md).

Also out: chromatic aberration, animated mesh, glass on table rows.

---

## 8. Delivery plan

Sequenced so the risky measurement happens before the wide rollout, not after.

| # | Work | Why here |
|---|---|---|
| 1 | Background field + palette tokens | Everything else is invisible without it |
| 2 | Extend `contrast-test.mjs` to composite backgrounds | **Before** any surface converts — this is what sets the real opacity numbers |
| 3 | Transparency setting + `prefers-reduced-transparency` | Ships with the first glass surface, never after |
| 4 | Chrome tier: sidebar, top bar, dropdowns, modals, toasts | Highest visual return; already glass today, so lowest risk |
| 5 | Panel tier: stat cards, section and chart containers | The step that makes it read as a glass *product* |
| 6 | Depth pass: rim, two-layer shadows, radii | Cheap, and where the luxury actually lands |
| 7 | Re-run the 360px overflow audit + contrast gate | Radii and padding changes move layout |
| 8 | Light mode parity pass | Same design at lower opacity, not a second design |

Steps 1–3 are the foundation; if the composite contrast test at step 2 forces
higher opacities than §4 assumes, **the numbers in §4 change and this document
is wrong** — which is why it is step 2 and not step 8.

---

## 9. What I need from you

1. **Approve or adjust the palette.** Garnet + champagne over jewel-toned field,
   moving the brand red away from alert-red. This is the one genuinely
   subjective call in the document.
2. **Confirm Tinted as the default.** Clear looks better in a screenshot;
   Tinted is what people can use all day. I recommend Tinted.
3. **Confirm glass on stat cards.** It is the tier that makes this read as a
   redesign rather than a polish pass, and it is the only tier where I am
   trading a little legibility for a lot of character.

---

## Sources

- Nielsen Norman Group, *Glassmorphism: Definition and Best Practices* —
  https://www.nngroup.com/articles/glassmorphism/
- Superdesign, *Glassmorphism Dashboard* —
  https://superdesign.dev/styles/glassmorphism/dashboard
- Empire UI, *backdrop-filter: blur, brightness, saturate and when to use each* —
  https://empire-ui.com/blog/backdrop-filter-css
- shadcn/ui issue #327, *CSS backdrop filter causing performance issues* —
  https://github.com/shadcn-ui/ui/issues/327
- Engadget, *How to adjust the Liquid Glass effect in iOS 26.1* —
  https://www.engadget.com/mobile/smartphones/how-to-adjust-the-liquid-glass-effect-in-ios-261-203634681.html
- Design Work Life, *9 Luxury Color Palettes That Capture High-End Design in 2026* —
  https://designworklife.com/luxury-color-palettes/
- Zoviz, *Luxury Color Palette Guide 2026* —
  https://zoviz.com/blog/luxury-brand-colors-meanings
- kube.io, *Liquid Glass in the Browser* —
  https://kube.io/blog/liquid-glass-css-svg/
