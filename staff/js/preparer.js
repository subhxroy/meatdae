// js/preparer.js
// Kitchen Preparer Dashboard — shows only PENDING orders to accept or cancel

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import {
    collection, doc, updateDoc, getDoc,
    onSnapshot, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

let isFirstLoad = true;
let prevPendingCount = 0;
let currentUser = null;
    
// --- Priority Helper ---
function getPriorityInfo(createdAt) {
    if (!createdAt) return { label: 'Standard', class: 'bg-primary', icon: 'fa-clock', mins: 0 };
    const now = new Date();
    const placedAt = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
    const diffMs = now - placedAt;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 15) {
        return { label: 'Standard', class: 'bg-primary', icon: 'fa-clock', mins: diffMins };
    } else if (diffMins < 30) {
        return { label: 'Medium', class: 'bg-warning text-dark', icon: 'fa-exclamation-circle', mins: diffMins };
    } else {
        return { label: 'High Priority', class: 'bg-danger', icon: 'fa-fire', mins: diffMins };
    }
}


// ============================================================
// INIT
// ============================================================

const initPreparer = async (user, userData) => {
    const authScreen = document.getElementById('auth-screen');
    const preparerContent = document.getElementById('preparer-content');

    // Role check
    const role = userData?.role;
    if (role !== 'preparer' && role !== 'admin') {
        if (authScreen) {
            authScreen.style.display = 'block';
            authScreen.innerHTML = `
                <div class="alert alert-danger mt-5 text-center mx-auto" style="max-width: 400px;">
                    <h5><i class="fas fa-ban me-2"></i>Access Denied</h5>
                    <p>Your account does not have preparer access.</p>
                    <a href="index.html" class="btn btn-outline-dark mt-2">Go Home</a>
                </div>`;
        }
        if (preparerContent) preparerContent.style.display = 'none';
        return;
    }

    // Show admin back link if applicable
    if (role === 'admin') {
        const adminLink = document.getElementById('admin-back-link');
        if (adminLink) adminLink.style.display = 'inline-block';
    }

    // Store user for actions
    currentUser = user;
    currentUser.role = role;

    // Layout loader handles showing content, but we ensure it here
    if (preparerContent) preparerContent.style.display = 'block';

    listenForPendingOrders();
    listenForPreparingOrders();
};

if (window.staffRecord) {
    initPreparer(window.staffRecord.user, window.staffRecord.userData);
} else {
    window.addEventListener('staffAuthReady', (e) => {
        initPreparer(e.detail.user, e.detail.userData);
    });
}


// ============================================================
// REAL-TIME LISTENERS
// ============================================================

function listenForPendingOrders() {
    const ordersRef = collection(db, "orders");
    // NOTE: Do NOT use orderBy("createdAt") — serverTimestamp() is null
    // on the client until the server confirms, which excludes new orders.
    const q = query(ordersRef);

    onSnapshot(q, (snapshot) => {
        // Filter both legacy and new pending statuses
        const pending = [];
        snapshot.forEach(d => {
            const o = { id: d.id, ...d.data() };
            if (o.status === 'PENDING_APPROVAL') {
                pending.push(o);
            }
        });

        // Sort oldest first for fairness (client-side)
        pending.sort((a, b) => {
            const getTime = (o) => {
                if (o.createdAt && typeof o.createdAt.toDate === 'function') return o.createdAt.toDate().getTime();
                if (o.createdAtLocal) return new Date(o.createdAtLocal).getTime();
                return 0;
            };
            return getTime(a) - getTime(b); // ascending — oldest first
        });

        const container = document.getElementById('pending-list');
        const countEl = document.getElementById('pending-count');
        const banner = document.getElementById('new-order-banner');

        countEl.textContent = pending.length;

        // Show/hide flashing alert banner
        if (!isFirstLoad && pending.length > prevPendingCount) {
            playBeep();
            banner.style.display = 'block';
            setTimeout(() => banner.style.display = 'none', 8000);
        }
        prevPendingCount = pending.length;
        isFirstLoad = false;

        if (pending.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-check-circle" style="color: #28a745;"></i>
                    <h4>All clear!</h4>
                    <p>No new orders waiting. New orders will appear here instantly.</p>
                </div>`;
            return;
        }

        container.innerHTML = pending.map(order => renderPendingCard(order)).join('');
    }, (error) => {
        console.error("Pending orders listener error:", error);
    });
}

function listenForPreparingOrders() {
    const ordersRef = collection(db, "orders");
    // IMPORTANT: Avoid composite-index requirement here.
    // We only need "all PREPARING" orders; sorting is optional.
    const q = query(ordersRef, where("status", "==", "PREPARING"));

    onSnapshot(q, (snapshot) => {
        const section = document.getElementById('preparing-section');
        const list = document.getElementById('preparing-list');

        if (snapshot.empty) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        list.innerHTML = '';

        snapshot.forEach(d => {
            const order = { id: d.id, ...d.data() };
            const card = document.createElement('div');
            card.className = `order-card ${(order.items || []).length > 1 ? 'has-multiple-items' : ''}`;
            card.style.borderLeftColor = '#6f42c1';
            card.style.opacity = '0.7';
            card.innerHTML = `
                <div class="order-header">
                    <div>
                        <span class="order-id">${order.orderId || order.id}</span>
                        <span class="order-time">${formatTime(order.createdAt)}</span>
                    </div>
                    <span class="badge ${order.isPrepared ? 'bg-success' : 'bg-secondary'} rounded-pill">
                        ${order.isPrepared ? 'Ready — Waiting for Rider' : 'Accepted — Preparing'}
                    </span>
                </div>
                <div class="detail-row">
                    <span class="detail-label"><i class="fas fa-user me-1"></i> Customer:</span>
                    <span class="detail-value">${order.customerName || order.deliveryInfo?.name || 'N/A'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label"><i class="fas fa-phone me-1"></i> Phone:</span>
                    <span class="detail-value"><a href="tel:${order.customerPhone || order.deliveryInfo?.phone}">${order.customerPhone || order.deliveryInfo?.phone || 'N/A'}</a></span>
                </div>
                <div class="detail-row" ${order.specialInstructions || order.deliveryInfo?.orderNotes ? '' : 'style="display:none;"'}>
                    <span class="detail-label"><i class="fas fa-sticky-note me-1"></i> Note:</span>
                    <span class="detail-value text-danger fw-bold">${order.specialInstructions || order.deliveryInfo?.orderNotes || ''}</span>
                </div>
                <div class="items-box ${(order.items || []).length > 1 ? 'multiple-items' : ''}">
                    ${(order.items || []).length > 1 ? `<div class="multiple-badge"><i class="fas fa-exclamation-triangle"></i> Multiple Items (${order.items.length})</div>` : ''}
                    ${(order.items || []).map(item =>
                        `<div class="item-row">🥩 ${item.name} (${item.weight || 'Std'}) &times; ${item.quantity}</div>`
                    ).join('') || '<em>No items</em>'}
                </div>
                <div class="mt-2">
                    ${order.isPrepared ? `
                        <span class="badge bg-success rounded-pill">Ready — Waiting for Rider</span>
                    ` : `
                        <button class="btn btn-sm btn-success btn-done" onclick="window.prepDone('${order.id}')">
                            <i class="fas fa-check me-1"></i> Mark Prepared
                        </button>
                    `}
                </div>
            `;
            list.appendChild(card);
        });
    }, (error) => {
        console.error("Preparing orders listener error:", error);
        const section = document.getElementById('preparing-section');
        const list = document.getElementById('preparing-list');
        if (section) section.style.display = 'block';
        if (list) {
            list.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    Failed to load preparing orders: ${error.message}
                </div>
            `;
        }
    });
}


// ============================================================
// RENDER PENDING ORDER CARD
// ============================================================

function renderPendingCard(order) {
    const itemsHtml = (order.items || []).map(item =>
        `<div class="item-row">🥩 <strong>${item.name}</strong> (${item.weight || 'Std'}) &times; ${item.quantity}</div>`
    ).join('') || '<em>No items found</em>';

    const paymentClass = (order.paymentMethod || '').toLowerCase().includes('cod') ? 'payment-cod' : 'payment-online';
    const paymentLabel = (order.paymentMethod || '').toLowerCase().includes('cod') ? 'COD' : 'Online — Paid';

    return `
    <div class="order-card new-pulse ${(order.items || []).length > 1 ? 'has-multiple-items' : ''}" id="card-${order.id}">
        <div class="order-header">
            <div>
                <span class="order-id">${order.orderId || order.id}</span>
                <span class="order-time">${formatTime(order.createdAt)}</span>
            </div>
            <div class="d-flex align-items-center gap-2">
                <span class="badge ${getPriorityInfo(order.createdAt).class}" style="font-size: 11px;">
                    <i class="fas ${getPriorityInfo(order.createdAt).icon} me-1"></i>
                    ${getPriorityInfo(order.createdAt).label}
                </span>
                <span class="badge rounded-pill" style="background:#fff3cd; color:#856404; font-size:13px; padding:6px 12px;">
                    <i class="fas fa-clock me-1"></i> New Order
                </span>
            </div>
        </div>

        <div class="detail-row">
            <span class="detail-label"><i class="fas fa-user me-1"></i> Customer:</span>
            <span class="detail-value"><strong>${order.customerName || order.deliveryInfo?.name || 'N/A'}</strong></span>
        </div>
        <div class="detail-row">
            <span class="detail-label"><i class="fas fa-phone me-1"></i> Phone:</span>
            <span class="detail-value">
                <a href="tel:${order.customerPhone || order.deliveryInfo?.phone}" style="color:#0d6efd; font-weight:600;">
                    ${order.customerPhone || order.deliveryInfo?.phone || 'N/A'}
                </a>
            </span>
        </div>
        <div class="detail-row">
            <span class="detail-label"><i class="fas fa-map-pin me-1"></i> Address:</span>
            <span class="detail-value">${order.deliveryInfo?.address || 'N/A'}, ${order.deliveryInfo?.pincode || ''}</span>
        </div>
        <div class="detail-row" ${order.specialInstructions || order.deliveryInfo?.orderNotes ? '' : 'style="display:none;"'}>
            <span class="detail-label"><i class="fas fa-sticky-note me-1"></i> Note:</span>
            <span class="detail-value text-danger fw-bold">${order.specialInstructions || order.deliveryInfo?.orderNotes || ''}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label"><i class="fas fa-credit-card me-1"></i> Payment:</span>
            <span class="detail-value"><span class="payment-badge ${paymentClass}">${paymentLabel}</span></span>
        </div>

        <div class="items-box ${(order.items || []).length > 1 ? 'multiple-items' : ''}">
            ${(order.items || []).length > 1 ? `<div class="multiple-badge"><i class="fas fa-exclamation-triangle"></i> Multiple Items (${order.items.length})</div>` : ''}
            ${itemsHtml}
        </div>

        <div class="order-total">
            Total: ₹${(order.totalAmount || 0).toFixed(2)}
        </div>

        <div class="action-row">
            <button class="btn-accept" onclick="window.prepAccept('${order.id}')">
                <i class="fas fa-check"></i> Accept — Start Preparing
            </button>
            <button class="btn-cancel" onclick="window.prepCancel('${order.id}', '${(order.orderId || order.id).replace(/'/g, "\\'")}')">
                <i class="fas fa-times"></i> Cancel
            </button>
        </div>
    </div>`;
}


// ============================================================
// ORDER ACTIONS
// ============================================================

window.prepAccept = async (orderId) => {
    const cardEl = document.getElementById(`card-${orderId}`);
    const btn = cardEl ? cardEl.querySelector(`.btn-accept`) : null;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Accepting...'; }

    try {
        await updateDoc(doc(db, "orders", orderId), {
            status: "PREPARING",
            acceptedAt: new Date(),
            acceptedBy: currentUser.role || "preparer",
            preparerId: currentUser.uid || null,
            isPrepared: false
        });
        console.log(`Order ${orderId} accepted → PREPARING`);
    } catch (error) {
        console.error("Error accepting order:", error);
        alert("Failed to accept order: " + error.message);
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Accept — Start Preparing'; }
    }
};

/**
 * Mark an order as prepared (ready for rider pickup) without changing main status.
 */
window.prepDone = async (orderId) => {
    const cardEl = document.getElementById(`card-${orderId}`);
    const btn = cardEl ? cardEl.querySelector(`.btn-done`) : null;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...'; }

    try {
        await updateDoc(doc(db, "orders", orderId), {
            isPrepared: true,
            preparedAt: new Date(),
            preparedBy: "preparer",
            preparerId: currentUser?.uid || null
        });
        console.log(`Order ${orderId} marked as prepared.`);
    } catch (error) {
        console.error("Error marking prepared:", error);
        alert("Failed to mark prepared: " + error.message);
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Mark Prepared'; }
    }
};

window.prepCancel = async (orderId, displayId) => {
    if (!confirm(`Cancel order ${displayId}?\n\nThis cannot be undone.`)) return;

    const cardEl = document.getElementById(`card-${orderId}`);
    const btn = cardEl ? cardEl.querySelector(`.btn-cancel`) : null;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelling...'; }

    try {
        const updateData = {
            status: "CANCELLED",
            cancelledAt: new Date(),
            cancelledBy: currentUser.role || "preparer"
        };
        await updateDoc(doc(db, "orders", orderId), updateData);
        console.log(`Order ${orderId} cancelled.`);
    } catch (error) {
        console.error("Error cancelling order:", error);
        alert("Failed to cancel: " + error.message);
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-times"></i> Cancel'; }
    }
};


// ============================================================
// UTILITIES
// ============================================================

function formatTime(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
}

function playBeep() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        // Two-tone alert (high-low)
        [880, 660].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.25);
            gain.gain.setValueAtTime(0.4, ctx.currentTime + i * 0.25);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.25 + 0.3);
            osc.start(ctx.currentTime + i * 0.25);
            osc.stop(ctx.currentTime + i * 0.25 + 0.3);
        });
    } catch (e) { /* ignore */ }
}
