import assert from "node:assert/strict";
import { test } from "node:test";
import { createHandler, DAILY_LIMIT, GLOBAL_DAILY_LIMIT, MAX_VIDEO_BYTES, utcDay } from "../feedback.js";

function fakeDb(seed = {}) {
  const store = new Map(Object.entries(seed));
  const ref = (path) => ({
    path,
    async get() { return snap(path); },
  });
  const snap = (path) => ({ exists: store.has(path), data: () => store.get(path) });
  return {
    store,
    doc: ref,
    async runTransaction(fn) {
      return fn({
        get: async (r) => snap(r.path),
        set: (r, v) => store.set(r.path, v),
        update: (r, v) => store.set(r.path, { ...store.get(r.path), ...v }),
      });
    },
  };
}

const google = { uid: "u1", firebase: { identities: { "google.com": ["123"] } } };
const password = { uid: "u2", firebase: { identities: { email: ["a@b.c"] } } };

function request({ method = "POST", token = "good", body = Buffer.from("video"), type = "video/webm;codecs=vp9,opus", question = "Why%20MBA%3F" } = {}) {
  const headers = {
    authorization: token ? `Bearer ${token}` : undefined,
    "x-video-type": type,
    "x-question": question,
  };
  return { method, rawBody: body, get: (h) => headers[h.toLowerCase()] };
}

function response() {
  return {
    statusCode: 0,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function setup({ user = google, seed, analyze, countReview } = {}) {
  const db = fakeDb(seed);
  const calls = [];
  const handle = createHandler({
    db,
    countReview,
    log: { error() {} },
    verifyToken: async (t) => { if (t !== "good") throw new Error("bad"); return user; },
    analyze: analyze || (async (a) => { calls.push(a); return { overallScore: 7 }; }),
  });
  const send = async (opts) => { const res = response(); await handle(request(opts), res); return res; };
  return { db, calls, send };
}

test("rejects a missing or invalid token before doing any work", async () => {
  const { send, calls } = setup();
  assert.equal((await send({ token: null })).statusCode, 401);
  assert.equal((await send({ token: "forged" })).statusCode, 401);
  assert.equal(calls.length, 0);
});

test("rejects accounts without a Google identity", async () => {
  const { send, calls } = setup({ user: password });
  const res = await send();
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "google_required");
  assert.equal(calls.length, 0);
});

test("allows the daily limit and blocks the next analysis", async () => {
  const { send, calls } = setup();
  const remaining = [];
  for (let i = 0; i < DAILY_LIMIT; i++) {
    const res = await send();
    assert.equal(res.statusCode, 200);
    remaining.push(res.body.remaining);
  }
  assert.deepEqual(remaining, [4, 3, 2, 1, 0]);
  const blocked = await send();
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.error, "daily_limit");
  assert.equal(calls.length, DAILY_LIMIT);
});

test("resets on a new UTC day", async () => {
  const { send } = setup({ seed: { "aiQuota/u1": { day: "2000-01-01", used: DAILY_LIMIT } } });
  const res = await send();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.remaining, DAILY_LIMIT - 1);
});

test("a failed analysis refunds the user and global counters", async () => {
  const { send, db } = setup({ analyze: async () => { throw new Error("gemini down"); } });
  const res = await send();
  assert.equal(res.statusCode, 502);
  assert.equal(db.store.get("aiQuota/u1").used, 0);
  assert.equal(db.store.get(`aiQuotaGlobal/${utcDay()}`).used, 0);
});

test("the global cap stops all analysis", async () => {
  const { send, calls } = setup({ seed: { [`aiQuotaGlobal/${utcDay()}`]: { used: GLOBAL_DAILY_LIMIT } } });
  const res = await send();
  assert.equal(res.statusCode, 503);
  assert.equal(calls.length, 0);
});

test("invalid uploads do not spend quota", async () => {
  const { send, db } = setup();
  assert.equal((await send({ type: "image/png" })).statusCode, 415);
  assert.equal((await send({ body: Buffer.alloc(0) })).statusCode, 400);
  assert.equal((await send({ body: Buffer.alloc(MAX_VIDEO_BYTES + 1) })).statusCode, 413);
  assert.equal((await send({ question: "" })).statusCode, 400);
  assert.equal((await send({ question: "%E0%A4%A" })).statusCode, 400);
  assert.equal(db.store.has("aiQuota/u1"), false);
});

test("passes the decoded question and base video type to the analyzer", async () => {
  const { send, calls } = setup();
  await send();
  assert.equal(calls[0].question, "Why MBA?");
  assert.equal(calls[0].type, "video/webm");
});

test("GET reports remaining uses without spending one", async () => {
  const { send, db } = setup({ seed: { "aiQuota/u1": { day: utcDay(), used: 2 } } });
  const res = await send({ method: "GET" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.remaining, DAILY_LIMIT - 2);
  assert.equal(db.store.get("aiQuota/u1").used, 2);
});

test("counts successful reviews only", async () => {
  let count = 0;
  const countReview = async () => { count++; };
  await setup({ countReview }).send();
  assert.equal(count, 1);
  await setup({ countReview, analyze: async () => { throw new Error("down"); } }).send();
  assert.equal(count, 1);
});

test("a counter failure still returns the review and keeps the charge", async () => {
  const { send, db } = setup({ countReview: async () => { throw new Error("stats down"); } });
  const res = await send();
  assert.equal(res.statusCode, 200);
  assert.equal(db.store.get("aiQuota/u1").used, 1);
});
