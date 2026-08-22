-- Ideas, their evidence, and what happened to them.
--
-- BUILT NOW BECAUSE IT IS UNBUILDABLE RETROSPECTIVELY. The feedback loop needs
-- to know which ideas were offered and DECLINED, and once an idea is gone
-- there is no recovering that. The not-adopted set is the part teams skip
-- recording and the part that carries the information -- without it, any later
-- evaluation measures human selection, not idea quality.
--
-- Honest volume arithmetic, stated up front so nobody promises otherwise:
-- ~40 videos per client per year; if a third come from generated ideas, ~13
-- adopted ideas per client per year. At sigma >= 1.0, detecting even a 1.5x
-- difference needs far more than that -- per-client evaluation is a multi-year
-- proposition. Pooled across all clients it becomes answerable in months. The
-- cheapest useful signal needs no statistics at all: if a strategist declines
-- 90% of generated ideas, that is a verdict, and it arrives within weeks.

create table idea_suggestions (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references workspaces on delete cascade,
  client_id       uuid not null references clients on delete cascade,
  -- The evidence state it was born from, so "what did we know when we
  -- suggested this" stays answerable after the findings move on.
  run_id          uuid references analysis_runs,
  prompt_version  integer not null,
  model           text not null,
  kind            text not null check (kind in ('idea', 'script')),
  body            jsonb not null,
  -- [{type:'finding'|'video', id, figure}] -- every entry verified IN CODE
  -- before storage: the id must exist in the candidate set the prompt was
  -- given, and the figure must match the supplied row to 3 decimal places.
  -- An idea with no surviving citation is dropped, never shown with a caveat.
  evidence_refs   jsonb not null,
  -- 'measured' only when the citations survived verification AND cite
  -- acting/holds findings. Everything else is 'craft': ordinary short-form
  -- convention, labelled as such in a SCHEMA FIELD rather than in prose the
  -- model could soften.
  evidence_basis  text not null check (evidence_basis in ('measured', 'craft')),
  -- Mirrors tallyThemes().problems[]: what the validator removed and why.
  dropped_counts  jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index idea_suggestions_client on idea_suggestions (workspace_id, client_id, created_at desc);

create table idea_outcomes (
  id                     uuid primary key default uuid_generate_v4(),
  suggestion_id          uuid not null references idea_suggestions on delete cascade,
  disposition            text not null check (disposition in ('adopted', 'declined', 'expired')),
  declined_reason        text,
  -- When adopted: the video it became, and how that video eventually did.
  content_item_id        uuid references content_items on delete set null,
  perf_index_at_maturity numeric,
  decided_at             timestamptz not null default now()
);

create index idea_outcomes_suggestion on idea_outcomes (suggestion_id);

alter table idea_suggestions enable row level security;
alter table idea_outcomes enable row level security;

create policy idea_suggestions_select on idea_suggestions for select to authenticated
  using (can_manage_workspace(workspace_id) and not is_client_user(workspace_id));
create policy idea_outcomes_select on idea_outcomes for select to authenticated
  using (exists (
    select 1 from idea_suggestions s
    where s.id = idea_outcomes.suggestion_id
      and can_manage_workspace(s.workspace_id)
      and not is_client_user(s.workspace_id)
  ));

comment on table idea_suggestions is
  'Every idea ever offered, with verified evidence references. evidence_basis '
  'is a schema field, not prose: "measured" survives mechanical citation '
  'checking against acting/holds findings, everything else is "craft".';
