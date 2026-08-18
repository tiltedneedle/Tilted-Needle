// Chunking a long .in() list, and refusing to hide a failure.
//
// PostgREST takes its filters in the QUERY STRING, so .in("id", [...]) writes
// every id into the URL. Two live bugs came from that, and both were silent in
// the same way -- the caller destructured `data` and never looked at `error`,
// so a dropped request became an empty array and an empty array became a
// confident wrong answer: /clients/[id] told you every channel was flat, and
// the public API answered 200 with "platforms": [] on every item.
const S = await import("../src/lib/selectIn.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const ids = (n, prefix = "id") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

/* -- Chunking -------------------------------------------------------------- */

{
  const seen = [];
  const res = await S.selectIn(ids(450), (chunk) => {
    seen.push(chunk.length);
    return Promise.resolve({ data: chunk.map((id) => ({ id })), error: null });
  });
  eq("450 ids are split into chunks of 200", seen.join(","), "200,200,50");
  eq("every row comes back", res.data.length, 450);
  eq("and in order", res.data[0].id + ".." + res.data[449].id, "id0..id449");
  eq("no error", res.error, null);
}

{
  const calls = [];
  await S.selectIn(ids(5), (c) => { calls.push(c.length); return Promise.resolve({ data: [], error: null }); });
  eq("a short list is one request", calls.join(","), "5");
}

{
  let called = 0;
  const res = await S.selectIn([], () => { called++; return Promise.resolve({ data: [{ id: "x" }], error: null }); });
  eq("an empty list makes no request at all", called, 0);
  eq("and returns nothing", res.data.length, 0);
}

{
  const seen = [];
  await S.selectIn(["a", "a", "b", "a"], (c) => { seen.push(...c); return Promise.resolve({ data: [], error: null }); });
  // Duplicates cost URL budget and buy nothing; the filter is a set.
  eq("duplicate ids are sent once", seen.join(","), "a,b");
}

{
  const seen = [];
  await S.selectIn(ids(7), (c) => { seen.push(c.length); return Promise.resolve({ data: [], error: null }); }, 3);
  eq("the chunk size is configurable", seen.join(","), "3,3,1");
}

/* -- Failure is reported, not swallowed ------------------------------------ */

{
  const res = await S.selectIn(ids(600), (chunk) =>
    Promise.resolve(
      chunk[0] === "id400"
        ? { data: null, error: { message: "URL too long" } }
        : { data: chunk.map((id) => ({ id })), error: null },
    ),
  );
  check("a failing chunk returns its error", res.error?.message === "URL too long", String(res.error?.message));
  // THE WHOLE POINT. "Nothing matched" and "the third chunk failed" produced
  // an identical empty array before, which is how both live bugs stayed
  // invisible for so long.
  eq("partial data comes back alongside it", res.data.length, 400);
}

{
  let calls = 0;
  const res = await S.selectIn(ids(600), () => { calls++; return Promise.resolve({ data: null, error: { message: "boom" } }); });
  eq("a failure stops the remaining chunks", calls, 1);
  check("and is reported", !!res.error, String(res.error?.message));
}

{
  const res = await S.selectIn(ids(3), () => Promise.resolve({ data: null, error: null }));
  // A null data with no error is "matched nothing", which is not a failure.
  eq("null data with no error is an empty result", res.data.length, 0);
  eq("and not an error", res.error, null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
