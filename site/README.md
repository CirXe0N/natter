# Natter site

The landing page and the end-user docs, as a static site with no
dependencies. Pages are HTML fragments in `src/`; `build.mjs` wraps them in
the shared layout, builds the docs sidebar, "On this page" lists and
prev/next links, and writes `dist/`.

```sh
node site/build.mjs                       # writes site/dist
python3 -m http.server -d site/dist 8099  # preview at http://127.0.0.1:8099
```

- **Version.** In Actions the build reads the latest published GitHub
  release, so download links and version text follow it. Locally it uses the
  latest `v*` git tag; set `NATTER_FETCH_LATEST=1` to ask GitHub instead, or
  `NATTER_VERSION` to override both.
- **Base path.** Links are relative, so the site works at any path. Only
  `404.html` needs absolute links: set `SITE_BASE` (default `/natter/`, the
  GitHub Pages project path; `/` on a custom domain).
- **Add a docs page.** Write `src/docs/<slug>.html` (start it with a
  `<!-- description: … -->` comment, no `<h1>`) and add it to `nav` in
  `build.mjs`. Every `<h2>` lands in "On this page".
- **Screenshots** in `src/assets/screens/` are real captures of the app
  against `internal/e2eserver`, at 2× and saved as WebP.

## Publish

`.github/workflows/pages.yml` builds and deploys to GitHub Pages. It runs when
a release is published, so the site always links the newest release, and can be
started by hand (Actions → pages → Run workflow). Enable Pages first
(Settings → Pages → Source: GitHub Actions). Pages sites are public, even for a
private repository, and Pages on a private repository needs a paid plan, so
publishing a release also publishes the site.

NATS™ is a trademark of the Linux Foundation; keep the footer notice (ADR-0004).
