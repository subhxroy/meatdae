// js/firebase-config.js
// Shared Firebase configuration — import from here instead of duplicating config.

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyB3lDeUASVt_lcPuBCP7IqUKr7HQ8mZ9O8",
  authDomain: "meatdae-2nd.firebaseapp.com",
  projectId: "meatdae-2nd",
  storageBucket: "meatdae-2nd.firebasestorage.app",
  messagingSenderId: "269779649963",
  appId: "1:269779649963:web:9da7c923d522163b48beee",
  measurementId: "G-04TGS2SZ80"
};

const app = initializeApp(firebaseConfig);
let analytics = null;
try {
  analytics = getAnalytics(app);
} catch (e) {
  console.warn("Firebase Analytics not supported or blocked in this environment:", e);
}
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export { app, auth, db, storage, firebaseConfig, analytics };
