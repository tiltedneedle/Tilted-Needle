// Tests for CSV export quoting. These files land in the client's Excel, so a
// title containing a comma or a quote must not silently shift every column
// after it -- a corruption that looks like plausible data rather than an error.
const E = await import("../src/lib/exportCsv.ts");

let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  if (ok) pass++;
  else fail++;
};

const rows = (csv) => csv.split("\r\n");

/* -- basics -------------------------------------------------------------- */
{
  const csv = E.toCsv(["A", "B"], [[1, 2], [3, 4]]);
  check("header comes first", rows(csv)[0] === "A,B");
  check("rows follow in order", rows(csv)[1] === "1,2" && rows(csv)[2] === "3,4");
  check("CRLF line endings, per RFC 4180", csv.includes("\r\n"));
}

/* -- quoting ------------------------------------------------------------- */
{
  const csv = E.toCsv(["Title"], [["Hello, world"]]);
  check("a comma forces quoting", rows(csv)[1] === '"Hello, world"');
}
{
  const csv = E.toCsv(["Title"], [['She said "hi"']]);
  check("embedded quotes are doubled", rows(csv)[1] === '"She said ""hi"""');
}
{
  const csv = E.toCsv(["Title"], [["line one\nline two"]]);
  check("a newline is quoted rather than breaking the row",
    rows(csv)[1].startsWith('"line one'));
  check("a quoted newline keeps the record on one logical row",
    csv.split("\r\n").length === 2);
}
{
  const csv = E.toCsv(["Title"], [["plain"]]);
  check("ordinary values are left unquoted", rows(csv)[1] === "plain");
}

/* -- empties ------------------------------------------------------------- */
{
  const csv = E.toCsv(["A", "B", "C"], [[null, undefined, 0]]);
  check("null and undefined become empty, not the strings 'null'/'undefined'",
    rows(csv)[1] === ",,0");
  check("zero survives as zero rather than being treated as empty",
    rows(csv)[1].endsWith(",0"));
}
{
  const csv = E.toCsv(["A"], []);
  check("no rows still emits the header", csv === "A");
}

/* -- filename ------------------------------------------------------------ */
{
  const name = E.datedName("content");
  check("filename is prefixed and dated", /^content-\d{4}-\d{2}-\d{2}\.csv$/.test(name), name);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
