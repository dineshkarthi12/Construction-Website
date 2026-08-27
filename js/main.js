/* ==========================================================================
   From Ground Up — scroll-driven construction timelapse
   Vanilla JS. No build step, no dependencies.

   Scroll progress (0 → 1) is mapped onto the frame sequence (1 → FRAME_COUNT),
   so scrolling forward builds the building and scrolling back un-builds it.
   ========================================================================== */

(function () {
  'use strict';

  /* ========================================================================
     CONFIG — everything you are likely to change lives in this block.
     ======================================================================== */

  /* >>> CHANGE THE FRAME COUNT HERE <<<
     Must match the number of files produced by scripts/optimize-frames.js.
     The script prints the correct value when it finishes. */
  var FRAME_COUNT = 240;

  /* >>> CHANGE THE FRAME FOLDER PATHS HERE <<<
     Relative paths only (leading "./"), never absolute — an absolute "/public/..."
     would break when the site is served from a GitHub Pages project subpath
     such as https://user.github.io/Construction-Website/.
     Files are named frame-001.webp ... frame-NNN.webp (zero-padded to 3). */
  var FRAME_DIRS = {
    desktop: './public/frames/desktop/',
    mobile: './public/frames/mobile/'
  };
  var FRAME_PREFIX = 'frame-';
  var FRAME_EXT = '.webp';

  /* Viewports narrower than this (at load) use the mobile frame set.
     Keep in sync with the max-width breakpoint in css/style.css. */
  var MOBILE_BREAKPOINT = 768;

  /* >>> CHANGE THE CHECKPOINT PERCENTAGES HERE <<<
     Each entry is [fadeInStart, fadeOutEnd] as a fraction of total scroll.
     The key matches the panel's id in index.html.
     A panel starting at 0 has no fade-in; a panel ending at 1 has no fade-out. */
  var CHECKPOINTS = {
    hero: [0.00, 0.10],       //   0% – 10%   "From Ground Up"
    foundation: [0.20, 0.35], //  20% – 35%   "Foundation"
    structure: [0.45, 0.60],  //  45% – 60%   "Structure"
    finish: [0.70, 0.85],     //  70% – 85%   "Finish"
    cta: [0.90, 1.00]         //  90% – 100%  "Ready to build yours?"
  };

  /* How much of the scroll range each panel spends fading in / out. */
  var FADE_BAND = 0.035;

  /* Vertical travel of a panel as it fades, in pixels. Paired with opacity
     only — no layout properties are animated. */
  var PANEL_SHIFT = 24;

  /* Cap the backing-store scale. 2 is plenty for photographic frames and
     keeps the per-draw cost sane on high-DPI phones. */
  var MAX_DPR = 2;

  /* ======================================================================== */

  var canvas = document.getElementById('sequence');
  var ctx = canvas.getContext('2d', { alpha: false });
  var loader = document.getElementById('loader');
  var loaderPercent = document.getElementById('loader-percent');
  var loaderFill = document.getElementById('loader-fill');
  var progressBar = document.getElementById('progress-bar');
  var panels = Array.prototype.slice.call(document.querySelectorAll('.panel'));

  var prefersReducedMotion =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var images = [];
  var lastDrawnIndex = -1;   // guards against drawing the same frame twice
  var ticking = false;       // rAF throttle latch
  var viewW = 0;
  var viewH = 0;

  /** Returns the relative URL for a 1-based frame index. */
  function frameSrc(dir, index) {
    var padded = String(index);
    while (padded.length < 3) padded = '0' + padded;
    return dir + FRAME_PREFIX + padded + FRAME_EXT;
  }

  /** Picks the frame folder once, from the window width at load. */
  function chooseFrameDir() {
    return window.innerWidth < MOBILE_BREAKPOINT
      ? FRAME_DIRS.mobile
      : FRAME_DIRS.desktop;
  }

  function clamp01(value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }

  /* ------------------------------------------------------------------------
     Canvas sizing + "cover" drawing
     ------------------------------------------------------------------------ */

  /** Matches the backing store to the viewport and the device pixel ratio. */
  function resizeCanvas() {
    var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    viewW = window.innerWidth;
    viewH = window.innerHeight;

    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    canvas.style.width = viewW + 'px';
    canvas.style.height = viewH + 'px';

    // Draw in CSS pixels; the transform handles the DPR scaling.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * Draws an image with CSS `object-fit: cover` behaviour: scaled up until it
   * fills both axes, then centre-cropped. Never letterboxes, at any aspect.
   */
  function drawCover(img) {
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;

    var scale = Math.max(viewW / iw, viewH / ih);
    var dw = iw * scale;
    var dh = ih * scale;

    ctx.drawImage(img, (viewW - dw) / 2, (viewH - dh) / 2, dw, dh);
  }

  /** Draws frame `index` (0-based), skipping the work if it is already up. */
  function drawFrame(index) {
    if (index === lastDrawnIndex) return;

    var img = images[index];
    if (!img || !img.complete || !img.naturalWidth) return;

    drawCover(img);
    lastDrawnIndex = index;
  }

  /* ------------------------------------------------------------------------
     Scroll progress
     ------------------------------------------------------------------------ */

  /** Current scroll position as a 0 → 1 fraction of the scrollable range. */
  function scrollProgress() {
    var scrollable =
      document.documentElement.scrollHeight - window.innerHeight;
    if (scrollable <= 0) return 0;
    return clamp01(window.scrollY / scrollable);
  }

  /**
   * Opacity for a panel at the current progress: ramps up over FADE_BAND after
   * `start`, holds at 1, ramps down over FADE_BAND before `end`. Panels pinned
   * to 0 or 1 skip the corresponding ramp so the hero is visible at rest and
   * the CTA stays put at the bottom.
   */
  function panelOpacity(progress, start, end) {
    if (progress < start || progress > end) return 0;

    var band = Math.min(FADE_BAND, (end - start) / 2);
    var opacity = 1;

    if (start > 0 && progress < start + band) {
      opacity = (progress - start) / band;
    }
    if (end < 1 && progress > end - band) {
      opacity = Math.min(opacity, (end - progress) / band);
    }

    return clamp01(opacity);
  }

  /** Fades and nudges every panel for the current progress. */
  function updatePanels(progress) {
    for (var i = 0; i < panels.length; i++) {
      var panel = panels[i];
      var range = CHECKPOINTS[panel.id];
      if (!range) continue;

      var opacity = panelOpacity(progress, range[0], range[1]);
      var shift = (1 - opacity) * PANEL_SHIFT;

      panel.style.opacity = opacity;
      // Panels are centred with top:50%, so the -50% has to be preserved here.
      panel.style.transform =
        'translate3d(0, calc(-50% + ' + shift.toFixed(2) + 'px), 0)';

      // Only the visible panel should catch clicks.
      panel.classList.toggle('is-active', opacity > 0.5);
      panel.setAttribute('aria-hidden', opacity > 0.05 ? 'false' : 'true');
    }
  }

  /** One animation frame: progress bar, panels, and at most one image draw. */
  function render() {
    ticking = false;

    var progress = scrollProgress();

    progressBar.style.width = (progress * 100).toFixed(3) + '%';
    updatePanels(progress);

    // Map progress 0 → 1 onto frame index 1 → FRAME_COUNT (0-based internally).
    var index = Math.round(progress * (FRAME_COUNT - 1));
    if (index < 0) index = 0;
    if (index > FRAME_COUNT - 1) index = FRAME_COUNT - 1;

    // drawFrame() is a no-op when this index is already on screen, so a burst
    // of scroll events never repaints the same frame twice.
    drawFrame(index);
  }

  /** Coalesces scroll/resize bursts into a single rAF-throttled render. */
  function requestRender() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(render);
  }

  function onResize() {
    resizeCanvas();
    lastDrawnIndex = -1;   // force a repaint at the new size
    requestRender();
  }

  /* ------------------------------------------------------------------------
     Preloading
     ------------------------------------------------------------------------ */

  /**
   * Loads every frame into an Image array, reporting progress to the loader.
   * Failed frames still count towards completion so a single 404 cannot hang
   * the page behind the loading screen forever.
   */
  function preloadFrames(dir, onProgress, onDone) {
    var loaded = 0;

    function step() {
      loaded++;
      onProgress(loaded / FRAME_COUNT);
      if (loaded === FRAME_COUNT) onDone();
    }

    for (var i = 0; i < FRAME_COUNT; i++) {
      var img = new Image();
      img.decoding = 'async';
      img.addEventListener('load', step, { once: true });
      img.addEventListener('error', step, { once: true });
      img.src = frameSrc(dir, i + 1);
      images.push(img);
    }
  }

  function setLoaderProgress(fraction) {
    var percent = Math.round(fraction * 100);
    loaderPercent.textContent = percent + '%';
    loaderFill.style.width = percent + '%';
  }

  function hideLoader() {
    loader.classList.add('is-hidden');
  }

  /* ------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */

  /**
   * Reduced-motion path: no sequence, no scroll driving. Load the final frame
   * only, paint it once as a static background, and leave every panel visible
   * (the CSS puts them back into normal document flow).
   */
  function startStatic() {
    var dir = chooseFrameDir();
    var img = new Image();

    img.addEventListener('load', function () {
      images[FRAME_COUNT - 1] = img;
      drawCover(img);
    }, { once: true });

    img.src = frameSrc(dir, FRAME_COUNT);

    window.addEventListener('resize', function () {
      resizeCanvas();
      if (img.complete && img.naturalWidth) drawCover(img);
    });

    hideLoader();
  }

  /** Full scroll-driven path. */
  function startSequence() {
    var dir = chooseFrameDir();

    preloadFrames(dir, setLoaderProgress, function () {
      hideLoader();
      lastDrawnIndex = -1;
      requestRender();
    });

    window.addEventListener('scroll', requestRender, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
  }

  function init() {
    resizeCanvas();

    if (prefersReducedMotion) {
      startStatic();
      return;
    }

    // Paint the opening state before anything loads so the first frame does
    // not pop in against an empty canvas.
    updatePanels(scrollProgress());
    startSequence();
  }

  init();
})();
