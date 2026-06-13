import { app, auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { doc, setDoc, getDocs, getDoc, collection } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

// --- UPDATED CATALOG ---
// This list determines what appears in your Admin Panel.
// Make sure "name" matches the 'data-product-id' in your HTML files exactly.
const PRODUCT_CATALOG = [
    { name: "Fresh Chicken Curry Cut", opt1: "500g", opt2: "1kg" },
    { name: "Fresh Chicken Boneless Cut", opt1: "500g", opt2: "1kg" },
    { name: "Fresh Chicken Legs Cut", opt1: "500g", opt2: "1kg" },
    { name: "Fresh Chicken Breast Cuts", opt1: "500g", opt2: "1kg" },
    // { name: "Fresh Clean Gizzard Liver", opt1: "500g", opt2: "1kg" },

    // ADDED THESE TWO ITEMS:
    { name: "Fresh Big Eggs", opt1: "30 Eggs", opt2: "60 Eggs" },
    { name: "Fresh Local Duck Eggs", opt1: "15 Eggs", opt2: "30 Eggs" },
    { name: "Fresh Chicken Biriyani Cuts", opt1: "500g", opt2: "1kg" },
    { name: "Fresh Chicken Boneless Keema", opt1: "500g", opt2: "1kg" },
    { name: "Fresh Chicken Wings", opt1: "500g", opt2: "1kg" },
    { name: "Pure Mutton Curry Cuts", opt1: "500g", opt2: "1kg" }
];

const ALLOWED_ADMINS = [];

const initPanel = async (user, userData) => {
    const authDiv = document.getElementById('auth-check');
    const contentDiv = document.getElementById('admin-content');
    
    if (userData && userData.role === 'admin') {
        if (authDiv) authDiv.style.display = 'none';
        if (contentDiv) contentDiv.style.display = 'block';
        loadInventory();
        loadAddons();
    } else {
        if (contentDiv) contentDiv.style.display = 'none';
        if (authDiv) {
            authDiv.style.display = 'block';
            authDiv.innerHTML = `<h3 class="text-danger">Access Denied</h3><p>You are not an admin.</p>`;
        }
    }
};

if (window.staffRecord) {
    initPanel(window.staffRecord.user, window.staffRecord.userData);
} else {
    window.addEventListener('staffAuthReady', (e) => {
        initPanel(e.detail.user, e.detail.userData);
    });
}

async function loadInventory() {
    const listContainer = document.getElementById('product-list');
    // REMOVED: listContainer.innerHTML = spinner; (Keeping skeletons)

    try {
        const stockSnapshot = await getDocs(collection(db, "inventory"));
        const currentStock = {};
        stockSnapshot.forEach(doc => currentStock[doc.id] = doc.data());

        listContainer.innerHTML = '';

        PRODUCT_CATALOG.forEach(item => {
            const data = currentStock[item.name] || {};

            // Sane Mapping: opt1 (Small) -> small, opt2 (Large) -> large
            const opt1Stock = data.small !== false;
            const opt2Stock = data.large !== false;

            const p1_price = data.price_small || "";
            const p1_mrp = data.mrp_small || "";
            const p2_price = data.price_large || "";
            const p2_mrp = data.mrp_large || "";

            const safeId = item.name.replace(/\s/g, '');

            const itemDiv = document.createElement('div');
            itemDiv.className = 'stock-item animate__animated animate__fadeInUp';

            itemDiv.innerHTML = `
                <div class="item-header">
                    <h5 class="item-title">${item.name}</h5>
                    <button class="btn btn-save" onclick="saveProduct('${item.name}')">
                        <i class="fas fa-save me-2"></i> Save Changes
                    </button>
                </div>
                
                <div class="row g-4">
                    <div class="col-md-6">
                        <div class="variant-box">
                            <div class="stock-toggle-wrapper">
                                <span class="toggle-label text-primary"><i class="fas fa-box-open me-2"></i> ${item.opt1}</span>
                                <label class="switch">
                                    <input type="checkbox" id="stock-${safeId}-small" ${opt1Stock ? 'checked' : ''}>
                                    <span class="slider"></span>
                                </label>
                            </div>
                            
                            <div class="row g-2">
                                <div class="col-6">
                                    <label class="form-label text-muted small mb-1 fw-bold">Selling Price</label>
                                    <div class="input-group input-group-sm">
                                        <span class="input-group-text">₹</span>
                                        <input type="number" id="price-${safeId}-small" value="${p1_price}" class="form-control" placeholder="0">
                                    </div>
                                </div>
                                <div class="col-6">
                                    <label class="form-label text-muted small mb-1 fw-bold">MRP (Crossed)</label>
                                    <div class="input-group input-group-sm">
                                        <span class="input-group-text">₹</span>
                                        <input type="number" id="mrp-${safeId}-small" value="${p1_mrp}" class="form-control text-muted" placeholder="0">
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="col-md-6">
                        <div class="variant-box">
                            <div class="stock-toggle-wrapper">
                                <span class="toggle-label text-primary"><i class="fas fa-box-open me-2"></i> ${item.opt2}</span>
                                <label class="switch">
                                    <input type="checkbox" id="stock-${safeId}-large" ${opt2Stock ? 'checked' : ''}>
                                    <span class="slider"></span>
                                </label>
                            </div>
                            
                            <div class="row g-2">
                                <div class="col-6">
                                    <label class="form-label text-muted small mb-1 fw-bold">Selling Price</label>
                                    <div class="input-group input-group-sm">
                                        <span class="input-group-text">₹</span>
                                        <input type="number" id="price-${safeId}-large" value="${p2_price}" class="form-control" placeholder="0">
                                    </div>
                                </div>
                                <div class="col-6">
                                    <label class="form-label text-muted small mb-1 fw-bold">MRP (Crossed)</label>
                                    <div class="input-group input-group-sm">
                                        <span class="input-group-text">₹</span>
                                        <input type="number" id="mrp-${safeId}-large" value="${p2_mrp}" class="form-control text-muted" placeholder="0">
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            listContainer.appendChild(itemDiv);
        });
    } catch (error) {
        console.error("Error loading inventory:", error);
        listContainer.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-triangle me-2"></i>
                Failed to load inventory. ${error.code === 'unavailable' ? 'You appear to be offline.' : error.message}
            </div>`;
    }
}

window.saveProduct = async (productName) => {
    const safeId = productName.replace(/\s/g, '');
    const btn = document.querySelector(`button[onclick="saveProduct('${productName}')"]`);
    const originalText = btn.innerHTML;

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    btn.disabled = true;

    const getVal = (id) => {
        const el = document.getElementById(id);
        return el.value ? parseFloat(el.value) : null;
    };

    const stockSmall = document.getElementById(`stock-${safeId}-small`).checked;
    const stockLarge = document.getElementById(`stock-${safeId}-large`).checked;

    try {
        await setDoc(doc(db, "inventory", productName), {
            small: stockSmall,
            price_small: getVal(`price-${safeId}-small`),
            mrp_small: getVal(`mrp-${safeId}-small`),

            large: stockLarge,
            price_large: getVal(`price-${safeId}-large`),
            mrp_large: getVal(`mrp-${safeId}-large`),

            updatedAt: new Date()
        }, { merge: true });

        btn.innerHTML = '<i class="fas fa-check"></i> Saved!';
        btn.classList.remove('btn-save');
        btn.classList.add('btn-success');

        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.classList.add('btn-save');
            btn.classList.remove('btn-success');
            btn.disabled = false;
        }, 2000);

    } catch (error) {
        console.error("Error", error);
        if (window.showCustomAlert) window.showCustomAlert("Error saving: " + error.message, 'Error', 'error');
        else alert("Error saving: " + error.message);
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// --- NEW: Handle Cart Add-ons ---

async function loadAddons() {
    const listContainer = document.getElementById('addon-list');
    listContainer.innerHTML = '<div class="text-center"><div class="spinner-border text-primary" role="status"></div></div>';

    try {
        // We store add-on prices in a single document: inventory/cart_addons
        const docRef = doc(db, "inventory", "cart_addons");
        
        // Actually fetching the specific doc
        let addonsData = {};
        try {
            const d = await import("https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js").then(m => m.getDoc(docRef));
            if (d.exists()) {
                addonsData = d.data();
            }
        } catch (e) {
            console.log("No existing addons doc or network error, will try defaults if offline persistence is on.");
        }

        const items = [
            { id: "big_eggs", name: "Fresh Big Eggs (Pack of 10)", priceKey: "big_eggs_price" },
            { id: "local_duck_eggs", name: "Fresh Local Duck Eggs (Pack of 10)", priceKey: "local_duck_eggs_price" }
        ];

        listContainer.innerHTML = '';

        items.forEach(item => {
            const price = addonsData[item.priceKey] || "";

            const itemDiv = document.createElement('div');
            itemDiv.className = 'stock-item animate__animated animate__fadeInUp';

            itemDiv.innerHTML = `
                <div class="item-header">
                    <h5 class="item-title">${item.name}</h5>
                    <button class="btn btn-save" onclick="saveAddon('${item.id}')">
                        <i class="fas fa-save me-2"></i> Save Changes
                    </button>
                </div>
                
                <div class="row g-4">
                    <div class="col-md-12">
                         <div class="variant-box">
                            <label class="form-label text-muted small mb-1 fw-bold">Selling Price</label>
                            <div class="input-group input-group-sm">
                                <span class="input-group-text">₹</span>
                                <input type="number" id="addon-price-${item.id}" value="${price}" class="form-control" placeholder="0">
                            </div>
                        </div>
                    </div>
                </div>
            `;
            listContainer.appendChild(itemDiv);
        });
    } catch (error) {
        console.error("Error loading addons:", error);
        listContainer.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-triangle me-2"></i>
                Failed to load addons. ${error.code === 'unavailable' ? 'You appear to be offline.' : error.message}
            </div>`;
    }
}

window.saveAddon = async (id) => {
    const btn = document.querySelector(`button[onclick="saveAddon('${id}')"]`);
    const originalText = btn.innerHTML;

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    btn.disabled = true;

    try {
        const priceInput = document.getElementById(`addon-price-${id}`);
        const price = priceInput.value ? parseFloat(priceInput.value) : 0;

        const updateData = {};
        if (id === 'big_eggs') updateData['big_eggs_price'] = price;
        if (id === 'local_duck_eggs') updateData['local_duck_eggs_price'] = price;
        updateData.updatedAt = new Date();

        await setDoc(doc(db, "inventory", "cart_addons"), updateData, { merge: true });

        btn.innerHTML = '<i class="fas fa-check"></i> Saved!';
        btn.classList.remove('btn-save');
        btn.classList.add('btn-success');

        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.classList.add('btn-save');
            btn.classList.remove('btn-success');
            btn.disabled = false;
        }, 2000);

    } catch (error) {
        console.error("Error saving addon", error);
        if (window.showCustomAlert) window.showCustomAlert("Error saving: " + error.message, 'Error', 'error');
        else alert("Error saving: " + error.message);
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

