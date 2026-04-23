# IB Extended Essay Word Counter

A rules-aware word counter for the IB Diploma Extended Essay. Excludes footnotes,
bibliography, appendix, tables and equations the way the EE guide requires.
Runs entirely in the browser — no uploads, no sign-up, no tracking.

Built as a single static site — plain HTML, CSS, and vanilla JavaScript plus a
single dependency (JSZip, loaded from Cloudflare CDN with SRI) for client-side
`.docx` parsing.

## What's in the box

| Path | Purpose |
| --- | --- |
| `index.html` | Single-page UI. Semantic HTML, WCAG 2.2 AA. |
| `css/style.css` | Design tokens, light/dark mode, focus styles. |
| `js/counter.js` | Pure counting engine — tokenisation, segmentation, limit math. |
| `js/docx.js` | Client-side `.docx` parser (JSZip + DOM XML). |
| `js/suggestions.js` | Rule-based sentence scorer for "Suggest cuts". |
| `js/app.js` | UI wiring — tabs, toggles, dialogs, theme toggle, RPPF counter. |
| `assets/` | Favicon and OG image. |
| `_headers`, `_redirects` | Cloudflare Pages configuration (CSP, caching). |
| `wrangler.toml` | Optional Wrangler / Pages config. |
| `scripts/push.sh` | Commits and pushes the site to GitHub. |
| `scripts/deploy.sh` | Deploys the site to Cloudflare Pages via Wrangler. |
| `.env.example` | Template for the two scripts' environment variables. |

## Accessibility (WCAG 2.2 Level AA)

- Semantic landmarks (`<header>`, `<main>`, `<footer>`, `<section>`, `<aside>`), one `<h1>` per page, no skipped heading levels.
- Skip link as the first focusable element (SC 2.4.1).
- All controls reach ≥44 × 44 px (SC 2.5.8 target size).
- Visible, 2 px outline focus indicators with 3 px offset (SC 2.4.7 / 2.4.11).
- Colour contrast ≥ 4.5 : 1 for body text, ≥ 3 : 1 for large text and UI borders, verified in both light and dark modes (SC 1.4.3 / 1.4.11).
- Live counter uses `aria-live="polite"` with `aria-atomic="false"` so updates don't interrupt screen-reader users.
- Tab list implements the full WAI-ARIA Authoring Practices keyboard pattern (Arrow / Home / End).
- Native `<dialog>` for modals — Escape closes; focus is trapped automatically by the browser.
- `prefers-reduced-motion` zeros out transitions globally.
- Draggable file upload also works via click and Enter / Space (SC 2.5.7).
- Theme toggle uses `aria-pressed` and updates its `aria-label` when state changes.
- No colour-only status conveyance — status words ("Within limit", "Over the cap") accompany all coloured badges (SC 1.4.1).

## Running locally

Any static file server works. The simplest:

```bash
python3 -m http.server 8000
# Open http://localhost:8000
```

## Pushing to GitHub

1. `cp .env.example .env` and fill in `GITHUB_USER` / `GITHUB_REPO`.
2. Create the (empty) repo on GitHub.
3. Authenticate `git` once (`gh auth login`, SSH key, or a PAT in the remote URL).
4. Run:

   ```bash
   chmod +x scripts/push.sh
   ./scripts/push.sh "initial commit"
   ```

## Deploying to Cloudflare Pages

1. Install Wrangler: `npm i -g wrangler`.
2. Authenticate: `wrangler login` (once) **or** set `CLOUDFLARE_API_TOKEN` +
   `CLOUDFLARE_ACCOUNT_ID` in `.env`.
3. Fill in `CF_PAGES_PROJECT` in `.env` (a project will be created on first
   deploy if it doesn't exist).
4. Run:

   ```bash
   chmod +x scripts/deploy.sh
   ./scripts/deploy.sh                 # production
   ./scripts/deploy.sh preview         # throwaway preview URL
   ```

Wrangler prints the public URL at the end.

## Updating the site

After editing files locally:

```bash
./scripts/push.sh "short message"       # version control on GitHub
./scripts/deploy.sh                     # redeploy on Cloudflare
```

The two scripts are intentionally independent — Cloudflare is *not* watching the
GitHub repo in this setup. If you later connect the Pages project to the GitHub
repo inside the Cloudflare dashboard, you can stop using `deploy.sh` and just
run `push.sh` (Pages will auto-deploy on push).

## Notes on the counting rules

The rule set is a faithful reproduction of the
[IB Extended Essay guide](https://ibo.org) — not an official implementation. Use
a safe margin of ~50 words under 4,000. The IB has never published its exact
counting tool, and word processors disagree slightly on hyphenated compounds,
contractions, and numeric tokens.
