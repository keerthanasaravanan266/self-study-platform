// ================= LOAD ENV FIRST =================
require("dotenv").config({ path: __dirname + "/.env" });

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const db = require("./config/db");
const nodemailer = require("nodemailer");
const cron = require("node-cron");


const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const app = express();

// Allows every origin by default (fine for local dev). Once deployed, set
// FRONTEND_URL in your backend's environment variables to your deployed
// frontend's URL to lock this down.
app.use(cors({
    origin: process.env.FRONTEND_URL || "*"
}));
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));


app.use("/uploads", express.static("uploads"));

const materialRoutes = require("./routes/materials");
app.use("/api/materials", materialRoutes);

// Temporary storage for files uploaded to the summarizer (PDF/PPTX/DOCX).
// These are deleted right after their text is extracted - see /api/summarize/file.
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// multer's diskStorage will NOT create this folder for you - it throws if
// it's missing. Create it up front so a fresh clone of this project works
// without anyone having to remember to make the folder by hand.
const SUMMARIZE_TMP_DIR = path.join(__dirname, "uploads", "tmp");
fs.mkdirSync(SUMMARIZE_TMP_DIR, { recursive: true });

const summarizeStorage = multer.diskStorage({
  destination: SUMMARIZE_TMP_DIR,
  filename: (req, file, cb) => {
    // multer's default "dest" option strips the file extension, which stops
    // officeparser from being able to tell what kind of file it's looking
    // at (that's what caused the "unsupported file" error). Keep it, and
    // lowercase it so ".PDF"/".Pdf" uploads are still recognized.
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
  }
});

const uploadForSummarize = multer({
  storage: summarizeStorage,
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

// ================= OPENROUTER CONFIG =================

const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:5000",  // required by OpenRouter
    "X-Title": "Self Study Project"
  }
});

// ================= SHARED AI HELPER =================
//
// openrouter/free randomly picks a free model for each request. Some of
// those models are "reasoning" models that think step-by-step before
// answering - and by default OpenRouter can return that thinking process
// as the actual message content (or leave content empty/null if the
// thinking used up the whole token budget). That's what caused replies
// like "Here's a thinking process: 1. Analyze..." or a plain "null" instead
// of real code.
//
// This helper: (1) explicitly disables/excludes reasoning tokens so we get
// a normal final answer, (2) uses a generous max_tokens so full code blocks
// or diagrams don't get cut off, and (3) retries once if a request fails or
// comes back empty, since free-model availability varies request to request.
async function askAI(messages, maxTokens = 900, temperature = 0.7) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await openrouter.chat.completions.create({
        model: "openrouter/free",
        messages,
        max_tokens: maxTokens,
        temperature,
        reasoning: { enabled: false, exclude: true }
      });

      const content = completion.choices?.[0]?.message?.content;

      if (content && content.trim()) {
        return content;
      }
      // Empty/null content (e.g. a reasoning model burned its whole budget
      // thinking) - fall through and retry with a fresh random model pick.
    } catch (err) {
      console.error(`AI call attempt ${attempt + 1} failed:`, err.response?.data || err.message);
    }
  }
  return null; // both attempts failed - caller shows a friendly error
}

// ================= CHAT ROUTE =================

app.post("/api/chat", async (req, res) => {
  try {
    const message = req.body.message || "";
    const history = Array.isArray(req.body.history) ? req.body.history : [];

    if (!message) {
      return res.json({ reply: "Please enter a message." });
    }

    // Keep only the last 10 turns so we stay within context/token limits
    // while still letting the model remember the ongoing conversation.
    const recentHistory = history.slice(-10).map(m => ({
      role: m.role === "ai" ? "assistant" : "user",
      content: String(m.content || "").slice(0, 2000)
    }));

    const reply = await askAI([
      {
        role: "system",
        content: `You are a helpful study assistant for a CSE/AI/robotics student. Use the earlier messages in this conversation as context so you can answer natural follow-up questions.

You answer BOTH general questions (any subject - CS fundamentals, math, general knowledge, etc.) and robotics-specific questions. Answer general questions normally and concisely, the way any good study assistant would - don't force robotics content into unrelated topics.

When a question IS related to robotics, ROS, embedded systems, or automation, apply extra domain rigor using this reference knowledge:
- ROS1 (Noetic/Melodic) uses \`rospy\`/\`roscpp\`, \`catkin_make\`/\`catkin build\`, a single \`roscore\`, and \`rosrun\`/\`roslaunch\`. ROS2 (Humble/Jazzy/Iron) uses \`rclpy\`/\`rclcpp\`, \`colcon build\`, no roscore (DDS-based discovery instead), and \`ros2 run\`/\`ros2 launch\`. Always ask or infer which the user means if it's ambiguous, and never mix ROS1 and ROS2 syntax in the same answer.
- Core concepts: topics (pub/sub, many-to-many), services (request/response, synchronous), actions (long-running, with feedback/cancel), parameters, and tf/tf2 for coordinate frame transforms.
- Common real errors and their usual causes: "package not found" (workspace not sourced - remind them to \`source devel/setup.bash\` or \`source install/setup.bash\`), "roscore not running" (ROS1 only - it must be started before any node), a script that won't run via rosrun (missing \`chmod +x\` or missing/incorrect shebang line), a subscriber that never receives messages (topic name/message type mismatch between publisher and subscriber, or publishing before the subscriber has connected), a build failing in a fresh workspace (missing dependency in \`package.xml\`/\`CMakeLists.txt\`).
- When explaining control concepts, be precise: PID control (proportional/integral/derivative terms, tuning tradeoffs), URDF/SDF for robot description, Gazebo/Ignition for simulation, MoveIt for manipulation planning, SLAM (e.g. gmapping, cartographer) for mapping/localization.
- Give exact commands and precise code, not vague gestures at "the ROS way to do it" - a robotics student needs runnable answers, especially before an exam or lab deadline.

When asked for code, always give the FULL, complete, working code in a properly fenced code block with the correct language tag (e.g. \`\`\`python), never a partial snippet or a description of code.

When asked to explain a system, flow, or architecture (e.g. "draw the architecture", "show the flow", "how do these parts connect"), include a diagram written in Mermaid syntax inside a fenced code block tagged "mermaid", for example:
\`\`\`mermaid
graph TD
  A[Publisher Node] -->|publishes to topic| B[Topic: /chatter]
  B --> C[Subscriber Node]
\`\`\`
Only include a mermaid diagram when it's actually useful (architecture/flow/structure questions), not for every message.`
      },
      ...recentHistory,
      { role: "user", content: message }
    ], 1100);

    if (!reply) {
      return res.status(503).json({ reply: "The AI is a little overloaded right now - please try sending that again in a few seconds." });
    }

    res.json({ reply });

  } catch (error) {
    console.error("OpenRouter Full Error:", error.response?.data || error.message);
    res.status(500).json({ reply: "Error connecting to AI." });
  }
});


// Builds the length/tone instruction text shared by the single-pass and
// chunked (map-reduce) summarizers below.
function summaryInstructions(length, tone) {
  let lengthInstruction = "";
  if (length === "short") lengthInstruction = "Provide a short summary in 3-4 sentences.";
  if (length === "medium") lengthInstruction = "Provide a medium length summary (a solid paragraph or two).";
  if (length === "long") lengthInstruction = "Provide a detailed, thorough summary that covers all the important points.";

  let toneInstruction = "";
  if (tone === "academic") toneInstruction = "Use academic language.";
  if (tone === "simple") toneInstruction = "Use simple and easy language.";
  if (tone === "bullet") toneInstruction = "Provide the summary in bullet points.";

  return { lengthInstruction, toneInstruction };
}

// Splits long text into ~6000 character chunks on paragraph boundaries so we
// never cut a sentence in half.
function chunkText(text, chunkSize = 6000) {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks = [];
  let current = "";

  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > chunkSize && current) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current) chunks.push(current);

  // A single paragraph longer than chunkSize (e.g. no line breaks at all,
  // common with text extracted from PDFs/PPTs) still needs to be split.
  return chunks.flatMap(chunk =>
    chunk.length > chunkSize
      ? chunk.match(new RegExp(`.{1,${chunkSize}}`, "gs")) || [chunk]
      : [chunk]
  );
}

// Summarizes arbitrarily long text. Short text goes through the model in one
// pass. Long text (e.g. a whole PDF/PPT) is summarized chunk-by-chunk first
// (map), then those partial summaries are combined into one final summary
// that respects the requested length/tone (reduce) - so the whole document
// gets covered instead of being truncated or cut off mid-way.
async function summarizeText(text, length, tone) {
  const { lengthInstruction, toneInstruction } = summaryInstructions(length, tone);
  const MAX_INPUT_CHARS = 60000;
  const CHUNK_SIZE = 6000;

  const trimmedText = text.slice(0, MAX_INPUT_CHARS);

  if (trimmedText.length <= CHUNK_SIZE) {
    return await askAI([
      { role: "system", content: "You are a helpful study assistant that summarizes text. Give only the summary itself, with no meta-commentary." },
      {
        role: "user",
        content: `${lengthInstruction} ${toneInstruction}\n\nSummarize the following text:\n\n${trimmedText}`
      }
    ], 1200, 0.3);
  }

  // ---- Map step: digest each chunk ----
  const chunks = chunkText(trimmedText, CHUNK_SIZE);
  const partials = [];
  for (const chunk of chunks) {
    const partial = await askAI([
      { role: "system", content: "You are a helpful study assistant. Condense the given excerpt into its key points only, in plain sentences. This is one part of a larger document - do not add an introduction or conclusion, just the key points of this excerpt." },
      { role: "user", content: chunk }
    ], 400, 0.3);
    if (partial) partials.push(partial);
  }

  if (partials.length === 0) return null;

  // ---- Reduce step: combine the digests into one final summary ----
  return await askAI([
    { role: "system", content: "You are a helpful study assistant that summarizes text. Give only the summary itself, with no meta-commentary." },
    {
      role: "user",
      content: `${lengthInstruction} ${toneInstruction}\n\nThe following are key-point digests of consecutive sections of one document. Combine them into a single coherent summary of the WHOLE document (don't just list the sections separately):\n\n${partials.join("\n\n")}`
    }
  ], 1400, 0.3);
}

app.post("/api/summarize", async (req, res) => {
  try {
    const { text, length, tone } = req.body;

    if (!text || !text.trim()) {
      return res.json({ summary: "Please enter some text to summarize." });
    }
    if (text.length > 60000) {
      return res.json({
        summary: "That's a lot of text! Please limit input to about 60,000 characters (roughly 10,000-12,000 words)."
      });
    }

    const summary = await summarizeText(text, length, tone);

    if (!summary) {
      return res.status(503).json({ summary: "The AI is a little overloaded right now - please try again in a few seconds." });
    }

    res.json({ summary });

  } catch (error) {
    console.error("Summarizer Full Error:", error.response?.data || error.message);
    res.status(500).json({ summary: "Error generating summary." });
  }
});

// Summarize the text extracted from an uploaded PDF / PPTX / DOCX file.
app.post("/api/summarize/file", uploadForSummarize.single("file"), async (req, res) => {
  const filePath = req.file?.path;

  try {
    if (!req.file) {
      return res.status(400).json({ summary: "Please choose a file to upload." });
    }

    const { length, tone } = req.body;

    const officeParser = require("officeparser");
    const ast = await officeParser.parseOffice(filePath);
    const text = (typeof ast.toText === "function" ? ast.toText() : String(ast)).trim();

    if (!text) {
      return res.json({ summary: "Couldn't find any readable text in that file." });
    }

    const summary = await summarizeText(text, length, tone);

    if (!summary) {
      return res.status(503).json({ summary: "The AI is a little overloaded right now - please try again in a few seconds." });
    }

    res.json({ summary, extractedChars: text.length });

  } catch (error) {
    console.error("File Summarizer Error:", error.message);
    res.status(500).json({ summary: "Couldn't read that file. Please make sure it's a valid PDF, PPTX, or DOCX." });
  } finally {
    // Clean up the temporary upload - it's only needed for this one request.
    if (filePath) {
      fs.unlink(filePath, () => {});
    }
  }
});

// ================= SMART QUIZ ROUTE (dynamic / spaced repetition) =================
//
// Instead of generating a fresh, disconnected set of questions every time,
// each generated question is saved per (user, topic). Questions you get
// wrong come back sooner in a later quiz on that topic; questions you keep
// getting right come back less and less often - a simple Leitner-style
// spaced repetition schedule. A quiz is now a mix of "due for review"
// questions plus enough newly generated ones to fill the requested count.

// How many days until a question comes back around again, indexed by how
// many times in a row it's been answered correctly.
const REVIEW_INTERVALS_DAYS = [1, 3, 7, 16, 30];

function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

// Pulls the first JSON array out of a model response, tolerating stray
// markdown fences or commentary the model added despite being told not to.
function extractJsonArray(raw) {
  if (!raw) return null;
  let cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Asks the AI for `count` new MCQs as strict JSON, retrying once if the
// response isn't valid JSON (free models occasionally ignore formatting
// instructions).
async function generateQuizQuestions(text, count) {
  const maxTokens = Math.min(4000, 300 + count * 140);

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await askAI([
      {
        role: "system",
        content: "You generate multiple choice quiz questions. Respond with ONLY a JSON array, no markdown fences, no commentary before or after it."
      },
      {
        role: "user",
        content: `Generate exactly ${count} multiple choice questions based on the content below. Cover different parts of the content rather than repeating the same point.

Respond with ONLY a JSON array in exactly this shape (no other text):
[
  { "question": "...", "options": { "A": "...", "B": "...", "C": "...", "D": "..." }, "answer": "A" }
]

Content:
${text.substring(0, 10000)}`
      }
    ], maxTokens, 0.6);

    const parsed = extractJsonArray(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Keep only well-formed entries in case the model included a broken one.
      return parsed.filter(q =>
        q && typeof q.question === "string" &&
        q.options && ["A", "B", "C", "D"].every(k => typeof q.options[k] === "string") &&
        ["A", "B", "C", "D"].includes(String(q.answer).toUpperCase())
      );
    }
  }
  return [];
}

app.post("/api/quiz", async (req, res) => {
  try {
    const { text, userId } = req.body;
    const reviewOnly = req.body.reviewOnly === true;
    const topic = (req.body.topic || "").trim().slice(0, 255) || (text ? text.slice(0, 60).trim() : "General");

    let count = parseInt(req.body.count, 10);
    if (!Number.isFinite(count) || count < 1) count = 5;
    if (count > 25) count = 25;

    if (!reviewOnly) {
      if (!text || !text.trim()) {
        return res.json({ quiz: "Please enter a topic or paste some study material." });
      }
      if (text.length > 12000) {
        return res.json({
          quiz: "That's a lot of text! Please limit input to about 12,000 characters for quiz generation."
        });
      }
    }

    // ---- Step 1: pull in anything due for review for this user/topic ----
    let dueRows = [];
    if (userId) {
      dueRows = await new Promise((resolve) => {
        db.query(
          `SELECT * FROM quiz_questions WHERE user_id = ? AND topic = ? AND next_review_at <= NOW() ORDER BY next_review_at ASC LIMIT ?`,
          [userId, topic, count],
          (err, rows) => resolve(err ? [] : rows)
        );
      });
    }

    if (reviewOnly) {
      if (dueRows.length === 0) {
        return res.json({ quiz: "Nothing is due for review on this topic right now - nice work staying on top of it! Generate a new quiz to add more questions to your review queue.", questions: [] });
      }
      const questions = dueRows.map(rowToClientQuestion);
      return res.json({ topic, questions, count: questions.length, dueCount: dueRows.length });
    }

    // ---- Step 2: generate enough new questions to fill the rest ----
    const newNeeded = Math.max(0, count - dueRows.length);
    let newRows = [];

    if (newNeeded > 0) {
      const generated = await generateQuizQuestions(text, newNeeded);

      if (generated.length === 0 && dueRows.length === 0) {
        return res.status(503).json({ quiz: "The AI is a little overloaded right now - please try again in a few seconds." });
      }

      if (userId && generated.length > 0) {
        // Save each new question so it can be scheduled for future review.
        newRows = await Promise.all(generated.map(q => new Promise((resolve) => {
          const sql = `
            INSERT INTO quiz_questions (user_id, topic, question, option_a, option_b, option_c, option_d, correct_option, next_review_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
          `;
          const answer = String(q.answer).toUpperCase();
          db.query(sql, [userId, topic, q.question, q.options.A, q.options.B, q.options.C, q.options.D, answer], (err, result) => {
            if (err) { console.error("Quiz save error:", err); return resolve(null); }
            resolve({
              id: result.insertId,
              question: q.question,
              option_a: q.options.A, option_b: q.options.B, option_c: q.options.C, option_d: q.options.D,
              correct_option: answer
            });
          });
        })));
        newRows = newRows.filter(Boolean);
      } else {
        // No userId (e.g. not logged in some edge case) - can't track these,
        // just hand them back as-is with a client-side-only id.
        newRows = generated.map((q, i) => ({
          id: `local-${Date.now()}-${i}`,
          question: q.question,
          option_a: q.options.A, option_b: q.options.B, option_c: q.options.C, option_d: q.options.D,
          correct_option: String(q.answer).toUpperCase()
        }));
      }
    }

    const combined = [...dueRows, ...newRows];
    // Shuffle so review questions and new questions are interleaved rather
    // than "old stuff first, new stuff after".
    for (let i = combined.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [combined[i], combined[j]] = [combined[j], combined[i]];
    }

    const questions = combined.map(rowToClientQuestion);

    res.json({ topic, questions, count: questions.length, dueCount: dueRows.length, newCount: newRows.length });

  } catch (error) {
    console.error("Quiz Error:", error.response?.data || error.message);
    res.status(500).json({ quiz: "Error generating quiz." });
  }
});

// Never send the correct answer to the client up front.
function rowToClientQuestion(row) {
  return {
    id: row.id,
    question: row.question,
    options: { A: row.option_a, B: row.option_b, C: row.option_c, D: row.option_d }
  };
}

// Submit an answer for one question. Updates the spaced-repetition schedule:
// correct -> streak goes up, next review pushed further out; wrong -> streak
// resets to 0, question comes back for review right away (next_review_at = now).
app.post("/api/quiz/answer", (req, res) => {
  const { questionId, selectedOption } = req.body;

  // Locally-generated questions (no userId at generation time) aren't in the
  // DB - there's nothing to update, but we can still tell the frontend
  // whether the answer format looks like a real DB id.
  if (typeof questionId !== "number" && !/^\d+$/.test(String(questionId))) {
    return res.status(400).json({ message: "This question wasn't saved for tracking, so it can't be scored server-side." });
  }

  db.query("SELECT * FROM quiz_questions WHERE id = ?", [questionId], (err, rows) => {
    if (err) return res.status(500).json({ message: "DB error" });
    if (!rows || rows.length === 0) return res.status(404).json({ message: "Question not found" });

    const question = rows[0];
    const isCorrect = String(selectedOption).toUpperCase() === question.correct_option;

    const newStreak = isCorrect ? question.correct_streak + 1 : 0;
    const intervalDays = isCorrect
      ? REVIEW_INTERVALS_DAYS[Math.min(newStreak - 1, REVIEW_INTERVALS_DAYS.length - 1)]
      : 0; // wrong answers are due again immediately

    const updateSql = `
      UPDATE quiz_questions
      SET correct_streak = ?, total_attempts = total_attempts + 1, correct_attempts = correct_attempts + ?, next_review_at = ?
      WHERE id = ?
    `;

    db.query(updateSql, [newStreak, isCorrect ? 1 : 0, daysFromNow(intervalDays), questionId], (err) => {
      if (err) return res.status(500).json({ message: "DB error" });

      res.json({
        correct: isCorrect,
        correctOption: question.correct_option,
        streak: newStreak
      });
    });
  });
});

// ================= TIMETABLE =================

// Save (or replace) the timetable image for a user.
// Uses UPSERT so re-uploading/editing overwrites the existing row instead of
// piling up duplicate rows (requires a UNIQUE key on user_id - see migration below).
app.post("/api/timetable/upload", (req, res) => {
    const { userId, image } = req.body;

    const sql = `
        INSERT INTO timetable_images (user_id, image)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE image = VALUES(image), updated_at = CURRENT_TIMESTAMP
    `;

    db.query(sql, [userId, image], (err, result) => {
        if(err) return res.status(500).json(err);
        res.json({ message: "Image saved" });
    });
});

// Save (or edit) a day's end time.
// Uses UPSERT keyed on (user_id, day) so editing a day updates the existing
// row instead of creating a second one (requires UNIQUE key - see migration below).
app.post("/api/timetable/day", (req, res) => {
    const { userId, day, endTime, email } = req.body;

    const sql = `
        INSERT INTO timetable_days (user_id, day, end_time, email, notified)
        VALUES (?, ?, ?, ?, FALSE)
        ON DUPLICATE KEY UPDATE end_time = VALUES(end_time), email = VALUES(email), notified = FALSE
    `;

    db.query(sql, [userId, day, endTime, email], (err, result) => {
        if(err) return res.status(500).json(err);
        res.json({ message: "Day timing saved" });
    });
});

// Get the saved timetable (image + all day timings) for a user
app.get("/api/timetable/:userId", (req, res) => {
    const userId = req.params.userId;

    const imageSql = "SELECT * FROM timetable_images WHERE user_id = ?";
    const daysSql = "SELECT * FROM timetable_days WHERE user_id = ? ORDER BY FIELD(day,'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')";

    db.query(imageSql, [userId], (err, imageResult) => {
        if(err) return res.status(500).json(err);

        db.query(daysSql, [userId], (err, daysResult) => {
            if(err) return res.status(500).json(err);

            res.json({
                image: imageResult[0] || null,
                days: daysResult
            });
        });
    });
});

// Delete the timetable image (day timings are kept; delete those individually if needed)
app.delete("/api/timetable/:userId", (req, res) => {
    const userId = req.params.userId;

    const sql = "DELETE FROM timetable_images WHERE user_id = ?";
    db.query(sql, [userId], (err, result) => {
        if(err) return res.status(500).json(err);
        res.json({ message: "Deleted successfully" });
    });
});

// Delete a single day's end time
app.delete("/api/timetable/day/:id", (req, res) => {
    const id = req.params.id;

    const sql = "DELETE FROM timetable_days WHERE id = ?";
    db.query(sql, [id], (err, result) => {
        if(err) return res.status(500).json(err);
        res.json({ message: "Day timing deleted" });
    });
});

app.post("/api/assignments", (req, res) => {
    const { userId, subject, due ,email} = req.body;

    const sql = `
        INSERT INTO assignments (user_id, subject, due_date, email)
        VALUES (?, ?, ?, ?)
    `;

    db.query(sql, [userId, subject, due,email], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ message: "Assignment added" });
    });
});

app.get("/api/assignments/:userId", (req, res) => {
    const userId = req.params.userId;

    const sql = "SELECT * FROM assignments WHERE user_id = ? ORDER BY due_date ASC";

    db.query(sql, [userId], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json(result);
    });
});

app.put("/api/assignments/:id", (req, res) => {
    const id = req.params.id;

    const sql = "UPDATE assignments SET turned_in = TRUE WHERE id = ?";

    db.query(sql, [id], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ message: "Updated successfully" });
    });
});

app.post("/api/grades", (req, res) => {

    const { userId, subject, slot, exam, total, obtained, average } = req.body;

    const sql = `
        INSERT INTO grades
        (user_id, subject, slot, exam, total_marks, marks_obtained, class_average)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sql,
        [userId, subject, slot, exam, total, obtained, average],
        (err, result) => {

            if (err) return res.status(500).json(err);

            const percentage = (Number(obtained) / Number(total)) * 100;

            // ✅ FETCH USER EMAIL FROM USERS TABLE
            const userSql = "SELECT email FROM users WHERE id = ?";

            db.query(userSql, [userId], (err2, userResult) => {

                if (err2) return console.error(err2);

                const userEmail = userResult[0]?.email;

                if (!userEmail) {
                    console.log("No email found for user");
                    return res.json({ message: "Grade added successfully" });
                }

                // ✅ SEND MAIL TO USER EMAIL
                if (percentage < 40) {

                    const mailOptions = {
                        from: process.env.EMAIL_USER,
                        to: userEmail,
                        subject: "⚠ Low Score Alert",

                        text: `
🚨 LOW PERFORMANCE ALERT

Subject: ${subject}
Exam: ${exam}
Score: ${percentage.toFixed(2)}%

----------------------------------

⚠ This is below 40%.

📌 What you should do:
- Revise weak topics
- Practice previous questions
- Focus more on this subject

Don't worry — improve from here 💪
                        `
                    };

                    transporter.sendMail(mailOptions, (error, info) => {
                        if (error) {
                            console.error("Low Score Email Error:", error);
                        } else {
                            console.log("Low Score Alert Sent to user");
                        }
                    });
                }

                res.json({ message: "Grade added successfully" });

            });

        }
    );
});

app.get("/api/grades/:userId", (req, res) => {

    const userId = req.params.userId;

    const sql = "SELECT * FROM grades WHERE user_id = ? ORDER BY exam, slot";

    db.query(sql, [userId], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json(result);
    });
});

app.put("/api/grades/:id", (req, res) => {

    const id = req.params.id;
    const { subject, slot, total, obtained, average } = req.body;

    const sql = `
        UPDATE grades
        SET subject = ?, slot = ?, total_marks = ?, 
            marks_obtained = ?, class_average = ?
        WHERE id = ?
    `;

    db.query(sql, 
        [subject, slot, total, obtained, average, id], 
        (err, result) => {
            if (err) return res.status(500).json(err);
            res.json({ message: "Grade updated" });
        }
    );
});


// ================= OTHER ROUTES =================

app.use("/api/auth", require("./routes/auth"));


cron.schedule("0 9 * * *", () => {

    const now = new Date();
    const currentTime =
        now.getHours().toString().padStart(2, "0") + ":" +
        now.getMinutes().toString().padStart(2, "0");

    const sql = `
    SELECT * FROM timetable_days
    WHERE end_time = ? AND notified = FALSE
    `;

    db.query(sql, [currentTime], (err, results) => {

        if (err) return console.error(err);

        results.forEach(row => {

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: row.email,
                subject: "Study Day Completed 🎉",
                text: "Great job! You completed today's study schedule."
            };

            transporter.sendMail(mailOptions, (error, info) => {

                if (!error) {
                    console.log("Timetable email sent");

                    db.query(
                        "UPDATE timetable_days SET notified = TRUE WHERE id = ?",
                        [row.id]
                    );
                }

            });

        });

    });

});

// Assignment Reminder Cron - Runs Every Day at 9 AM
cron.schedule("* * * * *", () => {

    const sql = `
    SELECT *,
    DATEDIFF(due_date, CURDATE()) AS days_left
    FROM assignments
    WHERE
        DATEDIFF(due_date, CURDATE()) <= 3
        AND DATEDIFF(due_date, CURDATE()) >= 0
        AND turned_in = FALSE
        AND reminded = FALSE
    `;

    db.query(sql, (err, results) => {

        if (err) return console.error(err);

        results.forEach(row => {

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: row.email,
                subject: "Assignment Reminder 📚",
                text: `
Assignment: ${row.subject}
Due Date: ${new Date(row.due_date).toDateString()}

⚠ Only ${row.days_left} day(s) left!
                `
            };

            transporter.sendMail(mailOptions, (error) => {

                if (!error) {
                    db.query(
                        "UPDATE assignments SET reminded = TRUE WHERE id = ?",
                        [row.id]
                    );
                }

            });

        });

    });

});

// Weekly Summary - Every Sunday at 8 PM
cron.schedule("0 20 * * 0", () => {

    const sql = `
    SELECT email,
COUNT(*) as totalExams,
AVG((marks_obtained / total_marks) * 100) as avgScore
FROM grades
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY email
    `;

    db.query(sql, (err, results) => {

        if (err) return console.error(err);

        results.forEach(row => {

            const avg = row.avgScore ? Number(row.avgScore).toFixed(2) : 0;

            const remark = avg >= 75
                ? "You're firing on all cylinders this week — that kind of consistency is exactly what separates good scores from great ones. Keep this momentum going into next week."
                : avg >= 50
                ? "A solid, steady week. You're clearly putting in the work — a little extra focus on your weaker topics could turn this into a great week next time."
                : "This week was tougher than usual, and that's okay — everyone has weeks like this. What matters is what you do next: revisit the topics that tripped you up and go into next week with a plan.";

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: row.email,
                subject: "📊 Your Weekly Study Report",

                text: `
━━━━━━━━━━━━━━━━━━━━━━
📊 WEEKLY STUDY REPORT
━━━━━━━━━━━━━━━━━━━━━━

Hey there! Here's how your week of studying went.

📝 Exams taken this week: ${row.totalExams}
📈 Average score: ${avg}%

💬 ${remark}

━━━━━━━━━━━━━━━━━━━━━━

See you next week — keep showing up for yourself. 🚀

– Self Study App
                `
            };

            transporter.sendMail(mailOptions, () => {
                db.query("UPDATE grades SET weekly_sent = TRUE WHERE email = ?", [row.email]);
            });

        });

    });

});

// Monthly Report - 1st day of every month at 9 AM
cron.schedule("0 9 1 * *", () => {

    const assignmentSql = `
    SELECT
        COUNT(*) as totalAssignments,
        SUM(turned_in) as completed
    FROM assignments
    `;

    db.query(assignmentSql, (err, aResult) => {

        if (err) return console.error(err);

        // ✅ DEFINE VARIABLES HERE
        const total = aResult[0].totalAssignments;
        const completed = aResult[0].completed || 0;
        const pending = total - completed;

        // ❌ NO forEach here

        const insight = completed === total
            ? "🎉 A perfect month — every single assignment completed. That's real discipline, not luck. Whatever routine got you here, keep it."
            : completed >= total / 2
            ? "👍 You're more than halfway there. Most of the hard work is already done — a bit more focus over the next few days can close the gap completely."
            : "⚠ This month had more pending work than finished work. That's a signal, not a failure — it usually means the workload needs breaking into smaller, earlier steps rather than more willpower.";

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER,
            subject: "📚 Your Monthly Study Report",

            text: `

━━━━━━━━━━━━━━━━━━━━━━
📚 MONTHLY STUDY REPORT
━━━━━━━━━━━━━━━━━━━━━━

Hi there,

A new month is starting, so here's a look back at how the last one went.

📊 ASSIGNMENT STATUS
✔ Completed: ${completed}
⏳ Pending: ${pending}

━━━━━━━━━━━━━━━━━━━━━━
📈 HOW YOU DID

${insight}

━━━━━━━━━━━━━━━━━━━━━━
💡 A FEW IDEAS FOR NEXT MONTH

• Block out study time in advance instead of finding time reactively
• Start assignments a few days early — future-you will thank you
• Lean on your timetable's daily end-time reminders to stay consistent

━━━━━━━━━━━━━━━━━━━━━━

Here's to a stronger month ahead. 🚀

– Self Study App

`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (!error) {
                console.log("Monthly sent");
            }
        });

    });

});
// ================= START SERVER =================

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
