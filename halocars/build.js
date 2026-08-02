#!/usr/bin/env node
/**
 * HALO AUTOS — build step
 * Scans /cars, generates dist/data/inventory.json, copies images + site shell.
 * Zero npm dependencies. Node 22+.
 *
 * Drop a folder into /cars, push to GitHub, Netlify rebuilds. That's the whole flow.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CARS_DIR = path.join(ROOT, 'cars');
const SRC_DIR = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);
const MAKES = ['Toyota', 'Honda', 'Nissan', 'Hyundai', 'Kia', 'Mercedes-Benz', 'Mercedes', 'BMW', 'Audi',
  'Volkswagen', 'Ford', 'Chevrolet', 'Mazda', 'Mitsubishi', 'Lexus', 'Land Rover', 'Range Rover',
  'Jeep', 'Suzuki', 'Peugeot', 'Renault', 'Subaru', 'Infiniti', 'Acura', 'Volvo', 'Porsche', 'Tesla',
  'Chery', 'Changan', 'Haval', 'Geely', 'BYD', 'Isuzu', 'Daf', 'Scania', 'Man'];

/* ---------------------------------------------------------------- helpers */

const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

/** "2019-toyota-camry-se" -> { year, make, model } */
function parseSlug(slug) {
  const words = slug.split(/[-_\s]+/).filter(Boolean);
  let year = null;
  const yi = words.findIndex((w) => /^(19|20)\d{2}$/.test(w));
  if (yi > -1) { year = Number(words[yi]); words.splice(yi, 1); }

  let make = '';
  const lower = words.map((w) => w.toLowerCase());
  for (const m of MAKES) {
    const parts = m.toLowerCase().split(/[-\s]/);
    if (parts.every((p, i) => lower[i] === p)) { make = m; words.splice(0, parts.length); break; }
  }
  if (!make && words.length) { make = titleCase(words.shift()); }

  return { year, make, model: titleCase(words.join(' ')) };
}

/** Write a car.json stub so there is always something to edit. */
function ensureCarFile(dir, slug) {
  const file = path.join(dir, 'car.json');
  if (fs.existsSync(file)) return readJSON(file, {});

  const { year, make, model } = parseSlug(slug);
  const stub = {
    title: [year, make, model].filter(Boolean).join(' ') || titleCase(slug.replace(/-/g, ' ')),
    make, model, year,
    price: 0,
    negotiable: true,
    condition: 'Foreign Used',
    registration: 'Registered',
    mileage: null,
    transmission: 'Automatic',
    fuel: 'Petrol',
    engine: '',
    drivetrain: '',
    bodyType: '',
    colour: '',
    interior: '',
    seats: 5,
    location: 'Kumasi',
    status: 'available',
    featured: false,
    sortOrder: 100,
    description: 'Add the sales pitch here. Two or three lines is plenty.',
    features: [],
    cover: ''
  };
  fs.writeFileSync(file, JSON.stringify(stub, null, 2) + '\n');
  console.log(`  + created cars/${slug}/car.json — fill in the price and details`);
  return stub;
}

/** Photos sort: cover first, then filename order. Prefix files 01_, 02_ to control it. */
function collectPhotos(dir, coverHint) {
  const files = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  if (coverHint) {
    const i = files.findIndex((f) => f.toLowerCase() === coverHint.toLowerCase());
    if (i > 0) files.unshift(files.splice(i, 1)[0]);
  } else {
    const i = files.findIndex((f) => /^(cover|main|front)/i.test(f));
    if (i > 0) files.unshift(files.splice(i, 1)[0]);
  }
  return files;
}

/* ------------------------------------------------------------------ build */

function build() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST, 'data'), { recursive: true });

  // 1. site shell
  fs.cpSync(SRC_DIR, DIST, { recursive: true });

  // 2. brand + contact config
  const site = readJSON(path.join(ROOT, 'data', 'site.json'), {});

  // 3. scan the cars folder
  if (!fs.existsSync(CARS_DIR)) fs.mkdirSync(CARS_DIR, { recursive: true });
  const slugs = fs.readdirSync(CARS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
    .map((e) => e.name);

  const cars = [];
  for (const slug of slugs) {
    const dir = path.join(CARS_DIR, slug);
    const meta = ensureCarFile(dir, slug);
    const photos = collectPhotos(dir, meta.cover);

    if (!photos.length) {
      console.warn(`  ! skipped cars/${slug} — no photos in the folder yet`);
      continue;
    }
    if (meta.hidden === true) {
      console.log(`  · hidden cars/${slug}`);
      continue;
    }

    // copy photos into dist/cars/<slug>/
    const out = path.join(DIST, 'cars', slug);
    fs.mkdirSync(out, { recursive: true });
    for (const p of photos) fs.copyFileSync(path.join(dir, p), path.join(out, p));

    const fallback = parseSlug(slug);
    cars.push({
      slug,
      title: meta.title || [fallback.year, fallback.make, fallback.model].filter(Boolean).join(' '),
      make: meta.make || fallback.make || '',
      model: meta.model || fallback.model || '',
      year: meta.year ?? fallback.year ?? null,
      price: Number(meta.price) || 0,
      negotiable: meta.negotiable !== false,
      condition: meta.condition || '',
      registration: meta.registration || '',
      mileage: meta.mileage ?? null,
      transmission: meta.transmission || '',
      fuel: meta.fuel || '',
      engine: meta.engine || '',
      drivetrain: meta.drivetrain || '',
      bodyType: meta.bodyType || '',
      colour: meta.colour || meta.color || '',
      interior: meta.interior || '',
      seats: meta.seats ?? null,
      location: meta.location || site.location || '',
      status: (meta.status || 'available').toLowerCase(),
      featured: meta.featured === true,
      sortOrder: Number(meta.sortOrder) || 100,
      description: meta.description || '',
      features: Array.isArray(meta.features) ? meta.features : [],
      photos: photos.map((p) => `cars/${slug}/${p}`),
      addedAt: fs.statSync(dir).birthtimeMs || Date.now()
    });
  }

  // featured first, then sortOrder, then newest folder
  cars.sort((a, b) =>
    (b.featured - a.featured) || (a.sortOrder - b.sortOrder) || (b.addedAt - a.addedAt));

  const payload = { site, cars, builtAt: new Date().toISOString() };
  fs.writeFileSync(path.join(DIST, 'data', 'inventory.json'), JSON.stringify(payload, null, 2));

  const live = cars.filter((c) => c.status !== 'sold').length;
  console.log(`\nHALO AUTOS — ${cars.length} listing(s) built, ${live} available. Output: dist/\n`);
}

build();
