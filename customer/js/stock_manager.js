import { db } from "./firebase-config.js";
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

let inventoryCache = [];
let currentProductData = null;

// Standard normalization for all customer-side matching
function normalizeName(name) {
    if (!name) return "";
    return name.toLowerCase()
               .replace(/-/g, ' ') // Map hyphens to spaces (critical for data-id matching)
               .replace(/ cuts?$/i, '') // Handle singular/plural mismatch (Cut vs Cuts)
               .trim()
               .replace(/\s+/g, ' '); // Standardize spaces
}

// 1. Initial Load & Real-time Sync
function initInventorySync() {
    console.log("[StockManager] Starting real-time sync with database...");
    
    onSnapshot(collection(db, "inventory"), (querySnapshot) => {
        inventoryCache = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            data.id = doc.id; // Store Doc ID as id
            data.name = doc.id;
            inventoryCache.push(data);
        });
        
        console.log("[StockManager] Database update received. Syncing UI for", inventoryCache.length, "items.");
        
        // Comprehensive UI Update
        setupProductDetailPage();
        updateMenuStockStatus();

        // Show actual products and hide skeletons
        const skeletons = document.getElementById('product-skeletons');
        const actualProducts = document.getElementById('actual-products');
        const heroSkeleton = document.getElementById('hero-skeleton');
        const actualHero = document.getElementById('actual-hero');
        const categoriesSkeleton = document.getElementById('categories-skeleton');
        const actualCategories = document.getElementById('actual-categories');

        if (skeletons) {
            skeletons.style.opacity = '0';
            setTimeout(() => skeletons.style.display = 'none', 300);
        }
        
        if (actualProducts) {
            actualProducts.style.display = 'contents';
            setTimeout(() => actualProducts.style.opacity = '1', 50);
        }
        
        if (heroSkeleton) {
            heroSkeleton.style.opacity = '0';
            setTimeout(() => heroSkeleton.style.display = 'none', 300);
        }
        
        if (actualHero) {
            actualHero.style.display = 'block';
            setTimeout(() => actualHero.style.opacity = '1', 100);
        }
        
        if (categoriesSkeleton) {
            categoriesSkeleton.style.opacity = '0';
            setTimeout(() => categoriesSkeleton.style.display = 'none', 300);
        }
        
        if (actualCategories) {
            actualCategories.style.display = 'flex';
            setTimeout(() => actualCategories.style.opacity = '1', 100);
        }
    }, (error) => {
        console.error("Critical: StockManager sync failed:", error);
    });
}

// 2. Setup Detail Page (Single Product View)
let detailPageObserver = null;

function setupProductDetailPage() {
    const productNameEl = document.querySelector('[data-product-id]') || document.querySelector('.menu_details_text h2');
    if (!productNameEl) return;

    const productId = productNameEl.getAttribute('data-product-id') || productNameEl.textContent.trim();
    const normalizedId = normalizeName(productId).replace(/ cuts?$/i, '');
    currentProductData = inventoryCache.find(i => normalizeName(i.id).replace(/ cuts?$/i, '') === normalizedId);

    // If we have product data, try to update radio buttons immediately
    if (currentProductData) {
        updateRadioButtonAttributes();
    }

    // Use MutationObserver to watch for radio buttons being added (handles async loading)
    if (detailPageObserver) {
        detailPageObserver.disconnect();
    }
    
    const variantsContainer = document.getElementById('pd-variants');
    if (!variantsContainer) return;

    detailPageObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) { // Element node
                    // Check if the node itself is a radio
                    if (node.matches && node.matches('input.variant-radio')) {
                        updateRadioButton(node);
                        attachRadioListeners(node);
                    }
                    // Check children
                    const radios = node.querySelectorAll ? node.querySelectorAll('input.variant-radio') : [];
                    radios.forEach(radio => {
                        updateRadioButton(radio);
                        attachRadioListeners(radio);
                    });
                }
            });
        });
    });

    detailPageObserver.observe(variantsContainer, { childList: true, subtree: true });

    // Also check existing radio buttons
    const existingRadios = variantsContainer.querySelectorAll('input.variant-radio');
    existingRadios.forEach(radio => {
        updateRadioButton(radio);
        attachRadioListeners(radio);
    });

    // Attach quantity button listeners
    attachQuantityListeners();
    
    // Update savings badge
    updateSavingsBadge();

    // Check stock for the current selection (resolves load race conditions)
    checkStockForCurrentSelection();
}

function updateRadioButtonAttributes() {
    if (!currentProductData) return;
    
    const radioButtons = document.querySelectorAll('input.variant-radio');
    radioButtons.forEach(radio => {
        if (radio.id === 'opt_large') {
            if (currentProductData.price_large > 0) radio.setAttribute('data-price', currentProductData.price_large);
            if (currentProductData.mrp_large > 0) radio.setAttribute('data-mrp', currentProductData.mrp_large);
        } else if (radio.id === 'opt_small') {
            if (currentProductData.price_small > 0) radio.setAttribute('data-price', currentProductData.price_small);
            if (currentProductData.mrp_small > 0) radio.setAttribute('data-mrp', currentProductData.mrp_small);
        }
    });
    
    // Trigger price update
    updatePagePrices();
}

function updateRadioButton(radio) {
    if (!currentProductData) return;
    
    if (radio.id === 'opt_large') {
        if (currentProductData.price_large > 0) radio.setAttribute('data-price', currentProductData.price_large);
        if (currentProductData.mrp_large > 0) radio.setAttribute('data-mrp', currentProductData.mrp_large);
    } else if (radio.id === 'opt_small') {
        if (currentProductData.price_small > 0) radio.setAttribute('data-price', currentProductData.price_small);
        if (currentProductData.mrp_small > 0) radio.setAttribute('data-mrp', currentProductData.mrp_small);
    }
}

function attachRadioListeners(radio) {
    if (!radio.dataset.listenerSet) {
        radio.dataset.listenerSet = 'true';
        radio.addEventListener('change', () => {
            updatePagePrices();
            checkStockForCurrentSelection();
        });
    }
}

// Robust event delegation for quantity buttons
document.addEventListener('click', (e) => {
    const plusBtn = e.target.closest('.details_quentity .plus-btn');
    const minusBtn = e.target.closest('.details_quentity .minus-btn');
    
    if (plusBtn) {
        e.preventDefault();
        const quantityInput = document.getElementById('quantity-input');
        if (quantityInput) {
            let current = parseInt(quantityInput.value) || 1;
            if (current < 10) {
                quantityInput.value = current + 1;
                updatePagePrices();
            }
        }
    }

    if (minusBtn) {
        e.preventDefault();
        const quantityInput = document.getElementById('quantity-input');
        if (quantityInput) {
            let current = parseInt(quantityInput.value) || 1;
            if (current > 1) {
                quantityInput.value = current - 1;
                updatePagePrices();
            }
        }
    }
});

function attachQuantityListeners() {
    // Legacy function kept for compatibility, but logic is now handled by delegation above
    updatePagePrices();
}

function updateSavingsBadge() {
    if (!currentProductData) return;
    
    const largeLabel = document.querySelector('label[for="opt_large"]');
    const smallLabel = document.querySelector('label[for="opt_small"]');
    
    if (smallLabel) {
        const oldBadge = smallLabel.querySelector('.savings-badge');
        if (oldBadge) oldBadge.remove();
    }
    if (largeLabel) {
        const oldBadge = largeLabel.querySelector('.savings-badge');
        if (oldBadge) oldBadge.remove();
    }

    if (largeLabel && currentProductData.price_large && currentProductData.price_small) {
        const savings = (currentProductData.price_small * 2) - currentProductData.price_large;
        
        if (savings > 0) {
            const badge = document.createElement('span');
            badge.className = 'savings-badge';
            badge.style.cssText = 'margin-left:10px; font-size:0.8em; color:#fff; background-color:#28a745; padding:2px 8px; border-radius:20px; font-weight:700; display:inline-flex; align-items:center; vertical-align:middle;';
            badge.innerHTML = `<i class="fas fa-magic" style="margin-right:4px; font-size:0.9em;"></i> Save Extra ₹${savings.toFixed(0)}`;
            largeLabel.appendChild(badge);
        }
    }
}

// 3. Update Detail Page Price Rendering
function updatePagePrices() {
    const basePriceEl = document.getElementById('base-price');
    const delPriceEl = document.getElementById('del-price');
    const totalPriceEl = document.getElementById('total-price');
    const quantityInput = document.getElementById('quantity-input');

    const selectedRadio = document.querySelector('input[name="flexRadioDefault"]:checked');
    if (!selectedRadio) return;

    let unitPrice = 0;
    let mrpPrice = 0;

    if (currentProductData) {
        if (selectedRadio.id === 'opt_large') {
            unitPrice = currentProductData.price_large || 0;
            mrpPrice = currentProductData.mrp_large || 0;
        } else if (selectedRadio.id === 'opt_small') {
            unitPrice = currentProductData.price_small || 0;
            mrpPrice = currentProductData.mrp_small || 0;
        }
    }
    
    // Fallback to data attributes if currentProductData not available or prices are 0
    if (unitPrice === 0) {
        unitPrice = parseFloat(selectedRadio.dataset.price) || 0;
    }
    if (mrpPrice === 0) {
        mrpPrice = parseFloat(selectedRadio.dataset.mrp) || 0;
    }

    const qty = parseInt(quantityInput?.value) || 1;
    const total = unitPrice * qty;

    if (basePriceEl) {
        basePriceEl.textContent = `₹${unitPrice.toFixed(0)}`;
        basePriceEl.style.width = '';
        basePriceEl.style.height = '';
        basePriceEl.classList.remove('skeleton');
    }
    if (delPriceEl) {
        if (mrpPrice > unitPrice) {
            delPriceEl.innerHTML = `&#8377;${mrpPrice.toFixed(0)}`;
            delPriceEl.style.display = '';
        } else {
            delPriceEl.style.display = 'none';
        }
    }
    if (totalPriceEl) totalPriceEl.textContent = unitPrice > 0 ? `\u20B9${total.toFixed(0)}` : '';
}

// 4. Central Stock Out Logic (Standardized for Homepage & Detail Pages)
function isItemStockOut(productName, weightText) {
    // Admin Exception: Admins never see items as stock out (for testing purposes)
    if (window.userRole === 'admin') {
        return false;
    }

    if (!productName || !weightText) return false;

    const normalizedName = normalizeName(productName).replace(/ cuts?$/i, '');
    const product = inventoryCache.find(i => normalizeName(i.id).replace(/ cuts?$/i, '') === normalizedName);
    if (!product) return false;

    const cleanWeight = weightText.toLowerCase().replace(/\s+/g, '');

    // Standard Meat Toggles
    if (cleanWeight.includes('500g') || cleanWeight.includes('500gram')) {
        return product.small === false; // small = opt1 = 500g
    }
    if (cleanWeight.includes('1kg') || cleanWeight.includes('1kilogram') || cleanWeight.includes('1000g')) {
        return product.large === false; // large = opt2 = 1kg
    }
    if (cleanWeight.includes('220g') || cleanWeight.includes('220gram') || cleanWeight.includes('solo')) {
        return product.solo === false; // solo = premium 220g
    }

    // Eggs Toggles
    const isDuck = productName.toLowerCase().includes('duck');
    if (isDuck) {
        if (cleanWeight.includes('15')) return product.small === false;
        if (cleanWeight.includes('30')) return product.large === false;
    } else {
        if (cleanWeight.includes('30')) return product.small === false;
        if (cleanWeight.includes('60')) return product.large === false;
        if (cleanWeight.includes('100')) return product.large === false; // Handle 100 eggs if ever added
    }

    return false;
}

function checkStockForCurrentSelection() {
    const nameEl = document.querySelector('[data-product-id]') || document.querySelector('.menu_details_text h2');
    if (!nameEl) return;

    const productName = nameEl.getAttribute('data-product-id') || nameEl.textContent.trim();
    const selectedRadio = document.querySelector('input[name="flexRadioDefault"]:checked');
    if (!selectedRadio) return;

    if (!selectedRadio.nextElementSibling) return;
    const weightLabel = selectedRadio.nextElementSibling.textContent.trim();
    const addToCartBtn = document.querySelector('.add_to_cart, .details_button_area .common_btn');

    if (addToCartBtn) {
        if (isItemStockOut(productName, weightLabel)) {
            addToCartBtn.classList.add('btn-disabled');
            addToCartBtn.innerHTML = 'Stock Out <i class="fas fa-ban"></i>';
            addToCartBtn.style.cssText = 'background-color:#ccc; pointer-events:none; opacity:0.7;';
        } else {
            addToCartBtn.classList.remove('btn-disabled');
            addToCartBtn.innerHTML = 'Add To Cart <i class="fas fa-shopping-basket"></i>';
            addToCartBtn.style.cssText = '';
        }
    }
}

// 5. Massive Sync for Listing Pages (Homepage, Category Pages)
function updateMenuStockStatus() {
    const cards = document.querySelectorAll('.menu_item, .menu_swiggy_card, .modern-product-card, .product-card');

    cards.forEach(card => {
        const titleEl = card.querySelector('.title, .menu_swiggy_title, .product-title');
        if (!titleEl) return;

        const productName = titleEl.textContent.trim();
        const dataId = card.getAttribute('data-id');
        const normalizedTitle = normalizeName(productName);
        const normalizedId = normalizeName(dataId);

        // Standard lookup
        const product = inventoryCache.find(i => {
            const invName = normalizeName(i.id);
            // Match exactly, or match singular vs plural versions
            return invName === normalizedTitle || 
                   invName === normalizedId ||
                   invName.replace(/ cuts?$/i, '') === normalizedTitle.replace(/ cuts?$/i, '') ||
                   invName.replace(/ cuts?$/i, '') === normalizedId.replace(/ cuts?$/i, '');
        });

        if (product) {
            // Auto-select first in-stock variant if active is out of stock
            const pills = card.querySelectorAll('.size-pill');
            if (pills.length > 0) {
                const inStockPills = [];
                const outOfStockPills = [];
                
                pills.forEach(pill => {
                    const isOut = isItemStockOut(productName, pill.textContent.trim());
                    if (isOut) {
                        outOfStockPills.push(pill);
                        pill.classList.add('pill-stock-out');
                    } else {
                        inStockPills.push(pill);
                        pill.classList.remove('pill-stock-out');
                    }
                });

                const activePill = card.querySelector('.size-pill.active');
                if (activePill && outOfStockPills.includes(activePill)) {
                    if (inStockPills.length > 0) {
                        activePill.classList.remove('active');
                        inStockPills[0].classList.add('active');
                    }
                } else if (!activePill && inStockPills.length > 0) {
                    inStockPills[0].classList.add('active');
                }
            }

            // A. Update Base Display (Uses Price Large by default)
            const priceEl = card.querySelector('.price, .menu_swiggy_price, .product-price');
            const weightEl = card.querySelector('.wight_menu, .menu_swiggy_rating, .size-pill.active');
            
            if (priceEl) {
                const currentWeight = weightEl ? weightEl.textContent.trim().toLowerCase() : '500g';
                const isDuck = productName.toLowerCase().includes('duck');
                const isLarge = currentWeight.includes('1kg') || currentWeight.includes('1000g') || 
                                currentWeight.includes('60') || (currentWeight.includes('30') && isDuck);
                const isSolo = currentWeight.includes('220g');
                
                let currentPrice = isLarge ? (product.price_large || product.price_small) : product.price_small;
                if (isSolo) currentPrice = product.price_solo || 0;
                
                let currentMrp = isLarge ? (product.mrp_large || product.mrp_small) : product.mrp_small;
                if (isSolo) currentMrp = product.mrp_solo || 0;

                if (currentPrice > 0 || isSolo) {
                    if (currentPrice === 0 && isSolo) {
                        priceEl.innerHTML = `<span style="font-size:14px;color:var(--primary);">Coming Soon</span>`;
                    } else {
                        let mrpHtml = (currentMrp > currentPrice) ? ` <del style="font-size:14px;color:#999; margin-left:8px;">&#8377;${currentMrp.toFixed(0)}</del>` : '';
                        priceEl.innerHTML = `&#8377;${currentPrice.toFixed(0)}${mrpHtml}`;
                    }
                }
            }

            // B. Link Buttons and Pills to Database Values
            const targets = card.querySelectorAll('.modal-add-btn, .modal-buy-btn, .size-pill, .add-to-cart-btn, .btn-premium-add, .btn-premium-buy');
            targets.forEach(el => {
                const cat = el.dataset.category || card.dataset.category || '';
                const sz = el.dataset.size || '';

                // Generic category prices
                // SANE MAPPING: small quantity -> price_small, large quantity -> price_large
                if (product.price_small > 0) {
                    el.setAttribute('data-price-500', product.price_small);
                    el.setAttribute('data-price-30', product.price_small);
                    el.setAttribute('data-price-15', product.price_small);
                    el.setAttribute('data-mrp-500', product.mrp_small || product.price_small);
                }
                if (product.price_large > 0) {
                    el.setAttribute('data-price-1000', product.price_large);
                    el.setAttribute('data-price-60', product.price_large);
                    el.setAttribute('data-mrp-1000', product.mrp_large || product.price_large);
                }
                if (product.price_solo > 0) {
                    el.setAttribute('data-price-220', product.price_solo);
                    el.setAttribute('data-mrp-220', product.mrp_solo || product.price_solo);
                }

                // Improved Size Pill linking (handles Big Eggs vs Duck Eggs 30-count overlap)
                if (el.classList.contains('size-pill')) {
                    const normSz = sz.toLowerCase();
                    const isDuck = product.name.toLowerCase().includes('duck');
                    
                    // Opt1 (Small): 500g, 15 Eggs, or 30 Big Eggs
                    const isSmallWeight = normSz.includes('500g') || normSz.includes('15') || (normSz.includes('30') && !isDuck);
                    // Opt2 (Large): 1kg/1000g, 60 Eggs, or 30 Duck Eggs
                    const isLargeWeight = normSz.includes('1kg') || normSz.includes('1000g') || normSz.includes('60') || (normSz.includes('30') && isDuck);

                    if (isSmallWeight && product.price_small > 0) {
                        el.setAttribute('data-price', product.price_small);
                        el.setAttribute('data-mrp', product.mrp_small || product.price_small);
                        if (window.jQuery) window.jQuery(el).data('price', product.price_small).data('mrp', product.mrp_small);
                    } else if (isLargeWeight && product.price_large > 0) {
                        el.setAttribute('data-price', product.price_large);
                        el.setAttribute('data-mrp', product.mrp_large || product.price_large);
                        if (window.jQuery) window.jQuery(el).data('price', product.price_large).data('mrp', product.mrp_large);
                    } else if (normSz.includes('220g') && product.price_solo >= 0) {
                        el.setAttribute('data-price', product.price_solo || 0);
                        el.setAttribute('data-mrp', product.mrp_solo || 0);
                        if (window.jQuery) window.jQuery(el).data('price', product.price_solo || 0).data('mrp', product.mrp_solo || 0);
                    }
                }
            });

            // C. Stock Linking
            const currentWeightText = weightEl ? weightEl.textContent.trim() : '500g';
            const isOut = isItemStockOut(productName, currentWeightText);
            const addToCartBtn = card.querySelector('.add_to_cart, .btn-add-glass, .btn-premium-add, .modal-add-btn');
            const buyNowBtn = card.querySelector('.modal-buy-btn, .btn-premium-buy');
            const imgEl = card.querySelector('.menu_item_img, .menu_swiggy_image_box, .product-image img');

            if (isOut) {
                card.style.opacity = '0.7';
                card.classList.add('stock-out-item');
                if (addToCartBtn) {
                    addToCartBtn.textContent = 'STOCK OUT';
                    addToCartBtn.classList.add('btn-stock-out');
                }
                if (buyNowBtn) {
                    buyNowBtn.classList.add('btn-stock-out');
                }
                if (imgEl) imgEl.style.filter = 'grayscale(1)';
            } else {
                card.style.opacity = '1';
                card.classList.remove('stock-out-item');
                if (addToCartBtn && !addToCartBtn.classList.contains('card-qty-btn')) {
                    addToCartBtn.textContent = 'Add';
                    addToCartBtn.classList.remove('btn-stock-out');
                    addToCartBtn.style.cssText = '';
                }
                if (buyNowBtn) {
                    buyNowBtn.classList.remove('btn-stock-out');
                    buyNowBtn.style.cssText = '';
                }
                if (imgEl) imgEl.style.filter = 'none';
            }
        }
    });
}

// 6. Global Observers for Reactivity on Listing Pages
function setupListingPageObservers() {
    // Listen for size pill clicks on homepage/category pages
    document.addEventListener('click', (e) => {
        const pill = e.target.closest('.size-pill');
        if (pill) {
            const card = pill.closest('.product-card, .menu_item, .menu_swiggy_card');
            if (card) {
                // Re-run status update for THIS card specifically
                // Tiny delay to allow main.js to update .active class
                setTimeout(() => updateMenuStockStatus(), 50);
            }
        }
    });
}

// 8. Export to window for auth role detection and cart/payment checks
window.updateMenuStockStatus = updateMenuStockStatus;
window.checkStockForCurrentSelection = checkStockForCurrentSelection;
window.isItemStockOut = isItemStockOut;

// 7. Start Sync
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initInventorySync();
        setupListingPageObservers();
    });
} else {
    initInventorySync();
    setupListingPageObservers();
}