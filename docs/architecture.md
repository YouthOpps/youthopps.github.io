# How it works

Three projects move information from publishers to a static website. A separate AI workspace guides development.

```flow
caption: From a publisher to a reader
Publisher | Original opportunity information
data-pipeline | Collect and validate one source
data-source | Store that source's JSON snapshot
youthopps.org | Build pages and search indexes
Cloudflare Pages | Serve the website to readers
```

## What lives where

| Repository | Responsibility | Main files |
| --- | --- | --- |
| [data-pipeline](https://github.com/YouthOpps/data-pipeline) | Retrieve, validate and publish each source | `adapters/<source>/adapter.py`, `test_adapter.py`, one Action per adapter |
| [data-source](https://github.com/YouthOpps/data-source) | Store published data; no collection code or Actions | `datas/<source>/data.json` and `metadata.json` |
| [youthopps.org](https://github.com/YouthOpps/youthopps.github.io) | Present data, source information and these guides | `scripts/`, `assets/`, `docs/`, `site.config.json` |
| [ai-workspace](https://github.com/YouthOpps/ai-workspace) | Coordinate development; not a fourth runtime service | `AGENTS.md`, `docs/WORKFLOW.md`, `skills/`, repository submodules |

## One source, two files

`data.json` holds the last successfully validated records. `metadata.json` identifies the source and reports status, explanation, attempt/success times, errors and available publisher information.

| Collection outcome | Published result |
| --- | --- |
| Success | Replace that source's records and record `success` with a new success time |
| Failure after a success | Keep last-good records and success time; record `fail` and a sanitized explanation |
| First attempt fails | Do not create an empty published source |

Only authorized pipeline publication writes data-source; exceptional manual recovery belongs to administrators. Website development never edits published data.

If publication or durable error reporting fails, the run fails explicitly; it must not claim a successful update. Previously published data remains available.

## Automation

Each source Action runs only its own adapter with `--publish`. All source workflows have one daily schedule at different fixed UTC times selected randomly within a staggered timetable. Main-merge and manual triggers remain available; disabled access holds remain disabled. Live adapter tests do not publish and are not run by Actions.

```flow
caption: Refreshing youthopps.org is separate from source collection
Daily at 03:26 UTC | youthopps.org checks data-source main
Changed revision | Commit the new data submodule pointer
Cloudflare Git build | Validate data and generate dist/
Readers | Receive the successful deployment
```

If the data revision is unchanged, no refresh commit is made. Scheduled jobs can run late. The site checks once per day; data published after that check waits for the next sync unless a maintainer triggers an additional refresh. Fixed staggered cron times reduce simultaneous scheduled starts, while the source publication queue serializes delayed source jobs. The cron assignments stay fixed rather than being randomized again each day. A commit or passing local build is not proof of a live deployment. The workspace's own daily pin refresh is development housekeeping, not website publication.

## What youthopps.org builds

Every build reads one selected `datas/` snapshot, validates it, and creates static pages and collection search indexes in `dist/`. Missing or malformed required input fails. No upstream aggregate catalog or application server is needed.

Search and combined filters cover the whole selected collection before pagination. Publisher country, destination and applicant eligibility are separate. Public source names use the pipeline-provided `display_name`, containing only the concise institution name. Older metadata retains the official website domain without www as its fallback, or a provided name when no website is available. External website links retain their domain labels; full attribution remains separate. Opportunity source cells stack institution and website on separate lines. The institution links to the internal publisher detail page; the website links to the original official site; publisher country remains available through the country filters. A leading website name is omitted from the institution label to avoid duplication. Missing institution or website information is explicitly identified. Full disclosures remain on detail pages. Unexpired dated records sort by nearest deadline first, followed by unknown deadlines, then expired records in deadline order. Equal deadlines use record IDs for stable ties. Build output and browser search use the same ordering before pagination; the homepage preview also refreshes from the full collection. Expiry and ordering refresh on load, every 30 seconds and when returning to the tab. Expired records remain visible and turn grey through browser JavaScript. Timestamp deadlines display the full UTC date and closing time, including nonzero milliseconds, after converting the supplied offset; this is the same instant used for expiry. Date-only deadlines explicitly say that the closing time is not provided, and end at midnight after that UTC day. A displayed academic year or project period is not an application deadline. Static browsing works without JavaScript; search and live expiry need it.

## Crawler transparency

The build generates `/bot/` in the shared page shell, includes it in the page
sitemap and links to it discreetly from the footer. It identifies
`YouthOppsBot/1.0 (+https://youthopps.org/bot/)` and explains collection and
publisher contact policies. Publish and verify this page before deploying that
identity in source adapters. The existing contact address and human-reviewed
source-removal policy remain authoritative.

## Delivery

Cloudflare Pages uses Node.js 22, `npm run build`, output `dist`, and the website's `main` branch. `npm run check` runs tests, build and output verification; the website check Action runs it on PRs and main.

The selected data-source revision must contain `datas/`. The local migrated data can be checked with `DATA_PATH`, but it must be published and pinned before production rollout. Live Cloudflare deployment has not been verified here.

## Text languages

Opportunity titles and listing links retain the source record’s `language`. An optional `summary_language` language tag controls the detail description independently, so an English factual summary can accompany an original Croatian title. Older records fall back to `language`, then `und`; intentionally localized summaries retain their declared language. Present summary tags must be nonempty language tags such as `en`, `bg` or `en-GB`.
