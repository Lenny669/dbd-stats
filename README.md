# DBD stats

Personal Dead by Daylight stats page, built from Steam Web API counters.

- `collect.mjs` reads the stats every 15 minutes (GitHub Actions, `.github/workflows/collect.yml`), saves the latest reading to `site/data/snap.json` and appends what changed to `site/data/sessions.json`.
- `site/index.html` is the page, published with GitHub Pages.

Setup: add the `STEAM_API_KEY` secret (Settings → Secrets and variables → Actions) and set Settings → Pages → Source to **GitHub Actions**.
