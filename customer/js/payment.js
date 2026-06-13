import { app, auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import {
    doc, getDoc, collection, getDocs,
    addDoc, serverTimestamp, writeBatch, runTransaction, setDoc
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

// Helper: show branded popup instead of browser alert
function showAlert(message, title = 'Notice', type = 'info') {
    if (window.showCustomAlert) {
        window.showCustomAlert(message, title, type);
    } else if (window.showCustomPopup) {
        window.showCustomPopup(message, type);
    } else {
        alert(message);
    }
}

// Global state for real-time price validation
let inventoryCache = [];

function normalizeName(name) {
    if (!name) return "";
    return name.toLowerCase().trim().replace(/-/g, ' ').replace(/\s+/g, ' ');
}

// Unified function to get current price, mrp, and stock status
function getRealtimeItemData(productName, weight, originalItem) {
    const normalizedTarget = normalizeName(productName).replace(/ cuts?$/i, '');
    const product = inventoryCache.find(i => normalizeName(i.id).replace(/ cuts?$/i, '') === normalizedTarget);
    
    // If not found in live inventory, fallback to cart snapshot values
    if (!product) return { 
        price: Number(originalItem.price || 0), 
        mrp: Number(originalItem.mrp || originalItem.price || 0), 
        isOut: false 
    };

    const cleanWeight = weight.toLowerCase().replace(/\s+/g, '');
    
    let isOut = false;
    let rPrice = originalItem.price;
    let rMrp = originalItem.mrp || originalItem.price;
    
    // Check large (opt1) vs small (opt2) based on catalog logic
    let isLarge = false;
    let isSmall = false;

    // Standard items
    if (cleanWeight.includes('500g')) isSmall = true;
    if (cleanWeight.includes('1kg') || cleanWeight.includes('1000g')) isLarge = true;
    
    // Eggs - Big
    if (cleanWeight.includes('30eggs') && productName.toLowerCase().includes('big')) isSmall = true;
    if (cleanWeight.includes('60eggs') && productName.toLowerCase().includes('big')) isLarge = true;
    
    // Eggs - Duck
    if (cleanWeight.includes('15eggs') && productName.toLowerCase().includes('duck')) isSmall = true;
    if (cleanWeight.includes('30eggs') && productName.toLowerCase().includes('duck')) isLarge = true;

    if (isLarge) {
        if (product.large === false) isOut = true;
        if (product.price_large) rPrice = Number(product.price_large);
        if (product.mrp_large) rMrp = Number(product.mrp_large);
    } else if (isSmall) {
        if (product.small === false) isOut = true;
        if (product.price_small) rPrice = Number(product.price_small);
        if (product.mrp_small) rMrp = Number(product.mrp_small);
    }

    rPrice = Number(rPrice || 0);
    rMrp = Number(rMrp || rPrice);
    if (rMrp < rPrice) rMrp = rPrice;

    return { price: rPrice, mrp: rMrp, isOut: isOut };
}
const validPincodes = ["788001", "788004", "788005", "788015", "788003", "788009", "788007", "788006", "788002"];

const RAZORPAY_KEY = "rzp_live_SBdudmt1UBFAEw";
const ONLINE_PAYMENT_FEE = 11;
let baseTotalGlobal = 0; // Total before online fee



document.addEventListener('DOMContentLoaded', () => {
    // Auth State Listener
    onAuthStateChanged(auth, user => {
        if (user) {
            displayOrderSummary(user);
            setupPaymentMethodListeners();
        }
    });
});

function setupPaymentMethodListeners(baseTotal) {
    const radios = document.getElementsByName('paymentMethod');
    radios.forEach(radio => {
        radio.addEventListener('change', () => {
            updatePaymentUI(baseTotal);
        });
    });
}

function updatePaymentUI(baseTotal) {
    const selectedMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'COD';
    const feeRow = document.getElementById('summary-online-fee-row');
    const totalEl = document.getElementById('summary-total');
    const totalAmountEl = document.getElementById('total-amount');
    const codNotice = document.getElementById('cod-notice');
    const codAmtNotice = document.getElementById('cod-amount-notice');
    const placeOrderBtn = document.getElementById('place-order-btn');

    let finalTotal = baseTotal;
    if (selectedMethod === 'Online') {
        finalTotal += ONLINE_PAYMENT_FEE;
        if (feeRow) {
            feeRow.classList.remove('d-none');
            feeRow.classList.add('d-flex');
        }
        if (codNotice) codNotice.classList.add('d-none');
        if (placeOrderBtn) {
            placeOrderBtn.innerHTML = `Pay Now <i class="fas fa-arrow-right ms-2"></i>`;
        }
    } else {
        if (feeRow) {
            feeRow.classList.add('d-none');
            feeRow.classList.remove('d-flex');
        }
        if (codNotice) {
            codNotice.classList.remove('d-none');
            if (codAmtNotice) codAmtNotice.innerText = `₹${finalTotal.toFixed(2)}`;
        }
        if (placeOrderBtn) {
            placeOrderBtn.innerHTML = `Place Order (COD) <i class="fas fa-arrow-right ms-2"></i>`;
        }
    }

    if (totalEl) totalEl.textContent = `₹${finalTotal.toFixed(2)}`;
    if (totalAmountEl) totalAmountEl.textContent = `₹${finalTotal.toFixed(2)}`;
    
    return finalTotal;
}


function updateFreeDeliveryProgressBar(currentTotal) {
    const FREE_DELIVERY_THRESHOLD = 350;
    const progressContainer = document.getElementById('cart-progress-container');
    const progressText = document.getElementById('cart-progress-text');
    const progressFill = document.getElementById('cart-progress-fill');

    if (!progressContainer) return;

    if (currentTotal >= FREE_DELIVERY_THRESHOLD) {
        progressContainer.style.display = 'block';
        progressText.innerHTML = '<span class="free-delivery-unlocked" style="color: #28a745; font-weight: bold;">Free Delivery Unlocked! <i class="fas fa-check-circle"></i></span>';
        progressFill.style.width = '100%';
    } else {
        const remaining = FREE_DELIVERY_THRESHOLD - currentTotal;
        progressContainer.style.display = 'block';
        progressText.innerHTML = `Add <span style="font-weight: bold;">₹${remaining.toFixed(2)}</span> more to get <span style="font-weight: bold; color: #28a745;">Free Delivery!</span>`;
        const percentage = (currentTotal / FREE_DELIVERY_THRESHOLD) * 100;
        progressFill.style.width = `${percentage}%`;
    }
}

async function displayOrderSummary(user) {
    const deliveryDetails = JSON.parse(localStorage.getItem('deliveryDetails'));
    if (!deliveryDetails) {
        showAlert("Delivery details not found. Please go back to checkout.", "Missing Details", "error");
        window.location.href = 'check_out.html';
        return;
    }

    if (!validPincodes.includes(deliveryDetails.pincode)) {
        if (window.showCustomAlert) window.showCustomAlert("Sorry, we don't deliver to this location.", "Location Error", "error");
        else showAlert("Sorry, we don't deliver to this location.", "Delivery Area", "error");
        const btn = document.getElementById('place-order-btn');
        if (btn) btn.disabled = true;
        return;
    }

    document.getElementById('user-name').textContent = deliveryDetails.name || 'N/A';
    document.getElementById('user-email').textContent = deliveryDetails.email || 'N/A';
    document.getElementById('user-phone').textContent = deliveryDetails.phone || 'N/A';
    document.getElementById('user-address').textContent = deliveryDetails.address || 'N/A';
    document.getElementById('user-pincode').textContent = deliveryDetails.pincode || 'N/A';

    // --- INSTANT UI UPDATE FROM SNAPSHOT ---
    const snapshotStr = sessionStorage.getItem('checkoutSnapshot');
    if (snapshotStr) {
        try {
            const snap = JSON.parse(snapshotStr);
            const titleEl = document.getElementById('summary-title');
            const subtotalEl = document.getElementById('summary-subtotal');
            const deliveryEl = document.getElementById('summary-delivery');
            const discountEl = document.getElementById('summary-discount');
            const totalEl = document.getElementById('summary-total');
            const totalAmountEl = document.getElementById('total-amount');

            if (titleEl) titleEl.textContent = `Order Summary (${snap.itemCount})`;
            if (subtotalEl) subtotalEl.textContent = `₹${snap.subtotal.toFixed(2)}`;
            if (deliveryEl) {
                deliveryEl.textContent = snap.deliveryCharge === 0 ? 'Free' : `₹${snap.deliveryCharge.toFixed(2)}`;
                if (snap.deliveryCharge === 0) deliveryEl.style.color = '#28a745';
            }
            if (discountEl) {
                // Approximate discount for instant display
                discountEl.textContent = `- ₹${snap.discount.toFixed(2)}`;
                discountEl.style.color = '#28a745';
                discountEl.style.fontWeight = '700';
            }
            
            // Total calculation (sellingPrice + delivery - discount)
            // Note: coupon discount is already in snap.sellingPrice or applied separately?
            // In checkout.js: window.cartSellingPrice = totalSellingPrice;
            // total = totalSellingPrice + delivery - couponDiscount;
            // For now, just show the selling price as the base total
            const instantTotal = snap.sellingPrice + snap.deliveryCharge;
            if (totalEl) totalEl.textContent = `₹${instantTotal.toFixed(2)}`;
            if (totalAmountEl) totalAmountEl.textContent = `₹${instantTotal.toFixed(2)}`;
            
            updatePaymentUI(instantTotal);
        } catch (e) { console.error("Snapshot error:", e); }
    }

    // --- BUY NOW ISOLATION LOGIC ---
    const urlParams = new URLSearchParams(window.location.search);
    const isBuyNowFlow = urlParams.get('buyNow') === 'true';
    const isReorderFlow = urlParams.get('reorder') === 'true';
    const buyNowData = sessionStorage.getItem('buyNowItem');
    const reorderData = sessionStorage.getItem('reorderItems');

    let subtotal = 0;
    let itemCount = 0;
    let orderItemsDetails = "";
    let totalMRP = 0;
    let totalSellingPrice = 0;
    let itemsForOrder = [];
    let cartSnapshot = []; // Will be used for deleting items if not Buy Now

    // Fetch Inventory first for real-time price verification
    const invSnapshot = await getDocs(collection(db, "inventory"));
    inventoryCache = [];
    invSnapshot.forEach(docSnap => {
        inventoryCache.push({ id: docSnap.id, ...docSnap.data() });
    });

    if (isBuyNowFlow && buyNowData) {
        console.log("[DEBUG] isolated Buy Now flow detected");
        const item = JSON.parse(buyNowData);
        
        // Final Price Verification
        const liveData = getRealtimeItemData(item.name, item.weight || item.size || "", item);
        const currentPrice = liveData.price;
        const currentMrp = liveData.mrp;

        const lineMrp = currentMrp * item.quantity;
        const linePrice = currentPrice * item.quantity;

        totalMRP = lineMrp;
        totalSellingPrice = linePrice;
        itemCount = item.quantity;
        orderItemsDetails = `${item.name} (${item.weight || item.size || 'Standard'}) - Qty: ${item.quantity} - ₹${linePrice.toFixed(2)}\n`;
        
        itemsForOrder.push({
            name: item.name,
            price: currentPrice,
            mrp: currentMrp,
            quantity: item.quantity,
            image: item.image || item.img || "",
            weight: item.weight || item.size || ""
        });
    } else if (isReorderFlow && reorderData) {
        console.log("[DEBUG] isolated Reorder flow detected");
        const items = JSON.parse(reorderData);
        
        items.forEach(item => {
            // Final Price Verification
            const liveData = getRealtimeItemData(item.name, item.weight || "", item);
            const currentPrice = liveData.price;
            const currentMrp = liveData.mrp;

            const lineMrp = currentMrp * item.quantity;
            const linePrice = currentPrice * item.quantity;

            totalMRP += lineMrp;
            totalSellingPrice += linePrice;
            itemCount++;
            orderItemsDetails += `${item.name} (${item.weight || 'Standard'}) - Qty: ${item.quantity} - ₹${linePrice.toFixed(2)}\n`;
            
            itemsForOrder.push({
                ...item,
                price: currentPrice,
                mrp: currentMrp
            });
        });
    } else {
        // --- STANDARD FLOW: FETCH FROM SNAPSHOT OR FIRESTORE ---
        let snapshotItems = [];
        if (snapshotStr) {
            try {
                const snap = JSON.parse(snapshotStr);
                snapshotItems = snap.items || [];
            } catch (e) {
                console.error("[PAYMENT] Error parsing checkoutSnapshot for items:", e);
            }
        }

        if (snapshotItems && snapshotItems.length > 0) {
            console.log("[PAYMENT] Standard flow using checkout items from snapshot:", snapshotItems);
            snapshotItems.forEach(item => {
                const liveData = getRealtimeItemData(item.name, item.weight || "", item);
                const currentPrice = liveData.price;
                const currentMrp = liveData.mrp;

                const lineMrp = currentMrp * item.quantity;
                const linePrice = currentPrice * item.quantity;

                totalMRP += lineMrp;
                totalSellingPrice += linePrice;
                itemCount++;
                orderItemsDetails += `${item.name} (${item.weight || 'Standard'}) - Qty: ${item.quantity} - ₹${linePrice.toFixed(2)}\n`;

                itemsForOrder.push({
                    id: item.id || item.name || "",
                    ...item,
                    price: currentPrice,
                    mrp: currentMrp
                });
            });
        } else {
            console.log("[PAYMENT] No snapshot items. Querying Firestore...");
            const cartRef = collection(db, "carts", user.uid, "items");
            let querySnapshot = await getDocs(cartRef);
            cartSnapshot = querySnapshot;

            // RACE CONDITION FIX: If Firestore is empty, check localStorage fallback
            if (querySnapshot.empty) {
                console.warn("[PAYMENT] Firestore cart empty on initial fetch. Checking local fallback...");
                const localCart = JSON.parse(localStorage.getItem('guestCart') || '[]');
                if (localCart.length > 0) {
                    localCart.forEach(item => {
                        const liveData = getRealtimeItemData(item.name, item.weight || "", item);
                        const currentPrice = liveData.price;
                        const currentMrp = liveData.mrp;
                        const linePrice = currentPrice * item.quantity;
                        const lineMrp = currentMrp * item.quantity;

                        totalMRP += lineMrp;
                        totalSellingPrice += linePrice;
                        itemCount++;
                        orderItemsDetails += `${item.name} (${item.weight || 'Standard'}) - Qty: ${item.quantity} - ₹${linePrice.toFixed(2)}\n`;
                        
                        itemsForOrder.push({
                            ...item,
                            price: currentPrice,
                            mrp: currentMrp
                        });
                    });
                }
            } else {
                querySnapshot.forEach(docSnap => {
                    const item = docSnap.data();
                    const liveData = getRealtimeItemData(item.name, item.weight || "", item);
                    const currentPrice = liveData.price;
                    const currentMrp = liveData.mrp;

                    const lineMrp = currentMrp * item.quantity;
                    const linePrice = currentPrice * item.quantity;

                    totalMRP += lineMrp;
                    totalSellingPrice += linePrice;
                    itemCount++;
                    orderItemsDetails += `${item.name} (${item.weight || 'Standard'}) - Qty: ${item.quantity} - ₹${linePrice.toFixed(2)}\n`;
                    
                    itemsForOrder.push({
                        id: docSnap.id,
                        ...item,
                        price: currentPrice,
                        mrp: currentMrp
                    });
                });
            }
        }
    }

    // Safety Check: If someone lands on payment.html with no items
    if (itemCount === 0) {
        console.warn("[PAYMENT] No items found in cart. Redirecting...");
        
        // Clear stale UI to prevent mismatch confusion
        sessionStorage.removeItem('checkoutSnapshot');
        const titleEl = document.getElementById('summary-title');
        if (titleEl) titleEl.textContent = 'Order Summary (0)';
        const totalEl = document.getElementById('summary-total');
        if (totalEl) totalEl.textContent = '₹0.00';
        
        showAlert("Your cart is empty. Please add items to your cart first.", "Cart Empty", "error");
        setTimeout(() => {
            window.location.href = 'menu.html';
        }, 2000);
        return;
    }

    // Stock Check: block payment if any item is out of stock
    let paymentHasOOS = false;
    let oosItemName = "";
    itemsForOrder.forEach(item => {
        const liveData = getRealtimeItemData(item.name, item.weight || item.size || "", item);
        if (liveData.isOut) {
            if (window.userRole !== 'admin') {
                paymentHasOOS = true;
                oosItemName = item.name;
            }
        }
    });

    if (paymentHasOOS) {
        const placeBtn = document.getElementById('place-order-btn');
        if (placeBtn) {
            placeBtn.disabled = true;
            placeBtn.textContent = 'Contains Stock Out Items';
            placeBtn.style.setProperty('background', '#dc3545', 'important');
        }
        showAlert(`Your order contains "${oosItemName}" which is currently out of stock. Please return to the cart to update.`, "Out of Stock", "error");
        setTimeout(() => {
            window.location.href = 'cart_view.html';
        }, 3000);
        return;
    }

    let couponDiscount = 0;
    const couponCode = sessionStorage.getItem('appliedCoupon') || 'None';
    const coupons = { 'AQUALITY': 0.02, 'PLUSQUALITY': 0.02, 'APLUS': 0.02, 'HAPPY': 0.02, 'THANKS': 0.02, 'SAHIL': 0.02, 'MEAT10': 0.10 };

    if (couponCode !== 'None' && coupons[couponCode]) {
        // Apply coupon to the entire selling price total
        couponDiscount = totalSellingPrice * coupons[couponCode];
        if (couponDiscount < 4) couponDiscount = 4;
    }

    let itemSavings = totalMRP - totalSellingPrice;
    if (itemSavings < 0) itemSavings = 0;
    
    // Total discount is item savings (MRP vs Price) + coupon discount (off the Selling Price)
    const totalDiscountDisplay = itemSavings + couponDiscount;
    const delivery = deliveryDetails.deliveryCharge || 0;
    
    // Final check to match checkout.js exactly
    const total = totalSellingPrice + delivery - couponDiscount;
    baseTotalGlobal = total;
    subtotal = totalMRP;

    // --- FREE DELIVERY PROGRESS BAR LOGIC ---
    updateFreeDeliveryProgressBar(totalSellingPrice);

    const titleEl = document.getElementById('summary-title');
    const subtotalEl = document.getElementById('summary-subtotal');
    const deliveryEl = document.getElementById('summary-delivery');
    const discountEl = document.getElementById('summary-discount');

    if (titleEl) titleEl.textContent = `Order Summary (${itemCount})`;
    if (subtotalEl) subtotalEl.textContent = `₹${subtotal.toFixed(2)}`;
    if (deliveryEl) {
        deliveryEl.textContent = delivery === 0 ? 'Free' : `₹${delivery.toFixed(2)}`;
        if (delivery === 0) deliveryEl.style.color = '#28a745';
    }
    if (discountEl) {
        discountEl.textContent = `- ₹${totalDiscountDisplay.toFixed(2)}`;
        discountEl.style.color = '#28a745';
        discountEl.style.fontWeight = '700';
        
        // Show coupon name if applied
        const discountLabel = discountEl.previousElementSibling;
        if (discountLabel && couponCode !== 'None') {
            discountLabel.innerHTML = `Discount <span style="font-size: 10px; color: #28a745; background: #e8f5e9; padding: 2px 6px; border-radius: 4px; margin-left: 5px;">${couponCode}</span>`;
        }
    }
    
    // Initial UI Update based on default selection (COD usually)
    const finalTotal = updatePaymentUI(total);
    setupPaymentMethodListeners(total);

    const oldBtn = document.getElementById('place-order-btn');
    if (oldBtn) {
        const newBtn = oldBtn.cloneNode(true);
        oldBtn.parentNode.replaceChild(newBtn, oldBtn);

        newBtn.addEventListener('click', () => {
            // Recalculate total with fee if online
            const selectedMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'COD';
            const currentTotal = selectedMethod === 'Online' ? (total + ONLINE_PAYMENT_FEE) : total;
            
            handlePaymentProcess(user, deliveryDetails, itemsForOrder, cartSnapshot, currentTotal, orderItemsDetails, delivery, totalDiscountDisplay, couponCode);
        });
    }

    // Always check operating hours after UI is updated to ensure button state is correct
    checkOperatingHours();
}

function handlePaymentProcess(user, deliveryDetails, itemsForOrder, cartSnapshot, total, orderItemsDetails, delivery, discount, couponCode) {
    const selectedMethodInput = document.querySelector('input[name="paymentMethod"]:checked');
    const selectedMethod = selectedMethodInput ? selectedMethodInput.value : 'COD';

    if (selectedMethod === 'Online') {
        initiateRazorpayPayment(user, deliveryDetails, itemsForOrder, cartSnapshot, total, orderItemsDetails, delivery, discount, couponCode);
    } else {
        placeOrder(user, deliveryDetails, itemsForOrder, cartSnapshot, total, orderItemsDetails, delivery, discount, couponCode, "COD", "Pending", null);
    }
}

function initiateRazorpayPayment(user, deliveryDetails, itemsForOrder, cartSnapshot, total, orderItemsDetails, delivery, discount, couponCode) {
    if (!window.Razorpay) {
        showAlert("Online payment system is still loading. Please wait a moment and try again.", "Loading...", "info");
        return;
    }

    const amountInPaise = Math.round(total * 100);
    const options = {
        "key": RAZORPAY_KEY,
        "amount": amountInPaise,
        "currency": "INR",
        "name": "MeatDae",
        "description": "Fresh Meat Delivery",
        "image": "images/logo.png",
        "handler": function (response) {
            placeOrder(user, deliveryDetails, itemsForOrder, cartSnapshot, total, orderItemsDetails, delivery, discount, couponCode, "Online (Razorpay)", "Paid", response.razorpay_payment_id);
        },
        "prefill": {
            "name": deliveryDetails.name,
            "email": deliveryDetails.email,
            "contact": deliveryDetails.phone
        },
        "theme": { "color": "#ff7c08" },
        "modal": {
            "ondismiss": function () {
                if (window.showCustomAlert) window.showCustomAlert('Payment Cancelled', 'Cancelled', 'error');
                else showAlert('Payment was cancelled. Your cart is safe — try again when ready.', 'Payment Cancelled', 'info');
            }
        }
    };

    try {
        const rzp1 = new window.Razorpay(options);
        rzp1.on('payment.failed', function (response) {
            showAlert("Payment failed: " + response.error.description + ". Please try again or use Cash on Delivery.", "Payment Failed", "error");
        });
        rzp1.open();
    } catch (e) {
        showAlert("Could not open the payment gateway. Please refresh the page and try again.", "Payment Error", "error");
    }
}

// ** GLOBAL SEQUENTIAL ID LOGIC **
async function placeOrder(user, deliveryDetails, itemsForOrder, cartSnapshot, total, orderItemsDetails, deliveryCharge, discountAmount, couponCode, paymentMethod, paymentStatus, paymentId) {
    const placeOrderBtn = document.getElementById('place-order-btn');
    placeOrderBtn.disabled = true;
    placeOrderBtn.innerHTML = paymentMethod.includes('Online') ? 'Verifying... <i class="fas fa-spinner fa-spin ms-2"></i>' : 'Placing... <i class="fas fa-spinner fa-spin ms-2"></i>';

    let formattedOrderId;

    try {
        await runTransaction(db, async (transaction) => {
            // Check stock status for each item in the order
            for (const item of itemsForOrder) {
                // If it's admin, bypass stock checks
                if (window.userRole === 'admin') continue;

                const invDocRef = doc(db, "inventory", item.name);
                const invDoc = await transaction.get(invDocRef);
                if (invDoc.exists()) {
                    const invData = invDoc.data();
                    const cleanWeight = (item.weight || "").toLowerCase().replace(/\s+/g, '');
                    
                    let isOut = false;
                    if (cleanWeight.includes('500g')) {
                        if (invData.small === false) isOut = true;
                    } else if (cleanWeight.includes('1kg') || cleanWeight.includes('1000g')) {
                        if (invData.large === false) isOut = true;
                    } else if (cleanWeight.includes('220g')) {
                        if (invData.solo === false) isOut = true;
                    } else if (cleanWeight.includes('30') && item.name.toLowerCase().includes('big')) {
                        if (invData.small === false) isOut = true;
                    } else if (cleanWeight.includes('60') && item.name.toLowerCase().includes('big')) {
                        if (invData.large === false) isOut = true;
                    } else if (cleanWeight.includes('15') && item.name.toLowerCase().includes('duck')) {
                        if (invData.small === false) isOut = true;
                    } else if (cleanWeight.includes('30') && item.name.toLowerCase().includes('duck')) {
                        if (invData.large === false) isOut = true;
                    }

                    if (isOut) {
                        throw new Error(`Item "${item.name}" (${item.weight}) is out of stock.`);
                    }
                }
            }

            // 1. Reference the Global Counter
            const counterRef = doc(db, "metadata", "order_counter");
            const counterDoc = await transaction.get(counterRef);

            let newCount;

            if (!counterDoc.exists()) {
                // If this is the FIRST order ever, start at 1
                newCount = 1;
                transaction.set(counterRef, { count: newCount });
            } else {
                // Otherwise, increment the global count
                newCount = counterDoc.data().count + 1;
                transaction.update(counterRef, { count: newCount });
            }

            // 2. Format ID (e.g. 1 -> "#0001")
            formattedOrderId = "#" + newCount.toString().padStart(4, "0");

            // 3. Prepare Order Data
            // Read delivery GPS coordinates ONLY if customer explicitly pinned their location
            let deliveryLocation = null;
            try {
                const userPinned = localStorage.getItem('userPinnedLocation');
                const savedLoc = localStorage.getItem('deliveryLocation');
                if (userPinned === 'true' && savedLoc) {
                    deliveryLocation = JSON.parse(savedLoc);
                }
            } catch (e) { /* ignore */ }

            const isOnlinePayment = paymentMethod.toLowerCase().includes('online');
            const orderData = {
                orderId: formattedOrderId,
                userId: user.uid,
                customerName: deliveryDetails.name || '',
                customerEmail: deliveryDetails.email || '',
                customerPhone: deliveryDetails.phone || '',
                deliveryInfo: deliveryDetails,
                items: itemsForOrder,
                totalAmount: total,
                deliveryCharge: deliveryCharge,
                discountAmount: discountAmount,
                couponCode: couponCode,
                onlineFee: isOnlinePayment ? ONLINE_PAYMENT_FEE : 0,
                paymentMethod: paymentMethod,
                paymentStatus: paymentStatus,
                paymentId: paymentId || null,
                status: "PENDING_APPROVAL",
                riderId: null,
                riderLocation: null,
                deliveryLocation: deliveryLocation, // Customer's pinned GPS coordinates
                specialInstructions: deliveryDetails.orderNotes || "",
                createdAt: serverTimestamp(),
                createdAtLocal: new Date().toISOString()
            };

            // 4. Save Order
            const newOrderRef = doc(db, "orders", formattedOrderId);
            transaction.set(newOrderRef, orderData);
        });

        // --- Success ---
        // Only delete cart items if this was NOT a Buy Now or Reorder flow
        const urlParams = new URLSearchParams(window.location.search);
        const isBuyNowFlow = urlParams.get('buyNow') === 'true';
        const isReorderFlow = urlParams.get('reorder') === 'true';
        
        if (!isBuyNowFlow && !isReorderFlow) {
            console.log("[PAYMENT] Standard flow - clearing cart in Firestore...");
            try {
                const cartRef = collection(db, "carts", user.uid, "items");
                const snapshot = await getDocs(cartRef);
                if (!snapshot.empty) {
                    const batch = writeBatch(db);
                    snapshot.forEach(doc => batch.delete(doc.ref));
                    await batch.commit();
                    console.log("[PAYMENT] Standard cart successfully cleared in Firestore.");
                }
            } catch (err) {
                console.error("[PAYMENT] Error clearing Firestore cart:", err);
            }
            // Clear local guest cart fallback
            localStorage.removeItem('guestCart');
        } else {
            console.log("[PAYMENT] isolated Buy Now or Reorder order placed - preserving standard cart");
        }




        // --- WhatsApp Notification Logic ---
        const whatsappNumber = "917002568330";
        const isOnline = paymentMethod.toLowerCase().includes('online');
        const onlineFeeText = isOnline ? `\n*Online Fee:* ₹${ONLINE_PAYMENT_FEE.toFixed(2)}` : "";
        const wSubtotal = total - deliveryCharge + discountAmount - (isOnline ? ONLINE_PAYMENT_FEE : 0);
        const instructions = deliveryDetails.orderNotes ? `\n*Note:* ${deliveryDetails.orderNotes}\n` : "";
        const whatsappMessage = `*New Order Received!* 🥩\n\n*Order ID:* ${formattedOrderId}\n*Name:* ${deliveryDetails.name}\n*Phone:* ${deliveryDetails.phone}\n*Address:* ${deliveryDetails.address}, Pincode: ${deliveryDetails.pincode}\n${instructions}\n*Items:*\n${orderItemsDetails}\n--------------------------\n*Subtotal:* ₹${wSubtotal.toFixed(2)}\n*Delivery:* ₹${deliveryCharge.toFixed(2)}\n*Discount:* -₹${discountAmount.toFixed(2)}\n*Coupon:* ${couponCode}${onlineFeeText}\n*Total:* ₹${total.toFixed(2)}\n\n*Payment:* ${paymentMethod} (${paymentStatus})\n${paymentId ? '*Txn ID:* ' + paymentId : ''}`;
        
        // --- REAL-TIME ADMIN NOTIFICATION (BROSWER PUSH) ---
        try {
            const itemsSummary = itemsForOrder.map(item => `${item.name} (${item.weight || 'Std'}) x${item.quantity}`).join(', ');
            await addDoc(collection(db, "admin_notifications"), {
                title: `New Order ${formattedOrderId}`,
                body: `Customer: ${deliveryDetails.name} (${deliveryDetails.phone})\nAddress: ${deliveryDetails.address}, Pincode: ${deliveryDetails.pincode}\nItems: ${itemsSummary}\nTotal: ₹${total.toFixed(0)} (${paymentMethod})`,
                orderId: formattedOrderId,
                customerName: deliveryDetails.name || '',
                customerPhone: deliveryDetails.phone || '',
                customerAddress: deliveryDetails.address || '',
                itemsSummary: itemsSummary,
                totalAmount: total,
                paymentMethod: paymentMethod,
                type: "NEW_ORDER",
                read: false,
                timestamp: serverTimestamp()
            });
        } catch (e) { console.error("Notification trigger failed", e); }

        const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(whatsappMessage)}`;
        
        sessionStorage.setItem('pendingWhatsAppUrl', whatsappUrl);

        sessionStorage.removeItem('cartDiscount');
        sessionStorage.removeItem('appliedCoupon');
        sessionStorage.removeItem('reorderItems');
        sessionStorage.removeItem('buyNowItem');
        sessionStorage.removeItem('checkoutSnapshot');
        localStorage.removeItem('deliveryDetails');


        placeOrderBtn.innerHTML = 'Order Placed <i class="fas fa-check ms-2"></i>';
        placeOrderBtn.style.setProperty('background', '#28a745', 'important');
        placeOrderBtn.style.setProperty('color', '#ffffff', 'important');

        // Save data for success page
        sessionStorage.setItem('successOrderId', formattedOrderId);
        sessionStorage.setItem('successTotalAmount', total.toFixed(2));
        sessionStorage.setItem('successPaymentMethod', paymentMethod);

        setTimeout(() => {
            window.location.href = 'order_success.html';
        }, 1500);

    } catch (error) {
        console.error('Order Error:', error);
        let msg = error.message || "Unknown Error";
        if (msg.includes("permission")) msg = "Database permission denied. Check Rules.";

        showAlert("Order could not be placed: " + msg + ". Please try again.", "Order Failed", "error");
        placeOrderBtn.disabled = false;
        placeOrderBtn.textContent = 'Try Again';
    }
}

function checkOperatingHours() {
    const messageContainer = document.getElementById('operating-hours-message');
    const nextDeliveryTimeEl = document.getElementById('next-delivery-time');
    const placeOrderBtn = document.getElementById('place-order-btn');

    if (!messageContainer) return;

    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const currentHour = now.getHours();
    // 8 AM to 8 PM (20:00)
    let isOpen = currentHour >= 8 && currentHour < 20;

    // Developer bypass
    const user = auth.currentUser;
    if (user && user.email && 
        (user.email.toLowerCase() === 'aarxslan@gmail.com' || 
         user.email.toLowerCase() === '10sahilsarkargg@gmail.com')) {
        isOpen = true;
    }

    if (isOpen) {
        messageContainer.style.display = 'block';
        messageContainer.classList.remove('closed');
        if (nextDeliveryTimeEl) nextDeliveryTimeEl.textContent = '';
        if (placeOrderBtn) placeOrderBtn.disabled = false;
    } else {
        messageContainer.style.display = 'block';
        messageContainer.classList.add('closed');
        const msgP = messageContainer.querySelector('p:first-child');
        if (msgP) msgP.innerHTML = '<i class="fas fa-exclamation-circle"></i> We are currently closed.';
        if (nextDeliveryTimeEl) nextDeliveryTimeEl.textContent = 'Next delivery slot opens at 8 AM IST.';
        if (placeOrderBtn) {
            placeOrderBtn.disabled = true;
            placeOrderBtn.textContent = 'Currently unavailable';
        }
    }
}