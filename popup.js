const ROLE_COLOR = {
  teacher: "#fbb315",
  guru: "#fbb315",
  admin: "#034aa6",
  school: "#034aa6",
  sekolah: "#034aa6",
  student: "#1abf73",
  siswa: "#1abf73",
  parent: "#4f92ea",
  orangtua: "#4f92ea",
  official: "#36bfd7",
  foundation: "#36bfd7",
  dinas: "#36bfd7",
};

const els = {
  originLabel: document.getElementById("originLabel"),
  currentCard: document.getElementById("currentCard"),
  addForm: document.getElementById("addForm"),
  saveForm: document.getElementById("saveForm"),
  profileName: document.getElementById("profileName"),
  schoolSearch: document.getElementById("schoolSearch"),
  schoolId: document.getElementById("schoolId"),
  schoolResults: document.getElementById("schoolResults"),
  username: document.getElementById("username"),
  password: document.getElementById("password"),
  cancelAdd: document.getElementById("cancelAdd"),
  addSubmit: document.getElementById("addSubmit"),
  snapshotName: document.getElementById("snapshotName"),
  cancelSave: document.getElementById("cancelSave"),
  profileList: document.getElementById("profileList"),
  profileCount: document.getElementById("profileCount"),
  emptyState: document.getElementById("emptyState"),
  status: document.getElementById("status"),
};

let tab = null;
let profiles = [];
let currentSnapshot = null;
let busy = false;
let schoolTimer = null;
let selectedSchoolName = "";
let pendingDeleteId = null;
let pendingClear = false;

init().catch((error) => setStatus(error.message, "error"));

async function init() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  tab = active;
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    els.originLabel.textContent = "Buka tab Portal Sekolah atau localhost dulu.";
    els.currentCard.innerHTML =
      "<p class='meta'>Extension ini hanya jalan di http/https, bukan di chrome://.</p>";
    profiles = await getProfiles();
    renderCurrent();
    renderProfiles();
    return;
  }

  els.originLabel.textContent = originOf(tab.url);
  currentSnapshot = await captureSnapshot(tab);
  profiles = await getProfiles();
  renderCurrent();
  renderProfiles();
}

function cookieMap(cookies) {
  return Object.fromEntries(cookies.map((cookie) => [cookie.name, cookie.value]));
}

function identityFromCookies(cookies) {
  const map = cookieMap(cookies);
  const jwt = map.psauthtoken ? decodeJwt(map.psauthtoken) : null;
  const username =
    map.psusername || jwt?.username || jwt?.user_name || jwt?.preferred_username || "";
  const role = String(map.userRole || jwt?.role || jwt?.user_role || "").toLowerCase();
  const school = map.school_name || "";
  const exp = jwt?.exp ? jwt.exp * 1000 : null;
  return { username, role, school, exp, hasToken: Boolean(map.psauthtoken) };
}

function roleColor(role) {
  return ROLE_COLOR[role] || "#737373";
}

function timeAgo(ts) {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return "baru saja";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} mnt lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hr lalu`;
}

function expiryLabel(exp) {
  if (!exp) return "";
  const left = exp - Date.now();
  if (left <= 0) return "Access token kedaluwarsa. Extension akan refresh atau login ulang pas akun diklik.";
  const minutes = Math.ceil(left / 60000);
  if (minutes < 60) return `Access token ~${minutes} mnt lagi`;
  return `Access token ~${Math.ceil(minutes / 60)} jam lagi`;
}

async function captureSnapshot(activeTab) {
  const url = new URL(activeTab.url);
  const domain = cookieDomainOf(url.hostname);
  const [byUrl, byDomain] = await Promise.all([
    chrome.cookies.getAll({ url: activeTab.url }),
    chrome.cookies.getAll({ domain }),
  ]);

  const cookies = [];
  const seen = new Set();
  for (const cookie of [...byUrl, ...byDomain]) {
    const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cookies.push(cookie);
  }

  let localStorage = {};
  let sessionStorage = {};
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: () => ({
        local: { ...window.localStorage },
        session: { ...window.sessionStorage },
      }),
    });
    localStorage = result?.local || {};
    sessionStorage = result?.session || {};
  } catch {
    localStorage = {};
    sessionStorage = {};
  }

  return {
    url: activeTab.url,
    origin: url.origin,
    domain,
    cookies,
    localStorage,
    sessionStorage,
    identity: identityFromCookies(cookies),
    capturedAt: Date.now(),
  };
}

function serializableCookie(cookie) {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate: cookie.expirationDate,
    hostOnly: cookie.hostOnly,
    session: cookie.session,
    storeId: cookie.storeId,
    partitionKey: cookie.partitionKey,
  };
}

function setStatus(message, kind) {
  els.status.textContent = message || "";
  els.status.className = `status${kind ? ` ${kind}` : ""}`;
}

function renderCurrent() {
  const snap = currentSnapshot;
  if (!snap) {
    els.currentCard.innerHTML = `
      <p class="meta">Tidak ada tab aplikasi. Akun tetap bisa ditambah.</p>
      <div class="row">
        <button type="button" class="btn primary" id="startAdd">Tambah akun</button>
      </div>
    `;
    bindCurrentButtons();
    return;
  }

  const { identity } = snap;
  const title = identity.username || (identity.hasToken ? "Sesi aktif" : "Belum login");
  const bits = [identity.role, identity.school, `${snap.cookies.length} cookie`].filter(Boolean);
  const expText = identity.hasToken ? expiryLabel(identity.exp) : "";
  const expClass = identity.exp && identity.exp - Date.now() < 0 ? "meta warn" : "meta";

  els.currentCard.innerHTML = `
    <div class="identity">
      <span class="dot" style="background:${roleColor(identity.role)}"></span>
      <div>
        <div class="name">${escapeHtml(title)}</div>
        <div class="meta">${escapeHtml(bits.join(" · ") || "Tidak ada cookie auth")}</div>
        ${expText ? `<div class="${expClass}">${escapeHtml(expText)}</div>` : ""}
      </div>
    </div>
    <div class="row">
      <button type="button" class="btn primary" id="startAdd">Tambah akun</button>
      <button type="button" class="btn" id="startSave" ${identity.hasToken ? "" : "disabled"}>Simpan snapshot</button>
      <button type="button" class="btn ${pendingClear ? "danger" : "ghost"}" id="clearSession" ${identity.hasToken ? "" : "disabled"}>
        ${pendingClear ? "Yakin kosongkan?" : "Kosongkan sesi"}
      </button>
    </div>
  `;
  bindCurrentButtons();
}

function bindCurrentButtons() {
  document.getElementById("startAdd")?.addEventListener("click", openAddForm);
  document.getElementById("startSave")?.addEventListener("click", () => {
    els.saveForm.hidden = false;
    els.addForm.hidden = true;
    els.snapshotName.value = defaultName(currentSnapshot?.identity || {});
    els.snapshotName.focus();
    els.snapshotName.select();
  });
  document.getElementById("clearSession")?.addEventListener("click", clearCurrentSession);
}

function defaultName(identity) {
  const role = identity.role ? identity.role[0].toUpperCase() + identity.role.slice(1) : "Akun";
  if (identity.username) return `${role} · ${identity.username}`;
  return role;
}

async function openAddForm() {
  els.addForm.hidden = false;
  els.saveForm.hidden = true;
  const settings = await getSettings();
  if (settings.lastSchool?.id) {
    els.schoolId.value = String(settings.lastSchool.id);
    els.schoolSearch.value = settings.lastSchool.name;
    selectedSchoolName = settings.lastSchool.name;
  } else {
    els.schoolId.value = "";
    els.schoolSearch.value = "";
    selectedSchoolName = "";
  }
  els.profileName.value = "";
  els.username.value = "";
  els.password.value = "";
  els.profileName.focus();
}

function renderProfiles() {
  els.profileList.innerHTML = "";
  els.profileCount.textContent = profiles.length ? String(profiles.length) : "";
  els.emptyState.hidden = profiles.length > 0;

  const currentUser = currentSnapshot?.identity?.username || "";

  for (const profile of profiles) {
    const li = document.createElement("li");
    const isActive =
      currentUser &&
      profile.identity?.username &&
      profile.identity.username === currentUser;
    const kind = profile.credentials ? "login" : "snapshot";

    li.innerHTML = `
      <div class="profile${isActive ? " active" : ""}">
        <button type="button" class="switch" data-id="${profile.id}">
          <span class="dot" style="background:${roleColor(profile.identity?.role)}"></span>
          <span>
            <span class="title">${escapeHtml(profile.name)}</span>
            <span class="meta">
              ${escapeHtml(
                [
                  profile.identity?.username || profile.credentials?.username,
                  profile.identity?.role,
                  kind,
                  timeAgo(profile.savedAt),
                ]
                  .filter(Boolean)
                  .join(" · ")
              )}
            </span>
          </span>
        </button>
        <span class="actions">
          ${
            pendingDeleteId === profile.id
              ? `<button type="button" class="btn danger" data-act="delete" data-id="${profile.id}" title="Klik lagi untuk hapus">Hapus</button>
                 <button type="button" class="btn ghost" data-act="cancel-delete" data-id="${profile.id}" title="Batal">Batal</button>`
              : `<button type="button" class="btn icon ghost" data-act="update" data-id="${profile.id}" title="Refresh / login ulang">↻</button>
                 <button type="button" class="btn icon danger" data-act="delete" data-id="${profile.id}" title="Hapus">✕</button>`
          }
        </span>
      </div>
    `;
    els.profileList.appendChild(li);
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

els.cancelAdd.addEventListener("click", () => {
  els.addForm.hidden = true;
});

els.cancelSave.addEventListener("click", () => {
  els.saveForm.hidden = true;
});

els.schoolSearch.addEventListener("blur", () => {
  setTimeout(() => {
    els.schoolResults.hidden = true;
  }, 200);
});

els.schoolSearch.addEventListener("input", () => {
  const query = els.schoolSearch.value.trim();
  if (query !== selectedSchoolName) {
    els.schoolId.value = "";
    selectedSchoolName = "";
  }
  clearTimeout(schoolTimer);
  if (query.length < 3) {
    els.schoolResults.hidden = true;
    els.schoolResults.innerHTML = "";
    return;
  }
  schoolTimer = setTimeout(() => lookupSchools(query), 300);
});

async function lookupSchools(query) {
  els.schoolResults.innerHTML = "<li><button type='button' disabled>Mencari...</button></li>";
  els.schoolResults.hidden = false;
  try {
    const schools = await searchSchools(query);
    if (!schools.length) {
      els.schoolResults.innerHTML = "<li><button type='button' disabled>Tidak ketemu</button></li>";
      return;
    }
    els.schoolResults.innerHTML = schools
      .map(
        (school) =>
          `<li><button type="button" data-school-id="${school.id}" data-school-name="${escapeHtml(
            school.name
          )}">${escapeHtml(school.name)}</button></li>`
      )
      .join("");
  } catch (error) {
    els.schoolResults.innerHTML = `<li><button type="button" disabled>${escapeHtml(error.message)}</button></li>`;
  }
}

els.schoolResults.addEventListener("click", (event) => {
  const button = event.target.closest("[data-school-id]");
  if (!button) return;
  els.schoolId.value = button.getAttribute("data-school-id");
  selectedSchoolName = button.getAttribute("data-school-name");
  els.schoolSearch.value = selectedSchoolName;
  els.schoolResults.hidden = true;
});

els.addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;

  const name = els.profileName.value.trim();
  const schoolId = els.schoolId.value.trim();
  const schoolName = els.schoolSearch.value.trim();
  const username = els.username.value.trim();
  const password = els.password.value;
  if (!name || !schoolId || !username || !password) {
    setStatus("Isi nama, sekolah, username, dan password.", "error");
    return;
  }

  busy = true;
  els.addSubmit.disabled = true;
  setStatus("Login ke API...");
  try {
    const loggedIn = await loginWithPassword({ schoolId, username, password });
    const ay = await fetchAcademicYear(loggedIn.access);
    const existing = profiles.find(
      (item) =>
        item.credentials?.username?.toLowerCase() === username.toLowerCase() &&
        String(item.credentials?.schoolId) === String(schoolId)
    );
    const profile = existing || { id: crypto.randomUUID() };
    Object.assign(profile, {
      name,
      origin: currentSnapshot?.origin || (tab?.url ? originOf(tab.url) : "http://localhost:3001"),
      domain: currentSnapshot?.domain || (tab?.url ? cookieDomainOf(new URL(tab.url).hostname) : "localhost"),
      url: currentSnapshot?.url || tab?.url || "http://localhost:3001/",
      credentials: { schoolId, schoolName, username, password },
      tokens: {
        access: loggedIn.access,
        refresh: loggedIn.refresh,
        role: loggedIn.role,
        tokenExpiry: loggedIn.tokenExpiry,
      },
      ay,
      identity: {
        username: loggedIn.username || username,
        role: loggedIn.role,
        school: schoolName,
        exp: decodeJwt(loggedIn.access)?.exp ? decodeJwt(loggedIn.access).exp * 1000 : loggedIn.tokenExpiry,
        hasToken: true,
      },
      savedAt: Date.now(),
      cookies: [],
      localStorage: {},
      sessionStorage: {},
    });
    if (!existing) profiles.unshift(profile);
    await saveProfiles(profiles);
    await saveSettings({ lastSchool: { id: Number(schoolId), name: schoolName } });
    els.addForm.hidden = true;
    renderProfiles();
    setStatus(`Akun "${name}" siap. Klik namanya untuk masuk. Tab sekarang belum diganti.`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    busy = false;
    els.addSubmit.disabled = false;
  }
});

els.saveForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentSnapshot?.identity?.hasToken) {
    setStatus("Tab ini belum login.", "error");
    return;
  }
  const name = els.snapshotName.value.trim();
  if (!name) {
    els.snapshotName.focus();
    return;
  }
  const existing = profiles.find((item) => item.name.toLowerCase() === name.toLowerCase());
  const profile = existing || { id: crypto.randomUUID(), name };
  const map = cookieMap(currentSnapshot.cookies);
  Object.assign(profile, {
    name,
    origin: currentSnapshot.origin,
    domain: currentSnapshot.domain,
    url: currentSnapshot.url,
    cookies: currentSnapshot.cookies.map(serializableCookie),
    localStorage: currentSnapshot.localStorage,
    sessionStorage: currentSnapshot.sessionStorage,
    identity: currentSnapshot.identity,
    tokens: map.psauthtoken
      ? {
          access: map.psauthtoken,
          refresh: map.psrefreshtoken,
          role: currentSnapshot.identity.role,
          tokenExpiry: Number(map.tokenexpiry) || Date.now() + ACCESS_TTL_MS,
        }
      : profile.tokens,
    savedAt: Date.now(),
  });
  if (!existing) profiles.unshift(profile);
  await saveProfiles(profiles);
  els.saveForm.hidden = true;
  renderProfiles();
  setStatus(`Snapshot "${name}" tersimpan.`, "ok");
});

els.profileList.addEventListener("click", async (event) => {
  const target = event.target instanceof Element ? event.target : event.target.parentElement;
  if (!target) return;
  const actBtn = target.closest("[data-act]");
  if (actBtn) {
    event.preventDefault();
    event.stopPropagation();
    const id = actBtn.getAttribute("data-id");
    const act = actBtn.getAttribute("data-act");
    if (act === "delete") await deleteProfile(id);
    if (act === "cancel-delete") {
      pendingDeleteId = null;
      renderProfiles();
    }
    if (act === "update") await refreshProfile(id);
    return;
  }
  const row = target.closest(".switch");
  if (row) await switchTo(row.getAttribute("data-id"));
});

async function deleteProfile(id) {
  const profile = profiles.find((item) => item.id === id);
  if (!profile) return;
  if (pendingDeleteId !== id) {
    pendingDeleteId = id;
    renderProfiles();
    setStatus(`Klik Hapus lagi untuk buang "${profile.name}".`);
    return;
  }
  pendingDeleteId = null;
  profiles = profiles.filter((item) => item.id !== id);
  await saveProfiles(profiles);
  const settings = await getSettings();
  if (settings.activeProfileId === id) {
    await saveSettings({ activeProfileId: null });
  }
  renderProfiles();
  setStatus(`"${profile.name}" dihapus.`, "ok");
}

async function refreshProfile(id) {
  const profile = profiles.find((item) => item.id === id);
  if (!profile) return;
  busy = true;
  setStatus(`Memperbarui ${profile.name}...`);
  try {
    const fresh = await ensureFreshSession(profile);
    const ay = await fetchAcademicYear(fresh.access);
    if (ay) profile.ay = ay;
    await persistProfileTokens(
      profile.id,
      fresh,
      {
        username: fresh.username || profile.identity?.username,
        role: fresh.role || profile.identity?.role,
        exp: decodeJwt(fresh.access)?.exp ? decodeJwt(fresh.access).exp * 1000 : fresh.tokenExpiry,
        hasToken: true,
      },
      { ay: profile.ay }
    );
    profiles = await getProfiles();
    renderProfiles();
    setStatus(`Token "${profile.name}" diperbarui (${fresh.via}).`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    busy = false;
  }
}

async function switchTo(id) {
  if (busy) return;
  const profile = profiles.find((item) => item.id === id);
  if (!profile) return;
  if (!tab?.id || !/^https?:/.test(tab.url || "")) {
    setStatus("Buka tab aplikasi dulu, baru ganti akun.", "error");
    return;
  }

  busy = true;
  setStatus(`Masuk sebagai ${profile.name}...`);
  try {
    let session;
    if (profile.credentials || profile.tokens?.refresh) {
      const fresh = await ensureFreshSession(profile);
      const ay = profile.ay || (await fetchAcademicYear(fresh.access));
      if (ay) profile.ay = ay;
      session = {
        access: fresh.access,
        refresh: fresh.refresh,
        role: fresh.role || profile.identity?.role,
        tokenExpiry: fresh.tokenExpiry,
        schoolId: profile.credentials?.schoolId,
        schoolName: profile.credentials?.schoolName || profile.identity?.school,
        ay,
      };
      await persistProfileTokens(
        profile.id,
        fresh,
        {
          username: fresh.username || profile.identity?.username,
          role: fresh.role || profile.identity?.role,
          school: session.schoolName,
          exp: decodeJwt(fresh.access)?.exp ? decodeJwt(fresh.access).exp * 1000 : fresh.tokenExpiry,
          hasToken: true,
        },
        { ay: session.ay }
      );
      await applyAuthCookies(session, tab.url, profile.domain);
      try {
        await clearPageStorage(tab.id);
      } catch (error) {
        console.warn("Storage clear skip", error);
      }
    } else {
      await restoreCookies(profile);
      try {
        await restoreSnapshotStorage(tab.id, profile);
      } catch (error) {
        console.warn("Storage restore skip", error);
      }
    }

    await saveSettings({ activeProfileId: profile.id });
    await chrome.tabs.reload(tab.id);
    setStatus(`Sudah masuk sebagai ${profile.name}.`, "ok");
    window.close();
  } catch (error) {
    setStatus(error.message || "Gagal ganti akun.", "error");
  } finally {
    busy = false;
  }
}

async function clearCurrentSession() {
  if (!tab?.url) return;
  if (!pendingClear) {
    pendingClear = true;
    renderCurrent();
    setStatus("Klik sekali lagi untuk hapus cookie di tab ini.");
    return;
  }
  pendingClear = false;
  await removeNamedCookies(tab.url, currentSnapshot?.domain);
  try {
    await clearPageStorage(tab.id);
  } catch {
    // tab storage is optional
  }
  await saveSettings({ activeProfileId: null });
  await chrome.tabs.reload(tab.id);
  window.close();
}

async function restoreSnapshotStorage(tabId, profile) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (payload) => {
      window.localStorage.clear();
      for (const [key, value] of Object.entries(payload.local || {})) {
        window.localStorage.setItem(key, value);
      }
      window.sessionStorage.clear();
      for (const [key, value] of Object.entries(payload.session || {})) {
        window.sessionStorage.setItem(key, value);
      }
    },
    args: [
      {
        local: profile.localStorage || {},
        session: profile.sessionStorage || {},
      },
    ],
  });
}

async function restoreCookies(profile) {
  const hostname = new URL(tab.url).hostname;
  const domain = cookieDomainOf(hostname);
  const existing = [
    ...(await chrome.cookies.getAll({ url: tab.url })),
    ...(await chrome.cookies.getAll({ domain })),
  ];
  const removed = new Set();
  for (const cookie of existing) {
    const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
    if (removed.has(key)) continue;
    removed.add(key);
    const details = { url: cookieUrl(cookie), name: cookie.name };
    if (cookie.storeId) details.storeId = cookie.storeId;
    if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
    await chrome.cookies.remove(details);
  }

  const tabOrigin = originOf(tab.url);
  for (const cookie of profile.cookies || []) {
    const details = {
      url: cookieUrl(cookie),
      name: cookie.name,
      value: cookie.value,
      path: cookie.path || "/",
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly),
    };
    if (!cookie.hostOnly && cookie.domain && cookie.domain !== "localhost") {
      details.domain = cookie.domain;
    }
    if (!cookie.session && cookie.expirationDate) details.expirationDate = cookie.expirationDate;
    if (cookie.sameSite && cookie.sameSite !== "unspecified") details.sameSite = cookie.sameSite;
    if (cookie.storeId) details.storeId = cookie.storeId;
    if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
    if (details.sameSite === "no_restriction") details.secure = true;
    try {
      await chrome.cookies.set(details);
    } catch (error) {
      try {
        const retry = { ...details, url: `${tabOrigin}${cookie.path || "/"}` };
        delete retry.domain;
        await chrome.cookies.set(retry);
      } catch (retryError) {
        console.warn("Gagal set cookie", cookie.name, error, retryError);
      }
    }
  }
}
