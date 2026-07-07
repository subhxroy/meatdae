# 🔒 MeatDae — Defensive Security Audit

> **Score: 2.2 / 5** — Your app has a decent Firestore rules foundation, but several **critical** and **high-severity** vulnerabilities exist across all five pillars. An attacker with moderate skill could exploit price manipulation, privilege escalation, and secret exposure **today**.

---

## Quick Summary

| Pillar | Rating | Status |
|--------|--------|--------|
| 1. Access Control & Role Enforcement | ⚠️ 2/5 | Hardcoded admin emails, client-side role trust, IDOR risks |
| 2. Input Validation & Sanitization | ⚠️ 2/5 | No server-side price validation, XSS vectors, client-trusted totals |
| 3. API & Integration Security | 🔴 1/5 | **No Razorpay signature verification**, secrets in `.env`, open CORS |
| 4. State Management & Error Handling | ⚠️ 3/5 | Reasonable but leaks debug info and exposes raw error messages |
| 5. Rate Limiting & Resource Exhaustion | ⚠️ 2/5 | No server-side rate limiting, Gemini bot is fully open to abuse |

---

## PILLAR 1: ACCESS CONTROL & ROLE ENFORCEMENT — ⚠️ 2/5

### 🔴 CRITICAL: Hardcoded Admin Emails in Client-Side Code

**Files:**
- [firestore.rules](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/firestore.rules#L16-L17) — Lines 16–17
- [staff-layout-loader.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/staff/js/staff-layout-loader.js#L132-L139) — Lines 132–139

**Finding:** Admin access is partially determined by comparing `request.auth.token.email` against hardcoded email addresses (`aarxslan@gmail.com`, `10sahilsarkargg@gmail.com`) directly in Firestore rules. Worse, the staff layout loader has a **different set of hardcoded admin emails** on the client side that override the Firestore-stored role:

```javascript
// staff-layout-loader.js (CLIENT-SIDE CODE - visible to anyone)
const adminEmails = [
    '10sahilsarkar@gmail.com',         // different from rules!
    'contact.harryteachesai@gmail.com',
    'support.meatdae@gmail.com',
    'contact.meatdae@gmail.com'
];
if (adminEmails.includes(initialUser.email)) {
    userData.role = 'admin'; // client-side override!
}
```

> [!CAUTION]
> **Impact:** Anyone who can read your JavaScript source (i.e. everyone) knows exactly which emails have admin access. If an attacker compromises any of those Gmail accounts, they own your entire database.  
> **Fix:** Replace hardcoded emails with **Firebase Custom Claims** set server-side. Remove all client-side admin email lists entirely.

---

### 🔴 CRITICAL: Role Stored in Firestore Document — Users Can Self-Promote

**Files:**
- [firestore.rules](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/firestore.rules#L38-L44) — Lines 38–44

**Finding:** The `users/{userId}` rule allows any signed-in user to read and **write** their own document:

```
allow read, write: if isSignedIn() && request.auth.uid == userId;
```

The `role` field lives in this same document. There is **no restriction** on which fields a user can update. An authenticated customer can open DevTools and run:

```javascript
await updateDoc(doc(db, "users", currentUser.uid), { role: "admin" });
```

Then the `isAdmin()`, `isPreparer()`, and `isRider()` functions in Firestore rules will treat them as admin/staff.

> [!CAUTION]
> **Impact:** Complete **privilege escalation**. Any authenticated user becomes admin.  
> **Fix:** Add a field-level write restriction: `allow update: if ... && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['role']);` — Only let admins change roles, or use Custom Claims.

---

### ⚠️ HIGH: Admin Role Change is Client-Side Write to Firestore

**File:** [admin_dashboard.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/staff/js/admin_dashboard.js#L717-L733) — Lines 717–733

```javascript
window.changeUserRole = async function (uid, newRole) {
    await updateDoc(doc(db, "users", uid), { role: newRole });
};
```

The admin dashboard changes roles by directly writing to Firestore from the browser. Combined with the self-promote vulnerability above, this means the "admin" doing the role change may not actually be a legitimate admin.

---

### ⚠️ HIGH: Auth Bypass Timeout in Stock Control

**File:** [stock_control.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/staff/js/stock_control.js#L50-L64) — Lines 50–64

```javascript
setTimeout(() => {
    // Force-show UI after 8 seconds regardless of auth
    interfaceDiv.style.display = 'block';
    contentDiv.style.display = 'block';
}, 8000);
```

> [!WARNING]
> If the auth check takes longer than 8 seconds (slow network), the stock control UI is shown to **anyone** — even unauthenticated visitors. The Firestore rules should still block writes, but this exposes the UI and could confuse legitimate security boundaries.

Similarly, [staff-layout-loader.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/staff/js/staff-layout-loader.js#L208-L215) has a 10-second emergency fallback that also force-shows content.

---

### ⚠️ MEDIUM: Rider Can Read Any "Pending" Order

**File:** [firestore.rules](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/firestore.rules#L52-L54) — Lines 52–54

Riders can read all orders in PENDING_APPROVAL, PREPARING, and READY_FOR_PICKUP status, plus any order assigned to them. This means every rider can see every customer's personal details (name, phone, address) across all orders — not just the ones they're picking up.

---

## PILLAR 2: INPUT VALIDATION & SANITIZATION — ⚠️ 2/5

### 🔴 CRITICAL: No Server-Side Price Validation — Entire Total is Client-Computed

**Files:**
- [payment.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/customer/js/payment.js#L556-L658) — `placeOrder()` function
- [check_out.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/customer/js/check_out.js#L1-L50) — Delivery charge logic

**Finding:** The entire payment pipeline works like this:

1. Client reads inventory prices from Firestore ✅
2. Client calculates subtotal, delivery charge, discount, and final total
3. Client writes the order document to Firestore with that total
4. **No backend/Cloud Function ever re-validates the total**

An attacker can intercept the `transaction.set(newOrderRef, orderData)` call and change `totalAmount` to `₹1` while keeping all items. For COD orders, this means they receive goods and only "owe" ₹1.

```javascript
// payment.js line 630-653 — the client decides the final price
const orderData = {
    totalAmount: total,          // ← client-computed, never verified
    deliveryCharge: deliveryCharge, // ← client-computed
    discountAmount: discountAmount, // ← client-computed
    onlineFee: isOnlinePayment ? ONLINE_PAYMENT_FEE : 0,
    // ...
};
transaction.set(newOrderRef, orderData);
```

> [!CAUTION]
> **Impact:** Complete price manipulation. Attackers get products for free/near-free.  
> **Fix:** Create a Cloud Function `createOrder` that receives only item IDs, quantities, and coupon code. The function recalculates prices from the authoritative `inventory` collection server-side.

---

### 🔴 CRITICAL: Coupon Discounts Enforced Only on Client

**File:** [payment.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/customer/js/payment.js#L434) — Line 434

```javascript
const coupons = { 'AQUALITY': 0.02, 'PLUSQUALITY': 0.02, ..., 'MEAT10': 0.10 };
```

All valid coupon codes and their discount percentages are visible in the client JavaScript. An attacker can:
1. See all coupon codes
2. Apply any coupon code
3. Modify the `couponDiscount` variable to any amount before the order is placed

---

### ⚠️ HIGH: Delivery Charge Calculated Client-Side Only

**File:** [check_out.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/customer/js/check_out.js#L36-L49) — `detectPriceFromAddress()`

The delivery charge (₹11–₹20) is calculated purely client-side by matching keywords in the address string. An attacker can:
- Set `deliveryCharge: 0` in the order document
- Enter a fake address that matches the "free delivery" threshold
- Bypass the `₹350 minimum for free delivery` by manipulating `totalSellingPrice`

---

### ⚠️ MEDIUM: XSS Vectors in Admin Dashboard

**File:** [admin_dashboard.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/staff/js/admin_dashboard.js#L381-L427)

Order data (customer name, address, notes) is injected directly into HTML via template literals without sanitization:

```javascript
`<span class="detail-value">${order.customerName || 'N/A'}</span>`
`<span class="detail-value">${order.specialInstructions || ''}</span>`
```

If a customer sets their name or order notes to `<img src=x onerror=alert(document.cookie)>`, it will execute in every admin's browser viewing the dashboard.

---

### ⚠️ MEDIUM: XSS in Support Bot

**File:** [support-bot.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/customer/js/support-bot.js#L142) — Line 142

```javascript
msgDiv.innerHTML = text.replace(/\n/g, '<br>');
```

Bot responses are injected as raw HTML. If the Gemini API response contains `<script>` tags or event handlers (via prompt injection), they will execute.

---

### ⚠️ MEDIUM: Operating Hours Bypass for Specific Emails

**File:** [payment.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/customer/js/payment.js#L766-L770) — Lines 766–770

```javascript
if (user.email.toLowerCase() === 'aarxslan@gmail.com' || 
    user.email.toLowerCase() === '10sahilsarkargg@gmail.com') {
    isOpen = true;
}
```

This bypass is visible to all users and is also checked purely client-side.

---

## PILLAR 3: API & INTEGRATION SECURITY — 🔴 1/5

### 🔴 CRITICAL: Razorpay Payment Has ZERO Server-Side Verification

**File:** [payment.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/customer/js/payment.js#L513-L553)

**This is the single most dangerous vulnerability in the codebase.**

The Razorpay integration:
1. Opens Razorpay checkout on the client ✅
2. Receives `razorpay_payment_id` in the success handler ✅
3. **Immediately writes the order to Firestore with `paymentStatus: "Paid"`** ❌❌❌
4. **Never verifies the payment signature with Razorpay's server** ❌❌❌

```javascript
"handler": function (response) {
    // Trusts the client callback blindly!
    placeOrder(..., "Online (Razorpay)", "Paid", response.razorpay_payment_id);
},
```

An attacker can:
1. Open DevTools, intercept the Razorpay callback
2. Call `placeOrder()` with a fake `razorpay_payment_id` string
3. The order is created with `paymentStatus: "Paid"` — without paying

> [!CAUTION]
> **Impact:** **Free products.** An attacker can place unlimited "paid" orders without ever paying a single rupee. This is an instant financial loss.  
> **Fix:** After Razorpay returns `razorpay_payment_id`, `razorpay_order_id`, and `razorpay_signature`, send all three to a Cloud Function that [verifies the signature](https://razorpay.com/docs/payments/server-integration/nodejs/payment-gateway/build-integration/#14-verify-payment-signature) using your Razorpay Key Secret. Only create the order if verification passes.

---

### 🔴 CRITICAL: Razorpay Live API Key Exposed in Client Code

**File:** [payment.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/customer/js/payment.js#L79) — Line 79

```javascript
const RAZORPAY_KEY = "rzp_live_SBdudmt1UBFAEw";
```

> [!IMPORTANT]
> The Razorpay **Key ID** is designed to be public (it's used in the checkout widget). However, without server-side signature verification, this key allows anyone to create fake payment confirmations. Additionally, make sure your **Key Secret** is NEVER in client code (it isn't currently — good).

---

### 🔴 CRITICAL: `.env` Secrets in Git-Tracked `functions/.env`

**File:** [functions/.env](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/functions/.env)

```env
GMAIL_USER=support.meatdae@gmail.com
GMAIL_APP_PASSWORD=uthr udod vwmg efii    ← LIVE GMAIL APP PASSWORD
ADMIN_EMAIL=contact.meatdae@gmail.com
GEMINI_API_KEY=AIzaSyAUo4ITWfMvuwkjmzvTOkq8EBDcVhVV4wM   ← LIVE API KEY
```

The root `.gitignore` only has `.env` — this matches `/.env` at root level. **The pattern does NOT match `functions/.env`** because `.gitignore` patterns without a `/` prefix match at any level, but `functions/.env` may have been committed before the `.gitignore` was updated.

> [!CAUTION]
> **Impact:** Anyone with access to your Git repo can read your Gmail App Password and Gemini API Key. The Gmail password gives full send access to your `support.meatdae@gmail.com` account.  
> **Fix:** 
> 1. Add `functions/.env` explicitly to `.gitignore`
> 2. Rotate ALL secrets immediately (Gmail App Password, Gemini API Key)
> 3. Use `firebase functions:config:set` or Secret Manager instead of `.env` files

---

### ⚠️ HIGH: Gemini Bot Endpoint Has Wide-Open CORS

**File:** [functions/index.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/functions/index.js#L242-L245)

```javascript
res.set("Access-Control-Allow-Origin", "*");
```

Any website in the world can call your `askGeminiBot` Cloud Function. This means attackers can:
- Use your Gemini API quota/billing for free
- Send millions of requests to run up your Google Cloud bill

> [!WARNING]
> **Fix:** Restrict CORS to your actual domains: `meatdae.com`, `admin.meatdae.com`.

---

### ⚠️ HIGH: Gemini Bot Accepts Arbitrary System Prompts

**File:** [functions/index.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/functions/index.js#L266-L271)

```javascript
const { systemPrompt } = req.body;
// ... sends it directly to Gemini
```

The Cloud Function accepts the **entire system prompt** from the client. An attacker can:
- Replace the system prompt with anything, using your API key
- Use it as a free general-purpose AI
- Perform prompt injection attacks

**Fix:** The system prompt should be defined server-side. The client should only send the `userQuery`.

---

### ⚠️ HIGH: MapTiler API Key Exposed Without Referrer Restrictions

**File:** [checkout_map.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/customer/js/checkout_map.js#L13) — Line 13

```javascript
const MAPTILER_KEY = 'W3AiGlyaiQBixFytnKpU';
```

**Fix:** Configure domain restrictions in the MapTiler dashboard to only allow requests from your domains.

---

## PILLAR 4: STATE MANAGEMENT & ERROR HANDLING — ⚠️ 3/5

### ⚠️ MEDIUM: Sensitive Data in localStorage

**Files:**
- [check_out.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/customer/js/check_out.js) — Stores `deliveryDetails` (name, phone, address) in `localStorage`
- [checkout_map.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/customer/js/checkout_map.js) — Stores GPS coordinates in `localStorage`

`localStorage` persists indefinitely and is accessible to any JavaScript running on the same origin (including XSS payloads). Delivery address, phone numbers, and GPS coordinates are PII.

**Fix:** Use `sessionStorage` for ephemeral data, and clear it immediately after use.

---

### ⚠️ MEDIUM: Debug Logging Exposes Internal State

**Files:**
- [firebase-auth.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/customer/js/firebase-auth.js) — `debugLog()` prints user UIDs, auth state transitions
- [payment.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/customer/js/payment.js) — `console.log("[DEBUG]")` throughout

These logs are visible in the browser console in production.

**Fix:** Strip debug logs in production builds or use a log level system.

---

### ✅ LOW: Error Messages Are Generally Safe

The error handling is reasonable — most `catch` blocks show generic messages to users while logging details to the console. No stack traces or internal paths are exposed to the UI.

---

## PILLAR 5: RATE LIMITING & RESOURCE EXHAUSTION — ⚠️ 2/5

### 🔴 CRITICAL: No Rate Limiting on Order Placement

**File:** [payment.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/customer/js/payment.js#L556-L658)

There is **no rate limiting** on order creation. An attacker can:
- Automate order placement (COD) to flood your kitchen with fake orders
- Exhaust your Firestore write quota
- Create thousands of documents in the `orders` and `admin_notifications` collections

**Fix:** Add a Cloud Function for order creation with rate limiting (e.g., max 5 orders per user per hour).

---

### ⚠️ HIGH: Gemini Bot Has No Server-Side Rate Limiting

**File:** [functions/index.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/functions/index.js#L239-L301)

The `askGeminiBot` endpoint has:
- No authentication check
- No rate limiting
- Open CORS (`*`)

The client-side support bot has a `MAX_MESSAGES_PER_PERIOD` constant ([support-bot.js](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/customer/js/support-bot.js#L99-L100)), but this is trivially bypassed with `curl` or Postman.

**Fix:** Require Firebase Auth token in the request header and verify it server-side. Add per-user rate limiting.

---

### ⚠️ HIGH: admin_notifications Collection Has `allow create: if true`

**File:** [firestore.rules](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/firestore.rules#L142) — Line 142

```
allow create: if true; // Allow bot or users to trigger notifications for admin
```

**Anyone** (even unauthenticated users) can create unlimited documents in `admin_notifications`. An attacker can:
- Spam your admin dashboard with thousands of fake notifications
- Exhaust your Firestore storage quota

---

### ⚠️ HIGH: complaints Collection Has `allow create: if true`

**File:** [firestore.rules](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/firestore.rules#L181) — Line 181

Same issue as above — unauthenticated spam of the complaints collection.

---

### ⚠️ MEDIUM: No Email Verification Before Allowing Orders

Phone-based and email-based signups create user docs with `role: "customer"` immediately. There's no email verification step, meaning bot-created accounts can immediately place COD orders.

---

## 🛠️ Priority Fix Order

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| 🔴 P0 | Add Razorpay server-side signature verification | Medium | Stops free-product fraud |
| 🔴 P0 | Block self-promotion via role field write | Low | Stops privilege escalation |
| 🔴 P0 | Rotate Gmail App Password & Gemini API Key | Low | Stops secret abuse |
| 🔴 P0 | Move price calculation to server (Cloud Function) | High | Stops price manipulation |
| 🔴 P1 | Replace hardcoded admin emails with Custom Claims | Medium | Proper access control |
| ⚠️ P1 | Add auth requirement to `admin_notifications` & `complaints` create rules | Low | Stops anonymous spam |
| ⚠️ P1 | Rate-limit the Gemini bot endpoint | Medium | Stops billing abuse |
| ⚠️ P1 | Restrict CORS on Cloud Functions | Low | Stops cross-origin abuse |
| ⚠️ P2 | Move system prompt server-side in Gemini bot | Low | Stops prompt injection |
| ⚠️ P2 | Add MapTiler domain restrictions | Low | Stops quota theft |
| ⚠️ P2 | Sanitize user-generated content in admin dashboard | Medium | Prevents stored XSS |
| ⚠️ P3 | Remove auth bypass timeouts | Low | Cleaner security boundaries |
| ⚠️ P3 | Strip debug logs for production | Low | Reduces info leakage |

---

> [!IMPORTANT]
> **The #1 thing to fix today**: Razorpay payment verification + the role self-promotion bug. Together, these let anyone get free products and become admin. Everything else is secondary until these two are patched.
