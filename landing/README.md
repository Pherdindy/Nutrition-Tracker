# lazymacros.com — marketing landing page

Static, single-file landing page for the Lazy Macros app. Deliberately kept out of
`www/` so it is **not** bundled into the Android app by `npx cap sync android`.

## Files
- `index.html` — the whole page: markup, inline CSS, ~15 lines of JS (theme toggle + year).
  No build step, no dependencies, no external requests.
- `CNAME` — custom-domain record for GitHub Pages.

## Preview locally
```
npx http-server landing -p 8081 -c-1     # → http://localhost:8081
```
Or just open `landing/index.html` in a browser — it has no server requirements.

## Deploy (GitHub Pages)
1. Repo → Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/landing`.
   (If Pages only offers `/` or `/docs`, publish from a `gh-pages` branch instead:
   `git subtree push --prefix landing origin gh-pages`.)
2. Settings → Pages → Custom domain: `lazymacros.com`, then tick *Enforce HTTPS*.
3. At the DNS registrar:
   - `A` records for the apex `lazymacros.com` → `185.199.108.153`, `185.199.109.153`,
     `185.199.110.153`, `185.199.111.153`
   - `CNAME` for `www` → `pherdindy.github.io`

Any static host works equally well (Netlify, Cloudflare Pages, S3) — point it at this folder.

## Before going live
- **`og.png`** — the Open Graph tags reference `https://lazymacros.com/og.png`, which does not
  exist yet. Drop a 1200×630 preview image at `landing/og.png` or remove the two `og:image`/
  `twitter:card` tags, otherwise link previews fall back to a bare text card.
- **Download link** — the primary CTA points at the GitHub releases page. Swap both
  `#get` section links for the Play Store URL once the listing is live.
- **Screenshots** — the phone and panel mockups are hand-built HTML/CSS, not captures. They
  mirror the real UI (food cards, day cards, assessment scorecard) but will drift if the app
  changes; replace them with real screenshots when the Play listing assets are made.

## Theme
Mirrors the app's palette (`--navy #16324f`, `--brand #2bb673`, plus the app's dark/light
surface tokens). The toggle stores its choice in `localStorage` under `lm_site_theme` — a
separate key from the app's `nt_theme` — and defaults to `prefers-color-scheme`.
