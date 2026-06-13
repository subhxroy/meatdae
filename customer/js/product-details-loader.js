import { PRODUCTS_METADATA, getProductSlugFromName } from './products-metadata.js';
import { db } from './firebase-config.js';
import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

// Ensure cart.js is loaded so we can call add item to cart
import './cart.js'; 

let currentProductData = null;
let currentPricingData = null; // Store Firestore real-time pricing

async function initProductDetails() {
    const urlParams = new URLSearchParams(window.location.search);
    let productId = urlParams.get('id');
    const preselectVariant = urlParams.get('variant');
    window.__preselectVariant = preselectVariant; // Global for setupRealtimeInventory

    // Fallback or redirection handler for missing ID
    if (!productId || !PRODUCTS_METADATA[productId]) {
        document.title = "Product Not Found | MeatDae";
        
        // Hide image skeleton and show a placeholder
        const mainImg = document.getElementById('main-product-image');
        if (mainImg) {
            mainImg.src = 'images/items/placeholder.png';
            mainImg.style.display = 'block';
            const mainImgContainer = mainImg.parentElement;
            if (mainImgContainer) mainImgContainer.classList.remove('skeleton', 'sk-img');
        }
        
        const thumbsContainer = document.getElementById('pd-thumbnails');
        if (thumbsContainer) thumbsContainer.style.display = 'none';

        // Update Text & Hide Skeletons
        const titleEl = document.getElementById('pd-title');
        if (titleEl) {
            titleEl.textContent = "Product Not Found";
            titleEl.classList.remove('skeleton', 'sk-title');
        }

        const descEl = document.getElementById('pd-short-desc');
        if (descEl) {
            descEl.innerHTML = `We couldn't find the product you're looking for. <br><br><a href="index.html" class="common_btn mt-3 d-inline-block">Return to Shop</a>`;
            descEl.classList.remove('skeleton', 'sk-text');
        }

        const basePrice = document.getElementById('base-price');
        if (basePrice) basePrice.style.display = 'none';
        
        const variantsContainer = document.getElementById('pd-variants-container');
        if (variantsContainer) variantsContainer.style.display = 'none';

        const qtyContainer = document.querySelector('.details_quentity');
        if (qtyContainer) qtyContainer.style.display = 'none';

        const addToCartBtn = document.getElementById('pd-add-to-cart');
        if (addToCartBtn) addToCartBtn.style.display = 'none';

        const longDescEl = document.getElementById('pd-long-desc');
        if (longDescEl) longDescEl.textContent = "This product may have been removed or the link is invalid.";

        return;
    }

    currentProductData = PRODUCTS_METADATA[productId];

    // 1. Populate Static Metadata
    document.title = `${currentProductData.name} | MeatDae`;
    const titleEl = document.getElementById('pd-title');
    titleEl.textContent = currentProductData.name;
    titleEl.setAttribute('data-product-id', currentProductData.name);
    titleEl.classList.remove('skeleton', 'sk-title');

    const descEl = document.getElementById('pd-short-desc');
    descEl.textContent = currentProductData.shortDescription;
    descEl.classList.remove('skeleton', 'sk-text');

    const longDescEl = document.getElementById('pd-long-desc');
    if (longDescEl) longDescEl.innerHTML = currentProductData.description.replace(/\n/g, '<br>');
    
    const nutritionEl = document.getElementById('pd-nutrition');
    if (nutritionEl) {
        if (currentProductData.nutrition) {
            nutritionEl.innerHTML = `<b>Nutritional Value:-</b><br>${currentProductData.nutrition.replace(/\n/g, '<br>')}`;
        } else {
            nutritionEl.style.display = 'none';
        }
    }

    // 2. Populate Image Gallery
    const mainImg = document.getElementById('main-product-image');
    if (mainImg) {
        const mainImgContainer = mainImg.parentElement;
        mainImg.src = currentProductData.images[0] || 'images/items/placeholder.png';
        
        const revealImage = () => {
            mainImg.style.display = 'block';
            if (mainImgContainer) mainImgContainer.classList.remove('skeleton', 'sk-img');
        };

        if (mainImg.complete) {
            revealImage();
        } else {
            mainImg.onload = revealImage;
            mainImg.onerror = revealImage; // Fallback so skeleton doesn't stay forever
        }
    }
    
    const thumbsContainer = document.getElementById('pd-thumbnails');
    if (thumbsContainer) {
        thumbsContainer.innerHTML = '';
        thumbsContainer.classList.remove('skeleton'); // Cleanup initial skeletons
    }
    
    currentProductData.images.forEach((imgSrc, index) => {
        const thumbDiv = document.createElement('div');
        thumbDiv.className = `thumbnail-item ${index === 0 ? 'active' : ''}`;
        
        const imgEl = document.createElement('img');
        imgEl.src = imgSrc;
        imgEl.alt = `${currentProductData.name} thumbnail`;
        
        thumbDiv.appendChild(imgEl);
        
        // Thumbnail click logic
        thumbDiv.addEventListener('click', () => {
            document.querySelectorAll('.thumbnail-item').forEach(t => t.classList.remove('active'));
            thumbDiv.classList.add('active');
            
            // Nice fade transition
            mainImg.style.opacity = '0.5';
            setTimeout(() => {
                mainImg.src = imgSrc;
                mainImg.style.opacity = '1';
            }, 150);
        });
        
        thumbsContainer.appendChild(thumbDiv);
    });

    // 3. Connect to Firestore for Real-time Pricing & Stock
    setupRealtimeInventory(currentProductData.name);

    // 4. Setup Cart button listener
    // Note: Global listeners in cart.js handle this automatically.
}

// Start immediately (Modules are already deferred)
initProductDetails();

function setupRealtimeInventory(productName) {
    const docRef = doc(db, 'inventory', productName);
    
    onSnapshot(docRef, (docSnap) => {
        const variantsContainer = document.getElementById('pd-variants');
        const priceElement = document.getElementById('base-price');
        const mrpElement = document.getElementById('del-price');
        const addToCartBtn = document.getElementById('pd-add-to-cart');
        
        if (!docSnap.exists()) {
            // Check if it's an addon item (Eggs)
            if (productName === 'Fresh Big Eggs' || productName === 'Fresh Local Duck Eggs') {
                 // Fetch from cart_addons or allow fallback pricing
                 priceElement.textContent = "₹0";
                 mrpElement.textContent = "";
                 variantsContainer.innerHTML = "<p class='text-warning mb-0'>Please check cart for real-time egg pricing.</p>";
                 addToCartBtn.classList.remove('disabled', 'btn-secondary');
                 addToCartBtn.classList.add('common_btn');
                 return;
            }
            // Fallback for all other products instead of throwing an ugly missing error
        }

        // Apply either live data or fallback template
        const data = docSnap.exists() ? docSnap.data() : {
            small: true, price_small: currentProductData.defaultPrice500 || 180, mrp_small: currentProductData.defaultMrp500 || 200,
            large: true, price_large: currentProductData.defaultPrice1000 || 360, mrp_large: currentProductData.defaultMrp1000 || 400
        };
        currentPricingData = data;
        
        document.getElementById('pd-variants-container').style.display = 'block';
        const basePriceEl = document.getElementById('base-price');
        basePriceEl.classList.remove('skeleton');
        basePriceEl.style.width = '';
        basePriceEl.style.height = '';

        // Check stock availability
        const isSmallInStock = data.small === true;
        const isLargeInStock = data.large === true;
        const stockCount = data.stockCount || 0;
        
        const lowStockBadge = document.getElementById('low-stock-badge');
        if (lowStockBadge) {
            // Show badge if stock is low (e.g. < 5) but still in stock
            if (stockCount > 0 && stockCount <= 5) {
                lowStockBadge.style.display = 'inline-block';
                lowStockBadge.title = `Only ${stockCount} items left!`;
            } else {
                lowStockBadge.style.display = 'none';
            }
        }

        // Note: Global stock status is now handled centrally by stock_manager.js 
        // to avoid conflicts and ensure variant-specific stock is respected.
        if (typeof window.checkStockForCurrentSelection === 'function') {
            window.checkStockForCurrentSelection();
        }

        // Render variants (500G, 1KG, and Premium 220G)
        let html = '';
        let selectedId = document.querySelector('input[name="flexRadioDefault"]:checked')?.id;
        const isSoloInStock = data.solo !== false;

        const hasSolo = data.price_solo !== undefined || currentProductData.id === 'fresh-chicken-curry-cuts';
        const hasSmall = data.price_small !== undefined;
        const hasLarge = data.price_large !== undefined;

        // Check if the current selection is valid and in stock
        let selectionValid = false;
        if (selectedId === 'opt_solo' && hasSolo && isSoloInStock) selectionValid = true;
        if (selectedId === 'opt_small' && hasSmall && isSmallInStock) selectionValid = true;
        if (selectedId === 'opt_large' && hasLarge && isLargeInStock) selectionValid = true;

        if (!selectionValid) {
            selectedId = '';
            // Try url preselection first if it is in stock
            if (window.__preselectVariant === 'solo' && hasSolo && isSoloInStock) {
                selectedId = 'opt_solo';
            } else if (window.__preselectVariant === 'large' && hasLarge && isLargeInStock) {
                selectedId = 'opt_large';
            } else if (window.__preselectVariant === 'small' && hasSmall && isSmallInStock) {
                selectedId = 'opt_small';
            }

            // Fallback to first available in-stock variant
            if (!selectedId) {
                if (hasSmall && isSmallInStock) {
                    selectedId = 'opt_small';
                } else if (hasLarge && isLargeInStock) {
                    selectedId = 'opt_large';
                } else if (hasSolo && isSoloInStock) {
                    selectedId = 'opt_solo';
                }
            }

            // Absolute fallback if everything is out of stock
            if (!selectedId) {
                if (hasSmall) {
                    selectedId = 'opt_small';
                } else if (hasLarge) {
                    selectedId = 'opt_large';
                } else if (hasSolo) {
                    selectedId = 'opt_solo';
                }
            }
        }

        // Premium Solo Variant (220G) - Rendering this first if it exists to make it stick out
        if (data.price_solo !== undefined || currentProductData.id === 'fresh-chicken-curry-cuts') {
            const checked = (selectedId === 'opt_solo') ? 'checked' : '';
            const statusLabel = isSoloInStock ? '' : '<span class="text-danger small">(Out of Stock)</span>';
            const disabled = isSoloInStock ? '' : 'disabled';
            
            let unitLabel = "220 Gram (Premium Solo Pack)";
            
            html += `
                <div class="form-check premium-variant-box mb-3">
                    <input class="form-check-input variant-radio" type="radio" name="flexRadioDefault" id="opt_solo" data-price="${data.price_solo || data.mrp_solo || 0}" data-mrp="${data.mrp_solo || 0}" value="${unitLabel}" ${checked} ${disabled} />
                    <label class="form-check-label w-100" for="opt_solo">
                        <div class="d-flex justify-content-between align-items-center">
                            <span class="fw-bold text-dark">${unitLabel} ${statusLabel}</span>
                            <span class="badge bg-warning text-dark premium-badge">SPECIAL</span>
                        </div>
                    </label>
                </div>
            `;
        }

        if (data.price_small !== undefined) {
            const checked = (selectedId === 'opt_small') ? 'checked' : '';
            const statusLabel = isSmallInStock ? '' : '<span class="text-danger small">(Out of Stock)</span>';
            const disabled = isSmallInStock ? '' : 'disabled';
            
            // Dynamic Label Logic
            let unitLabel = "500 Gram";
            if (productName === 'Fresh Big Eggs') unitLabel = "30 Eggs";
            if (productName === 'Fresh Local Duck Eggs') unitLabel = "15 Eggs";

            html += `
                <div class="form-check">
                    <input class="form-check-input variant-radio" type="radio" name="flexRadioDefault" id="opt_small" data-price="${data.price_small || data.mrp_small || 0}" data-mrp="${data.mrp_small || 0}" value="${unitLabel}" ${checked} ${disabled} />
                    <label class="form-check-label" for="opt_small">
                        ${unitLabel} ${statusLabel}
                    </label>
                </div>
            `;
        }

        if (data.price_large !== undefined) {
            const checked = (selectedId === 'opt_large') ? 'checked' : '';
            const statusLabel = isLargeInStock ? '' : '<span class="text-danger small">(Out of Stock)</span>';
            const disabled = isLargeInStock ? '' : 'disabled';

            // Dynamic Label Logic
            let unitLabel = "1 Kilogram";
            if (productName === 'Fresh Big Eggs') unitLabel = "60 Eggs";
            if (productName === 'Fresh Local Duck Eggs') unitLabel = "30 Eggs";

            html += `
                <div class="form-check mt-2">
                    <input class="form-check-input variant-radio" type="radio" name="flexRadioDefault" id="opt_large" data-price="${data.price_large || data.mrp_large || 0}" data-mrp="${data.mrp_large || 0}" value="${unitLabel}" ${checked} ${disabled} />
                    <label class="form-check-label" for="opt_large">
                        ${unitLabel} ${statusLabel}
                    </label>
                </div>
            `;
        }

        variantsContainer.innerHTML = html || "<p class='mb-0'>1 Pack</p>";

        // Trigger stock check to update pricing UI immediately
        if (typeof window.checkStockForCurrentSelection === 'function') {
            window.checkStockForCurrentSelection();
        }
        // Re-attach listeners for description switching
        document.querySelectorAll('input[name="flexRadioDefault"]').forEach(radio => {
            radio.addEventListener('change', () => {
                if (typeof updateDescriptionForVariant === 'function') {
                    updateDescriptionForVariant(radio.id);
                }
            });
        });
        
        // Initial call for pre-selected
        const initialSelected = document.querySelector('input[name="flexRadioDefault"]:checked');
        if (initialSelected && typeof updateDescriptionForVariant === 'function') {
            updateDescriptionForVariant(initialSelected.id);
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic Description Switching
// ─────────────────────────────────────────────────────────────────────────────
function updateDescriptionForVariant(variantId) {
    const descEl = document.getElementById('pd-short-desc');
    if (!descEl || !currentProductData) return;

    if (currentProductData.id === 'fresh-chicken-curry-cuts') {
        if (variantId === 'opt_solo') {
            descEl.textContent = "Juicy bone-in mixed pieces for curry (no leg piece)";
        } else if (variantId === 'opt_small') {
            descEl.textContent = "Juicy bone-in mixed pieces for curry (1 leg piece)";
        } else if (variantId === 'opt_large') {
            descEl.textContent = "Juicy bone-in mixed pieces for curry (2 leg pieces)";
        } else {
            descEl.textContent = currentProductData.shortDescription;
        }
    } else {
        descEl.textContent = currentProductData.shortDescription;
        descEl.style.color = "";
        descEl.style.fontWeight = "";
    }
}
window.updateDescriptionForVariant = updateDescriptionForVariant;

