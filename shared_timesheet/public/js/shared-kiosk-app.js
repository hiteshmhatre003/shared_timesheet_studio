const app = document.getElementById("root");
let timerInterval = null;
let homeInterval = null;

// ------------------------------------------------------------------
// Small utilities
// ------------------------------------------------------------------
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(msg, ms = 2800) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function flt2(v) { return (v || 0).toFixed(2); }
function fmtHrsMins(v) {
  const totalMinutes = Math.round((parseFloat(v) || 0) * 60);
  return `${Math.floor(totalMinutes / 60)} Hrs ${totalMinutes % 60} Mins`;
}
function fmtShort(hours) {
  const m = Math.round((parseFloat(hours) || 0) * 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
// Today's date in the TABLET's local time zone (toISOString() would give the
// UTC date, which is "yesterday" in India between midnight and 5:30 am).
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtTime(dt) {
  if (!dt) return "";
  const d = new Date(dt.replace(" ", "T"));
  if (isNaN(d)) return dt;
  return d.toTimeString().slice(0, 5);
}
function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0] || "").join("").toUpperCase() || "?";
}
function avatarHtml(w) {
  return `<div class="avatar-circle">${w.photo
    ? `<img src="${esc(w.photo)}" alt="" onerror="this.parentNode.textContent='${esc(initials(w.full_name))}'" />`
    : esc(initials(w.full_name))}</div>`;
}

// ------------------------------------------------------------------
// Router  (/kiosk, /kiosk/login, /kiosk/w/dashboard, /kiosk/w/timer/<name> …)
// Everything under /w/ needs a worker who has just entered their PIN.
// ------------------------------------------------------------------
const BASE_PATH = "/kiosk";

function currentRoute() {
  let path = location.pathname;
  if (path.startsWith(BASE_PATH)) path = path.slice(BASE_PATH.length);
  return path && path !== "/" ? path : "/";
}

function navigate(route, { replace = false } = {}) {
  const full = BASE_PATH + (route === "/" ? "" : route);
  if (location.pathname + location.search !== full) {
    if (replace) history.replaceState({}, "", full);
    else history.pushState({}, "", full);
  }
  render();
}

window.addEventListener("popstate", render);
window.addEventListener("DOMContentLoaded", boot);

async function boot() {
  registerServiceWorker();
  if (API.isDeviceSignedIn()) {
    // The page itself hands us this session's fresh CSRF token.
    const t = window.FRAPPE_CSRF_TOKEN;
    if (t && t !== "None" && !t.includes("{{")) Store.csrf = t;
    try { await API.getDeviceInfo(); } catch (e) { /* 401 clears Store → login screen */ }
  }
  render();
}

function render() {
  clearInterval(timerInterval);
  clearInterval(homeInterval);
  const route = currentRoute();

  if (!API.isDeviceSignedIn()) {
    stopIdleWatch();
    Worker.clear();
    if (route !== "/login") history.replaceState({}, "", BASE_PATH + "/login");
    return renderDeviceLogin();
  }
  if (route === "/login") {
    history.replaceState({}, "", BASE_PATH);
    return renderTimesheets();
  }
  if (route.startsWith("/w/")) {
    if (!Worker.active()) {
      history.replaceState({}, "", BASE_PATH);
      return renderTimesheets();
    }
    if (route === "/w/dashboard") return renderDashboard();
    if (route === "/w/new") return renderNewTimesheet();
    if (route === "/w/report") return renderMyTimesheetReport();
    if (route === "/w/faces") return Worker.isManager ? renderFaces() : navigate("/w/dashboard", { replace: true });
    if (route.startsWith("/w/timer/")) return renderTimer(decodeURIComponent(route.split("/w/timer/")[1]));
    history.replaceState({}, "", BASE_PATH + "/w/dashboard");
    return renderDashboard();
  }
  // Leaving the worker screens always ends whoever was signed in.
  if (Worker.active()) API.endWorkerSession();
  stopIdleWatch();
  if (route === "/people") return renderHome();
  if (route.startsWith("/t/")) return renderTeam(decodeURIComponent(route.slice(3)));
  return renderTimesheets();
}

// Any touch on the tablet (used to send idle shared screens back to the list).
let lastTouchAny = Date.now();
["pointerdown", "keydown", "touchstart"].forEach((ev) =>
  document.addEventListener(ev, () => { lastTouchAny = Date.now(); }, { capture: true, passive: true })
);

// ------------------------------------------------------------------
// Worker inactivity: no touch for N seconds → back to the name screen.
// Also signs the worker out if the app goes to the background.
// ------------------------------------------------------------------
let idleDeadline = 0;
let idleTicker = null;
let lastActivity = 0;
let lastPing = 0;

function bumpActivity() {
  if (!Worker.active()) return;
  lastActivity = Date.now();
  idleDeadline = lastActivity + (KioskSettings.worker_session_seconds || 60) * 1000;
}
["pointerdown", "keydown", "touchstart", "input", "wheel"].forEach((ev) =>
  document.addEventListener(ev, bumpActivity, { capture: true, passive: true })
);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && Worker.active()) signOutWorker();
});

function startIdleWatch() {
  stopIdleWatch();
  bumpActivity();
  lastPing = Date.now();
  idleTicker = setInterval(() => {
    if (!Worker.active()) { stopIdleWatch(); return; }
    const left = Math.max(0, Math.ceil((idleDeadline - Date.now()) / 1000));
    const el = document.getElementById("idleCountdown");
    if (el) el.textContent = `Auto sign-out ${left}s`;
    if (left <= 0) { signOutWorker("Signed out — no activity"); return; }
    // Worker is still actively using the screen but hasn't triggered any API
    // call lately → keep their server-side session alive too.
    if (lastActivity > lastPing && Date.now() - lastPing > 25000) {
      lastPing = Date.now();
      callMethod("ping_worker_session", { worker_token: Worker.token }).catch((e) => handleErr(e));
    }
  }, 1000);
}
function stopIdleWatch() { clearInterval(idleTicker); idleTicker = null; }

function signOutWorker(msg) {
  stopIdleWatch();
  closeOverlays();
  API.endWorkerSession();
  if (msg) toast(msg);
  navigate("/", { replace: true });
}

// Central error handling: session problems route the screen, everything
// else is shown to the user.
function handleErr(e, box) {
  if (e && e.workerSessionEnded) { signOutWorker("Session ended — tap your name again"); return true; }
  if (e && e.deviceSessionEnded) {
    stopIdleWatch(); closeOverlays(); toast(e.message);
    navigate("/login", { replace: true });
    return true;
  }
  const msg = (e && e.message) || "Something went wrong";
  if (box) box.innerHTML = `<div class="error-box">${esc(msg)}</div>`;
  else toast(msg);
  return false;
}

// ------------------------------------------------------------------
// Camera (only switched on while the PIN pad is open)
// ------------------------------------------------------------------
let camStream = null;

async function startCamera(videoEl) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 360 } },
      audio: false,
    });
    if (!document.body.contains(videoEl)) { stopCamera(); return false; }
    videoEl.srcObject = camStream;
    await videoEl.play().catch(() => {});
    return true;
  } catch (e) {
    return false;
  }
}
function stopCamera() {
  if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
}
function captureFrame(videoEl) {
  if (!camStream || !videoEl || !videoEl.videoWidth) return null;
  const w = 320;
  const h = Math.round((videoEl.videoHeight * w) / videoEl.videoWidth);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(videoEl, 0, 0, w, h);
  return c.toDataURL("image/jpeg", 0.7);
}

let pinKeyHandler = null;
let pinPadTimer = null;
function closeOverlays() {
  if (faceRun) { faceRun.cancelled = true; faceRun = null; }
  stopCamera();
  clearTimeout(pinPadTimer);
  if (pinKeyHandler) { document.removeEventListener("keydown", pinKeyHandler); pinKeyHandler = null; }
  document.querySelectorAll(".modal-backdrop").forEach((m) => m.remove());
}

// ------------------------------------------------------------------
// DEVICE SIGN-IN (done once by a supervisor when setting up the tablet)
// ------------------------------------------------------------------
function renderDeviceLogin() {
  closeOverlays();
  app.innerHTML = `
    <div class="screen login-wrap">
      <div class="login-header">
        <h1>Team Timesheet</h1>
        <p>Shared Device Setup</p>
      </div>
      <div class="login-card">
        <div class="avatar">&#128241;</div>
        <h2>Sign In This Device</h2>
        <p class="sub">Supervisor: use the kiosk device account, not your own</p>
        <div class="login-body">
          <div id="err"></div>
          <div class="field">
            <label>Device Account</label>
            <input id="usr" type="text" placeholder="kiosk.studio@company.com" autocomplete="username" />
          </div>
          <div class="field">
            <label>Password</label>
            <div class="pw-wrap">
              <input id="pwd" type="password" placeholder="••••••••" autocomplete="current-password" />
              <button type="button" id="togglePw">&#128065;</button>
            </div>
          </div>
          <button class="btn btn-primary" id="signInBtn">Sign In Device</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById("togglePw").onclick = () => {
    const pw = document.getElementById("pwd");
    pw.type = pw.type === "password" ? "text" : "password";
  };
  const doLogin = async () => {
    const usr = document.getElementById("usr").value.trim();
    const pwd = document.getElementById("pwd").value;
    const btn = document.getElementById("signInBtn");
    const errBox = document.getElementById("err");
    errBox.innerHTML = "";
    if (!usr || !pwd) {
      errBox.innerHTML = `<div class="error-box">Please enter the device account and password</div>`;
      return;
    }
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Signing in...`;
    try {
      await API.deviceLogin(usr, pwd);
      navigate("/", { replace: true });
    } catch (e) {
      errBox.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
      btn.disabled = false;
      btn.textContent = "Sign In Device";
    }
  };
  document.getElementById("signInBtn").onclick = doLogin;
  document.getElementById("pwd").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
}

// ------------------------------------------------------------------
// HOME — "Who's working?" name tiles
// ------------------------------------------------------------------
let homeWorkers = [];
let homeSearch = "";
let homeTick = 0;

function renderHome() {
  closeOverlays();
  app.innerHTML = `
    <div class="topbar">
      <div class="brand">
        <span class="brand-logo">amal</span>
        <span class="brand-title">TEAM TIMESHEET</span>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <button class="icon-btn" id="toSheetsBtn">&larr; Timesheets</button>
      </div>
    </div>
    <div class="screen wide">
      <div class="home-head">
        <div>
          <h1>My Hours &amp; Supervisor</h1>
          <p class="home-sub">Tap your name to see your timesheets and report. Supervisors: register faces &amp; submit here.</p>
        </div>
        <div class="clock" id="homeClock"></div>
      </div>
      <div class="field">
        <input id="workerSearch" type="text" placeholder="Search your name…" value="${esc(homeSearch)}" autocomplete="off" />
      </div>
      <div id="workerGrid"><div class="loading-center">Loading…</div></div>
      <div class="home-foot">A photo is taken at every sign-in and saved with your punch.</div>
    </div>
  `;

  document.getElementById("toSheetsBtn").onclick = () => navigate("/");
  const search = document.getElementById("workerSearch");
  search.addEventListener("input", () => { homeSearch = search.value.trim(); drawWorkerGrid(); });

  tickClock();
  homeTick = 0;
  homeInterval = setInterval(() => {
    tickClock();
    homeTick += 1;
    if (homeTick % 30 === 0) loadWorkers(true);
    if (Date.now() - lastTouchAny > 120000 && !document.querySelector(".modal-backdrop")) navigate("/", { replace: true });
  }, 1000);
  loadWorkers();
}

function tickClock() {
  const el = document.getElementById("homeClock");
  if (el) el.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function loadWorkers(silent) {
  const grid = document.getElementById("workerGrid");
  if (!grid) return;
  if (!silent) grid.innerHTML = `<div class="loading-center">Loading…</div>`;
  try {
    homeWorkers = await API.listWorkers();
    drawWorkerGrid();
    // Warm up the face engine in the background so the first tap is instant.
    if (KioskSettings.face_enabled && homeWorkers.some((w) => w.has_face)) ensureFaceEngine().catch(() => {});
  } catch (e) {
    if (!handleErr(e) && !silent) grid.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
  }
}

function drawWorkerGrid() {
  const grid = document.getElementById("workerGrid");
  if (!grid) return;
  const q = homeSearch.toLowerCase();
  const list = homeWorkers.filter((w) => !q || (w.full_name || "").toLowerCase().includes(q));
  if (!homeWorkers.length) {
    grid.innerHTML = `<div class="empty-state">No workers set up yet.<br>Add them in ERPNext → <b>Kiosk Worker</b>.</div>`;
    return;
  }
  if (!list.length) {
    grid.innerHTML = `<div class="empty-state">No name matches “${esc(homeSearch)}”.</div>`;
    return;
  }
  grid.innerHTML = `<div class="worker-grid">${list.map(workerTile).join("")}</div>`;
  grid.querySelectorAll(".worker-tile").forEach((tile) => {
    tile.onclick = () => {
      const w = homeWorkers.find((x) => x.user === tile.dataset.user);
      if (!w) return;
      const useFace = KioskSettings.face_enabled && w.has_face;
      if (useFace && !w.face_locked_minutes) { showFaceCheck(w); return; }
      if (!w.has_pin) {
        toast(useFace ? `Face check locked for ${w.face_locked_minutes} min. Please ask your supervisor.`
                      : "Not set up yet — please ask your supervisor.");
        return;
      }
      if (w.locked_minutes) { toast(`Locked after wrong PINs. Try again in ${w.locked_minutes} min.`); return; }
      showPinPad(w, useFace ? { note: `Face check locked for ${w.face_locked_minutes} min — use your PIN` } : {});
    };
  });
}

function workerTile(w) {
  let status = `<div class="w-status">Not clocked in</div>`;
  let cls = "";
  const faceOn = KioskSettings.face_enabled && w.has_face;
  if (!w.has_pin && !faceOn) {
    status = `<div class="w-status warn">Not set up yet</div>`;
    cls = "is-disabled";
  } else if (w.locked_minutes && !faceOn) {
    status = `<div class="w-status err">&#128274; Locked · ${w.locked_minutes} min</div>`;
    cls = "is-disabled";
  } else if (w.running && w.running.length) {
    const r = w.running[0];
    const more = w.running.length > 1 ? ` +${w.running.length - 1}` : "";
    status = `<div class="w-status run">&#9654; ${esc(r.wih_number || r.timesheet)} · ${fmtShort(r.elapsed_hours)}${more}</div>`;
    cls = "is-running";
  }
  return `
    <div class="worker-tile ${cls}" data-user="${esc(w.user)}">
      ${faceOn ? `<span class="w-face" title="Face check">&#128247;</span>` : ""}
      ${avatarHtml(w)}
      <div class="w-name">${esc(w.full_name)}</div>
      ${status}
    </div>
  `;
}


// ------------------------------------------------------------------
// TIMESHEETS (the tablet's main screen) — every WIH with a Timesheet
// Allocation. Opening one shows its allocated people.
// ------------------------------------------------------------------
let sheetsSearch = "";
let sheetsCache = [];

function renderTimesheets() {
  closeOverlays();
  app.innerHTML = `
    <div class="topbar">
      <div class="brand">
        <span class="brand-logo">amal</span>
        <span class="brand-title">TEAM TIMESHEET</span>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="user-pill" title="This tablet's account">&#128241; ${esc(Store.deviceName || Store.device)}</span>
        <button class="icon-btn" id="toPeopleBtn">&#128100; My Hours / Supervisor</button>
      </div>
    </div>
    <div class="screen wide">
      <div class="home-head">
        <div>
          <h1>Timesheets</h1>
          <p class="home-sub">Open your WIH, then tap Start or Stop next to your name</p>
        </div>
        <div class="clock" id="homeClock"></div>
      </div>
      <div class="field">
        <input id="sheetSearch" type="text" placeholder="Search WIH or style…" value="${esc(sheetsSearch)}" autocomplete="off" />
      </div>
      <div id="sheetGrid"><div class="loading-center">Loading…</div></div>
      <div class="home-foot">A photo is taken at every Start / Stop and saved with the punch.</div>
    </div>
  `;
  document.getElementById("toPeopleBtn").onclick = () => navigate("/people");
  const search = document.getElementById("sheetSearch");
  search.addEventListener("input", () => { sheetsSearch = search.value.trim(); drawSheetGrid(); });

  tickClock();
  homeTick = 0;
  homeInterval = setInterval(() => {
    tickClock();
    homeTick += 1;
    if (homeTick % 30 === 0) loadSheets(true);
  }, 1000);
  loadSheets();
  if (KioskSettings.face_enabled) ensureFaceEngine().catch(() => {});
}

async function loadSheets(silent) {
  const grid = document.getElementById("sheetGrid");
  if (!grid) return;
  if (!silent) grid.innerHTML = `<div class="loading-center">Loading…</div>`;
  try {
    sheetsCache = await API.listKioskTimesheets();
    drawSheetGrid();
  } catch (e) {
    if (!handleErr(e) && !silent) {
      const g = document.getElementById("sheetGrid");
      if (g) g.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
    }
  }
}

function drawSheetGrid() {
  const grid = document.getElementById("sheetGrid");
  if (!grid) return;
  const q = sheetsSearch.toLowerCase();
  const list = sheetsCache.filter((t) => !q || t.wih_number.toLowerCase().includes(q) || (t.style || "").toLowerCase().includes(q));
  if (!sheetsCache.length) {
    grid.innerHTML = `<div class="empty-state">No allocated WIH yet.<br>Add people to a WIH in ERPNext → <b>Timesheet Allocation</b>.</div>`;
    return;
  }
  if (!list.length) { grid.innerHTML = `<div class="empty-state">Nothing matches “${esc(sheetsSearch)}”.</div>`; return; }
  grid.innerHTML = `<div class="ts-grid">${list.map((t) => `
    <div class="ts-card ${t.working_now ? "is-running" : ""}" data-wih="${esc(t.wih_number)}">
      <div class="ts-wih">${esc(t.wih_number)}</div>
      <div class="ts-style">${esc(t.style || "")}</div>
      <div class="ts-meta">
        ${t.working_now ? `<span class="ts-live">&#9654; ${t.working_now} of ${t.team_size} working</span>` : `<span>${t.team_size} ${t.team_size === 1 ? "person" : "people"}</span>`}
        <span>${t.timesheet ? fmtShort(t.team_hours) + " logged" : "Not started"}</span>
      </div>
    </div>`).join("")}</div>`;
  grid.querySelectorAll(".ts-card").forEach((c) => {
    c.onclick = () => navigate(`/t/${encodeURIComponent(c.dataset.wih)}`);
  });
}

// ------------------------------------------------------------------
// TEAM SCREEN — one WIH, its allocated people, a Start/Stop per person.
// Nothing happens until that person passes their own face check / PIN.
// ------------------------------------------------------------------
let teamData = null;
let teamLoadedAt = 0;

function renderTeam(wih) {
  closeOverlays();
  app.innerHTML = `
    <div class="topbar">
      <div style="display:flex; align-items:center; gap:10px;">
        <button class="icon-btn" id="backSheets">&larr; Timesheets</button>
      </div>
      <div class="clock" id="homeClock" style="font-size:16px;"></div>
    </div>
    <div class="screen" id="teamScreen"><div class="loading-center">Loading…</div></div>
  `;
  document.getElementById("backSheets").onclick = () => navigate("/");
  tickClock();
  homeTick = 0;
  homeInterval = setInterval(() => {
    tickClock();
    tickTeamTimers();
    homeTick += 1;
    if (homeTick % 20 === 0) loadTeam(wih, true);
    if (Date.now() - lastTouchAny > 120000 && !document.querySelector(".modal-backdrop")) navigate("/", { replace: true });
  }, 1000);
  loadTeam(wih);
}

async function loadTeam(wih, silent) {
  const scr = document.getElementById("teamScreen");
  if (!scr) return;
  try {
    const d = await API.getKioskTimesheet(wih);
    if (!document.getElementById("teamScreen")) return;
    if (silent && document.querySelector(".modal-backdrop")) return; // don't redraw under an open dialog
    teamData = d;
    teamLoadedAt = Date.now();
    drawTeam();
  } catch (e) {
    if (!handleErr(e) && !silent) {
      const s2 = document.getElementById("teamScreen");
      if (s2) s2.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
    }
  }
}

function personStatus(p) {
  if (p.running) return `<span class="run">&#9654; ${esc(p.running.activity || "Working")} · <span data-elapsed="${p.running.elapsed_hours}">${fmtShort(p.running.elapsed_hours)}</span></span>${p.allocated === false ? ` <span class="warn">· no longer allocated</span>` : ""}`;
  if (p.allocated === false) return `<span class="warn">No longer allocated · ${fmtShort(p.hours)} logged</span>`;
  if (p.running_elsewhere) return `<span class="warn">Working on ${esc(p.running_elsewhere)}</span>`;
  if (!p.on_tablet) return `<span class="warn">Not set up on the tablet yet</span>`;
  return `<span>${p.hours ? fmtShort(p.hours) + " logged here" : "Not started"}</span>`;
}

function drawTeam() {
  const d = teamData;
  const scr = document.getElementById("teamScreen");
  if (!scr || !d) return;
  const submitted = d.docstatus === 1;
  scr.innerHTML = `
    <div class="wih-card">
      <div class="wih-info-row">
        ${d.wih_photo ? `<img src="${esc(d.wih_photo)}" class="wih-thumb" id="wihThumb" alt="WIH photo" onerror="this.remove()" />` : ""}
        <div>
          <div class="lbl">WORK IN HAND (WIH)</div>
          <div class="wih-name">${esc(d.wih_number)}</div>
          <div class="style">${esc(d.style || "")}</div>
        </div>
      </div>
      <div class="hours-block">
        <div class="hours-lbl">TEAM TOTAL</div>
        <div class="hours-val">${fmtHrsMins(d.team_hours)}</div>
      </div>
    </div>
    ${submitted ? `<div class="info-note">This timesheet is submitted and locked.</div>` : ""}
    <div class="team-list">
      ${d.people.map((p) => {
        const canAct = !submitted && p.on_tablet && p.allocated !== false && !(p.running_elsewhere && !p.running);
        const btn = p.running
          ? `<button class="team-btn stop" data-act="stop" data-user="${esc(p.user)}">&#9632; Stop</button>`
          : `<button class="team-btn start" data-act="start" data-user="${esc(p.user)}" ${canAct ? "" : "disabled"}>&#9654; Start</button>`;
        return `
          <div class="team-row ${p.running ? "is-running" : ""}">
            ${avatarHtml(p)}
            <div class="tr-main">
              <div class="tr-name">${esc(p.full_name)}</div>
              <div class="tr-st">${personStatus(p)}</div>
            </div>
            ${submitted ? "" : btn}
          </div>`;
      }).join("")}
    </div>
    <p class="info-note" style="margin-top:14px;">Only the people allocated to this WIH appear here. Each Start / Stop needs that person's own face check.</p>
  `;
  const thumb = document.getElementById("wihThumb");
  if (thumb) thumb.onclick = () => showImageModal(d.wih_photo);
  scr.querySelectorAll(".team-btn").forEach((b) => {
    b.onclick = () => {
      const p = d.people.find((x) => x.user === b.dataset.user);
      if (!p) return;
      if (b.dataset.act === "start") startForPerson(p); else verifyThenPunch(p, "stop");
    };
  });
}

function tickTeamTimers() {
  if (!teamLoadedAt) return;
  const extra = (Date.now() - teamLoadedAt) / 3600000;
  document.querySelectorAll("#teamScreen [data-elapsed]").forEach((el) => {
    el.textContent = fmtShort(parseFloat(el.dataset.elapsed) + extra);
  });
}

// START: pick the activity first, then that person verifies, then it starts.
function startForPerson(p) {
  closeOverlays();
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal">
      <h3>Start — ${esc(p.full_name)}</h3>
      <p>${esc(teamData.wih_number)}. Choose the activity, then ${esc(p.full_name.split(" ")[0])} confirms with their face.</p>
      <div class="field">
        <label>Activity</label>
        <select id="activitySelect" disabled><option value="">Loading…</option></select>
      </div>
      <div id="startTimerErr"></div>
      <div class="row">
        <button class="btn btn-outline" id="cancelStartTimer">Cancel</button>
        <button class="btn btn-green" id="confirmStartTimer">Next &rarr;</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  document.getElementById("cancelStartTimer").onclick = () => wrap.remove();
  const select = document.getElementById("activitySelect");
  API.getActivityOptions()
    .then((options) => {
      select.disabled = false;
      select.innerHTML = options && options.length
        ? `<option value="">Select activity…</option>` + options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")
        : `<option value="">No activities configured</option>`;
    })
    .catch((e) => { if (!handleErr(e)) select.innerHTML = `<option value="">Could not load activities</option>`; });
  document.getElementById("confirmStartTimer").onclick = () => {
    const activity = select.value;
    if (!activity) {
      document.getElementById("startTimerErr").innerHTML = `<div class="error-box">Please select an activity.</div>`;
      return;
    }
    wrap.remove();
    verifyThenPunch(p, "start", activity);
  };
}

// The person proves who they are (face, or PIN as backup), then the
// Start / Stop is done straight away with their one-time session.
function verifyThenPunch(p, action, activity) {
  const wih = teamData.wih_number;
  const back = `/t/${encodeURIComponent(wih)}`;
  const purpose = action === "start" ? `Verify to START on ${wih}` : `Verify to STOP on ${wih}`;
  const onSuccess = async (res) => {
    const busy = document.createElement("div");
    busy.className = "modal-backdrop";
    busy.innerHTML = `<div class="modal" style="text-align:center;"><span class="spinner" style="border-color:rgba(0,0,0,0.15); border-top-color:var(--ink);"></span><p style="margin:12px 0 0;">${action === "start" ? "Starting" : "Stopping"} timer for ${esc(res.full_name)}…</p></div>`;
    document.body.appendChild(busy);
    try {
      let tsName = teamData.timesheet;
      if (action === "start") {
        if (!tsName) {
          const created = await API.createTimesheet(wih, localToday(), teamData.style || "");
          tsName = created.name;
        }
        const r = await API.startTimer(tsName, activity);
        busy.remove();
        showPunchResult("start", r, back);
      } else {
        const r = await API.stopTimer(tsName);
        busy.remove();
        showPunchResult("stop", r, back);
      }
    } catch (e) {
      busy.remove();
      API.endWorkerSession();
      if (!handleErr(e)) loadTeam(wih);
    }
  };
  const opts = { purpose, onSuccess };
  const useFace = KioskSettings.face_enabled && p.has_face;
  if (useFace && !p.face_locked_minutes) { showFaceCheck(p, opts); return; }
  if (!p.has_pin) {
    toast(useFace ? `Face check locked for ${p.face_locked_minutes} min. Please ask your supervisor.` : "Not set up yet — please ask your supervisor.");
    return;
  }
  if (p.locked_minutes) { toast(`Locked after wrong PINs. Try again in ${p.locked_minutes} min.`); return; }
  showPinPad(p, useFace ? { ...opts, note: `Face check locked — use your PIN to ${action.toUpperCase()}` } : opts);
}

// ------------------------------------------------------------------
// PIN PAD (+ camera photo)
// ------------------------------------------------------------------
function showPinPad(w, opts = {}) {
  closeOverlays();
  let pin = "";
  let busy = false;

  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal pin-modal" id="pinModal">
      <div class="pin-who">
        ${avatarHtml(w)}
        <div><div class="nm">${esc(w.full_name)}</div><div class="hint">${esc(opts.note || opts.purpose || "Enter your PIN")}</div></div>
      </div>
      <div class="cam-wrap">
        <video id="camVideo" playsinline muted autoplay></video>
        <div class="cam-off" id="camOff">Starting camera…</div>
      </div>
      <div class="cam-note">&#128247; Look at the camera</div>
      <div class="pin-dots" id="pinDots"></div>
      <div class="pin-err" id="pinErr"></div>
      <div class="keypad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join("")}
        <button class="k-del" data-k="del">&#9003;</button>
        <button data-k="0">0</button>
        <button class="k-ok" data-k="ok" id="pinOk" disabled>OK</button>
      </div>
      <button class="pin-cancel" id="pinCancel">CANCEL</button>
    </div>
  `;
  document.body.appendChild(wrap);

  const video = document.getElementById("camVideo");
  startCamera(video).then((ok) => {
    const off = document.getElementById("camOff");
    if (!off) return;
    if (ok) off.remove();
    else off.textContent = KioskSettings.require_photo ? "Camera needed — please allow camera access" : "Camera off";
  });

  const resetPadTimer = () => {
    clearTimeout(pinPadTimer);
    pinPadTimer = setTimeout(() => { closeOverlays(); }, 30000);
  };
  const drawDots = () => {
    const n = Math.max(4, pin.length);
    document.getElementById("pinDots").innerHTML =
      Array.from({ length: n }, (_, i) => `<span class="${i < pin.length ? "on" : ""}"></span>`).join("");
    document.getElementById("pinOk").disabled = pin.length < 4 || busy;
  };
  const showErr = (msg) => {
    document.getElementById("pinErr").textContent = msg || "";
    const m = document.getElementById("pinModal");
    if (msg && m) { m.classList.remove("shake"); void m.offsetWidth; m.classList.add("shake"); }
  };

  const submit = async () => {
    if (busy || pin.length < 4) return;
    const photo = captureFrame(video);
    if (KioskSettings.require_photo && !photo) {
      showErr("Camera photo needed. Allow the camera and look at the screen.");
      return;
    }
    busy = true;
    drawDots();
    const okBtn = document.getElementById("pinOk");
    okBtn.innerHTML = `<span class="spinner"></span>`;
    try {
      const res = await API.verifyPin(w.user, pin, photo);
      closeOverlays();
      (opts.onSuccess || onWorkerSignedIn)(res);
    } catch (e) {
      if (e.deviceSessionEnded) { handleErr(e); return; }
      busy = false;
      pin = "";
      okBtn.textContent = "OK";
      drawDots();
      showErr(e.message);
      if (/locked|too many/i.test(e.message)) {
        setTimeout(() => { closeOverlays(); loadWorkers(true); }, 2500);
      }
    }
  };

  const press = (k) => {
    resetPadTimer();
    if (busy) return;
    if (k === "del") pin = pin.slice(0, -1);
    else if (k === "ok") { submit(); return; }
    else if (/^\d$/.test(k) && pin.length < 6) pin += k;
    showErr("");
    drawDots();
  };

  wrap.querySelectorAll(".keypad button").forEach((b) => { b.onclick = () => press(b.dataset.k); });
  document.getElementById("pinCancel").onclick = () => closeOverlays();
  wrap.onclick = (e) => { if (e.target === wrap) closeOverlays(); };

  // Also accept a physical/Bluetooth keyboard.
  pinKeyHandler = (e) => {
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === "Backspace") press("del");
    else if (e.key === "Enter") press("ok");
    else if (e.key === "Escape") closeOverlays();
  };
  document.addEventListener("keydown", pinKeyHandler);

  drawDots();
  resetPadTimer();
}


// After a correct PIN or face: start the inactivity watch and go straight to
// their running timer if they have exactly one (the usual "I'm here to STOP"
// case) — otherwise their dashboard.
function onWorkerSignedIn(res) {
  startIdleWatch();
  toast(`Hello, ${(res.full_name || "").split(" ")[0]}`, 1800);
  if (res.running && res.running.length === 1) {
    navigate(`/w/timer/${encodeURIComponent(res.running[0].timesheet)}`);
  } else {
    navigate("/w/dashboard");
  }
}

// ------------------------------------------------------------------
// FACE ENGINE (loaded once, in the background, from this app's own files —
// no outside service). The tablet turns a face into 128 numbers; the SERVER
// decides whether they match the registered worker.
// ------------------------------------------------------------------
const FACE_ASSETS = "/assets/shared_timesheet";
let faceEnginePromise = null;
let faceRun = null;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function ensureFaceEngine() {
  if (faceEnginePromise) return faceEnginePromise;
  faceEnginePromise = (async () => {
    if (!window.faceapi) {
      await new Promise((resolve, reject) => {
        const sc = document.createElement("script");
        sc.src = `${FACE_ASSETS}/js/face-api.js?v=${window.ASSET_VERSION || "1"}`;
        sc.onload = resolve;
        sc.onerror = () => reject(new Error("Could not load the face engine."));
        document.head.appendChild(sc);
      });
    }
    const fa = window.faceapi;
    const ok = await fa.tf.setBackend("webgl").catch(() => false);
    if (!ok) await fa.tf.setBackend("cpu");
    await fa.tf.ready();
    const url = `${FACE_ASSETS}/face-models`;
    await Promise.all([
      fa.nets.tinyFaceDetector.loadFromUri(url),
      fa.nets.faceLandmark68Net.loadFromUri(url),
      fa.nets.faceRecognitionNet.loadFromUri(url),
    ]);
    return fa;
  })();
  faceEnginePromise.catch(() => { faceEnginePromise = null; });
  return faceEnginePromise;
}

function faceOpts(fa) { return new fa.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }); }
function eyeRatio(p) {
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return (d(p[1], p[5]) + d(p[2], p[4])) / (2 * d(p[0], p[3]));
}
function eyeOpenness(lm) { return (eyeRatio(lm.getLeftEye()) + eyeRatio(lm.getRightEye())) / 2; }
function toArr(desc) { return Array.from(desc, (v) => Math.round(v * 1e5) / 1e5); }

// Watches the camera until it has (1) one clear face, (2) a blink, then
// (3) a second capture with eyes open again. Returns the face numbers.
async function runFaceCheck(video, setStatus, run) {
  const fa = await ensureFaceEngine();
  const opts = faceOpts(fa);
  const needBlink = !!KioskSettings.require_blink;
  const deadline = Date.now() + 25000;
  let desc1 = null, photo = null, openLevel = 0, closedSeen = false, blinked = !needBlink;

  while (!run.cancelled && Date.now() < deadline) {
    if (!video.videoWidth) { await sleep(150); continue; }
    const dets = await fa.detectAllFaces(video, opts).withFaceLandmarks();
    if (run.cancelled) return null;
    if (dets.length === 0) { setStatus(desc1 ? "Keep looking at the camera" : "Look straight at the camera"); await sleep(80); continue; }
    if (dets.length > 1) { setStatus("Only one person in front of the camera, please"); await sleep(150); continue; }
    const d = dets[0];
    const e = eyeOpenness(d.landmarks);

    if (!desc1) {
      setStatus("Hold still…");
      if (d.detection.score < 0.6) { await sleep(80); continue; }
      const full = await fa.detectSingleFace(video, opts).withFaceLandmarks().withFaceDescriptor();
      if (run.cancelled) return null;
      if (!full || full.detection.score < 0.6) continue;
      desc1 = toArr(full.descriptor);
      photo = captureFrame(video);
      openLevel = eyeOpenness(full.landmarks);
      if (blinked) break;
      setStatus("Now blink slowly \u{1F441}");
      continue;
    }
    // Blink: eyes clearly close, then open again.
    if (!closedSeen) {
      if (e > openLevel) openLevel = openLevel * 0.7 + e * 0.3;
      if (e < openLevel * 0.72) closedSeen = true;
    } else if (e > openLevel * 0.85) {
      blinked = true;
      break;
    }
    await sleep(30);
  }
  if (run.cancelled) return null;
  if (!desc1 || !blinked) return { timeout: true, sawFace: !!desc1 };

  let desc2 = null;
  for (let i = 0; i < 8 && !run.cancelled && !desc2; i++) {
    const full = await fa.detectSingleFace(video, opts).withFaceLandmarks().withFaceDescriptor();
    if (full && full.detection.score >= 0.6 && eyeOpenness(full.landmarks) > openLevel * 0.8) desc2 = toArr(full.descriptor);
    else await sleep(100);
  }
  if (run.cancelled) return null;
  return { descriptors: desc2 ? [desc1, desc2] : [desc1], photo, blinked };
}

// ------------------------------------------------------------------
// FACE CHECK screen (tap name → look → blink → in)
// ------------------------------------------------------------------
function showFaceCheck(w, opts = {}) {
  closeOverlays();
  const run = { cancelled: false };
  faceRun = run;
  const pinAllowed = KioskSettings.allow_pin_fallback && w.has_pin;

  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal pin-modal" id="faceModal">
      <div class="pin-who">
        ${avatarHtml(w)}
        <div><div class="nm">${esc(w.full_name)}</div><div class="hint">${esc(opts.purpose || "Face check")}</div></div>
      </div>
      <div class="cam-wrap big" id="faceCam">
        <video id="camVideo" playsinline muted autoplay></video>
        <div class="cam-off" id="camOff">Starting camera…</div>
      </div>
      <div class="face-status" id="faceStatus">Loading face check…</div>
      <div class="face-sub">Remove cap / mask · face the light</div>
      <div class="pin-err" id="faceErr"></div>
      <div class="face-actions">
        <button class="btn btn-green" id="faceRetry" style="display:none;">&#8635; Try Again</button>
        ${pinAllowed ? `<button class="btn btn-outline" id="facePin">Use PIN Instead</button>` : ""}
      </div>
      <button class="pin-cancel" id="faceCancel">CANCEL</button>
    </div>
  `;
  document.body.appendChild(wrap);

  const video = document.getElementById("camVideo");
  const setStatus = (t) => { const el = document.getElementById("faceStatus"); if (el) el.textContent = t; };
  const setErr = (t) => {
    const el = document.getElementById("faceErr"); if (el) el.textContent = t || "";
    const m = document.getElementById("faceModal");
    if (t && m) { m.classList.remove("shake"); void m.offsetWidth; m.classList.add("shake"); }
  };
  const showRetry = (on) => { const b = document.getElementById("faceRetry"); if (b) b.style.display = on ? "" : "none"; };
  const scanning = (on) => { const c = document.getElementById("faceCam"); if (c) c.classList.toggle("scanning", on); };

  document.getElementById("faceCancel").onclick = () => closeOverlays();
  wrap.onclick = (e) => { if (e.target === wrap) closeOverlays(); };
  const pinBtn = document.getElementById("facePin");
  if (pinBtn) pinBtn.onclick = () => showPinPad(w, { ...opts, note: "Using PIN instead of face" });

  clearTimeout(pinPadTimer);
  pinPadTimer = setTimeout(() => { if (faceRun === run) closeOverlays(); }, 60000);

  const go = async () => {
    setErr(""); showRetry(false);
    try {
      setStatus("Loading face check…");
      await ensureFaceEngine();
      if (run.cancelled) return;
      if (!camStream) {
        const ok = await startCamera(video);
        if (run.cancelled) return;
        if (!ok) {
          setStatus("Camera not available");
          setErr("Please allow camera access for this site.");
          showRetry(true);
          return;
        }
      }
      const off = document.getElementById("camOff"); if (off) off.remove();
      scanning(true);
      const result = await runFaceCheck(video, setStatus, run);
      scanning(false);
      if (!result || run.cancelled) return;
      if (result.timeout) {
        setStatus(result.sawFace ? "Didn't catch a blink" : "Couldn't see your face clearly");
        setErr(result.sawFace ? "Blink slowly, once, while looking at the camera." : "Face the light and come a little closer.");
        showRetry(true);
        return;
      }
      setStatus("Checking…");
      const res = await API.verifyFace(w.user, result.descriptors, result.photo, result.blinked);
      if (run.cancelled) return;
      closeOverlays();
      (opts.onSuccess || onWorkerSignedIn)(res);
    } catch (e) {
      scanning(false);
      if (run.cancelled) return;
      if (e.deviceSessionEnded) { handleErr(e); return; }
      setStatus("Not verified");
      setErr(e.message);
      if (!/locked|not registered|switched off/i.test(e.message)) showRetry(true);
    }
  };
  document.getElementById("faceRetry").onclick = () => go();
  go();
}

// ------------------------------------------------------------------
// REGISTER FACES (Timesheet Managers only)
// ------------------------------------------------------------------
async function renderFaces() {
  app.innerHTML = workerChrome() + `
    <div class="screen" id="facesScreen">
      <button class="back-link" id="backBtn">&larr; Back</button>
      <div class="section-head"><h2>Register Faces</h2></div>
      <p class="info-note" style="text-align:left;">
        Register each worker once, in the same spot and lighting where the tablet will be used.
        Get the worker's signed consent first.
      </p>
      <div id="facesList"><div class="loading-center">Loading…</div></div>
    </div>
  `;
  wireChrome();
  document.getElementById("backBtn").onclick = () => navigate("/w/dashboard");
  ensureFaceEngine().catch(() => {});
  await loadFacesList();
}

async function loadFacesList() {
  const area = document.getElementById("facesList");
  if (!area) return;
  try {
    const workers = await API.listWorkers();
    const areaNow = document.getElementById("facesList");
    if (!areaNow) return;
    if (!workers.length) { areaNow.innerHTML = `<div class="empty-state">No workers yet. Add them in ERPNext → Kiosk Worker.</div>`; return; }
    areaNow.innerHTML = workers.map((w) => `
      <div class="face-row">
        ${avatarHtml(w)}
        <div class="fr-main">
          <div class="fr-name">${esc(w.full_name)}</div>
          <div class="fr-st ${w.has_face ? "ok" : ""}">${w.has_face ? "&#10003; Face registered" : "Not registered"}${w.has_pin ? " · PIN set" : " · no PIN"}</div>
        </div>
        <div class="fr-btns">
          <button class="btn btn-primary" data-reg="${esc(w.user)}">${w.has_face ? "Redo" : "Register"}</button>
          ${w.has_face ? `<button class="btn btn-red" data-del="${esc(w.user)}">Remove</button>` : ""}
        </div>
      </div>
    `).join("");
    areaNow.querySelectorAll("[data-reg]").forEach((b) => {
      b.onclick = () => showRegisterFace(workers.find((x) => x.user === b.dataset.reg));
    });
    areaNow.querySelectorAll("[data-del]").forEach((b) => {
      b.onclick = async () => {
        const w = workers.find((x) => x.user === b.dataset.del);
        if (!confirm(`Remove ${w.full_name}'s face registration? They will need their PIN until registered again.`)) return;
        try { await API.removeFace(w.user); toast("Face removed"); loadFacesList(); } catch (e) { handleErr(e); }
      };
    });
  } catch (e) {
    handleErr(e, document.getElementById("facesList"));
  }
}

function showRegisterFace(w) {
  closeOverlays();
  const run = { cancelled: false };
  faceRun = run;
  const steps = [
    "Look straight at the camera",
    "Turn your head slightly LEFT",
    "Turn your head slightly RIGHT",
    "Lift your chin a little",
    "Look straight again",
  ];

  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal pin-modal" id="regModal">
      <div class="pin-who">
        ${avatarHtml(w)}
        <div><div class="nm">${esc(w.full_name)}</div><div class="hint">Register face</div></div>
      </div>
      <div class="cam-wrap big" id="regCam">
        <video id="camVideo" playsinline muted autoplay></video>
        <div class="cam-off" id="camOff">Starting camera…</div>
      </div>
      <div class="face-status" id="regStatus">Worker: stand in front of the tablet</div>
      <div class="reg-dots" id="regDots">${steps.map(() => "<span></span>").join("")}</div>
      <label class="check-row"><input type="checkbox" id="regConsent" />
        <span>${esc(w.full_name)} has signed the consent form for using their face for attendance.</span></label>
      <div class="field" style="margin-bottom:8px;">
        <input id="regRef" type="text" placeholder="Consent form no. / date (optional)" maxlength="140" />
      </div>
      <div class="pin-err" id="regErr"></div>
      <div class="row">
        <button class="btn btn-outline" id="regCancel">Cancel</button>
        <button class="btn btn-green" id="regStart">Start</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const video = document.getElementById("camVideo");
  const setStatus = (t) => { const el = document.getElementById("regStatus"); if (el) el.textContent = t; };
  const setErr = (t) => { const el = document.getElementById("regErr"); if (el) el.textContent = t || ""; };
  document.getElementById("regCancel").onclick = () => closeOverlays();

  Promise.all([ensureFaceEngine(), startCamera(video)]).then(([, ok]) => {
    const off = document.getElementById("camOff");
    if (off) { if (ok) off.remove(); else off.textContent = "Camera not available — allow camera access"; }
  }).catch((e) => setErr(e.message));

  const startBtn = document.getElementById("regStart");
  startBtn.onclick = async () => {
    setErr("");
    if (!document.getElementById("regConsent").checked) { setErr("Please confirm the worker's consent first."); return; }
    if (!camStream) { setErr("Camera not available — allow camera access and reopen."); return; }
    startBtn.disabled = true;
    startBtn.innerHTML = `<span class="spinner"></span>`;
    const dots = document.querySelectorAll("#regDots span");
    try {
      const fa = await ensureFaceEngine();
      const opts = faceOpts(fa);
      const descs = [];
      let photo = null;
      document.getElementById("regCam").classList.add("scanning");
      for (let i = 0; i < steps.length; i++) {
        setStatus(steps[i]);
        await sleep(1300);
        let got = null;
        for (let tries = 0; tries < 30 && !run.cancelled && !got; tries++) {
          const dets = await fa.detectAllFaces(video, opts).withFaceLandmarks().withFaceDescriptors();
          if (dets.length === 1 && dets[0].detection.score > 0.7) got = dets[0];
          else {
            setStatus(dets.length > 1 ? "Only the worker in front of the camera" : steps[i]);
            await sleep(150);
          }
        }
        if (run.cancelled) return;
        if (!got) throw new Error("Couldn't get a clear face. Improve the lighting and try again.");
        descs.push(toArr(got.descriptor));
        if (i === 0) photo = captureFrame(video);
        dots[i].classList.add("on");
        bumpActivity();
      }
      document.getElementById("regCam").classList.remove("scanning");
      setStatus("Saving…");
      await API.registerFace(w.user, descs, photo, true, document.getElementById("regRef").value.trim());
      closeOverlays();
      toast(`Face registered for ${w.full_name}`);
      loadFacesList();
    } catch (e) {
      if (run.cancelled) return;
      const cam = document.getElementById("regCam"); if (cam) cam.classList.remove("scanning");
      dots.forEach((d) => d.classList.remove("on"));
      if (handleErr(e)) return;
      setStatus("Not saved");
      setErr(e.message);
      startBtn.disabled = false;
      startBtn.textContent = "Try Again";
    }
  };
}

// ------------------------------------------------------------------
// Worker chrome: black bar (who + countdown + DONE) and the menu
// ------------------------------------------------------------------
function workerChrome() {
  return `
    <div class="worker-bar">
      <div class="wb-name">&#128100; ${esc(Worker.fullName)}</div>
      <div class="wb-right">
        <span class="wb-count" id="idleCountdown"></span>
        <button class="wb-done" id="doneBtn">&#10003; Done</button>
      </div>
    </div>
    <div class="topbar">
      <div style="display:flex; align-items:center; gap:10px;">
        <button class="icon-btn" id="menuBtn" aria-label="Menu">&#9776;</button>
        <div class="brand" id="brandHome">
          <span class="brand-logo">amal</span>
          <span class="brand-title">TIMESHEET</span>
        </div>
      </div>
    </div>
    <div class="drawer-backdrop" id="drawerBackdrop"></div>
    <div class="side-drawer" id="sideDrawer">
      <div class="side-drawer-head">
        <span class="brand-logo">amal</span>
        <button class="drawer-close" id="drawerClose" aria-label="Close menu">&times;</button>
      </div>
      <nav class="side-drawer-nav">
        <div class="drawer-link" id="navDashboard">My Timesheets</div>
        <div class="drawer-link" id="navReport">My Timesheet Report</div>
        <div class="drawer-link" id="navPin">Change My PIN</div>
        ${Worker.isManager ? `<div class="drawer-link" id="navFaces">Register Faces</div>` : ""}
        ${Worker.isManager ? `<div class="drawer-link" id="navDeviceOut" style="color:var(--danger)">Sign Out This Device</div>` : ""}
        <div class="drawer-link" id="navDone">&#10003; Done (sign me out)</div>
      </nav>
    </div>
  `;
}

function wireChrome() {
  const done = () => signOutWorker();
  document.getElementById("doneBtn").onclick = done;

  const drawer = document.getElementById("sideDrawer");
  const backdrop = document.getElementById("drawerBackdrop");
  const openDrawer = () => { drawer.classList.add("open"); backdrop.classList.add("open"); };
  const closeDrawer = () => { drawer.classList.remove("open"); backdrop.classList.remove("open"); };
  document.getElementById("menuBtn").onclick = openDrawer;
  document.getElementById("drawerClose").onclick = closeDrawer;
  backdrop.onclick = closeDrawer;
  document.getElementById("brandHome").onclick = () => navigate("/w/dashboard");

  document.getElementById("navDashboard").onclick = () => { closeDrawer(); navigate("/w/dashboard"); };
  document.getElementById("navReport").onclick = () => { closeDrawer(); navigate("/w/report"); };
  document.getElementById("navPin").onclick = () => { closeDrawer(); showChangePinModal(); };
  document.getElementById("navDone").onclick = () => { closeDrawer(); done(); };
  const navFaces = document.getElementById("navFaces");
  if (navFaces) navFaces.onclick = () => { closeDrawer(); navigate("/w/faces"); };
  const devOut = document.getElementById("navDeviceOut");
  if (devOut) devOut.onclick = () => { closeDrawer(); showDeviceSignOutModal(); };
}

function fab() { return `<button class="fab" id="newTimesheetFab">+ New Timesheet</button>`; }
function wireFab() {
  const btn = document.getElementById("newTimesheetFab");
  if (btn) btn.onclick = () => navigate("/w/new");
}

// ------------------------------------------------------------------
// DASHBOARD (worker's own)
// ------------------------------------------------------------------
let currentFilter = "All";
let dashboardPage = 1;
let dashboardWihSearch = "";
let searchDebounce = null;

function renderDashboard() {
  app.innerHTML = workerChrome() + `
    <div class="screen" id="dashScreen">
      <div id="statsArea" class="stat-grid">
        <div class="stat-card"><div class="label">TIME TODAY</div><div class="value">&hellip;</div></div>
        <div class="stat-card"><div class="label">TIMESHEETS PENDING</div><div class="value">&hellip;</div></div>
        <div class="stat-card"><div class="label">ACTIVE SHEETS</div><div class="value">&hellip;</div></div>
        <div class="stat-card"><div class="label">STATUS</div><div class="value">&hellip;</div></div>
      </div>
      <div class="section-head"><h2>My Timesheets</h2></div>
      <div class="tabs">
        ${["All", "Draft", "Submitted"].map((f) => `<div class="tab ${f === currentFilter ? "active" : ""}" data-filter="${f}">${f.toUpperCase()}</div>`).join("")}
      </div>
      <div class="field">
        <input id="wihSearchInput" type="text" placeholder="Search by WIH number…" value="${esc(dashboardWihSearch)}" />
      </div>
      <div id="sheetListArea"><div class="loading-center">Loading…</div></div>
    </div>
  ` + fab();

  wireChrome();
  wireFab();
  wireDashboardControls();
  loadStats();
  loadSheetList();
}

async function loadStats() {
  try {
    const stats = await API.getStats();
    const el = document.getElementById("statsArea");
    if (el) el.innerHTML = statCardsHtml(stats);
  } catch (e) {
    if (e.workerSessionEnded || e.deviceSessionEnded) handleErr(e);
  }
}

function statCardsHtml(stats) {
  return `
    <div class="stat-card"><div class="label">TIME TODAY</div><div class="value">${fmtHrsMins(stats.total_hours_today)}</div></div>
    <div class="stat-card"><div class="label">TIMESHEETS PENDING</div><div class="value">${stats.pending_timesheets ?? 0}</div></div>
    <div class="stat-card"><div class="label">ACTIVE SHEETS</div><div class="value">${stats.active_timesheets}</div></div>
    <div class="stat-card"><div class="label">${stats.has_active_timer ? "TIMER RUNNING" : "ALL TIMERS STOPPED"}</div><div class="value">${stats.has_active_timer ? "&#9654;" : "&#9632;"}</div></div>
  `;
}

async function loadSheetList() {
  const area = document.getElementById("sheetListArea");
  if (area) area.innerHTML = `<div class="loading-center">Loading…</div>`;
  try {
    const resp = await API.listTimesheets(
      currentFilter === "All" ? undefined : currentFilter,
      dashboardWihSearch || undefined,
      dashboardPage
    );
    const areaNow = document.getElementById("sheetListArea");
    if (areaNow) {
      areaNow.innerHTML = sheetListHtml(resp);
      wireSheetList();
    }
  } catch (e) {
    handleErr(e, document.getElementById("sheetListArea"));
  }
}

function sheetListHtml(resp) {
  const sheets = resp.items || [];
  const totalPages = Math.max(1, Math.ceil((resp.total || 0) / (resp.page_size || 10)));
  return `
    <div id="sheetList">
      ${sheets.length ? sheets.map(sheetCard).join("") : `<div class="empty-state">No timesheets found.</div>`}
    </div>
    ${resp.total > resp.page_size ? `
      <div class="pagination">
        <button class="btn btn-outline pagination-btn" id="dashPrevBtn" ${resp.page <= 1 ? "disabled" : ""}>&larr; Prev</button>
        <span class="page-indicator">Page ${resp.page} of ${totalPages}</span>
        <button class="btn btn-outline pagination-btn" id="dashNextBtn" ${resp.page >= totalPages ? "disabled" : ""}>Next &rarr;</button>
      </div>
    ` : ""}
  `;
}

function sheetCard(s) {
  const statusClass = s.status === "Draft" ? "status-draft" : "status-submitted";
  return `
    <div class="sheet-card" data-name="${esc(s.name)}">
      <div>
        <div class="wih">${esc(s.wih_number)}</div>
        <div class="name">${esc(s.product_name || s.name)}</div>
        <div class="meta">${esc(s.start_date)} &middot; ${fmtHrsMins(s.total_hours)}</div>
      </div>
      <div class="right">
        <div class="right-top">
          ${s.is_running_for_me ? `<span class="running-dot" title="Your timer is running"></span>` : ""}
          <span class="status-pill ${statusClass}">${esc((s.status || "").toUpperCase())}</span>
        </div>
      </div>
    </div>
  `;
}

function wireDashboardControls() {
  document.querySelectorAll("#dashScreen .tab").forEach((tab) => {
    tab.onclick = () => {
      currentFilter = tab.dataset.filter;
      dashboardPage = 1;
      document.querySelectorAll("#dashScreen .tab").forEach((t) => t.classList.toggle("active", t === tab));
      loadSheetList();
    };
  });
  const searchInput = document.getElementById("wihSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        dashboardWihSearch = searchInput.value.trim();
        dashboardPage = 1;
        loadSheetList();
      }, 350);
    });
  }
}

function wireSheetList() {
  document.querySelectorAll(".sheet-card").forEach((card) => {
    card.onclick = () => navigate(`/w/timer/${encodeURIComponent(card.dataset.name)}`);
  });
  const prevBtn = document.getElementById("dashPrevBtn");
  if (prevBtn) prevBtn.onclick = () => { dashboardPage = Math.max(1, dashboardPage - 1); loadSheetList(); };
  const nextBtn = document.getElementById("dashNextBtn");
  if (nextBtn) nextBtn.onclick = () => { dashboardPage += 1; loadSheetList(); };
}

// ------------------------------------------------------------------
// NEW TIMESHEET
// ------------------------------------------------------------------
async function renderNewTimesheet() {
  app.innerHTML = workerChrome() + `<div class="screen" id="newScreen"><div class="loading-center">Loading assigned WIH…</div></div>`;
  wireChrome();

  let wihList;
  try {
    wihList = await API.listWih();
  } catch (e) {
    handleErr(e, document.getElementById("newScreen"));
    return;
  }
  const screen = document.getElementById("newScreen");
  if (!screen) return;

  screen.innerHTML = `
    <button class="back-link" id="backBtn">&larr; Back</button>
    <div class="form-card">
      <div class="form-card-head">
        <h2>New Timesheet</h2>
        <p>Select a Work In Hand order to begin tracking time</p>
      </div>
      <div class="form-card-body">
        <div id="err"></div>
        <div class="field">
          <label>Work In Hand Order</label>
          <select id="wihSelect">
            <option value="">Search WIH order…</option>
            ${wihList.map((w) => `<option value="${esc(w.name)}">${esc(w.name)}</option>`).join("")}
          </select>
        </div>
        ${wihList.length === 0 ? `<p style="color:var(--sub); font-size:12px; margin-top:-8px;">No unassigned WIH orders found — ask your supervisor to add you in Timesheet Allocation, or check if your WIH already has an open timesheet on your dashboard.</p>` : ""}
        <div class="two-col">
          <div class="field">
            <label>Start Date</label>
            <input id="startDate" type="date" value="${localToday()}" />
          </div>
          <div class="field">
            <label>Style Code</label>
            <input id="styleCode" type="text" placeholder="Select a WIH above" readonly />
          </div>
        </div>
        <button class="btn btn-primary" id="createBtn" style="margin-top:6px;">Create Timesheet</button>
      </div>
    </div>
  `;

  document.getElementById("backBtn").onclick = () => navigate("/w/dashboard");
  const wihSelect = document.getElementById("wihSelect");
  const styleCodeInput = document.getElementById("styleCode");
  wihSelect.onchange = () => {
    const selected = wihList.find((w) => w.name === wihSelect.value);
    styleCodeInput.value = (selected && selected.client_code) || "";
  };

  document.getElementById("createBtn").onclick = async () => {
    const wih = wihSelect.value;
    const startDate = document.getElementById("startDate").value;
    const style = styleCodeInput.value;
    const errBox = document.getElementById("err");
    errBox.innerHTML = "";
    if (!wih || !startDate) {
      errBox.innerHTML = `<div class="error-box">Please select a WIH order and start date</div>`;
      return;
    }
    const btn = document.getElementById("createBtn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Creating...`;
    try {
      const res = await API.createTimesheet(wih, startDate, style);
      navigate(`/w/timer/${encodeURIComponent(res.name)}`);
    } catch (e) {
      handleErr(e, errBox);
      btn.disabled = false;
      btn.textContent = "Create Timesheet";
    }
  };
}

// ------------------------------------------------------------------
// MY TIMESHEET REPORT (worker's own hours)
// ------------------------------------------------------------------
let reportFrom = "";
let reportTo = "";
let reportWih = "";
let reportStatus = "All";
let reportSearchDebounce = null;
let reportOwner = null; // filters are cleared when a different worker opens the report

function renderMyTimesheetReport() {
  if (reportOwner !== Worker.user) {
    reportFrom = ""; reportTo = ""; reportWih = ""; reportStatus = "All";
    reportOwner = Worker.user;
  }
  app.innerHTML = workerChrome() + `
    <div class="screen" id="reportScreen">
      <div class="section-head"><h2>My Timesheet</h2></div>
      <div class="two-col" style="margin-bottom:14px;">
        <div class="field" style="margin-bottom:0;">
          <label>From Date</label>
          <input id="reportFromInput" type="date" value="${esc(reportFrom)}" />
        </div>
        <div class="field" style="margin-bottom:0;">
          <label>To Date</label>
          <input id="reportToInput" type="date" value="${esc(reportTo)}" />
        </div>
      </div>
      <div class="field">
        <label>WIH Number</label>
        <input id="reportWihInput" type="text" placeholder="Search by WIH number…" value="${esc(reportWih)}" />
      </div>
      <div class="tabs" style="margin-bottom:16px;">
        ${["All", "Draft", "Submitted"].map((f) => `<div class="tab ${f === reportStatus ? "active" : ""}" data-status="${f}">${f.toUpperCase()}</div>`).join("")}
      </div>
      <div id="reportListArea"></div>
    </div>
  `;
  wireChrome();

  document.getElementById("reportFromInput").onchange = (e) => { reportFrom = e.target.value; maybeLoadReport(); };
  document.getElementById("reportToInput").onchange = (e) => { reportTo = e.target.value; maybeLoadReport(); };
  const wihInput = document.getElementById("reportWihInput");
  wihInput.addEventListener("input", () => {
    clearTimeout(reportSearchDebounce);
    reportSearchDebounce = setTimeout(() => { reportWih = wihInput.value.trim(); maybeLoadReport(); }, 350);
  });
  document.querySelectorAll("#reportScreen .tab").forEach((tab) => {
    tab.onclick = () => {
      reportStatus = tab.dataset.status;
      document.querySelectorAll("#reportScreen .tab").forEach((t) => t.classList.toggle("active", t === tab));
      maybeLoadReport();
    };
  });
  maybeLoadReport();
}

function maybeLoadReport() {
  const area = document.getElementById("reportListArea");
  if (!area) return;
  const hasRange = !!(reportFrom && reportTo);
  const hasWih = !!reportWih;
  if (!hasRange && !hasWih) {
    area.innerHTML = `<div class="empty-state">Select a date range or search a WIH number to see your timesheet.</div>`;
    return;
  }
  loadReport(hasRange, hasWih);
}

async function loadReport(hasRange, hasWih) {
  const area = document.getElementById("reportListArea");
  if (!area) return;
  area.innerHTML = `<div class="loading-center">Loading…</div>`;
  try {
    const rows = await API.getMyTimesheetReport(
      hasRange ? reportFrom : undefined,
      hasRange ? reportTo : undefined,
      hasWih ? reportWih : undefined,
      reportStatus === "All" ? undefined : reportStatus
    );
    const areaNow = document.getElementById("reportListArea");
    if (!areaNow) return;
    areaNow.innerHTML = reportListHtml(rows);
    document.querySelectorAll("#reportList .report-row").forEach((row) => {
      row.onclick = () => navigate(`/w/timer/${encodeURIComponent(row.dataset.name)}?from=report`);
    });
  } catch (e) {
    handleErr(e, document.getElementById("reportListArea"));
  }
}

function reportListHtml(rows) {
  if (!rows.length) return `<div class="empty-state">No time logged matching these filters.</div>`;
  const totalHours = rows.reduce((sum, r) => sum + (parseFloat(r.hours) || 0), 0);
  return `
    <div class="entries-card">
      <div class="report-cols"><div>DATE</div><div>WIH</div><div>HOURS</div><div>STATUS</div></div>
      <div id="reportList">${rows.map(reportRow).join("")}</div>
      <div class="report-footer"><span>TOTAL</span><span>${fmtHrsMins(totalHours)}</span></div>
    </div>
  `;
}

function reportRow(r) {
  const statusClass = r.status === "Draft" ? "status-draft" : "status-submitted";
  return `
    <div class="report-row" data-name="${esc(r.name)}">
      <div>${esc(r.entry_date)}</div>
      <div>
        <div class="report-wih">${esc(r.wih_number)}</div>
        ${r.product_name ? `<div class="report-style">${esc(r.product_name)}</div>` : ""}
      </div>
      <div class="hrs">${fmtHrsMins(r.hours)}</div>
      <div><span class="status-pill ${statusClass}">${esc((r.status || "").toUpperCase())}</span></div>
    </div>
  `;
}

// ------------------------------------------------------------------
// TIMER SCREEN
// ------------------------------------------------------------------
let entriesPage = 1;
const ENTRIES_PAGE_SIZE = 6;

async function renderTimer(name) {
  app.innerHTML = workerChrome() + `<div class="screen"><div class="loading-center">Loading timesheet…</div></div>`;
  wireChrome();
  await loadTimerScreen(name);
}

async function loadTimerScreen(name) {
  clearInterval(timerInterval);
  entriesPage = 1;

  let doc;
  try {
    doc = await API.getTimesheet(name);
  } catch (e) {
    const scr = document.querySelector(".screen");
    handleErr(e, scr);
    return;
  }
  if (!Worker.active()) return;

  const sortedEntries = [...doc.timesheet_entry].sort((a, b) => b.idx - a.idx);
  const runningRow = doc.timesheet_entry.find((e) => e.is_running);
  const isDraft = doc.docstatus === 0;
  const isManager = Worker.isManager;
  const canEdit = isDraft && !!doc.can_edit_entries;
  const runningTeammates = doc.running_timer_users || [];
  const canSubmitNow = isDraft && isManager && runningTeammates.length === 0;

  app.innerHTML = workerChrome() + `
    <div class="screen">
      <div class="timer-topbar">
        <button class="back-link" id="backBtn" style="margin:0;">&larr; Back</button>
        ${!isDraft
          ? `<span class="status-pill status-submitted">SUBMITTED</span>`
          : (canSubmitNow ? `<button class="btn btn-primary" id="submitBtn" style="width:auto; padding:10px 16px; font-size:12px;">&#10003; Submit Timesheet</button>` : "")}
      </div>

      <div class="wih-card">
        <div class="wih-info-row">
          ${doc.wih_photo ? `<img src="${esc(doc.wih_photo)}" class="wih-thumb" id="wihThumb" alt="WIH photo" onerror="this.remove()" />` : ""}
          <div>
            <div class="lbl">WORK IN HAND (WIH)</div>
            <div class="wih-name">${esc(doc.wih_number)}</div>
            <div class="style">${esc(doc.product_name)}</div>
          </div>
        </div>
        <div class="hours-block-group">
          <div class="hours-block">
            <div class="hours-lbl">MY HOURS</div>
            <div class="hours-val" id="personalHours">${fmtHrsMins(doc.personal_hours)}</div>
          </div>
          <div class="hours-block">
            <div class="hours-lbl">TEAM TOTAL</div>
            <div class="hours-val" id="totalHours">${fmtHrsMins(doc.total_hours)}</div>
          </div>
        </div>
      </div>

      ${!isDraft && doc.final_hrs != null ? `
        <div class="final-hrs-card">
          <div class="hours-lbl">FINAL HRS (AS PER SUPERVISOR)</div>
          <div class="hours-val">${fmtHrsMins(doc.final_hrs)}</div>
        </div>` : ""}

      ${isDraft && isManager && runningTeammates.length > 0 ? `
        <div class="warning-box">
          &#9201; Timer still running for <strong>${runningTeammates.map((u) => esc(u.full_name)).join(", ")}</strong>.
          Ask them to stop it before you can submit.
        </div>` : ""}

      ${isDraft && !isManager ? `<div class="info-note">Only a Timesheet Manager can submit this timesheet. You can keep logging your time as usual.</div>` : ""}

      ${isDraft ? `
        <button class="timer-btn ${runningRow ? "timer-running" : "btn-green"}" id="timerBtn">
          ${runningRow ? "&#9632; Stop Timer" : "&#9654; Start Timer"}
        </button>` : ""}

      <div class="entries-card">
        <div class="entries-head">My Time Entries</div>
        <div class="entries-cols"><div>DATE</div><div>START</div><div>END</div><div>ACTIVITY</div><div>TIME</div><div></div></div>
        <div id="entryRows">${renderEntryRows(sortedEntries, canEdit)}</div>
        <div id="entriesPagination">${renderEntriesPagination(sortedEntries.length)}</div>
      </div>

      ${canEdit ? `
      <div class="manual-card">
        <div class="manual-head">
          <div class="title" id="manualToggle">+ Add Manual Entry</div>
          <p>Log time that wasn't captured by the timer</p>
        </div>
        <div class="manual-body" id="manualBody" style="display:none;">
          <div class="two-col" style="margin-bottom:14px;">
            <div class="field" style="margin-bottom:0;">
              <label>Date</label>
              <input id="mDate" type="date" value="${localToday()}" />
            </div>
            <div class="field" style="margin-bottom:0;">
              <label>Start Time</label>
              <input id="mStart" type="time" value="08:00" />
            </div>
          </div>
          <div class="two-col" style="margin-bottom:14px;">
            <div class="field" style="margin-bottom:0;">
              <label>End Time</label>
              <input id="mEnd" type="time" value="17:00" />
            </div>
            <div class="field" style="margin-bottom:0;">
              <label>Notes (Optional)</label>
              <input id="mNotes" type="text" placeholder="Why manual?" />
            </div>
          </div>
          <button class="btn btn-outline" id="appendBtn" style="width:auto; padding:12px 18px;">+ Append Record</button>
        </div>
      </div>` : ""}
      <div id="err"></div>
    </div>
  `;
  wireChrome();

  const cameFromReport = new URLSearchParams(location.search).get("from") === "report";
  document.getElementById("backBtn").onclick = () => navigate(cameFromReport ? "/w/report" : "/w/dashboard");

  const wihThumb = document.getElementById("wihThumb");
  if (wihThumb) wihThumb.onclick = () => showImageModal(doc.wih_photo);

  if (isDraft) {
    document.getElementById("timerBtn").onclick = async () => {
      if (runningRow) {
        const btn = document.getElementById("timerBtn");
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner"></span> Stopping…`;
        try {
          const res = await API.stopTimer(name);
          showPunchResult("stop", res);
        } catch (e) {
          if (!handleErr(e)) { btn.disabled = false; btn.innerHTML = "&#9632; Stop Timer"; }
        }
      } else {
        showStartTimerModal(name);
      }
    };

    const submitBtn = document.getElementById("submitBtn");
    if (submitBtn) submitBtn.onclick = () => showSubmitModal(name, doc.total_hours);

    if (canEdit) {
      document.getElementById("manualToggle").onclick = () => {
        const body = document.getElementById("manualBody");
        body.style.display = body.style.display === "none" ? "block" : "none";
      };
      document.getElementById("appendBtn").onclick = async () => {
        const mDate = document.getElementById("mDate").value;
        const mStart = document.getElementById("mStart").value;
        const mEnd = document.getElementById("mEnd").value;
        const mNotes = document.getElementById("mNotes").value;
        const errBox = document.getElementById("err");
        errBox.innerHTML = "";
        if (!mDate || !mStart || !mEnd) {
          errBox.innerHTML = `<div class="error-box">Please fill date, start and end time</div>`;
          return;
        }
        try {
          await API.addEntry(name, mDate, mStart, mEnd, mNotes);
          toast("Manual entry added");
          await loadTimerScreen(name);
        } catch (e) {
          handleErr(e, errBox);
        }
      };
    }
  }

  wireEntries(name, sortedEntries, canEdit);

  // Live-tick this worker's own running timer (same approach as the old app:
  // server-computed elapsed hours + browser's own clock, never re-parsing
  // the naive start_time string).
  if (runningRow) {
    const elapsedAtLoadHours = parseFloat(doc.active_timer_elapsed_hours) || 0;
    const loadedAtMs = Date.now();
    const baseHours = parseFloat(doc.personal_hours) || 0;
    const baseTotalHours = parseFloat(doc.total_hours) || 0;
    timerInterval = setInterval(() => {
      const liveElapsed = elapsedAtLoadHours + (Date.now() - loadedAtMs) / 3600000;
      const personalEl = document.getElementById("personalHours");
      if (personalEl) personalEl.textContent = fmtHrsMins(baseHours + liveElapsed);
      const totalEl = document.getElementById("totalHours");
      if (totalEl) totalEl.textContent = fmtHrsMins(baseTotalHours + liveElapsed);
    }, 1000);
  }
}

function renderEntryRows(sortedEntries, editable) {
  const start = (entriesPage - 1) * ENTRIES_PAGE_SIZE;
  const pageItems = sortedEntries.slice(start, start + ENTRIES_PAGE_SIZE);
  if (!pageItems.length) return `<div class="empty-state">No entries yet</div>`;
  return pageItems.map(entryRow(editable)).join("");
}

function renderEntriesPagination(totalCount) {
  if (totalCount <= ENTRIES_PAGE_SIZE) return "";
  const totalPages = Math.max(1, Math.ceil(totalCount / ENTRIES_PAGE_SIZE));
  return `
    <div class="pagination">
      <button class="btn btn-outline pagination-btn" id="entriesPrevBtn" ${entriesPage <= 1 ? "disabled" : ""}>&larr; Prev</button>
      <span class="page-indicator">Page ${entriesPage} of ${totalPages}</span>
      <button class="btn btn-outline pagination-btn" id="entriesNextBtn" ${entriesPage >= totalPages ? "disabled" : ""}>Next &rarr;</button>
    </div>
  `;
}

function wireEntries(name, sortedEntries, editable) {
  document.querySelectorAll(".del-entry").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Delete this time entry?")) return;
      try {
        await API.deleteEntry(name, btn.dataset.idx);
        await loadTimerScreen(name);
      } catch (e) { handleErr(e); }
    };
  });
  document.querySelectorAll(".edit-time").forEach((span) => {
    span.onclick = () => startTimeEdit(span, name, sortedEntries, editable);
  });
  const prevBtn = document.getElementById("entriesPrevBtn");
  if (prevBtn) prevBtn.onclick = () => { entriesPage = Math.max(1, entriesPage - 1); refreshEntriesDom(name, sortedEntries, editable); };
  const nextBtn = document.getElementById("entriesNextBtn");
  if (nextBtn) nextBtn.onclick = () => { entriesPage += 1; refreshEntriesDom(name, sortedEntries, editable); };
}

function refreshEntriesDom(name, sortedEntries, editable) {
  const rowsEl = document.getElementById("entryRows");
  const pagEl = document.getElementById("entriesPagination");
  if (rowsEl) rowsEl.innerHTML = renderEntryRows(sortedEntries, editable);
  if (pagEl) pagEl.innerHTML = renderEntriesPagination(sortedEntries.length);
  wireEntries(name, sortedEntries, editable);
}

function entryRow(editable) {
  return (e) => `
    <div class="entry-row">
      <div>${esc(e.entry_date)}</div>
      <div>${timeCell(e, "start_time", editable)}</div>
      <div>${e.is_running ? `<span class="running-badge">running</span>` : timeCell(e, "end_time", editable)}</div>
      <div>${esc(e.activity)}</div>
      <div>${fmtHrsMins(e.duration_hours)}</div>
      <div>${editable && !e.is_running ? `<button class="del del-entry" data-idx="${e.idx}">&#128465;</button>` : ""}</div>
    </div>
  `;
}

function timeCell(e, field, editable) {
  const display = fmtTime(e[field]);
  if (!editable || e.is_running) return display;
  return `<span class="edit-time" data-idx="${e.idx}" data-field="${field}" title="Tap to edit">${display}</span>`;
}

function startTimeEdit(span, name, sortedEntries, editable) {
  const idx = span.dataset.idx;
  const field = span.dataset.field;
  const entry = sortedEntries.find((e) => String(e.idx) === idx);
  if (!entry) return;
  const cell = span.parentElement;
  cell.innerHTML = `
    <span class="time-edit-wrap">
      <input type="time" class="time-input" value="${fmtTime(entry[field])}">
      <button class="time-confirm" title="Save">&#10003;</button>
      <button class="time-cancel" title="Cancel">&#10005;</button>
    </span>
  `;
  const input = cell.querySelector(".time-input");
  input.focus();
  cell.querySelector(".time-cancel").onclick = () => refreshEntriesDom(name, sortedEntries, editable);
  cell.querySelector(".time-confirm").onclick = async () => {
    const newTime = input.value;
    if (!newTime) { toast("Pick a time first"); return; }
    const entryDate = entry.entry_date || (entry.start_time || "").split(" ")[0];
    try {
      await API.updateEntry(name, entry.idx, { [field]: `${entryDate} ${newTime}:00` });
      await loadTimerScreen(name);
    } catch (e) { handleErr(e); }
  };
}

function showImageModal(url) {
  if (!url) return;
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="image-modal">
      <button class="image-modal-close" id="imgModalClose" aria-label="Close">&times;</button>
      <img src="${esc(url)}" alt="WIH photo" />
    </div>
  `;
  wrap.onclick = (e) => { if (e.target === wrap) wrap.remove(); };
  document.body.appendChild(wrap);
  document.getElementById("imgModalClose").onclick = () => wrap.remove();
}

function showStartTimerModal(name) {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal">
      <h3>Start Timer</h3>
      <p>Select what you'll be working on.</p>
      <div class="field">
        <label>Activity</label>
        <select id="activitySelect" disabled><option value="">Loading…</option></select>
      </div>
      <div id="startTimerErr"></div>
      <div class="row">
        <button class="btn btn-outline" id="cancelStartTimer">Cancel</button>
        <button class="btn btn-green" id="confirmStartTimer">&#9654; Start</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  document.getElementById("cancelStartTimer").onclick = () => wrap.remove();

  const select = document.getElementById("activitySelect");
  API.getActivityOptions()
    .then((options) => {
      select.disabled = false;
      select.innerHTML = options && options.length
        ? `<option value="">Select activity…</option>` + options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")
        : `<option value="">No activities configured</option>`;
    })
    .catch(() => { select.innerHTML = `<option value="">Could not load activities</option>`; });

  document.getElementById("confirmStartTimer").onclick = async () => {
    const errBox = document.getElementById("startTimerErr");
    errBox.innerHTML = "";
    const activity = select.value;
    if (!activity) {
      errBox.innerHTML = `<div class="error-box">Please select an activity.</div>`;
      return;
    }
    const btn = document.getElementById("confirmStartTimer");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      const res = await API.startTimer(name, activity);
      wrap.remove();
      showPunchResult("start", res);
    } catch (e) {
      if (!handleErr(e, errBox)) { btn.disabled = false; btn.innerHTML = "&#9654; Start"; }
    }
  };
}

// Big full-screen confirmation after Start / Stop. The server has already
// ended the worker's session, so the tablet is back on the name screen for
// the next person as soon as this disappears.
function showPunchResult(kind, res, backTo = "/") {
  stopIdleWatch();
  Worker.clear();
  navigate(backTo, { replace: true });

  const o = document.createElement("div");
  o.className = `success-overlay ${kind}`;
  const detail = kind === "start"
    ? `${esc(res.wih_number)}${res.activity ? " · " + esc(res.activity) : ""}`
    : `${esc(res.wih_number)} · ${fmtHrsMins(res.stopped_hours)}`;
  o.innerHTML = `
    <div class="big">${kind === "start" ? "&#9654;" : "&#9632;"}</div>
    <h2>${kind === "start" ? "Timer Started" : "Timer Stopped"}</h2>
    <div class="who">${esc(res.worker_name)}</div>
    <div class="what">${detail}</div>
    <div class="tap">TAP ANYWHERE TO CONTINUE</div>
  `;
  document.body.appendChild(o);
  let gone = false;
  const close = () => { if (gone) return; gone = true; o.remove(); };
  o.onclick = close;
  setTimeout(close, 3500);
}

function showSubmitModal(name, defaultFinalHrs) {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal">
      <h3>Submit Timesheet?</h3>
      <p>This will <strong>lock</strong> the timesheet and submit it to ERPNext. Once submitted, no further changes can be made.</p>
      <div class="field">
        <label>Final Hrs (as per Supervisor)</label>
        <input id="finalHrsInput" type="number" step="0.01" min="0" value="${flt2(defaultFinalHrs)}" />
        <div style="color:var(--sub); font-size:11px; margin-top:6px; line-height:1.4;">
          Won't change the recorded timesheet hours — this is the confirmed final figure recorded against the WIH.
        </div>
      </div>
      <div id="submitErr"></div>
      <div class="row">
        <button class="btn btn-outline" id="cancelSubmit">Cancel</button>
        <button class="btn btn-primary" id="confirmSubmit">Yes, Submit &amp; Lock</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  document.getElementById("cancelSubmit").onclick = () => wrap.remove();
  document.getElementById("confirmSubmit").onclick = async () => {
    const errBox = document.getElementById("submitErr");
    errBox.innerHTML = "";
    const finalHrsVal = parseFloat(document.getElementById("finalHrsInput").value);
    if (isNaN(finalHrsVal) || finalHrsVal <= 0) {
      errBox.innerHTML = `<div class="error-box">Enter the final hours confirmed by the supervisor.</div>`;
      return;
    }
    const btn = document.getElementById("confirmSubmit");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      await API.submitTimesheet(name, finalHrsVal);
      wrap.remove();
      toast("Timesheet submitted");
      navigate("/w/dashboard");
    } catch (e) {
      if (!handleErr(e, errBox)) { btn.disabled = false; btn.textContent = "Yes, Submit & Lock"; }
    }
  };
}

function showChangePinModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  const pinInput = (id, label) => `
    <div class="field">
      <label>${label}</label>
      <input id="${id}" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" />
    </div>`;
  wrap.innerHTML = `
    <div class="modal">
      <h3>Change My PIN</h3>
      <p>4 to 6 digits. Don't use easy PINs like 1111 or 1234, and never share it.</p>
      ${pinInput("oldPin", "Current PIN")}
      ${pinInput("newPin", "New PIN")}
      ${pinInput("newPin2", "New PIN Again")}
      <div id="pinChangeErr"></div>
      <div class="row">
        <button class="btn btn-outline" id="cancelPin">Cancel</button>
        <button class="btn btn-primary" id="savePin">Save PIN</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  document.getElementById("cancelPin").onclick = () => wrap.remove();
  document.getElementById("savePin").onclick = async () => {
    const errBox = document.getElementById("pinChangeErr");
    errBox.innerHTML = "";
    const oldPin = document.getElementById("oldPin").value.trim();
    const newPin = document.getElementById("newPin").value.trim();
    const newPin2 = document.getElementById("newPin2").value.trim();
    if (!oldPin || !newPin) { errBox.innerHTML = `<div class="error-box">Fill in all three boxes.</div>`; return; }
    if (newPin !== newPin2) { errBox.innerHTML = `<div class="error-box">The two new PINs don't match.</div>`; return; }
    const btn = document.getElementById("savePin");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      await API.changePin(oldPin, newPin);
      wrap.remove();
      toast("PIN changed");
    } catch (e) {
      if (!handleErr(e, errBox)) { btn.disabled = false; btn.textContent = "Save PIN"; }
    }
  };
}

function showDeviceSignOutModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal">
      <h3>Sign Out This Device?</h3>
      <p>Nobody will be able to use this tablet until it is signed in again with the kiosk device account and password.</p>
      <div id="devOutErr"></div>
      <div class="row">
        <button class="btn btn-outline" id="cancelDevOut">Cancel</button>
        <button class="btn btn-red" id="confirmDevOut">Sign Out Device</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  document.getElementById("cancelDevOut").onclick = () => wrap.remove();
  document.getElementById("confirmDevOut").onclick = async () => {
    try {
      await API.deviceLogout();
      wrap.remove();
      stopIdleWatch();
      navigate("/login", { replace: true });
    } catch (e) {
      handleErr(e, document.getElementById("devOutErr"));
    }
  };
}

// ------------------------------------------------------------------
// PWA service worker
// ------------------------------------------------------------------
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/kiosk-sw.js", { scope: "/kiosk" }).catch(() => {});
  }
}
