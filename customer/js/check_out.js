import { app, auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { doc, getDoc, getDocs, updateDoc, deleteDoc, setDoc, collection, onSnapshot, GeoPoint } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

// --- CONFIGURATION ---
// List of all locations you deliver to
const validPincodes = ["788001", "788004", "788005", "788015", "788003", "788009", "788007", "788006", "788002"];
// List of locations that cost ₹15
const pincodesWithCharge = ["788003", "788009", "788015", "788002"];

// Charge Amounts
const HIGH_DELIVERY_CHARGE = 15; // For REC/Far areas
const STANDARD_DELIVERY_CHARGE = 11; // For Town areas (previously free)

// --- DELIVERY PRICE DETECTION (Word based) ---
const deliveryPricesByAddress = [
  { price: 15, keywords: ["meherpur", "mhrpur", "mehepur", "meherfur"] },
  { price: 15, keywords: ["rongpur", "rongpr", "rangpur"] },
  { price: 17, keywords: ["bagatpur", "bogotpur", "bakatpur", "bhagatpur", "bhagotpur", "bhakatpr", "bhogotpur"] },
  { price: 15, keywords: ["tarapur", "trapur", "tarfur", "tarpur"] },
  { price: 17, keywords: ["kathal road", "kathol rd", "katal road", "kathal rd", "kathal rd ta"] },
  { price: 15, keywords: ["malugram", "malgram", "mallugram"] },
  { price: 20, keywords: ["suncity", "sunsity"] },
  { price: 17, keywords: ["ghaniwala", "ganiwala", "ghoniala", "ghoniwala"] },
  { price: 15, keywords: ["national highway", "national hw", "national"] },
  { price: 15, keywords: ["2nd link road", "second link road", "2 link road", "2nd link rd", "2 link rd"] },
  { price: 20, keywords: ["green heals", "green hill", "green hills"] },
  { price: 20, keywords: ["valley hospital", "vally hospital"] },
  { price: 20, keywords: ["beltola"] },
  { price: 20, keywords: ["grace well"] },
  { price: 17, keywords: ["peshkar road", "peshkar lane", "peskar lane", "peshkar 17"] },
  { price: 17, keywords: ["maruti suzuki", "maruti suzuki 17"] },
  { price: 20, keywords: ["shibalik", "shibalik park", "shivalik", "shivalik park", "sivalik", "sivalik park"] }
];

function detectPriceFromAddress(addressText) {
    if (!addressText) return 0;
    const lowerText = addressText.toLowerCase();
    let maxPriceDetected = 0;

    deliveryPricesByAddress.forEach(item => {
        const isMatched = item.keywords.some(kw => lowerText.includes(kw));
        if (isMatched && item.price > maxPriceDetected) {
            maxPriceDetected = item.price;
        }
    });

    return maxPriceDetected;
}

// --- MODULE STATE ---
let cartSubtotal = 0;
let cartItemCount = 0;
let cartDiscount = 0;
let cartGST = 0;
let inventoryCache = [];
let cartUnsubscribe = null;
let inventoryUnsubscribe = null;
let isModifyMode = false;
window.cartSellingPrice = 0;

// Real-time Inventory & Stock Listener
function listenToInventory() {
    if (inventoryUnsubscribe) inventoryUnsubscribe();
    inventoryUnsubscribe = onSnapshot(collection(db, "inventory"), (querySnapshot) => {
        inventoryCache = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            data.name = doc.id;
            inventoryCache.push(data);
        });
        console.log("[REALTIME-CHECKOUT] Inventory updated");

        const user = auth.currentUser;
        if (user) {
            fetchUserDataAndCart(user);
        }
    });
}

// Standard normalization for all customer-side matching
function normalizeName(name) {
    if (!name) return "";
    return name.toLowerCase()
        .replace(/-/g, ' ')
        .replace(/ cuts?$/i, '')
        .trim()
        .replace(/\s+/g, ' ');
}

// Unified function to get current price, mrp, and stock status
function getRealtimeItemData(productName, weight, originalItem) {
    const normalizedTarget = normalizeName(productName);
    const product = inventoryCache.find(i => normalizeName(i.name) === normalizedTarget);
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
    if (cleanWeight.includes('1kg') || cleanWeight.includes('1000g') || cleanWeight.includes('1kilogram')) isLarge = true;

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

    // Default fallback if admin forgot to add mrp
    rPrice = Number(rPrice || 0);
    rMrp = Number(rMrp || rPrice);
    if (rMrp < rPrice) rMrp = rPrice;

    return { price: rPrice, mrp: rMrp, isOut: isOut };
}

// --- NEW INLINE ERROR UTILITIES ---
function showValidationToast(message) {
    const toast = document.getElementById('validation-toast');
    const msg = document.getElementById('validation-msg');
    if (toast && msg) {
        msg.textContent = message;
        toast.classList.add('show');
        // No auto-hide for centered popup, let user click OK
    } else {
        alert(message);
    }
}

function showInlineError(message) {
    showValidationToast(message);
}

function updateSavedView(userData) {
    const savedName = document.getElementById('saved-name');
    const savedPhone = document.getElementById('saved-phone');
    const savedAddressText = document.getElementById('saved-address-text');
    const savedPincode = document.getElementById('saved-pincode');
    const editBtn = document.getElementById('btn-edit-delivery');

    if (savedName) savedName.textContent = userData.name || 'Fill your name';
    if (savedPhone) savedPhone.textContent = userData.phone || 'Fill phone number';
    if (savedAddressText) savedAddressText.textContent = userData.address || 'Fill delivery address';
    if (savedPincode) savedPincode.textContent = userData.pincode || 'Pincode';

    // Change EDIT button to ADD if details are missing
    const isMissingInfo = !userData.name || !userData.phone || !userData.address || !userData.pincode;
    if (editBtn) {
        editBtn.textContent = isMissingInfo ? 'ADD' : 'EDIT';
    }

    // If any critical data is missing, show the form automatically
    if (isMissingInfo) {
        toggleEditMode(true);
    } else {
        toggleEditMode(false);
    }
}

function toggleEditMode(isEditing) {
    const savedView = document.getElementById('saved-address-view');
    const editForm = document.getElementById('edit-address-form');
    const editBtn = document.getElementById('btn-edit-delivery');

    if (isEditing) {
        if (savedView) savedView.style.display = 'none';
        if (editForm) editForm.style.display = 'block';
        if (editBtn) editBtn.style.display = 'none';
    } else {
        if (savedView) savedView.style.display = 'block';
        if (editForm) editForm.style.display = 'none';
        if (editBtn) editBtn.style.display = 'block';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    listenToInventory();

    let initialAuthCheckDone = false;
    onAuthStateChanged(auth, user => {
        const checkoutView = document.getElementById('checkout-main-view');
        const authView = document.getElementById('auth-required-view');

        if (user) {
            initialAuthCheckDone = true;
            // Show Checkout, Hide Login prompt
            if (checkoutView) checkoutView.style.display = 'block';
            if (authView) authView.style.display = 'none';

            // Real-time Cart Listener
            if (cartUnsubscribe) cartUnsubscribe();
            const cartRef = collection(db, "carts", user.uid, "items");
            cartUnsubscribe = onSnapshot(cartRef, (querySnapshot) => {
                const items = [];
                querySnapshot.forEach(docSnap => items.push({ id: docSnap.id, ...docSnap.data() }));
                processCartItemsArray(items);
            });

            fetchUserDataAndCart(user);
            checkOperatingHours();
        } else {
            if (!initialAuthCheckDone) {
                initialAuthCheckDone = true;
                setTimeout(() => {
                    if (!auth.currentUser) {
                        // Redirect guests directly to sign-in page after grace period
                        if (typeof window.goToLogin === 'function') {
                            window.goToLogin();
                        } else {
                            sessionStorage.setItem('redirectAfterLogin', window.location.href);
                            window.location.replace('sign_in.html');
                        }
                    }
                }, 1500); // 1.5s grace period
            } else {
                // Subsequent null states trigger immediate redirect
                if (typeof window.goToLogin === 'function') {
                    window.goToLogin();
                } else {
                    sessionStorage.setItem('redirectAfterLogin', window.location.href);
                    window.location.replace('sign_in.html');
                }
            }
            return;
        }
    });

    // Toggle Edit Mode
    const editBtn = document.getElementById('btn-edit-delivery');
    if (editBtn) {
        editBtn.addEventListener('click', () => toggleEditMode(true));
    }

    // Toggle Modify Items Mode
    const modifyBtn = document.getElementById('btn-toggle-modify');
    if (modifyBtn) {
        modifyBtn.addEventListener('click', () => {
            isModifyMode = !isModifyMode;
            if (isModifyMode) {
                modifyBtn.classList.add('active');
                modifyBtn.innerHTML = 'DONE <i class="fas fa-check ms-1"></i>';
            } else {
                modifyBtn.classList.remove('active');
                modifyBtn.innerHTML = 'MODIFY <i class="fas fa-pen ms-1"></i>';
            }
            
            // Re-render items to show/hide controls
            const user = auth.currentUser;
            if (user) fetchUserDataAndCart(user);
        });
    }

    // Save Address Logic
    const saveBtn = document.getElementById('btn-save-address');
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            if (validateAllFields()) {
                const user = auth.currentUser;
                const name = document.getElementById('user-name').value.trim();
                const phone = document.getElementById('user-phone').value.trim();
                const address = document.getElementById('user-address').value.trim();
                const pincode = document.getElementById('user-pincode').value.trim();

                const email = document.getElementById('user-email').value.trim();
                const userData = { name, phone, address, pincode };
                if (email) userData.email = email;

                try {
                    await setDoc(doc(db, "users", user.uid), userData, { merge: true });
                    updateSavedView(userData);
                    showValidationToast("Address saved!");
                } catch (err) {
                    console.error("Error saving address:", err);
                    showValidationToast("Error saving address. Please try again.");
                }
            }
        });
    }

    // --- INPUT EVENT LISTENERS (Clear errors when typing) ---
    const pincodeInput = document.getElementById('user-pincode');
    const phoneInput = document.getElementById('user-phone');
    const addressInput = document.getElementById('user-address');
    const proceedBtn = document.getElementById('proceed-to-payment-btn');

    if (pincodeInput) {
        pincodeInput.addEventListener('input', () => {
            closeErrorBanner(); // Clear error on typing
            validatePincode();
            updateCheckoutSummary();
        });

        // Save pincode on blur if valid
        pincodeInput.addEventListener('blur', async () => {
            const pin = pincodeInput.value.trim();
            if (validPincodes.includes(pin)) {
                const user = auth.currentUser;
                if (user) {
                    try {
                        await setDoc(doc(db, "users", user.uid), { pincode: pin }, { merge: true });
                        console.log("Pincode saved to profile");
                    } catch (err) {
                        console.error("Error saving pincode:", err);
                    }
                }
            }
        });
    }

    // Coupon Application
    const applyCouponBtn = document.getElementById('btn-apply-coupon');
    if (applyCouponBtn) {
        applyCouponBtn.addEventListener('click', () => {
            const couponInput = document.getElementById('coupon-code-input');
            const couponMsg = document.getElementById('coupon-msg');
            if (couponInput && couponMsg) {
                const code = couponInput.value.trim().toUpperCase();
                if (!code) {
                    couponMsg.style.display = 'none';
                    return;
                }

                const coupons = { 'AQUALITY': 0.02, 'PLUSQUALITY': 0.02, 'APLUS': 0.02, 'HAPPY': 0.02, 'THANKS': 0.02, 'SAHIL': 0.02, 'MEAT10': 0.10 };

                if (coupons[code]) {
                    sessionStorage.setItem('appliedCoupon', code);
                    couponMsg.textContent = `Coupon "${code}" applied successfully!`;
                    couponMsg.className = 'small mt-2 text-success fw-bold';
                    couponMsg.style.display = 'block';

                    const user = auth.currentUser;
                    if (user) fetchUserDataAndCart(user);
                } else {
                    sessionStorage.removeItem('appliedCoupon');
                    couponMsg.textContent = 'Invalid coupon code. Please try again.';
                    couponMsg.className = 'small mt-2 text-danger fw-bold';
                    couponMsg.style.display = 'block';

                    const user = auth.currentUser;
                    if (user) fetchUserDataAndCart(user);
                }
            }
        });
    }

    if (phoneInput) {
        phoneInput.addEventListener('input', () => {
            closeErrorBanner(); // Clear error on typing
        });
    }

    if (addressInput) {
        addressInput.addEventListener('input', () => {
            closeErrorBanner(); // Clear error on typing
            updateCheckoutSummary(); // Update delivery fee in real-time
        });
    }

    if (proceedBtn) {
        proceedBtn.addEventListener('click', async (e) => {
            // 0. CHECK IF CART IS EMPTY
            if (cartItemCount === 0 && !window.buyNowMode) {
                showInlineError('Your cart is empty. Please add items before proceeding.');
                e.preventDefault();
                return;
            }

            // 0. Handle Stock Out removal if button is in that state
            if (proceedBtn.innerHTML.includes('Remove') || proceedBtn.classList.contains('bg-danger')) {
                const user = auth.currentUser;
                if (user && window.outOfStockItemIds && window.outOfStockItemIds.length > 0) {
                    proceedBtn.disabled = true;
                    proceedBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Removing...';

                    try {
                        const deletePromises = window.outOfStockItemIds.map(itemId =>
                            deleteDoc(doc(db, "carts", user.uid, "items", itemId))
                        );
                        await Promise.all(deletePromises);

                        // If it's a Buy Now item that is OOS
                        if (window.buyNowMode && window.buyNowItem && window.outOfStockItemIds.includes('buyNow')) {
                            sessionStorage.removeItem('buyNowItem');
                            window.location.href = 'index.html';
                            return;
                        }

                        showValidationToast("Out of stock items removed from your cart.");
                        window.outOfStockItemIds = [];
                    } catch (err) {
                        console.error("Error removing OOS items:", err);
                        showValidationToast("Failed to remove items. Please try again.");
                        proceedBtn.disabled = false;
                    }
                }
                return;
            }

            // 1. Check if shop is closed (Except for admin)
            const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
            const currentHour = now.getHours();
            const user = auth.currentUser;
            const isAdmin = (user && user.email &&
                (user.email.toLowerCase() === 'aarxslan@gmail.com' ||
                    user.email.toLowerCase() === '10sahilsarkargg@gmail.com')) || window.userRole === 'admin';

            let isOpen = (currentHour >= 6 && currentHour < 21);

            if (isAdmin) {
                console.log("[DEBUG] Admin detected - bypassing shop hours check.");
                isOpen = true; // Admin bypasses shop hours
            }

            console.log(`[DEBUG] Click handler - Shop open: ${isOpen}, Current hour: ${currentHour}, Is Admin: ${isAdmin}`);

            if (!isOpen) {
                console.warn("[DEBUG] Blocked: Shop is closed.");
                showInlineError('We are currently closed for the day. Please order between 6 AM and 9 PM IST.');
                e.preventDefault();
                return;
            }

            // 2. Run validations
            console.log("[DEBUG] Running validations...");
            if (!validateAllFields()) {
                console.log("[DEBUG] Validation failed");
                e.preventDefault();
                return;
            }
            console.log("[DEBUG] Validation passed");

            // 3. Save data and proceed
            const deliveryCharge = getDeliveryCharge();
            let deliveryLocation = null;
            try {
                const savedLoc = localStorage.getItem('deliveryLocation');
                if (savedLoc) {
                    const locObj = JSON.parse(savedLoc);
                    deliveryLocation = new GeoPoint(locObj.lat, locObj.lng);
                }
            } catch (err) { console.error("GeoPoint error:", err); }

            const name = document.getElementById('user-name').value;
            const phone = document.getElementById('user-phone').value;
            const address = document.getElementById('user-address').value;
            const pincode = document.getElementById('user-pincode').value;
            const email = document.getElementById('user-email').value;

            const orderNotes = document.getElementById('order-notes')?.value.trim() || "";

            const deliveryDetails = {
                name: name,
                email: email,
                phone: phone,
                address: address,
                pincode: pincode,
                deliveryCharge: deliveryCharge,
                deliveryTime: "30-90 minutes",
                location: deliveryLocation,
                orderNotes: orderNotes
            };

            // Save to Firestore so user doesn't have to enter again
            if (user) {
                const userUpdate = { name, phone, address, pincode };
                if (email) userUpdate.email = email;
                setDoc(doc(db, "users", user.uid), userUpdate, { merge: true }).catch(err => console.error("Error saving user info:", err));
            }

            console.log("[DEBUG] Redirecting to payment.html...");
            localStorage.setItem('deliveryDetails', JSON.stringify(deliveryDetails));

            // Snapshot for instant display on payment.html
            const checkoutSnapshot = {
                subtotal: cartSubtotal,
                itemCount: cartItemCount,
                discount: cartDiscount,
                sellingPrice: window.cartSellingPrice,
                deliveryCharge: deliveryCharge,
                items: window.checkoutItems || []
            };
            sessionStorage.setItem('checkoutSnapshot', JSON.stringify(checkoutSnapshot));

            // Carry over flow flags if present
            const isBuyNow = window.buyNowMode === true;
            const isReorder = window.reorderMode === true;
            let paymentUrl = 'payment.html';
            if (isBuyNow) paymentUrl = 'payment.html?buyNow=true';
            else if (isReorder) paymentUrl = 'payment.html?reorder=true';
            
            window.location.href = paymentUrl;
        });
    }
    // Event Delegation for Delete Buttons
    const listEl = document.getElementById('checkout-items-list');
    if (listEl) {
        listEl.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('[data-action="delete"]');
            if (deleteBtn) {
                const itemId = deleteBtn.getAttribute('data-id');
                const itemName = deleteBtn.getAttribute('data-name');
                window.deleteCheckoutItem(itemId, itemName);
            }
        });
    }
});

function validateAllFields() {
    // 1. Validate Name
    const nameInput = document.getElementById('user-name');
    if (!nameInput || !nameInput.value.trim()) {
        showInlineError('Please enter your full name.');
        return false;
    }

    // 2. Validate Phone
    const phoneInput = document.getElementById('user-phone');
    if (!phoneInput) return false;

    // Remove all non-numeric characters (handles spaces, dashes, parens, and other pasted chars)
    let phone = phoneInput.value.trim().replace(/\D/g, '');

    // Strip +91 if it exists
    if (phone.startsWith('+91')) {
        phone = phone.substring(3);
    } else if (phone.startsWith('91') && phone.length === 12) {
        // Also handle cases where user might type 91 without the plus
        phone = phone.substring(2);
    }

    // Check if the remaining part is exactly 10 digits
    if (!/^\d{10}$/.test(phone)) {
        showInlineError('Please enter a valid 10-digit phone number.');
        return false;
    }

    // 3. Validate Address
    const addressInput = document.getElementById('user-address');
    if (!addressInput || !addressInput.value.trim()) {
        showInlineError('Please provide your delivery address.');
        return false;
    }

    // 4. Validate Pincode
    const pincodeInput = document.getElementById('user-pincode');
    const pincode = pincodeInput.value.trim();
    if (pincode.length === 0) {
        showInlineError('Pincode is required. Please enter a valid pincode.');
        return false;
    }
    if (pincode.length < 6) {
        showInlineError('Please enter a valid 6-digit pincode.');
        return false;
    }

    if (!validatePincode(true)) {
        // validatePincode internally shows specific delivery radius error
        return false;
    }

    // 5. Validate Map Pinning — OPTIONAL: check if user pinned their location (removed blocking)
    const deliveryLocation = localStorage.getItem('deliveryLocation');
    const userPinnedLocation = localStorage.getItem('userPinnedLocation');
    console.log("[DEBUG] deliveryLocation check:", deliveryLocation, "userPinned:", userPinnedLocation);
    // if (!deliveryLocation || userPinnedLocation !== 'true') {
    //     showInlineError('Please pin your location on the map first. Click "Use My GPS" or tap the map.');
    //     // Vibrate if supported
    //     if (window.navigator && window.navigator.vibrate) window.navigator.vibrate(200);
    //     return false;
    // }

    return true;
}

// --- UPDATED DELIVERY CHARGE LOGIC ---
function getDeliveryCharge() {
    const addressInput = document.getElementById('user-address');
    const pincodeInput = document.getElementById('user-pincode');
    
    let baseCharge = 0;

    // 1. Try detecting from address first
    const addressText = addressInput ? addressInput.value.trim() : "";
    const detectedFromAddress = detectPriceFromAddress(addressText);
    
    if (detectedFromAddress > 0) {
        baseCharge = detectedFromAddress;
    } else {
        // 2. Fallback to existing pincode logic ONLY if address detection fails
        const pincode = pincodeInput ? pincodeInput.value.trim() : "";
        if (pincode.length === 6 && validPincodes.includes(pincode)) {
            if (pincodesWithCharge.includes(pincode)) {
                baseCharge = HIGH_DELIVERY_CHARGE; // ₹15
            } else {
                baseCharge = STANDARD_DELIVERY_CHARGE; // ₹11
            }
        }
    }

    // 3. Final free delivery check (Orders >= ₹350)
    if (window.cartSellingPrice >= 350) {
        return 0;
    }

    return baseCharge;
}

function validatePincode(showErrorOnClick = false) {
    const pincodeInput = document.getElementById('user-pincode');
    const pincode = pincodeInput.value.trim();
    const pincodeError = document.getElementById('pincode-error');
    const proceedBtn = document.getElementById('proceed-to-payment-btn');

    // Basic length check
    if (pincode.length < 6) {
        if (pincodeError) pincodeError.style.display = 'none';
        if (proceedBtn) {
            // Admin Exception: Allow admins to proceed even if pincode is invalid or short (for testing)
            if (window.userRole === 'admin') {
                proceedBtn.classList.remove('disabled');
            } else {
                proceedBtn.classList.add('disabled');
            }
        }
        return false;
    }

    // Validation against allowed list
    if (validPincodes.includes(pincode)) {
        if (pincodeError) pincodeError.style.display = 'none';
        if (proceedBtn) {
            proceedBtn.classList.remove('disabled');
        }
        return true;
    } else {
        // If invalid pincode
        if (pincodeError) pincodeError.style.display = 'block';
        if (proceedBtn) {
            // Admin Exception: Allow admins to proceed even if pincode is invalid
            if (window.userRole === 'admin') {
                proceedBtn.classList.remove('disabled');
            } else {
                proceedBtn.classList.add('disabled');
            }
        }

        // Show the banner ONLY if the user clicked the button
        if (showErrorOnClick) {
            showInlineError("Sorry, we do not deliver to this location yet.");
        }
        return false;
    }
}

async function fetchGuestDataAndCart() {
    // 1. Fetch Guest Profile Data from Storage
    const lastDetails = localStorage.getItem('deliveryDetails');
    const userData = lastDetails ? JSON.parse(lastDetails) : {};
    
    const nameEl = document.getElementById('user-name');
    const emailEl = document.getElementById('user-email');
    const phoneEl = document.getElementById('user-phone');
    const addressEl = document.getElementById('user-address');
    const pinEl = document.getElementById('user-pincode');

    if (nameEl) nameEl.value = userData.name || '';
    if (emailEl) emailEl.value = userData.email || '';
    if (phoneEl) phoneEl.value = userData.phone || '';
    if (addressEl) addressEl.value = userData.address || '';
    if (pinEl && userData.pincode) {
        pinEl.value = userData.pincode;
        validatePincode();
    }

    // Update the compact view
    updateSavedView(userData);

    // 2. Process Guest Cart
    const localCart = JSON.parse(localStorage.getItem('guestCart') || '[]');
    const items = localCart.map((item, index) => ({ id: `guest-${index}`, ...item }));
    processCartItemsArray(items);
    
    attachSummaryListeners();
}

async function fetchUserDataAndCart(user) {
    // 1. Fetch User Profile Data
    const userRef = doc(db, "users", user.uid);
    try {
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const userData = userSnap.data();
            const nameEl = document.getElementById('user-name');
            const emailEl = document.getElementById('user-email');
            const phoneEl = document.getElementById('user-phone');
            const addressEl = document.getElementById('user-address');
            const pinEl = document.getElementById('user-pincode');

            if (nameEl) nameEl.value = userData.name || '';
            if (emailEl) emailEl.value = userData.email || user.email;
            if (phoneEl) phoneEl.value = userData.phone || '';
            if (addressEl) addressEl.value = userData.address || '';
            if (pinEl && userData.pincode) {
                pinEl.value = userData.pincode;
                validatePincode();
            }

            // Store role globally for exceptions (like admin stock-out bypass)
            window.userRole = userData.role || 'customer';

            // Update the compact view
            updateSavedView(userData);
        } else {
            console.warn("User document not found, showing defaults.");
            updateSavedView({}); // Show "Fill details"
        }

        // Trigger real-time listeners for pre-filled data
        attachSummaryListeners();
    } catch (err) {
        console.error("Error fetching user data:", err);
        updateSavedView({});
    }

    // Trigger cart processing manually once to init
    const cartRef = collection(db, "carts", user.uid, "items");
    const querySnapshot = await getDocs(cartRef);
    const items = [];
    querySnapshot.forEach(docSnap => items.push({ id: docSnap.id, ...docSnap.data() }));
    processCartItemsArray(items);
}

function processCartItemsArray(itemsArray) {
    // Check if this is a Buy Now flow
    const urlParams = new URLSearchParams(window.location.search);
    const isBuyNow = urlParams.get('buyNow') === 'true';
    const isReorder = urlParams.get('reorder') === 'true';
    const buyNowItemStr = sessionStorage.getItem('buyNowItem');
    const reorderItemsStr = sessionStorage.getItem('reorderItems');

    // Reset Globals
    cartSubtotal = 0;
    cartItemCount = 0;
    // Reset Out of Stock Tracker
    window.outOfStockItemIds = [];
    let totalSellingPrice = 0;
    let hasStockOut = false;
    let itemsToRender = [];

    if (isBuyNow && buyNowItemStr) {
        const item = JSON.parse(buyNowItemStr);
        const liveData = getRealtimeItemData(item.name, item.weight, item);

        const currentPrice = liveData.price;
        const itemMrp = liveData.mrp;
        const isOut = liveData.isOut;

        if (isOut) {
            // Admin Exception: Allow admins to proceed even if items are stock out
            if (window.userRole !== 'admin') {
                hasStockOut = true;
            }
            window.outOfStockItemIds.push('buyNow');
        }

        cartSubtotal = itemMrp * item.quantity;
        cartItemCount = item.quantity;
        totalSellingPrice = currentPrice * item.quantity;

        window.cartSellingPrice = totalSellingPrice;
        window.buyNowMode = true;
        window.reorderMode = false;
        window.buyNowItem = { ...item, price: currentPrice };

        itemsToRender = [item];
    } else if (isReorder && reorderItemsStr) {
        const items = JSON.parse(reorderItemsStr);
        window.buyNowMode = false;
        window.reorderMode = true;
        window.reorderItems = items;

        items.forEach(item => {
            const liveData = getRealtimeItemData(item.name, item.weight, item);
            if (liveData.isOut) {
                // Admin Exception: Allow admins to proceed even if items are stock out
                if (window.userRole !== 'admin') {
                    hasStockOut = true;
                }
                window.outOfStockItemIds.push('reorder'); 
            }
            cartSubtotal += liveData.mrp * item.quantity;
            totalSellingPrice += liveData.price * item.quantity;
            cartItemCount += (item.quantity || 1);
        });

        window.cartSellingPrice = totalSellingPrice;
        itemsToRender = items;
    } else {
        // Ensure buyNowMode is false if not in that flow
        window.buyNowMode = false;
        window.reorderMode = false;
        window.buyNowItem = null;
        window.reorderItems = null;

        itemsArray.forEach(item => {
            if (item.quantity <= 0) return; // Skip ghost items

            const liveData = getRealtimeItemData(item.name, item.weight, item);

            if (liveData.isOut) {
                // Admin Exception: Allow admins to proceed even if items are stock out
                if (window.userRole !== 'admin') {
                    hasStockOut = true;
                }
                window.outOfStockItemIds.push(item.id);
            }

            cartSubtotal += liveData.mrp * item.quantity;
            totalSellingPrice += liveData.price * item.quantity;
            cartItemCount += (item.quantity || 1);

            itemsToRender.push({ ...item });
        });

        window.cartSellingPrice = totalSellingPrice;
    }

    // Render Items securely
    renderCheckoutItems(itemsToRender);

    // --- DISCOUNT LOGIC ---
    let couponDiscount = 0;
    const appliedCoupon = sessionStorage.getItem('appliedCoupon');
    const coupons = { 'AQUALITY': 0.02, 'PLUSQUALITY': 0.02, 'APLUS': 0.02, 'HAPPY': 0.02, 'THANKS': 0.02, 'SAHIL': 0.02, 'MEAT10': 0.10 };

    if (appliedCoupon && coupons[appliedCoupon]) {
        couponDiscount = totalSellingPrice * coupons[appliedCoupon];
        if (couponDiscount < 4) couponDiscount = 4;
    }

    let itemSavings = cartSubtotal - totalSellingPrice;
    if (itemSavings < 0) itemSavings = 0;
    cartDiscount = itemSavings + couponDiscount;
    window.itemSavings = itemSavings;
    window.couponDiscount = couponDiscount;

    // Handle Stock Out Block
    const proceedBtn = document.getElementById('proceed-to-payment-btn');
    if (hasStockOut && proceedBtn) {
        proceedBtn.classList.remove('disabled'); // Allow clicking to remove OOS items
        proceedBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Remove Stock Out Items';
        proceedBtn.style.background = '#dc3545'; // bootstrap danger
    } else if (proceedBtn) {
        if (cartItemCount === 0) {
            proceedBtn.innerHTML = '<i class="fas fa-shopping-basket"></i> Cart is Empty';
            proceedBtn.classList.add('disabled');
            proceedBtn.style.background = '#ccc';
        } else {
            proceedBtn.innerHTML = 'Proceed to Payment <i class="fas fa-arrow-right"></i>';
            proceedBtn.classList.remove('disabled');
            proceedBtn.style.background = 'var(--primary)';
            checkOperatingHours(); // Re-check operating hours which might disable it
        }
    }

    window.checkoutItems = itemsToRender;
    updateCheckoutSummary();
}

/**
 * Renders the list of items on the checkout page so user knows exactly what they are buying
 */
/**
 * Renders the list of items on the checkout page.
 * If isModifyMode is ON, it shows +/- and delete buttons for each item.
 */
function renderCheckoutItems(items) {
    const listEl = document.getElementById('checkout-items-list');
    const containerEl = document.getElementById('cart-items-section');
    if (!listEl || !containerEl) return;

    if (items.length === 0) {
        containerEl.style.display = 'none';
        return;
    }

    containerEl.style.display = 'block';
    listEl.innerHTML = '';

    // If NOT in modify mode, we keep the "Summary" view (grouped by name)
    if (!isModifyMode) {
        const groups = {};
        items.forEach(item => {
            const liveData = getRealtimeItemData(item.name, item.weight, item);
            const name = item.name;
            if (!groups[name]) {
                groups[name] = {
                    name: item.name,
                    image: item.image || item.img,
                    totalPrice: 0,
                    totalMrp: 0,
                    totalWeight: 0,
                    totalEggQty: 0,
                    isEgg: name.toLowerCase().includes('egg'),
                    isOut: false,
                    variants: []
                };
            }
            groups[name].variants.push({ ...item, ...liveData });
            groups[name].totalPrice += liveData.price * item.quantity;
            groups[name].totalMrp += liveData.mrp * item.quantity;
            if (liveData.isOut) groups[name].isOut = true;

            if (groups[name].isEgg) {
                const match = item.weight.match(/\d+/);
                const unitQty = match ? parseInt(match[0]) : 0;
                groups[name].totalEggQty += unitQty * item.quantity;
            } else {
                let weightVal = 0;
                const cleanW = item.weight.toLowerCase();
                if (cleanW.includes('500g')) weightVal = 0.5;
                else if (cleanW.includes('1kg') || cleanW.includes('1000g')) weightVal = 1.0;
                else weightVal = parseFloat(item.weight) || 0;
                groups[name].totalWeight += weightVal * item.quantity;
            }
        });

        Object.values(groups).forEach(group => {
            const isOut = group.isOut;
            const totalDisplay = group.isEgg ? `${group.totalEggQty} Eggs` : `${group.totalWeight.toFixed(2)} kg`;
            const variantText = group.variants.map(v => `${v.weight} x ${v.quantity}`).join(', ');

            const itemHtml = `
                <div class="checkout-item ${isOut ? 'checkout-stock-out' : ''}" style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid #f0f0f0;">
                    <img src="${group.image}" class="checkout-item-img" alt="${group.name}" style="width: 60px; height: 60px; border-radius: 8px; object-fit: cover; margin-right: 15px;">
                    <div class="checkout-item-info" style="flex: 1;">
                        <h6 class="checkout-item-name" style="font-weight: 700; color: #1a1a1a; margin-bottom: 2px;">${group.name}</h6>
                        <span class="checkout-item-sub" style="color: #666; font-size: 12px; display: block;">${variantText}</span>
                        <span class="checkout-item-total-qty" style="color: #ff7c08; font-weight: 700; font-size: 13px;">Total: ${totalDisplay}</span>
                        ${isOut ? '<br><span class="stock-out-badge" style="color: #dc3545; font-size: 11px; font-weight: 800;">OUT OF STOCK</span>' : ''}
                    </div>
                    <div class="checkout-item-price text-end">
                        <div style="font-weight: 800; color: #1a1a1a; font-size: 16px;">₹${group.totalPrice.toFixed(0)}</div>
                        ${group.totalMrp > group.totalPrice ? `<del style="font-size: 12px; color: #999;">₹${group.totalMrp.toFixed(0)}</del>` : ''}
                    </div>
                </div>
            `;
            listEl.insertAdjacentHTML('beforeend', itemHtml);
        });
    } 
    // If IN modify mode, we show each itemized entry for easy modification
    else {
        items.forEach(item => {
            const liveData = getRealtimeItemData(item.name, item.weight, item);
            const isOut = liveData.isOut;
            const itemPrice = liveData.price * item.quantity;
            const itemMrp = liveData.mrp * item.quantity;
            const itemId = item.id || `item_${items.indexOf(item)}`; // Fallback if no ID

            const itemHtml = `
                <div class="checkout-item modify-active ${isOut ? 'checkout-stock-out' : ''}" style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid #f0f0f0;" data-item-id="${item.id}" data-item-name="${item.name}">
                    <img src="${item.image || item.img}" class="checkout-item-img" alt="${item.name}" style="width: 50px; height: 50px; border-radius: 8px; object-fit: cover; margin-right: 12px;">
                    <div class="checkout-item-info" style="flex: 1;">
                        <h6 class="checkout-item-name" style="font-weight: 700; color: #1a1a1a; margin-bottom: 2px; font-size: 13px;">${item.name}</h6>
                        <span class="checkout-item-sub" style="color: #666; font-size: 11px; display: block;">${item.weight}</span>
                        
                        <div class="modify-qty-control mt-1">
                            <button type="button" class="modify-qty-btn" onclick="updateCheckoutQty('${item.id}', -1)">-</button>
                            <span class="modify-qty-val">${item.quantity}</span>
                            <button type="button" class="modify-qty-btn" onclick="updateCheckoutQty('${item.id}', 1)">+</button>
                            <button type="button" class="btn-delete-item ms-2" data-action="delete" data-id="${item.id}" data-name="${item.name.replace(/'/g, "\\'").replace(/"/g, "&quot;")}">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    </div>
                    <div class="checkout-item-price text-end">
                        <div style="font-weight: 800; color: #1a1a1a; font-size: 15px;">₹${itemPrice.toFixed(0)}</div>
                    </div>
                </div>
            `;
            listEl.insertAdjacentHTML('beforeend', itemHtml);
        });
    }
}

// --- MODIFICATION FUNCTIONS ---
window.updateCheckoutQty = async function(itemId, delta) {
    const user = auth.currentUser;
    if (!user || !itemId || itemId === 'buyNow') return;

    try {
        const itemRef = doc(db, "carts", user.uid, "items", itemId);
        const itemSnap = await getDoc(itemRef);
        if (itemSnap.exists()) {
            const currentQty = itemSnap.data().quantity || 1;
            const newQty = currentQty + delta;
            
            if (newQty <= 0) {
                await deleteDoc(itemRef);
            } else {
                await updateDoc(itemRef, { quantity: newQty });
            }
        }
    } catch (err) {
        console.error("Error updating qty:", err);
    }
};

window.deleteCheckoutItem = async function(itemId, itemName) {
    console.log("[Checkout] deleteCheckoutItem called for:", itemName, "ID:", itemId);
    const user = auth.currentUser;
    if (!user) {
        console.warn("[Checkout] Delete failed: No user authenticated.");
        return;
    }
    if (!itemId || itemId === 'buyNow') {
        console.warn("[Checkout] Delete failed: Invalid itemId:", itemId);
        return;
    }

    if (confirm(`Remove ${itemName} from your order?`)) {
        try {
            console.log("[Checkout] Deleting item from Firestore...");
            await deleteDoc(doc(db, "carts", user.uid, "items", itemId));
            console.log("[Checkout] Item deleted successfully.");
            showValidationToast(`${itemName} removed from cart.`);
        } catch (err) {
            console.error("[Checkout] Error deleting item:", err);
            showValidationToast("Failed to remove item. Please try again.");
        }
    } else {
        console.log("[Checkout] Delete cancelled by user.");
    }
};



function updateCheckoutSummary() {
    const delivery = getDeliveryCharge();
    const total = window.cartSellingPrice + delivery - (window.couponDiscount || 0);

    const titleEl = document.getElementById('summary-title');
    const subtotalEl = document.getElementById('summary-subtotal');
    const deliveryEl = document.getElementById('summary-delivery');
    const discountEl = document.getElementById('summary-discount');
    const totalEl = document.getElementById('summary-total');

    updateFreeDeliveryProgressBar(window.cartSellingPrice);

    if (titleEl) titleEl.textContent = `Order Summary (${cartItemCount} items)`;
    if (subtotalEl) subtotalEl.textContent = `₹${cartSubtotal.toFixed(2)}`;

    if (deliveryEl) {
        if (window.cartSellingPrice >= 350) {
            deliveryEl.textContent = 'Free';
            deliveryEl.style.color = '#28a745';
            deliveryEl.style.fontWeight = '700';
        } else if (delivery > 0) {
            deliveryEl.textContent = `₹${delivery.toFixed(0)}`;
            deliveryEl.style.color = 'var(--primary)';
            deliveryEl.style.fontWeight = '700';
        } else {
            // No delivery charge detected yet or invalid address
            deliveryEl.textContent = '₹0.00';
            deliveryEl.style.color = '#999';
            deliveryEl.style.fontWeight = '500';
        }
    }

    const discountRow = document.getElementById('summary-discount-row');
    const totalDiscountDisplay = (window.itemSavings || 0) + (window.couponDiscount || 0);
    if (discountEl) {
        if (totalDiscountDisplay > 0) {
            discountEl.textContent = `- ₹${totalDiscountDisplay.toFixed(0)}`;
            if (discountRow) discountRow.style.display = 'flex';
        } else {
            if (discountRow) discountRow.style.display = 'none';
        }
    }

    if (totalEl) totalEl.textContent = `₹${total.toFixed(2)}`;

    const cartBadge = document.getElementById('cart-count-badge');
    if (cartBadge) cartBadge.innerText = cartItemCount;

    // Store delivery charge for payment page
    localStorage.setItem('deliveryCharge', delivery);
}

/**
 * Update the free delivery progress banner based on the current cart total.
 * Ported from cart_view.js for consistent cross-page experience.
 */
function updateFreeDeliveryProgressBar(currentTotal) {
    const banner = document.getElementById('free-delivery-banner');
    const textEl = document.getElementById('free-delivery-text');
    const progressBar = document.getElementById('free-delivery-progress-bar');
    const iconEl = document.getElementById('free-delivery-icon');
    const threshold = 350;

    if (!banner || !textEl || !progressBar || !iconEl) return;

    if (currentTotal === 0) {
        banner.style.display = 'none';
        return;
    }

    banner.style.display = 'flex';
    if (currentTotal >= threshold) {
        banner.style.background = '#e7f5ed'; // Premium light green
        textEl.innerHTML = `<span style="color: #28a745; font-weight: 800;">Free Delivery Unlocked!</span>`;
        if (progressBar.parentElement) progressBar.parentElement.style.display = 'none'; // Hide bar when unlocked
        iconEl.style.color = '#28a745'; // Switch to green
    } else {
        const remaining = threshold - currentTotal;
        // Optimization: start bar at 15% visually even if cart is small to indicate progress
        const percent = Math.min(100, 15 + ((currentTotal / threshold) * 85));
        
        banner.style.background = '#fff8f4'; // Original light orange
        textEl.innerHTML = `Add <span style="color: #ff7c08; font-weight: 800;">₹${remaining.toFixed(0)}</span> for <span style="color: #ff7c08; font-weight: 800;">FREE DELIVERY</span>!`;
        if (progressBar.parentElement) progressBar.parentElement.style.display = 'block'; // Show progress bar
        progressBar.style.width = percent + '%';
        iconEl.style.color = '#ff7c08'; // Switch back to orange
    }
}


/**
 * Attaches input listeners to delivery details fields to update the summary in real-time.
 */
function attachSummaryListeners() {
    const addressInput = document.getElementById('user-address');
    const pincodeInput = document.getElementById('user-pincode');

    if (addressInput && !addressInput.dataset.hasListener) {
        addressInput.addEventListener('input', updateCheckoutSummary);
        addressInput.dataset.hasListener = "true";
    }

    if (pincodeInput && !pincodeInput.dataset.hasListener) {
        pincodeInput.addEventListener('input', () => {
            // Also validate pincode for "Proceed" button state
            validatePincode();
            updateCheckoutSummary();
        });
        pincodeInput.dataset.hasListener = "true";
    }

    // Initial run to ensure current state is reflected
    updateCheckoutSummary();
}

function checkOperatingHours() {
    const messageContainer = document.getElementById('operating-hours-message');
    const nextDeliveryTimeEl = document.getElementById('next-delivery-time');
    const proceedBtn = document.getElementById('proceed-to-payment-btn');

    if (!messageContainer) return;

    // Get current time in IST
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const currentHour = now.getHours();
    console.log("[DEBUG] checkOperatingHours - currentHour (IST):", currentHour);

    // 8 AM to 8 PM (20:00)
    let isOpen = currentHour >= 8 && currentHour < 20;

    // Developer bypass
    const user = auth.currentUser;
    if ((user && user.email &&
        (user.email.toLowerCase() === 'aarxslan@gmail.com' ||
            user.email.toLowerCase() === '10sahilsarkargg@gmail.com')) || window.userRole === 'admin') {
        isOpen = true;
    }

    if (isOpen) {
        messageContainer.style.display = 'none'; // Hide when open to save space
        if (proceedBtn) proceedBtn.disabled = false;
    } else {
        messageContainer.style.display = 'block';
        messageContainer.classList.add('closed');
        const opHoursText = document.getElementById('op-hours-text');
        if (opHoursText) opHoursText.innerHTML = '<i class="fas fa-exclamation-circle"></i> We are currently closed.';
        if (nextDeliveryTimeEl) nextDeliveryTimeEl.textContent = 'Next delivery slot opens at 8 AM IST.';
        if (proceedBtn) {
            proceedBtn.disabled = true;
            proceedBtn.textContent = 'Currently unavailable';
            proceedBtn.style.background = '#ccc';
        }
    }
}