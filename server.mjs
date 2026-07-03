import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { generateSchedule, normalizeConfig, buildEmptySchedule } from "./src/scheduler.mjs";
import { createRotaWorkbook } from "./src/workbook.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const outputDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const userDbPath = path.join(outputDir, "users.json");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const sessions = new Map();
const adminUser = "othmanedily";
const adminPassword = "0562290588";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const attempted = hashPassword(password, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(attempted, "hex"));
}

async function readUsers() {
  await fs.mkdir(outputDir, { recursive: true });
  let db;
  try {
    db = JSON.parse(await fs.readFile(userDbPath, "utf8"));
  } catch {
    db = { users: [] };
  }
  const existingAdmin = db.users.find((user) => user.username === adminUser);
  if (existingAdmin) {
    existingAdmin.passwordHash = hashPassword(adminPassword);
    existingAdmin.role = "admin";
    existingAdmin.status = "approved";
    existingAdmin.approvedAt = existingAdmin.approvedAt || new Date().toISOString();
    existingAdmin.appData = existingAdmin.appData || {};
    await writeUsers(db);
  } else {
    db.users.unshift({
      id: crypto.randomUUID(),
      username: adminUser,
      passwordHash: hashPassword(adminPassword),
      role: "admin",
      status: "approved",
      createdAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
      appData: {}
    });
    await writeUsers(db);
  }
  return db;
}

async function writeUsers(db) {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(userDbPath, JSON.stringify(db, null, 2));
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    approvedAt: user.approvedAt || null
  };
}

async function requireUser(req, res, adminOnly = false) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const session = sessions.get(token);
  if (!session) {
    sendJson(res, 401, { error: "Login required" });
    return null;
  }
  if (session.admin) {
    const db = await readUsers();
    const user = db.users.find((item) => item.username === adminUser) || {
      id: "admin",
      username: adminUser,
      role: "admin",
      status: "approved",
      createdAt: new Date().toISOString(),
      appData: {}
    };
    return { db, user };
  }
  if (session.guest) {
    return {
      db: { users: [] },
      user: { id: "guest", username: "Guest", role: "guest", status: "approved", createdAt: new Date().toISOString(), appData: {} }
    };
  }
  const db = await readUsers();
  const user = db.users.find((item) => item.id === session.userId);
  if (!user || user.status !== "approved") {
    sendJson(res, 403, { error: "Access not approved" });
    return null;
  }
  if (adminOnly && user.role !== "admin") {
    sendJson(res, 403, { error: "Admin only" });
    return null;
  }
  return { db, user };
}

function serializeResult(result, downloadUrl = null) {
  return {
    downloadUrl,
    schedule: result.assignments.map((row) => ({
      date: row.displayDate,
      iso: row.date.toISOString().slice(0, 10),
      day: row.day,
      weekend: row.weekend,
      ward: row.ward,
      fAfternoon: row.fAfternoon,
      mAfternoon: row.mAfternoon,
      mNight: row.mNight,
      fNight: row.fNight,
      notes: row.notes,
    })),
    referral: result.referralRows.map((row) => ({
      date: row.displayDate,
      day: row.day,
      transfer: row.transfer,
      cover: row.cover,
      rule: row.rule,
      notes: row.notes,
    })),
    workload: [
      ...result.config.residents.map((r) => ({ resident: r.name, gender: r.gender, ...result.counts[r.name] })),
      ...result.config.helpers.map((h) => ({ resident: h.name, gender: "Helper", afternoon: result.helperCounts[h.name]?.total || 0, night: 0, ward: 0, weekday: 0, weekend: result.helperCounts[h.name]?.weekend || 0, total: result.helperCounts[h.name]?.total || 0, transfer: 0, femaleCover: 0, extraWeekend: 0, helper: true })),
    ],
    audit: result.audit,
  };
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/signup" && req.method === "POST") {
    const raw = await readJson(req);
    const username = String(raw.username || "").trim().toLowerCase();
    const password = String(raw.password || "");
    if (!username || password.length < 4) return sendJson(res, 400, { error: "Enter username and password" });
    const db = await readUsers();
    if (db.users.some((user) => user.username === username)) return sendJson(res, 409, { error: "Username already exists" });
    db.users.push({
      id: crypto.randomUUID(),
      username,
      passwordHash: hashPassword(password),
      role: "user",
      status: "pending",
      createdAt: new Date().toISOString(),
      appData: {}
    });
    await writeUsers(db);
    return sendJson(res, 200, { status: "pending", message: "Request has been sent. Please contact Dr Othman." });
  }

  if (url.pathname === "/api/guest-login" && req.method === "POST") {
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { userId: "guest", guest: true, createdAt: Date.now() });
    return sendJson(res, 200, {
      token,
      user: { id: "guest", username: "Guest", role: "guest", status: "approved", createdAt: new Date().toISOString() },
      appData: {}
    });
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    const raw = await readJson(req);
    const username = String(raw.username || "").trim().toLowerCase();
    const password = String(raw.password || "");
    if (username === adminUser && password === adminPassword) {
      const token = crypto.randomBytes(32).toString("hex");
      let appData = {};
      try {
        const db = await readUsers();
        const admin = db.users.find((item) => item.username === adminUser);
        appData = admin?.appData || {};
      } catch {
        appData = {};
      }
      sessions.set(token, { userId: "admin", admin: true, createdAt: Date.now() });
      return sendJson(res, 200, {
        token,
        user: { id: "admin", username: adminUser, role: "admin", status: "approved", createdAt: new Date().toISOString(), approvedAt: new Date().toISOString() },
        appData
      });
    }
    const db = await readUsers();
    const user = db.users.find((item) => item.username === username);
    if (!user || !verifyPassword(password, user.passwordHash)) return sendJson(res, 401, { error: "Wrong username or password" });
    if (user.status !== "approved") return sendJson(res, 403, { status: user.status, message: "Request has been sent. Please contact Dr Othman." });
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { userId: user.id, createdAt: Date.now() });
    return sendJson(res, 200, { token, user: publicUser(user), appData: user.appData || {} });
  }

  if (url.pathname === "/api/me" && req.method === "GET") {
    const auth = await requireUser(req, res);
    if (!auth) return;
    return sendJson(res, 200, { user: publicUser(auth.user), appData: auth.user.appData || {} });
  }

  if (url.pathname === "/api/save-data" && req.method === "POST") {
    const auth = await requireUser(req, res);
    if (!auth) return;
    if (auth.user.role === "guest") return sendJson(res, 200, { ok: true, guest: true });
    const raw = await readJson(req);
    auth.user.appData = raw.appData || {};
    auth.user.lastSavedAt = new Date().toISOString();
    await writeUsers(auth.db);
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === "/api/admin/users" && req.method === "GET") {
    const auth = await requireUser(req, res, true);
    if (!auth) return;
    return sendJson(res, 200, { users: auth.db.users.map(publicUser) });
  }

  if (url.pathname === "/api/admin/approve" && req.method === "POST") {
    const auth = await requireUser(req, res, true);
    if (!auth) return;
    const raw = await readJson(req);
    const user = auth.db.users.find((item) => item.id === raw.userId && item.role !== "admin");
    if (!user) return sendJson(res, 404, { error: "User not found" });
    user.status = "approved";
    user.approvedAt = new Date().toISOString();
    await writeUsers(auth.db);
    return sendJson(res, 200, { user: publicUser(user) });
  }

  if (url.pathname === "/api/admin/reject" && req.method === "POST") {
    const auth = await requireUser(req, res, true);
    if (!auth) return;
    const raw = await readJson(req);
    const user = auth.db.users.find((item) => item.id === raw.userId && item.role !== "admin");
    if (!user) return sendJson(res, 404, { error: "User not found" });
    user.status = "rejected";
    await writeUsers(auth.db);
    return sendJson(res, 200, { user: publicUser(user) });
  }

  if (url.pathname === "/api/empty" && req.method === "POST") {
    const auth = await requireUser(req, res);
    if (!auth) return;
    const raw = await readJson(req);
    const config = normalizeConfig(raw);
    return sendJson(res, 200, { schedule: buildEmptySchedule(config).map((row) => ({ date: row.displayDate, day: row.day, weekend: row.weekend, ward: row.ward })) });
  }
  if (url.pathname === "/api/generate" && req.method === "POST") {
    const auth = await requireUser(req, res);
    if (!auth) return;
    const raw = await readJson(req);
    const result = generateSchedule(raw);
    const stamp = Date.now();
    const fileName = `${(raw.rotaName || "ROTA").replace(/[^a-z0-9]+/gi, "_")}_${stamp}.xlsx`;
    const outputPath = path.join(outputDir, fileName);
    await createRotaWorkbook(result, outputPath);
    return sendJson(res, 200, serializeResult(result, `/downloads/${fileName}`));
  }
  if (url.pathname === "/api/ai-review" && req.method === "POST") {
    const auth = await requireUser(req, res);
    if (!auth) return;
    const raw = await readJson(req);
    const result = generateSchedule(raw);
    const messages = result.audit.ok
      ? ["Applicable: the schedule can be generated with no critical conflicts detected."]
      : ["Partially applicable: review these conflicts before final approval.", ...result.audit.issues];
    if (raw.useOpenAI && process.env.OPENAI_API_KEY) {
      try {
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
            input: `Review this rota audit and summarize applicability for a chief resident:\n${JSON.stringify(result.audit.issues)}`,
          }),
        });
        const data = await response.json();
        const text = data.output_text || messages.join("\n");
        return sendJson(res, 200, { messages, ai: text });
      } catch {
        return sendJson(res, 200, { messages, ai: "AI review unavailable; local audit shown instead." });
      }
    }
    return sendJson(res, 200, { messages, ai: "Local scheduling audit completed. Add OPENAI_API_KEY before starting the server to enable live OpenAI review." });
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (handled === false) sendJson(res, 404, { error: "Not found" });
      return;
    }
    if (url.pathname.startsWith("/downloads/")) {
      const fileName = path.basename(url.pathname);
      const filePath = path.join(outputDir, fileName);
      const data = await fs.readFile(filePath);
      res.writeHead(200, { "Content-Type": mime[".xlsx"], "Content-Disposition": `attachment; filename="${fileName}"` });
      res.end(data);
      return;
    }
    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.normalize(path.join(publicDir, requested));
    if (!filePath.startsWith(publicDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      res.writeHead(404);
      res.end("Not found");
    } else {
      sendJson(res, 500, { error: error.message });
    }
  }
});

server.listen(port, host, () => {
  const label = host === "0.0.0.0" ? `http://<your-mac-ip>:${port}` : `http://localhost:${port}`;
  console.log(`ROTA scheduler app running at ${label}`);
});
