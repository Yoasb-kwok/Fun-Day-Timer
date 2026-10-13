const { createHmac, randomBytes, scrypt, timingSafeEqual, createHash } = require("crypto");
const { promisify } = require("util");

const scryptAsync = promisify(scrypt);
const COOKIE = "fun_day_session";
const SESSION_TTL_SECONDS = 60 * 60 * 18;

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  return createHash("sha256").update(`fun-day-session:${process.env.DATABASE_URL || ""}`).digest("hex");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = await scryptAsync(password, salt, expected.length);
  return safeEqual(actual, expected);
}

function signSession(eventId) {
  const body = Buffer.from(JSON.stringify({
    eventId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  })).toString("base64url");
  const sig = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function readSession(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload || typeof payload.eventId !== "string" || typeof payload.exp !== "number") return null;
    if (!/^[0-9a-f-]{36}$/i.test(payload.eventId)) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  const raw = req.headers?.cookie || "";
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return decodeURIComponent(trimmed.slice(name.length + 1));
  }
  return "";
}

function cookieSecure(req) {
  if (process.env.COOKIE_SECURE === "false") return false;
  const proto = req.headers?.["x-forwarded-proto"];
  if (proto) return String(proto).split(",")[0].trim() === "https";
  return Boolean(process.env.VERCEL);
}

function sessionCookie(token, req) {
  const secure = cookieSecure(req) ? "; Secure" : "";
  return `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

function clearSessionCookie(req) {
  const secure = cookieSecure(req) ? "; Secure" : "";
  return `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

function eventIdFromRequest(req) {
  const payload = readSession(readCookie(req, COOKIE));
  return payload ? payload.eventId : null;
}

module.exports = {
  COOKIE,
  hashPassword,
  verifyPassword,
  signSession,
  readSession,
  sessionCookie,
  clearSessionCookie,
  eventIdFromRequest
};
