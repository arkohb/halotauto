# Halo Autos

A folder-driven car sales site. Drop photos into a folder, push, and the listing appears.
Zero npm dependencies. Node 22+. Deploys to Netlify.

---

## The daily flow (this is the whole thing)

1. Make a folder inside `cars/` named `year-make-model`:

   ```
   cars/2019-toyota-camry-se/
   ```

2. Paste the photos in. Name them `01.jpg`, `02.jpg`, `03.jpg`… to control the order.
   The first one is the cover.

3. Run `npm run build` once. It writes a `car.json` stub into that folder, already
   filled with the year, make and model read from the folder name.

4. Open `car.json` and set the price and details. Or open `/editor.html` in the browser,
   fill the form, and copy the JSON out.

5. Push to GitHub. Netlify rebuilds. The car is live.

If you skip step 3, no problem — Netlify generates the stub at build time and the car
still shows, just with a blank price ("Price on request").

**A folder with no photos in it is skipped, silently.** Add photos and it appears.

---

## Setting up

```bash
npm run build     # build once into dist/
npm run dev       # build + preview at http://localhost:5173
```

There is nothing to install.

## Netlify

Push this folder to a GitHub repo, then in Netlify: **Add new site → Import from GitHub**.
`netlify.toml` already sets everything:

| Setting | Value |
|---|---|
| Build command | `node build.js` |
| Publish directory | `dist` |
| Node version | 22 |

## Your details

Edit `data/site.json` — business name, tagline, WhatsApp number, phone, address, hours,
socials. The WhatsApp number is normalised automatically, so `0244123456` and
`+233244123456` both work.

---

## car.json reference

| Field | What it does |
|---|---|
| `title` | Headline on the card. Falls back to the folder name. |
| `price` | Number, no commas. `0` shows "Price on request". |
| `negotiable` | `true` adds a "negotiable" note under the price. |
| `status` | `available`, `reserved`, or `sold`. Drives the warp band colour. |
| `featured` | `true` pins it to the top with a gold tag. |
| `sortOrder` | Lower shows first. Default `100`. |
| `hidden` | `true` keeps the folder in the repo but off the site. |
| `cover` | Filename to use as the cover, e.g. `"front.jpg"`. |
| `features` | Array of strings, shown as pills on the detail sheet. |
| `mileage` | Number in km. Leave `null` to hide it. |

Sold a car? Change `"status"` to `"sold"` and push. It greys out, keeps its page, and
the CTA switches to "ask for something similar" — that's how sold stock still earns you
enquiries.

---

## Keeping it fast

Photos are copied as-is and cached forever by Netlify. Before pasting them in, resize to
about **1600px wide** and save around 75–80% quality. A phone photo straight off the
camera is 4–8 MB; resized it is around 250 KB. With 40 cars on the site that is the
difference between a page that loads on mobile data and one that doesn't.

## Design notes

The vertical woven strip on the left edge of every card is the signature element — its
stripe sequence is the status. Gold and green means available, gold and red means
reserved, grey means sold. Once you have seen it twice you can read the whole yard at a
glance without reading a word.
