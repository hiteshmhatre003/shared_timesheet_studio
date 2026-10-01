# Shared Timesheet Kiosk (`shared_timesheet`)

One tablet, many workers. A shared-device version of the `timesheet_kiosk`
app: the tablet lists every allocated WIH; opening one shows only the people
allocated to it, each with their own Start / Stop button that works only after
that person's face check (look + blink), with a personal PIN as backup. A
"My Hours / Supervisor" area gives each person their own dashboard and report,
and supervisors face registration and submit. Every punch is saved with a photo.

- Opens at **`https://<your-site>/kiosk`** (the existing app stays at `/timesheet`)
- Installs as a completely separate app — it does **not** modify
  `timesheet_kiosk` or any of its files, routes, or settings
- Reads and writes the **same** `Employee Timesheet` / `Timesheet Entry` /
  `Timesheet Allocation` / `Work In Hand` records, so a WIH's hours are
  complete whether logged from a personal phone or the shared tablet

For step-by-step setup (no coding needed), see **`SETUP_GUIDE.md`**.

## Repo layout

```
./                         ← repo root (this is what goes on GitHub)
├── README.md
├── SETUP_GUIDE.md
├── license.txt
├── pyproject.toml
├── requirements.txt
└── shared_timesheet/      ← the app module (contains hooks.py)
    ├── hooks.py
    ├── install.py          creates "Kiosk Device" role, default settings
    ├── api.py              all whitelisted methods
    ├── utils.py            PIN rules
    ├── modules.txt
    ├── shared_timesheet/doctype/
    │   ├── kiosk_worker/     who appears on the tablet + their PIN
    │   ├── kiosk_face_data/  registered face measurements (not readable by the tablet)
    │   ├── kiosk_punch_log/  audit trail with photo of every punch
    │   └── kiosk_settings/   timeouts, lockout, photo required, etc.
    ├── public/             JS / CSS / icons / manifest
    └── www/kiosk.*         the page at /kiosk
```

## How identity works

1. **Device login (once):** a supervisor signs the tablet in with an ERPNext
   user that has the **Kiosk Device** role (no desk access). This keeps the
   tablet connected; it never counts as a worker.
2. **Worker check (every punch):** worker taps their name → face check
   (look + blink; the tablet turns the face into 128 numbers with the bundled
   open-source face-api library, and the SERVER compares them with that
   worker's registered numbers, also refusing faces that better match another
   worker) — or PIN as backup (hashed in Frappe's `__Auth` table). The server
   then issues a short-lived random token, bound to this device, held only in
   memory.
3. Every timesheet call must carry that token; the worker's identity comes
   from the token, never from the browser.
4. **Start / Stop ends the token immediately.** No touch for 60 s (configurable),
   the app going to background, or tapping **Done** also ends it.
5. 5 wrong PINs / failed face checks → locked for 15 min (configurable).
   Every failed attempt is logged with a photo. Resetting a PIN unlocks.

Face engine: `@vladmandic/face-api` 1.7.15 (MIT) with its tiny face detector,
68-point landmark and recognition models, bundled under `public/` — no
external service. Match thresholds: Strict 0.45 / Normal 0.50 / Relaxed 0.55.

## Shared-site notes

- Uses `stk_*` localStorage keys and its own service worker (`/kiosk-sw.js`,
  scope `/kiosk`), so it never collides with the old app's `tk_*` keys or
  `/timesheet-sw.js`.
- Browser cookies are per site: don't open the old `/timesheet` app on the
  shared tablet — logging in there would replace the tablet's device login.

## License

MIT
