// Review Popup Module
// Shows a Swiggy-like review popup ONLY after a DELIVERED order.
// Rules:
//  - Shows up to 3 times per order if the user skips (tracks via localStorage).
//  - Once the user submits a review, it NEVER shows again for that order.
//  - After a NEW delivered order comes in, the cycle resets.
//  - Sends review data to admin via Firebase Function (email).

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import {
    collection, query, where, getDocs, addDoc, doc, updateDoc, serverTimestamp, orderBy, limit
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

const MAX_SKIP_COUNT = 1; // Show at most 3 times per order before giving up
const POPUP_DELAY_MS = 2500; // Delay before showing popup after page load

const RATING_LABELS = ['', '😞 Bad', '😐 Below Average', '🙂 Good', '😊 Very Good', '🤩 Excellent!'];

// ── Storage helpers ──────────────────────────────────────────────────────────

function getReviewState(orderId) {
    try {
        const all = JSON.parse(localStorage.getItem('meatdae_reviews') || '{}');
        return all[orderId] || { reviewed: false, skipCount: 0 };
    } catch { return { reviewed: false, skipCount: 0 }; }
}

function setReviewState(orderId, state) {
    try {
        const all = JSON.parse(localStorage.getItem('meatdae_reviews') || '{}');
        all[orderId] = state;
        localStorage.setItem('meatdae_reviews', JSON.stringify(all));
    } catch { /* ignore */ }
}

// ── Find the most recent DELIVERED order that still needs a review ────────────

async function findPendingReviewOrder(userId) {
    try {
        console.log("[ReviewPopup] Checking newest delivered order for review...");
        const ordersRef = collection(db, "orders");
        // Get the single LATEST DELIVERED order for the user
        const q = query(
            ordersRef,
            where("userId", "==", userId),
            where("status", "==", "DELIVERED"),
            orderBy("createdAt", "desc"),
            limit(1)
        );

        const snap = await getDocs(q);
        if (snap.empty) return null;

        const docSnap = snap.docs[0];
        const data = docSnap.data();
        const orderId = docSnap.id;
        const state = getReviewState(orderId);

        // If the absolute latest delivered order is already reviewed or skipped, don't show anything
        if (state.reviewed || data.reviewed === true || state.skipCount >= MAX_SKIP_COUNT) {
            console.log("[ReviewPopup] Latest order already reviewed or skip-limited:", orderId);
            return null;
        }

        return { id: orderId, ...data };
    } catch (err) {
        console.error("[ReviewPopup] findPendingReviewOrder Error:", err);
        return null;
    }
}

// ── Build popup HTML ─────────────────────────────────────────────────────────

function buildPopup(order) {
    const orderNum = order?.orderId ? `#${order.orderId}` : "your recent order";

    const overlay = document.createElement('div');
    overlay.className = 'review-overlay';
    overlay.id = 'review-popup-overlay';
    overlay.innerHTML = `
        <div class="review-card">
            <div class="review-banner">
                <button class="review-close" onclick="window._closeReviewPopup()">&times;</button>
                <div class="review-banner-icon"><i class="fas fa-utensils"></i></div>
                <h3>How was ${orderNum}?</h3>
                <p>Order ${orderNum} • Delivered</p>
            </div>
            <div class="review-body" id="review-body-form">
                <div class="review-stars" id="review-stars">
                    <span class="review-star" data-value="1"><i class="fas fa-star"></i></span>
                    <span class="review-star" data-value="2"><i class="fas fa-star"></i></span>
                    <span class="review-star" data-value="3"><i class="fas fa-star"></i></span>
                    <span class="review-star" data-value="4"><i class="fas fa-star"></i></span>
                    <span class="review-star" data-value="5"><i class="fas fa-star"></i></span>
                </div>
                <div class="review-rating-label" id="review-rating-label">Tap a star to rate</div>
                <textarea class="review-textarea" id="review-text" placeholder="Tell us about the quality, delivery, etc... (optional)" maxlength="500"></textarea>
                <button class="review-submit-btn" id="review-submit-btn" disabled>Submit Review</button>
                <button class="review-skip-btn" onclick="window._closeReviewPopup()">Maybe Later</button>
            </div>
            <div class="review-thankyou" id="review-thankyou" style="display:none;">
                <div class="review-thankyou-icon"><i class="fas fa-check"></i></div>
                <h3>Submitted! 🎉</h3>
                <p>Thanks for helping us grow!</p>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
}

// ── Star listener setup ──────────────────────────────────────────────────────

let selectedRating = 0;

function setupStars() {
    const stars = document.querySelectorAll('#review-stars .review-star');
    const label = document.getElementById('review-rating-label');
    const btn = document.getElementById('review-submit-btn');

    stars.forEach(star => {
        // Click
        star.addEventListener('click', () => {
            selectedRating = parseInt(star.dataset.value);
            stars.forEach(s => s.classList.toggle('active', parseInt(s.dataset.value) <= selectedRating));
            label.textContent = RATING_LABELS[selectedRating] || '';
            label.classList.add('rated');
            btn.disabled = false;
        });
        // Hover in
        star.addEventListener('mouseenter', () => {
            const hv = parseInt(star.dataset.value);
            stars.forEach(s => {
                const sv = parseInt(s.dataset.value);
                s.style.color = sv <= hv ? '#ffb300' : '#e0e0e0';
                s.style.transform = sv <= hv ? 'scale(1.1)' : 'scale(1)';
            });
        });
        // Hover out
        star.addEventListener('mouseleave', () => {
            stars.forEach(s => {
                s.style.color = s.classList.contains('active') ? '#ffb300' : '#e0e0e0';
                s.style.transform = 'scale(1)';
            });
        });
    });

    btn.addEventListener('click', submitReview);
}

// ── Submit review ────────────────────────────────────────────────────────────

let _currentOrderId = null;
let _currentOrderData = null;

async function submitReview() {
    const btn = document.getElementById('review-submit-btn');
    const comment = (document.getElementById('review-text')?.value || '').trim();
    const user = auth.currentUser;

    if (!user || selectedRating === 0) {
        console.warn("[ReviewPopup] Cannot submit: Not logged in or no rating selected.");
        return;
    }

    console.log("[ReviewPopup] Submitting review for order:", _currentOrderId);
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';

    try {
        const orderNum = _currentOrderData?.orderId || "N/A";
        const customerName = _currentOrderData?.customerName || user.displayName || "Customer";
        const customerEmail = _currentOrderData?.customerEmail || user.email || "";

        // 1. Save review to Firestore for records
        await addDoc(collection(db, "reviews"), {
            userId: user.uid,
            orderDocId: _currentOrderId,
            orderNumber: orderNum,
            customerName,
            customerEmail,
            rating: selectedRating,
            comment,
            createdAt: serverTimestamp()
        });

        // 2. Mark order as reviewed in Firestore (optional based on permissions)
        try {
            await updateDoc(doc(db, "orders", _currentOrderId), { reviewed: true });
        } catch (e) { console.warn("[ReviewPopup] Could not update order doc:", e); }

        // 3. Mark in localStorage locally
        setReviewState(_currentOrderId, { reviewed: true, skipCount: MAX_SKIP_COUNT });

        // 4. Trigger the Admin Email by writing to dedicated collection
        try {
            await sendReviewEmailToAdmin({
                orderId: orderNum,
                orderDocId: _currentOrderId,
                userId: user.uid,
                customerName,
                customerEmail,
                rating: selectedRating,
                comment,
                customerPhone: _currentOrderData?.customerPhone || "N/A"
            });
        } catch (emailErr) {
            console.error("[ReviewPopup] Email record creation failed:", emailErr);
        }

        // 5. Success state
        document.getElementById('review-body-form').style.display = 'none';
        document.getElementById('review-thankyou').style.display = 'block';
        setTimeout(() => window._closeReviewPopup(), 2500);

    } catch (err) {
        console.error("[ReviewPopup] General submission error:", err);
        btn.disabled = false;
        btn.innerHTML = 'Submit Review';
        alert("Sorry, we couldn't save your review. Please try again.");
    }
}

// ── Send review email to admin via Firestore Trigger ─────────────────────────

async function sendReviewEmailToAdmin(data) {
    console.log("[ReviewPopup] Creating email record for admin...");
    await addDoc(collection(db, "reviewEmails"), {
        ...data,
        createdAt: serverTimestamp(),
        adminEmail: "contact.meatdae@gmail.com"
    });
}

// ── Skip handler ─────────────────────────────────────────────────────────────

window._closeReviewPopup = function () {
    const overlay = document.getElementById('review-popup-overlay');
    if (!overlay) return;
    overlay.classList.remove('active');

    // Increment skip count
    if (_currentOrderId) {
        const state = getReviewState(_currentOrderId);
        if (!state.reviewed) {
            setReviewState(_currentOrderId, {
                reviewed: false,
                skipCount: (state.skipCount || 0) + 1
            });
        }
    }
    // Remove after animation
    setTimeout(() => { try { overlay.remove(); } catch { } }, 400);
};

// ── Entry point ──────────────────────────────────────────────────────────────

async function checkAndShowReviewPopup(user) {
    const order = await findPendingReviewOrder(user.uid);
    if (!order) return;

    _currentOrderId = order.id;
    _currentOrderData = order;
    selectedRating = 0;

    setTimeout(() => {
        const overlay = buildPopup(order);
        setupStars();
        // Force reflow for animation
        requestAnimationFrame(() => overlay.classList.add('active'));
    }, POPUP_DELAY_MS);
}

document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, user => {
        if (user) checkAndShowReviewPopup(user);
    });
});
