/* HALO AUTOS — storefront logic. No framework, no build step for this file. */
(() => {
  'use strict';

  let SITE = {}, CARS = [], VIEW = [];
  const $ = (id) => document.getElementById(id);

  /* ------------------------------------------------------- utilities */

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const money = (n) => new Intl.NumberFormat('en-GH').format(Math.round(n));

  /** 0244123456 / +233244123456 / 233244123456 -> 233244123456 */
  function waNumber(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('233')) return d;
    if (d.startsWith('0')) return '233' + d.slice(1);
    if (d.length === 9) return '233' + d;
    return d;
  }

  const waLink = (text) =>
    `https://wa.me/${waNumber(SITE.whatsapp || SITE.phone)}?text=${encodeURIComponent(text)}`;

  const priceLabel = (c) =>
    c.price > 0 ? `${SITE.currency || 'GHS'} ${money(c.price)}` : 'Price on request';

  /* ------------------------------------------------------- rendering */

  function card(c) {
    const statusClass = c.status === 'sold' ? 'card-sold' : '';
    const warp = `warp-${['sold', 'reserved'].includes(c.status) ? c.status : 'available'}`;

    let tag = '';
    if (c.status === 'sold') tag = '<span class="tag tag-sold">Sold</span>';
    else if (c.status === 'reserved') tag = '<span class="tag tag-reserved">Reserved</span>';
    else if (c.featured) tag = '<span class="tag tag-featured">Featured</span>';

    const specs = [
      c.year, c.mileage ? `${money(c.mileage)} km` : null, c.transmission, c.fuel, c.condition
    ].filter(Boolean).map((s) => `<span>${esc(s)}</span>`).join('');

    return `
      <article class="card ${statusClass}" data-slug="${esc(c.slug)}" tabindex="0" role="button"
               aria-label="View ${esc(c.title)}">
        <div class="card-warp ${warp}" aria-hidden="true"></div>
        <div class="card-photo">
          <img src="${esc(c.photos[0])}" alt="${esc(c.title)}" loading="lazy" decoding="async">
          ${tag}
          ${c.photos.length > 1 ? `<span class="photo-count">${c.photos.length} photos</span>` : ''}
        </div>
        <div class="card-body">
          <h2 class="card-title">${esc(c.title)}</h2>
          <p class="card-price">${esc(priceLabel(c))}
            ${c.price > 0 && c.negotiable ? '<small>negotiable</small>' : ''}</p>
          <div class="card-specs">${specs}</div>
        </div>
      </article>`;
  }

  function render() {
    const grid = $('grid');
    grid.innerHTML = VIEW.map(card).join('');
    $('empty').hidden = VIEW.length > 0;
    $('resultLine').textContent =
      VIEW.length ? `${VIEW.length} ${VIEW.length === 1 ? 'car' : 'cars'} listed` : '';
  }

  /* ------------------------------------------------------- filtering */

  function apply() {
    const q = $('q').value.trim().toLowerCase();
    const make = $('fMake').value;
    const body = $('fBody').value;
    const band = $('fPrice').value;
    const sort = $('fSort').value;
    const hideSold = $('fAvailable').getAttribute('aria-pressed') === 'true';

    VIEW = CARS.filter((c) => {
      if (hideSold && c.status === 'sold') return false;
      if (make && c.make !== make) return false;
      if (body && c.bodyType !== body) return false;
      if (band) {
        const [lo, hi] = band.split('-').map(Number);
        if (!(c.price >= lo && c.price <= hi)) return false;
      }
      if (q) {
        const hay = [c.title, c.make, c.model, c.year, c.bodyType, c.colour, c.condition,
          c.location, ...(c.features || [])].join(' ').toLowerCase();
        if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      return true;
    });

    const num = (v, fb) => (v === null || v === undefined || v === 0 ? fb : v);
    if (sort === 'price-asc') VIEW.sort((a, b) => num(a.price, 9e12) - num(b.price, 9e12));
    if (sort === 'price-desc') VIEW.sort((a, b) => num(b.price, -1) - num(a.price, -1));
    if (sort === 'year-desc') VIEW.sort((a, b) => num(b.year, 0) - num(a.year, 0));
    if (sort === 'mileage-asc') VIEW.sort((a, b) => num(a.mileage, 9e12) - num(b.mileage, 9e12));

    render();
  }

  /* ------------------------------------------------------- detail sheet */

  function openSheet(slug) {
    const c = CARS.find((x) => x.slug === slug);
    if (!c) return;

    const specs = [
      ['Year', c.year], ['Mileage', c.mileage ? `${money(c.mileage)} km` : ''],
      ['Transmission', c.transmission], ['Fuel', c.fuel], ['Engine', c.engine],
      ['Drivetrain', c.drivetrain], ['Body type', c.bodyType], ['Colour', c.colour],
      ['Interior', c.interior], ['Seats', c.seats], ['Condition', c.condition],
      ['Registration', c.registration], ['Location', c.location]
    ].filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `<div class="spec"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');

    const msg = `Hello ${SITE.brand || 'Halo Autos'}, I'm interested in the ${c.title} (${priceLabel(c)}). Is it still available?`;

    const cta = c.status === 'sold'
      ? `<div class="sold-note">This one has found a new owner. Message us and we'll tell you what's coming into the yard next.</div>
         <div class="sheet-cta">
           <a class="btn btn-ghost btn-block" href="${waLink(`Hello ${SITE.brand}, the ${c.title} is sold. What else do you have like it?`)}" target="_blank" rel="noopener">Ask for something similar</a>
         </div>`
      : `<div class="sheet-cta">
           <a class="btn btn-gold btn-block" href="${waLink(msg)}" target="_blank" rel="noopener">Ask about this car on WhatsApp</a>
           <a class="btn btn-ghost btn-block" href="tel:${esc(SITE.phone || '')}">Call ${esc(SITE.phone || '')}</a>
         </div>`;

    $('sheetBody').innerHTML = `
      <div class="gallery">
        ${c.photos.map((p, i) =>
          `<img src="${esc(p)}" alt="${esc(c.title)} — photo ${i + 1}" loading="${i ? 'lazy' : 'eager'}">`).join('')}
      </div>
      ${c.photos.length > 1 ? '<p class="gallery-hint">Swipe for more photos</p>' : ''}
      <div class="sheet-main">
        <h2 class="sheet-title" id="sheetTitle">${esc(c.title)}</h2>
        <p class="sheet-price">${esc(priceLabel(c))}</p>
        <p class="sheet-sub">${c.price > 0 && c.negotiable ? 'Price negotiable · ' : ''}${esc(c.location || '')}</p>
        ${c.description ? `<p class="sheet-desc">${esc(c.description)}</p>` : ''}
        ${specs ? `<dl class="spec-table">${specs}</dl>` : ''}
        ${c.features?.length ? `<ul class="feature-list">${c.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
        ${cta}
      </div>`;

    $('sheet').hidden = false;
    document.body.style.overflow = 'hidden';
    history.replaceState(null, '', '#' + slug);
    $('sheetClose').focus();
  }

  function closeSheet() {
    $('sheet').hidden = true;
    document.body.style.overflow = '';
    history.replaceState(null, '', location.pathname);
  }

  /* ------------------------------------------------------- chrome */

  function paintSite() {
    document.title = `${SITE.brand || 'Halo Autos'} — Cars for sale in Ghana`;
    $('heroLocation').textContent = SITE.location || '';
    $('heroTagline').textContent = SITE.tagline || 'Cars worth the drive home.';
    $('heroIntro').textContent = SITE.intro || '';
    $('footBrand').textContent = SITE.brand || 'Halo Autos';
    $('footAddress').textContent = SITE.address || '';
    $('footHours').textContent = SITE.hours || '';
    $('headerWhatsapp').href = waLink(`Hello ${SITE.brand || 'Halo Autos'}, I saw your cars online.`);

    const live = CARS.filter((c) => c.status === 'available').length;
    $('stockCount').textContent = `${live} in stock`;

    const years = CARS.map((c) => c.year).filter(Boolean);
    $('heroMeta').innerHTML = [
      `<span><strong>${live}</strong> available now</span>`,
      years.length ? `<span>Model years <strong>${Math.min(...years)}–${Math.max(...years)}</strong></span>` : '',
      SITE.hours ? `<span>Open <strong>${esc(SITE.hours)}</strong></span>` : ''
    ].filter(Boolean).join('');

    $('footContact').innerHTML = [
      SITE.phone ? `<a href="tel:${esc(SITE.phone)}">${esc(SITE.phone)}</a>` : '',
      SITE.email ? `<a href="mailto:${esc(SITE.email)}">${esc(SITE.email)}</a>` : '',
      `<a href="${waLink('Hello, I have a question.')}" target="_blank" rel="noopener">WhatsApp us</a>`,
      SITE.instagram ? `<a href="${esc(SITE.instagram)}" target="_blank" rel="noopener">Instagram</a>` : '',
      SITE.tiktok ? `<a href="${esc(SITE.tiktok)}" target="_blank" rel="noopener">TikTok</a>` : '',
      SITE.facebook ? `<a href="${esc(SITE.facebook)}" target="_blank" rel="noopener">Facebook</a>` : ''
    ].filter(Boolean).join('');

    fill('fMake', [...new Set(CARS.map((c) => c.make).filter(Boolean))].sort());
    fill('fBody', [...new Set(CARS.map((c) => c.bodyType).filter(Boolean))].sort());
  }

  function fill(id, values) {
    const sel = $(id);
    for (const v of values) {
      const o = document.createElement('option');
      o.value = o.textContent = v;
      sel.appendChild(o);
    }
  }

  /* ------------------------------------------------------- wiring */

  function wire() {
    ['q', 'fMake', 'fBody', 'fPrice', 'fSort'].forEach((id) =>
      $(id).addEventListener('input', apply));

    $('fAvailable').addEventListener('click', (e) => {
      const on = e.currentTarget.getAttribute('aria-pressed') === 'true';
      e.currentTarget.setAttribute('aria-pressed', String(!on));
      e.currentTarget.textContent = !on ? 'Showing available only' : 'Hide sold';
      apply();
    });

    $('clearFilters').addEventListener('click', () => {
      $('q').value = ''; $('fMake').value = ''; $('fBody').value = '';
      $('fPrice').value = ''; $('fSort').value = 'default';
      $('fAvailable').setAttribute('aria-pressed', 'false');
      $('fAvailable').textContent = 'Hide sold';
      VIEW = CARS.slice(); render();
    });

    $('grid').addEventListener('click', (e) => {
      const el = e.target.closest('.card');
      if (el) openSheet(el.dataset.slug);
    });
    $('grid').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = e.target.closest('.card');
      if (el) { e.preventDefault(); openSheet(el.dataset.slug); }
    });

    $('sheetClose').addEventListener('click', closeSheet);
    $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('sheet').hidden) closeSheet();
    });
  }

  /* ------------------------------------------------------- boot */

  fetch('data/inventory.json', { cache: 'no-cache' })
    .then((r) => r.json())
    .then((data) => {
      SITE = data.site || {};
      CARS = data.cars || [];
      VIEW = CARS.slice();
      paintSite();
      wire();
      render();
      const slug = decodeURIComponent(location.hash.slice(1));
      if (slug) openSheet(slug);
    })
    .catch(() => {
      $('grid').innerHTML =
        '<p style="color:#8D887F">The inventory file did not load. Run <code>npm run build</code>, then refresh.</p>';
    });
})();
