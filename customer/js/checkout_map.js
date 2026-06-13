function showAlert(message, title = 'Notice', type = 'info') {
    if (window.showCustomAlert) window.showCustomAlert(message, title, type);
    else if (window.showCustomPopup) window.showCustomPopup(message, type);
    else alert(message);
}

// checkout_map.js
// Modern Location Picker with Search & Address Detection
// Uses MapTiler SDK (Optimized for MapTiler Geocoding & Satellite)

(function () {
    const SILCHAR_CENTER = [92.7789, 24.8333]; // [lng, lat]
    const MAPTILER_KEY = 'W3AiGlyaiQBixFytnKpU'; 
    
    // --- USER PINNED FLAG ---
    // This flag tracks whether the user has explicitly pinned their location.
    // It prevents the default map center from being saved as a real location.
    let userHasPinned = false;

    // Configured MapTiler Key
    // Configure SDK
    maptilersdk.config.apiKey = MAPTILER_KEY;

    let map = null;
    let marker = null;
    let searchTimeout = null;

    // --- Initialization ---
    // isUserAction: true = user explicitly interacted (GPS/click/search), false = auto/default init
    function initMap(lat, lng, isUserAction = false) {
        const mapEl = document.getElementById('pinmap');
        if (!mapEl) return;
        

        if (map) {
            map.flyTo({ center: [lng, lat], zoom: 17, essential: true });
            updateMarker(lat, lng, true, isUserAction);
            return;
        }

        // Initialize MapTiler Map
        map = new maptilersdk.Map({
            container: 'pinmap',
            style: maptilersdk.MapStyle.STREETS,
            center: [lng, lat],
            zoom: 16,
            attributionControl: false,
            cooperativeGestures: true
        });

        map.on('load', () => {
            // Only place marker on load if user explicitly pinned or has a saved real location
            if (isUserAction || userHasPinned) {
                updateMarker(lat, lng, true, true);
            }
        });

        // Map click = explicit user action
        map.on('click', (e) => {
            updateMarker(e.lngLat.lat, e.lngLat.lng, true, true);
        });

        // Toggle Style Button Logic
        const toggleBtn = document.getElementById('btn-toggle-style');
        if (toggleBtn) {
            let isSatellite = false;
            toggleBtn.onclick = () => {
                isSatellite = !isSatellite;
                if (isSatellite) {
                    map.setStyle(maptilersdk.MapStyle.SATELLITE);
                    toggleBtn.innerHTML = '<i class="fas fa-layer-group me-1"></i> Street';
                } else {
                    map.setStyle(maptilersdk.MapStyle.STREETS);
                    toggleBtn.innerHTML = '<i class="fas fa-layer-group me-1"></i> Satellite';
                }
            };
        }
    }

    // --- Marker Management ---
    async function updateMarker(lat, lng, shouldFetchAddress = true, isUserAction = false) {
        if (!map) return;

        if (marker) {
            marker.setLngLat([lng, lat]);
        } else {
            marker = new maptilersdk.Marker({
                draggable: true,
                color: "#ff7c08"
            })
            .setLngLat([lng, lat])
            .addTo(map);

            // Marker drag = explicit user action
            marker.on('dragend', () => {
                const pos = marker.getLngLat();
                updateMarker(pos.lat, pos.lng, true, true);
            });
        }

        // ONLY save to localStorage if user explicitly interacted
        if (isUserAction) {
            userHasPinned = true;
            localStorage.setItem('deliveryLocation', JSON.stringify({ lat, lng }));
            localStorage.setItem('userPinnedLocation', 'true');
        }

        if (shouldFetchAddress) {
            fetchAddress(lat, lng);
        }
    }

    // --- Geocoding (Reverse) ---
    async function fetchAddress(lat, lng) {
        const addressEl = document.getElementById('readable-address');
        const cardEl = document.getElementById('selected-address-card');
        
        if (addressEl) addressEl.innerText = "Detecting address...";
        // if (cardEl) cardEl.style.display = 'block'; // DISABLED: Hiding redundant address card

        try {
            // Use SDK Geocoding Helper
            const results = await maptilersdk.geocoding.reverse([lng, lat]);

            if (results && results.features && results.features.length > 0) {
                const fullAddress = results.features[0].place_name;
                if (addressEl) addressEl.innerText = fullAddress;
                
                const formAddress = document.getElementById('user-address');
                if (formAddress && !formAddress.value) {
                    formAddress.value = fullAddress;
                }
                localStorage.setItem('deliveryAddress', fullAddress);
            } else {
                if (addressEl) addressEl.innerText = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            }
        } catch (error) {
            console.error("Reverse geocoding error:", error);
            if (addressEl) addressEl.innerText = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        }
    }

    // --- Geocoding (Forward / Search) ---
    async function searchLocation(query) {
        if (!query || query.length < 3) {
            hideSuggestions();
            return;
        }

        try {
            const results = await maptilersdk.geocoding.forward(query, {
                bbox: [92.0, 24.0, 93.5, 25.5] // Filter near Silchar area
            });

            if (results && results.features && results.features.length > 0) {
                showSuggestions(results.features);
            } else {
                hideSuggestions();
            }
        } catch (error) {
            console.error("Search error:", error);
        }
    }

    function showSuggestions(features) {
        const container = document.getElementById('search-suggestions');
        if (!container) return;

        container.innerHTML = features.map(f => `
            <button type="button" class="list-group-item list-group-item-action" data-lng="${f.center[0]}" data-lat="${f.center[1]}" data-name="${f.place_name}">
                <i class="fas fa-map-marker-alt"></i> ${f.place_name}
            </button>
        `).join('');
        
        container.style.display = 'block';

        container.querySelectorAll('button').forEach(btn => {
            btn.onclick = () => {
                const lat = parseFloat(btn.dataset.lat);
                const lng = parseFloat(btn.dataset.lng);
                const name = btn.dataset.name;
                
                const searchInput = document.getElementById('map-search');
                if (searchInput) searchInput.value = name;
                hideSuggestions();
                // Search selection = explicit user action
                initMap(lat, lng, true);
            };
        });
    }

    function hideSuggestions() {
        const container = document.getElementById('search-suggestions');
        if (container) container.style.display = 'none';
    }

    document.addEventListener('DOMContentLoaded', () => {
        const searchInput = document.getElementById('map-search');
        const btnGps = document.getElementById('btn-use-gps');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    searchLocation(e.target.value);
                }, 400);
            });
            
            searchInput.addEventListener('blur', () => {
                setTimeout(hideSuggestions, 200);
            });
        }

        const performDetection = (triggerBtn) => {
            if (!navigator.geolocation) {
                showAlert("Location services are not supported by your browser.", "Not Supported", "error");
                return;
            }

            const originalHtml = triggerBtn.innerHTML;
            triggerBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Finding...';
            
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    triggerBtn.innerHTML = originalHtml;
                    // GPS = explicit user action
                    initMap(pos.coords.latitude, pos.coords.longitude, true);
                    if (window.expandMap) window.expandMap();
                },
                (err) => {
                    triggerBtn.innerHTML = originalHtml;
                    showAlert("Please allow location access in your browser settings to use this feature.", "Location Access Required", "info");
                },
                { enableHighAccuracy: true, timeout: 10000 }
            );
        };

        if (btnGps) {
            btnGps.addEventListener('click', () => performDetection(btnGps));
        }

        const btnBanner = document.getElementById('btn-detect-location-banner');
        if (btnBanner) {
            btnBanner.addEventListener('click', () => performDetection(btnBanner));
        }

        // --- Map Collapsible Logic ---
        const btnToggleMap = document.getElementById('btn-toggle-map');
        const mapCollapsible = document.getElementById('map-collapsible');
        const mapChevron = document.getElementById('map-chevron');

        function toggleMap(forceShow = false) {
            if (!mapCollapsible || !mapChevron) return;
            const isHidden = mapCollapsible.style.display === 'none' || mapCollapsible.style.display === '';
            if (forceShow || isHidden) {
                mapCollapsible.style.display = 'block';
                mapChevron.classList.remove('fa-chevron-down');
                mapChevron.classList.add('fa-chevron-up');
                if (map) setTimeout(() => map.resize(), 200);
            } else {
                mapCollapsible.style.display = 'none';
                mapChevron.classList.remove('fa-chevron-up');
                mapChevron.classList.add('fa-chevron-down');
            }
        }

        if (btnToggleMap) {
            btnToggleMap.addEventListener('click', () => toggleMap());
        }
        window.expandMap = () => toggleMap(true);

        // Check if user had previously pinned a REAL location
        const wasPinned = localStorage.getItem('userPinnedLocation') === 'true';
        const savedLocation = localStorage.getItem('deliveryLocation');
        
        if (wasPinned && savedLocation) {
            // User previously pinned — restore it
            try {
                const { lat, lng } = JSON.parse(savedLocation);
                userHasPinned = true;
                initMap(lat, lng, false); // Not a new action, but marker should show
                // Place marker since it was a real pin
                setTimeout(() => {
                    if (map) updateMarker(lat, lng, true, false);
                }, 500);
            } catch(e) {
                // Invalid saved data, clear and show default
                localStorage.removeItem('deliveryLocation');
                localStorage.removeItem('userPinnedLocation');
                initMap(SILCHAR_CENTER[1], SILCHAR_CENTER[0], false);
            }
        } else {
            // No real pin — clear any stale default location data
            localStorage.removeItem('deliveryLocation');
            localStorage.removeItem('userPinnedLocation');
            // Show default map view WITHOUT saving anything
            initMap(SILCHAR_CENTER[1], SILCHAR_CENTER[0], false);
        }
    });

    window.initMap = initMap;
})();
