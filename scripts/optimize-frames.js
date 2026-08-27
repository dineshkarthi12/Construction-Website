#!/usr/bin/env node
/**
 * optimize-frames.js
 *
 * Converts the original construction-timelapse JPGs into two WebP sets:
 *
 *   public/frames/desktop/frame-001.webp ... → width 1280, quality 72
 *   public/frames/mobile/frame-001.webp  ... → width  720, quality 65
 *
 * The source JPGs are only ever read, never modified or deleted.
 *
 * Usage:  node scripts/optimize-frames.js     (or: npm run optimize)
 *
 * ---------------------------------------------------------------------------
 * TO POINT THIS AT A DIFFERENT SOURCE FOLDER OR FILENAME PATTERN,
 * edit SOURCE_DIR / SOURCE_PATTERN in the CONFIG block below.
 * TO CHANGE OUTPUT SIZES OR QUALITY, edit the OUTPUTS array.
 * ---------------------------------------------------------------------------
 */

'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

// ============================ CONFIG =======================================

const ROOT = path.join(__dirname, '..');

/** Folder holding the untouched original frames. */
const SOURCE_DIR = path.join(ROOT, 'frames');

/** Matches `ezgif-frame-001.jpg`; capture group 1 is the zero-padded index. */
const SOURCE_PATTERN = /^ezgif-frame-(\d{3})\.jpe?g$/i;

/** One entry per output set. `name` is also the destination folder name. */
const OUTPUTS = [
  { name: 'desktop', dir: path.join(ROOT, 'public', 'frames', 'desktop'), width: 1280, quality: 72 },
  { name: 'mobile', dir: path.join(ROOT, 'public', 'frames', 'mobile'), width: 720, quality: 65 },
];

/** How many frames to encode at once. Keeps memory flat on large sequences. */
const CONCURRENCY = 8;

// ===========================================================================

/** Human-readable byte size, e.g. 1234567 → "1.18 MB". */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(2)} ${units[unit]}`;
}

/**
 * Collects the source frames, sorted by their numeric index (not by string
 * order), so the output sequence matches the timelapse order exactly.
 */
async function collectSourceFrames() {
  let entries;
  try {
    entries = await fsp.readdir(SOURCE_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        `Source folder not found: ${SOURCE_DIR}\n` +
          'Extract the original frames there, or update SOURCE_DIR in this script.'
      );
    }
    throw err;
  }

  const frames = [];
  for (const entry of entries) {
    const match = SOURCE_PATTERN.exec(entry);
    if (!match) continue;
    frames.push({ index: Number(match[1]), file: path.join(SOURCE_DIR, entry) });
  }

  if (frames.length === 0) {
    throw new Error(
      `No files matching ${SOURCE_PATTERN} were found in ${SOURCE_DIR}.`
    );
  }

  frames.sort((a, b) => a.index - b.index);

  // Warn (but do not fail) if the sequence has holes — a gap would show up as
  // a stutter on the site, and it is worth knowing about now rather than then.
  const expected = frames.length;
  const last = frames[frames.length - 1].index;
  if (frames[0].index !== 1 || last !== expected) {
    console.warn(
      `! Sequence looks non-contiguous: ${expected} files spanning ` +
        `${frames[0].index}..${last}. Output is still written in sorted order.`
    );
  }

  return frames;
}

/** Encodes one source frame into one output set. Returns the bytes written. */
async function encodeFrame(frame, output) {
  const target = path.join(
    output.dir,
    `frame-${String(frame.index).padStart(3, '0')}.webp`
  );

  await sharp(frame.file)
    .resize({ width: output.width, withoutEnlargement: true })
    // effort 6 spends more CPU searching for a smaller file at the *same*
    // visual quality. This is a one-off build step, so the trade is free.
    .webp({ quality: output.quality, effort: 6 })
    .toFile(target);

  const { size } = await fsp.stat(target);
  return size;
}

/** Runs `worker` over `items` with a bounded number of parallel tasks. */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  });

  await Promise.all(runners);
  return results;
}

async function main() {
  const frames = await collectSourceFrames();

  const sourceBytes = frames.reduce(
    (total, frame) => total + fs.statSync(frame.file).size,
    0
  );

  console.log(`Source : ${path.relative(ROOT, SOURCE_DIR)}`);
  console.log(`Frames : ${frames.length} (${formatBytes(sourceBytes)})\n`);

  const summary = [];

  for (const output of OUTPUTS) {
    await fsp.mkdir(output.dir, { recursive: true });

    const startedAt = Date.now();
    process.stdout.write(
      `Encoding ${output.name} (${output.width}px, q${output.quality}) ... `
    );

    const sizes = await mapWithConcurrency(frames, CONCURRENCY, (frame) =>
      encodeFrame(frame, output)
    );

    const totalBytes = sizes.reduce((total, size) => total + size, 0);
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`done in ${seconds}s`);

    summary.push({ ...output, totalBytes, frames: sizes.length });
  }

  console.log('\n--- Totals ---------------------------------------------');
  console.log(
    `originals            ${String(frames.length).padStart(4)} files   ` +
      `${formatBytes(sourceBytes).padStart(10)}   ${sourceBytes} bytes`
  );

  for (const set of summary) {
    // Positive = smaller than the originals, negative = larger. The source
    // JPGs are already lossy, so a same-width WebP set can legitimately grow.
    const delta = (1 - set.totalBytes / sourceBytes) * 100;
    const label =
      delta >= 0
        ? `${delta.toFixed(1)}% smaller than source`
        : `${Math.abs(delta).toFixed(1)}% larger than source`;
    console.log(
      `public/frames/${set.name.padEnd(8)}${String(set.frames).padStart(4)} files   ` +
        `${formatBytes(set.totalBytes).padStart(10)}   ${String(set.totalBytes).padStart(9)} bytes   ` +
        `(${label})`
    );
  }
  console.log('--------------------------------------------------------');
  console.log(
    `\nRemember: FRAME_COUNT in js/main.js must equal ${frames.length}.`
  );
}

main().catch((err) => {
  console.error(`\noptimize-frames failed: ${err.message}`);
  process.exitCode = 1;
});
