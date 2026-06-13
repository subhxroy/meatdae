/**
 * MeatDae Staff Layout Loader
 * Modernizes staff portal by injecting shared components and handling role-based navigation.
 */

import { app, auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

// ─────────────────────────────────────────────────────────────────────────────
// FIX 1: Signal to firebase-auth.js (if it's also loaded on this page)
// that THIS file owns the auth-gate logic, so firebase-auth.js skips its
// own onAuthStateChanged redirect listener. Without this flag, both scripts
// register independent listeners — the original source of the race condition.
// ─────────────────────────────────────────────────────────────────────────────
window.__staffLayoutLoaderActive = true;

const components = [
    { id: 'auth-screen-placeholder', url: 'components/auth-screen.html' },
    { id: 'staff-header-placeholder', url: 'components/staff-header.html' },
    { id: 'staff-mobile-nav-placeholder', url: 'components/staff-mobile-nav.html' }
];

async function loadComponent(id, url) {
    const placeholder = document.getElementById(id);
    if (!placeholder) return;

    // Try to load from cache first for instant UI
    const cacheKey = `staff_component_${id}`;
    const cachedHtml = localStorage.getItem(cacheKey);
    if (cachedHtml) {
        placeholder.innerHTML = cachedHtml;
        // Process scripts from cache if any
        const scripts = placeholder.querySelectorAll('script');
        scripts.forEach(oldScript => {
            const newScript = document.createElement('script');
            Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
            newScript.textContent = oldScript.textContent;
            oldScript.parentNode.replaceChild(newScript, oldScript);
        });
    }

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const html = await response.text();
        
        // Only update DOM and cache if content changed
        if (html !== cachedHtml) {
            placeholder.innerHTML = html;
            localStorage.setItem(cacheKey, html);

            const scripts = placeholder.querySelectorAll('script');
            scripts.forEach(oldScript => {
                const newScript = document.createElement('script');
                Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
                newScript.textContent = oldScript.textContent;
                oldScript.parentNode.replaceChild(newScript, oldScript);
            });
        }
    } catch (error) {
        console.error(`Failed to load component ${id}:`, error);
    }
}

function hideAuthScreens() {
    ['auth-screen', 'auth-check', 'auth-loading-overlay', 'auth-screen-placeholder'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

function showMainContent() {
    const mainContentIds = [
        'admin-interface', 'preparer-content', 'rider-content',
        'rider-interface', 'stock-interface', 'admin-content'
    ];
    mainContentIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'block';
    });
}

async function initLayout() {
    const requiresAuth = document.body.getAttribute('data-requires-auth') !== 'false';
    const isAuthPage   = document.body.getAttribute('data-requires-auth') === 'false';

    // 1. Start Auth Check immediately (Don't wait for anything else)
    const authPromise = new Promise(resolve => {
        const unsub = onAuthStateChanged(auth, user => {
            unsub();
            resolve(user);
        });
    });

    // 2. Start loading components in parallel
    const componentPromise = Promise.all(components.map(c => loadComponent(c.id, c.url)));

    // Show auth screen spinner if it's already in the DOM/cache
    const authScreen = document.getElementById('auth-screen');
    if (authScreen && requiresAuth) {
        authScreen.style.display = 'block';
    }

    // 3. Resolve Auth State
    const initialUser = await authPromise;
    console.log("[LayoutLoader] Initial auth state:", initialUser ? initialUser.uid : "no user");

    if (!initialUser) {
        if (requiresAuth) {
            console.warn("[LayoutLoader] No user → Immediate redirect to sign_in.html");
            window.location.href = 'sign_in.html';
            return;
        }
        // Public page logic
        await componentPromise;
        hideAuthScreens();
        const loginWrapper = document.querySelector('.login-wrapper');
        if (loginWrapper) loginWrapper.style.display = 'block';
        return;
    }

    // 4. User is authenticated — Start fetching role immediately
    const rolePromise = getDoc(doc(db, "users", initialUser.uid));

    // 5. Wait for both components and role to finish
    try {
        const [userDoc] = await Promise.all([rolePromise, componentPromise]);
        const userData = userDoc.exists() ? userDoc.data() : { role: 'customer', email: initialUser.email };

        // --- HARDCODED ADMIN OVERRIDE ---
        const adminEmails = [
            '10sahilsarkar@gmail.com',
            'contact.harryteachesai@gmail.com',
            'support.meatdae@gmail.com',
            'contact.meatdae@gmail.com'
        ];
        if (adminEmails.includes(initialUser.email)) {
            userData.role = 'admin';
        }

        if (userData.role === 'admin') {
            const adminLinks = document.getElementById('admin-links');
            const adminMobileLinks = document.getElementById('admin-mobile-links');
            const mobileAdminNav = document.getElementById('mobile-nav-dashboard');
            const mobileStockNav = document.getElementById('mobile-nav-stock');

            if (adminLinks) adminLinks.style.display = 'flex';
            if (adminMobileLinks) adminMobileLinks.style.display = 'flex';
            if (mobileAdminNav) mobileAdminNav.style.display = 'block';
            if (mobileStockNav) mobileStockNav.style.display = 'block';
        }

        hideAuthScreens();
        showMainContent();

        window.staffRecord = { user: initialUser, userData };
        window.dispatchEvent(new CustomEvent('staffAuthReady', {
            detail: { user: initialUser, userData }
        }));

        if (isAuthPage) {
            window.location.href = 'index.html';
        }

    } catch (error) {
        console.error("[LayoutLoader] Auth init failed:", error);
        const authScreenEl = document.getElementById('auth-screen');
        if (authScreenEl) {
            authScreenEl.innerHTML = `<div class="alert alert-danger m-5">Auth Error: ${error.message}</div>`;
            authScreenEl.style.display = 'block';
        }
        return;
    }

    // Phase B: watch for genuine sign-outs with a grace period.
    // clearTimeout cancels the redirect if the session briefly dips to null
    // then recovers (token refresh, momentary network drop).
    let signOutRedirectTimer = null;

    onAuthStateChanged(auth, (user) => {
        if (user) {
            clearTimeout(signOutRedirectTimer);
            signOutRedirectTimer = null;
            console.log("[LayoutLoader] Phase-B: session recovered — redirect cancelled");
        } else if (requiresAuth && !signOutRedirectTimer) {
            console.warn("[LayoutLoader] Phase-B: user null — 4 s grace period started");
            signOutRedirectTimer = setTimeout(() => {
                if (!auth.currentUser) {
                    console.warn("[LayoutLoader] Phase-B: still no user → sign_in.html");
                    window.location.href = 'sign_in.html';
                }
            }, 2000); // Reduced to 2s for better responsiveness
        }
    });
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initLayout);
} else {
    initLayout();
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL FALLBACK: If the auth screen is still visible after 10 seconds,
// force-hide it and show content. This prevents the "stuck in loading" state.
// ─────────────────────────────────────────────────────────────────────────────
setTimeout(() => {
    const authScreen = document.getElementById('auth-screen');
    if (authScreen && authScreen.style.display !== 'none') {
        console.warn("[LayoutLoader] Loading timeout reached. Triggering emergency fallback UI.");
        hideAuthScreens();
        showMainContent();
    }
}, 10000);
