# From Ground Up — Scroll-Driven Construction Timelapse

A single-page site where scroll position scrubs a 240-frame construction
timelapse. Scrolling forward raises the building from a bare foundation to a
finished, illuminated office block at dusk; scrolling back takes it down again.

Static and dependency-free at runtime: vanilla JS, no build step, no framework,
no CDN animation library. The only build-time dependency is
[`sharp`](https://sharp.pixelplumbing.com/), used once to convert the source
JPGs to WebP.

---

## Project structure

```
index.html                      markup + section copy
css/style.css                   all styling, scroll length, reduced-motion rules
js/main.js                      canvas sequence, scroll mapping, checkpoints
scripts/optimize-frames.js      JPG → WebP conversion
frames/                         original JPGs (source of truth, never modified)
public/frames/desktop/          frame-001.webp … frame-240.webp  (1280px, q72)
public/frames/mobile/           frame-001.webp … frame-240.webp  ( 720px, q65)
.nojekyll                       stops GitHub Pages hiding folders from Jekyll
```

## Running it locally

There is nothing to compile. Serve the folder over HTTP — opening
`index.html` from the filesystem will not work, because the browser blocks
canvas pixel access for `file://` images.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Regenerating the frames

`scripts/optimize-frames.js` reads every original JPG from `frames/` and writes
two WebP sets. It never modifies or deletes the source files.

```bash
npm install          # installs sharp as a devDependency
npm run optimize     # or: node scripts/optimize-frames.js
```

It prints the total byte size of each set when it finishes, and reminds you of
the frame count to put in `js/main.js`.

To change the source folder, the filename pattern, or the output sizes and
quality, edit the `CONFIG` block at the top of the script:

| Constant | Purpose |
| --- | --- |
| `SOURCE_DIR` | Folder holding the original frames |
| `SOURCE_PATTERN` | Regex matching the source filenames; group 1 is the index |
| `OUTPUTS` | One entry per output set — folder, width, quality |
| `CONCURRENCY` | How many frames are encoded in parallel |

> **Note on output size.** The source JPGs are already heavily compressed
> (~42 KB each). At the same 1280px width, WebP q72 is therefore *larger* than
> the source (16.5 MB vs 9.7 MB); the 720px mobile set is smaller (7.8 MB).
> This is expected, not a bug — you cannot losslessly re-compress an
> already-lossy image. Lower `quality` in `OUTPUTS` if you want the desktop set
> smaller, at some cost in visible artefacting on the sky and cloud gradients.

---

## Where to change things

### Frame count

`js/main.js`, at the top of the `CONFIG` block:

```js
var FRAME_COUNT = 240;
```

This must equal the number of files in each `public/frames/*` folder. The
optimizer prints the correct value on every run.

### Frame folder paths

Same `CONFIG` block, immediately below:

```js
var FRAME_DIRS = {
  desktop: './public/frames/desktop/',
  mobile:  './public/frames/mobile/'
};
```

Paths **must stay relative** (leading `./`). An absolute `/public/...` breaks
under a GitHub Pages project subpath such as
`https://<user>.github.io/Construction-Website/`.

The folder is chosen once, from `window.innerWidth` at load, against
`MOBILE_BREAKPOINT` (768px — keep it in sync with the media query in
`css/style.css`).

### Section copy

`index.html`. Each overlay is a `<section class="panel" id="...">` inside
`#overlays`. Edit the text in place; the `id` is what links it to its
checkpoint.

### Checkpoint percentages

`js/main.js`, the `CHECKPOINTS` map — the single source of truth for when each
panel is on screen. Values are fractions of total scroll:

```js
var CHECKPOINTS = {
  hero:       [0.00, 0.10],   //   0% – 10%
  foundation: [0.20, 0.35],   //  20% – 35%
  structure:  [0.45, 0.60],   //  45% – 60%
  finish:     [0.70, 0.85],   //  70% – 85%
  cta:        [0.90, 1.00]    //  90% – 100%
};
```

Keys must match the panel `id`s in `index.html`. `FADE_BAND` next to it
controls how much of the range each panel spends fading; `PANEL_SHIFT` is the
vertical travel in pixels.

### Scroll length

`css/style.css`, the `.scroll-space` rule: `500vh` on desktop, `350vh` inside
the `max-width: 767px` media query. Longer means slower, finer scrubbing.

---

## How it works

- A `<canvas>` is fixed full-screen as the background layer. A separate empty
  `.scroll-space` div supplies the page's scroll length; nothing else scrolls.
- Scroll progress is `scrollY / (scrollHeight - innerHeight)`, clamped to 0–1,
  and mapped to a frame index with `Math.round(progress * (FRAME_COUNT - 1))`.
- Drawing is throttled through `requestAnimationFrame`, and `drawFrame()`
  early-returns when the requested index is already on screen — so a burst of
  scroll events never repaints the same frame twice.
- Frames are drawn with `object-fit: cover` behaviour: scaled until they fill
  both axes, then centre-cropped. No letterboxing at any aspect ratio. The
  canvas backing store tracks `devicePixelRatio`, capped at 2.
- All frames are preloaded into an `Image` array before the sequence starts,
  behind a centered loader with a live percentage. Failed frames still count
  toward completion, so one 404 cannot hang the page on the loading screen.
- Overlay panels are faded with `opacity` and `transform` only — no layout
  properties are animated.

## Accessibility

With `prefers-reduced-motion: reduce`, the sequence is skipped entirely: only
the final frame is fetched and painted once as a static background, the scroll
spacer, loader and progress bar are removed, and every panel is shown at full
opacity in normal document flow as a readable stacked article.

Panels are `aria-hidden` while faded out and only the visible one accepts
pointer events, so off-screen copy is not announced or clickable.

## Browser support

Requires WebP and canvas 2D — every current browser. Tested in Chromium at
1440×900, 900×1200 and 390×844, plus the reduced-motion path.

## Deploying

Every asset path is relative, so the site works from a domain root or a
subpath without changes. There is no build step on either host.

### Netlify (recommended)

`netlify.toml` at the repo root configures the deploy: publish directory `.`,
no build command, and long-lived immutable caching for `public/frames/*` so
repeat visitors do not re-download 240 images.

1. Sign in at <https://app.netlify.com> with GitHub.
2. **Add new site** → **Import an existing project** → **GitHub**.
3. Authorise Netlify and pick `dineshkarthi12/Construction-Website`.
4. Leave the build settings alone — `netlify.toml` already sets them. Build
   command must stay **empty** and publish directory **`.`**.
5. **Deploy site.**

Netlify assigns a random URL such as `random-name-123456.netlify.app`, which
you can change under **Site configuration → Site details → Change site name**.
Every push to `main` redeploys automatically.

To deploy from the CLI instead:

```bash
npm install -g netlify-cli
netlify login
netlify deploy --prod
```

### GitHub Pages

`.nojekyll` at the root stops Jekyll from stripping the `public/` and `js/`
folders. Pages must be enabled first — it is off by default and the site 404s
until it is switched on:

**Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)`
→ Save.**

A `pages build and deployment` run appears under the Actions tab once it is
enabled; if no run appears, the setting did not save. The published URL is
`https://<user>.github.io/Construction-Website/`.
