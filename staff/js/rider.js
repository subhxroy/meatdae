// rider.js
// Handles rider dashboard, live GPS tracking, and delivery navigation using MapTiler SDK

import { app, auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { doc, getDoc, updateDoc, setDoc, addDoc, collection, query, where, onSnapshot, GeoPoint, serverTimestamp, orderBy } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

(function () {
    const MAPTILER_KEY = 'W3AiGlyaiQBixFytnKpU';
    maptilersdk.config.apiKey = MAPTILER_KEY;

    let riderMap = null;
    let riderMarker = null;
    let customerMarker = null;
    let currentRider = null;
    let watchId = null;
    
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

    const initRider = (user, userData) => {
        if (userData && (userData.role === 'rider' || userData.role === 'admin')) {
            currentRider = { id: user.uid, ...userData };
            const authScreen = document.getElementById('auth-screen');
            const riderContent = document.getElementById('rider-content');
            
            // Layout loader handles basic visibility, but we ensure correct element here
            if (authScreen) authScreen.style.display = 'none';
            if (riderContent) riderContent.style.display = 'block';

            // Show admin back link if applicable
            if (userData.role === 'admin') {
                const adminLink = document.getElementById('admin-back-link');
                if (adminLink) adminLink.style.display = 'inline-block';
            }

            startGpsTracking();
            listenForDeliveries();
            listenForRiderStats();
        } else {
            const authScreen = document.getElementById('auth-screen');
            if (authScreen) {
                authScreen.style.display = 'block';
                authScreen.innerHTML = `
                    <div class="alert alert-danger mt-5 text-center mx-auto" style="max-width: 400px;">
                        <h5><i class="fas fa-ban me-2"></i>Access Denied</h5>
                        <p>Your account does not have rider access.</p>
                        <a href="index.html" class="btn btn-outline-dark mt-2">Go Home</a>
                    </div>`;
            }
        }
    };

    if (window.staffRecord) {
        initRider(window.staffRecord.user, window.staffRecord.userData);
    } else {
        window.addEventListener('staffAuthReady', (e) => {
            initRider(e.detail.user, e.detail.userData);
        });
    }

    function listenForRiderStats() {
        if (!currentRider) return;
        const statsRow = document.getElementById('rider-stats-row');
        const dateInput = document.getElementById('rider-stats-date');
        
        if (statsRow) statsRow.style.display = 'flex';
        if (dateInput && !dateInput.value) {
            dateInput.value = new Date().toISOString().split('T')[0];
        }

        const ordersRef = collection(db, "orders");
        const qStats = query(ordersRef, 
            where("riderId", "==", currentRider.id), 
            where("status", "in", ["DELIVERED", "Delivered", "OUT_FOR_DELIVERY"])
        );

        let cachedSnap = null;
        let cachedSettlements = [];

        // Listen to settlements for this rider
        const settlementsRef = collection(db, "rider_settlements");
        const qSettlements = query(settlementsRef, where("riderId", "==", currentRider.id));
        
        onSnapshot(qSettlements, (snap) => {
            cachedSettlements = [];
            snap.forEach(docSnap => cachedSettlements.push({ id: docSnap.id, ...docSnap.data() }));
            updateUI(cachedSnap);
        }, (error) => {
            console.error("Settlements query failed:", error);
        });

        const updateUI = (snap) => {
            if (!snap) return;
            const selectedDate = dateInput?.value || new Date().toISOString().split('T')[0];
            
            let count = 0;
            let cod = 0;
            let online = 0;

            snap.forEach(docSnap => {
                const order = docSnap.data();
                const createdAt = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
                const orderDateStr = createdAt.toISOString().split('T')[0];

                if (orderDateStr === selectedDate) {
                    if (order.status === 'DELIVERED' || order.status === 'Delivered') {
                        count++;
                    }
                    
                    const amount = Number(order.totalAmount || 0);
                    if (order.paymentMethod === 'COD' || order.paymentMethod === 'Cash on Delivery') {
                        cod += amount;
                    } else {
                        online += amount;
                    }
                }
            });

            // Update basic stats
            const deliveriesEl = document.getElementById('rider-stat-deliveries');
            const incomeEl = document.getElementById('rider-stat-income');
            const codEl = document.getElementById('rider-stat-cod');
            const onlineEl = document.getElementById('rider-stat-online');

            if (deliveriesEl) deliveriesEl.innerText = count;
            if (incomeEl) incomeEl.innerText = `₹${(cod + online).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
            if (codEl) codEl.innerText = `₹${cod.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
            if (onlineEl) onlineEl.innerText = `₹${online.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

            // --- COD Settlement Status ---
            const settlement = cachedSettlements.find(s => s.date === selectedDate);
            const pendingEl = document.getElementById('rider-cod-pending');
            const settledEl = document.getElementById('rider-cod-settled');
            const statusBadge = document.getElementById('settlement-status-badge');
            const submitBtn = document.getElementById('btn-submit-cod');

            if (settlement) {
                if (settlement.status === 'SETTLED') {
                    // Admin approved — all settled
                    if (pendingEl) pendingEl.innerText = '₹0.00';
                    if (settledEl) settledEl.innerText = `₹${cod.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
                    if (statusBadge) {
                        statusBadge.style.display = 'block';
                        statusBadge.innerHTML = '<span class="badge bg-success px-3 py-2" style="font-size: 12px;"><i class="fas fa-check-circle me-1"></i> Payment Settled by Admin</span>';
                    }
                    if (submitBtn) submitBtn.style.display = 'none';
                } else if (settlement.status === 'PENDING_APPROVAL') {
                    // Rider submitted, waiting for admin
                    if (pendingEl) pendingEl.innerText = `₹${cod.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
                    if (settledEl) settledEl.innerText = '₹0.00';
                    if (statusBadge) {
                        statusBadge.style.display = 'block';
                        statusBadge.innerHTML = '<span class="badge bg-warning text-dark px-3 py-2" style="font-size: 12px;"><i class="fas fa-clock me-1"></i> Awaiting Admin Approval</span>';
                    }
                    if (submitBtn) {
                        submitBtn.style.display = 'block';
                        submitBtn.disabled = true;
                        submitBtn.innerHTML = '<i class="fas fa-hourglass-half me-2"></i>Awaiting Approval';
                        submitBtn.style.background = '#ffc107';
                        submitBtn.style.color = '#333';
                    }
                }
            } else {
                // No settlement submitted yet
                if (pendingEl) pendingEl.innerText = `₹${cod.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
                if (settledEl) settledEl.innerText = '₹0.00';
                if (statusBadge) statusBadge.style.display = 'none';
                if (submitBtn) {
                    if (cod > 0) {
                        submitBtn.style.display = 'block';
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = '<i class="fas fa-paper-plane me-2"></i>Submit COD Payment';
                        submitBtn.style.background = 'linear-gradient(135deg, var(--primary), #e06500)';
                        submitBtn.style.color = 'white';
                    } else {
                        submitBtn.style.display = 'none';
                    }
                }
            }
        };

        if (dateInput) {
            dateInput.addEventListener('change', () => updateUI(cachedSnap));
        }

        onSnapshot(qStats, (snap) => {
            cachedSnap = snap;
            updateUI(snap);
        }, (error) => {
            console.error("Stats query failed:", error);
        });

        // --- Submit COD Payment function ---
        window.submitCODPayment = async () => {
            if (!currentRider) return;
            const dateInput = document.getElementById('rider-stats-date');
            const selectedDate = dateInput?.value || new Date().toISOString().split('T')[0];
            
            // Calculate today's COD from cached data
            let todayCOD = 0;
            let todayOnline = 0;
            let todayDeliveries = 0;
            if (cachedSnap) {
                cachedSnap.forEach(docSnap => {
                    const order = docSnap.data();
                    const createdAt = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
                    const orderDateStr = createdAt.toISOString().split('T')[0];
                    if (orderDateStr === selectedDate && (order.status === 'DELIVERED' || order.status === 'Delivered')) {
                        todayDeliveries++;
                        const amount = Number(order.totalAmount || 0);
                        if (order.paymentMethod === 'COD' || order.paymentMethod === 'Cash on Delivery') {
                            todayCOD += amount;
                        } else {
                            todayOnline += amount;
                        }
                    }
                });
            }

            if (todayCOD <= 0) {
                alert("No COD amount to submit for this date.");
                return;
            }

            if (!confirm(`Submit COD payment of ₹${todayCOD.toFixed(2)} to the owner for ${selectedDate}?`)) return;

            const submitBtn = document.getElementById('btn-submit-cod');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Submitting...';
            }

            try {
                await addDoc(collection(db, "rider_settlements"), {
                    riderId: currentRider.id,
                    riderName: currentRider.name || "Rider",
                    date: selectedDate,
                    codAmount: todayCOD,
                    onlineAmount: todayOnline,
                    deliveryCount: todayDeliveries,
                    status: "PENDING_APPROVAL",
                    requestedAt: serverTimestamp(),
                    approvedAt: null,
                    approvedBy: null
                });
                alert("COD payment submitted! Waiting for admin approval.");
            } catch (e) {
                console.error("Settlement submit error:", e);
                alert("Failed to submit: " + e.message);
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i class="fas fa-paper-plane me-2"></i>Submit COD Payment';
                }
            }
        };
    }

    function startGpsTracking() {
        if (!navigator.geolocation) return;

        watchId = navigator.geolocation.watchPosition(
            (pos) => {
                const { latitude, longitude } = pos.coords;
                updateRiderLocation(latitude, longitude);
                
                const badge = document.getElementById('gps-badge');
                if (badge) {
                    badge.className = 'gps-status gps-active';
                    badge.innerHTML = '<span class="gps-dot active"></span> GPS Active';
                }
            },
            (err) => {
                console.error("GPS Error:", err);
                const badge = document.getElementById('gps-badge');
                if (badge) {
                    badge.className = 'gps-status gps-inactive';
                    badge.innerHTML = '<span class="gps-dot inactive"></span> GPS Error';
                }
            },
            { enableHighAccuracy: true }
        );
    }

    async function updateRiderLocation(lat, lng) {
        if (!currentRider) return;
        
        // Update user profile
        await updateDoc(doc(db, "users", currentRider.id), {
            lastLocation: new GeoPoint(lat, lng),
            lastUpdated: new Date()
        });
        // Sync to riders collection (watched by customer tracking page)
        await setDoc(doc(db, "riders", currentRider.id), {
            location: new GeoPoint(lat, lng),
            lastUpdated: new Date(),
            riderName: currentRider.name || "Rider"
        }, { merge: true });

        // Update map if active delivery
        if (riderMap) {
            updateRiderMarkerOnMap(lat, lng);
        }
    }

    function listenForDeliveries() {
        const ordersRef = collection(db, "orders");
        
        // 1. Listen for available orders (PENDING_APPROVAL or PREPARING)
        const setupAvailableListener = (q, isFallback = false) => {
            return onSnapshot(q, (snap) => {
                const list = document.getElementById('available-deliveries');
                if (!list) return;
                list.innerHTML = '';
                
                if (snap.empty) {
                    list.innerHTML = '<div class="empty-state"><i class="fas fa-motorcycle"></i><p>No new deliveries available</p></div>';
                    return;
                }

                let docs = [];
                snap.forEach(docSnap => {
                    docs.push({ id: docSnap.id, data: docSnap.data() });
                });

                if (isFallback) {
                    // Sort client-side by createdAt asc
                    docs.sort((a, b) => {
                        const aTime = a.data.createdAt?.toDate ? a.data.createdAt.toDate().getTime() : 0;
                        const bTime = b.data.createdAt?.toDate ? b.data.createdAt.toDate().getTime() : 0;
                        return aTime - bTime;
                    });
                }

                docs.forEach(item => {
                    renderDeliveryCard(item.id, item.data, list);
                });
            }, (error) => {
                console.warn("Available deliveries query failed (likely missing index). Trying fallback.", error);
                if (!isFallback) {
                    // Fall back to a query without orderBy
                    const qFallback = query(ordersRef, 
                        where("status", "in", ["PENDING_APPROVAL", "PREPARING"])
                    );
                    setupAvailableListener(qFallback, true);
                } else {
                    const list = document.getElementById('available-deliveries');
                    if (list) {
                        list.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle text-danger"></i><p>Error loading deliveries</p></div>';
                    }
                }
            });
        };

        const qAvailable = query(ordersRef, 
            where("status", "in", ["PENDING_APPROVAL", "PREPARING"]),
            orderBy("createdAt", "asc")
        );
        setupAvailableListener(qAvailable, false);

        // 2. Listen for active delivery by this rider (OUT_FOR_DELIVERY)
        const qActive = query(collection(db, "orders"), 
            where("riderId", "==", currentRider.id), 
            where("status", "==", "OUT_FOR_DELIVERY")
        );
        onSnapshot(qActive, (snap) => {
            const container = document.getElementById('active-delivery-section');
            if (!container) return;
            container.innerHTML = '';
            
            if (snap.empty) {
                container.style.display = 'none';
                if (riderMap) {
                    riderMap.remove();
                    riderMap = null;
                }
                return;
            }

            container.style.display = 'block';
            snap.forEach(docSnap => {
                const order = docSnap.data();
                renderActiveDelivery(docSnap.id, order, container);
            });
        }, (error) => {
            console.error("Active delivery query failed:", error);
            const container = document.getElementById('active-delivery-section');
            if (container) container.style.display = 'none';
        });
    }

    function renderActiveDelivery(id, order, container) {
        const phone = order.customerPhone || order.deliveryInfo?.phone || order.phone || 'N/A';
        const address = order.deliveryInfo?.address || order.address || 'N/A';
        
        // --- Priority & Time Info ---
        const priority = getPriorityInfo(order.createdAt);
        const timeStr = order.createdAt?.toDate ? order.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A';
        
        // Build maps URL (prefer coordinates if available)
        let mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
        const loc = order.deliveryLocation || order.location;
        const hasLocation = loc && (loc.latitude || loc.lat);
        if (hasLocation) {
            mapsUrl = `https://www.google.com/maps/search/?api=1&query=${loc.latitude || loc.lat},${loc.longitude || loc.lng}`;
        }

        let itemsHtml = '';
        const isCOD = order.paymentMethod === 'COD' || order.paymentMethod === 'Cash on Delivery';
        const paymentLabel = isCOD ? 'COLLECT CASH' : 'PAID ONLINE';
        const paymentClass = isCOD ? 'bg-danger' : 'bg-success';
        const paymentIcon = isCOD ? 'fa-wallet' : 'fa-credit-card';

        if (order.items && order.items.length > 0) {
            itemsHtml = `
            <div class="mt-3 p-3 text-center ${paymentClass} text-white" style="border-radius: 12px; font-family: 'Barlow', sans-serif;">
                <div style="font-size: 11px; font-weight: 700; opacity: 0.9; text-transform: uppercase; letter-spacing: 1px;">Payment Method: ${order.paymentMethod || 'COD'}</div>
                <div class="d-flex align-items-center justify-content-center gap-2 mt-1">
                    <i class="fas ${paymentIcon} fs-5"></i>
                    <span style="font-size: 20px; font-weight: 800;">${paymentLabel}: ₹${(order.totalAmount || 0).toFixed(2)}</span>
                </div>
            </div>

            <div class="items-list" style="background: #f8f9fa; border-radius: 8px; padding: 12px; margin: 15px 0;">
                <div style="font-weight: 700; font-size: 13px; color: #666; margin-bottom: 8px; text-transform: uppercase;">Order Items</div>
                ${order.items.map(i => `<div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size: 14px; color: #333;"><span>${i.quantity}x ${i.name} <small class="text-muted">(${i.weight || 'Std'})</small></span><span>₹${(i.price * i.quantity).toFixed(2)}</span></div>`).join('')}
                ${order.onlineFee > 0 ? `<div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size: 13px; color: #666; font-style: italic;"><span>Online processing fee</span><span>₹${order.onlineFee.toFixed(2)}</span></div>` : ''}
                <div style="border-top: 1px dashed #ccc; margin-top: 10px; padding-top: 10px; display:flex; justify-content:space-between; font-weight: bold; font-size: 16px; color: var(--primary);">
                    <span>Total Bill</span>
                    <span>₹${(order.totalAmount || 0).toFixed(2)}</span>
                </div>
            </div>`;
        }

        // Map or "No Location" warning
        let mapSection = '';
        if (hasLocation) {
            mapSection = `
                <div class="position-relative">
                    <div id="rider-map" style="height: 250px; border-radius:12px; margin: 15px 0;" class="border"></div>
                    <button type="button" id="btn-toggle-rider-style" class="btn btn-sm btn-light position-absolute shadow-sm" style="bottom: 30px; right: 10px; z-index: 100; border-radius: 6px; font-weight: 700; font-size: 11px; color: #333; border: 1px solid #ddd; background: rgba(255,255,255,0.95); padding: 5px 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.15);">
                        <i class="fas fa-layer-group me-1"></i> Satellite
                    </button>
                </div>`;
        } else {
            mapSection = `
                <div class="p-3 text-center" style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 12px; margin: 15px 0;">
                    <i class="fas fa-map-marker-alt" style="font-size: 28px; color: #856404; margin-bottom: 8px;"></i>
                    <div style="font-weight: 800; color: #856404; font-size: 14px;">Location Not Pinned</div>
                    <div style="font-size: 12px; color: #856404; margin-top: 4px;">Customer didn't pin their location on the map.<br>Use the address or call the customer for directions.</div>
                </div>`;
        }

        container.innerHTML = `
            <div class="active-delivery-banner">
                <h5><i class="fas fa-bolt me-2"></i>Active Delivery</h5>
                <p class="mb-0 small">Navigating to customer location</p>
            </div>
            <div class="delivery-card" style="border-top-left-radius:0; border-top-right-radius:0;">
                <div class="card-header-row">
                    <span class="order-id">#${id.substring(0, 8)}</span>
                    <span class="badge bg-warning text-dark">ON THE WAY</span>
                </div>

                <!-- Priority & Time Info (Prominent) -->
                <div class="d-flex justify-content-between align-items-center mb-3 p-3" style="background: #fff9f0; border: 1px solid #ffecb3; border-radius: 12px;">
                    <div style="font-size: 14px; font-weight: 700; color: #1a1a1a;">
                        <i class="fas fa-clock me-1 text-primary"></i>
                        Placed at ${timeStr}
                    </div>
                    <div class="d-flex align-items-center gap-2">
                        <span class="badge ${priority.class}" style="font-size: 12px; padding: 6px 12px;">
                            <i class="fas ${priority.icon} me-1"></i>
                            ${priority.label}
                        </span>
                        <span style="font-size: 12px; color: #666; font-weight: 700;">
                            ${priority.mins}m ago
                        </span>
                    </div>
                </div>

                <div class="detail-row">
                    <span class="detail-label">Customer:</span>
                    <span class="detail-value">${order.customerName || order.name || 'N/A'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Phone:</span>
                    <span class="detail-value"><strong>${phone}</strong></span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Address:</span>
                    <span class="detail-value">${address}</span>
                </div>
                <div class="detail-row" ${order.specialInstructions || order.deliveryInfo?.orderNotes ? '' : 'style="display:none;"'}>
                    <span class="detail-label">Note:</span>
                    <span class="detail-value text-danger fw-bold">${order.specialInstructions || order.deliveryInfo?.orderNotes || ''}</span>
                </div>
                
                ${itemsHtml}

                <div class="rider-actions-row">
                    <a href="tel:${phone}" class="btn-rider-action btn-call">
                        <i class="fas fa-phone-alt"></i> Call
                    </a>
                    <a href="${mapsUrl}" target="_blank" class="btn-rider-action btn-maps">
                        <i class="fas fa-directions"></i> Maps
                    </a>
                </div>

                ${mapSection}
                
                <button class="btn-delivered" onclick="window.completeDelivery('${id}')">
                    <i class="fas fa-check-double me-2"></i>MARK AS DELIVERED
                </button>
            </div>
        `;

        if (hasLocation) {
            const lat = loc.latitude || loc.lat;
            const lng = loc.longitude || loc.lng;
            if (lat && lng) {
                setTimeout(() => initRiderMap(lat, lng), 500);
            }
        }
    }

    function initRiderMap(customerLat, customerLng) {
        const mapContainer = document.getElementById('rider-map');
        if (!mapContainer || riderMap) return;
        
        riderMap = new maptilersdk.Map({
            container: 'rider-map',
            style: maptilersdk.MapStyle.STREETS,
            center: [customerLng, customerLat],
            zoom: 15,
        });

        // Toggle Style Button Logic
        const toggleBtn = document.getElementById('btn-toggle-rider-style');
        if (toggleBtn) {
            let isSatellite = false;
            toggleBtn.onclick = () => {
                isSatellite = !isSatellite;
                if (isSatellite) {
                    riderMap.setStyle(maptilersdk.MapStyle.SATELLITE);
                    toggleBtn.innerHTML = '<i class="fas fa-layer-group me-1"></i> Street';
                } else {
                    riderMap.setStyle(maptilersdk.MapStyle.STREETS);
                    toggleBtn.innerHTML = '<i class="fas fa-layer-group me-1"></i> Satellite';
                }
            };
        }

        // Add Customer Marker
        customerMarker = new maptilersdk.Marker({ color: "#ff0000" })
            .setLngLat([customerLng, customerLat])
            .addTo(riderMap);
            
        // If we already have rider position, add it
        if (watchId) {
            navigator.geolocation.getCurrentPosition(pos => {
                updateRiderMarkerOnMap(pos.coords.latitude, pos.coords.longitude);
            });
        }
    }

    function updateRiderMarkerOnMap(lat, lng) {
        if (!riderMap) return;
        
        if (riderMarker) {
            riderMarker.setLngLat([lng, lat]);
        } else {
            const el = document.createElement('div');
            el.innerHTML = '<i class="fas fa-motorcycle" style="color: white; background: #28a745; padding: 10px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.2);"></i>';
            riderMarker = new maptilersdk.Marker({ element: el })
                .setLngLat([lng, lat])
                .addTo(riderMap);
        }
    }

    function renderDeliveryCard(id, order, container) {
        const card = document.createElement('div');
        card.className = 'delivery-card';
        
        let badgeClass = 'bg-secondary';
        let badgeLabel = 'WAITING FOR ADMIN';
        let actionButtonHtml = `
            <button class="btn btn-sm btn-outline-secondary mt-3 w-100" disabled>
                <i class="fas fa-clock me-1"></i>WAITING FOR ADMIN
            </button>
        `;

        if (order.status === 'PREPARING') {
            if (order.isPrepared) {
                badgeClass = 'bg-info';
                badgeLabel = 'READY FOR PICKUP';
                actionButtonHtml = `
                    <button class="btn-accept-delivery mt-3" onclick="window.acceptDelivery('${id}')">
                        <i class="fas fa-motorcycle me-2"></i>PICK UP ORDER
                    </button>
                `;
            } else {
                badgeClass = 'bg-warning text-dark';
                badgeLabel = 'BEING PREPARED';
                actionButtonHtml = `
                    <button class="btn btn-sm btn-outline-warning mt-3 w-100" disabled style="color:#666; border-color:#ffc107;">
                        <i class="fas fa-fire me-1"></i>FOOD IS BEING PREPARED
                    </button>
                `;
            }
        }

        let itemsHtml = '';
        const isCOD = order.paymentMethod === 'COD' || order.paymentMethod === 'Cash on Delivery';
        const paymentLabel = isCOD ? 'CASH' : 'ONLINE';
        const paymentClass = isCOD ? 'badge bg-danger' : 'badge bg-success';

        if (order.items && order.items.length > 0) {
            itemsHtml = `<div class="items-list" style="background: #f8f9fa; border-radius: 8px; padding: 12px; margin: 15px 0;">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <span style="font-weight: 700; font-size: 11px; color: #666; text-transform: uppercase;">Order Items</span>
                    <span class="${paymentClass}" style="font-size: 10px;">${paymentLabel}</span>
                </div>
                ${order.items.map(i => `<div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size: 14px; color: #333;"><span>${i.quantity}x ${i.name} <small class="text-muted">(${i.weight || 'Std'})</small></span><span>₹${(i.price * i.quantity).toFixed(2)}</span></div>`).join('')}
                ${order.onlineFee > 0 ? `<div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size: 13px; color: #666; font-style: italic;"><span>Online fee</span><span>₹${order.onlineFee.toFixed(2)}</span></div>` : ''}
                <div style="border-top: 1px dashed #ccc; margin-top: 10px; padding-top: 10px; display:flex; justify-content:space-between; font-weight: bold; font-size: 16px; color: var(--primary);">
                    <span>Total Amount</span>
                    <span>₹${(order.totalAmount || 0).toFixed(2)}</span>
                </div>
            </div>`;
        }

        card.innerHTML = `
            <div class="card-header-row">
                <span class="order-id">#${id.substring(0, 8)}</span>
                <div class="d-flex gap-1">
                    <span class="badge ${badgeClass}">${badgeLabel}</span>
                </div>
            </div>

            <!-- Priority & Time Info -->
            <div class="d-flex justify-content-between align-items-center mb-3 p-2 border-bottom" style="background: #fcfcfc;">
                <div style="font-size: 13px; font-weight: 700; color: #555;">
                    <i class="fas fa-history me-1"></i>
                    ${order.createdAt?.toDate ? order.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                </div>
                <div class="d-flex align-items-center gap-2">
                    <span class="badge ${getPriorityInfo(order.createdAt).class}" style="font-size: 11px;">
                        <i class="fas ${getPriorityInfo(order.createdAt).icon} me-1"></i>
                        ${getPriorityInfo(order.createdAt).label}
                    </span>
                    <span style="font-size: 11px; color: #888; font-weight: 600;">
                        ${getPriorityInfo(order.createdAt).mins}m ago
                    </span>
                </div>
            </div>
            <div class="detail-row">
                <span class="detail-label">Customer:</span>
                <span class="detail-value">${order.customerName || order.name || 'N/A'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Phone:</span>
                <span class="detail-value">${order.customerPhone || order.deliveryInfo?.phone || order.phone || 'N/A'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Address:</span>
                <span class="detail-value">${order.deliveryInfo?.address || order.address || 'N/A'}</span>
            </div>
            <div class="detail-row" ${order.specialInstructions || order.deliveryInfo?.orderNotes ? '' : 'style="display:none;"'}>
                <span class="detail-label">Note:</span>
                <span class="detail-value text-danger fw-bold">${order.specialInstructions || order.deliveryInfo?.orderNotes || ''}</span>
            </div>
            
            ${itemsHtml}
            
            ${actionButtonHtml}
        `;
        container.appendChild(card);
    }

    window.acceptDelivery = async (id) => {
        if (!currentRider) return;
        const confirm = window.confirm("Ready to pick up this order?");
        if (!confirm) return;

        try {
            await updateDoc(doc(db, "orders", id), {
                status: 'OUT_FOR_DELIVERY',
                riderId: currentRider.id,
                riderName: currentRider.name,
                riderPhone: currentRider.phone || "+917002568330"
            });
        } catch(e) {
            alert("Error accepting delivery: " + e.message);
        }
    };

    window.completeDelivery = async (id) => {
        const confirm = window.confirm("Has the order been delivered to the customer?");
        if (!confirm) return;

        try {
            await updateDoc(doc(db, "orders", id), {
                status: 'DELIVERED',
                deliveredAt: new Date()
            });
            alert("Delivery Successful! Great job.");
        } catch(e) {
            alert("Error completing delivery: " + e.message);
        }
    };

    window.riderLogout = () => signOut(auth);

})();
