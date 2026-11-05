// Request handling for AI feedback. Dependencies are passed in so the quota,
// auth, and refund rules can be tested without calling Google.

export const DAILY_LIMIT = 5;
export const GLOBAL_DAILY_LIMIT = 200; // Spending circuit breaker across all users.
export const MAX_VIDEO_BYTES = 30 * 1024 * 1024; // Same cap as saved videos.
const MAX_QUESTION_CHARS = 1000;
const ALLOWED_TYPES = new Set(["video/webm", "video/mp4"]);

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);

export function nextResetIso(now = new Date()) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  ).toISOString();
}

export async function requireGoogleUser(req, verifyToken) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) throw new HttpError(401, "sign_in_required", "Please sign in.");

  let token;
  try {
    token = await verifyToken(match[1]);
  } catch {
    throw new HttpError(401, "sign_in_required", "Your session expired. Please sign in again.");
  }

  // Password-only accounts can be created with any address, so they could be
  // used to farm free analyses. Only a linked Google identity qualifies.
  if (!token.firebase?.identities?.["google.com"]?.length) {
    throw new HttpError(403, "google_required", "AI feedback requires signing in with Google.");
  }
  return token;
}

export function parseVideoRequest(req) {
  const type = String(req.get("x-video-type") || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type)) {
    throw new HttpError(415, "unsupported_video", "This video format is not supported.");
  }

  const video = req.rawBody;
  if (!video?.length) throw new HttpError(400, "empty_video", "The recording is empty.");
  if (video.length > MAX_VIDEO_BYTES) {
    throw new HttpError(413, "video_too_large", "The recording is over the 30 MB limit.");
  }

  let question = "";
  try {
    question = decodeURIComponent(req.get("x-question") || "");
  } catch {
    throw new HttpError(400, "bad_question", "The question could not be read.");
  }
  question = question.trim().slice(0, MAX_QUESTION_CHARS);
  if (!question) throw new HttpError(400, "bad_question", "The question is missing.");

  return { type, video, question };
}

// Reserves one use before Gemini is called, so parallel requests cannot exceed
// the limit. Counters live in Firestore paths that clients are denied by rules.
export async function reserveQuota(db, uid, now = new Date()) {
  const day = utcDay(now);
  const userRef = db.doc(`aiQuota/${uid}`);
  const globalRef = db.doc(`aiQuotaGlobal/${day}`);

  return db.runTransaction(async (tx) => {
    const [userSnap, globalSnap] = await Promise.all([tx.get(userRef), tx.get(globalRef)]);
    const stored = userSnap.exists ? userSnap.data() : null;
    const used = stored?.day === day ? stored.used : 0;
    const globalUsed = globalSnap.exists ? globalSnap.data().used : 0;

    if (used >= DAILY_LIMIT) {
      throw new HttpError(429, "daily_limit", `You've used all ${DAILY_LIMIT} free analyses for today.`, {
        remaining: 0,
        resetsAt: nextResetIso(now),
      });
    }
    if (globalUsed >= GLOBAL_DAILY_LIMIT) {
      throw new HttpError(503, "busy", "AI feedback is at capacity today. Please try again tomorrow.");
    }

    tx.set(userRef, { day, used: used + 1 });
    tx.set(globalRef, { used: globalUsed + 1 });
    return { day, remaining: DAILY_LIMIT - used - 1 };
  });
}

// A failed analysis should not cost the user one of their daily tries.
export async function refundQuota(db, uid, day) {
  const userRef = db.doc(`aiQuota/${uid}`);
  const globalRef = db.doc(`aiQuotaGlobal/${day}`);

  await db.runTransaction(async (tx) => {
    const [userSnap, globalSnap] = await Promise.all([tx.get(userRef), tx.get(globalRef)]);
    if (userSnap.exists && userSnap.data().day === day && userSnap.data().used > 0) {
      tx.update(userRef, { used: userSnap.data().used - 1 });
    }
    if (globalSnap.exists && globalSnap.data().used > 0) {
      tx.update(globalRef, { used: globalSnap.data().used - 1 });
    }
  });
}

export async function getRemaining(db, uid, now = new Date()) {
  const snap = await db.doc(`aiQuota/${uid}`).get();
  const data = snap.exists ? snap.data() : null;
  const used = data?.day === utcDay(now) ? data.used : 0;
  return { remaining: Math.max(0, DAILY_LIMIT - used), resetsAt: nextResetIso(now) };
}

export function createHandler({ verifyToken, db, analyze, countReview = async () => {}, log = console }) {
  return async function handle(req, res) {
    try {
      const token = await requireGoogleUser(req, verifyToken);

      if (req.method === "GET") {
        res.status(200).json(await getRemaining(db, token.uid));
        return;
      }
      if (req.method !== "POST") {
        throw new HttpError(405, "method_not_allowed", "Method not allowed.");
      }

      const { type, video, question } = parseVideoRequest(req);
      const { day, remaining } = await reserveQuota(db, token.uid);

      let feedback;
      try {
        feedback = await analyze({ video, type, question });
      } catch (err) {
        await refundQuota(db, token.uid, day).catch((e) => log.error("refund failed", e));
        log.error("analysis failed", err);
        throw new HttpError(502, "analysis_failed", "The analysis failed, so this try wasn't counted. Please try again.");
      }

      // The public counter must never cost a user their finished review.
      await countReview().catch((e) => log.error("review count failed", e));
      res.status(200).json({ feedback, remaining, resetsAt: nextResetIso() });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.code, message: err.message, ...err.extra });
        return;
      }
      log.error("unexpected error", err);
      res.status(500).json({ error: "server_error", message: "Something went wrong. Please try again." });
    }
  };
}
