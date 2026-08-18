-- Fold Raster into Folio, and spend the freed slot on something different.
--
-- The two were not really two designs. Both hung on a full-height vertical
-- hairline spine, both refused fills in favour of rules, both spent one accent
-- about three times a sheet, both sat on the same twelve-column A4 grid. The
-- only difference a client would ever notice is Georgia against Helvetica --
-- which is a choice inside a design, not a separate one. Offered side by side
-- they would have read as a mistake.
--
-- 'minimal' therefore becomes 'editorial', which keeps the border-only
-- substrate that made it the most print-safe of the four and absorbs the fixed
-- figure axis that made the other legible.
--
-- The slot goes to 'digest', which differs in SHAPE rather than in styling: a
-- two-sheet brief for a client who wants the numbers and not nine pages. Three
-- variations on a nine-page document plus one genuinely short one is a real
-- choice; four variations on a nine-page document is a swatch book.

begin;

update clients set report_template = 'editorial' where report_template = 'minimal';

alter table clients drop constraint clients_report_template_check;

alter table clients
  add constraint clients_report_template_check
  check (report_template in ('editorial', 'bold', 'luxury', 'digest'));

comment on column clients.report_template is
  'Which design the monthly client report renders in: editorial (broadsheet), bold (agency deck), luxury (house), digest (two-sheet brief). Maps to a .tpl-* root class.';

commit;
