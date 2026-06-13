// order_track.js
// Handles real-time order tracking map using MapTiler SDK

import { app, auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

(function () {
    if (typeof maptilersdk === 'undefined') {
        console.error("[TRACKING] maptilersdk is not loaded. Map will not initialize.");
        const titleEl = document.getElementById('order-status-text');
        if (titleEl) titleEl.innerText = "Tracking Engine Error";
        return;
    }

    const MAPTILER_KEY = 'W3AiGlyaiQBixFytnKpU';
    maptilersdk.config.apiKey = MAPTILER_KEY;

    let map = null;
    let riderMarker = null;
    let customerMarker = null;
    let orderId = decodeURIComponent(new URLSearchParams(window.location.search).get('orderId') || '');
    let riderUnsubscribe = null;

    // ─── ETA state (persists across order snapshots) ─────────────────────────
    let lastCalculatedETA = null;   // e.g. "12" (minutes as string)
    let etaCountdownInterval = null; // ticks down the displayed minutes live
    let etaLastUpdatedAt = null;     // Date when lastCalculatedETA was set

    if (!orderId) {
        console.error("No orderId found in URL");
        return;
    }

    const orderIdDisplay = document.getElementById('display-order-id');
    if (orderIdDisplay) orderIdDisplay.innerText = `#${orderId.substring(0, 8)}`;

    // ─── Map helpers ──────────────────────────────────────────────────────────
    function initTrackMap(customerLat, customerLng) {
        const mapEl = document.getElementById('map');
        if (!mapEl) return;
        mapEl.style.display = 'block';
        if (map) return;

        map = new maptilersdk.Map({
            container: 'map',
            style: maptilersdk.MapStyle.STREETS,
            center: [customerLng, customerLat],
            zoom: 15,
            attributionControl: false
        });

        customerMarker = new maptilersdk.Marker({ color: "#ff0000" })
            .setLngLat([customerLng, customerLat])
            .setPopup(new maptilersdk.Popup().setHTML("<b>Your Location</b>"))
            .addTo(map);
    }

    function updateRiderMarker(lat, lng) {
        if (!map) return;

        if (riderMarker) {
            riderMarker.setLngLat([lng, lat]);
        } else {
            const el = document.createElement('div');
            el.className = 'rider-marker';
            el.innerHTML = '<i class="fas fa-motorcycle" style="color: white; background: #ff7c08; padding: 10px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.2);"></i>';
            riderMarker = new maptilersdk.Marker({ element: el })
                .setLngLat([lng, lat])
                .addTo(map);
        }

        if (customerMarker && riderMarker) {
            const bounds = new maptilersdk.LngLatBounds()
                .extend(customerMarker.getLngLat())
                .extend(riderMarker.getLngLat());
            map.fitBounds(bounds, { padding: 50, maxZoom: 16 });
        }
    }

    // ─── Distance (Haversine) ─────────────────────────────────────────────────
    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // ─── Live countdown (ticks every minute) ─────────────────────────────────
    function startETACountdown(initialMins) {
        // Clear any existing countdown
        if (etaCountdownInterval) clearInterval(etaCountdownInterval);

        let remaining = initialMins;
        renderETA(remaining);

        etaCountdownInterval = setInterval(() => {
            remaining = Math.max(1, remaining - 1);
            renderETA(remaining);
        }, 60 * 1000); // tick every 60 s
    }

    function renderETA(mins) {
        const etaMinsEl = document.getElementById('eta-mins');
        const statusTitle = document.getElementById('order-status-text');
        const etaDisplay = document.getElementById('arrival-time-display');

        const label = mins <= 1 ? 'less than 1 min' : `${mins} mins`;

        if (etaMinsEl) etaMinsEl.innerText = label;
        if (etaDisplay) etaDisplay.style.display = 'block';
        if (statusTitle) statusTitle.innerText = `Arriving in ${label}`;

        // Keep module-level state in sync so updateStatusUI uses the latest value
        lastCalculatedETA = mins.toString();
    }

    // ─── Rider location listener ──────────────────────────────────────────────
    function startRiderLocationListener(riderId, customerLat, customerLng) {
        if (riderUnsubscribe) riderUnsubscribe();
        if (!riderId) {
            console.warn("[TRACKING] Cannot start rider listener: riderId missing");
            return;
        }

        console.log("[TRACKING] Starting live rider location listener for:", riderId);

        const riderRef = doc(db, "riders", riderId);
        riderUnsubscribe = onSnapshot(riderRef, (docSnap) => {
            if (!docSnap.exists()) {
                console.warn("[TRACKING] Rider doc not found yet:", riderId);
                return;
            }

            const riderData = docSnap.data();
            console.log("[TRACKING] Rider data:", riderData);

            if (!riderData.location) {
                console.warn("[TRACKING] No location field yet. Waiting...");
                return;
            }

            // Support both Firestore GeoPoint (.latitude/.longitude)
            // and plain object {lat, lng}
            const rLat = riderData.location.latitude ?? riderData.location.lat;
            const rLng = riderData.location.longitude ?? riderData.location.lng;

            if (rLat == null || rLng == null) {
                console.warn("[TRACKING] Invalid location coords:", riderData.location);
                return;
            }

            // Move rider pin on map
            updateRiderMarker(rLat, rLng);

            // ── ETA Calculation ──────────────────────────────────────────────
            // Straight-line distance then apply local speed + traffic factor
            const distKm = calculateDistance(rLat, rLng, customerLat, customerLng);

            // Silchar urban delivery: ~20 km/h with 1.35 routing factor
            const avgSpeedKmh = 20;
            const routingFactor = 1.35;  // roads are never straight
            const rawMins = (distKm * routingFactor / avgSpeedKmh) * 60;

            // Clamp: minimum 2 mins, add 1 min buffer, round
            const etaMins = Math.max(2, Math.round(rawMins) + 1);

            console.log(`[TRACKING] Distance: ${distKm.toFixed(2)} km → ETA: ${etaMins} mins`);

            // Only restart countdown if ETA changed by more than 1 min
            // (avoids jittery UI on micro GPS updates)
            const prev = lastCalculatedETA ? parseInt(lastCalculatedETA) : null;
            if (prev === null || Math.abs(etaMins - prev) >= 1) {
                lastCalculatedETA = etaMins.toString();
                etaLastUpdatedAt = new Date();
                startETACountdown(etaMins);
            }

        }, (error) => {
            console.error("[TRACKING] Rider listener error:", error);
        });
    }

    // ─── Auth + Order listener ────────────────────────────────────────────────
    // ─── Auth + Order listener ────────────────────────────────────────────────
    onAuthStateChanged(auth, user => {
        console.log("[TRACKING] Auth check:", user ? `Authenticated as ${user.uid}` : "Not authenticated");
        
        if (!user) {
            const el = document.getElementById('order-status-text');
            if (el) el.innerText = "Please Login";
            console.error("[TRACKING] User not logged in. Redirecting to login...");
            window.location.href = "sign_in.html";
            return;
        }


        let customerLat = null;
        let customerLng = null;
        let currentRiderId = null;

        console.log("[TRACKING] Fetching order:", orderId);
        onSnapshot(doc(db, "orders", orderId), (docSnap) => {
            if (!docSnap.exists()) {
                console.error("[TRACKING] Order document doesn't exist:", orderId);
                const statusEl = document.getElementById('order-status-text');
                if (statusEl) statusEl.innerText = "Order Not Found";
                const badgeEl = document.getElementById('top-status-badge');
                if (badgeEl) badgeEl.innerText = "Error";
                return;
            }

            const order = docSnap.data();
            console.log("[TRACKING] Order update:", order.status, order);

            // Extract customer delivery location once
            if (!customerLat || !customerLng) {
                const loc = order.deliveryLocation || order.location;
                if (loc) {
                    customerLat = loc.latitude ?? loc.lat;
                    customerLng = loc.longitude ?? loc.lng;
                    if (customerLat && customerLng) {
                        console.log("[TRACKING] Init map at:", customerLat, customerLng);
                        initTrackMap(customerLat, customerLng);
                    }
                } else {
                    console.warn("[TRACKING] Order has no destination coordinates.");
                }
            }

            // Update all UI (passes current ETA state in)
            updateStatusUI(order);

            if (order.status === 'OUT_FOR_DELIVERY') {
                // Show rider overlay
                const riderInfo = document.getElementById('rider-info-section');
                if (riderInfo) riderInfo.style.display = 'block';

                const riderNameEl = document.getElementById('rider-name');
                if (riderNameEl) riderNameEl.innerText = order.riderName || "Rider";

                const callBtn = document.getElementById('call-rider');
                if (callBtn && order.riderPhone) {
                    callBtn.href = `tel:${order.riderPhone}`;
                    callBtn.classList.remove('d-none');
                }

                // Start location listener only once (or if riderId changed)
                if (order.riderId && customerLat && customerLng && order.riderId !== currentRiderId) {
                    currentRiderId = order.riderId;
                    console.log("[TRACKING] Starting live rider listener for:", order.riderId);
                    startRiderLocationListener(order.riderId, customerLat, customerLng);
                }

            } else {
                // Not out for delivery — hide rider UI, stop countdown
                const riderInfo = document.getElementById('rider-info-section');
                if (riderInfo) riderInfo.style.display = 'none';
                if (riderUnsubscribe) { riderUnsubscribe(); riderUnsubscribe = null; }
                if (etaCountdownInterval) { clearInterval(etaCountdownInterval); etaCountdownInterval = null; }
                lastCalculatedETA = null;
                currentRiderId = null;
            }

        }, (error) => {
            console.error("[TRACKING] Firestore Order listener permission/network error:", error);
            const statusEl = document.getElementById('order-status-text');
            if (statusEl) {
                statusEl.innerText = error.code === 'permission-denied' ? "Access Denied" : "Sync Error";
                statusEl.style.color = 'var(--danger)';
            }
            const badgeEl = document.getElementById('top-status-badge');
            if (badgeEl) {
                badgeEl.innerText = "Error";
                badgeEl.style.background = '#fee2e2';
                badgeEl.style.color = '#ef4444';
            }
        });
    });

    // ─── Status UI updater ────────────────────────────────────────────────────
    function updateStatusUI(order) {
        const displayOrderId = document.getElementById('display-order-id');
        if (displayOrderId && orderId) {
            displayOrderId.innerText = `Order #${orderId.substring(0, 8).toUpperCase()}`;
        }

        const statusText   = document.getElementById('order-status-text');
        const statusDesc   = document.getElementById('order-status-desc');
        const topBadge     = document.getElementById('top-status-badge');
        const etaDisplay   = document.getElementById('arrival-time-display');
        const etaMinsEl    = document.getElementById('eta-mins');
        const progressFill = document.getElementById('progress-fill');

        // Build ETA label from live countdown state (never falls back to "Calculating")
        let etaLabel = null;
        if (lastCalculatedETA) {
            const mins = parseInt(lastCalculatedETA);
            etaLabel = mins <= 1 ? 'less than 1 min' : `${mins} mins`;
        }

        const stagesInfo = {
            'PENDING_APPROVAL': {
                badge: 'Order Received', badgeColor: '#feebe0', badgeText: 'var(--primary)',
                title: 'Order Placed',
                desc: 'Waiting for restaurant confirmation',
                progressHeight: '0%', currentStageId: 'stage-pending-approval'
            },
            'PENDING': {
                badge: 'Order Received', badgeColor: '#feebe0', badgeText: 'var(--primary)',
                title: 'Order Placed',
                desc: 'Waiting for restaurant confirmation',
                progressHeight: '0%', currentStageId: 'stage-pending-approval'
            },
            'PREPARING': {
                badge: 'In Kitchen', badgeColor: '#feebe0', badgeText: 'var(--primary)',
                title: 'Preparing Your Meat',
                desc: 'Chef is preparing your premium cuts',
                progressHeight: '25%', currentStageId: 'stage-preparing'
            },
            'READY_FOR_PICKUP': {
                badge: 'Ready', badgeColor: '#e0fef0', badgeText: '#155724',
                title: 'Order Prepared',
                desc: 'Waiting for rider to accept',
                progressHeight: '50%', currentStageId: 'stage-ready-pickup'
            },
            'OUT_FOR_DELIVERY': {
                badge: 'In Transit', badgeColor: '#feebe0', badgeText: 'var(--primary)',
                // Use live ETA if available, otherwise show a pulsing "On the way" — never "Calculating"
                title: etaLabel ? `Arriving in ${etaLabel}` : 'On the way to you...',
                desc: `${order.riderName || 'Your rider'} is on the way to your location`,
                progressHeight: '75%', currentStageId: 'stage-out-for-delivery'
            },
            'DELIVERED': {
                badge: 'Complete', badgeColor: '#d4edda', badgeText: '#155724',
                title: 'Order Delivered',
                desc: 'Enjoy your MeatDae experience!',
                progressHeight: '100%', currentStageId: 'stage-delivered'
            },
            'CANCELLED': {
                badge: 'Cancelled', badgeColor: '#f8d7da', badgeText: '#721c24',
                title: 'Order Cancelled',
                desc: 'This order was cancelled.',
                progressHeight: '0%', currentStageId: null
            }
        };

        // Virtual status for Ready for Pickup
        let statusKey = order.status;
        if (order.status === 'PREPARING' && order.isPrepared === true) {
            statusKey = 'READY_FOR_PICKUP';
        }

        const current = stagesInfo[statusKey] || stagesInfo['PENDING'];

        // Header
        if (statusText) statusText.innerText = current.title;
        if (topBadge) {
            topBadge.innerText = current.badge;
            topBadge.style.background = current.badgeColor;
            topBadge.style.color = current.badgeText;
        }

        // ETA strip & description strip
        if (order.status === 'OUT_FOR_DELIVERY') {
            if (statusDesc) statusDesc.style.display = 'none';

            // If we already have a live ETA, show it; otherwise show strip with "On the way"
            if (etaDisplay) etaDisplay.style.display = 'block';
            if (etaMinsEl && etaLabel) etaMinsEl.innerText = etaLabel;

        } else {
            if (statusDesc) {
                statusDesc.style.display = 'block';
                statusDesc.innerText = current.desc;
            }
            if (etaDisplay) etaDisplay.style.display = 'none';
        }

        // Progress line
        if (progressFill) progressFill.style.height = current.progressHeight;

        // Timeline dots
        const stageIds = ['stage-pending-approval', 'stage-preparing', 'stage-ready-pickup', 'stage-out-for-delivery', 'stage-delivered'];
        let activeFound = false;
        stageIds.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.classList.remove('active', 'done');
            if (id === current.currentStageId) {
                el.classList.add('active');
                activeFound = true;
            } else if (!activeFound) {
                el.classList.add('done');
            }
        });

        // Rider name in timeline
        if (order.status === 'OUT_FOR_DELIVERY' && order.riderName) {
            const outDesc = document.getElementById('out-desc');
            if (outDesc) outDesc.innerText = `${order.riderName} is on the way to your location`;
        }

        populateOrderSummary(order);
    }

    let isSummaryPopulated = false;

    function populateOrderSummary(order) {
        if (isSummaryPopulated) return;

        const summaryTopTotal = document.getElementById('summary-top-total');
        if (summaryTopTotal) summaryTopTotal.innerText = `₹${order.totalAmount || order.total || 0}`;

        const container = document.getElementById('order-items-container');
        if (!container) return;
        container.innerHTML = '';

        const itemsList = order.items || order.cart || [];
        let calculatedSubtotal = 0;

        if (itemsList && itemsList.length > 0) {
            itemsList.forEach(item => {
                const price = item.price || 0;
                const qty   = item.quantity || 1;
                const name  = item.name || item.productName || 'Item';
                const weight = item.weight || item.size || 'Standard';
                const itemTotal = price * qty;
                calculatedSubtotal += itemTotal;

                container.innerHTML += `
                    <div class="item-row">
                        <div class="step-icon" style="width:35px;height:35px;background:#f8f9fa;border:none;margin-right:15px;">
                            <i class="fas fa-utensils" style="color:#999;font-size:14px;"></i>
                        </div>
                        <div class="item-info">
                            <div class="item-name">${qty}x ${name}</div>
                            <div class="item-variant">${weight}</div>
                        </div>
                        <div class="item-price">₹${itemTotal.toFixed(2)}</div>
                    </div>`;
            });
        } else {
            container.innerHTML = `<div class="text-muted text-center" style="padding:10px 0;">No item details available</div>`;
        }

        const finalDelivery  = order.deliveryCharge || order.deliveryFee || 0;
        const finalDiscount  = order.discountAmount || order.discount || 0;
        const finalTotal     = order.totalAmount || order.total || 0;
        const finalSubtotal  = calculatedSubtotal || (finalTotal - finalDelivery + finalDiscount);

        const subEl = document.getElementById('summary-subtotal');
        const delEl = document.getElementById('summary-delivery');
        const finEl = document.getElementById('summary-final');

        if (subEl) subEl.innerText = `₹${finalSubtotal.toFixed(2)}`;
        if (delEl) delEl.innerText = `₹${finalDelivery.toFixed(2)}`;
        if (finEl) finEl.innerText = `₹${finalTotal.toFixed(2)}`;

        if (finalDiscount > 0) {
            const dRow = document.getElementById('discount-row');
            if (dRow) dRow.style.display = 'flex';
            const dEl = document.getElementById('summary-discount');
            if (dEl) dEl.innerText = `-₹${finalDiscount.toFixed(2)}`;
        }

        isSummaryPopulated = true;
    }
})();
