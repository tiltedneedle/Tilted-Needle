-- Which report design a client receives.
--
-- Per client, not per workspace, because the clients are not alike: a
-- private-jet broker and a jeweller want a different document from a bakery,
-- and the agency sends all three in the same month. One global setting would
-- force the least appropriate choice on somebody every time.
--
-- Stored as text with a CHECK rather than an enum. A new design is then a
-- migration that widens a constraint, not one that alters a type -- and an
-- enum with a value no CSS implements is a client receiving a blank document.
--
-- NULL is not allowed: every client renders as something, and 'editorial' is
-- the closest to the reports the agency already sends, so an untouched client
-- keeps getting what it was getting.

begin;

alter table clients
  add column report_template text not null default 'editorial'
    check (report_template in ('editorial', 'bold', 'minimal', 'luxury'));

comment on column clients.report_template is
  'Which design the monthly client report renders in. Maps to a .tpl-* root class in the report stylesheet.';

commit;
