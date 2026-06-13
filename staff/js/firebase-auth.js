// js/firebase-auth.js
// Requires <script type="module" src="js/firebase-auth.js"></script> in HTML.

import { app, auth, db, storage } from "./firebase-config.js";
import {
  setPersistence,
  browserLocalPersistence,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { doc, setDoc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-storage.js";

const googleProvider = new GoogleAuthProvider();

// --- Helpers ---
function isMobile() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isInAppBrowser() {
  const ua = navigator.userAgent || "";
  return /FBAN|FBAV|Instagram|Instagram.*|Line\/|WhatsApp|FB_IAB|Twitter for/i.test(ua);
}

function debugLog(...args) {
  console.log("[auth-debug]", ...args);
}

function showAlertText(msg, type = 'info', options = {}) {
    if (window.showCustomPopup) {
        try {
            window.showCustomPopup(msg, type, options);
            return;
        } catch (e) {
            console.error("Custom popup failed:", e);
        }
    }
    alert(msg);
}

// --- Ensure persistence (fire-and-forget, Firebase defaults to LOCAL anyway) ---
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn("Could not set persistence:", err);
});

// --- User document helper ---
async function ensureUserDoc(user) {
  if (!user) {
    debugLog("No user provided to ensureUserDoc");
    return false;
  }
  const userRef = doc(db, "users", user.uid);
  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        name: user.displayName || "",
        email: user.email || "",
        phone: "",
        address: "",
        photoURL: user.photoURL || "",
        role: "customer"
      });
      debugLog("Created user doc for", user.uid);
      return true;
    } else {
      debugLog("User doc already exists for", user.uid);
      return true;
    }
  } catch (e) {
    console.error("ensureUserDoc error:", e);
    showAlertText("Failed to initialize user data.", 'error');
    return false;
  }
}

// --- Set loading state for UI elements ---
function setLoadingState(isLoading) {
  const elements = [
    document.getElementById("user-name"),
    document.getElementById("user-email"),
    document.getElementById("user-phone"),
    document.getElementById("user-address"),
    document.getElementById("user-profile-name")
  ];

  elements.forEach(el => {
    if (el) {
      if (isLoading) {
        el.classList.add('loading-placeholder');
        el.textContent = 'Loading...';
      } else {
        el.classList.remove('loading-placeholder');
      }
    }
  });
}

// --- Helper to show content and hide loading overlay ---
function showUI() {
    const overlay = document.getElementById('auth-loading-overlay');
    if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 500);
    }

    const legacyOverlays = ['auth-check', 'auth-screen'];
    legacyOverlays.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    const loginWrapper = document.querySelector('.login-wrapper');
    if (loginWrapper) {
        loginWrapper.style.display = 'block';
    }
}

// --- Fetch and display user data on dashboard ---
async function loadUserData(user) {
  if (!user) {
    debugLog("No user provided to loadUserData");
    showAlertText("No user is signed in.", 'error');
    return;
  }

  debugLog("Loading data for user:", user.uid, user.email);
  setLoadingState(true);

  const userRef = doc(db, "users", user.uid);
  const profilePicElement = document.getElementById("profile-pic");

  try {
    await ensureUserDoc(user);
    const snap = await getDoc(userRef);
    debugLog("Firestore snap exists:", snap.exists());

    const data = snap.exists() ? snap.data() : {
      name: user.displayName || "Not set",
      email: user.email || "Not set",
      phone: "Not set",
      address: "Not set",
      photoURL: user.photoURL || ""
    };

    debugLog("User data:", data);

    if (profilePicElement) {
      profilePicElement.src = data.photoURL || 'images/dummy.png';
    }

    setLoadingState(false);

    const nameElement = document.getElementById("user-name");
    const emailElement = document.getElementById("user-email");
    const phoneElement = document.getElementById("user-phone");
    const addressElement = document.getElementById("user-address");
    const profileNameElement = document.getElementById("user-profile-name");

    if (nameElement) nameElement.textContent = data.name || "Not set";
    if (emailElement) emailElement.textContent = data.email || "Not set";
    if (phoneElement) phoneElement.textContent = data.phone || "Not set";
    if (addressElement) addressElement.textContent = data.address || "Not set";
    if (profileNameElement) profileNameElement.textContent = data.name || "Not set";

    const editName = document.getElementById("edit-name");
    const editPhone = document.getElementById("edit-phone");
    const editAddress = document.getElementById("edit-address");

    if (editName) editName.value = data.name || "";
    if (editPhone) editPhone.value = data.phone || "";
    if (editAddress) editAddress.value = data.address || "";

    debugLog("Successfully updated dashboard with user data");

  } catch (e) {
    console.error("loadUserData error:", e);
    setLoadingState(false);

    showAlertText("Failed to load complete user data. Showing basic info.", 'error');

    if (profilePicElement) {
      profilePicElement.src = user.photoURL || 'images/dummy.png';
    }

    const nameElement = document.getElementById("user-name");
    const emailElement = document.getElementById("user-email");
    const phoneElement = document.getElementById("user-phone");
    const addressElement = document.getElementById("user-address");
    const profileNameElement = document.getElementById("user-profile-name");

    if (nameElement) nameElement.textContent = user.displayName || "Not set";
    if (emailElement) emailElement.textContent = user.email || "Not set";
    if (phoneElement) phoneElement.textContent = "Not set";
    if (addressElement) addressElement.textContent = "Not set";
    if (profileNameElement) profileNameElement.textContent = user.displayName || "Not set";
  }
}

// --- Update user profile ---
export async function updateProfile() {
  const user = auth.currentUser;
  if (!user) {
    showAlertText("No user is signed in.", 'error');
    return;
  }
  const userRef = doc(db, "users", user.uid);
  const name = (document.getElementById("edit-name") || {}).value || "";
  const phone = (document.getElementById("edit-phone") || {}).value || "";
  const address = (document.getElementById("edit-address") || {}).value || "";

  try {
    await updateDoc(userRef, { name, phone, address });
    const modalElement = document.getElementById('editProfileModal');
    const modalInstance = bootstrap.Modal.getInstance(modalElement);
    if (modalInstance) {
      modalInstance.hide();
    }
    showAlertText("Profile updated successfully!", 'success');
    await loadUserData(user);
  } catch (e) {
    console.error("updateProfile error:", e);
    showAlertText("Failed to update profile.", 'error');
  }
}

// --- Upload Profile Picture ---
export async function uploadProfilePicture(event) {
    const user = auth.currentUser;
    if (!user) {
        showAlertText("You must be logged in to upload a picture.", "error");
        return;
    }

    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showAlertText("Please select an image file.", "error");
        return;
    }
    if (file.size > 2 * 1024 * 1024) {
        showAlertText("File is too large. Maximum size is 2MB.", "error");
        return;
    }

    const storageRef = ref(storage, `profile_pictures/${user.uid}`);

    try {
        showAlertText("Uploading picture...", "info");
        const snapshot = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);

        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, { photoURL: downloadURL });

        const profilePicElement = document.getElementById("profile-pic");
        if (profilePicElement) {
            profilePicElement.src = downloadURL;
        }

        showAlertText("Profile picture updated successfully!", "success");

    } catch (error) {
        console.error("Error uploading profile picture:", error);
        showAlertText("Failed to upload profile picture. Please try again.", "error");
    }
}

// --- Auth methods ---
export async function signUp() {
  const name = (document.getElementById('name') || {}).value || "";
  const email = (document.getElementById('email') || {}).value || "";
  const password = (document.getElementById('password') || {}).value || "";
  const confirmPassword = (document.getElementById('confirmPassword') || {}).value || "";
  if (password !== confirmPassword) {
    showAlertText("Passwords do not match.", 'error');
    return;
  }
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, "users", cred.user.uid), {
      name, email, phone: "", address: "", photoURL: "", role: "customer"
    });
    window.location.href = "index.html";
  } catch (err) {
    console.error("SignUp error:", err);
    showAlertText(err.message || "Sign up failed", 'error');
  }
}

export async function signIn() {
  const email = (document.getElementById('email') || {}).value || "";
  const password = (document.getElementById('password') || {}).value || "";
  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = "index.html";
  } catch (err) {
    console.error("Email signIn error:", err);
    showAlertText(err.message || "Sign in failed", 'error');
  }
}

export function signInWithGoogle() {
  debugLog("Starting Google sign-in (isMobile:", isMobile(), "inApp:", isInAppBrowser(), ")");
  if (isInAppBrowser()) {
    showAlertText("It looks like you're inside an app's browser. Please open this page in your device browser (tap the three dots → Open in browser) and try again.", 'error');
    return;
  }

  signInWithPopup(auth, googleProvider)
    .then(async (result) => {
      debugLog("Popup sign-in success", result);
      await ensureUserDoc(result.user);
      window.location.href = "index.html";
    })
    .catch((error) => {
      console.error("signInWithPopup error:", error);
      if (error.code === "auth/popup-blocked" || error.code === "auth/popup-closed-by-user") {
        showAlertText("Popup blocked or closed. Trying redirect...", 'info');
        signInWithRedirect(auth, googleProvider).catch(e => {
          console.error("redirect fallback error:", e);
          showAlertText("Sign-in failed. Please try again.", 'error');
        });
      } else {
        showAlertText(error.message || "Google sign-in failed", 'error');
      }
    });
}

export function logout() {
  signOut(auth).then(() => {
    window.location.href = "sign_in.html";
  }).catch((e) => {
    console.error("SignOut error:", e);
    showAlertText("Could not sign out.", 'error');
  });
}

// --- Core auth initialisation ---
async function initAuth() {
  // Expose auth actions globally
  window.signUp = signUp;
  window.signIn = signIn;
  window.signInWithGoogle = signInWithGoogle;
  window.logout = logout;
  window.updateProfile = updateProfile;
  window.uploadProfilePicture = uploadProfilePicture;

  // Wire up buttons
  const signUpBtn = document.getElementById("signUpBtn");
  if (signUpBtn) signUpBtn.addEventListener("click", signUp);
  const signInBtn = document.getElementById("signInBtn");
  if (signInBtn) signInBtn.addEventListener("click", signIn);
  const googleBtn = document.getElementById("googleSignInBtn");
  if (googleBtn) googleBtn.addEventListener("click", signInWithGoogle);

  // ─────────────────────────────────────────────────────────────────────
  // FIX 1: If staff-layout-loader.js is also on this page it already
  // owns the auth-gate (redirect) logic. Register actions only and bail
  // early so we never create a competing onAuthStateChanged listener.
  // ─────────────────────────────────────────────────────────────────────
  if (window.__staffLayoutLoaderActive) {
    debugLog("staff-layout-loader is active – skipping firebase-auth.js auth-gate");
    return;
  }

  const body = document.body;
  const requiresAuth = body.getAttribute('data-requires-auth') !== 'false';
  const isAuthPage  = body.getAttribute('data-requires-auth') === 'false';

  // Handle redirect result from Google sign-in (must come first)
  try {
    const result = await getRedirectResult(auth);
    if (result && result.user) {
      debugLog("getRedirectResult returned user:", result.user.uid);
      await ensureUserDoc(result.user);
    } else {
      debugLog("getRedirectResult: no redirect in progress");
    }
  } catch (err) {
    console.error("getRedirectResult error:", err);
    showAlertText("Google Sign-In returned an error. Open browser console for details.", 'error');
  }

  // ─────────────────────────────────────────────────────────────────────
  // FIX 2: Replace the flawed "initialAuthCheckDone + 1500 ms timer"
  // pattern with a clean two-phase approach:
  //
  //  Phase A – wait for Firebase to resolve the persisted session ONCE
  //            (the very first onAuthStateChanged emission tells us the
  //            true initial state from localStorage/IndexedDB).
  //  Phase B – set up an ongoing listener only to catch real sign-outs,
  //            and cancel any pending redirect if the user comes back.
  //
  // This eliminates the race condition where a subsequent null emission
  // (token-refresh hiccup, brief network drop) would immediately kick
  // the user to sign_in.html.
  // ─────────────────────────────────────────────────────────────────────

  // Phase A: wait for initial auth state (resolves exactly once)
  const initialUser = await new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, user => {
      unsub();          // unsubscribe immediately after first emission
      resolve(user);
    });
  });

  debugLog("Initial auth state resolved:", initialUser ? initialUser.uid : "no user");

  if (initialUser) {
    if (isAuthPage) {
      // Already logged in – bounce away from sign-in page
      debugLog("User authenticated on auth page → redirect to index.html");
      window.location.href = "index.html";
      return;
    }

    // Protected page: reveal UI and load user data
    showUI();
    if (document.getElementById("user-profile-name")) {
      loadUserData(initialUser).catch(e => {
        console.error("loadUserData failed:", e);
        setLoadingState(false);
      });
    }

  } else {
    if (requiresAuth) {
      debugLog("No user on protected page → redirect to sign_in.html");
      window.location.href = "sign_in.html";
      return;
    }
    // Public / auth page with no current user → just show the UI
    debugLog("No user on public page → show UI");
    showUI();
  }

  // Phase B: ongoing listener for REAL sign-out events only.
  // We use a cancellable redirect timer so a transient null
  // (e.g. brief connectivity loss / token refresh) doesn't
  // immediately log the user out.
  let signOutRedirectTimer = null;

  onAuthStateChanged(auth, (user) => {
    if (user) {
      // User signed in (or session recovered) – cancel any pending redirect
      clearTimeout(signOutRedirectTimer);
      signOutRedirectTimer = null;
      debugLog("Phase-B: user present – cancelled any pending redirect");

      if (isAuthPage) {
        window.location.href = "index.html";
      }
    } else {
      if (requiresAuth && !signOutRedirectTimer) {
        // Give Firebase 4 seconds to recover (token refresh, brief drop)
        // before actually redirecting. This prevents false logouts.
        debugLog("Phase-B: user null on protected page – starting 4 s grace period");
        signOutRedirectTimer = setTimeout(() => {
          if (!auth.currentUser) {
            debugLog("Phase-B: still no user after grace period → sign_in.html");
            window.location.href = "sign_in.html";
          }
        }, 4000);
      }
    }
  });
}

// Run when DOM is ready
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initAuth);
} else {
  initAuth();
}
