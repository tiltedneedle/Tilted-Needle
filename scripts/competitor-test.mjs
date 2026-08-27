// Competitor handle normalisation and per-competitor relative indexing.
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/competitor-test.mjs
import { normaliseHandle } from "../src/lib/analysis/competitors.ts";
import { relativeIndex, topByRelative, MIN_POSTS_FOR_BASELINE } from "../src/lib/analysis/competitors.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

/* ---- Handles -------------------------------------------------------------
   The unique constraint is (client, platform, handle). If normalisation is
   inconsistent then "@Foo", "foo" and a pasted profile URL are three rows for
   one rival, and every count computed over them is wrong. */
{
  const same = ["foo", "@foo", "@FOO", "  @Foo  ", "Foo"];
  check("case and @ collapse to one handle",
    new Set(same.map(normaliseHandle)).size === 1,
    same.map(normaliseHandle).join("|"));

  check("a tiktok profile url reduces to the handle",
    normaliseHandle("https://www.tiktok.com/@ameerhnaran") === "ameerhnaran");
  check("an instagram url reduces to the handle",
    normaliseHandle("https://www.instagram.com/ameerhnaran/") === "ameerhnaran");
  check("a url with a trailing section still reduces",
    normaliseHandle("https://www.instagram.com/ameerhnaran/reels/") === "ameerhnaran");
  check("query strings are stripped",
    normaliseHandle("https://www.tiktok.com/@foo?lang=en") === "foo");
  check("a youtube handle url reduces",
    normaliseHandle("https://youtube.com/@SomeChannel") === "somechannel");
  check("empty input stays empty", normaliseHandle("") === "" && normaliseHandle("   ") === "");
}

/* ---- Relative index ------------------------------------------------------
   The point of the whole feature. Raw views across accounts measure audience
   size; only a ratio against the account's OWN median says anything about the
   video. */
{
  const posts = [
    { views: 100 }, { views: 200 }, { views: 300 },
    { views: 400 }, { views: 500 }, { views: 3000 },
  ];
  const idx = relativeIndex(posts);
  check("baseline is the median, not the mean",
    idx.baseline === 350, `got ${idx.baseline}`);
  check("a typical post lands near 1x",
    Math.abs(idx.scored.find((p) => p.views === 300).relIndex - 300 / 350) < 1e-9);
  check("the outlier is expressed against their own norm",
    Math.abs(idx.scored.find((p) => p.views === 3000).relIndex - 3000 / 350) < 1e-9);
  // A mean would be 750 here -- the 3000 dragging it -- and every ordinary
  // post would read as under-performing.
  check("the median resists one viral post",
    idx.baseline < 750);
}

{
  const thin = Array.from({ length: MIN_POSTS_FOR_BASELINE - 1 }, () => ({ views: 100 }));
  const idx = relativeIndex(thin);
  check("too few posts yields no baseline and no indices",
    idx.baseline === null && idx.scored.every((p) => p.relIndex === null));
}

{
  const withNulls = [
    { views: null }, { views: 0 }, { views: 100 }, { views: 200 },
    { views: 300 }, { views: 400 }, { views: 500 },
  ];
  const idx = relativeIndex(withNulls);
  check("unmeasured and zero-view posts are excluded from the baseline",
    idx.baseline === 300, `got ${idx.baseline}`);
  check("an unmeasured post gets no index rather than a zero",
    idx.scored.find((p) => p.views === null).relIndex === null);
}

/* ---- Picking what to learn from ------------------------------------------ */
{
  const a = { id: "a", views: 1_000_000, relIndex: 1.1 };   // big account, ordinary post
  const b = { id: "b", views: 40_000, relIndex: 6.0 };      // small account, breakout
  const top = topByRelative([a, b], 2);
  check("ranks by relative performance, not raw views",
    top[0].id === "b",
    `got ${top.map((t) => t.id).join(",")}`);

  const unscored = { id: "c", views: 9_000_000, relIndex: null };
  check("an unscored post is never ranked above a scored one",
    topByRelative([unscored, a], 2)[0].id === "a");
  check("limit is respected", topByRelative([a, b, unscored], 1).length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
