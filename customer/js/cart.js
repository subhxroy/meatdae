import { app, auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { doc, setDoc, getDocs, collection, addDoc, deleteDoc, serverTimestamp, query, where, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

// Helper: Custom Popup
function showPopupMessage(title, message, isError = false) {
    if (window.showCustomAlert) {
        window.showCustomAlert(message, title, isError ? 'error' : 'success');
    } else {
        alert(message);
    }
}

// Helper: Pulse effect for cart icon
function triggerCartActionEffect() {
    const badges = document.querySelectorAll('.cart-count');
    badges.forEach(badge => {
        badge.classList.remove('cart-bounce');
        void badge.offsetWidth; // Trigger reflow
        badge.classList.add('cart-bounce');
    });
}

/**
 * CART VERSIONING - FORCE CLEAR 
 * Update this version whenever product names/prices change significantly
 * to ensure users don't have stale items in their carts.
 */
const CURRENT_CART_VERSION = "2.3";

async function forceClearCart(user) {
    console.log("[Cart] Force clearing cart for version:", CURRENT_CART_VERSION);

    // 1. Clear Local Guest Cart
    localStorage.removeItem('guestCart');

    // 2. Clear Firestore Cart if logged in
    if (user) {
        try {
            const cartRef = collection(db, "carts", user.uid, "items");
            const snapshot = await getDocs(cartRef);
            const deletePromises = snapshot.docs.map(itemDoc => deleteDoc(doc(db, "carts", user.uid, "items", itemDoc.id)));
            await Promise.all(deletePromises);
            console.log("[Cart] Firestore items cleared.");
        } catch (error) {
            console.error("[Cart] Error clearing Firestore cart:", error);
        }
    }

    // 3. Update local version to mark as cleared
    localStorage.setItem('cart_version', CURRENT_CART_VERSION);

    if (user) updateCartCounter(user);
    else updateCartCounter(null);
}

export async function updateCartCounter(user) {
    let cartCount = 0;
    if (user) {
        try {
            const cartRef = collection(db, "carts", user.uid, "items");
            const querySnapshot = await getDocs(cartRef);
            querySnapshot.forEach(docSnap => {
                cartCount += (docSnap.data().quantity || 1);
            });
        } catch (error) {
            console.error("Error fetching cart count:", error);
        }
    } else {
        // Fetch from local storage for guest
        const localCart = JSON.parse(localStorage.getItem('guestCart') || '[]');
        localCart.forEach(item => {
            cartCount += (item.quantity || 1);
        });
    }
    document.querySelectorAll('.cart-count').forEach(counter => {
        counter.textContent = cartCount;
        counter.style.display = cartCount > 0 ? 'block' : 'none';
    });
}

/**
 * Sync guest cart items to Firestore after login
 */
window.syncGuestCart = async function (uid) {
    if (!uid) return;
    const localCart = JSON.parse(localStorage.getItem('guestCart') || '[]');
    if (localCart.length === 0) return;

    console.log("[syncGuestCart] Syncing guest items to Firestore for user:", uid);

    try {
        const cartRef = collection(db, "carts", uid, "items");

        for (const item of localCart) {
            const q = query(cartRef, where("name", "==", item.name), where("weight", "==", item.weight || ""));
            const querySnapshot = await getDocs(q);

            if (!querySnapshot.empty) {
                const existingDoc = querySnapshot.docs[0];
                await updateDoc(existingDoc.ref, {
                    quantity: existingDoc.data().quantity + (item.quantity || 1)
                });
            } else {
                await addDoc(cartRef, {
                    ...item,
                    timestamp: serverTimestamp()
                });
            }
        }

        // Clear local cart after sync
        localStorage.removeItem('guestCart');
        console.log("[syncGuestCart] Sync complete and local cart cleared.");
        
        // Refresh counter and any listeners
        updateCartCounter({ uid });
        window.dispatchEvent(new CustomEvent('cartSynced', { detail: { uid } }));
    } catch (error) {
        console.error("Error syncing guest cart:", error);
    }
};

export async function syncGuestCart(uid) {
    return window.syncGuestCart(uid);
}

function showCartPopup(product) {
    const popup = document.createElement('div');
    popup.className = 'cart-popup';
    popup.innerHTML = `
        <div class="popup-content">
            <div class="popup-details">
                <h4>Added to cart!</h4>
                <p>${product.name}</p>
            </div>
            <a href="cart_view.html" class="common_btn">View Cart</a>
            <button class="close-popup">&times;</button>
        </div>`;
    document.body.appendChild(popup);

    // Trigger animation
    setTimeout(() => popup.classList.add('show'), 100);

    popup.querySelector('.close-popup').addEventListener('click', () => {
        popup.classList.remove('show');
        setTimeout(() => popup.remove(), 300);
    });

    setTimeout(() => {
        if (popup.parentNode) {
            popup.classList.remove('show');
            setTimeout(() => popup.remove(), 300);
        }
    }, 5000);

    // Round 2 Enhancement: Trigger Pulse Animation on Cart Icon
    if (typeof triggerCartActionEffect === 'function') {
        triggerCartActionEffect();
    }
}

/**
 * Update the homepage product card to show a quantity selector after adding to cart.
 * This updates the DOM and keeps the card in sync with the Firestore cart.
 */
export function setHomepageCardQuantity({ id, qty, size, price, name, img }) {
    const card = document.querySelector(`.modern-product-card[data-id="${id}"]`);
    if (!card) return;

    const actions = card.querySelector('.product-actions');
    if (!actions) return;

    // Save original action buttons so we can restore when qty goes to 0
    if (!card.dataset.originalActions) {
        card.dataset.originalActions = actions.innerHTML;
    }

    if (!qty || qty <= 0) {
        actions.innerHTML = card.dataset.originalActions;
        delete card.dataset.cartQty;
        delete card.dataset.cartName;
        delete card.dataset.cartSize;
        delete card.dataset.cartPrice;
        return;
    }

    card.dataset.cartQty = qty;
    card.dataset.cartName = name || card.dataset.name;
    card.dataset.cartSize = size || card.dataset.defaultSize || '';
    card.dataset.cartPrice = price || card.dataset.price || '';

    actions.innerHTML = `
      <div class="card-qty-control" data-product-id="${id}">
        <button type="button" class="card-qty-btn card-qty-decrease" aria-label="Decrease quantity">-</button>
        <span class="card-qty-value">${qty}</span>
        <button type="button" class="card-qty-btn card-qty-increase" aria-label="Increase quantity">+</button>
      </div>
    `;
}

// Expose helper to other scripts that may import this module
window.setHomepageCardQuantity = setHomepageCardQuantity;

/**
 * Update Firestore cart item quantity by item name (cart entry name should match exactly)
 * Will add the item if it doesn't exist, update quantity if it does, or remove if quantity <= 0.
 */
export async function updateCartItemQuantity(userId, itemName, delta, opts = {}) {
    if (!userId || !itemName) return 0;

    const cartRef = collection(db, "carts", userId, "items");
    const q = query(cartRef, where("name", "==", itemName));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
        if (delta <= 0) return 0;
        const itemData = {
            name: itemName,
            quantity: delta,
            price: opts.price || 0,
            mrp: opts.mrp || opts.price || 0,
            image: opts.image || "",
            size: opts.size || "",
            timestamp: serverTimestamp()
        };
        await addDoc(cartRef, itemData);
        return delta;
    }

    const docSnap = snapshot.docs[0];
    const currentQty = docSnap.data().quantity || 0;
    const newQty = Math.max(0, currentQty + delta);

    if (newQty <= 0) {
        await deleteDoc(doc(db, "carts", userId, "items", docSnap.id));
        return 0;
    }

    await updateDoc(doc(db, "carts", userId, "items", docSnap.id), { quantity: newQty });
    return newQty;
}

function attachCardQuantityControls() {
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('.card-qty-decrease, .card-qty-increase');
        if (!btn) return;

        const card = btn.closest('.modern-product-card, .menu_swiggy_card, .menu_item');
        if (!card) return;

        const user = auth.currentUser;
        if (!user) {
            // Guest item quantity update
            let localCart = JSON.parse(localStorage.getItem('guestCart') || '[]');
            const itemName = card.dataset.cartName || card.dataset.name;
            const size = card.dataset.cartSize || card.dataset.defaultSize || '';
            const delta = btn.classList.contains('card-qty-increase') ? 1 : -1;

            const existingIndex = localCart.findIndex(item => item.name === itemName && item.weight === size);
            if (existingIndex > -1) {
                localCart[existingIndex].quantity = Math.max(0, localCart[existingIndex].quantity + delta);
                const newQty = localCart[existingIndex].quantity;
                if (newQty <= 0) {
                    localCart.splice(existingIndex, 1);
                }
                localStorage.setItem('guestCart', JSON.stringify(localCart));

                setHomepageCardQuantity({
                    id: card.dataset.id,
                    qty: newQty,
                    size,
                    price: parseFloat(card.dataset.cartPrice || 0) || 0,
                    name: itemName,
                    img: card.dataset.img || ''
                });
                updateCartCounter(null);
            }
            return;
        }

        const itemName = card.dataset.cartName || card.dataset.name;
        if (!itemName) return;

        const size = card.dataset.cartSize || card.dataset.defaultSize || '';
        const price = parseFloat(card.dataset.cartPrice || 0) || 0;
        const delta = btn.classList.contains('card-qty-increase') ? 1 : -1;

        const newQty = await updateCartItemQuantity(user.uid, itemName, delta, {
            price,
            mrp: price,
            image: card.dataset.img || '',
            size
        });

        setHomepageCardQuantity({
            id: card.dataset.id,
            qty: newQty,
            size,
            price,
            name: itemName,
            img: card.dataset.img || ''
        });

        updateCartCounter(user);
    });
}

// ==== GLOBAL REPEAT LAST ORDER FUNCTION ====
window.repeatLastOrder = async function () {
    const user = auth.currentUser;
    if (!user) {
        if (typeof window.showLoginOverlay === 'function') {
            window.showLoginOverlay();
        } else {
            if (typeof window.goToLogin === 'function') {
                window.goToLogin();
            } else {
                window.location.replace('sign_in.html');
            }
        }
        return;
    }

    showPopupMessage("Info", "Fetching your last order...", false);

    try {
        const ordersRef = collection(db, "orders");
        const q = query(ordersRef, where("userId", "==", user.uid));
        
        let snapshot;
        try {
            snapshot = await getDocs(q);
        } catch (queryErr) {
            console.error("[RepeatOrder] Firestore Query Failed:", queryErr);
            showPopupMessage("Info", "You haven't placed any orders yet.");
            return;
        }

        if (!snapshot || snapshot.empty) {
            showPopupMessage("No Previous Orders", "You haven't placed any orders with MeatDae yet. Once you place an order, you can easily repeat it with one tap!");
            return;
        }

        let orders = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            // Ensure data is valid
            if (data && data.items) {
                orders.push(data);
            }
        });

        if (orders.length === 0) {
            showPopupMessage("Info", "We couldn't find any items in your previous orders to repeat.");
            return;
        }

        orders.sort((a, b) => {
            const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt instanceof Date ? a.createdAt.getTime() : 0);
            const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt instanceof Date ? b.createdAt.getTime() : 0);
            return timeB - timeA;
        });

        const lastOrder = orders[0];
        if (!lastOrder || !lastOrder.items || lastOrder.items.length === 0) {
            showPopupMessage("Info", "Your last order has no items to repeat.");
            return;
        }

        // Fetch current inventory for updated prices
        const invSnapshot = await getDocs(collection(db, "inventory"));
        const inventory = {};
        invSnapshot.forEach(docSnap => {
            inventory[docSnap.id.toLowerCase().trim()] = { id: docSnap.id, ...docSnap.data() };
        });

        const cartRef = collection(db, "carts", user.uid, "items");

        for (const item of lastOrder.items) {
            const normName = (item.name || "").toLowerCase().trim();
            let currentItem = inventory[normName];

            // If direct match fails, try fuzzy normalization
            if (!currentItem) {
                for (const key in inventory) {
                    if (key.replace(/ cuts?$/i, '') === normName.replace(/ cuts?$/i, '')) {
                        currentItem = inventory[key];
                        break;
                    }
                }
            }

            let currentPrice = item.price;
            let currentMrp = item.mrp || item.price;

            if (currentItem) {
                const weight = (item.weight || "").toLowerCase();
                const cleanWeight = weight.replace(/\s+/g, '');
                
                let isOut = false;
                if (cleanWeight.includes('500g')) {
                    if (currentItem.small === false) isOut = true;
                } else if (cleanWeight.includes('1kg') || cleanWeight.includes('1000g')) {
                    if (currentItem.large === false) isOut = true;
                } else if (cleanWeight.includes('220g')) {
                    if (currentItem.solo === false) isOut = true;
                } else if (cleanWeight.includes('30') && currentItem.name.toLowerCase().includes('big')) {
                    if (currentItem.small === false) isOut = true;
                } else if (cleanWeight.includes('60') && currentItem.name.toLowerCase().includes('big')) {
                    if (currentItem.large === false) isOut = true;
                } else if (cleanWeight.includes('15') && currentItem.name.toLowerCase().includes('duck')) {
                    if (currentItem.small === false) isOut = true;
                } else if (cleanWeight.includes('30') && currentItem.name.toLowerCase().includes('duck')) {
                    if (currentItem.large === false) isOut = true;
                }

                if (isOut) {
                    console.log(`[RepeatOrder] Skipping out-of-stock item: ${item.name}`);
                    continue; // Skip out-of-stock items
                }

                const isLarge = weight.includes('1kg') || weight.includes('1000g') || weight.includes('1kilogram') || weight.includes('60') || (weight.includes('30') && currentItem.name.toLowerCase().includes('duck'));

                if (isLarge) {
                    currentPrice = currentItem.price_large || currentItem.price_small || item.price;
                    currentMrp = currentItem.mrp_large || currentItem.mrp_small || currentPrice;
                } else {
                    currentPrice = currentItem.price_small || item.price;
                    currentMrp = currentItem.mrp_small || currentPrice;
                }
            }

            const qItem = query(cartRef, where("name", "==", item.name), where("weight", "==", item.weight || ""));
            const itemSnap = await getDocs(qItem);

            if (!itemSnap.empty) {
                const existingDoc = itemSnap.docs[0];
                await updateDoc(existingDoc.ref, {
                    quantity: existingDoc.data().quantity + item.quantity,
                    price: Number(currentPrice),
                    mrp: Number(currentMrp)
                });
            } else {
                await addDoc(cartRef, {
                    name: item.name,
                    image: item.image || "",
                    price: Number(currentPrice),
                    mrp: Number(currentMrp),
                    weight: item.weight || "",
                    quantity: item.quantity || 1,
                    timestamp: serverTimestamp()
                });
            }
        }

        showPopupMessage("Success", "Last order items added to cart!");
        setTimeout(() => {
            window.location.href = 'cart_view.html';
        }, 1200);

    } catch (err) {
        console.error("Error repeating order:", err);
        showPopupMessage("Error", "Could not repeat your last order. Please try again.", true);
    }
};

document.addEventListener('DOMContentLoaded', () => {

    onAuthStateChanged(auth, async user => {
        const path = window.location.pathname || '';
        const normalizedPath = path.toLowerCase();
        const isHomePage = normalizedPath === '' || normalizedPath.endsWith('index.html') || normalizedPath.endsWith('/') || normalizedPath.includes('/index');

        // Check for Forced Cart Wipe (One-time migration for all users)
        if (localStorage.getItem('cart_version') !== CURRENT_CART_VERSION) {
            await forceClearCart(user);
        }

        if (!path.endsWith('cart_view.html')) {
            attachAddToCartListeners(user);
            // Prevent card click navigation on the homepage; keep on other pages
            if (!isHomePage) attachCardViewListeners();
            attachCardQuantityControls();
        }

        if (user) {
            updateCartCounter(user);
            monitorActiveOrders(user);
        } else {
            updateCartCounter(null);
            document.querySelectorAll('.bottom-nav-item').forEach(btn => {
                const href = btn.getAttribute('href') || '';
                if (href.includes('my_orders.html')) {
                    btn.classList.remove('blink-orders');
                }
            });
        }
    });

    // Handle updates when components (like mobile-nav) are loaded dynamically
    window.addEventListener('componentsLoaded', () => {
        const user = auth.currentUser;
        updateCartCounter(user);
    });
});

async function monitorActiveOrders(user) {
    if (!user) return;
    const ordersRef = collection(db, "orders");
    const q = query(ordersRef, where("userId", "==", user.uid));

    // Use onSnapshot for real-time blinking update
    onSnapshot(q, (snapshot) => {
        let hasActiveOrders = false;
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const status = (data.status || "").toUpperCase();
            // Broaden statuses to catch any active state including prepared ones
            if (["PENDING_APPROVAL", "PREPARING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "READY", "PENDING"].includes(status)) {
                hasActiveOrders = true;
            }
        });

        document.querySelectorAll('.bottom-nav-item').forEach(btn => {
            const href = btn.getAttribute('href') || '';
            if (href.includes('my_orders.html')) {
                if (hasActiveOrders) {
                    btn.classList.add('blink-orders');
                } else {
                    btn.classList.remove('blink-orders');
                }
            }
        });
    }, (error) => {
        console.error("Order monitor failed:", error);
    });
}

async function addToFirestoreCart(uid, product) {
    try {
        product.timestamp = serverTimestamp();
        const cartRef = collection(db, "carts", uid, "items");
        const q = query(cartRef, where("name", "==", product.name), where("weight", "==", product.weight));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const existingDoc = querySnapshot.docs[0];
            await updateDoc(existingDoc.ref, { quantity: existingDoc.data().quantity + product.quantity });
        } else {
            await addDoc(cartRef, product);
        }
        showCartPopup(product);
        updateCartCounter({ uid });
    } catch (error) {
        console.error("Error adding to Firestore cart:", error);
    }
}

function addToLocalCart(product) {
    console.log("[addToLocalCart] Adding to guest cart:", product.name);
    let localCart = JSON.parse(localStorage.getItem('guestCart') || '[]');

    const existingIndex = localCart.findIndex(item => item.name === product.name && item.weight === product.weight);

    if (existingIndex > -1) {
        localCart[existingIndex].quantity += product.quantity;
    } else {
        localCart.push(product);
    }

    localStorage.setItem('guestCart', JSON.stringify(localCart));
    showCartPopup(product);
    updateCartCounter(null);
}

// Unified global Add to Cart function for use by other scripts (e.g. product-details-loader.js)
window.addToCart = async function(name, price, mrp, weight, image, quantity = 1) {
    if (typeof window.isItemStockOut === 'function' && window.isItemStockOut(name, weight)) {
        showPopupMessage('Out of Stock', 'This item/variant is currently out of stock.', true);
        return;
    }

    const product = {
        name,
        price,
        mrp: mrp || price,
        weight: weight || "",
        image: image || "",
        quantity: quantity
    };

    const user = auth.currentUser;
    if (user) {
        await addToFirestoreCart(user.uid, product);
    } else {
        addToLocalCart(product);
    }
};


function attachAddToCartListeners(user) {
    document.querySelectorAll('.add_to_cart, .details_button_area .common_btn, .btn-add-glass, .btn-premium-add').forEach(button => {
        button.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation(); // Prevent card click

            const btn = e.target.closest('.add_to_cart, .common_btn, .btn-add-glass, .btn-premium-add');
            if (!btn) return;

            // EXCLUDE category "VIEW" buttons from cart logic
            if (btn.textContent.trim().toUpperCase() === 'VIEW') {
                return;
            }

            if (btn.classList.contains('btn-disabled') || btn.textContent.includes('Stock')) {
                showPopupMessage('Out of Stock', 'This item is currently unavailable.', true);
                return;
            }

            // Fallback Stock Verification on Click
            const detailContainer = btn.closest('.product_details_text, .menu_details_text');
            let checkName = "";
            let checkWeight = "";
            
            if (detailContainer) {
                const titleH2 = detailContainer.querySelector('h2');
                checkName = titleH2 ? titleH2.textContent.trim() : "";
                let rawWeightLabel = document.querySelector('input[name="flexRadioDefault"]:checked')?.nextElementSibling?.textContent.trim() ||
                    document.querySelector('.wight_menu.active')?.textContent.trim() ||
                    document.querySelector('.wight_menu')?.textContent.trim() || '';
                checkWeight = rawWeightLabel.replace(/\s*\(.*?\)\s*/g, '').trim();
            } else {
                const menuItem = btn.closest('.menu_item, .menu_swiggy_card, .modern-product-card');
                if (menuItem) {
                    const titleEl = menuItem.querySelector('.title, .menu_swiggy_title, .product-title');
                    checkName = titleEl ? titleEl.textContent.trim() : "";
                    const weightEl = menuItem.querySelector('.wight_menu, .size-pill.active');
                    checkWeight = weightEl ? weightEl.textContent.trim() : "";
                    
                    if (checkName.toLowerCase().includes('chicken') && !checkWeight) {
                        checkWeight = "500g";
                    } else if (checkName.toLowerCase().includes('egg') && !checkWeight) {
                        checkWeight = "30 eggs";
                    }
                }
            }
            
            if (checkName && checkWeight && typeof window.isItemStockOut === 'function' && window.isItemStockOut(checkName, checkWeight)) {
                showPopupMessage('Out of Stock', 'This variant is currently out of stock.', true);
                return;
            }

            // --- BUTTON DEBOUNCING ---
            const originalHTML = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';

            let product;

            if (detailContainer) {
                // ... (logic)
                let rawWeightLabel = document.querySelector('input[name="flexRadioDefault"]:checked')?.nextElementSibling?.textContent.trim() ||
                    document.querySelector('.wight_menu.active')?.textContent.trim() ||
                    document.querySelector('.wight_menu')?.textContent.trim() || '';
                
                // CLEAN WEIGHT LABEL: Remove "(Out of Stock)" or similar status text
                const selectedWeightLabel = rawWeightLabel.replace(/\s*\(.*?\)\s*/g, '').trim();

                const unitPriceText = document.getElementById('base-price')?.textContent.replace(/[^\d.]/g, '') ||
                    detailContainer.querySelector('.price')?.childNodes[0]?.textContent.replace(/[^\d.]/g, '') || '0';

                const mrpPriceText = document.getElementById('del-price')?.textContent.replace(/[^\d.]/g, '') ||
                    detailContainer.querySelector('.price del')?.textContent.replace(/[^\d.]/g, '') || unitPriceText;

                product = {
                    name: detailContainer.querySelector('h2').textContent.trim(),
                    price: parseFloat(unitPriceText),
                    mrp: parseFloat(mrpPriceText),
                    image: document.getElementById('main-product-image')?.src || document.querySelector('.exzoom_img_ul img')?.src || '',
                    quantity: parseInt(document.querySelector('.quentity_btn input')?.value) || 1,
                    weight: selectedWeightLabel,
                };
            } else {
                // --- MENU CARD LOGIC ---
                const menuItem = e.target.closest('.menu_item, .menu_swiggy_card, .modern-product-card');
                if (!menuItem) {
                    btn.disabled = false;
                    btn.innerHTML = originalHTML;
                    return;
                }

                let mrp = 0;
                const priceEl = menuItem.querySelector('.price, .menu_swiggy_price, .product-price');
                if (priceEl) {
                    const delEl = priceEl.querySelector('del');
                    if (delEl) {
                        mrp = parseFloat(delEl.textContent.replace(/[^\d.]/g, ''));
                    }
                }

                const titleEl = menuItem.querySelector('.title, .menu_swiggy_title, .product-title');
                const itemName = titleEl ? titleEl.textContent.trim() : "";

                const weightEl = menuItem.querySelector('.wight_menu');
                let itemWeight = weightEl ? weightEl.textContent.trim() : "";

                if (itemName.toLowerCase().includes('chicken') && !itemWeight) {
                    itemWeight = "500g";
                } else if (itemName.toLowerCase().includes('egg') && !itemWeight) {
                    itemWeight = "30 eggs";
                }

                const imgEl = menuItem.querySelector('.menu_item_img img, .menu_swiggy_img_wrapper img, .product-image-container img');

                product = {
                    name: itemName,
                    price: priceEl ? parseFloat(priceEl.childNodes[0].textContent.replace(/[^\d.]/g, '')) : 0,
                    mrp: mrp || (priceEl ? parseFloat(priceEl.childNodes[0].textContent.replace(/[^\d.]/g, '')) : 0),
                    image: imgEl ? imgEl.src : "",
                    quantity: 1,
                    weight: itemWeight,
                };
            }

            try {
                if (user) {
                    await addToFirestoreCart(user.uid, product);
                } else {
                    addToLocalCart(product);
                    // Ensure counter updates for guests immediately
                    updateCartCounter(null);
                }
                btn.innerHTML = '<i class="fas fa-check"></i> Added';
                setTimeout(() => {
                    btn.disabled = false;
                    btn.innerHTML = originalHTML;
                }, 2000);
            } catch (error) {
                console.error("Cart error:", error);
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        });
    });
}

// Separate listener for card clicks (view product)
function attachCardViewListeners() {
    document.querySelectorAll('.menu_item, .menu_swiggy_card').forEach(card => {
        card.addEventListener('click', (e) => {
            // Prevent redirect if clicking ADD button
            if (e.target.closest('.add_to_cart, .btn-add-glass, .btn-premium-add, .btn-premium-buy')) {
                return;
            }

            const linkEl = card.querySelector('.menu_item_img a, .menu_swiggy_img_wrapper a, .title a, .menu_swiggy_title, .product-title');
            if (linkEl) {
                const url = linkEl.tagName === 'A' ? linkEl.getAttribute('href') : card.querySelector('a')?.getAttribute('href');
                if (url) window.location.href = url;
            }
        });
    });
}

// ==== HOMEPAGE MODAL LOGIC ====

// Modal state
let currentProduct = {};
let currentProductId = '';
let currentModalMode = 'add';
let selectedSize = '';
let selectedPrice = 0;
let selectedMrp = 0;
let quantity = 1;

// Make functions globally available
window.selectSize = function (btn) {
    document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedSize = btn.dataset.size;
    selectedPrice = parseInt(btn.dataset.price);
    selectedMrp = parseInt(btn.dataset.mrp || btn.dataset.price);
    updateTotal();
};

window.changeQty = function (delta) {
    quantity = Math.max(1, quantity + delta);
    document.getElementById('buy-now-qty').textContent = quantity;
    updateTotal();
};

function updateTotal() {
    const total = (selectedPrice || 0) * (quantity || 1);
    const mrpTotal = (selectedMrp || selectedPrice || 0) * (quantity || 1);

    const totalEl = document.getElementById('buy-now-total');
    if (totalEl) {
        if (mrpTotal > total) {
            totalEl.innerHTML = `₹${total.toFixed(0)} <del style="font-size: 16px; color: #999; margin-left: 8px;">₹${mrpTotal.toFixed(0)}</del>`;
        } else {
            totalEl.textContent = '₹' + total.toFixed(0);
        }
    }
}

window.closeBuyNowModal = function () {
    const modal = document.getElementById('buy-now-modal');
    if (modal) {
        modal.classList.remove('active');
        // Reset modal state
        quantity = 1;
        selectedSize = '';
        selectedPrice = 0;
    }
};

// Add to Cart function - saves to Firebase or Local Storage
window.addToCartFromModal = async function () {
    const user = auth.currentUser;
    const itemName = currentProduct.name;

    if (typeof window.isItemStockOut === 'function' && window.isItemStockOut(itemName, selectedSize)) {
        showPopupMessage('Out of Stock', 'This variant is currently out of stock.', true);
        return;
    }

    const itemData = {
        name: itemName,
        price: selectedPrice,
        mrp: selectedMrp || selectedPrice,
        quantity: quantity,
        image: currentProduct.img,
        weight: selectedSize,
        timestamp: serverTimestamp()
    };

    if (!user) {
        // GUEST CART LOGIC
        let localCart = JSON.parse(localStorage.getItem('guestCart') || '[]');
        const existingIndex = localCart.findIndex(item => item.name === itemName && item.weight === selectedSize);

        let newQty = quantity;
        if (existingIndex > -1) {
            localCart[existingIndex].quantity += quantity;
            newQty = localCart[existingIndex].quantity;
        } else {
            localCart.push(itemData);
        }

        localStorage.setItem('guestCart', JSON.stringify(localCart));
        updateCartCounter(null);

        // Update the homepage card to show quantity controls
        if (window.setHomepageCardQuantity) {
            window.setHomepageCardQuantity({
                id: currentProductId,
                qty: newQty,
                size: selectedSize,
                price: selectedPrice,
                name: itemName,
                img: currentProduct.img
            });
        }

        window.closeBuyNowModal();
        showToast('Added to cart!');
        return;
    }

    try {
        const cartRef = collection(db, 'carts', user.uid, 'items');
        const q = query(cartRef, where('name', '==', itemName), where('weight', '==', selectedSize));
        const querySnapshot = await getDocs(q);

        let newQty = quantity;
        if (!querySnapshot.empty) {
            const existingDoc = querySnapshot.docs[0];
            const existingQty = existingDoc.data().quantity || 0;
            newQty = existingQty + quantity;
            await updateDoc(doc(db, 'carts', user.uid, 'items', existingDoc.id), {
                quantity: newQty
            });
        } else {
            await addDoc(cartRef, itemData);
        }

        updateCartCounter(user);

        // Update the homepage card to show quantity controls
        if (window.setHomepageCardQuantity) {
            window.setHomepageCardQuantity({
                id: currentProductId,
                qty: newQty,
                size: selectedSize,
                price: selectedPrice,
                name: itemName,
                img: currentProduct.img
            });
        }

        window.closeBuyNowModal();
        showToast('Added to cart!');
    } catch (error) {
        console.error('Error adding to cart:', error);
        showPopupMessage('Cart Error', 'Failed to add to cart. Please try again.', true);
    }
};

window.confirmBuyNow = function () {
    if (typeof window.isItemStockOut === 'function' && window.isItemStockOut(currentProduct.name, selectedSize)) {
        showPopupMessage('Out of Stock', 'This variant is currently out of stock.', true);
        return;
    }

    const buyNowItem = {
        name: currentProduct.name,
        price: selectedPrice,
        mrp: selectedMrp || selectedPrice,
        quantity: quantity,
        img: currentProduct.img,
        weight: selectedSize,
        isBuyNow: true
    };
    sessionStorage.setItem('buyNowItem', JSON.stringify(buyNowItem));
    window.location.href = 'check_out.html?buyNow=true';
};

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'simple-toast';
    toast.innerHTML = `<i class="fa-solid fa-check-circle"></i> ${message}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

// Setup Event Listeners for direct actions on homepage cards
document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', async function (e) {
        const btn = e.target.closest('.modal-add-btn, .modal-buy-btn');
        if (btn) {
            const card = btn.closest('.modern-product-card');
            if (!card) return; // Only handle modern-product-card here

            const checkPill = card.querySelector('.size-pill.active');
            if (btn.classList.contains('btn-stock-out') || card.classList.contains('stock-out-item') ||
                (checkPill && typeof window.isItemStockOut === 'function' && window.isItemStockOut(btn.dataset.name, checkPill.dataset.size))) {
                showPopupMessage('Out of Stock', 'This variant is currently out of stock.', true);
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            const user = auth.currentUser;

            // Get selected size and price from the card's active size pill
            const activeSizePill = card.querySelector('.size-pill.active');
            if (!activeSizePill) {
                showPopupMessage('Selection Error', 'Please select a size first.', true);
                return;
            }

            const name = btn.dataset.name;
            const img = btn.dataset.img;
            const size = activeSizePill.dataset.size;
            const unitPrice = parseFloat(activeSizePill.dataset.price);

            const qtyElement = card.querySelector('.qty-value');
            const qty = qtyElement ? (parseInt(qtyElement.textContent) || 1) : 1;

            const totalPrice = unitPrice * qty;

            const product = {
                name: name,
                price: unitPrice,
                mrp: parseFloat(activeSizePill.dataset.mrp) || unitPrice,
                image: img,
                quantity: qty,
                weight: size
            };

            if (btn.classList.contains('modal-buy-btn')) {
                // Buy Now Logic - Guests can also Buy Now, they just need to sign in at checkout
                const buyNowItem = {
                    ...product,
                    isBuyNow: true
                };
                sessionStorage.setItem('buyNowItem', JSON.stringify(buyNowItem));
                window.location.href = 'check_out.html?buyNow=true';
            } else {
                // Add to Cart Logic
                const originalHTML = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

                try {
                    if (user) {
                        await addToFirestoreCart(user.uid, product);
                    } else {
                        addToLocalCart(product);
                    }
                    btn.innerHTML = '<i class="fas fa-check"></i>';
                    setTimeout(() => {
                        btn.disabled = false;
                        btn.innerHTML = originalHTML;
                    }, 1500);
                } catch (error) {
                    console.error('Error adding to cart:', error);
                    btn.disabled = false;
                    btn.innerHTML = originalHTML;
                    showPopupMessage('Error', 'Failed to add to cart.', true);
                }
            }
        }
    });
});