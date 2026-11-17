require("dotenv").config();

const path = require("path");
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2/promise");

const requiredEnvironment = ["JWT_SECRET", "DB_HOST", "DB_USER", "DB_NAME"];
const missingEnvironment = requiredEnvironment.filter((key) => !process.env[key]);
if (missingEnvironment.length) {
  throw new Error(`Missing required environment values: ${missingEnvironment.join(", ")}`);
}

const app = express();
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
  decimalNumbers: true
});

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "..", "frontend")));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireAuth(req, res, next) {
  const token = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Please log in to continue." });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ error: "Your session has expired. Please log in again." });
  }
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function todayDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

function userToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d"
  });
}

app.get("/api/health", asyncRoute(async (req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok", database: "connected" });
}));

app.post("/api/auth/signup", asyncRoute(async (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const role = req.body.role;
  if (!name || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 || password.length < 8 || !["girl", "boy"].includes(role)) {
    return badRequest(res, "Enter a valid name, email, password (at least 8 characters), and account type.");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const [result] = await pool.execute(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
      [name, email, passwordHash, role]
    );
    const user = { id: result.insertId, name, email, role };
    return res.status(201).json({ token: userToken(user), user });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "An account with this email already exists." });
    throw error;
  }
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const [rows] = await pool.execute(
    "SELECT id, name, email, password_hash, role FROM users WHERE email = ?",
    [email]
  );
  if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  const user = { id: rows[0].id, name: rows[0].name, email: rows[0].email, role: rows[0].role };
  res.json({ token: userToken(user), user });
}));

app.get("/api/auth/me", requireAuth, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    "SELECT id, name, email, role FROM users WHERE id = ?",
    [req.user.id]
  );
  if (!rows.length) return res.status(401).json({ error: "This account no longer exists." });
  res.json({ user: rows[0] });
}));

app.get("/api/periods", requireAuth, asyncRoute(async (req, res) => {
  const [items] = await pool.execute(
    "SELECT id, start_date AS start, end_date AS end FROM periods WHERE user_id = ? ORDER BY start_date",
    [req.user.id]
  );
  res.json({ items });
}));

app.post("/api/periods", requireAuth, asyncRoute(async (req, res) => {
  const { start, end } = req.body;
  if (!validDate(start) || !validDate(end) || end < start || start > todayDate()) {
    return badRequest(res, "Enter valid period dates; the end must be on or after the start and the start cannot be in the future.");
  }
  const duration = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1;
  if (duration > 15) return badRequest(res, "Period duration cannot be longer than 15 days.");
  const [result] = await pool.execute(
    `INSERT INTO periods (user_id, start_date, end_date) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE end_date = VALUES(end_date)`,
    [req.user.id, start, end]
  );
  const [rows] = await pool.execute(
    "SELECT id, start_date AS start, end_date AS end FROM periods WHERE user_id = ? AND start_date = ?",
    [req.user.id, start]
  );
  res.status(200).json({ item: rows[0], affectedRows: result.affectedRows });
}));

app.put("/api/periods/:id", requireAuth, asyncRoute(async (req, res) => {
  const { start, end } = req.body;
  if (!validDate(start) || !validDate(end) || end < start || start > todayDate()) {
    return badRequest(res, "Enter valid period dates.");
  }
  const duration = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1;
  if (duration > 15) return badRequest(res, "Period duration cannot be longer than 15 days.");
  const [existing] = await pool.execute(
    "SELECT id FROM periods WHERE id = ? AND user_id = ?",
    [req.params.id, req.user.id]
  );
  if (!existing.length) return res.status(404).json({ error: "Period record not found." });
  try {
    await pool.execute(
      "UPDATE periods SET start_date = ?, end_date = ? WHERE id = ? AND user_id = ?",
      [start, end, req.params.id, req.user.id]
    );
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "A period record already exists for that start date." });
    throw error;
  }
  res.json({ message: "Period record updated." });
}));

app.delete("/api/periods/:id", requireAuth, asyncRoute(async (req, res) => {
  const [result] = await pool.execute("DELETE FROM periods WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  if (!result.affectedRows) return res.status(404).json({ error: "Period record not found." });
  res.status(204).end();
}));

app.get("/api/symptoms", requireAuth, asyncRoute(async (req, res) => {
  const [items] = await pool.execute(
    "SELECT id, record_date AS date, symptoms, severity, notes FROM symptoms WHERE user_id = ? ORDER BY record_date DESC",
    [req.user.id]
  );
  res.json({ items: items.map((item) => ({ ...item, symptoms: typeof item.symptoms === "string" ? JSON.parse(item.symptoms) : item.symptoms })) });
}));

app.post("/api/symptoms", requireAuth, asyncRoute(async (req, res) => {
  const { date, symptoms, severity, notes } = req.body;
  if (!validDate(date) || date > todayDate() ||
      !Array.isArray(symptoms) || !symptoms.length || symptoms.length > 20 ||
      symptoms.some((item) => typeof item !== "string" || item.length > 80) ||
      !["Mild", "Moderate", "Severe"].includes(severity) ||
      (notes != null && (typeof notes !== "string" || notes.length > 5000))) {
    return badRequest(res, "Enter a valid date, at least one symptom, severity, and optional notes.");
  }
  await pool.execute(
    `INSERT INTO symptoms (user_id, record_date, symptoms, severity, notes) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE symptoms = VALUES(symptoms), severity = VALUES(severity), notes = VALUES(notes)`,
    [req.user.id, date, JSON.stringify(symptoms), severity, notes || null]
  );
  res.status(201).json({ message: "Symptoms saved." });
}));

app.delete("/api/symptoms/:id", requireAuth, asyncRoute(async (req, res) => {
  const [result] = await pool.execute("DELETE FROM symptoms WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  if (!result.affectedRows) return res.status(404).json({ error: "Symptom record not found." });
  res.status(204).end();
}));

app.get("/api/moods", requireAuth, asyncRoute(async (req, res) => {
  const [items] = await pool.execute(
    "SELECT id, record_date AS date, mood, intensity, notes FROM moods WHERE user_id = ? ORDER BY record_date DESC",
    [req.user.id]
  );
  res.json({ items });
}));

app.post("/api/moods", requireAuth, asyncRoute(async (req, res) => {
  const { date, mood, intensity, notes } = req.body;
  if (!validDate(date) || date > todayDate() ||
      typeof mood !== "string" || mood.length > 40 ||
      !Number.isInteger(Number(intensity)) || Number(intensity) < 1 || Number(intensity) > 5 ||
      (notes != null && (typeof notes !== "string" || notes.length > 5000))) {
    return badRequest(res, "Enter a valid date, mood, intensity, and optional notes.");
  }
  await pool.execute(
    `INSERT INTO moods (user_id, record_date, mood, intensity, notes) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE mood = VALUES(mood), intensity = VALUES(intensity), notes = VALUES(notes)`,
    [req.user.id, date, mood, Number(intensity), notes || null]
  );
  res.status(201).json({ message: "Mood saved." });
}));

app.delete("/api/moods/:id", requireAuth, asyncRoute(async (req, res) => {
  const [result] = await pool.execute("DELETE FROM moods WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  if (!result.affectedRows) return res.status(404).json({ error: "Mood entry not found." });
  res.status(204).end();
}));

app.get("/api/reminders", requireAuth, asyncRoute(async (req, res) => {
  const [items] = await pool.execute(
    "SELECT id, title, reminder_date AS date, reminder_type AS type, notes, completed FROM reminders WHERE user_id = ? ORDER BY reminder_date",
    [req.user.id]
  );
  res.json({ items });
}));

app.post("/api/reminders", requireAuth, asyncRoute(async (req, res) => {
  const { title, date, type, notes } = req.body;
  if (typeof title !== "string" || !title.trim() || title.length > 180 || !validDate(date) ||
      typeof type !== "string" || !type.trim() || type.length > 60 ||
      (notes != null && (typeof notes !== "string" || notes.length > 5000))) {
    return badRequest(res, "Enter a reminder title, valid date, type, and optional notes.");
  }
  const [result] = await pool.execute(
    "INSERT INTO reminders (user_id, title, reminder_date, reminder_type, notes) VALUES (?, ?, ?, ?, ?)",
    [req.user.id, title.trim(), date, type, notes || null]
  );
  res.status(201).json({ id: result.insertId });
}));

app.patch("/api/reminders/:id", requireAuth, asyncRoute(async (req, res) => {
  if (typeof req.body.completed !== "boolean") return badRequest(res, "Reminder completion status must be true or false.");
  const [result] = await pool.execute(
    "UPDATE reminders SET completed = ? WHERE id = ? AND user_id = ?",
    [req.body.completed, req.params.id, req.user.id]
  );
  if (!result.affectedRows) return res.status(404).json({ error: "Reminder not found." });
  res.json({ message: "Reminder updated." });
}));

app.delete("/api/reminders/:id", requireAuth, asyncRoute(async (req, res) => {
  const [result] = await pool.execute("DELETE FROM reminders WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  if (!result.affectedRows) return res.status(404).json({ error: "Reminder not found." });
  res.status(204).end();
}));

app.get("/api/questions", requireAuth, asyncRoute(async (req, res) => {
  const [items] = await pool.execute(
    "SELECT id, category, question, created_at AS createdAt FROM anonymous_questions WHERE user_id = ? ORDER BY created_at DESC",
    [req.user.id]
  );
  res.json({ items });
}));

app.post("/api/questions", requireAuth, asyncRoute(async (req, res) => {
  const { category, question } = req.body;
  const allowed = ["Periods", "Menstrual Cycle", "Hygiene", "Symptoms", "Emotional Wellbeing", "General"];
  if (!allowed.includes(category) || typeof question !== "string" || question.trim().length < 5 || question.length > 500) {
    return badRequest(res, "Choose a category and enter a question between 5 and 500 characters.");
  }
  const [result] = await pool.execute(
    "INSERT INTO anonymous_questions (user_id, category, question) VALUES (?, ?, ?)",
    [req.user.id, category, question.trim()]
  );
  res.status(201).json({ id: result.insertId });
}));

app.delete("/api/questions/:id", requireAuth, asyncRoute(async (req, res) => {
  const [result] = await pool.execute("DELETE FROM anonymous_questions WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  if (!result.affectedRows) return res.status(404).json({ error: "Question not found." });
  res.status(204).end();
}));

const challengeDefinitions = [
  ["basics", "Learn the Basics 📖", "Read about the four phases of the menstrual cycle."],
  ["myth", "Break a Myth 💡", "Learn one menstrual health myth and its correct fact."],
  ["kindness", "Spread Kindness 🤝", "Think of one way to support someone during menstruation."],
  ["hygiene", "Know Your Hygiene 🧼", "Learn three important menstrual hygiene practices."],
  ["conversation", "Start a Conversation 💬", "Encourage a respectful conversation about menstrual health."],
  ["body", "Understand Your Body 🌸", "Learn about common menstrual symptoms and cycle changes."],
  ["awareness", "Share Awareness 💗", "Share one useful menstrual health fact with someone."]
];

app.get("/api/challenges", requireAuth, asyncRoute(async (req, res) => {
  for (const [key, title, description] of challengeDefinitions) {
    await pool.execute(
      "INSERT IGNORE INTO awareness_challenges (user_id, challenge_key, title, description, points) VALUES (?, ?, ?, ?, 10)",
      [req.user.id, key, title, description]
    );
  }
  const [items] = await pool.execute(
    "SELECT id, challenge_key AS challengeKey, title, description, points, completed FROM awareness_challenges WHERE user_id = ? ORDER BY id",
    [req.user.id]
  );
  res.json({ items });
}));

app.patch("/api/challenges/:key", requireAuth, asyncRoute(async (req, res) => {
  const [result] = await pool.execute(
    "UPDATE awareness_challenges SET completed = TRUE, completed_at = CURRENT_TIMESTAMP WHERE user_id = ? AND challenge_key = ?",
    [req.user.id, req.params.key]
  );
  if (!result.affectedRows) return res.status(404).json({ error: "Challenge not found." });
  res.json({ message: "Challenge completed." });
}));

app.delete("/api/challenges", requireAuth, asyncRoute(async (req, res) => {
  await pool.execute("UPDATE awareness_challenges SET completed = FALSE, completed_at = NULL WHERE user_id = ?", [req.user.id]);
  res.status(204).end();
}));

app.use("/api", (req, res) => res.status(404).json({ error: "API endpoint not found." }));
app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: "An unexpected server error occurred. Check the backend log for details." });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`HerCycle server listening at http://localhost:${port}`));
