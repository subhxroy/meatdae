import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { doc, setDoc, onSnapshot, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

// --- UPDATED CATALOG ---
const PRODUCT_CATALOG = [
    { name: "Fresh Chicken Curry Cut", opt1: "500g", opt2: "1kg", optSolo: "220g" },
    { name: "Fresh Chicken Boneless Cut", opt1: "500g", opt2: "1kg" },
    { name: "Fresh Chicken Legs Cut", opt1: "500g", opt2: "1kg" },
    { name: "Fresh Chicken Breast Cuts", opt1: "500g", opt2: "1kg" },
    // { name: "Fresh Clean Gizzard Liver", opt1: "500g", opt2: "1kg" },
    { name: "Fresh Big Eggs", opt1: "30 Eggs", opt2: "60 Eggs" },
    { name: "Fresh Local Duck Eggs", opt1: "15 Eggs", opt2: "30 Eggs" },
    { name: "Fresh Chicken Biriyani Cuts", opt1: "500g", opt2: "1kg" },
    { name: "Fresh Chicken Boneless Keema", opt1: "500g", opt2: "1kg" },
    { name: "Fresh Chicken Wings", opt1: "500g", opt2: "1kg" },
    { name: "Pure Mutton Curry Cuts", opt1: "500g", opt2: "1kg" }
];

let inventoryCache = {};

const initStock = async (user, userData) => {
    const authDiv = document.getElementById('auth-check');
    const contentDiv = document.getElementById('admin-content');
    
    if (userData && (userData.role === 'admin' || userData.role === 'preparer')) {
        if (authDiv) authDiv.style.display = 'none';
        if (contentDiv) contentDiv.style.display = 'block';
        
        // Start real-time sync
        syncAdminInventory();
        syncAdminAddons();
    } else {
        if (contentDiv) contentDiv.style.display = 'none';
        if (authDiv) {
            authDiv.style.display = 'block';
            authDiv.innerHTML = `<h3 class="text-danger">Access Denied</h3><p>You do not have permission to manage stock.</p>`;
        }
    }
};

if (window.staffRecord) {
    initStock(window.staffRecord.user, window.staffRecord.userData);
} else {
    window.addEventListener('staffAuthReady', (e) => {
        initStock(e.detail.user, e.detail.userData);
    });
}

// Fallback to hide auth loader if stuck
setTimeout(() => {
    const interfaceDiv = document.getElementById('admin-interface');
    if (interfaceDiv && (interfaceDiv.style.display === 'none' || interfaceDiv.style.display === '')) {
        console.warn("Stock Control: Forced loader hide and interface show after 8s timeout.");
        const authScreen = document.getElementById('auth-screen');
        const authLoading = document.getElementById('auth-check');
        if (authScreen) authScreen.style.display = 'none';
        if (authLoading) authLoading.style.display = 'none';
        
        interfaceDiv.style.display = 'block';
        const contentDiv = document.getElementById('admin-content');
        if (contentDiv) contentDiv.style.display = 'block';
    }
}, 8000);

function syncAdminInventory() {
    onSnapshot(collection(db, "inventory"), (snapshot) => {
        inventoryCache = {};
        snapshot.forEach(doc => {
            inventoryCache[doc.id] = doc.data();
        });
        renderInventoryList();
    }, (error) => {
        console.error("Inventory sync error:", error);
        const listContainer = document.getElementById('product-list');
        if (listContainer) {
            listContainer.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    Sync Error: ${error.code === 'unavailable' ? 'Offline' : error.message}
                </div>`;
        }
    });
}

function renderInventoryList() {
    const listContainer = document.getElementById('product-list');
    if (!listContainer) return;
    
    listContainer.innerHTML = '';

    PRODUCT_CATALOG.forEach(item => {
        const data = inventoryCache[item.name] || {};
        // Sane Mapping: opt1 (Small) -> small, opt2 (Large) -> large
        const colSize = item.optSolo ? 'col-md-4' : 'col-md-6';
        const safeId = item.name.replace(/\s+/g, '');
        const optSoloStock = data.solo !== false;

        const itemDiv = document.createElement('div');
        itemDiv.className = 'stock-item animate__animated animate__fadeIn';
        itemDiv.innerHTML = `
            <div class="item-header">
                <h5 class="item-title">${item.name}</h5>
                <button class="btn btn-save" onclick="saveProduct('${item.name}')">
                    <i class="fas fa-save me-2"></i> Save Changes
                </button>
            </div>
            <div class="row g-3">
                <div class="${colSize}">
                    <div class="variant-box">
                        <div class="stock-toggle-wrapper">
                            <span class="toggle-label text-primary"><i class="fas fa-box-open me-2"></i> ${item.opt1}</span>
                            <label class="switch">
                                <input type="checkbox" id="stock-${safeId}-small" ${data.small !== false ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                        <div class="row g-2">
                            <div class="col-6">
                                <label class="form-label small mb-1 fw-bold">Selling Price</label>
                                <div class="input-group input-group-sm">
                                    <span class="input-group-text">₹</span>
                                    <input type="number" id="price-${safeId}-small" value="${data.price_small || ''}" class="form-control" placeholder="0">
                                </div>
                            </div>
                            <div class="col-6">
                                <label class="form-label text-muted small mb-1 fw-bold">MRP (Crossed)</label>
                                <div class="input-group input-group-sm">
                                    <span class="input-group-text">₹</span>
                                    <input type="number" id="mrp-${safeId}-small" value="${data.mrp_small || ''}" class="form-control text-muted" placeholder="0">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="${colSize}">
                    <div class="variant-box">
                        <div class="stock-toggle-wrapper">
                            <span class="toggle-label text-primary"><i class="fas fa-box-open me-2"></i> ${item.opt2}</span>
                            <label class="switch">
                                <input type="checkbox" id="stock-${safeId}-large" ${data.large !== false ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                        <div class="row g-2">
                            <div class="col-6">
                                <label class="form-label small mb-1 fw-bold">Selling Price</label>
                                <div class="input-group input-group-sm">
                                    <span class="input-group-text">₹</span>
                                    <input type="number" id="price-${safeId}-large" value="${data.price_large || ''}" class="form-control" placeholder="0">
                                </div>
                            </div>
                            <div class="col-6">
                                <label class="form-label text-muted small mb-1 fw-bold">MRP (Crossed)</label>
                                <div class="input-group input-group-sm">
                                    <span class="input-group-text">₹</span>
                                    <input type="number" id="mrp-${safeId}-large" value="${data.mrp_large || ''}" class="form-control text-muted" placeholder="0">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                ${item.optSolo ? `
                <div class="${colSize}">
                    <div class="variant-box" style="border: 1px solid #ff7c0820; background: #fff8f3;">
                        <div class="stock-toggle-wrapper">
                            <span class="toggle-label text-danger"><i class="fas fa-star me-2"></i> ${item.optSolo}</span>
                            <label class="switch">
                                <input type="checkbox" id="stock-${safeId}-solo" ${data.solo !== false ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                        <div class="row g-2">
                            <div class="col-6">
                                <label class="form-label small mb-1 fw-bold">Selling Price</label>
                                <div class="input-group input-group-sm">
                                    <span class="input-group-text">₹</span>
                                    <input type="number" id="price-${safeId}-solo" value="${data.price_solo || ''}" class="form-control" placeholder="0">
                                </div>
                            </div>
                            <div class="col-6">
                                <label class="form-label text-muted small mb-1 fw-bold">MRP (Crossed)</label>
                                <div class="input-group input-group-sm">
                                    <span class="input-group-text">₹</span>
                                    <input type="number" id="mrp-${safeId}-solo" value="${data.mrp_solo || ''}" class="form-control text-muted" placeholder="0">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>` : ''}
            </div>
        `;
        listContainer.appendChild(itemDiv);
    });
}

window.saveProduct = async (productName) => {
    const safeId = productName.replace(/\s+/g, '');
    const btn = document.querySelector(`button[onclick="saveProduct('${productName}')"]`);
    const originalText = btn.innerHTML;

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    btn.disabled = true;

    const getVal = (id) => {
        const el = document.getElementById(id);
        return el && el.value ? parseFloat(el.value) : 0;
    };

    const stockLarge = document.getElementById(`stock-${safeId}-large`).checked;
    const stockSmall = document.getElementById(`stock-${safeId}-small`).checked;
    const soloEl = document.getElementById(`stock-${safeId}-solo`);
    const stockSolo = soloEl ? soloEl.checked : null;

    try {
        const updateData = {
            large: stockLarge,
            price_large: getVal(`price-${safeId}-large`),
            mrp_large: getVal(`mrp-${safeId}-large`),
            small: stockSmall,
            price_small: getVal(`price-${safeId}-small`),
            mrp_small: getVal(`mrp-${safeId}-small`),
            updatedAt: serverTimestamp()
        };

        if (soloEl) {
            updateData.solo = stockSolo;
            updateData.price_solo = getVal(`price-${safeId}-solo`);
            updateData.mrp_solo = getVal(`mrp-${safeId}-solo`);
        }

        await setDoc(doc(db, "inventory", productName), updateData, { merge: true });

        btn.innerHTML = '<i class="fas fa-check"></i> Saved!';
        btn.classList.add('btn-success');

        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.classList.remove('btn-success');
            btn.disabled = false;
        }, 2000);

    } catch (error) {
        console.error("Save Error:", error);
        alert("Error saving: " + error.message);
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// --- Addons Handling ---

function syncAdminAddons() {
    onSnapshot(doc(db, "inventory", "cart_addons"), (docSnap) => {
        renderAddonsList(docSnap.exists() ? docSnap.data() : {});
    }, (error) => {
        console.error("Addons sync error:", error);
        const listContainer = document.getElementById('addon-list');
        if (listContainer) {
            listContainer.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    Addons Sync Error: ${error.code === 'unavailable' ? 'Offline' : error.message}
                </div>`;
        }
    });
}

function renderAddonsList(addonsData) {
    const listContainer = document.getElementById('addon-list');
    if (!listContainer) return;
    
    const items = [
        { id: "big_eggs", name: "Fresh Big Eggs (Pack of 10)", priceKey: "big_eggs_price" },
        { id: "local_duck_eggs", name: "Fresh Local Duck Eggs (Pack of 10)", priceKey: "local_duck_eggs_price" }
    ];

    listContainer.innerHTML = '';

    items.forEach(item => {
        const price = addonsData[item.priceKey] || "";

        const itemDiv = document.createElement('div');
        itemDiv.className = 'stock-item animate__animated animate__fadeIn';
        itemDiv.innerHTML = `
            <div class="item-header">
                <h5 class="item-title">${item.name}</h5>
                <button class="btn btn-save" onclick="saveAddon('${item.id}', '${item.priceKey}')">
                    <i class="fas fa-save me-2"></i> Update Price
                </button>
            </div>
            <div class="row justify-content-center">
                <div class="col-md-4">
                    <div class="variant-box text-center">
                        <label class="form-label small mb-2 fw-bold">Addon Price (Pack of 10)</label>
                        <div class="input-group">
                            <span class="input-group-text">₹</span>
                            <input type="number" id="price-${item.id}" value="${price}" class="form-control text-center" placeholder="0">
                        </div>
                    </div>
                </div>
            </div>
        `;
        listContainer.appendChild(itemDiv);
    });
}

window.saveAddon = async (id, priceKey) => {
    const priceInput = document.getElementById(`price-${id}`);
    const btn = document.querySelector(`button[onclick="saveAddon('${id}', '${priceKey}')"]`);
    const originalText = btn.innerHTML;
    
    const price = priceInput ? parseFloat(priceInput.value) : 0;

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
    btn.disabled = true;

    try {
        await setDoc(doc(db, "inventory", "cart_addons"), {
            [priceKey]: price,
            updatedAt: serverTimestamp()
        }, { merge: true });

        btn.innerHTML = '<i class="fas fa-check"></i> Updated!';
        btn.classList.add('btn-success');

        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.classList.remove('btn-success');
            btn.disabled = false;
        }, 2000);
    } catch (e) {
        console.error("Addon Error:", e);
        alert("Failed to update addon: " + e.message);
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};
