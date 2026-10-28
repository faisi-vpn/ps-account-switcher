const DEFAULT_API_BASE = "https://backend-v2.portal-sekolah.com/api";
const STORAGE_PROFILES = "ps.profiles.v1";
const STORAGE_SETTINGS = "ps.settings.v1";
const FAR_EXPIRY = Date.parse("9999-12-31T12:00:00.000Z") / 1000;
const ACCESS_TTL_MS = 870000;

const AUTH_COOKIE_NAMES = [
  "psauthtoken",
  "psrefreshtoken",
  "tokenexpiry",
  "userRole",
  "ay",
  "school_id",
  "school_name",
  "psusername",
  "code",
  "quiz-oxide-api-key",
  "psauthtoken_admin",
  "psrefreshtoken_admin",
];

function originOf(url) {
  return new URL(url).origin;
}

function cookieDomainOf(hostname) {
  if (hostname === "localhost" || hostname === "127.0.0.1") return hostname;
  const parts = hostname.split(".");
  if (parts.length >= 2) return parts.slice(-2).join(".");
  return hostname;
}

function cookieUrl(cookie) {
  const protocol = cookie.secure ? "https:" : "http:";
  const host = cookie.domain.replace(/^\./, "");
  return `${protocol}//${host}${cookie.path || "/"}`;
}

function decodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function accessStillValid(token, skewMs = 60000) {
  const jwt = decodeJwt(token);
  if (!jwt?.exp) return false;
  return jwt.exp * 1000 - Date.now() > skewMs;
}

async function getSettings() {
  const data = await chrome.storage.local.get(STORAGE_SETTINGS);
  return {
    apiBase: DEFAULT_API_BASE,
    activeProfileId: null,
    lastSchool: null,
    ...(data[STORAGE_SETTINGS] || {}),
  };
}

async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [STORAGE_SETTINGS]: next });
  return next;
}

async function getProfiles() {
  const data = await chrome.storage.local.get(STORAGE_PROFILES);
  return data[STORAGE_PROFILES] || [];
}

async function saveProfiles(profiles) {
  await chrome.storage.local.set({ [STORAGE_PROFILES]: profiles });
}

async function apiFetch(path, { method = "GET", body, token, apiBase } = {}) {
  const settings = apiBase ? { apiBase } : await getSettings();
  const url = `${settings.apiBase.replace(/\/$/, "")}${path}`;
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { ok: response.ok, status: response.status, payload };
}

function loginErrorMessage(payload) {
  const message = payload?.message;
  const errorType = message && payload?.data ? payload.data?.[message]?.[0] : null;
  const map = {
    invalid_username_password: "Username atau kata sandi tidak sesuai.",
    user_not_found_or_invalid_school_id: "Akun tidak terdaftar di sekolah ini.",
    school_id_required: "Pilih sekolah dulu.",
    invalid_login_form: "Akun ini bukan pengguna sekolah.",
    user_blocked: "Akun diblokir.",
    user_has_been_deleted: "Akun sudah dihapus.",
    "Credentials invalid !!": "Username atau kata sandi tidak sesuai.",
  };
  if (errorType && map[errorType]) return map[errorType];
  if (typeof message === "string" && map[message]) return map[message];
  return "Login gagal. Cek sekolah, username, dan password.";
}

async function searchSchools(query) {
  const q = String(query || "").trim();
  if (q.length < 3) return [];
  const { ok, payload } = await apiFetch(
    `/v2/school/schools/?page_size=20&page=1&search=${encodeURIComponent(q)}`
  );
  if (!ok || Number(payload?.code) !== 200 || !Array.isArray(payload?.data)) return [];
  return payload.data.map((item) => ({ id: item.id, name: item.name }));
}

async function loginWithPassword({ schoolId, username, password }) {
  const { ok, payload } = await apiFetch("/v2/auth/login/", {
    method: "POST",
    body: {
      login: username,
      password,
      school_id: Number(schoolId),
    },
  });
  const success = ok && [200, 201].includes(Number(payload?.code));
  const data = payload?.data;
  if (!success || !data?.jwt?.access) {
    throw new Error(loginErrorMessage(payload));
  }
  return normalizeAuthData(data);
}

async function refreshTokens(refresh) {
  const { ok, payload } = await apiFetch("/v2/auth/refresh/", {
    method: "POST",
    body: { refresh },
  });
  const access = payload?.data?.access || payload?.access;
  if (!ok || !access) throw new Error("Refresh token sudah tidak valid.");
  return {
    access,
    refresh: payload?.data?.refresh || payload?.refresh || refresh,
    tokenExpiry: Date.now() + ACCESS_TTL_MS,
  };
}

function normalizeAuthData(data) {
  return {
    access: data.jwt.access,
    refresh: data.jwt.refresh,
    role: String(data.role || "").toLowerCase(),
    username: data.username || "",
    name: data.name || "",
    tokenExpiry: Date.now() + ACCESS_TTL_MS,
  };
}

async function fetchAcademicYear(access) {
  try {
    const { ok, payload } = await apiFetch("/v2/auth/user/info/", { token: access });
    const profile = payload?.data;
    if (!ok || !profile) return null;
    if (!profile.current_academic_year_id) return null;
    return {
      id: profile.current_academic_year_id,
      academic_year: profile.current_academic_year,
      is_published: true,
      start_date: "",
      end_date: "",
    };
  } catch {
    return null;
  }
}

function cookieTarget(tabUrl, fallbackDomain) {
  if (tabUrl && /^https?:/.test(tabUrl)) {
    const url = new URL(tabUrl);
    const domain = cookieDomainOf(url.hostname);
    const port = url.port ? `:${url.port}` : "";
    return {
      url: `${url.protocol}//${url.hostname}${port}/`,
      domain: domain === "localhost" || domain === "127.0.0.1" ? null : domain,
    };
  }
  const domain = fallbackDomain || "localhost";
  if (domain === "localhost" || domain === "127.0.0.1") {
    return { url: "http://localhost/", domain: null };
  }
  return { url: `https://${domain}/`, domain };
}

async function removeNamedCookies(tabUrl, fallbackDomain) {
  const target = cookieTarget(tabUrl, fallbackDomain);
  const domain = target.domain || cookieDomainOf(new URL(target.url).hostname);
  const existing = [
    ...(await chrome.cookies.getAll({ url: target.url })),
    ...(domain ? await chrome.cookies.getAll({ domain }) : []),
  ];
  const seen = new Set();
  for (const cookie of existing) {
    if (!AUTH_COOKIE_NAMES.includes(cookie.name)) continue;
    const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const details = { url: cookieUrl(cookie), name: cookie.name };
    if (cookie.storeId) details.storeId = cookie.storeId;
    if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
    await chrome.cookies.remove(details);
  }
}

async function setCookie(target, name, value) {
  if (value == null || value === "") return;
  const details = {
    url: target.url,
    name,
    value: String(value),
    path: "/",
    expirationDate: FAR_EXPIRY,
  };
  if (target.domain) details.domain = target.domain;
  await chrome.cookies.set(details);
}

async function applyAuthCookies(session, tabUrl, fallbackDomain) {
  const target = cookieTarget(tabUrl, fallbackDomain);
  await removeNamedCookies(tabUrl, fallbackDomain);
  await setCookie(target, "lang", session.lang || "bhs");
  await setCookie(target, "psauthtoken", session.access);
  await setCookie(target, "psrefreshtoken", session.refresh);
  await setCookie(target, "tokenexpiry", session.tokenExpiry);
  await setCookie(target, "userRole", session.role);
  if (session.schoolId != null) await setCookie(target, "school_id", session.schoolId);
  if (session.schoolName) await setCookie(target, "school_name", session.schoolName);
  if (session.ay) await setCookie(target, "ay", JSON.stringify(session.ay));
}

async function clearPageStorage(tabId) {
  if (!tabId) return;
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    },
  });
}

async function ensureFreshSession(profile) {
  if (profile.tokens?.access && accessStillValid(profile.tokens.access)) {
    return { ...profile.tokens, via: "cache" };
  }
  if (profile.tokens?.refresh) {
    try {
      const refreshed = await refreshTokens(profile.tokens.refresh);
      return {
        access: refreshed.access,
        refresh: refreshed.refresh,
        role: profile.tokens.role || profile.identity?.role || "",
        username: profile.identity?.username || profile.credentials?.username || "",
        tokenExpiry: refreshed.tokenExpiry,
        via: "refresh",
      };
    } catch {
      // fall through to password
    }
  }
  if (profile.credentials?.username && profile.credentials?.password && profile.credentials?.schoolId) {
    const loggedIn = await loginWithPassword(profile.credentials);
    return { ...loggedIn, via: "login" };
  }
  throw new Error("Sesi akun ini habis dan tidak ada password tersimpan.");
}

async function persistProfileTokens(profileId, tokens, identityPatch, extra) {
  const profiles = await getProfiles();
  const profile = profiles.find((item) => item.id === profileId);
  if (!profile) return null;
  profile.tokens = {
    access: tokens.access,
    refresh: tokens.refresh,
    role: tokens.role || profile.tokens?.role || "",
    tokenExpiry: tokens.tokenExpiry,
  };
  profile.savedAt = Date.now();
  if (identityPatch) {
    profile.identity = { ...(profile.identity || {}), ...identityPatch, hasToken: true };
  }
  if (extra?.ay) profile.ay = extra.ay;
  await saveProfiles(profiles);
  return profile;
}

async function refreshAllProfiles() {
  const profiles = await getProfiles();
  const settings = await getSettings();
  let changed = false;

  for (const profile of profiles) {
    if (!profile.tokens?.refresh && !profile.credentials?.password) continue;
    try {
      const fresh = await ensureFreshSession(profile);
      if (fresh.via === "cache") continue;
      if (!profile.ay) {
        const ay = await fetchAcademicYear(fresh.access);
        if (ay) profile.ay = ay;
      }
      profile.tokens = {
        access: fresh.access,
        refresh: fresh.refresh,
        role: fresh.role || profile.tokens?.role || "",
        tokenExpiry: fresh.tokenExpiry,
      };
      profile.savedAt = Date.now();
      profile.identity = {
        ...(profile.identity || {}),
        username: fresh.username || profile.identity?.username || "",
        role: fresh.role || profile.identity?.role || "",
        hasToken: true,
        exp: decodeJwt(fresh.access)?.exp ? decodeJwt(fresh.access).exp * 1000 : null,
      };
      changed = true;

      if (settings.activeProfileId === profile.id) {
        await applyAuthCookies(
          {
            access: fresh.access,
            refresh: fresh.refresh,
            role: profile.tokens.role,
            tokenExpiry: fresh.tokenExpiry,
            schoolId: profile.credentials?.schoolId,
            schoolName: profile.credentials?.schoolName || profile.identity?.school,
            ay: profile.ay || null,
          },
          profile.url,
          profile.domain
        );
      }
    } catch (error) {
      console.warn("PS Switcher refresh skip", profile.name, error);
    }
  }

  if (changed) await saveProfiles(profiles);
}