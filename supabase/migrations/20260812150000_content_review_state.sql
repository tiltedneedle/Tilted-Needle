-- Every video gets reviewed: is this OUR work, or something the client posted?
--
-- The sync discovers everything on a channel indiscriminately. A client who
-- posts their own clip between our deliveries currently lands in the same
-- table as agency work and counts toward every performance figure, which
-- silently credits the team with reach they did not produce.
--
-- THREE STATES, NOT A BOOLEAN. A boolean cannot tell "nobody has looked yet"
-- apart from "a human looked and said no" -- and without a terminal rejected
-- state the sync hands the same client-posted video back to the queue on
-- every run, forever. worker/enqueue.mjs already learned this the hard way
-- and records it in one line: "A permanent no is a no."
--
-- TWO ORTHOGONAL COLUMNS, NEVER ONE. This column answers "is it ours".
-- Whether we still work with the client stays DERIVED from
-- clients.is_archived. Collapsing the two would strand rows: an
-- archived-and-pending video would have no state left to restore when the
-- client comes back.

alter table content_items
  -- Step 1 of 2. The default is 'approved' for exactly the duration of this
  -- statement, which stamps every EXISTING row atomically inside the same DDL
  -- transaction -- no separate UPDATE to get wrong, and no window in which a
  -- row could be missed.
  add column if not exists review_state text not null default 'approved'
    check (review_state in ('pending', 'approved', 'rejected')),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references profiles on delete set null;

-- Step 2 of 2. Every FUTURE insert is pending unless it says otherwise.
alter table content_items alter column review_state set default 'pending';

-- Existing rows keep reviewed_at NULL on purpose. That NULL is the only thing
-- separating "grandfathered by this migration" from "a person actually looked
-- at this", and it makes the audit query trivial:
--     select * from content_items
--      where review_state = 'approved' and reviewed_at is null;
--
-- Backfilling to 'pending' instead would have been an outage dressed as
-- caution: at the instant it landed, every filtered read would drop every
-- video in the workspace, computeRankings would compute role means over an
-- empty set, and every employee's score would become null -- then get frozen
-- into a shared cache entry. The existing content_assignments settle it
-- independently: a credit is a human already asserting "we made this", and
-- defaulting to pending would suspend judgments that were already recorded.
-- Over-approving is recoverable through the same queue; under-approving is
-- not, because nothing in this database records which rows were genuinely
-- agency work.

create index if not exists content_items_review_idx
  on content_items (workspace_id, review_state);

comment on column content_items.review_state is
  'pending = discovered by the sync, nobody has judged it yet. approved = our '
  'work, counts toward every performance figure. rejected = the client posted '
  'it themselves; kept forever with its metrics, excluded from our numbers, '
  'and never returned to the queue by a later sync.';

comment on column content_items.reviewed_at is
  'NULL on an approved row means it was grandfathered by the migration that '
  'introduced review_state, not that a person approved it.';
