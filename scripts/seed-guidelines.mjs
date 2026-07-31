/**
 * Seeds the guideline sections and editor kit from the client guide documents.
 *
 * The source of truth is a set of Google Docs the team keeps by hand. They are
 * transcribed here rather than fetched, because the docs are access-restricted
 * and there is no service account wired up to read them -- see each client's
 * guideline_doc_url for the original.
 *
 * Re-runnable: sections are matched on (client_id, title) and updated in place,
 * so correcting a paragraph here and re-running does not duplicate anything.
 * Assets are matched on (client_id, label) the same way.
 *
 *   node scripts/seed-guidelines.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) =>
  env.split("\n").find((l) => l.startsWith(k + "="))?.slice(k.length + 1).trim();

const db = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false },
});

const WS = "c53055f9-fa68-41a0-95ff-6a35a5bf503f";

/**
 * The spine every client gets, in reading order. Titles are fixed so the same
 * question lives in the same place on every client's page; a client whose doc
 * says nothing about a section keeps it empty rather than hiding it, because a
 * visible gap is the prompt to go and fill it.
 */
const SPINE = [
  "Overview",
  "Social media handling",
  "Deliverables & cadence",
  "Filming guidelines",
  "Editing guidelines",
  "Production process",
  "B-roll index",
  "Content calendar",
  "Reporting",
  "Communication & expectations",
];

const CALENDAR_COLOURS = `Every upload is tracked on the content calendar, colour-coded so status is readable at a glance.

• Yellow — still needs approval
• Orange — approved
• Green — posted

The content calendar must always match Monday.com: same videos, same order, same status.`;

const DELIVERABLE_NUMBERING = `Videos are numbered by deliverable, not by upload date: JAN 1, JAN 2, JAN 3…
The first video posted in January is JAN 1 on Monday.com and sits in that position on the calendar.

Important: even when we post ahead of schedule the label follows the monthly deliverable count. If all 10 January deliverables are done by the 25th and something goes live on 28 January, it is labelled FEB 1 — it is February's first deliverable.

As soon as a video is ready for approval the admin team updates the calendar. Real-time updates are what keep the team able to see what is coming next.`;

/** name -> { sections: {title: body}, assets: [...] } */
const GUIDES = {
  "Ameerh Naran": {
    sections: {
      Overview: `Client: Ameerh Naran
Businesses: Vimana Private Jets & Naran Automotive
Industry: Car rental and chauffeur services

Ameerh Naran is a Zimbabwean-born entrepreneur and automotive designer, founder and CEO of Vimana Private Jets (a global luxury aviation brokerage) and Naran Automotive (a manufacturer of high-performance bespoke hypercars).`,
      "Social media handling": `We manage all of his channels.

• Instagram — @ameerhnaran
• TikTok — @ameerhnaran
• YouTube — @AmeerhNaran`,
      "Deliverables & cadence": `10 short-form videos per month (Instagram, TikTok, YouTube).
Long-form videos on Ameerh's main channel.
Occasionally content for his aviation company, Vimana.

The month runs 15th to 15th — the 10 deliverables must be with the client by the 15th. We are usually ahead of schedule on this account.`,
      "Filming guidelines": `We arrange filming with Ameerh and take the raw footage. We film with him globally — videographers travel to Europe, Africa, the UAE, wherever he is.`,
      "Editing guidelines": `Font: Myriad Pro

Following the editing guidelines strictly protects Ameerh's reputation and keeps the company safe. Take extra care with money, women, and public figures.

• All number plates must be blurred in any photo or video featuring Ameerh's cars. At rallies and tours, other supercar owners' plates must be blurred too, so they are not identifiable.
• When talking about the Naran, only show footage of our car — never other people's cars.
• Ameerh is always presented polished and professional. No controversial topics or statements.`,
      "Production process": `1. Filming — arrange with Ameerh, obtain raw footage.
2. Video segmentation — editors complete the videos; Milad picks the best quality ones to send.
3. Approval — admin shares drafts; Ameerh and his team usually give revisions. Admin resends after revisions.
4. Final review & calendar — once approved, admin marks it on Monday and adds the FV link to the content calendar with 2–3 days spacing between posts.
5. Uploading — Ameerh uploads to Instagram (send a reminder on posting day for which video goes up). Harry uploads TikTok, Cimmie uploads YouTube Shorts.`,
      "B-roll index": `Ameerh Naran B-roll index — see the linked spreadsheet in the kit below.`,
      "Content calendar": `We track every upload on the Ameerh Naran Virtual Dashboard.\n\n${CALENDAR_COLOURS}`,
      Reporting: `Monthly report prepared on the 15th of each month, including a comparison with previous months. Covers performance statistics from TikTok, Instagram and YouTube.`,
      "Communication & expectations": ``,
    },
    assets: [
      { kind: "font", label: "Myriad Pro", body: "Myriad Pro", notes: "Caption and on-screen text font for all Ameerh content." },
      { kind: "template", label: "Filming & editing guidelines (PDF)", url: "https://drive.google.com/file/d/17sZbxRfMfIkPc6bZ3ZsRrpCPjz5ztM-P/view?usp=sharing", notes: "For Zain — Ameerh Naran — Personal Brand." },
      { kind: "broll", label: "B-roll index", url: "https://docs.google.com/spreadsheets/d/1nifWy7H_b5LSQdXrREi79ff1aXq4qX-2nDWDnHyxW8Q/edit?usp=sharing" },
      { kind: "other", label: "Virtual dashboard / content calendar", url: "https://docs.google.com/spreadsheets/d/1oEoZE3lza6WfLHvjVUEK19RQBRUvN3lKDFPCejvPwZI/edit?usp=sharing" },
      { kind: "other", label: "Monthly report example (Feb–Mar)", url: "https://drive.google.com/file/d/1-U6uSSUHJT5pI7a9XinXjrVpv8-vytCA/view?usp=sharing" },
    ],
  },

  "Frankie Mardell - Trilogy Jewellers": {
    sections: {
      Overview: `Client: Frankie Mardell
Business: Trilogy Jewellers
Industry: Luxury watches and jewellery

Frankie Mardell is a British entrepreneur and luxury watch specialist, founder and director of Trilogy Jewellers — a high-end boutique in London's Hatton Garden and Mayfair specialising in rare timepieces and bespoke jewellery.`,
      "Social media handling": `We manage all of Frank's channels.

• Instagram — @trilogyjewellers
• TikTok — @trilogyjewellers
• YouTube — @frankiemardell-trilogy`,
      "Deliverables & cadence": `31 videos a month — one per day. Mostly short-form, with long-form for YouTube when needed.

Content types:
• Reaction videos
• Trending content
• Watch reviews
• Watch comparisons`,
      "Filming guidelines": `Filming is usually Tuesday 1pm, but flexible. Send Frank the filming plan in advance so there are no issues on the day.`,
      "Editing guidelines": `Font: Phosphate Solid

• Use pop-ups, and balance the music volume so it never overpowers the content.
• Every pop-up must match the watch actually on screen.
• Trendy and fast-paced — the client is open to TikTok trends and similar styles.
• Blur faces when needed, especially customers or buyers who do not want to appear.`,
      "Production process": `1. Planning — admin confirms ideas on the virtual dashboard and builds a filming plan, then confirms filming with Frank (usually Tuesday 1pm).
2. Filming — videographers film with him.
3. Editing — raw footage uploaded to Monday and assigned. Once QC'd by Scheyr (Sherry), marked "Ready to Share".
4. Approval — reminders to Frank on WhatsApp for pending videos. Once approved, Cimmie adds captions and marks approved on Monday.
5. Uploading — Waseem and Cimmie upload at 6pm UK on their respective platforms.`,
      "B-roll index": ``,
      "Content calendar": CALENDAR_COLOURS,
      Reporting: `Monthly report at the end of each month, including performance statistics from Instagram, TikTok, YouTube and LinkedIn.`,
      "Communication & expectations": `Approval chasing happens on WhatsApp — constant reminders for pending videos.`,
    },
    assets: [
      { kind: "font", label: "Phosphate Solid", body: "Phosphate Solid", notes: "Caption and pop-up font." },
      { kind: "other", label: "Monthly report example (February 2026)", url: "https://drive.google.com/file/d/1u_c6XTN3vIczXLLlI6CWPTcifEdAVfLN/view?usp=sharing" },
    ],
  },

  "Entree Bakery and Cafe": {
    sections: {
      Overview: `Clients: Sandro (son of owner) and Nutsa (daughter of owner)
Business: Entrée
Industry: Bakery and café

Entrée London is a family-run bakery bringing Georgian-European flavours to London through handcrafted pastries, artisan breads and refined café offerings. Locations across Notting Hill, Mayfair, Kensington and Chelsea Barracks, combining traditional recipes with a modern luxury café experience.`,
      "Social media handling": `We provide the videos; Sandro or Nutsa post them.

• Instagram — @entree_london
• TikTok — @entree_london`,
      "Deliverables & cadence": `10 videos a month.

Content types:
• Short-form vertical video (Reels, TikTok, Shorts)`,
      "Filming guidelines": ``,
      "Editing guidelines": `See the onboarding call document in the kit below.`,
      "Production process": ``,
      "B-roll index": `Not yet confirmed.`,
      "Content calendar": CALENDAR_COLOURS,
      Reporting: ``,
      "Communication & expectations": ``,
    },
    assets: [
      { kind: "template", label: "Onboarding call notes", url: "https://docs.google.com/document/d/12FzDMhzs7LRzT0QderhKS6d7_ARlTTdvA8DhGF7Dn2E/edit?usp=sharing" },
      { kind: "other", label: "Content calendar", url: "https://docs.google.com/spreadsheets/d/1PT7_cU_naVCQwqJPPqkX4g229Ehc0qZQ0do7rvbtujk/edit?usp=sharing" },
    ],
  },

  "The Jet Business": {
    sections: {
      Overview: `Client: Steve Varsano
Business: The Jet Business
Industry: Corporate jet brokerage and sales

Steve is the founder of The Jet Business — a jet broker who buys and sells corporate jets, with a brand built around his expertise in aviation. He works with high-net-worth clients and has a strong personal presence across social media.

⚠ The Jet Business has been bought by Flexjet. All videos now need Flexjet approval before posting, especially any video that mentions Flexjet.`,
      "Social media handling": `We manage all of Steve's channels — personal and business.

Personal
• Instagram — @stevevarsano
• LinkedIn — Steve Varsano

Business
• Instagram — @thejetbusiness
• TikTok — @thejetbusiness
• YouTube — The Jet Business
• LinkedIn — The Jet Business
• Facebook — The Jet Business (no access at the moment)`,
      "Deliverables & cadence": `10 videos a month. Mostly short-form, with long-form for YouTube when needed.

We post 4–5 times a week, so we always need to stay ahead and keep a healthy backlog of approved videos ready to go.

Content types:
• Short-form vertical video (Reels, TikTok, Shorts)
• Long-form YouTube`,
      "Filming guidelines": `Setups differ by video type.

Sit-down fuselage videos (e.g. "Possible / Not Possible")
• Tripod. Steve centred, looking directly at camera.
• Answers short — ideally two or three words.
• Avoid stuttering or long explanations.

Phone call videos
• Steve still centred. Lighting on.
• Hold the phone or rest it on an object — there is usually no time for a tripod.
• Keep the shot steady and clean.

Reaction videos
• Set the phone on an object (e.g. a glass). Use 0.5× wide angle.
• Steve holds the phone on the left of frame, angled slightly right, leaving space in the bottom left for the reaction overlay.

POV videos
• Handheld, with your hand visible in shot so it reads as real POV.
• Both you and Steve must be mic'd up.

Educational videos
• If Steve starts over-explaining, guide him to simplify. Complex topics must be easy for anyone to follow.`,
      "Editing guidelines": `Font: Myriad Pro / Phosphate Solid

The style is very TikTok and Instagram-focused — simple, easy to understand, visually engaging. Someone who knows nothing about jets should be able to follow along.

• Cut any section where Steve sounds uncertain, hesitates, or uses filler ("like", "so", "ermm", "I don't know"). The final edit should make him sound clear, confident and completely sure.
• Plenty of on-screen pop-ups to visualise what he is talking about.
• Music should always be trending or popular on TikTok so the content feels current.
• End every video with his usual logo branding — see the logo and music folder in the kit below.`,
      "Production process": `Videos go through Flexjet approval before posting since the acquisition.

B-roll must be added to the index straight after every shoot.`,
      "B-roll index": `Steve's b-roll index must be kept updated after every shoot. This is where all b-roll is stored and organised so editors can find what they need without digging through random folders.

Categories should be clear, for example:
• Steve on the phone
• Steve at his desk
• Steve walking outside
• Steve shaking hands
• Office shots

Any time new b-roll is filmed, add it to the index straight away.`,
      "Content calendar": `${CALENDAR_COLOURS}\n\n${DELIVERABLE_NUMBERING}`,
      Reporting: `Weekly report, every Monday.

Whoever has access to the social accounts (usually Veliko) pulls the previous week's insights — follower growth, views and any other relevant stats — and adds them to the weekly report spreadsheet. Rename the spreadsheet to that week's date (using the previous week's date). Admin (usually Waseem) then emails the report to Steve.

How to fill it in
You will be given total followers per account and that week's views per account. Those numbers go into four places: the Personal Followers Report, the Views Report, and both Master reports.

• Followers Report — type in the follower number given. It is the total, nothing to calculate.
• Views Report — cumulative. Add the week's number to the previous week's total.

Cumulative total: in the cumulative cell type =(SUM, highlight the row you just entered, press Enter — e.g. =(SUM(C110:K110). No commas, no spaces between numbers, or Excel will not calculate.

Percentage change: subtract the previous cumulative total from the current one and divide by the previous — e.g. =(L110-L109)/L109 where L is the cumulative column, 110 the current row and 109 the previous. Repeat for both the Followers and Views reports.`,
      "Communication & expectations": `Steve likes to be kept in the loop. Communication needs to be clear — he should never feel like he is guessing what is happening.

He prefers honesty and realistic timelines. Always better to tell him the truth than promise something and not deliver.

He prefers communication to be purposeful and action-driven rather than general updates. Every message should carry a clear outcome or next step: delivering a finished video, scheduling a shoot, sharing a filming plan, sending the day's upload, or acknowledging a milestone such as hitting a view or like count.

How we communicate
• Regular updates in the group chat.
• Anyone physically at his office keeps the admin team updated so messages stay aligned.

Updates should cover: when a shoot is happening, how it went, what the editors are working on, what post goes live that day, when we need approval, and any changes or delays.

General approach — be proactive, make sure he always feels looked after, maintain a professional tone.`,
    },
    assets: [
      { kind: "font", label: "Myriad Pro / Phosphate Solid", body: "Myriad Pro / Phosphate Solid", notes: "Caption and pop-up fonts." },
      { kind: "logo", label: "Logo & music folder", url: "https://drive.google.com/drive/folders/1J0RCuls8pCnG-InRMs-byVgISB149T9i?usp=drive_link", notes: "End-of-video logo branding goes on every video." },
      { kind: "broll", label: "TJB b-roll index", url: "https://docs.google.com/spreadsheets/d/1en7YyZMqXElXE6k1XD_7_hQZwbb6K8_yJn96gmBSlUQ/edit?usp=sharing" },
      { kind: "other", label: "Content calendar", url: "https://docs.google.com/spreadsheets/d/1Ev9JJBufdby4R9MuDW-2CRFRInjqfUU3Z_VPhzQDIkQ/edit?gid=1791538899#gid=1791538899" },
      { kind: "other", label: "Ideas folder", url: "https://drive.google.com/drive/folders/1zlFVyZpwbzhSruuJEKMmOklqggh33qim?usp=drive_link", notes: "Ideas documents labelled by month." },
      { kind: "other", label: "Content strategy (April/May)", url: "https://docs.google.com/document/d/1dareDXd8gBUcrisdR3RoSaDPYM8HHN1I/edit?usp=drive_link" },
      { kind: "other", label: "Followers report — personal pages", url: "https://docs.google.com/spreadsheets/d/1FoSaIi7K_fJm60j5hvljKH5sJxbu-zxK5USfvrug8L0/edit?gid=0#gid=0" },
      { kind: "other", label: "Followers master report (TJB / SV)", url: "https://docs.google.com/spreadsheets/d/16gDU1LYsmQMuFpiuLFLK-j2km2DwyHhhlmGVtCd4cBg/edit?gid=0#gid=0" },
      { kind: "other", label: "Views report — personal pages", url: "https://docs.google.com/spreadsheets/d/1Zx8U7h7DMuL6vWD6g46sn9ltfVtYLbGdDTM9yA4ci0I/edit?gid=0#gid=0" },
      { kind: "other", label: "Views master report (TJB / SV)", url: "https://docs.google.com/spreadsheets/d/1jmb8VlkN_QUJrGk8zaBrxUGTGCAuXAI1ChoGlKkAQiI/edit?gid=0#gid=0" },
    ],
  },

  "EuroEyes Deutschland": {
    sections: {
      Overview: `EuroEyes Hamburg (EEH).

LEC (Laser Eye Clinic) and EEH are the same brand — LEC is the London arm. The group has 41 clinics worldwide, including Germany, China and Denmark.

Most EEH content is existing English LEC content, translated and re-captioned in German.`,
      "Social media handling": `Posted across Instagram, Facebook, TikTok, YouTube and LinkedIn once approved.`,
      "Deliverables & cadence": `Videos must be 35–50 seconds maximum.`,
      "Filming guidelines": `Capturing the English title during filming

When filming directly in German (with Dr. JJ or anyone else) the videographer must:
• Ask the subject what the video will be about before recording.
• Clearly state the English title or premise on camera before the German recording begins.

This gives every German video an English reference title so it can be identified during editing.

If the title was not captured, videos go to the freelancer labelled sequentially — German Video 1, German Video 2, German Video 3 — and the freelancer watches each one and assigns an appropriate English title.

Sending videos to the freelancer
• Send the raw footage link from the Drive.
• Label with the title (e.g. "Dr. JJ compares the Eye to Camera in London") or the video number.
• Message them in the group chat to confirm receipt and ask them to confirm they will start editing. Update Monday comments and status accordingly.`,
      "Editing guidelines": `Font: Myriad Pro Regular 52, stroke 4

Treatment animations — only Carl Zeiss animations may be used to show treatments (PRK, SMILE, Lens Surgery, Femto Lasik/Presbyond). Links in the kit below.

Captions
• Capitalisation must be accurate. Capital letters for all treatments.
• Working from a client-approved German script, copy the capitalisation exactly. In German all nouns are capitalised (Großschreibung), including formal pronouns like Sie and nominalised verbs.
• "EuroEyes" is always spelt as one word: EuroEyes.
• "sollte sie" not "solltest Sie" — only capitalised when someone is directly addressed.
• Always refer to doctors by full title and surname: "Dr. Jørn Slot Jørgensen", "Dr. Radhika Rampat, Ophthalmic Surgeon" — never "Dr. JJ".
• Always the formal "Sie", never "du".

CTA
Two variants depending on the audience: use the younger CTA for younger patients, the older CTA for older patients. If the video is general, use the older-patient CTA. Always use the current CTA — never reuse an old one, and double-check before exporting.

For internal editors: if the client requests caption revisions, the AI voiceover script must be updated to match.

B-roll selection rules
• Nothing scary or graphic — no surgery clips, no cutting, nothing uncomfortable.
• No shaky shots.
• Two specific individuals must never appear: one no longer works at the clinic, and one does not want to be posted online (she usually appears in surgery-room b-roll — crop her out or do not use that b-roll).
  ⚠ The source document identifies both by photo. Those images did not survive the copy into this page — check the original doc before using surgery-room b-roll.`,
      "Production process": `Step 1 — Select relevant content
Review LEC's English content and pick what suits EEH. Build a list with video title and direct link, and send it to Tatjana (EEH team) for approval via WhatsApp or email:
"Hi @Tatjana, we have added X videos to the calendar under X date for your approval. Looking out for your feedback!"

Step 2 — Receive approval & request assets
Wait for Tatjana's approval. Then request from the original English editor:
• Video with audio only (no music, no captions)
• Video with audio and captions (no music)
• Music and sound effects as separate files

All materials go in the client's main Drive folder under the correct year and month, in a folder named after the video (e.g. "Laser vs Contacts — Feb 2026"). Group every asset together — screen recordings, exports, captions, thumbnails, scripts — and label clearly which file is which.

Step 3 — Caption translation & editing
Option A: Translator + in-house editing
Use Gemini to generate the script from the English LEC video, then read it carefully to check the transcription is accurate. Send the English captions for German translation (Google Translate or ChatGPT), then have in-house editors add the German captions.

Option B: Freelance German editor
Send the full set — original video files, audio-only version, English and German captions, music and SFX. Send only the specific sound effects used in the English version. The freelancer translates/checks the captions and adds them.

When the freelancer sends Version 1
• Update the TBA link on Monday with the new edited version.
• Comment on Monday: "Freelancer (name) sent Version 1."
• Set status to Ready to Share.
• Only download the edited video after the client approves. Then upload the approved video to our Drive alongside the raw footage and update the TBA link on Monday.

If the client requests revisions
1. Reply on the calendar: "We will make these changes."
2. Send revisions to the freelancer in the group chat.
3. Tell them to prioritise revisions before new edits, pausing a current edit if needed — revisions should be quick so the video can go up.
4. Update Monday: paste the client's revision notes into comments, then "Revisions sent to (name)", then "Freelancer is working on revisions" once confirmed.

When the revised video comes back — check the revisions were done correctly, upload the new version to the same Drive folder, delete the old version, update the TBA link on Monday and the calendar link. Reply on the calendar "Revisions completed" and remind the client in the group chat.

If approved — mark the calendar entry orange, set Monday to Approved, post to Instagram, Facebook, TikTok, YouTube and LinkedIn, then mark the entry green once live everywhere.`,
      "B-roll index": `Kept updated after every shoot, so editors can find clips without digging through folders.

Categories should be clear, for example:
• SMILE surgeries
• Dr Fadi consultation
• Reception
• Patient putting glasses in throwaway container
• Nurse explaining aftercare

Any time new b-roll is filmed, add it to the index straight away.`,
      "Content calendar": `Colour coding on this account has five states, not three.

• Yellow — needs approval
• Orange — approved
• Green — posted
• Blue — under revision
• Pink — approved for edit

${DELIVERABLE_NUMBERING}

On the content calendar the month and deliverable number are NOT included at the start of each title, because the client sees the calendar. Those labels live in Monday.com for internal tracking — "everything must match" means the Monday deliverable number corresponds exactly to its position on the calendar.

Every video on the calendar must have a caption. For LEC translated videos, copy the English caption and translate it to German. For new EEH videos, ask the freelancer to write one.

Client feedback (usually Tatjana) comes as comments directly on the calendar, in one of the boxes under that video's date.`,
      Reporting: ``,
      "Communication & expectations": `Update Monday.com comments and status every single time something happens to a video. Anyone should be able to open Monday and instantly see where a video is.

Examples:
• "Sent to freelancer (name) for editing"
• "Freelancer confirmed they will start editing"
• "Freelancer is working on it"
• "Freelancer sent Version 1"
• "Revisions sent to freelancer"
• "Freelancer working on revisions"
• "Client approved"`,
    },
    assets: [
      { kind: "font", label: "Myriad Pro Regular 52, stroke 4", body: "Myriad Pro Regular, size 52, stroke 4", notes: "Exact caption setting for EEH." },
      { kind: "cta", label: "CTA folder (young & older patient)", url: "https://drive.google.com/drive/folders/1ypboRqjNM-3RsgGPcAh78NiVtFqZNAiu?usp=drive_link", notes: "Two variants. Younger CTA for younger patients, older CTA for older patients, older CTA for general videos. Never reuse an old CTA — check before exporting. Current as of 25 June." },
      { kind: "broll", label: "Carl Zeiss animation — PRK", url: "https://www.youtube.com/watch?v=1Pjh4ja1lH0", notes: "Only Carl Zeiss animations may be used to show treatments." },
      { kind: "broll", label: "Carl Zeiss animation — SMILE", url: "https://www.youtube.com/watch?v=1oJFShANMTc" },
      { kind: "broll", label: "Carl Zeiss animation — Lens Surgery", url: "https://www.youtube.com/watch?v=n_3cG9oeuNo" },
      { kind: "broll", label: "Carl Zeiss animation — Femto Lasik / Presbyond", url: "https://www.youtube.com/watch?v=tKlpVebYRuQ" },
      { kind: "broll", label: "EEH b-roll index", url: "http://docs.google.com/spreadsheets/d/10G43WogDE4ahfnFcRkVUHQotvbhPuirNAFTA8M7FmEo/edit?usp=drivesdk" },
      { kind: "other", label: "EEH Drive folder", url: "https://drive.google.com/drive/folders/1-x-V2HQvd_aWpZ0jldS96XXmUAysqSOn?usp=drive_link", notes: "All materials, filed by year and month, in a folder named after the video." },
      { kind: "other", label: "To Be Approved (TBA) folder", url: "https://drive.google.com/drive/folders/18JiMqczE6bxkAlMef8kCKLSVKK0xUnNE?usp=drive_link" },
      { kind: "other", label: "Content calendar", url: "https://docs.google.com/spreadsheets/d/1rAXHQV1JLmPoGeHERCyhzuryaYwP9qq6UJ0gGVGdhtg/edit?gid=1175299292#gid=1175299292" },
      { kind: "other", label: "Ideas folder", url: "https://drive.google.com/drive/folders/1tc1EqQxBngCaA7XCLUdBX3g4yXBslWHa?usp=drive_link", notes: "Ideas documents labelled by month." },
    ],
  },

  "Alex Evagora": {
    sections: {
      Overview: `Client: Alex Evagora
Business: ARETE & Co
Industry: Real estate & yachting

Arete & Co. (or Areté) is a luxury private client consultancy led by Alex Evagora. Headquartered in Mayfair, London, the firm operates outside traditional brokerage models, specialising in prime and super-prime real estate, aviation and yachting.`,
      "Social media handling": `Alex uploads to all his own channels. Once videos are approved we add them to the content calendar and he posts them.

• Instagram — @areteyachts
• Facebook — Arete & Co
• TikTok — @alex_evagora
• YouTube Shorts — @alexevagora
• LinkedIn — Alex Evagora`,
      "Deliverables & cadence": `10 videos a month, all short-form.`,
      "Filming guidelines": ``,
      "Editing guidelines": ``,
      "Production process": `Once videos are approved we add them to the content calendar, then the client uploads.`,
      "B-roll index": ``,
      "Content calendar": CALENDAR_COLOURS,
      Reporting: ``,
      "Communication & expectations": ``,
    },
    assets: [
      { kind: "other", label: "Content calendar", url: "https://docs.google.com/spreadsheets/d/17oV7QtaoyR7l7gjkoyNEWZXOr_2YdqXE8BbBpOfdK7o/edit?usp=sharing" },
    ],
  },
};

/** LEC shares the brand and most of the workflow with EEH. */
GUIDES["Euro Eyes London (LEC)"] = {
  sections: {
    Overview: `Laser Eye Clinic (LEC), London.

LEC and EuroEyes Hamburg (EEH) are the same brand — LEC is the London arm, and the group has 41 clinics worldwide including Germany, China and Denmark.

LEC produces the original English content. EEH translates and re-captions much of it into German, so LEC editors are regularly asked to supply split assets — see "Production process".`,
    "Social media handling": `• Instagram — @euroeyesuk
• TikTok — @laser.eye.clinic
• YouTube — @EuroEyesUK`,
    "Deliverables & cadence": ``,
    "Filming guidelines": ``,
    "Editing guidelines": `Only Carl Zeiss animations may be used to show treatments (PRK, SMILE, Lens Surgery, Femto Lasik/Presbyond) — links in the kit on the EuroEyes Deutschland page.

B-roll: nothing scary or graphic, no surgery clips, no shaky shots.`,
    "Production process": `When EEH selects an LEC video for translation, the original English editor must supply:
• Video with audio only (no music, no captions)
• Video with audio and captions (no music)
• Music and sound effects as separate files

Label each clearly and upload to the shared folder so the EEH editing team can pick them up. Send only the specific sound effects used in the English version.`,
    "B-roll index": ``,
    "Content calendar": CALENDAR_COLOURS,
    Reporting: ``,
    "Communication & expectations": ``,
  },
  assets: [],
};

const { data: clients } = await db.from("clients").select("id,name").eq("workspace_id", WS);
const byName = Object.fromEntries(clients.map((c) => [c.name, c.id]));

const { data: existingSections } = await db
  .from("client_guideline_sections")
  .select("id,client_id,title");
const sectionId = new Map((existingSections ?? []).map((r) => [`${r.client_id}::${r.title}`, r.id]));

const { data: existingAssets } = await db.from("client_assets").select("id,client_id,label");
const assetId = new Map((existingAssets ?? []).map((r) => [`${r.client_id}::${r.label}`, r.id]));

let secUp = 0, secIns = 0, astUp = 0, astIns = 0;

for (const client of clients) {
  const guide = GUIDES[client.name];
  // Every client gets the full spine, even without a source doc -- the empty
  // sections are the to-do list for whoever writes that client's guide.
  for (const [i, title] of SPINE.entries()) {
    const body = guide?.sections?.[title] || null;
    const existing = sectionId.get(`${client.id}::${title}`);
    if (existing) {
      await db
        .from("client_guideline_sections")
        .update({ body, sort_order: i, updated_at: new Date().toISOString() })
        .eq("id", existing);
      secUp++;
    } else {
      await db.from("client_guideline_sections").insert({
        workspace_id: WS, client_id: client.id, title, body, sort_order: i,
      });
      secIns++;
    }
  }
  // Titles from the earlier generic spine that this run replaced.
  await db
    .from("client_guideline_sections")
    .delete()
    .eq("client_id", client.id)
    .not("title", "in", `(${SPINE.map((t) => `"${t}"`).join(",")})`);

  for (const [i, a] of (guide?.assets ?? []).entries()) {
    const row = {
      workspace_id: WS, client_id: client.id,
      kind: a.kind, label: a.label,
      body: a.body ?? null, url: a.url ?? null, notes: a.notes ?? null,
      sort_order: i,
    };
    const existing = assetId.get(`${client.id}::${a.label}`);
    if (existing) {
      await db.from("client_assets").update(row).eq("id", existing);
      astUp++;
    } else {
      await db.from("client_assets").insert(row);
      astIns++;
    }
  }
}

console.log(`sections: ${secIns} inserted, ${secUp} updated`);
console.log(`assets:   ${astIns} inserted, ${astUp} updated`);
