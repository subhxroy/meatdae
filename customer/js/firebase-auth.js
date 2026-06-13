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
  signOut,
  signInWithCustomToken,
  RecaptchaVerifier,
  signInWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { doc, setDoc, getDoc, updateDoc, onSnapshot, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-storage.js";

const googleProvider = new GoogleAuthProvider();
console.log("[auth-debug] firebase-auth.js module loaded successfully");

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
  if (window.showCustomAlert) {
    const title = type === 'error' ? 'Error' : (type === 'success' ? 'Success' : 'Info');
    window.showCustomAlert(msg, title, type, options);
    return;
  }
  if (window.showCustomPopup) {
    try {
      window.showCustomPopup(msg, type, options);
      return;
    } catch (e) {
      console.error("Custom popup failed:", e);
    }
  }
  // Last resort: create a simple branded notification instead of browser alert
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:12px 20px;border-radius:8px;font-size:14px;z-index:99999;max-width:90vw;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.3)';
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

// --- Ensure persistence ---
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
    
    // Attempt to capture Name/Email from inputs (useful during registration/Phone OTP sign-up)
    let signupName = "";
    const nameEl = document.getElementById("phone-name") || document.getElementById("name");
    if (nameEl) signupName = nameEl.value.trim();

    let signupEmail = "";
    const emailEl = document.getElementById("email");
    if (emailEl) signupEmail = emailEl.value.trim();

    if (!snap.exists()) {
      await setDoc(userRef, {
        name: signupName || user.displayName || "",
        email: signupEmail || user.email || "",
        phone: user.phoneNumber || "",
        address: "",
        photoURL: user.photoURL || "",
        role: "customer"
      });
      debugLog("Created user doc for", user.uid);
      return true;
    } else {
      // If user doc exists but fields are empty, update them if inputs are present
      const currentData = snap.data();
      const updates = {};
      if (!currentData.name && signupName) updates.name = signupName;
      if (!currentData.email && signupEmail) updates.email = signupEmail;
      
      if (Object.keys(updates).length > 0) {
        await updateDoc(userRef, updates);
        debugLog("Updated user doc with missing fields:", updates);
      }
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

    // Update display address in modal
    const displayAddress = document.getElementById("display-address");
    if (displayAddress) displayAddress.textContent = data.address || "No address saved";

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

// **Upload Profile Picture Function**
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
  if (file.size > 2 * 1024 * 1024) { // 2MB limit
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


// --- STANDARD SMS OTP AUTH ---
export function setupRecaptcha() {
  console.log("[auth-debug] setupRecaptcha() called");
  
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      auth.settings.appVerificationDisabledForTesting = true;
      console.warn("[auth-debug] Localhost detected: appVerificationDisabledForTesting is TRUE. You MUST use a Test Phone Number configured in Firebase Console.");
  }
  
  if (window.recaptchaVerifier) {
    debugLog("RecaptchaVerifier already exists.");
    return window.recaptchaVerifier;
  }

  const container = document.getElementById('recaptcha-container');
  if (!container) {
    console.error("Critical: 'recaptcha-container' element not found in DOM.");
    showAlertText("Phone authentication setup failed: reCAPTCHA container not found. Please refresh the page.", 'error');
    return null;
  }

  // Clear any stale widgets and create a new child widget element
  container.innerHTML = '';
  const widget = document.createElement('div');
  widget.id = 'recaptcha-widget';
  container.appendChild(widget);

  const recaptchaParams = {
    'size': 'invisible',
    'callback': (response) => {
      debugLog("Recaptcha solved successfully");
    },
    'expired-callback': () => {
      debugLog("Recaptcha expired, resetting verifier...");
      try { window.recaptchaVerifier.clear(); } catch (e) {}
      window.recaptchaVerifier = null;
    }
  };

  try {
    // Try v9.19+ signature first: RecaptchaVerifier(auth, container, params)
    window.recaptchaVerifier = new RecaptchaVerifier(auth, widget, recaptchaParams);
    debugLog("RecaptchaVerifier initialized (v9.19+ signature).");
    return window.recaptchaVerifier;
  } catch (err1) {
    debugLog("v9.19+ signature failed, trying v9.6.x signature:", err1.message);
    try {
      // Fallback to v9.6.x signature: RecaptchaVerifier(container, params, auth)
      window.recaptchaVerifier = new RecaptchaVerifier(widget, recaptchaParams, auth);
      debugLog("RecaptchaVerifier initialized (v9.6.x signature).");
      return window.recaptchaVerifier;
    } catch (err2) {
      console.error("RecaptchaVerifier initialization failed with both signatures:", err1, err2);
      showAlertText("Phone authentication setup failed. Please refresh the page and try again.\n\nError: " + (err2.message || err2.code || "Unknown"), 'error');
      window.recaptchaVerifier = null;
      return null;
    }
  }
}

export function editPhoneNumber() {
  const phoneInputGroup = document.getElementById('phone-input-group');
  const otpSection = document.getElementById('otp-section');
  if (phoneInputGroup) phoneInputGroup.style.display = 'block';
  if (otpSection) otpSection.style.display = 'none';
  if (window.otpInterval) clearInterval(window.otpInterval);
  
  const sendBtn = document.getElementById('send-otp-btn');
  const btnText = sendBtn ? sendBtn.querySelector('.btn-text') : null;
  if (sendBtn) {
    sendBtn.classList.remove('loading');
    sendBtn.disabled = false;
    if (btnText) btnText.innerText = "Send OTP";
  }
}

export async function sendOTP() {
  console.log("[auth-debug] sendOTP() called");
  const sendBtn = document.getElementById('send-otp-btn');
  if (sendBtn && sendBtn.disabled) {
    debugLog("sendOTP ignored: button is already disabled/loading");
    return;
  }

  const phoneSection = document.getElementById('phone-signup-section');
  if (phoneSection && phoneSection.style.display !== 'none') {
    const nameVal = (document.getElementById('phone-name') || {}).value || "";
    if (!nameVal.trim()) {
      showAlertText("Please enter your name", 'error');
      return;
    }
  }

  let phoneNumber = document.getElementById('phone-number').value.trim();
  if (!phoneNumber) {
    showAlertText("Please enter your phone number", 'error');
    return;
  }

  // Normalize/Clean the input
  phoneNumber = phoneNumber.replace(/[\s\-\(\)]/g, '');

  let finalNumber = phoneNumber;
  if (phoneNumber.startsWith('+')) {
    finalNumber = phoneNumber;
  } else if (phoneNumber.startsWith('91') && phoneNumber.length > 10) {
    finalNumber = `+${phoneNumber}`;
  } else if (phoneNumber.startsWith('0') && phoneNumber.length === 11) {
    finalNumber = `+91${phoneNumber.substring(1)}`;
  } else if (phoneNumber.length === 10) {
    finalNumber = `+91${phoneNumber}`;
  }

  if (!/^\+\d{10,15}$/.test(finalNumber)) {
    showAlertText("Please enter a valid phone number (e.g., 98641 49429)", 'error');
    return;
  }

  const btnText = sendBtn ? sendBtn.querySelector('.btn-text') : null;
  const otpSection = document.getElementById('otp-section');
  const phoneInputGroup = document.getElementById('phone-input-group');

  if (sendBtn) {
    sendBtn.classList.add('loading');
    sendBtn.disabled = true;
    if (btnText) btnText.innerText = "Sending OTP...";
  }

  const appVerifier = setupRecaptcha();
  if (!appVerifier) {
    console.error("[auth-debug] setupRecaptcha returned null - RecaptchaVerifier failed to initialize");
    showAlertText("Could not initialize phone verification. Please refresh the page and try again.", 'error');
    if (sendBtn) {
      sendBtn.classList.remove('loading');
      sendBtn.disabled = false;
      if (btnText) btnText.innerText = "Send OTP";
    }
    return;
  }

  try {
    debugLog("Attempting to send OTP to:", finalNumber);
    window.confirmationResult = await signInWithPhoneNumber(auth, finalNumber, appVerifier);
    showAlertText("OTP sent to your phone", 'success', { minimal: true, autoClose: 2000 });

    if (otpSection) {
      otpSection.style.display = 'block';
      
      // Update the status message indicating the number sent to
      const msgEl = document.getElementById('otp-sent-message');
      if (msgEl) {
        msgEl.innerHTML = `OTP sent to <strong>${finalNumber}</strong> <a href="javascript:void(0)" onclick="editPhoneNumber()" style="color:var(--primary-orange); font-weight:700; text-decoration:none; margin-left:8px;">Edit</a>`;
      }

      let timerEl = document.getElementById('otp-timer');
      if (!timerEl) {
        timerEl = document.createElement('p');
        timerEl.id = 'otp-timer';
        timerEl.style = "text-align:center; margin-top:15px; font-size:13px; color:var(--text-light); font-weight: 500;";
        otpSection.appendChild(timerEl);
      }

      let timeLeft = 60;
      timerEl.innerText = `OTP Sent. Resend in ${timeLeft}s`;

      if (window.otpInterval) clearInterval(window.otpInterval);
      window.otpInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
          clearInterval(window.otpInterval);
          timerEl.innerHTML = `Didn't receive code? <a href="javascript:void(0)" onclick="sendOTP()" style="color:var(--primary-orange);font-weight:700;text-decoration:none;">Resend OTP</a>`;
          if (sendBtn) {
            sendBtn.classList.remove('loading');
            sendBtn.disabled = false;
            if (btnText) btnText.innerText = "Send OTP";
          }
        } else {
          timerEl.innerText = `OTP Sent. Resend in ${timeLeft}s`;
        }
      }, 1000);
    }

    if (phoneInputGroup) phoneInputGroup.style.display = 'none';

  } catch (error) {
    console.error("Detailed SMS error:", error);
    let errorMsg = "Failed to send OTP.";

    if (error.code === 'auth/invalid-phone-number') {
      errorMsg = "The phone number is invalid.";
    } else if (error.code === 'auth/quota-exceeded') {
      errorMsg = "Daily SMS quota exceeded. Try again tomorrow.";
    } else if (error.code === 'auth/too-many-requests') {
      errorMsg = "Too many attempts. Please wait a few minutes.";
    } else if (error.code === 'auth/captcha-check-failed') {
      errorMsg = "Security check failed. Please refresh the page.";
    } else if (error.code === 'auth/invalid-app-credential') {
      errorMsg = "App verification failed (invalid-app-credential). This usually happens if:\n\n1. Your domain (localhost or 127.0.0.1) is not added to 'Authorized Domains' under Authentication -> Settings in the Firebase Console.\n2. Your Firebase project is on the free Spark plan (sending real SMS requires upgrading to the pay-as-you-go Blaze plan).\n3. Your API Key in Google Cloud Console is restricted and blocking the Identity Toolkit API.";
    } else if (error.code === 'auth/unauthorized-domain') {
      errorMsg = "This domain is not authorized for phone authentication. Ensure it is added in Firebase Console.";
    } else if (error.code === 'auth/billing-not-enabled') {
      errorMsg = "Billing must be enabled on Firebase (Blaze plan) to use phone auth.";
    } else if (error.code === 'auth/operation-not-allowed') {
      errorMsg = "Phone sign-in is disabled in your Firebase Project.\n\nTo enable it, please visit the Firebase Console:\n1. Open Authentication -> Sign-in method\n2. Under Sign-in providers, click 'Phone' and switch the Enable toggle to active.";
    } else {
      errorMsg += " (" + (error.code || error.message) + ")";
    }

    errorMsg += "\n\nIf OTP login is not working, please try logging in using your Email or Google instead.";
    showAlertText(errorMsg, 'error');
    
    if (sendBtn) {
      sendBtn.classList.remove('loading');
      sendBtn.disabled = false;
      if (btnText) btnText.innerText = "Send OTP";
    }

    // Reset Recaptcha on error
    if (window.recaptchaVerifier) {
      try { window.recaptchaVerifier.clear(); } catch (e) {}
      window.recaptchaVerifier = null;
    }
    const container = document.getElementById('recaptcha-container');
    if (container) container.innerHTML = '';
  }
}

export async function verifyOTP() {
  console.log("[auth-debug] verifyOTP() called");
  const verifyBtn = document.getElementById('verify-otp-btn');
  if (verifyBtn && verifyBtn.disabled) {
    debugLog("verifyOTP ignored: button is already disabled/loading");
    return;
  }

  const code = document.getElementById('otp-code').value.trim();
  if (!code) return;

  const btnText = verifyBtn ? verifyBtn.querySelector('.btn-text') : null;

  if (verifyBtn) {
    verifyBtn.classList.add('loading');
    verifyBtn.disabled = true;
    if (btnText) btnText.innerText = "Verifying...";
  }

  try {
    const result = await window.confirmationResult.confirm(code);
    const user = result.user;
    await ensureUserDoc(user);

    if (typeof window.syncGuestCart === 'function') {
      await window.syncGuestCart(user.uid);
    }

    const redirectUrl = sessionStorage.getItem('redirectAfterLogin') || "dashboard.html";
    sessionStorage.removeItem('redirectAfterLogin');
    window.location.replace(redirectUrl);
  } catch (error) {
    console.error("OTP verify error:", error);
    showAlertText("Invalid OTP code. If OTP login is not working, please try Email or Google Sign-In instead.", 'error');
    if (verifyBtn) {
      verifyBtn.classList.remove('loading');
      verifyBtn.disabled = false;
      if (btnText) btnText.innerText = "Verify & Login";
    }
  }
}

// --- Auth methods ---
export async function signUp() {
  const signUpBtn = document.getElementById('signUpBtn');
  if (signUpBtn && signUpBtn.disabled) {
    debugLog("signUp ignored: button is already disabled/loading");
    return;
  }

  const name = (document.getElementById('name') || {}).value || "";
  const email = (document.getElementById('email') || {}).value || "";
  const phone = (document.getElementById('phone') || {}).value || "";
  const password = (document.getElementById('password') || {}).value || "";
  const confirmPassword = (document.getElementById('confirmPassword') || {}).value || "";
  if (password !== confirmPassword) {
    showAlertText("Passwords do not match.", 'error');
    return;
  }

  const btnText = signUpBtn ? signUpBtn.querySelector('.btn-text') : null;
  if (signUpBtn) {
    signUpBtn.classList.add('loading');
    signUpBtn.disabled = true;
    if (btnText) btnText.innerText = "Creating Account...";
  }

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, "users", cred.user.uid), {
      name, email, phone, address: "", photoURL: "", role: "customer"
    });

    // SYNC GUEST CART
    if (typeof window.syncGuestCart === 'function') {
      await window.syncGuestCart(cred.user.uid);
    }

    const redirectUrl = sessionStorage.getItem('redirectAfterLogin') || "dashboard.html";
    sessionStorage.removeItem('redirectAfterLogin');
    window.location.replace(redirectUrl);
  } catch (err) {
    console.error("SignUp error:", err);
    showAlertText(err.message || "Sign up failed", 'error');
    if (signUpBtn) {
      signUpBtn.classList.remove('loading');
      signUpBtn.disabled = false;
      if (btnText) btnText.innerText = "Continue with Email";
    }
  }
}

export async function signIn() {
  const signInBtn = document.getElementById('signInBtn');
  if (signInBtn && signInBtn.disabled) {
    debugLog("signIn ignored: button is already disabled/loading");
    return;
  }

  const email = (document.getElementById('email') || {}).value || "";
  const password = (document.getElementById('password') || {}).value || "";

  const btnText = signInBtn ? signInBtn.querySelector('.btn-text') : null;
  if (signInBtn) {
    signInBtn.classList.add('loading');
    signInBtn.disabled = true;
    if (btnText) btnText.innerText = "Logging in...";
  }

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);

    // SYNC GUEST CART
    if (typeof window.syncGuestCart === 'function') {
      await window.syncGuestCart(cred.user.uid);
    }

    const redirectUrl = sessionStorage.getItem('redirectAfterLogin') || "dashboard.html";
    sessionStorage.removeItem('redirectAfterLogin');
    window.location.replace(redirectUrl);
  } catch (err) {
    console.error("Email signIn error:", err);
    showAlertText(err.message || "Sign in failed", 'error');
    if (signInBtn) {
      signInBtn.classList.remove('loading');
      signInBtn.disabled = false;
      if (btnText) btnText.innerText = "Login with Email";
    }
  }
}

export function signInWithGoogle() {
  const googleBtn = document.getElementById('googleSignInBtn');
  if (googleBtn && googleBtn.disabled) {
    debugLog("signInWithGoogle ignored: button is already disabled/loading");
    return;
  }

  debugLog("Starting Google sign-in (isMobile:", isMobile(), "inApp:", isInAppBrowser(), ")");
  if (isInAppBrowser()) {
    showAlertText("It looks like you're inside an app's browser. Please open this page in your device browser (tap the three dots → Open in browser) and try again.", 'error');
    return;
  }

  if (googleBtn) {
    googleBtn.disabled = true;
  }

  signInWithPopup(auth, googleProvider)
    .then(async (result) => {
      debugLog("Popup sign-in success", result);
      await ensureUserDoc(result.user);

      // SYNC GUEST CART
      if (typeof window.syncGuestCart === 'function') {
        await window.syncGuestCart(result.user.uid);
      }

      const redirectUrl = sessionStorage.getItem('redirectAfterLogin') || "dashboard.html";
      sessionStorage.removeItem('redirectAfterLogin');
      window.location.replace(redirectUrl);
    })
    .catch((error) => {
      console.error("signInWithPopup error:", error);
      if (googleBtn) {
        googleBtn.disabled = false;
      }
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
    window.location.replace("sign_in.html");
  }).catch((e) => {
    console.error("SignOut error:", e);
    showAlertText("Could not sign out.", 'error');
  });
}

// --- NEW LOGIN OVERLAY LOGIC ---
export function showLoginOverlay() {
  showAlertText("Heads up! Some features on this page require you to be signed in to work correctly.", "info");
}

export function goToLogin() {
  sessionStorage.setItem('redirectAfterLogin', window.location.href);
  window.location.replace("sign_in.html");
}

window.showLoginOverlay = showLoginOverlay;
window.goToLogin = goToLogin;
// --- END NEW LOGIN OVERLAY LOGIC ---

// --- Process redirect result and auth state changes ---
async function initAuth() {
  console.log("[auth-debug] initAuth() called");
  // Wire up global functions
  window.signUp = signUp;
  window.signIn = signIn;
  window.signInWithGoogle = signInWithGoogle;
  window.logout = logout;
  window.updateProfile = updateProfile;
  window.uploadProfilePicture = uploadProfilePicture;
  window.sendOTP = sendOTP;
  window.verifyOTP = verifyOTP;
  window.editPhoneNumber = editPhoneNumber;

  // Wire up buttons
  const signUpBtn = document.getElementById("signUpBtn");
  if (signUpBtn) signUpBtn.addEventListener("click", signUp);

  const signInBtn = document.getElementById("signInBtn");
  if (signInBtn) signInBtn.addEventListener("click", signIn);

  const googleBtn = document.getElementById("googleSignInBtn");
  if (googleBtn) googleBtn.addEventListener("click", signInWithGoogle);

  const sendOtpBtn = document.getElementById("send-otp-btn");
  if (sendOtpBtn) sendOtpBtn.addEventListener("click", sendOTP);

  const verifyOtpBtn = document.getElementById("verify-otp-btn");
  if (verifyOtpBtn) verifyOtpBtn.addEventListener("click", verifyOTP);

  // Register setupRecaptcha globally
  window.setupRecaptcha = setupRecaptcha;

  // Don't initialize Recaptcha on page load — it will be set up
  // when the user clicks "Send OTP" or switches to the Phone tab.

  let dataLoaded = false;

  async function loadDataSafely() {
    if (dataLoaded) return;

    // Robust Page Detection: Check for a unique element on the dashboard
    const dashboardElement = document.getElementById("user-profile-name");

    // If we are NOT on a page with dashboard elements, do nothing
    if (!dashboardElement) {
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      return;
    }

    dataLoaded = true;
    await loadUserData(user);
  }

  try {
    const result = await getRedirectResult(auth);
    if (result && result.user) {
      debugLog("getRedirectResult returned user:", result.user.uid);
      await ensureUserDoc(result.user);
    } else {
      debugLog("getRedirectResult no credential (normal when not returning from redirect)");
    }
  } catch (err) {
    console.error("getRedirectResult error:", err);
    showAlertText("Google Sign-In returned an error. Open browser console for details.", 'error');
  }

  let isInitializing = true;

  onAuthStateChanged(auth, async (user) => {
    debugLog("onAuthStateChanged ->", user ? user.uid : "No user", "Pathname:", window.location.pathname);
    
    // Check where we are using more robust URL detection
    const path = window.location.pathname.toLowerCase();
    const isDashboard = path.includes('dashboard.html') || !!document.getElementById("user-profile-name");
    const isCheckout = path.includes('check_out.html') || path.includes('checkout');
    const isMyOrders = path.includes('my_orders.html');
    const isAuthPage = path.includes('sign_in.html') || path.includes('sign_up.html');
    
    const requiresAuth = isDashboard || isCheckout || isMyOrders || document.body.hasAttribute("data-requires-auth");

    if (user) {
      // Set initial user role (async fetch)
      getDoc(doc(db, "users", user.uid)).then(snap => {
        if (snap.exists()) {
          window.userRole = snap.data().role || 'customer';
          // Trigger stock sync update now that we know the role
          if (typeof window.updateMenuStockStatus === 'function') window.updateMenuStockStatus();
          if (typeof window.checkStockForCurrentSelection === 'function') window.checkStockForCurrentSelection();
        }
      }).catch(e => console.error("Error fetching role:", e));

      // Sync guest cart to Firestore if user just logged in or session restored
      if (typeof window.syncGuestCart === 'function') {
        window.syncGuestCart(user.uid);
      }

      if (isDashboard) {
        debugLog("User on dashboard, ensuring user doc and loading data");
        requestAnimationFrame(() => {
          loadDataSafely().catch(e => {
            console.error("loadDataSafely failed:", e);
            setLoadingState(false);
          });
        });
      } else if (isAuthPage) {
        debugLog("Redirecting from sign-in/up page since user is logged in");
        const redirectUrl = sessionStorage.getItem('redirectAfterLogin') || "dashboard.html";
        sessionStorage.removeItem('redirectAfterLogin');
        window.location.replace(redirectUrl);
      }
    } else {
      // No user - Immediately handle unauthorized access
      const isStillGuest = !auth.currentUser;
      if (isStillGuest && requiresAuth && !isAuthPage) {
        const handleUnauthorized = () => {
          if (isCheckout) {
            if (typeof window.goToLogin === 'function') window.goToLogin();
            else window.location.href = 'sign_in.html?redirect=' + encodeURIComponent(window.location.href);
          } else {
            if (typeof window.showCustomConfirm === 'function') {
              window.showCustomConfirm("Unlock full access! Please sign in to complete your checkout and track your order.", () => {
                  if (typeof window.goToLogin === 'function') window.goToLogin();
                  else window.location.href = 'sign_in.html?redirect=' + encodeURIComponent(window.location.href);
              }, "Sign In", "Not Now");
            }
          }
        };

        if (isInitializing) {
          setTimeout(() => {
            if (!auth.currentUser) {
              handleUnauthorized();
            }
          }, 1500);
        } else {
          handleUnauthorized();
        }
      }
    }
    isInitializing = false;
  });

  // Immediate check for existing user (for page refreshes)
  if (auth.currentUser && document.getElementById("user-profile-name")) {
    debugLog("Immediate auth check: user already signed in");
    requestAnimationFrame(() => {
      loadDataSafely();
    });
  }
}

// Robust Initialization: Run initAuth when DOM is ready
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initAuth);
} else {
  initAuth();
}