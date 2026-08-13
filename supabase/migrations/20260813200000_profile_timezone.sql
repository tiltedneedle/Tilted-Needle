-- Remember where each person is, for DISPLAY only.
--
-- The company works from Dubai, the UK and Pakistan. workspaces.timezone
-- settles the accounting day -- to-dos, timesheet periods, budget windows --
-- because those must agree between people: a week submitted in Karachi has to
-- be the same week approved in London.
--
-- This column is the other half, and its scope is deliberately narrow. It
-- changes how an INSTANT is rendered ("synced at 09:15") and nothing else. It
-- must never reach a date bucket, a period boundary or an aggregate, because
-- the moment two people's totals are computed against different day
-- boundaries, the same data starts disagreeing with itself depending on who
-- asked.
--
-- Why store it rather than just read the browser's zone at render time: these
-- pages are server-rendered, so formatting client-side would either flash the
-- wrong time before hydration or force every timestamp into a client
-- component. Storing it also leaves the door open for anything that has to
-- reach a person outside a page -- a digest email at a sensible local hour.

alter table profiles
  add column if not exists timezone text;

comment on column profiles.timezone is
  'IANA zone of this person, captured from their browser. DISPLAY ONLY -- how instants are rendered. Day boundaries, periods and aggregates use workspaces.timezone.';

-- Same guard as workspaces: an invalid zone makes `now() at time zone` raise,
-- and a bad value written once would break every page that formats a time.
alter table profiles
  drop constraint if exists profiles_timezone_valid;
alter table profiles
  add constraint profiles_timezone_valid
  check (timezone is null or now() at time zone timezone is not null);
