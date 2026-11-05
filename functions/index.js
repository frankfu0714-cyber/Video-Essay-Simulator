import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { createHandler } from "./feedback.js";
import { createAnalyzer } from "./gemini.js";

initializeApp();

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

export const aiFeedback = onRequest(
  {
    region: "us-central1",
    secrets: [GEMINI_API_KEY],
    cors: ["https://frankfu0714-cyber.github.io", /^http:\/\/localhost(:\d+)?$/],
    invoker: "public", // The handler verifies each Firebase ID token itself.
    memory: "512MiB",
    timeoutSeconds: 180,
    maxInstances: 5,
    concurrency: 4,
  },
  (req, res) =>
    createHandler({
      verifyToken: (idToken) => getAuth().verifyIdToken(idToken),
      db: getFirestore(),
      analyze: createAnalyzer(GEMINI_API_KEY.value()),
      countReview: () =>
        getFirestore().doc("stats/public").set({ aiReviews: FieldValue.increment(1) }, { merge: true }),
    })(req, res)
);
