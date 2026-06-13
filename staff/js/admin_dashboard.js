// js/admin_dashboard.js
// Real-time order management dashboard with rider role management

import { app, auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import {
    collection, doc, getDoc, getDocs, updateDoc,
    onSnapshot, query, orderBy, where, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

// --- Firebase Init ---
// Using shared auth instance from firebase-config.js

// --- State ---
let allOrders = [];
let currentFilter = "ALL";
let previousOrderCount = 0;
let isFirstLoad = true;

document.addEventListener('DOMContentLoaded', () => {
    // Filter tab click handlers
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            renderOrders();
        });
    });

    // Rider search handler
    const searchBtn = document.getElementById('search-user-btn');
    if (searchBtn) searchBtn.addEventListener('click', () => searchUserByEmail('rider'));

    const searchInput = document.getElementById('user-search-email');
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchUserByEmail('rider');
        });
    }

    // Preparer search handler (uses its own unique IDs)
    const preparerSearchBtn = document.getElementById('preparer-search-btn');
    if (preparerSearchBtn) preparerSearchBtn.addEventListener('click', () => searchUserByEmail('preparer'));

    const preparerSearchInput = document.getElementById('preparer-search-email');
    if (preparerSearchInput) {
        preparerSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchUserByEmail('preparer');
        });
    }

    // Bulk deliver handler
    const markAllDeliveredBtn = document.getElementById('btn-mark-all-delivered');
    if (markAllDeliveredBtn) {
        markAllDeliveredBtn.addEventListener('click', markAllFilteredAsDelivered);
    }

    // Ledger tab activation listener

    // Ledger tab activation listener
    const ledgerTabEl = document.getElementById('ledger-tab');
    if (ledgerTabEl) {
        ledgerTabEl.addEventListener('shown.bs.tab', () => {
            const now = new Date();
            const yearSelect = document.getElementById('ledger-year');
            const monthSelect = document.getElementById('ledger-month');

            // Set current month if first time opening
            if (monthSelect.value === 'ALL') {
                monthSelect.value = now.getMonth();
            }

            applyLedgerFilters();
        });
    }

    // Staff tab activation
    const staffTabEl = document.getElementById('staff-tab');
    if (staffTabEl) {
        staffTabEl.addEventListener('shown.bs.tab', () => {
            if (typeof loadAllStaff === 'function') loadAllStaff();
        });
    }

    // Riders tab activation
    const ridersTabEl = document.getElementById('riders-tab');
    if (ridersTabEl) {
        ridersTabEl.addEventListener('shown.bs.tab', () => {
            if (typeof loadRiders === 'function') loadRiders();
        });
    }

    // Preparers tab activation
    const preparersTabEl = document.getElementById('preparers-tab');
    if (preparersTabEl) {
        preparersTabEl.addEventListener('shown.bs.tab', () => {
            if (typeof loadPreparers === 'function') loadPreparers();
        });
    }

    // Default performance dates to today
    const todayStr = new Date().toISOString().split('T')[0];
    const riderPerfDate = document.getElementById('rider-performance-date');
    if (riderPerfDate) riderPerfDate.value = todayStr;
    const prepPerfDate = document.getElementById('preparer-performance-date');
    if (prepPerfDate) prepPerfDate.value = todayStr;

    // Load initial staff list
    if (typeof loadAllStaff === 'function') loadAllStaff();

    // Complaints tab activation
    const complaintsTabEl = document.getElementById('complaints-tab');
    if (complaintsTabEl) {
        complaintsTabEl.addEventListener('shown.bs.tab', () => {
            if (typeof loadComplaints === 'function') loadComplaints();
        });
    }
});

// --- Auth Initialization ---
const initAdmin = (user, userData) => {
    if (userData && userData.role === 'admin') {
        startOrderListener();
        loadRiders();
        loadPreparers();
        loadComplaints(); // Start listening for complaints
    } else {
        console.warn("Non-admin accessed admin script.");
    }
};

if (window.staffRecord) {
    initAdmin(window.staffRecord.user, window.staffRecord.userData);
} else {
    window.addEventListener('staffAuthReady', (e) => {
        initAdmin(e.detail.user, e.detail.userData);
    });
}


// ============================================================
// SECTION 1: REAL-TIME ORDER MANAGEMENT
// ============================================================

/**
 * Start a real-time listener on the orders collection.
 * Orders are sorted by creation date descending (newest first).
 */
function startOrderListener() {
    const ordersRef = collection(db, "orders");
    // NOTE: Do NOT use orderBy("createdAt") in the query.
    // serverTimestamp() is initially null on the client until the server confirms
    // the write. Documents with a pending timestamp are EXCLUDED from orderBy
    // queries, causing newly placed orders to be invisible until the timestamp
    // resolves. Instead, we fetch ALL documents and sort client-side.
    const q = query(ordersRef);

    onSnapshot(q, (snapshot) => {
        allOrders = [];
        snapshot.forEach(doc => {
            allOrders.push({ id: doc.id, ...doc.data() });
        });

        // Client-side sort: newest first.
        // Use createdAt (Firestore Timestamp) when available, fall back to
        // createdAtLocal (ISO string written at order time), then epoch 0.
        allOrders.sort((a, b) => {
            const getTime = (o) => {
                if (o.createdAt && typeof o.createdAt.toDate === 'function') {
                    return o.createdAt.toDate().getTime();
                }
                if (o.createdAtLocal) {
                    return new Date(o.createdAtLocal).getTime();
                }
                return 0;
            };
            return getTime(b) - getTime(a); // descending
        });

        updateStats();
        renderOrders();
        updateProductDropdown();

        // Refresh specific panes ONLY if they are currently visible to save performance
        const ridersPane = document.getElementById('riders-pane');
        const preparersPane = document.getElementById('preparers-pane');
        const ledgerPane = document.getElementById('ledger-pane');

        if (ridersPane && ridersPane.classList.contains('show')) {
            if (typeof loadRiders === 'function') loadRiders();
        }
        if (preparersPane && preparersPane.classList.contains('show')) {
            if (typeof loadPreparers === 'function') loadPreparers();
        }
        if (ledgerPane && ledgerPane.classList.contains('show')) {
            if (typeof applyLedgerFilters === 'function') applyLedgerFilters();
        }

        // Play notification sound for new orders (skip first load)
        if (!isFirstLoad && allOrders.length > previousOrderCount) {
            playNotificationSound();
        }
        previousOrderCount = allOrders.length;
        isFirstLoad = false;
    }, (error) => {
        console.error("Order listener error:", error);
        document.getElementById('orders-list').innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-triangle me-2"></i>
                Error loading orders: ${error.message}
            </div>`;
    });
}

/**
 * Update the statistics cards at the top of the dashboard.
 */
function updateStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let pending = 0;
    let preparing = 0;
    let prepared = 0;
    let delivery = 0;
    let delivered = 0;

    allOrders.forEach(o => {
        const status = (o.status || "").toUpperCase();
        
        if (status === 'PENDING_APPROVAL' || status === 'PENDING') {
            pending++;
        } else if (status === 'PREPARING') {
            if (o.isPrepared) prepared++;
            else preparing++;
        } else if (status === 'OUT_FOR_DELIVERY') {
            delivery++;
        } else if (status === 'DELIVERED') {
            const orderDate = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
            if (orderDate >= today) delivered++;
        }
    });

    document.getElementById('stat-pending').textContent = pending;
    document.getElementById('stat-preparing').textContent = preparing;
    document.getElementById('stat-prepared').textContent = prepared;
    document.getElementById('stat-delivery').textContent = delivery;
    document.getElementById('stat-delivered').textContent = delivered;
}

/**
 * Render the orders list based on the current filter.
 */
function renderOrders() {
    const container = document.getElementById('orders-list');
    const markAllBtn = document.getElementById('btn-mark-all-delivered');
    let filtered = allOrders;

    if (currentFilter !== "ALL") {
        filtered = allOrders.filter(o => {
            if (currentFilter === 'PENDING_APPROVAL') return o.status === 'PENDING_APPROVAL' || o.status === 'Pending';
            if (currentFilter === 'PREPARING') return (o.status === 'PREPARING' || o.status === 'Preparing') && !o.isPrepared;
            if (currentFilter === 'PREPARED') return (o.status === 'PREPARING' || o.status === 'Preparing') && o.isPrepared;
            if (currentFilter === 'OUT_FOR_DELIVERY') return o.status === 'OUT_FOR_DELIVERY' || o.status === 'Out for Delivery';
            if (currentFilter === 'DELIVERED') return o.status === 'DELIVERED' || o.status === 'Delivered';
            if (currentFilter === 'CANCELLED') return o.status === 'CANCELLED' || o.status === 'Cancelled';
            return o.status === currentFilter;
        });
    }

    // Show or hide bulk action button depending on filter
    if (markAllBtn) {
        const eligibleStatuses = new Set(['PENDING_APPROVAL', 'PREPARING', 'PREPARED', 'OUT_FOR_DELIVERY']);
        if (!eligibleStatuses.has(currentFilter)) {
            markAllBtn.classList.add('d-none');
        } else {
            const matchingCount = allOrders.filter(o => {
                if (currentFilter === 'PENDING_APPROVAL') return o.status === 'PENDING_APPROVAL' || o.status === 'Pending';
                if (currentFilter === 'PREPARING') return (o.status === 'PREPARING' || o.status === 'Preparing') && !o.isPrepared;
                if (currentFilter === 'PREPARED') return (o.status === 'PREPARING' || o.status === 'Preparing') && o.isPrepared;
                if (currentFilter === 'OUT_FOR_DELIVERY') return o.status === 'OUT_FOR_DELIVERY' || o.status === 'Out for Delivery';
                return false;
            }).length;

            if (matchingCount > 0) {
                markAllBtn.classList.remove('d-none');
                const label = currentFilter === 'PENDING_APPROVAL'
                    ? `Mark All ${matchingCount} Pending as Delivered`
                    : currentFilter === 'PREPARING'
                        ? `Mark All ${matchingCount} Preparing as Delivered`
                        : currentFilter === 'PREPARED'
                            ? `Mark All ${matchingCount} Prepared as Delivered`
                            : `Mark All ${matchingCount} Out-for-Delivery as Delivered`;
                markAllBtn.innerHTML = `<i class="fas fa-check-double me-1"></i> ${label}`;
            } else {
                markAllBtn.classList.add('d-none');
            }
        }
    }

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>No ${currentFilter === 'ALL' ? '' : currentFilter.toLowerCase().replace(/_/g, ' ')} orders found.</p>
            </div>`;
        return;
    }

    container.innerHTML = filtered.map(order => renderOrderCard(order)).join('');
}

/**
 * Render a single order card HTML string.
 */
function renderOrderCard(order) {
    const statusLabel = formatStatus(order.status, order.isPrepared);
    const createdAt = order.createdAt?.toDate
        ? order.createdAt.toDate().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        : order.createdAtLocal
            ? new Date(order.createdAtLocal).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
            : 'N/A';

    // Build items display
    let itemsHtml = '';
    if (order.items && order.items.length > 0) {
        itemsHtml = order.items.map(item =>
            `<div>${item.name} (${item.weight || 'Std'}) × ${item.quantity} — ₹${(item.price * item.quantity).toFixed(2)}</div>`
        ).join('');
    }

    // Action buttons based on current status
    let actionsHtml = '';
    let extraActions = '';

    if (order.status === 'PENDING_APPROVAL' || order.status === 'Pending') {
        actionsHtml = `
            <button class="btn-accept" onclick="window.acceptOrder('${order.id}')">
                <i class="fas fa-check me-1"></i> Accept Order
            </button>`;
    } else if (order.status === 'PREPARING' || order.status === 'Preparing') {
        if (order.isPrepared) {
            actionsHtml = `<span class="text-info"><i class="fas fa-check-circle me-1"></i> Ready — waiting for rider</span>`;
        } else {
            actionsHtml = `
                <button class="btn-accept" style="background: var(--preparing);" onclick="window.adminMarkPrepared('${order.id}')">
                    <i class="fas fa-check me-1"></i> Mark Prepared
                </button>
                <div class="mt-2 text-muted small"><i class="fas fa-clock me-1"></i> Kitchen is preparing...</div>
            `;
        }
    } else if (order.status === 'OUT_FOR_DELIVERY' || order.status === 'Out for Delivery') {
        const eta = order.estimatedArrivalTime
            ? `<br><small class="text-muted"><i class="fas fa-clock me-1"></i> ETA: <strong>${order.estimatedArrivalTime}</strong></small>`
            : '';
        actionsHtml = `
            <div class="d-flex flex-column gap-2 flex-grow-1">
                <span class="text-info mb-1"><i class="fas fa-motorcycle me-1"></i> Rider is delivering${eta}</span>
                <a href="order_track.html?orderId=${encodeURIComponent(order.id)}" class="btn btn-sm btn-outline-primary rounded-pill w-100 py-2">
                    <i class="fas fa-map-marker-alt me-2"></i> Track Live Location
                </a>
            </div>`;
    }

    // Cancel Button in every state (except terminal ones)
    if (order.status !== 'DELIVERED' && order.status !== 'CANCELLED' && order.status !== 'Delivered' && order.status !== 'Cancelled') {
        extraActions = `
            <button class="btn-cancel-order btn btn-outline-danger btn-sm" onclick="window.cancelOrder('${order.id}', '${(order.customerName || '').replace(/'/g, "\\'")}', ${order.totalAmount || 0}, '${order.orderId || order.id}')">
                <i class="fas fa-times me-1"></i> Cancel
            </button>`;
    }

    const finalActions = `
        <div class="d-flex align-items-center gap-2 flex-wrap w-100">
            <div class="flex-grow-1">${actionsHtml}</div>
            <div>${extraActions}</div>
        </div>
    `;

    return `
        <div class="order-card ${(order.status === 'PENDING_APPROVAL' || order.status === 'Pending') ? 'new-order-pulse' : ''} ${(order.items || []).length > 1 ? 'has-multiple-items' : ''}">
            <div class="order-header">
                <div>
                    <span class="order-id">${order.orderId || order.id}</span>
                    <small class="text-muted ms-2">${createdAt}</small>
                </div>
                <span class="status-badge status-${order.status}">${statusLabel}</span>
            </div>
            <div class="order-details">
                <div class="detail-row">
                    <span class="detail-label"><i class="fas fa-user me-1"></i> Customer:</span>
                    <span class="detail-value">${order.customerName || order.deliveryInfo?.name || 'N/A'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label"><i class="fas fa-phone me-1"></i> Phone:</span>
                    <span class="detail-value">${order.customerPhone || order.deliveryInfo?.phone || 'N/A'}</span>
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
                    <span class="detail-value">${order.paymentMethod || 'N/A'} (${order.paymentStatus || 'N/A'})</span>
                </div>
                <div class="order-items-list ${(order.items || []).length > 1 ? 'multiple-items' : ''}">
                    ${(order.items || []).length > 1 ? `<div class="multiple-badge-admin"><i class="fas fa-exclamation-triangle me-1"></i> MULTIPLE ITEMS (${order.items.length})</div>` : ''}
                    ${itemsHtml || '<em>No items</em>'}
                </div>
                ${order.onlineFee > 0 ? `
                <div class="detail-row" style="font-size: 12px; margin-bottom: 2px; opacity: 0.8;">
                    <span class="detail-label"><i class="fas fa-plus-circle me-1"></i> Online Fee:</span>
                    <span class="detail-value">₹${order.onlineFee.toFixed(2)}</span>
                </div>` : ''}
                <div class="detail-row">
                    <span class="detail-label"><i class="fas fa-rupee-sign me-1"></i> Total:</span>
                    <span class="detail-value fw-bold" style="font-size: 16px; color: var(--primary);">₹${(order.totalAmount || 0).toFixed(2)}</span>
                </div>
            </div>
            <div class="order-actions">${finalActions}</div>
        </div>`;
}

/**
 * Admin marks an order as prepared (ready for rider pickup).
 * Keeps status PREPARING; sets isPrepared + preparedAt.
 */
window.adminMarkPrepared = async (orderId) => {
    if (!confirm(`Mark order ${orderId} as PREPARED (ready for rider)?`)) return;
    try {
        await updateDoc(doc(db, "orders", orderId), {
            isPrepared: true,
            preparedAt: new Date(),
            preparedBy: "admin"
        });
        console.log(`Order ${orderId} marked prepared by admin.`);
    } catch (error) {
        console.error("Error marking prepared:", error);
        alert("Failed to mark prepared: " + error.message);
    }
};

/**
 * Format a status string for display.
 */
function formatStatus(status, isPrepared = false) {
    if (status === 'PREPARING' && isPrepared) return 'Ready — Waiting for Rider';
    const map = {
        'PENDING_APPROVAL': 'Pending',
        'PREPARING': 'Preparing',
        'OUT_FOR_DELIVERY': 'Out for Delivery',
        'DELIVERED': 'Delivered',
        'CANCELLED': 'Cancelled',
        'Pending': 'Pending',
        'Preparing': 'Preparing',
        'Out for Delivery': 'Out for Delivery',
        'Delivered': 'Delivered',
        'Cancelled': 'Cancelled'
    };
    return map[status] || status;
}


// ============================================================
// SECTION 2: ORDER ACTIONS (Accept / Cancel)
// ============================================================

/**
 * Accept an order — transition from PENDING_APPROVAL → PREPARING.
 */
window.acceptOrder = async (orderId) => {
    if (!confirm(`Accept order ${orderId}?`)) return;

    try {
        await updateDoc(doc(db, "orders", orderId), {
            status: "PREPARING",
            acceptedAt: new Date(),
            acceptedBy: "admin",
            isPrepared: false
        });
        console.log(`Order ${orderId} accepted → PREPARING`);
    } catch (error) {
        console.error("Error accepting order:", error);
        alert("Failed to accept order: " + error.message);
    }
};

/**
 * Cancel an order — transition to CANCELLED and send refund notification email.
 */
window.cancelOrder = async (orderId, customerName, totalAmount, displayOrderId) => {
    if (!confirm(`Are you sure you want to CANCEL order ${displayOrderId}?\n\nThis will notify the customer and send a refund alert email.`)) return;

    try {
        // Fetch full order details for detailed emails
        let orderData = null;
        try {
            const orderSnap = await getDoc(doc(db, "orders", orderId));
            if (orderSnap.exists()) orderData = { id: orderSnap.id, ...orderSnap.data() };
        } catch (e) {
            console.warn("Could not fetch order details for cancellation email:", e);
        }

        // 1. Update Firestore status
        await updateDoc(doc(db, "orders", orderId), {
            status: "CANCELLED",
            cancelledAt: new Date(),
            cancelledBy: "admin"
        });
        console.log(`Order ${orderId} cancelled.`);



    } catch (error) {
        console.error("Error cancelling order:", error);
        alert("Failed to cancel order: " + error.message);
    }
};

/**
 * Bulk updates all "Pending" and "PENDING_APPROVAL" orders to "DELIVERED".
 * Useful for clearing out old legacy orders.
 */
async function markAllFilteredAsDelivered() {
    const btn = document.getElementById('btn-mark-all-delivered');
    if (!btn) return;

    let toUpdate = [];
    let label = '';

    if (currentFilter === 'PENDING_APPROVAL') {
        toUpdate = allOrders.filter(o => o.status === 'PENDING_APPROVAL' || o.status === 'Pending');
        label = 'pending';
    } else if (currentFilter === 'PREPARING') {
        toUpdate = allOrders.filter(o => (o.status === 'PREPARING' || o.status === 'Preparing') && !o.isPrepared);
        label = 'preparing';
    } else if (currentFilter === 'PREPARED') {
        toUpdate = allOrders.filter(o => (o.status === 'PREPARING' || o.status === 'Preparing') && o.isPrepared);
        label = 'prepared';
    } else if (currentFilter === 'OUT_FOR_DELIVERY') {
        toUpdate = allOrders.filter(o => o.status === 'OUT_FOR_DELIVERY' || o.status === 'Out for Delivery');
        label = 'out-for-delivery';
    } else {
        return;
    }

    if (toUpdate.length === 0) return;

    if (!confirm(`Are you sure you want to mark ALL ${toUpdate.length} ${label} orders as DELIVERED?\nThis cannot be undone.`)) {
        return;
    }

    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin me-1"></i> Updating ${toUpdate.length}...`;
    btn.disabled = true;

    try {
        const chunkSize = 400;
        for (let i = 0; i < toUpdate.length; i += chunkSize) {
            const chunk = toUpdate.slice(i, i + chunkSize);
            const batch = writeBatch(db);

            chunk.forEach(order => {
                const orderRef = doc(db, "orders", order.id);
                batch.update(orderRef, {
                    status: 'DELIVERED',
                    deliveredAt: new Date(),
                    deliveredBy: `admin_bulk_action_${label}`
                });
            });

            await batch.commit();
            console.log(`Committed batch of ${chunk.length} updates`);
        }

        console.log(`Successfully marked ${toUpdate.length} ${label} orders as delivered.`);
    } catch (error) {
        console.error("Error bulk updating orders:", error);
        alert(`Failed to update some orders: ${error.message}`);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}


// ============================================================
// SECTION 3: STAFF & ROLE MANAGEMENT
// ============================================================

/**
 * Helper to get a color-coded badge for roles
 */
function getRoleBadge(role) {
    let badgeClass = 'bg-secondary';
    let icon = 'fa-user';
    
    if (role === 'admin') {
        badgeClass = 'bg-danger';
        icon = 'fa-user-shield';
    } else if (role === 'rider') {
        badgeClass = 'bg-primary';
        icon = 'fa-motorcycle';
    } else if (role === 'preparer') {
        badgeClass = 'bg-info';
        icon = 'fa-utensils';
    } else if (role === 'customer') {
        badgeClass = 'bg-dark';
        icon = 'fa-shopping-bag';
    }
    
    return `<span class="badge ${badgeClass} text-uppercase d-inline-flex align-items-center" style="font-size: 10px; padding: 5px 10px; border-radius: 6px;">
                <i class="fas ${icon} me-1" style="font-size: 9px;"></i> ${role || 'customer'}
            </span>`;
}

/**
 * Search for a user by email and display their current role with options to change it.
 */
async function searchUserByEmail(context) {
    const isPreparer = context === 'preparer';
    const emailInput = document.getElementById(isPreparer ? 'preparer-search-email' : 'user-search-email');
    const resultDiv = document.getElementById(isPreparer ? 'preparer-search-result' : 'user-search-result');
    const email = emailInput.value.trim().toLowerCase();

    if (!email) {
        resultDiv.style.display = 'none';
        return;
    }

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm" role="status"></div> Searching...</div>';

    try {
        // Query users collection by email
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("email", "==", email));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            // Check for hardcoded override
            const adminEmails = [
                '10sahilsarkar@gmail.com',
                'contact.harryteachesai@gmail.com',
                'support.meatdae@gmail.com',
                'contact.meatdae@gmail.com'
            ];
            if (adminEmails.includes(email)) {
                resultDiv.innerHTML = `
                    <div class="card border-0 shadow-sm mb-3 bg-light border-danger">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-center mb-3">
                                <div>
                                    <div class="fw-bold text-dark fs-5">System Admin</div>
                                    <div class="text-muted small">${email}</div>
                                </div>
                                ${getRoleBadge('admin')}
                            </div>
                            <p class="small text-danger mb-0">
                                <i class="fas fa-shield-alt me-1"></i> 
                                This account has <strong>Hardcoded Admin</strong> access in the system code.
                            </p>
                        </div>
                    </div>`;
                return;
            }

            resultDiv.innerHTML = `
                <div class="alert alert-warning">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    No user found with email: <strong>${email}</strong>
                </div>`;
            return;
        }

        const userDoc = snapshot.docs[0];
        const userData = userDoc.data();
        const userId = userDoc.id;
        const currentRole = userData.role || 'customer';

        resultDiv.innerHTML = `
            <div class="card border-0 shadow-sm mb-3 animate__animated animate__fadeIn">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <div>
                            <div class="fw-bold text-dark fs-5">${userData.name || 'Anonymous User'}</div>
                            <div class="text-muted small">${userData.email}</div>
                        </div>
                        ${getRoleBadge(currentRole)}
                    </div>
                    <div class="d-flex gap-2 flex-wrap">
                        <button class="btn btn-outline-danger btn-sm rounded-pill px-3 ${currentRole === 'admin' ? 'active' : ''}" onclick="window.changeUserRole('${userId}', 'admin')">Make Admin</button>
                        <button class="btn btn-outline-primary btn-sm rounded-pill px-3 ${currentRole === 'rider' ? 'active' : ''}" onclick="window.changeUserRole('${userId}', 'rider')">Make Rider</button>
                        <button class="btn btn-outline-info btn-sm rounded-pill px-3 ${currentRole === 'preparer' ? 'active' : ''}" onclick="window.changeUserRole('${userId}', 'preparer')">Make Preparer</button>
                        <button class="btn btn-outline-secondary btn-sm rounded-pill px-3 ${currentRole === 'customer' ? 'active' : ''}" onclick="window.changeUserRole('${userId}', 'customer')">Reset to Customer</button>
                    </div>
                </div>
            </div>`;
    } catch (error) {
        console.error("Error searching user:", error);
        resultDiv.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-times-circle me-2"></i>
                Error searching: ${error.message}
            </div>`;
    }
}

/**
 * Change a user's role in Firestore.
 */
window.changeUserRole = async function (uid, newRole) {
    if (!confirm(`Are you sure you want to change this user's role to ${newRole.toUpperCase()}?`)) return;

    try {
        await updateDoc(doc(db, "users", uid), { role: newRole });
        alert("Role updated successfully!");
        // Refresh both search result and the full staff list
        const emailInput = document.getElementById('user-search-email');
        if (emailInput && emailInput.value) searchUserByEmail('rider');
        loadAllStaff();
        loadRiders();
        loadPreparers();
    } catch (e) {
        console.error("Change role error:", e);
        alert("Failed to update role: " + e.message);
    }
};

/**
 * Load all users (Admin, Rider, Preparer, and Customers) and display them in a list.
 * Staff members are sorted to appear at the top.
 */
window.loadAllStaff = async function loadAllStaff() {
    const container = document.getElementById('all-staff-list');
    if (!container) return;

    try {
        const usersRef = collection(db, "users");
        // Get all users
        const snapshot = await getDocs(usersRef);

        if (snapshot.empty) {
            container.innerHTML = `<div class="text-center text-muted py-4">No users found.</div>`;
            return;
        }

        // Sort users: Admin > Rider > Preparer > Customer
        const rolePriority = { 'admin': 1, 'rider': 2, 'preparer': 3, 'customer': 4 };
        const users = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            users.push({ id: docSnap.id, ...data });
        });

        users.sort((a, b) => {
            const pA = rolePriority[a.role] || 4;
            const pB = rolePriority[b.role] || 4;
            if (pA !== pB) return pA - pB;
            return (a.name || '').localeCompare(b.name || '');
        });

        let html = `
            <div class="table-responsive">
                <table class="table table-hover align-middle">
                    <thead>
                        <tr class="table-light">
                            <th>User Name</th>
                            <th>Role</th>
                            <th>Phone</th>
                            <th class="text-end">Actions</th>
                        </tr>
                    </thead>
                    <tbody>`;

        users.forEach(user => {
            const role = user.role || 'customer';

            html += `
                <tr class="${role === 'customer' ? 'opacity-75' : ''}">
                    <td>
                        <div class="fw-bold text-dark">${user.name || 'Anonymous'}</div>
                        <small class="text-muted">${user.email || 'No Email'}</small>
                    </td>
                    <td>${getRoleBadge(role)}</td>
                    <td>${user.phone || '<span class="text-muted">Not Set</span>'}</td>
                    <td class="text-end">
                        <button class="btn btn-sm btn-outline-secondary rounded-pill" onclick="window.focusUserSearch('${user.email}')">
                            <i class="fas fa-edit"></i> Edit Role
                        </button>
                    </td>
                </tr>`;
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;

    } catch (error) {
        console.error("LoadAllStaff Error:", error);
        container.innerHTML = `<div class="alert alert-danger">Error loading user list: ${error.message}</div>`;
    }
};

window.focusUserSearch = function(email) {
    const input = document.getElementById('user-search-email');
    if (input) {
        input.value = email;
        searchUserByEmail('rider');
        window.scrollTo({ top: input.offsetTop - 100, behavior: 'smooth' });
    }
};

/**
 * Load all users with role "rider" and display them.
 */
window.loadRiders = async function loadRiders() {
    const container = document.getElementById('riders-list');

    try {
        const usersRef = collection(db, "users");
        // Include both riders and admins in the performance list
        const q = query(usersRef, where("role", "in", ["rider", "admin"]));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            container.innerHTML = `
                <div class="text-muted text-center py-3">
                    <i class="fas fa-info-circle me-1"></i> No riders registered yet.
                    Use the search above to promote a user to rider.
                </div>`;
            return;
        }

        const riderPerfDate = document.getElementById('rider-performance-date');
        let filterVal = riderPerfDate?.value || new Date().toISOString().split('T')[0];
        const [y, m, d] = filterVal.split('-').map(Number);
        const filterDate = new Date(y, m - 1, d); // Midnight local

        // Fetch settlements for the selected date
        const settlementsRef = collection(db, "rider_settlements");
        const qSettlements = query(settlementsRef, where("date", "==", filterVal));
        const settlementsSnapshot = await getDocs(qSettlements);
        const settlementsData = settlementsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const isToday = filterDate.getTime() === today.getTime();
        const dateLabel = isToday ? "Today's" : filterDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

        let html = `
            <div class="table-responsive">
                <table class="table rider-table align-middle">
                    <thead>
                        <tr class="table-dark">
                            <th>Name</th>
                            <th>Phone</th>
                            <th class="text-center">${dateLabel} Deliveries</th>
                            <th class="text-end text-warning">Pending (COD)</th>
                            <th class="text-end text-success">Paid (COD)</th>
                            <th class="text-end text-info">${dateLabel} Online</th>
                            <th class="text-end">Action</th>
                        </tr>
                    </thead>
                    <tbody>`;

        snapshot.forEach(docSnap => {
            const riderId = docSnap.id;
            const data = docSnap.data();

            // Calculate Performance for the SELECTED date from allOrders
            const deliveredOrders = allOrders.filter(o => {
                if (o.riderId !== riderId) return false;
                if (o.status !== 'DELIVERED' && o.status !== 'Delivered') return false;

                const orderDate = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
                return orderDate.getFullYear() === filterDate.getFullYear() &&
                    orderDate.getMonth() === filterDate.getMonth() &&
                    orderDate.getDate() === filterDate.getDate();
            });

            const totalDeliveries = deliveredOrders.length;

            // Separate Cash (COD) vs Online
            const codEarned = deliveredOrders
                .filter(o => o.paymentMethod === 'COD' || o.paymentMethod === 'Cash on Delivery')
                .reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);

            const onlineEarned = deliveredOrders
                .filter(o => o.paymentMethod !== 'COD' && o.paymentMethod !== 'Cash on Delivery')
                .reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);

            // Calculate Paid vs Pending
            let settledAmount = 0;
            const riderSettlements = settlementsData.filter(s => s.riderId === riderId);
            riderSettlements.forEach(s => {
                if (s.status === 'SETTLED') {
                    settledAmount += (Number(s.codAmount) || 0);
                }
            });
            const pendingAmount = Math.max(0, codEarned - settledAmount);

            // Skip admins with 0 activity to keep the list clean, but show all riders
            if (data.role === 'admin' && totalDeliveries === 0 && codEarned === 0 && settledAmount === 0 && onlineEarned === 0) {
                return;
            }

            html += `
                <tr>
                    <td>
                        <div class="fw-bold text-dark">${data.name || 'N/A'}</div>
                        <small class="text-muted">${data.email || ''}</small>
                    </td>
                    <td>${data.phone || 'N/A'}</td>
                    <td class="text-center">
                        <span class="badge bg-primary rounded-pill px-3">${totalDeliveries}</span>
                    </td>
                    <td class="text-end fw-bold text-warning" style="font-size: 15px;">
                        ₹${pendingAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td class="text-end fw-bold text-success" style="font-size: 15px;">
                        ₹${settledAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td class="text-end fw-bold text-info">
                        ₹${onlineEarned.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td class="text-end">
                        <button class="btn btn-outline-danger btn-sm rounded-pill px-3" onclick="window.changeUserRole('${riderId}', 'customer')">
                            <i class="fas fa-user-minus me-1"></i> Remove
                        </button>
                    </td>
                </tr>`;
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;

    } catch (error) {
        console.error("Error loading riders:", error);
        container.innerHTML = `<div class="alert alert-danger">Error loading riders: ${error.message}</div>`;
    }
}

/**
 * Load all users with role "preparer" and display them.
 */
window.loadPreparers = async function loadPreparers() {
    const container = document.getElementById('preparers-list');
    if (!container) return;

    try {
        const usersRef = collection(db, "users");
        // Include both preparers and admins
        const q = query(usersRef, where("role", "in", ["preparer", "admin"]));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            container.innerHTML = `
                <div class="text-muted text-center py-3">
                    <i class="fas fa-info-circle me-1"></i> No preparers registered yet.
                    Use the search above to promote a user to preparer.
                </div>`;
            return;
        }

        const prepPerfDate = document.getElementById('preparer-performance-date');
        let filterVal = prepPerfDate?.value || new Date().toISOString().split('T')[0];
        const [py, pm, pd] = filterVal.split('-').map(Number);
        const filterDate = new Date(py, pm - 1, pd); // Midnight local

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const isToday = filterDate.getTime() === today.getTime();
        const dateLabel = isToday ? "Today's" : filterDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

        let html = `
            <div class="table-responsive">
                <table class="table align-middle">
                    <thead>
                        <tr class="table-dark">
                            <th>Name</th>
                            <th>Phone</th>
                            <th class="text-center">${dateLabel} Prepared</th>
                            <th class="text-end">Action</th>
                        </tr>
                    </thead>
                    <tbody>`;

        snapshot.forEach(docSnap => {
            const preparerId = docSnap.id;
            const data = docSnap.data();

            // Stats: Count prepared orders for this user on SELECTED date
            const preparedCount = allOrders.filter(o => {
                if (o.preparedBy !== preparerId && o.acceptedBy !== preparerId) return false;
                if (!o.isPrepared) return false;

                const orderDate = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
                return orderDate.getFullYear() === filterDate.getFullYear() &&
                    orderDate.getMonth() === filterDate.getMonth() &&
                    orderDate.getDate() === filterDate.getDate();
            }).length;

            // Skip admins with 0 activity
            if (data.role === 'admin' && preparedCount === 0) {
                return;
            }

            html += `
                <tr>
                    <td>
                        <div class="fw-bold text-dark">${data.name || 'N/A'}</div>
                        <small class="text-muted">${data.email || ''}</small>
                    </td>
                    <td>${data.phone || 'N/A'}</td>
                    <td class="text-center">
                        <span class="badge bg-info rounded-pill px-3">${preparedCount}</span>
                    </td>
                    <td class="text-end">
                        <button class="btn btn-outline-danger btn-sm rounded-pill px-3" onclick="window.changeUserRole('${preparerId}', 'customer')">
                            <i class="fas fa-user-minus me-1"></i> Remove
                        </button>
                    </td>
                </tr>`;
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;

    } catch (error) {
        console.error("Error loading preparers:", error);
        container.innerHTML = `<div class="alert alert-danger">Error loading preparers: ${error.message}</div>`;
    }
}


// ============================================================
// SECTION 4: UTILITIES
// ============================================================

/**
 * Play a subtle notification sound when a new order arrives.
 * Uses the Web Audio API to synthesize a short beep.
 */
function playNotificationSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);

        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
        console.log("Could not play notification sound:", e);
    }
}

/**
 * Normalizes product names to handle minor variations (pluralization, casing, etc.).
 */
function normalizeProductName(name) {
    if (!name) return "Unknown Product";
    const n = name.toLowerCase().trim();
    
    if (n.includes("curry cut") && n.includes("chicken")) return "Fresh Chicken Curry Cut";
    if (n.includes("boneless cut") && n.includes("chicken")) return "Fresh Chicken Boneless Cuts";
    if (n.includes("breast cut") && n.includes("chicken")) return "Fresh Chicken Breast Cuts";
    if (n.includes("legs cut") || n.includes("leg cut")) return "Fresh Chicken Legs Cut";
    if (n.includes("biriyani cut")) return "Fresh Chicken Biriyani Cuts";
    if (n.includes("keema")) return "Fresh Chicken Boneless Keema";
    if (n.includes("wings")) return "Fresh Chicken Wings";
    if (n.includes("gizzard liver")) return "Fresh Clean Gizzard Liver";
    if (n.includes("big egg")) return "Fresh Big Eggs";
    if (n.includes("duck egg")) return "Fresh Local Duck Eggs";
    if (n.includes("mutton curry cut")) return "Pure Mutton Curry Cuts";

    return name.trim();
}

/**
 * Normalizes weight strings to ensure consistency (e.g., "500 Gram" -> "500g").
 */
function normalizeWeight(weight) {
    if (!weight) return "Std";
    let w = weight.toLowerCase().trim();
    
    // 1. Handle Kilograms first to avoid partial matches with "gram"
    w = w.replace(/\b(\d+)\s*kilogram(s)?\b/g, "$1kg");
    w = w.replace(/\b(\d+)\s*kg\b/g, "$1kg");
    
    // 2. Handle Grams
    w = w.replace(/\b(\d+)\s*gram(s)?\b/g, "$1g");
    w = w.replace(/\b(\d+)\s*gm(s)?\b/g, "$1g");
    
    // 3. Handle messy variations
    w = w.replace(/\s*k\.g\./g, "kg");
    w = w.replace("1000g", "1kg");
    
    // 4. Final Cleanup
    w = w.replace(/\s+/g, "");
    
    return w;
}

// ============================================================
// SECTION 5: FINANCIAL LEDGER
// ============================================================

/**
 * Update the product dropdown with unique items found in all orders.
 */
function updateProductDropdown() {
    const productSelect = document.getElementById('ledger-product');
    if (!productSelect) return;

    // Save current selection
    const currentVal = productSelect.value;

    const products = new Set();
    allOrders.forEach(order => {
        if (order.items) {
            order.items.forEach(item => products.add(normalizeProductName(item.name)));
        }
    });

    const sortedProducts = Array.from(products).sort();
    let html = '<option value="ALL">All Products</option>';
    sortedProducts.forEach(p => {
        html += `<option value="${p}">${p}</option>`;
    });
    productSelect.innerHTML = html;

    // Restore selection if it still exists
    if (Array.from(productSelect.options).some(opt => opt.value === currentVal)) {
        productSelect.value = currentVal;
    }
}

/**
 * Filter orders based on the selected year, month, and product.
 */
window.applyLedgerFilters = () => {
    const yearValue = document.getElementById('ledger-year').value;
    const month = document.getElementById('ledger-month').value;
    const dayValue = document.getElementById('ledger-day').value; // YYYY-MM-DD
    const product = document.getElementById('ledger-product').value;

    let filtered = allOrders.filter(order => {
        const orderDate = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);

        // Date Logic
        if (dayValue) {
            const filterDate = new Date(dayValue);
            const isSameDay = orderDate.getFullYear() === filterDate.getFullYear() &&
                orderDate.getMonth() === filterDate.getMonth() &&
                orderDate.getDate() === filterDate.getDate();
            if (!isSameDay) return false;
        } else {
            // Only check Year/Month if a specific day is NOT selected
            const orderYear = orderDate.getFullYear();
            const orderMonth = orderDate.getMonth();

            if (yearValue !== "ALL" && orderYear !== parseInt(yearValue)) return false;
            if (month !== "ALL" && orderMonth !== parseInt(month)) return false;
        }

        // Product filter (Always check if selected)
        if (product !== "ALL") {
            const hasProduct = order.items?.some(item => item.name === product);
            if (!hasProduct) return false;
        }

        return true;
    });

    renderLedger(filtered, product);
};

/**
 * Render the filtered orders into the ledger table and update summaries.
 */
let ledgerSortField = 'date';
let ledgerSortAsc = false;

/**
 * Toggle sorting field and direction for the ledger table.
 */
window.toggleLedgerSort = (field) => {
    if (ledgerSortField === field) {
        ledgerSortAsc = !ledgerSortAsc;
    } else {
        ledgerSortField = field;
        ledgerSortAsc = false;
    }

    // Update icons
    document.querySelectorAll('thead th i').forEach(i => i.className = 'fas fa-sort text-muted ms-1');
    const activeIcon = document.getElementById(`sort-icon-${field}`);
    if (activeIcon) {
        activeIcon.className = ledgerSortAsc ? 'fas fa-sort-up text-white ms-1' : 'fas fa-sort-down text-white ms-1';
    }

    applyLedgerFilters();
};

/**
 * Render the filtered orders into the ledger table and update summaries.
 * Enhanced to group by Name + Weight and provide sorting.
 */
function renderLedger(orders, selectedProduct) {
    const tbody = document.getElementById('ledger-table-body');
    const totalOrdersEl = document.getElementById('ledger-total-orders');
    const totalRevenueEl = document.getElementById('ledger-total-revenue');
    const totalCancelledEl = document.getElementById('ledger-total-cancelled');
    const productSummarySection = document.getElementById('product-summary-section');
    const productSummaryBody = document.getElementById('product-summary-body');

    let totalRevenue = 0;
    let totalCancelled = 0;
    let productStats = {}; // { "Name|Weight": { name, weight, qty, revenue } }

    // Apply Sorting
    orders.sort((a, b) => {
        let valA, valB;
        if (ledgerSortField === 'date') {
            valA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt).getTime();
            valB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt).getTime();
        } else if (ledgerSortField === 'amount') {
            valA = Number(a.totalAmount || 0);
            valB = Number(b.totalAmount || 0);
        } else if (ledgerSortField === 'id') {
            valA = a.orderId || a.id;
            valB = b.orderId || b.id;
        }

        if (ledgerSortAsc) return valA > valB ? 1 : -1;
        return valA < valB ? 1 : -1;
    });

    const rows = orders.map(order => {
        const orderDate = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
        const dateStr = orderDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        const amount = Number(order.totalAmount || 0);

        if (order.status === 'DELIVERED') {
            totalRevenue += amount;

            // Aggregate product stats ONLY for delivered orders for accuracy
            let orderItemsTotal = 0;
            if (order.items) {
                order.items.forEach(item => {
                    const normalizedName = normalizeProductName(item.name);
                    const weight = normalizeWeight(item.weight || 'Std');
                    const key = normalizedName; // Group by normalized name
                    
                    if (!productStats[key]) {
                        productStats[key] = {
                            name: normalizedName,
                            sizes: new Set([weight]),
                            qty: 0,
                            revenue: 0,
                            totalVolume: 0,
                            volumeType: 'units'
                        };
                    } else {
                        productStats[key].sizes.add(weight);
                    }

                    const q = Number(item.quantity || 0);
                    const itemRevenue = Number(item.price || 0) * q;
                    productStats[key].qty += q;
                    productStats[key].revenue += itemRevenue;
                    orderItemsTotal += itemRevenue;

                    // Calculate Volume (KG or Qty)
                    const wLower = weight.toLowerCase().replace(/\s+/g, '');
                    const numMatch = wLower.match(/(\d+(\.\d+)?)/);
                    if (numMatch) {
                        const num = parseFloat(numMatch[1]);
                        // Priority: 1. Eggs/Units, 2. Explicit KG/Kilogram, 3. Grams
                        if (wLower.includes('egg') || wLower.includes('pc') || wLower.includes('piece')) {
                            productStats[key].totalVolume += (num * q);
                            productStats[key].volumeType = 'qty';
                        } else if (wLower.includes('kg') || wLower.includes('kilogram')) {
                            productStats[key].totalVolume += (num * q);
                            productStats[key].volumeType = 'kg';
                        } else if (wLower.includes('gram') || wLower.includes('gm') || (wLower.includes('g') && !wLower.includes('kg') && !wLower.includes('kilogram'))) {
                            // Only treat as 'g' if it's not part of 'kg'
                            productStats[key].totalVolume += (num / 1000 * q);
                            productStats[key].volumeType = 'kg';
                        } else {
                            productStats[key].totalVolume += q;
                        }
                    } else {
                        productStats[key].totalVolume += q;
                    }
                });
            }

            // Track any extra charges (Delivery, Online Fees, etc.)
            const fees = amount - orderItemsTotal;
            if (Math.abs(fees) > 0.01) {
                const feeKey = "Delivery & Service Charges";
                if (!productStats[feeKey]) {
                    productStats[feeKey] = {
                        name: feeKey,
                        sizes: new Set(["-"]),
                        qty: 0,
                        revenue: 0,
                        totalVolume: 0,
                        volumeType: 'none'
                    };
                }
                productStats[feeKey].revenue += fees;
                productStats[feeKey].qty += 1; // Count orders that contributed to fees
            }
        } else if (order.status === 'CANCELLED') {
            totalCancelled += amount;
        }

        const itemsStr = order.items ? order.items.map(i => `${i.name} (${i.weight || 'Std'}) x${i.quantity}`).join(', ') : 'No items';

        return `
            <tr class="${order.status === 'CANCELLED' ? 'table-light opacity-75' : ''}">
                <td class="text-nowrap">${dateStr}</td>
                <td class="fw-bold text-primary">${order.orderId || order.id.substring(0, 8)}</td>
                <td>
                    <div class="fw-bold">${order.customerName || order.deliveryInfo?.name || 'Guest'}</div>
                    <div class="small text-muted">${order.deliveryInfo?.phone || ''}</div>
                </td>
                <td><span class="status-badge status-${order.status}">${formatStatus(order.status)}</span></td>
                <td title="${itemsStr}">
                    <div class="text-truncate" style="max-width: 250px;">${itemsStr}</div>
                </td>
                <td class="text-end fw-bold ${order.status === 'DELIVERED' ? 'text-success' : (order.status === 'CANCELLED' ? 'text-danger' : 'text-dark')}">
                    ₹${amount.toFixed(2)}
                </td>
            </tr>`;
    });

    tbody.innerHTML = rows.length > 0 ? rows.join('') : '<tr><td colspan="6" class="text-center py-5 text-muted"><i class="fas fa-search me-2"></i>No matching transactions found</td></tr>';

    // Update summaries with animation
    animateNumber('ledger-total-orders', orders.length);
    animateNumber('ledger-total-revenue', totalRevenue, true);
    animateNumber('ledger-total-cancelled', totalCancelled, true);

    // Render Product Summary (Size-wise breakdown)
    if (Object.keys(productStats).length > 0) {
        productSummarySection.classList.remove('d-none');

        const sortedStats = Object.values(productStats).sort((a, b) => b.revenue - a.revenue);

        // Populate Table
        const productRows = sortedStats.map(stat => {
            let volumeDisplay = '';
            if (stat.volumeType === 'kg') {
                volumeDisplay = `<span class="badge bg-success bg-opacity-10 text-success">${stat.totalVolume.toFixed(2)} kgs</span>`;
            } else if (stat.volumeType === 'qty') {
                volumeDisplay = `<span class="badge bg-info bg-opacity-10 text-info">${stat.totalVolume} units</span>`;
            } else if (stat.volumeType === 'none') {
                volumeDisplay = `<span class="text-muted">-</span>`;
            } else {
                volumeDisplay = `<span class="text-muted">${stat.qty} units</span>`;
            }

            const sizeDisplay = Array.from(stat.sizes).join(', ');

            return `
                <tr>
                    <td class="fw-bold text-dark">${stat.name}</td>
                    <td class="text-center">
                        <span class="badge bg-light text-dark border-0" style="font-size: 11px;">${sizeDisplay}</span>
                    </td>
                    <td class="text-center fw-bold text-primary">${stat.qty}</td>
                    <td class="text-center fw-bold">${volumeDisplay}</td>
                    <td class="text-end fw-bold">₹${stat.revenue.toFixed(2)}</td>
                </tr>`;
        }).join('');
        productSummaryBody.innerHTML = productRows;

        // Update Header to show column for Volume
        const productSummaryHeader = document.querySelector('#product-summary-section thead tr');
        if (productSummaryHeader && !productSummaryHeader.innerHTML.includes('TOTAL VOLUME')) {
            productSummaryHeader.innerHTML = `
                <th>Product Name</th>
                <th class="text-center">Size</th>
                <th class="text-center">Packs Sold</th>
                <th class="text-center">Total Volume</th>
                <th class="text-end">Approx. Revenue</th>
            `;
        }

        // Populate Top 4 Cards/Grid (Filtering out fees to focus on products)
        const gridContainer = document.getElementById('product-summary-grid');
        if (gridContainer) {
            const topProducts = sortedStats.filter(s => s.name !== "Delivery & Service Charges").slice(0, 4);
            gridContainer.innerHTML = topProducts.map(stat => `
                <div class="col-md-3">
                    <div class="card border-0 shadow-sm bg-white p-3 h-100" style="border-left: 4px solid var(--primary) !important;">
                        <div class="small text-muted text-truncate mb-1">${stat.name}</div>
                        <div class="d-flex justify-content-between align-items-end">
                            <h5 class="m-0 fw-bold">₹${stat.revenue.toFixed(2)}</h5>
                            <span class="badge bg-primary rounded-pill">${stat.qty} units</span>
                        </div>
                        <div class="mt-2 small text-muted"><i class="fas fa-box-open me-1"></i> Size: ${Array.from(stat.sizes).join(', ')}</div>
                    </div>
                </div>
            `).join('');
        }
    } else {
        productSummarySection.classList.add('d-none');
    }
}

/**
 * Utility to animate count numbers
 */
function animateNumber(id, finalValue, isCurrency = false) {
    const el = document.getElementById(id);
    if (!el) return;

    const startValue = 0;
    const duration = 800;
    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const currentVal = startValue + progress * (finalValue - startValue);

        el.textContent = isCurrency
            ? `₹${currentVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : Math.floor(currentVal);

        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }
    requestAnimationFrame(update);
}

/**
 * Export the currently filtered ledger data to a CSV file.
 */
window.exportLedgerToCSV = () => {
    const table = document.querySelector('#ledger-pane table:last-of-type');
    const rows = Array.from(table.querySelectorAll('tr'));

    if (rows.length <= 1 || rows[1].innerText.includes("No transactions")) {
        alert("No data to export!");
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";

    // Headers
    const headers = Array.from(rows[0].querySelectorAll('th')).map(th => th.innerText);
    csvContent += headers.join(",") + "\r\n";

    // Data rows
    rows.slice(1).forEach(row => {
        const cols = Array.from(row.querySelectorAll('td')).map(td => {
            // Handle commas in items list
            let text = td.innerText.replace(/"/g, '""');
            return `"${text}"`;
        });
        csvContent += cols.join(",") + "\r\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const filename = `MeatDae_Ledger_${new Date().toISOString().split('T')[0]}.csv`;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

/**
 * Permanently delete all orders created before today.
 */
window.cleanLegacyLedger = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const legacyOrders = allOrders.filter(order => {
        const orderDate = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
        return orderDate < today;
    });

    if (legacyOrders.length === 0) {
        alert(`No legacy orders found before today (${today.toLocaleDateString()}).`);
        return;
    }

    const confirmMsg = `Are you sure you want to PERMANENTLY DELETE all ${legacyOrders.length} orders created before ${today.toLocaleDateString()}?\n\nThis will clear them from the database forever. This action cannot be undone.`;

    if (!confirm(confirmMsg)) return;
    if (!confirm("FINAL WARNING: This is a destructive action that wipes financial records. Click OK to proceed with deletion.")) return;

    try {
        const btn = document.querySelector('button[onclick="cleanLegacyLedger()"]');
        const originalText = btn.innerHTML;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin me-1"></i> Deleting ${legacyOrders.length}...`;
        btn.disabled = true;

        // Use writeBatch from Firestore (already imported)
        const chunkSize = 400; // Firestore batch limit is 500
        for (let i = 0; i < legacyOrders.length; i += chunkSize) {
            const chunk = legacyOrders.slice(i, i + chunkSize);
            const batch = writeBatch(db);

            chunk.forEach(order => {
                const orderRef = doc(db, "orders", order.id);
                batch.delete(orderRef);
            });

            await batch.commit();
            console.log(`Successfully deleted batch of ${chunk.length} legacy orders.`);
        }

        alert(`Successfully deleted ${legacyOrders.length} test/past orders. The ledger is now fresh from today.`);
        btn.innerHTML = originalText;
        btn.disabled = false;
    } catch (error) {
        console.error("Error cleaning legacy ledger:", error);
        alert("Failed to delete orders: " + error.message);
        const btn = document.querySelector('button[onclick="cleanLegacyLedger()"]');
        if (btn) {
            btn.innerHTML = `<i class="fas fa-trash-alt me-1"></i> Clean Legacy Ledger`;
            btn.disabled = false;
        }
    }
};

// ============================================================
// SECTION 6: RIDER COD SETTLEMENT MANAGEMENT
// ============================================================

/**
 * Listen to rider_settlements collection and render requests in admin panel.
 */
function listenForSettlements() {
    const settlementsRef = collection(db, "rider_settlements");
    const qSettlements = query(settlementsRef, orderBy("requestedAt", "desc"));

    onSnapshot(qSettlements, (snap) => {
        const container = document.getElementById('settlement-requests-list');
        if (!container) return;

        if (snap.empty) {
            container.innerHTML = `
                <div class="text-muted text-center py-3">
                    <i class="fas fa-info-circle me-1"></i> No settlement requests yet.
                </div>`;
            return;
        }

        let pendingHtml = '';
        let settledHtml = '';
        let pendingCount = 0;
        let settledCount = 0;

        snap.forEach(docSnap => {
            const s = docSnap.data();
            const sid = docSnap.id;
            const requestDate = s.requestedAt?.toDate ? s.requestedAt.toDate() : new Date();
            const dateLabel = new Date(s.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

            if (s.status === 'PENDING_APPROVAL') {
                pendingCount++;
                pendingHtml += `
                    <div class="p-3 mb-2" style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; animation: slideIn 0.3s ease;">
                        <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
                            <div>
                                <div class="fw-bold text-dark">${s.riderName || 'Rider'}</div>
                                <div class="small text-muted">${dateLabel} • ${s.deliveryCount || 0} deliveries</div>
                            </div>
                            <div class="text-end">
                                <div class="fw-bold" style="color: #dc3545; font-size: 18px;">₹${(s.codAmount || 0).toFixed(2)}</div>
                                <div class="small text-muted">COD Cash</div>
                            </div>
                        </div>
                        <div class="d-flex gap-2 mt-3">
                            <button class="btn btn-success btn-sm flex-grow-1 rounded-pill fw-bold" onclick="window.approveSettlement('${sid}')">
                                <i class="fas fa-check me-1"></i> Approve
                            </button>
                            <button class="btn btn-outline-danger btn-sm flex-grow-1 rounded-pill fw-bold" onclick="window.rejectSettlement('${sid}')">
                                <i class="fas fa-times me-1"></i> Reject
                            </button>
                        </div>
                    </div>`;
            } else if (s.status === 'SETTLED') {
                settledCount++;
                const approvedDate = s.approvedAt?.toDate ? s.approvedAt.toDate().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '';
                settledHtml += `
                    <div class="p-3 mb-2" style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px;">
                        <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
                            <div>
                                <div class="fw-bold text-dark">${s.riderName || 'Rider'}</div>
                                <div class="small text-muted">${dateLabel} • ${s.deliveryCount || 0} deliveries</div>
                            </div>
                            <div class="text-end">
                                <div class="fw-bold text-success" style="font-size: 18px;">₹${(s.codAmount || 0).toFixed(2)}</div>
                                <span class="badge bg-success"><i class="fas fa-check-circle me-1"></i>Settled${approvedDate ? ' on ' + approvedDate : ''}</span>
                            </div>
                        </div>
                    </div>`;
            }
        });

        let html = '';
        if (pendingCount > 0) {
            html += `<div class="mb-3"><div class="small fw-bold text-warning mb-2"><i class="fas fa-clock me-1"></i> Pending Approval (${pendingCount})</div>${pendingHtml}</div>`;
        }
        if (settledCount > 0) {
            html += `<div><div class="small fw-bold text-success mb-2"><i class="fas fa-check-circle me-1"></i> Settled (${settledCount})</div>${settledHtml}</div>`;
        }
        container.innerHTML = html;
    });
}

/**
 * Admin approves a settlement request
 */
window.approveSettlement = async (settlementId) => {
    if (!confirm("Confirm you have received the COD cash from this rider?")) return;
    
    try {
        const user = auth.currentUser;
        await updateDoc(doc(db, "rider_settlements", settlementId), {
            status: "SETTLED",
            approvedAt: serverTimestamp(),
            approvedBy: user?.email || "admin"
        });
        alert("Settlement approved successfully!");
    } catch (e) {
        console.error("Approve settlement error:", e);
        alert("Failed to approve: " + e.message);
    }
};

/**
 * Admin rejects a settlement request
 */
window.rejectSettlement = async (settlementId) => {
    if (!confirm("Reject this settlement? The rider will need to re-submit.")) return;
    
    try {
        const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js");
        await deleteDoc(doc(db, "rider_settlements", settlementId));
        alert("Settlement rejected. The rider can re-submit.");
    } catch (e) {
        console.error("Reject settlement error:", e);
        alert("Failed to reject: " + e.message);
    }
};

// Initialize settlements listener when dashboard loads
listenForSettlements();


// ============================================================
// SECTION 6: COMPLAINT MANAGEMENT
// ============================================================

/**
 * Load and listen for complaints.
 */
window.loadComplaints = function loadComplaints() {
    const container = document.getElementById('complaints-table-body');
    if (!container) return;

    const complaintsRef = collection(db, "complaints");
    const q = query(complaintsRef, orderBy("createdAt", "desc"));

    onSnapshot(q, (snapshot) => {
        console.log("[Admin] Complaints Snapshot size:", snapshot.size);
        if (snapshot.empty) {
            container.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No complaints found.</td></tr>`;
            return;
        }

        let html = '';
        snapshot.forEach(docSnap => {
            const complaint = docSnap.data();
            const id = docSnap.id;
            const date = complaint.createdAt?.toDate ? complaint.createdAt.toDate().toLocaleString() : 'N/A';
            
            let statusClass = 'bg-info';
            if (complaint.status === 'RESOLVED') statusClass = 'bg-success';
            if (complaint.status === 'PENDING') statusClass = 'bg-warning';

            const photoHtml = complaint.imageUrl ? `
                <a href="${complaint.imageUrl}" target="_blank">
                    <img src="${complaint.imageUrl}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 6px; border: 1px solid #eee;">
                </a>
            ` : '<span class="text-muted small">No Photo</span>';

            html += `
                <tr>
                    <td class="text-nowrap">${date}</td>
                    <td><strong>${complaint.userName || 'Guest'}</strong></td>
                    <td>${complaint.userPhone || 'N/A'}</td>
                    <td><div style="max-width: 300px; font-size: 12px; line-height: 1.4;">${complaint.description || complaint.lastMessage || 'No description'}</div></td>
                    <td>${photoHtml}</td>
                    <td><span class="badge ${statusClass}">${complaint.status || 'PENDING'}</span></td>
                    <td class="text-end">
                        ${complaint.status !== 'RESOLVED' ? `
                            <button class="btn btn-sm btn-success rounded-pill px-3" onclick="window.resolveComplaint('${id}')">
                                <i class="fas fa-check me-1"></i> Resolve
                            </button>
                        ` : '<span class="text-success"><i class="fas fa-check-double me-1"></i> Fixed</span>'}
                    </td>
                </tr>`;
        });
    }, (error) => {
        console.error("[Admin] Complaints listener error:", error);
        container.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-danger">Error loading complaints: ${error.message}</td></tr>`;
    });
};

/**
 * Mark a complaint as resolved.
 */
window.resolveComplaint = async (complaintId) => {
    if (!confirm("Mark this complaint as RESOLVED?")) return;
    try {
        await updateDoc(doc(db, "complaints", complaintId), {
            status: "RESOLVED",
            resolvedAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error resolving complaint:", error);
        alert("Failed to resolve: " + error.message);
    }
};
