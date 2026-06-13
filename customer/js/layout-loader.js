/**
 * layout-loader.js
 * Dynamically loads shared components (Header, Sidebar, Support Bot) into pages.
 */

const LAYOUT_VERSION = '5';

async function loadComponent(id, url) {
    const placeholder = document.getElementById(id);
    if (!placeholder) return;

    // Skip if already loaded
    if (placeholder.children.length > 0 && placeholder.dataset.loaded === 'true') return;

    try {
        const versionedUrl = url.includes('?') ? `${url}&v=${LAYOUT_VERSION}` : `${url}?v=${LAYOUT_VERSION}`;
        const response = await fetch(versionedUrl);
        if (!response.ok) throw new Error(`Failed to load ${url}`);
        const html = await response.text();
        placeholder.innerHTML = html;
        placeholder.dataset.loaded = 'true';
        console.log(`[LayoutLoader] Successfully loaded ${url}`);
        
        // Trigger custom events for specific components if needed
    if (id === 'header-placeholder') document.dispatchEvent(new CustomEvent('headerLoaded'));
    if (id === 'sidebar-placeholder') document.dispatchEvent(new CustomEvent('sidebarLoaded'));
    
    // Removed FontAwesome i2svg to prevent conflict with pure CSS
} catch (error) {
        console.error(`[LayoutLoader] Error loading ${url}:`, error);
    }
}

async function loadCSS(url) {
    const versionedUrl = url.includes('?') ? `${url}&v=${LAYOUT_VERSION}` : `${url}?v=${LAYOUT_VERSION}`;
    if (!document.querySelector(`link[href^="${url}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = versionedUrl;
        document.head.appendChild(link);
    }
}

async function initNavigation() {
    // List of core layout components
    const components = [
        { id: 'sidebar-placeholder', file: 'components/sidebar.html' },
        { id: 'header-placeholder', file: 'components/header.html' },
        { id: 'support-bot-placeholder', file: 'support-bot.html' },
        { id: 'mobile-nav-placeholder', file: 'components/mobile-nav.html' },
        { id: 'buy-now-placeholder', file: 'components/buy-now-modal.html' },
        { id: 'custom-popup-placeholder', file: 'components/custom-popup.html' },
        { id: 'footer-placeholder', file: 'components/footer.html' }
    ];

    // Load components in parallel
    await Promise.all(components.map(comp => loadComponent(comp.id, comp.file)));

    // Load missing CSS for injected components globally
    loadCSS('css/support-bot.css');
    loadCSS('css/custom-popup.css');

    // Re-initialize any necessary UI logic after components are loaded
    if (typeof initNavigationHandlers === 'function') {
        initNavigationHandlers();
    }

    if (window.mainInit) window.mainInit(); 
    
    // Trigger window event that components are ready
    window.dispatchEvent(new CustomEvent('componentsLoaded'));

    // Global Fade-in: Reveal body once core layout is ready
    setTimeout(() => {
        document.body.classList.add('loaded');
        
        // Removed FontAwesome i2svg to prevent conflict with pure CSS
    }, 100); // Increased buffer to 100ms for stability
}


// Start loading when script is executed
initNavigation();
