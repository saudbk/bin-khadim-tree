# شجرة عائلة بن خادم — Bin Khadim Family Tree

An interactive Arabic-first family tree web app for the Bin Khadim family of Sharjah, UAE. Family members can browse the tree, search by name, and view detailed profiles — while the owner retains sole ability to edit and publish updates.

---

## For family members (viewers)

- **Browse the tree** with three view modes: detailed outline, compact outline, or cards grouped by generation.
- **Search** any Arabic name — ignores diacritics, ا/أ/إ/آ, ى/ي, ة/ه differences.
- **Click any name** to open the profile with dates, ancestry breadcrumbs, spouses, children, and siblings.
- **Click any ancestor** in the breadcrumb trail to jump to them.
- **Share a direct link** to any person using the share button in the profile — the link opens straight to that person.
- **Welcome tour** on first visit explains everything in Arabic.
- **View mode is read-only** — you can't accidentally change anything.

## For the owner

- **Edit mode is passphrase-protected.** Click the 🔒 lock icon in the top bar and enter your passphrase to unlock.
- Once unlocked, every row gets `+` (add child), `✎` (edit), and `🗑` (delete) buttons. All changes auto-save to your browser.
- **Export** the updated `family-YYYY-MM-DD.json` file and replace `data/family.json` on your host to publish the new version. Family members pick it up automatically on their next visit.
- Click the lock icon again (or the "إقفال" button) to lock back to view mode.
- Owner session persists per browser — enter the passphrase once, stay unlocked across reloads on that device.

### Setting the initial passphrase (first-time owner setup)

Family members visiting the public site never see a "set a passphrase" option — that would let them hijack editing. To set your passphrase, the owner opens the site with `?setup=1` appended to the URL:

```
https://your-host/bin-khadim-tree/?setup=1
```

Click the 🔒 lock, set your passphrase, click Export, and upload the downloaded `family.json` to replace `data/family.json` on your host. The hash of your passphrase is now baked into the published file, so family members get the prompt-only lock from then on.

### Changing or resetting the passphrase

Open `data/family.json` and delete the `ownerHash` line from `metadata`, upload. Then visit the site with `?setup=1` again and set a new one.

---

## Running locally

Serve the folder over HTTP so the JSON can load:

```bash
cd bin-khadim-tree
python3 -m http.server 8000
# open http://localhost:8000
```

No build step. No dependencies. Plain HTML / CSS / JS.

---

## Project structure

```
bin-khadim-tree/
├── index.html         Toolbar, modals, tree canvas
├── css/styles.css     RTL styles, dark mode, views, forms
├── js/app.js          All logic (rendering, CRUD, lock, deep links)
├── data/family.json   The genealogy data (edit via UI or by hand)
├── assets/            Optional photos
└── README.md
```

---

## Data file format

```jsonc
{
  "metadata": {
    "title": "شجرة عائلة بن خادم",
    "subtitle": "في إمارة الشارقة",
    "researcher": "إعداد: عزان خالد بن خادم",
    "researchDate": "08/12/2020",
    "rootPersonId": "p01",
    "ownerHash": "<SHA-256 hash of passphrase>",
    "lastUpdated": "2026-10-21"
  },
  "people": {
    "p01": {
      "id": "p01",
      "name": "محمد بن خادم (الأول)",
      "displayName": "الشيخ محمد بن خادم...",
      "gender": "male",
      "fatherId": null,
      "motherId": null,
      "spouseIds": ["sp01"],
      "childrenIds": ["p02"],
      "birthDate": null,
      "deathDate": null,
      "notes": null,
      "photoUrl": null,
      "uncertain": false,
      "external": false,
      "researcher": false
    }
  }
}
```

### Integrity rules (handled automatically by the edit UI)

- Every `fatherId` / `motherId` must point to an existing key in `people` or be `null`.
- `childrenIds` on each parent must include every child that lists them as father or mother (bidirectional).
- `spouseIds` are also bidirectional.
- `rootPersonId` must exist in `people`.
- A child appears under their father in the tree; if the father is `external` or absent, they appear under their mother. This keeps matrilineal branches (like the children of آمنة → المعال) visible.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `/` | Focus search |
| `?` | Open help |
| `Esc` | Close any open dialog |
| `↑` `↓` | Navigate search results |
| `Enter` | Open selected result |
| `Ctrl / ⌘ + S` | Export (owner only) |

---

## Deep links

Any person has a direct link: `https://your-host/#p05` opens the app and immediately shows that person's profile. The share button in each profile copies that link to your clipboard (uses the Web Share API on mobile where supported).

---

## Accessibility

- Full keyboard navigation.
- Screen-reader friendly: ARIA roles on tree, modals, dialogs; `aria-expanded` on toggles.
- Respects `prefers-reduced-motion` and `prefers-color-scheme`.
- High-contrast focus rings on every control.
- Responsive from phone to desktop.

---

## Credits

Original genealogy research by **عزان خالد بن خادم** (08/12/2020). Web application built for the family as a living, editable document.
