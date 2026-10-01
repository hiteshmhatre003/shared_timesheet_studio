# Team Timesheet (Shared Tablet) — Setup Guide

One tablet on the floor. The tablet lists your timesheets (WIHs). Open one and it shows only the people allocated to it, each with their own Start / Stop button. A button only works after that person's face check (their PIN is the backup).

Your existing Timesheet app (`/timesheet`) keeps working exactly as it does today. This is a separate app at a separate address (`/kiosk`). Both apps save time into the same Employee Timesheets, so a WIH's hours stay in one place.

---

## Before you start

You will need:

- Administrator access to ERPNext and to Frappe Cloud (the same access you used for the existing Timesheet app).
- Your GitHub account (`hiteshmhatre003`).
- One Android tablet with a front camera (a phone also works). Use the **Chrome** browser.
- About 1 hour for setup, plus about 1 minute per worker to register faces.

**No new doctypes to create.** Installing the app adds its own four (Kiosk Worker, Kiosk Settings, Kiosk Punch Log, Kiosk Face Data) and the Kiosk Device role automatically. It uses your existing Employee Timesheet, Timesheet Entry, Timesheet Allocation and Work In Hand exactly as they are. The only ERPNext entries you make are in Steps 4 and 5.

Do Steps 1–3 **after working hours** — adding an app restarts your ERPNext site for a few minutes.

---

## Step 1 — Put the app on GitHub

1. Unzip `shared_timesheet.zip` on your computer. You get a folder called `shared_timesheet`.
2. On github.com, click **New repository**. Name it `shared_timesheet`. Do **not** tick "Add a README". Click **Create repository**.
3. On the empty repository page, click **"uploading an existing file"**.
4. Open the `shared_timesheet` folder on your computer, select **everything inside it** (Ctrl+A), and drag it into the GitHub upload box.

   ⚠️ Drag the **contents**, not the folder itself. After uploading, the first page of the repository must show `pyproject.toml`, `README.md` and a folder called `shared_timesheet`. If you only see one folder called `shared_timesheet` and nothing else, delete the repository and upload again.

5. Click **Commit changes**.

## Step 2 — Add the app on Frappe Cloud

1. Log in to Frappe Cloud → open the **bench** that runs your timesheet site (the same bench where `timesheet_kiosk` is installed).
2. Go to **Apps** → **Add App** → **Add from GitHub** → choose `shared_timesheet`, branch `main`.
3. Click **Deploy** (or "Update available → Deploy"). Wait until the deploy shows **Success** (usually 5–15 minutes).
4. Go to **Sites** → your timesheet site (`studio-amal.m.frappe.cloud`) → **Apps** → **Install App** → choose **shared_timesheet**.

This does **not** change or reinstall your existing Timesheet app.

## Step 3 — Check it worked

Open this address in your browser:

`https://studio-amal.m.frappe.cloud/api/method/shared_timesheet.api.healthz`

You should see: `{"message":{"status":"ok","app":"shared_timesheet"}}`

Then open `https://studio-amal.m.frappe.cloud/timesheet` and confirm your old app still opens normally.

---

## Step 4 — Create the tablet's own account

The tablet signs in once with its own account. This account cannot open ERPNext and does not count as any worker.

1. ERPNext → search **User** → **+ Add User**.
2. Email: something like `studio.kiosk@amalembroideries.com`. It doesn't need a real inbox.
3. First Name: `Studio Kiosk`. **Untick** "Send Welcome Email". Save.
4. In the user's **Roles** section, tick **only** `Kiosk Device`. Save.
5. Open the **Settings / Change Password** section of the user and set a strong password. Keep it with the supervisor only — workers should never know it.

## Step 5 — Add each worker

Every worker must already be an ERPNext **User**, the same as for the current app. They don't need to know their ERPNext password.

1. ERPNext → search **Kiosk Worker** → **+ Add Kiosk Worker**.
2. **User**: pick the worker.
3. **Photo** (optional): a picture for their name tile.
4. **Set / Reset PIN**: type a 4–6 digit PIN. Easy PINs like 1111 or 1234 are refused.
5. Save. Tell the worker their PIN privately.

Repeat for every worker **and every supervisor**. Supervisors need a Kiosk Worker record and PIN too, because that is how they open the "Register Faces" screen on the tablet.

- Supervisors' ERPNext users must have the **Timesheet Manager** role (they already do if they submit timesheets today).
- Workers must be in **Timesheet Allocation** for their WIH, exactly as today. On the tablet, each WIH lists only its allocated people, and only they get a Start / Stop button.

**Forgot PIN / locked out?** Open their Kiosk Worker record, type a new PIN in "Set / Reset PIN", Save. This also unlocks them immediately.

## Step 6 — Check the settings

ERPNext → search **Kiosk Settings**. The defaults are sensible, so you can leave them as they are.

| Setting | Default | What it means |
|---|---|---|
| Auto Sign-out After | 60 seconds | If nobody touches the tablet for this long, it goes back to the name screen. |
| Wrong PIN Attempts Before Lock | 5 | Then that worker's PIN is locked. |
| Lock Duration | 15 minutes | How long the lock lasts (or reset the PIN to unlock now). |
| Require Photo at Every Sign-in | Off | Turn on once the camera works reliably. |
| Allow Workers to Add / Edit / Delete Entries | On | Untick to let only supervisors change times. |
| Only One Running Timer per Worker | On | Stops someone starting WIH-2 while WIH-1 is still running. |
| Use Face Check | On | Workers with a registered face must look at the camera. |
| Face Match Strictness | Normal | Strict = fewer wrong matches but more "not recognised". |
| Ask Worker to Blink | On | Stops someone holding up a photo of a colleague. |
| Allow PIN if Face Check Fails | On | Every PIN use is marked "PIN" in the log for review. |
| Failed Face Checks Before Face Lock | 5 | After this, that worker must use their PIN. |

---

## Step 7 — Set up the tablet

**Where to put it.** Mount it at face height. Light should fall **on** the workers' faces. Don't place it with a window or bright tube light behind the person standing in front of it — this is the most common cause of face check failures.

1. On the tablet, open **Chrome** and go to `https://studio-amal.m.frappe.cloud/kiosk`
2. Sign in with the **tablet account** from Step 4 (not your own account).
3. Chrome menu (⋮) → **Add to Home screen**. From now on, open it from that icon so it shows full screen.
4. The first time the camera is used, Chrome asks for permission → tap **Allow**.
5. Recommended tablet settings:
   - **Settings → Display → Screen timeout**: the longest option. Keep the tablet on charge.
   - **Settings → Security → App pinning** (or "Pin windows"): turn on, then pin the Team Timesheet app so workers can't leave it.
6. Don't use this tablet for the old `/timesheet` app or for ERPNext. Signing in there would sign the tablet out of the kiosk.

## Step 8 — Register faces (supervisor, once per worker)

**Get consent first.** Face data is personal data under India's Digital Personal Data Protection Act, 2023. Have each worker sign a consent form before registering their face (a sample is at the end of this guide — please have HR or your legal adviser confirm the wording).

On the tablet:

1. Tap **My Hours / Supervisor** (top right), then **your own name** → verify.
2. Tap the menu (☰) → **Register Faces**.
3. Next to the worker, tap **Register**.
4. Tick the consent box. Optionally type the consent form number or date.
5. Ask the worker to stand in front of the tablet and tap **Start**.
6. The worker follows the prompts for about 10 seconds: look straight, turn slightly left, slightly right, chin up, straight again.
7. You'll see **"Face registered"**. Tap **Done** when finished.

Tips:

- Register in the same place and lighting where the tablet will be used.
- Only the worker should be in front of the camera.
- If someone keeps failing later (new glasses, beard, haircut), tap **Redo** for them.

---

## Daily use — for workers

The tablet's main screen lists every WIH that has a Timesheet Allocation. Each WIH shows only the people allocated to it. Nobody can start or stop another person's timer without that person's face or PIN.

**To start work**

1. On the **Timesheets** screen, tap your WIH.
2. Find your name and tap **Start**.
3. Choose the activity → **Next**.
4. Look at the camera and blink when asked (or use your PIN).
5. A big **green** screen confirms it, and the tablet returns to the same WIH for the next person.

**To stop work**

1. Tap your WIH, then **Stop** next to your name.
2. Look at the camera and blink. A big **red** screen confirms it.

**If the face check fails:** tap **Try Again**, or **Use PIN Instead**.

**To see your own hours or report:** tap **My Hours / Supervisor** (top right), then your name, and verify. Tap **Done** when finished; it also signs you out after 60 seconds without a touch.

The Employee Timesheet is created automatically the first time anyone on that WIH taps Start.

---

## For supervisors — checking the records

ERPNext → search **Kiosk Punch Log**. Every start, stop, edit, submit, wrong PIN and failed face check is listed with:

- the worker, time, WIH and activity;
- **Verified By**: Face or PIN;
- a **photo** taken at that moment.

Useful filters:

- **Verified By = PIN** — see who skipped the face check.
- **Action = Face Failed** or **PIN Failed** — see if someone tried to use another person's name.

**When a worker leaves:** on the tablet go to Register Faces → **Remove**, and untick **Enabled** on their Kiosk Worker record. Deleting their Kiosk Worker record also deletes their face data.

---

## Troubleshooting

| Problem | What to do |
|---|---|
| "This device was signed out" | A supervisor signs the tablet in again with the tablet account (Step 7). |
| "This account can't run the kiosk" | Give that account the **Kiosk Device** role (Step 4). |
| A worker isn't on the name screen | Check their Kiosk Worker record exists and **Enabled** is ticked. |
| Name tile says "Not set up yet" | Set a PIN or register their face. |
| "Face not recognised" often | Fix the lighting (no window behind them), then **Redo** their registration in that spot. |
| "Didn't catch a blink" | Blink slowly once, eyes fully closed, while looking at the camera. |
| "Camera not available" | Chrome → ⋮ → Settings → Site settings → Camera → allow this site. |
| Worker locked out | Reset their PIN in Kiosk Worker (unlocks immediately), or wait 15 minutes. |
| No WIH to choose when creating a timesheet | Add the worker to that WIH's **Timesheet Allocation**. |
| WIH photo doesn't show on the tablet | ERPNext → **Role Permission Manager** → Work In Hand → add **Kiosk Device** with **Read**. |
| First face check is slow | Normal: the tablet downloads the face engine (about 8 MB) once, then remembers it. |

---

## Good to know

- **How the face check works:** the tablet turns the face into 128 numbers (not a photo) and sends them to your ERPNext server, which compares them with the registered numbers. No outside service or monthly fee is involved.
- **How secure it is:** it is not as strong as an iPhone's Face ID, which uses a special 3D sensor. The blink check stops printed photos, but a very determined person with a video could possibly fool it. That's why every punch is saved with a photo for review.
- **Face data is protected:** the tablet's account cannot read anyone's face data. Only System Managers and Timesheet Managers can see the Kiosk Face Data records.

---

## Sample consent form

*(Please have HR or your legal adviser review this, and give workers a copy in a language they understand, such as Hindi or Marathi.)*

> **Consent for use of face recognition for attendance / timesheet**
>
> I, ______________________ (name), employee code ________, agree that Amal Embroideries Private Limited may:
>
> 1. take measurements of my face on the company timesheet tablet, and photos when I start or stop my work timer;
> 2. use them only to confirm my identity when I record working time, and to check attendance records;
> 3. keep them on the company's ERPNext system for as long as I work here, and delete my face data when I leave.
>
> I understand that I can use my PIN instead if the face check does not work, and that I can withdraw this consent at any time by informing HR, after which my face data will be deleted.
>
> Signature: ______________  Date: ___________
> Form No.: ______________
