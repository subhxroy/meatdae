// js/order-notifier.js
// Monitors active orders and adds a 'glowing' effect to the Orders navigation icon

import { app, auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { collection, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

const ACTIVE_STATUSES = ['PENDING_APPROVAL', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'];

function updateOrderNotification(hasActiveOrders) {
    // Use partial match to work on both localhost (.html) and Netlify (pretty URLs without .html)
    const ordersNavItem = document.querySelector('.bottom-nav-item[href*="my_orders"]');
    if (!ordersNavItem) {
        console.warn('[OrderNotifier] Orders nav item not found');
        return;
    }

    if (hasActiveOrders) {
        ordersNavItem.classList.add('blink-orders');
        console.log('[OrderNotifier] Active orders found – blinking enabled');
    } else {
        ordersNavItem.classList.remove('blink-orders');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, (user) => {
        if (!user) {
            updateOrderNotification(false);
            return;
        }

        // Listen for active orders
        const ordersRef = collection(db, "orders");
        // We query all orders for the user and filter locally to avoid complex indexes for this simple feature
        const q = query(ordersRef, where("userId", "==", user.uid));

        onSnapshot(q, (snapshot) => {
            let hasActive = false;
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                const status = (data.status || "").toUpperCase();
                if (['PENDING_APPROVAL', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'PENDING', 'READY'].includes(status)) {
                    hasActive = true;
                }
            });
            updateOrderNotification(hasActive);
        }, (error) => {
            console.error("Order notifier failed:", error);
        });
    });
});
