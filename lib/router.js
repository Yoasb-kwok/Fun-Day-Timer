const { ensureSchema } = require("./migrate");
const { HttpError } = require("./httpError");
const {
  signSession,
  sessionCookie,
  clearSessionCookie,
  eventIdFromRequest
} = require("./auth");
const {
  loadSnapshot,
  createEvent,
  joinEvent,
  enduranceAction,
  battleAction,
  teamAction,
  saveSettings,
  resetAll
} = require("./store");

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function requestPath(req) {
  const raw = req.url || "/";
  const pathname = raw.split("?")[0];
  const fromUrl = pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  if (pathname.startsWith("/api")) return fromUrl;
  if (Array.isArray(req.query?.path)) return req.query.path.join("/").replace(/\/+$/, "");
  if (typeof req.query?.path === "string") return req.query.path.replace(/^\/+|\/+$/g, "");
  return fromUrl;
}

function readBody(req) {
  const body = req.body;
  if (Buffer.isBuffer(body)) {
    if (!body.length) return {};
    try {
      return JSON.parse(body.toString("utf8"));
    } catch {
      throw new HttpError(400, "請求內容不是有效的 JSON");
    }
  }
  if (typeof body === "string") {
    if (!body) return {};
    try {
      return JSON.parse(body);
    } catch {
      throw new HttpError(400, "請求內容不是有效的 JSON");
    }
  }
  if (body && typeof body === "object") return body;
  return {};
}

function publicError(error) {
  if (error instanceof HttpError) return error;
  if (error && error.status && error.message) return new HttpError(error.status, error.message);
  if (error && error.code === "23505") return new HttpError(409, "此活動代碼已有人使用");
  if (error && error.code === "22P02") return new HttpError(401, "請先加入活動");
  if (error && ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN", "57P01", "ENETUNREACH"].includes(error.code)) {
    return new HttpError(503, "未能連接伺服器");
  }
  if (error && /DATABASE_URL/.test(error.message || "")) {
    return new HttpError(503, "伺服器尚未設定資料庫連線（DATABASE_URL）");
  }
  return new HttpError(500, "伺服器發生錯誤");
}

async function handler(req, res) {
  try {
    if (!process.env.DATABASE_URL) {
      return send(res, 503, { error: "伺服器尚未設定資料庫連線（DATABASE_URL）" });
    }
    await ensureSchema();
    const method = String(req.method || "GET").toUpperCase();
    const path = requestPath(req);

    if (method === "GET" && path === "health") return send(res, 200, { ok: true });

    if (method === "POST" && path === "session") {
      const body = readBody(req);
      if (body.mode !== "create" && body.mode !== "join") {
        return send(res, 400, { error: "請選擇建立或加入活動" });
      }
      const eventId = body.mode === "create" ? await createEvent(body) : await joinEvent(body.code, body.password);
      res.setHeader("Set-Cookie", sessionCookie(signSession(eventId), req));
      return send(res, 200, await loadSnapshot(eventId));
    }

    if (method === "POST" && path === "logout") {
      res.setHeader("Set-Cookie", clearSessionCookie(req));
      return send(res, 200, { ok: true });
    }

    const eventId = eventIdFromRequest(req);
    if (!eventId) return send(res, 401, { error: "請先加入活動" });

    if (method === "GET" && path === "state") return send(res, 200, await loadSnapshot(eventId));
    if (method === "POST" && path === "endurance") return send(res, 200, await enduranceAction(eventId, readBody(req)));
    if (method === "POST" && path === "battle") return send(res, 200, await battleAction(eventId, readBody(req)));
    if (method === "POST" && path === "teams") return send(res, 200, await teamAction(eventId, readBody(req)));
    if (method === "POST" && path === "settings") return send(res, 200, await saveSettings(eventId, readBody(req)));
    if (method === "POST" && path === "reset") return send(res, 200, await resetAll(eventId));

    return send(res, 404, { error: "找不到此功能" });
  } catch (error) {
    const published = publicError(error);
    if (published.status >= 500) console.error(error);
    return send(res, published.status, { error: published.message });
  }
}

module.exports = { handler, send, requestPath, readBody, publicError };
