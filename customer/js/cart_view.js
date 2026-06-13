import { app, auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { collection, onSnapshot, doc, getDoc, getDocs, deleteDoc, updateDoc, addDoc, serverTimestamp, query, where } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { updateCartCounter } from './cart.js';

let cartItemsCache = [];
let inventoryCache = [];

// Real-time Inventory & Stock Listener
function listenToInventory() {
    return onSnapshot(collection(db, "inventory"), (querySnapshot) => {
        inventoryCache = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            data.name = doc.id;
            inventoryCache.push(data);
        });
        console.log("[REALTIME] Inventory updated:", inventoryCache.length, "items");
        
        // Re-render cart if user is logged in to reflect stock/price changes instantly
        const user = auth.currentUser;
        if (user) {
            displayCartItems(user);
        }
    }, (error) => {
        console.error("Error listening to inventory:", error);
    });
}

// Standard normalization for all customer-side matching
function normalizeName(name) {
    if (!name) return "";
    return name.toLowerCase()
               .replace(/-/g, ' ') // Map hyphens to spaces
               .replace(/ cuts?$/i, '') // Remove 'cut' or 'cuts' from the end for better matching
               .trim()
               .replace(/\s+/g, ' '); // Standardize spaces
}

// Unified function to get current price, mrp, and stock status
function getRealtimeItemData(productName, weight, originalItem) {
    const normalizedTarget = normalizeName(productName);
    // Find the product by matching normalized name or document ID
    const product = inventoryCache.find(i => {
        const invName = normalizeName(i.name);
        return invName === normalizedTarget;
    });
    
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

// Compact Toast Notification Function
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;

    let iconClass = 'fa-info-circle';
    if (type === 'success') iconClass = 'fa-check-circle';
    if (type === 'error') iconClass = 'fa-times-circle';

    toast.innerHTML = `
        <div class="toast-icon"><i class="fas ${iconClass}"></i></div>
        <div class="toast-message">${message}</div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('show');
    }, 100);

    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 5000);
}

// Modal Popup for Confirmations
function showConfirm(message) {
    return new Promise((resolve) => {
        const popup = document.getElementById('custom-popup');
        popup.querySelector('h4').textContent = 'Confirm Action';
        popup.querySelector('p').textContent = message;
        popup.querySelector('.popup-icon i').className = 'fas fa-question-circle confirm';

        const okButton = document.getElementById('popup-ok');
        const cancelButton = document.getElementById('popup-cancel');

        okButton.textContent = 'Yes';
        cancelButton.style.display = 'inline-block';
        okButton.style.display = 'inline-block';

        popup.classList.add('show');

        const newOkButton = okButton.cloneNode(true);
        const newCancelButton = cancelButton.cloneNode(true);
        okButton.parentNode.replaceChild(newOkButton, okButton);
        cancelButton.parentNode.replaceChild(newCancelButton, cancelButton);

        newOkButton.addEventListener('click', () => {
            popup.classList.remove('show');
            resolve(true);
        });

        newCancelButton.addEventListener('click', () => {
            popup.classList.remove('show');
            resolve(false);
        });
    });
}


let cartUnsubscribe = null;

document.addEventListener('DOMContentLoaded', () => {
    // Start listening to inventory immediately
    listenToInventory();

    onAuthStateChanged(auth, user => {
        if (user) {
            // Real-time Cart Listener for Logged-in User
            if (cartUnsubscribe) cartUnsubscribe();
            
            const cartRef = collection(db, "carts", user.uid, "items");
            cartUnsubscribe = onSnapshot(cartRef, (querySnapshot) => {
                displayCartItemsFromSnapshot(user, querySnapshot);
                updateCartCounter(user);
            });

            attachActionListeners(user);
            fetchAddonPrices();
        } else {
            // NEW: Allow guest user to view their cart
            if (cartUnsubscribe) cartUnsubscribe();
            
            // Re-render guest cart
            displayGuestCart();

            // Listen for storage changes (if user adds items in another tab)
            window.addEventListener('storage', () => {
                displayGuestCart();
            });

            attachActionListeners(null);
            fetchAddonPrices();
            updateCartCounter(null);
        }
    });
});

async function displayGuestCart() {
    const localCart = JSON.parse(localStorage.getItem('guestCart') || '[]');
    // Convert localCart to a format that looks like querySnapshot docs but is just an array
    const items = localCart.map((item, index) => ({
        id: `guest-${index}`,
        ...item
    }));
    
    await processCartItems(items, true);
}

async function displayCartItemsFromSnapshot(user, querySnapshot) {
    const items = [];
    querySnapshot.forEach(docSnap => {
        items.push({ id: docSnap.id, ...docSnap.data() });
    });
    await processCartItems(items, false);
}

async function processCartItems(items, isGuest) {
    const myntraContainer = document.getElementById('myntra-cart-items');
    const myntraCountEl = document.getElementById('myntra-cart-count');
    const clearAllBtn = document.querySelector('.myntra-clear-all');
    
    if (!myntraContainer) return;

    // Hide skeleton loader once real data arrives
    const skeleton = document.getElementById('cart-skeleton-loader');
    if (skeleton) skeleton.remove();

    myntraContainer.innerHTML = '';
    window.oosItemIds = [];

    let subtotal = 0;
    cartItemsCache = [];
    let hasRegularItems = false;

    if (items.length === 0) {
        // Check if we are currently syncing guest items (if user is logged in but cart is empty and guest items exist)
        const guestCart = localStorage.getItem('guestCart');
        const isUserLoggedIn = !isGuest;
        
        if (isUserLoggedIn && guestCart && guestCart !== '[]') {
            myntraContainer.innerHTML = `
                <div class="cart-empty-state">
                    <div class="state-icon">
                        <i class="fas fa-sync fa-spin"></i>
                    </div>
                    <h3>Syncing your cart...</h3>
                    <p>We are moving your selected items to your account.</p>
                </div>`;
        } else {
            myntraContainer.innerHTML = `
                <div class="cart-empty-state">
                    <div class="state-icon">
                        <i class="fas fa-shopping-basket"></i>
                    </div>
                    <h3>Your cart is lonely!</h3>
                    <p>Add some fresh meat and delicious items to make it happy.</p>
                    <a href="menu.html" class="cart-btn-primary">Browse All Items</a>
                </div>`;
        }
        if (clearAllBtn) clearAllBtn.style.display = 'none';
        if (myntraCountEl) myntraCountEl.textContent = '(0 items)';
        const pushSale = document.getElementById('push-sale-section');
        if (pushSale) pushSale.style.display = 'none';
        
        const summaryCard = document.querySelector('.summary-card');
        if (summaryCard) summaryCard.style.display = 'none';
    } else {
        if (clearAllBtn) clearAllBtn.style.display = isGuest ? 'none' : ''; // Hide clear all for guest for now to keep it simple
        const summaryCard = document.querySelector('.summary-card');
        if (summaryCard) summaryCard.style.display = 'block';
        
        function getProductLink(itemName) {
            const itemMap = {
                "Fresh Chicken Curry Cuts": "product_details.html?id=fresh-chicken-curry-cuts",
                "Fresh Chicken Boneless Cuts": "product_details.html?id=chicken-boneless-cut",
                "Fresh Chicken Legs Cuts": "product_details.html?id=chicken-legs-cut",
                "Chicken Breast Cuts": "product_details.html?id=chicken-breast-cuts",
                "Clean Gizzard Liver": "product_details.html?id=clean-gizzard-liver",
                "Pack of 10 fresh big eggs": "product_details.html?id=fresh-big-eggs",
                "Pack of 10 Local Duck Eggs": "product_details.html?id=local-duck-eggs",
                "Fresh Big Eggs": "product_details.html?id=fresh-big-eggs",
                "Local Duck Eggs": "product_details.html?id=local-duck-eggs",
                "Chicken Biriyani Cuts": "product_details.html?id=chicken-biriyani-cuts",
                "Pure Mutton Curry Cuts": "product_details.html?id=pure-mutton-curry-cuts"
            };
            return itemMap[itemName] || "#";
        }

        items.forEach(item => {
            const liveData = getRealtimeItemData(item.name, item.weight, item);
            const processedItem = { ...item, price: liveData.price, mrp: liveData.mrp, isOut: liveData.isOut };
            cartItemsCache.push(processedItem);

            const productLink = getProductLink(item.name);
            const isOut = processedItem.isOut;
            const itemTotalPrice = processedItem.price * processedItem.quantity;
            const itemTotalMrp = processedItem.mrp * processedItem.quantity;
            const mrpHtml = itemTotalMrp > itemTotalPrice ? `<span class="item-mrp" style="text-decoration: line-through; color: #999; font-size: 14px; margin-left: 8px;">₹${itemTotalMrp.toFixed(0)}</span>` : '';
            
            if (isOut) {
                window.oosItemIds.push(item.id);
            }

            subtotal += itemTotalMrp;
            if (item.name !== "Pack of 8 fresh big eggs" && item.name !== "Pack of 10 fresh big eggs" && item.name !== "Pack of 10 Local Duck Eggs") {
                hasRegularItems = true;
            }

            const card = `
                <div class="cart-item-card ${isOut ? 'stock-out-card' : ''}" data-id="${item.id}" data-name="${item.name}">
                    <div class="item-img-container" style="${isOut ? 'filter: grayscale(1); opacity: 0.6;' : ''}">
                        <a href="${productLink}"><img src="${processedItem.image}" alt="${item.name}"></a>
                    </div>
                    <div class="item-content">
                        <div class="item-top">
                            <div class="item-info">
                                <a href="${productLink}" style="text-decoration: none; color: inherit;"><h4>${item.name}</h4></a>
                                <p style="font-weight: 700; color: var(--primary-orange);">${item.weight}${isOut ? ' | <span class="text-danger fw-bold">OUT OF STOCK</span>' : ''}</p>
                            </div>
                            <button class="remove-btn remove-item" data-id="${item.id}" aria-label="Remove item"><i class="fas fa-trash-alt"></i></button>
                        </div>
                        <div class="item-bottom">
                            <span class="item-price">₹${itemTotalPrice.toFixed(0)}${mrpHtml}</span>
                            <div class="qty-controls">
                                <button class="qty-btn minus-btn"><i class="fas fa-minus"></i></button>
                                <span class="qty-val">${item.quantity}</span>
                                <button class="qty-btn plus-btn"><i class="fas fa-plus"></i></button>
                            </div>
                        </div>
                    </div>
                </div>`;
            myntraContainer.insertAdjacentHTML('beforeend', card);
        });

        let totalQuantity = 0;
        cartItemsCache.forEach(item => {
            totalQuantity += (item.quantity || 1);
        });
        if (myntraCountEl) myntraCountEl.textContent = `(${totalQuantity} item${totalQuantity > 1 ? 's' : ''})`;

        const pushSale = document.getElementById('push-sale-section');
        if (pushSale) {
            pushSale.style.display = hasRegularItems ? 'block' : 'none';
        }
    }

    updateCartSummary(subtotal, items.length);
}


// Deprecated displayCartItems since we use displayCartItemsFromSnapshot now
async function displayCartItems(user) {
    const cartRef = collection(db, "carts", user.uid, "items");
    const querySnapshot = await getDocs(cartRef);
    displayCartItemsFromSnapshot(user, querySnapshot);
}

function updateCartSummary(subtotalMRP, itemCount) {
    // subtotalMRP is now the sum of MRPs (or Price if MRP missing)

    // --- 1. Calculate Real Price Total (What user actually pays before coupon/delivery) ---
    let realPriceTotal = 0;
    cartItemsCache.forEach(item => {
        realPriceTotal += (Number(item.price) * item.quantity);
    });

    // --- 2. Calculate Item Level Savings ---
    // Item Savings = Total MRP - Total Real Price
    let itemSavings = subtotalMRP - realPriceTotal;
    if (itemSavings < 0) itemSavings = 0; // Safety check

    // --- 4. Total Discount Display ---
    const totalDiscountDisplay = itemSavings;

    // --- DELIVERY FEE ---
    let delivery = 0;

    // --- 5. Final Total ---
    // Total should be the real price user pays (Selling Price Total)
    const total = realPriceTotal + delivery;

    // Update IDs
    document.getElementById('summary-title').textContent = `Total Cart (${itemCount})`;

    // Subtotal shows the MRP Total (Cut Price)
    document.getElementById('summary-subtotal').textContent = `₹${subtotalMRP.toFixed(2)}`;

    // Display Delivery
    const deliverySpan = document.getElementById('summary-delivery');
    const checkoutBtn = document.querySelector('.checkout_btn');

    // Show delivery as Calculated at checkout
    deliverySpan.textContent = 'calculated at checkout';
    deliverySpan.style.color = '#666';
    deliverySpan.style.fontSize = '12px';

    // MAKE CHECKOUT BUTTON DISTINGUISHABLE
    if (checkoutBtn) {
        // Check if any items are out of stock via cache now that we don't have isItemStockOut
        const hasStockOut = cartItemsCache.some(item => {
            const liveData = getRealtimeItemData(item.name, item.weight, item);
            return liveData.isOut;
        });

        if (hasStockOut) {
            checkoutBtn.style.backgroundColor = '#dc3545';
            checkoutBtn.style.pointerEvents = 'auto'; // Enable clicking to remove
            checkoutBtn.style.opacity = '1';
            checkoutBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Remove Stock Out Items';
            checkoutBtn.style.fontSize = '14px';
            checkoutBtn.style.boxShadow = 'none';
        } else if (itemCount === 0) {
            checkoutBtn.style.backgroundColor = '#ccc';
            checkoutBtn.style.pointerEvents = 'none';
            checkoutBtn.style.opacity = '0.7';
            checkoutBtn.textContent = 'CART IS EMPTY';
            checkoutBtn.style.boxShadow = 'none';
        } else {
            checkoutBtn.style.backgroundColor = '#fc8019';
            checkoutBtn.style.pointerEvents = 'auto';
            checkoutBtn.style.opacity = '1';
            checkoutBtn.textContent = 'CHECKOUT';
            checkoutBtn.style.boxShadow = '0 4px 14px rgba(252, 128, 25, 0.3)';
        }

        // Add Click Listener for OOS Removal if not already added
        if (!checkoutBtn.dataset.listenerAdded) {
            checkoutBtn.addEventListener('click', async (e) => {
                const user = auth.currentUser;
                if (window.oosItemIds && window.oosItemIds.length > 0) {
                    e.preventDefault(); // Prevent navigation to checkout
                    
                    checkoutBtn.disabled = true;
                    checkoutBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Removing...';

                    try {
                        if (user) {
                            const deletePromises = window.oosItemIds.map(itemId => 
                                deleteDoc(doc(db, "carts", user.uid, "items", itemId))
                            );
                            await Promise.all(deletePromises);
                        } else {
                            // Guest OOS Removal
                            let localCart = JSON.parse(localStorage.getItem('guestCart') || '[]');
                            const oosIndexes = window.oosItemIds.map(id => parseInt(id.split('-')[1]));
                            localCart = localCart.filter((_, idx) => !oosIndexes.includes(idx));
                            localStorage.setItem('guestCart', JSON.stringify(localCart));
                            window.dispatchEvent(new Event('storage'));
                        }
                        
                        if (window.showCustomAlert) {
                            window.showCustomAlert("Unavailable items removed from your cart.", "Stock Updated", "success");
                        }
                        window.oosItemIds = [];
                    } catch (error) {
                        console.error("Error removing items:", error);
                        checkoutBtn.disabled = false;
                        checkoutBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Try Again';
                    }
                }
            });
            checkoutBtn.dataset.listenerAdded = "true";
        }

        checkoutBtn.style.color = 'white';
        checkoutBtn.style.padding = '12px 25px';
        checkoutBtn.style.borderRadius = '8px';
        checkoutBtn.style.fontWeight = '700';
        checkoutBtn.style.display = 'inline-block';
        checkoutBtn.style.textAlign = 'center';
        checkoutBtn.style.width = '100%';
        checkoutBtn.style.marginTop = '15px';
    }

    // Display Discount
    const discountEl = document.getElementById('summary-discount');
    const discountRow = discountEl.closest('.summary-row');
    if (totalDiscountDisplay > 0) {
        discountEl.textContent = `- ₹${totalDiscountDisplay.toFixed(0)}`;
        if (discountRow) discountRow.style.display = 'flex';
    } else {
        if (discountRow) discountRow.style.display = 'none';
    }
    discountEl.style.color = '#28a745';
    discountEl.style.fontWeight = '700';

    document.getElementById('summary-total').textContent = `₹${total.toFixed(2)}`;

    updateFreeDeliveryBanner(realPriceTotal);

    localStorage.setItem('cartFinalTotal', total.toFixed(2));
    localStorage.setItem('cartItemCount', itemCount);
}

function updateFreeDeliveryBanner(currentTotal) {
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
        progressBar.parentElement.style.display = 'none'; // Hide bar when unlocked for cleaner UI
        iconEl.style.color = '#28a745'; // Switch to green
    } else {
        const remaining = threshold - currentTotal;
        // Optimization: start bar at 15% visually even if cart is empty to indicate progress
        // Calculate: 15% base + scaled actual progress (linear 0-85% map)
        const percent = Math.min(100, 15 + ((currentTotal / threshold) * 85));
        
        banner.style.background = '#fff8f4'; // Original light orange
        textEl.innerHTML = `Add <span style="color: #ff7c08; font-weight: 800;">₹${remaining.toFixed(0)}</span> for <span style="color: #ff7c08; font-weight: 800;">FREE DELIVERY</span>!`;
        progressBar.parentElement.style.display = 'block'; // Show progress bar
        progressBar.style.width = `${percent}%`;
        progressBar.style.background = 'linear-gradient(90deg, #ff7c08, #ff9f43)';
        iconEl.style.color = '#ff7c08'; // Original orange
    }
}

async function handleItemRemoval(user, docId) {
    await deleteDoc(doc(db, "carts", user.uid, "items", docId));

    const remainingCartRef = collection(db, "carts", user.uid, "items");
    const remainingSnapshot = await getDocs(remainingCartRef);

    if (remainingSnapshot.empty) {
        await displayCartItems(user);
        return;
    }

    let hasRegularItems = false;
    remainingSnapshot.forEach(doc => {
        const item = doc.data();
        if (item.name !== "Pack of 8 fresh big eggs" && item.name !== "Pack of 10 fresh big eggs" && item.name !== "Pack of 10 Local Duck Eggs") {
            hasRegularItems = true;
        }
    });

    if (!hasRegularItems) {
        const deletePromises = [];
        remainingSnapshot.forEach(doc => {
            deletePromises.push(deleteDoc(doc.ref));
        });
        await Promise.all(deletePromises);
    }

    await displayCartItems(user);
}

function attachActionListeners(user) {
    const cartContainer = document.getElementById('myntra-cart-items');
    if (cartContainer) {
        cartContainer.addEventListener('click', async (e) => {
            // Handle remove group/item click
            const removeBtn = e.target.closest('.remove-group, .remove-item');
            if (removeBtn) {
                e.preventDefault();
                e.stopPropagation();
                
                const card = removeBtn.closest('.cart-item-card');
                if (card) {
                    const docId = card.dataset.id || removeBtn.dataset.id;
                    const itemName = card.dataset.name;
                    
                    if (user) {
                        if (confirm(`Remove this item ("${itemName}") from your cart?`)) {
                            try {
                                await deleteDoc(doc(db, "carts", user.uid, "items", docId));
                                showToast("Item removed", 'success');
                            } catch (err) {
                                console.error("Remove Error:", err);
                                showToast("Error removing item", 'error');
                            }
                        }
                    } else {
                        // Guest removal
                        let localCart = JSON.parse(localStorage.getItem('guestCart') || '[]');
                        const idx = parseInt(docId.split('-')[1]);
                        localCart.splice(idx, 1);
                        localStorage.setItem('guestCart', JSON.stringify(localCart));
                        window.dispatchEvent(new Event('storage'));
                        showToast("Item removed", 'success');
                        displayCartItems(user);
                    }
                }
                return;
            }

            // Handle quantity buttons
            const qtyBtn = e.target.closest('.plus-btn, .minus-btn');
            if (qtyBtn) {
                e.preventDefault();
                e.stopPropagation();

                const card = qtyBtn.closest('.cart-item-card') || qtyBtn.closest('[data-id]');
                if (!card) return;

                const docId = card.dataset.id;
                const qtyValEl = card.querySelector('.qty-val');
                let quantity = parseInt(qtyValEl ? qtyValEl.textContent : '1');

                if (qtyBtn.classList.contains('plus-btn')) {
                    quantity++;
                    if (user) {
                        await updateDoc(doc(db, "carts", user.uid, "items", docId), { quantity });
                    } else {
                        // Guest quantity update
                        let localCart = JSON.parse(localStorage.getItem('guestCart') || '[]');
                        const idx = parseInt(docId.split('-')[1]);
                        if (localCart[idx]) {
                            localCart[idx].quantity = quantity;
                            localStorage.setItem('guestCart', JSON.stringify(localCart));
                            window.dispatchEvent(new Event('storage')); // Trigger re-render
                        }
                    }
                    await displayCartItems(user);
                } else if (qtyBtn.classList.contains('minus-btn')) {
                    if (quantity > 1) {
                        quantity--;
                        if (user) {
                            await updateDoc(doc(db, "carts", user.uid, "items", docId), { quantity });
                        } else {
                            // Guest quantity update
                            let localCart = JSON.parse(localStorage.getItem('guestCart') || '[]');
                            const idx = parseInt(docId.split('-')[1]);
                            if (localCart[idx]) {
                                localCart[idx].quantity = quantity;
                                localStorage.setItem('guestCart', JSON.stringify(localCart));
                                window.dispatchEvent(new Event('storage')); // Trigger re-render
                            }
                        }
                        await displayCartItems(user);
                    } else {
                        if (user) {
                            await handleItemRemoval(user, docId);
                        } else {
                            // Guest item removal
                            let localCart = JSON.parse(localStorage.getItem('guestCart') || '[]');
                            const idx = parseInt(docId.split('-')[1]);
                            localCart.splice(idx, 1);
                            localStorage.setItem('guestCart', JSON.stringify(localCart));
                            window.dispatchEvent(new Event('storage')); // Trigger re-render
                        }
                        showToast("Item removed from cart", 'success');
                    }
                }
                return;
            }
        });
    }

    // Listener for Clear All button
    const clearAllBtn = document.querySelector('.myntra-clear-all');
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            const confirmed = await showConfirm("This will empty your entire cart. Are you sure you want to proceed?");
            if (confirmed) {
                const cartRef = collection(db, "carts", user.uid, "items");
                const querySnapshot = await getDocs(cartRef);
                const deletePromises = [];
                querySnapshot.forEach(docSnap => {
                    deletePromises.push(deleteDoc(docSnap.ref));
                });
                await Promise.all(deletePromises);
                displayCartItems(user);
            }
        });
    }

    // Listener for Push Sale (Addons) section
    const pushSaleSection = document.getElementById('push-sale-section');
    if (pushSaleSection) {
        pushSaleSection.addEventListener('click', async (e) => {
            const pushSaleButton = e.target.closest('.add-push-sale-item');
            if (pushSaleButton) {
                e.preventDefault();
                const itemId = pushSaleButton.dataset.id;
                let product;

                // Re-fetch current price from DOM to ensure sync
                const bigEggPriceEl = document.getElementById('addon-price-big-eggs');
                const duckEggPriceEl = document.getElementById('addon-price-local-duck-eggs');

                const bigEggPrice = bigEggPriceEl ? parseFloat(bigEggPriceEl.textContent.replace('₹', '')) : 67;
                const duckEggPrice = duckEggPriceEl ? parseFloat(duckEggPriceEl.textContent.replace('₹', '')) : 134;

                if (itemId === 'big-eggs') {
                    product = { name: "Pack of 10 fresh big eggs", price: bigEggPrice, image: "images/items/fresh big eggs1.webp", quantity: 1, weight: "10 pcs" };
                } else if (itemId === 'local-duck-eggs') {
                    product = { name: "Pack of 10 Local Duck Eggs", price: duckEggPrice, image: "images/items/duck.png", quantity: 1, weight: "10 pcs" };
                }

                if (product) {
                    product.timestamp = serverTimestamp();
                    try {
                        const user = auth.currentUser;
                        if (user) {
                            const cartRef = collection(db, "carts", user.uid, "items");
                            const q = query(cartRef, where("name", "==", product.name), where("weight", "==", product.weight));
                            const querySnapshot = await getDocs(q);

                            if (!querySnapshot.empty) {
                                const existingDoc = querySnapshot.docs[0];
                                await updateDoc(existingDoc.ref, { quantity: existingDoc.data().quantity + 1 });
                            } else {
                                await addDoc(cartRef, product);
                            }
                            showToast(`${product.name} added to cart!`, 'success');
                            displayCartItemsFromSnapshot(user, await getDocs(collection(db, "carts", user.uid, "items")));
                        } else {
                            // GUEST LOGIC
                            let localCart = JSON.parse(localStorage.getItem('guestCart') || '[]');
                            const idx = localCart.findIndex(i => i.name === product.name && i.weight === product.weight);
                            if (idx > -1) {
                                localCart[idx].quantity += 1;
                            } else {
                                localCart.push(product);
                            }
                            localStorage.setItem('guestCart', JSON.stringify(localCart));
                            showToast(`${product.name} added to cart!`, 'success');
                            displayGuestCart();
                            updateCartCounter(null);
                        }
                    } catch (error) {
                        console.error("Error adding push sale item:", error);
                        showToast("Error adding item. Please try again.", 'error');
                    }
                }
            }
        });
    }
}

async function fetchAddonPrices() {
    const docRef = doc(db, "inventory", "cart_addons");
    try {
        const d = await getDoc(docRef);
        if (d.exists()) {
            const data = d.data();
            if (data.big_eggs_price) {
                const el = document.getElementById('addon-price-big-eggs');
                if (el) el.textContent = `₹${data.big_eggs_price}`;
            }
            if (data.local_duck_eggs_price) {
                const el = document.getElementById('addon-price-local-duck-eggs');
                if (el) el.textContent = `₹${data.local_duck_eggs_price}`;
            }
        }
    } catch (e) {
        console.log("Error fetching addon prices", e);
    }
}

