// js/my_orders.js
// Customer order history with real-time status updates - Redesigned UI

import { app, auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { collection, onSnapshot, query, where, orderBy, getDocs, deleteDoc, addDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getProductSlugFromName } from './products-metadata.js';

function showAlert(message, title = 'Notice', type = 'info') {
    if (window.showCustomAlert) window.showCustomAlert(message, title, type);
    else if (window.showCustomPopup) window.showCustomPopup(message, type);
    else alert(message);
}

function normalizeName(name) {
    if (!name) return "";
    return name.toLowerCase()
               .replace(/-/g, ' ') 
               .trim()
               .replace(/\s+/g, ' '); 
}


// Active statuses for orders (Must match cart.js for the bottom-nav glow to be consistent)
const ACTIVE_STATUSES = ['PENDING_APPROVAL', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'READY'];
const HISTORY_STATUSES = ['DELIVERED', 'CANCELLED'];

function getProductLink(itemName) {
    const slug = getProductSlugFromName(itemName);
    if (slug) {
        return `product_details.html?id=${slug}`;
    }
    return "#";
}

document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, (user) => {
        if (!user) {
            // Hide skeletons
            const activeSkel = document.getElementById('orders-skeleton');
            const historySkel = document.getElementById('history-skeleton');
            if (activeSkel) activeSkel.remove();
            if (historySkel) historySkel.remove();

            const loginRequiredHtml = `
                <div class="empty-orders">
                    <i class="fas fa-user-lock"></i>
                    <p>You need to sign in to view your orders.</p>
                    <a href="javascript:void(0)" onclick="goToLogin()" class="btn-shop">Sign In / Sign Up</a>
                </div>`;

            const activeContainer = document.getElementById('active-orders-container');
            const historyContainer = document.getElementById('history-orders-container');
            if (activeContainer) activeContainer.innerHTML = loginRequiredHtml;
            if (historyContainer) historyContainer.innerHTML = loginRequiredHtml;

            return;
        }
        startOrderListener(user.uid);
    });
});


/**
 * Listen to all orders belonging to the current user in real-time.
 * Falls back to a simpler query if the composite index is missing.
 */
function startOrderListener(userId) {
    const ordersRef = collection(db, "orders");

    // Try the compound query first (requires composite index)
    try {
        const q = query(ordersRef,
            where("userId", "==", userId),
            orderBy("createdAt", "desc")
        );
        setupOrderSnapshot(q, userId);
    } catch (err) {
        console.warn("Compound query setup failed, using fallback:", err);
        fallbackOrderListener(userId);
    }
}

/**
 * Setup the real-time snapshot listener on a given query.
 * If it fails (e.g. missing index), fall back to a simpler query.
 */
function setupOrderSnapshot(q, userId) {
    onSnapshot(q, (snapshot) => {
        renderOrders(snapshot);
    }, (error) => {
        console.warn("Compound query failed (likely missing index). Falling back to simple query.", error);
        // If the error message mentions an index, use a fallback
        fallbackOrderListener(userId);
    });
}

/**
 * Fallback: query without orderBy, then sort client-side.
 */
function fallbackOrderListener(userId) {
    const ordersRef = collection(db, "orders");
    const q = query(ordersRef, where("userId", "==", userId));

    onSnapshot(q, (snapshot) => {
        renderOrders(snapshot, true); // true = sort client-side
    }, (error) => {
        console.error("Fallback order listener also failed:", error);
        const activeContainer = document.getElementById('active-orders-container');
        const historyContainer = document.getElementById('history-orders-container');
        const errorHtml = `
            <div class="empty-orders">
                <i class="fas fa-exclamation-triangle" style="color: #dc3545;"></i>
                <p>Error loading orders. Please try again later.</p>
                <a href="contact.html" class="btn-shop">Contact Support</a>
            </div>`;
        if (activeContainer) activeContainer.innerHTML = errorHtml;
        if (historyContainer) historyContainer.innerHTML = errorHtml;
    });
}

/**
 * Render orders from a Firestore snapshot.
 * If sortClientSide is true, sorts by createdAt descending before rendering.
 */
function renderOrders(snapshot, sortClientSide = false) {
    const activeContainer = document.getElementById('active-orders-container');
    const historyContainer = document.getElementById('history-orders-container');

    // Hide skeleton loaders now that real data has arrived
    const activeSkel = document.getElementById('orders-skeleton');
    const historySkel = document.getElementById('history-skeleton');
    if (activeSkel) activeSkel.remove();
    if (historySkel) historySkel.remove();

    if (snapshot.empty) {
        const emptyHtml = `
            <div class="empty-orders">
                <i class="fas fa-shopping-bag"></i>
                <p>You haven't placed any orders yet.</p>
                <a href="menu.html" class="btn-shop">Start Shopping</a>
            </div>`;
        if (activeContainer) activeContainer.innerHTML = emptyHtml;
        if (historyContainer) historyContainer.innerHTML = emptyHtml;
        return;
    }

    let orders = [];
    snapshot.forEach(docSnap => {
        orders.push({ id: docSnap.id, ...docSnap.data() });
    });

    // Sort client-side if needed (fallback path)
    if (sortClientSide) {
        orders.sort((a, b) => {
            const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
            const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
            return bTime - aTime; // descending
        });
    }

    // Separate active and history orders
    const activeOrders = orders.filter(o => ACTIVE_STATUSES.includes(o.status));
    const historyOrders = orders.filter(o => HISTORY_STATUSES.includes(o.status));

    // Render active orders
    if (activeContainer) {
        if (activeOrders.length === 0) {
            activeContainer.innerHTML = `
                <div class="empty-orders">
                    <i class="fas fa-clock"></i>
                    <p>No active orders at the moment.</p>
                    <a href="menu.html" class="btn-shop">Order Now</a>
                </div>`;
        } else {
            let html = '';
            activeOrders.forEach(order => {
                html += renderActiveOrderCard(order);
            });
            activeContainer.innerHTML = html;
        }
    }

    // Render history orders
    if (historyContainer) {
        if (historyOrders.length === 0) {
            historyContainer.innerHTML = `
                <div class="empty-orders">
                    <i class="fas fa-history"></i>
                    <p>No order history yet.</p>
                    <a href="menu.html" class="btn-shop">Place Your First Order</a>
                </div>`;
        } else {
            let html = '';
            historyOrders.forEach(order => {
                html += renderHistoryOrderCard(order);
            });
            historyContainer.innerHTML = html;
        }
    }
}

/**
 * Render an active order card (with timeline)
 */
function renderActiveOrderCard(order) {
    const statusLabel = formatStatus(order.status, order.isPrepared);
    const createdAt = order.createdAt?.toDate
        ? order.createdAt.toDate().toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: 'numeric',
            month: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        })
        : 'N/A';

    // Get first item for display
    const firstItem = (order.items && order.items.length > 0) ? order.items[0] : null;
    const additionalItems = order.items ? order.items.length - 1 : 0;

    // Product display
    let productHtml = '';
    if (firstItem) {
        const imgSrc = firstItem.image || 'images/dummy.png';
        const productLink = getProductLink(firstItem.name);
        productHtml = `
            <div class="order-product">
                <div class="order-product-img">
                    <a href="${productLink}"><img src="${imgSrc}" alt="${firstItem.name}" onerror="this.src='images/dummy.png'"></a>
                </div>
                <div class="order-product-details">
                    <a href="${productLink}" style="text-decoration: none; color: inherit;"><p class="order-product-name">${firstItem.name}${firstItem.name.includes(firstItem.weight) ? '' : ' (' + (firstItem.weight || 'Std') + ')'}</p></a>
                    <p class="order-product-qty">Quantity: ${firstItem.quantity}</p>
                    <p class="order-product-price">₹${(order.totalAmount || 0).toFixed(2)}</p>
                </div>
            </div>
            ${additionalItems > 0 ? `<a href="#" class="more-items-link">+${additionalItems} more item${additionalItems > 1 ? 's' : ''}</a>` : ''}
        `;
    }

    // Status timeline
    const timelineHtml = renderTimeline(order);

    // Payment info
    const paymentMethod = order.paymentMethod || 'N/A';

    // Track button (visible only when OUT_FOR_DELIVERY)
    let trackBtn = '';
    if (order.status === 'OUT_FOR_DELIVERY') {
        trackBtn = `
            <a href="order_track.html?orderId=${encodeURIComponent(order.id)}" class="btn-track">
                <i class="fas fa-map-marker-alt"></i> Track Delivery
            </a>`;
    }

    return `
        <div class="order-card">
            <div class="order-header">
                <div class="order-info">
                    <h3>Order #${order.orderId || order.id.slice(-4).toUpperCase()}</h3>
                    <p class="order-date">${createdAt}</p>
                </div>
                <span class="status-badge status-${order.status}">${statusLabel}</span>
            </div>

            ${productHtml}
            ${timelineHtml}

            <div class="payment-info">
                <i class="fas fa-credit-card"></i>
                <span style="font-size:13px; font-weight: 500;">
                    ${((order.paymentMethod || 'COD').toLowerCase().includes('cash') || (order.paymentMethod || 'COD') === 'COD') 
                        ? '<span class="text-warning"><i class="fas fa-clock me-1"></i> Pending Payment (COD)</span>' 
                        : '<span class="text-success"><i class="fas fa-check-circle me-1"></i> Total Paid Online</span>'} 
                    via <strong>${order.paymentMethod || 'COD'}</strong>
                </span>
            </div>

            ${trackBtn}
        </div>`;
}

/**
 * Render a history order card (with reorder button)
 */
function renderHistoryOrderCard(order) {
    const statusLabel = formatStatus(order.status, order.isPrepared);
    const createdAt = order.createdAt?.toDate
        ? order.createdAt.toDate().toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: 'numeric',
            month: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        })
        : 'N/A';

    // Get first item for display
    const firstItem = (order.items && order.items.length > 0) ? order.items[0] : null;
    const additionalItems = order.items ? order.items.length - 1 : 0;

    // Product display
    let productHtml = '';
    if (firstItem) {
        const imgSrc = firstItem.image || 'images/dummy.png';
        const productLink = getProductLink(firstItem.name);
        productHtml = `
            <div class="order-product">
                <div class="order-product-img">
                    <a href="${productLink}"><img src="${imgSrc}" alt="${firstItem.name}" onerror="this.src='images/dummy.png'"></a>
                </div>
                <div class="order-product-details">
                    <a href="${productLink}" style="text-decoration: none; color: inherit;"><p class="order-product-name">${firstItem.name}${firstItem.name.includes(firstItem.weight) ? '' : ' (' + (firstItem.weight || 'Std') + ')'}${additionalItems > 0 ? ` x ${order.items.reduce((sum, item) => sum + item.quantity, 0)}` : ` x ${firstItem.quantity}`}</p></a>
                    <p class="order-product-price">₹${(order.totalAmount || 0).toFixed(2)}</p>
                </div>
            </div>
        `;
    }

    // Cancellation alert for cancelled orders
    let alertHtml = '';
    if (order.status === 'CANCELLED') {
        alertHtml = `
            <div class="cancellation-alert">
                <i class="fas fa-exclamation-circle"></i>
                <div class="cancellation-alert-text">
                    <strong>Your order has been cancelled.</strong>
                    If you paid online, your refund will be processed within 24-48 hours.
                    <a href="tel:+917002568330">Contact Support</a>
                </div>
            </div>`;
    }

    // Reorder button (only for delivered orders)
    let reorderBtn = '';
    if (order.status === 'DELIVERED') {
        const orderData = encodeURIComponent(JSON.stringify(order.items || []));
        reorderBtn = `
            <button class="btn-reorder" onclick="reorderItems('${orderData}')">
                <i class="fas fa-redo"></i> Reorder
            </button>`;
    }

    return `
        <div class="order-card history-card">
            <div class="order-header">
                <div class="order-info">
                    <h3>Order #${order.orderId || order.id.slice(-4).toUpperCase()}</h3>
                    <p class="order-date">${createdAt}</p>
                </div>
                <span class="status-badge status-${order.status}">${statusLabel}</span>
            </div>

            ${productHtml}
            <div class="payment-info" style="margin-top:12px; border-top:1px solid #f0f0f0; padding-top:10px;">
                <i class="fas fa-credit-card"></i>
                <span style="font-size:13px; font-weight: 500;">
                    ${(order.status === 'DELIVERED') 
                        ? '<span class="text-success"><i class="fas fa-check-double me-1"></i> Total Paid</span>' 
                        : (((order.paymentMethod || 'COD').toLowerCase().includes('cash') || (order.paymentMethod || 'COD') === 'COD') 
                            ? '<span class="text-warning"><i class="fas fa-clock me-1"></i> Pending Payment (COD)</span>' 
                            : '<span class="text-success"><i class="fas fa-check-circle me-1"></i> Paid Online</span>')} 
                    via <strong>${order.paymentMethod || 'COD'}</strong>
                </span>
            </div>
            
            ${order.status === 'DELIVERED' ? `
                <div class="order-footer" style="margin-top:8px;">
                    <span></span>
                    ${reorderBtn}
                </div>
            ` : ''}

            ${alertHtml}
        </div>`;
}

/**
 * Render a visual status timeline.
 */
function renderTimeline(order) {
    const status = order.status;
    const isPrepared = order.isPrepared === true;

    const steps = [
        { key: 'PENDING_APPROVAL', label: 'Placed', icon: 'fa-check' },
        { key: 'PREPARING', label: 'Preparing', icon: 'fa-utensils' },
        { key: 'READY_FOR_PICKUP', label: 'Ready', icon: 'fa-box-open' },
        { key: 'OUT_FOR_DELIVERY', label: 'On Way', icon: 'fa-motorcycle' },
        { key: 'DELIVERED', label: 'Arrived', icon: 'fa-home' }
    ];

    if (status === 'CANCELLED') {
        return `
            <div class="status-timeline">
                <div class="timeline-step">
                    <div class="timeline-dot active"><i class="fas fa-check"></i></div>
                    <span class="timeline-label active">Placed</span>
                </div>
                <div class="timeline-step">
                    <div class="timeline-dot cancelled"><i class="fas fa-times"></i></div>
                    <span class="timeline-label" style="color: #f44336;">Cancelled</span>
                </div>
            </div>`;
    }

    const statusOrder = ['PENDING_APPROVAL', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED'];

    // Determine current visual status index
    let currentIndex = statusOrder.indexOf(status);
    if (status === 'PREPARING' && isPrepared) {
        currentIndex = statusOrder.indexOf('READY_FOR_PICKUP');
    }

    let html = '<div class="status-timeline">';
    steps.forEach((step, i) => {
        const isActive = i < currentIndex;
        const isCurrent = i === currentIndex;
        const isPending = i > currentIndex;

        let dotClass = 'timeline-dot';
        let labelClass = 'timeline-label';

        if (isActive) {
            dotClass += ' active';
            labelClass += ' active';
        } else if (isCurrent) {
            dotClass += ' current';
            labelClass += ' current';
        } else {
            dotClass += ' pending';
        }

        html += `
            <div class="timeline-step">
                <div class="${dotClass}">
                    <i class="fas ${step.icon}"></i>
                </div>
                <span class="${labelClass}">${step.label}</span>
            </div>`;
    });
    html += '</div>';
    return html;
}

function formatStatus(status, isPrepared = false) {
    if (status === 'PREPARING' && isPrepared) return 'Ready for Pickup';
    const map = {
        'PENDING_APPROVAL': 'Pending',
        'PREPARING': 'Preparing',
        'OUT_FOR_DELIVERY': 'On The Way',
        'DELIVERED': 'Delivered',
        'CANCELLED': 'Cancelled'
    };
    return map[status] || status;
}

// Reorder function - saves items to session storage and goes directly to checkout
window.reorderItems = async function (encodedItems) {
    try {
        const user = auth.currentUser;
        if (!user) {
            return;
        }

        const items = JSON.parse(decodeURIComponent(encodedItems));

        if (!items || items.length === 0) {
            showAlert('No items found to reorder.', 'Error', 'error');
            return;
        }

        // Show loading state
        showAlert('Preparing your reorder...', 'Just a moment', 'info');

        /**
         * DIRECT REORDER LOGIC:
         * Instead of wiping the user's current Firestore cart, we store the reorder items
         * in sessionStorage. check_out.js will then prioritize these items if the 
         * 'reorder=true' flag is present in the URL.
         */
        sessionStorage.setItem('reorderItems', JSON.stringify(items));
        
        // Redirect to checkout with reorder flag
        window.location.href = 'check_out.html?reorder=true';
    } catch (e) {
        console.error('Error reordering items:', e);
        showAlert('Could not process reorder. Please try again.', 'Reorder Error', 'error');
    }
};

