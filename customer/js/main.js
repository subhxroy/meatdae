/* --- GLOBAL SIDEBAR & SEARCH LOGIC --- */
window.toggleSidebar = function () {
  const sidebar = document.getElementById('sidebar-menu');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar && overlay) {
    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
  }
};

// Auto-close sidebar on link click
$(document).on('click', '.sidebar-link', function() {
  const sidebar = document.getElementById('sidebar-menu');
  if (sidebar && sidebar.classList.contains('active')) {
    window.toggleSidebar();
  }
});

/* --- SMART NAVIGATION STACK --- */
(function () {
  const skipPages = ['sign_in.html', 'sign_up.html', 'dashboard.html', 'profile.html', 'payment.html', 'signin', 'signup', 'auth'];
  let stack = JSON.parse(sessionStorage.getItem('navStack') || '[]');
  let currentPath = window.location.pathname;
  let currentUrl = (currentPath.split('/').pop() || 'index.html') + window.location.search;

  // Special case for root "/"
  if (currentPath.endsWith('/') && !currentUrl.includes('.html')) {
    currentUrl = 'index.html';
  }

  // If current page is NOT a skip page, we add it to stack
  if (!skipPages.some(p => currentUrl.includes(p))) {
    if (stack.length === 0 || stack[stack.length - 1] !== currentUrl) {
      stack.push(currentUrl);
      if (stack.length > 20) stack.shift();
      sessionStorage.setItem('navStack', JSON.stringify(stack));
    }
  }

  // --- SCROLL POSITION TRACKING ---
  let scrollTimeout;
  window.addEventListener('scroll', function () {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      sessionStorage.setItem('scrollPos_' + currentUrl, window.scrollY);
    }, 150);
  }, { passive: true });
})();

window.smartBack = function () {
  const skipPages = ['sign_in.html', 'sign_up.html', 'dashboard.html', 'profile.html', 'signin', 'signup', 'payment.html'];
  let stack = JSON.parse(sessionStorage.getItem('navStack') || '[]');
  let currentPath = window.location.pathname;
  let currentUrl = (currentPath.split('/').pop() || 'index.html') + window.location.search;

  if (currentPath.endsWith('/') && !currentUrl.includes('.html')) {
    currentUrl = 'index.html';
  }

  // 1. If we have a stack
  if (stack.length > 1) {
    // Remove current page from top of stack if it's there
    if (stack[stack.length - 1] === currentUrl) {
      stack.pop();
    }

    let targetPage = null;
    while (stack.length > 0) {
      let potential = stack.pop();
      if (!skipPages.some(p => potential.includes(p))) {
        targetPage = potential;
        break;
      }
    }

    if (targetPage) {
      sessionStorage.setItem('navStack', JSON.stringify(stack));
      sessionStorage.setItem('shouldRestoreScroll', 'true');
      window.location.href = targetPage;
      return;
    }
  }

  // 2. Fallback
  // 2. Fallback - check if history.back() would take us to a login page
  const prevUrl = document.referrer;
  const isPrevAuth = skipPages.some(p => prevUrl.includes(p));

  if (window.history.length > 1 && !isPrevAuth) {
    window.history.back();
  } else {
    window.location.href = 'index.html';
  }
};

window.goBack = window.smartBack;

window.toggleSearch = function () {
  const searchContainer = document.getElementById('header-search-container');
  const searchInput = document.getElementById('header-search-input');
  if (searchContainer && searchInput) {
    searchContainer.classList.toggle('active');
    if (searchContainer.classList.contains('active')) {
      searchInput.focus();
    }
  }
};

window.goToLogin = function () {
  sessionStorage.setItem('redirectAfterLogin', window.location.href);
  window.location.replace("sign_in.html");
};

window.showLoginOverlay = function (message = "Heads up! Some features on this page require you to be signed in to work correctly.") {
  if (window.showCustomAlert) {
    window.showCustomAlert(message, "Info", "info");
  } else {
    alert(message);
  }
};

$(document).ready(function () {
  "use strict";

  /* --- PREMIUM BOTTOM NAV ACTIVE STATE --- */
  window.initNavigationHandlers = function() {
    const path = window.location.pathname;
    $('.bottom-nav-item').removeClass('active');

    if (path.includes('index') || path.endsWith('/') || path.endsWith('/customer/') || path.endsWith('/customer')) {
      $('a.bottom-nav-item[href*="index"]').addClass('active');
    } else if (path.includes('cart_view')) {
      $('a.bottom-nav-item[href*="cart_view"]').addClass('active');
    } else if (path.includes('my_orders') || path.includes('order_track')) {
      $('a.bottom-nav-item[href*="my_orders"]').addClass('active');
    }
  };
  window.initNavigationHandlers();

  /* --- SKELETON LOADING HANDLER --- */
  function showProducts() {
    const productSkeletons = document.getElementById('product-skeletons');
    const actualProducts = document.getElementById('actual-products');
    const heroSkeleton = document.getElementById('hero-skeleton');
    const actualHero = document.getElementById('actual-hero');
    const categoriesSkeleton = document.getElementById('categories-skeleton');
    const actualCategories = document.getElementById('actual-categories');
    const pageSkeleton = document.getElementById('page-skeleton');
    const actualPage = document.getElementById('actual-page');

    setTimeout(() => {
      // Handle Products
      if (productSkeletons && actualProducts) {
        productSkeletons.style.display = 'none';
        actualProducts.style.opacity = '1';
        actualProducts.style.display = 'contents';
      }

      // Handle Hero
      if (heroSkeleton && actualHero) {
        heroSkeleton.style.display = 'none';
        actualHero.style.display = 'block';
        actualHero.style.opacity = '1';
      }

      // Handle Categories
      if (categoriesSkeleton && actualCategories) {
        categoriesSkeleton.style.display = 'none';
        actualCategories.style.display = 'block';
        actualCategories.style.opacity = '1';
      }

      // Handle Generic Page
      if (pageSkeleton && actualPage) {
        pageSkeleton.style.display = 'none';
        actualPage.style.display = 'block';
        actualPage.style.opacity = '1';
      }

      // Restore scroll if needed
      handleScrollRestoration();
    }, 300); // Reduced delay for faster, snappier feel
  }

  function handleScrollRestoration() {
    const shouldRestore = sessionStorage.getItem('shouldRestoreScroll');
    if (shouldRestore === 'true') {
      const currentUrl = window.location.pathname.split('/').pop() || 'index.html';
      const savedPos = sessionStorage.getItem('scrollPos_' + currentUrl);
      if (savedPos) {
        window.scrollTo({ top: parseInt(savedPos), behavior: 'auto' });
      }
      sessionStorage.removeItem('shouldRestoreScroll');
    }
  }
  showProducts();

  /* --- GLOBAL POPUP UTILITIES --- */

  // Global Alert Function
  window.showCustomAlert = function (message, title = 'Alert', type = 'info', options = {}) {
    console.log("[showCustomAlert] called:", { message, title, type, options });
    const popup = document.getElementById('custom-popup');
    if (!popup) {
        console.warn('Custom popup element #custom-popup not found in DOM');
        alert(message);
        return;
    }
    
    try {
      const popupBox = popup.querySelector('.popup-box');
      if (!popupBox) {
          alert(message);
          return;
      }

      let iconClass = 'fa-info-circle confirm';
      if (type === 'success') {
          iconClass = 'fa-check-circle success';
          if (title === 'Alert') title = 'Success';
      } else if (type === 'error') {
          iconClass = 'fa-times-circle error';
          if (title === 'Alert') title = 'Error';
      }

      const isMinimal = !!options.minimal;

      // Safely update the popup using DOM manipulation instead of innerHTML
      const iconContainer = popupBox.querySelector('.popup-icon');
      if (iconContainer) {
        if (isMinimal) {
          iconContainer.style.display = 'none';
        } else {
          iconContainer.style.display = 'block';
          iconContainer.innerHTML = `<i class="fas ${iconClass}"></i>`;
        }
      }
      
      let h4El = popupBox.querySelector('h4');
      if (!h4El) {
        h4El = document.createElement('h4');
        popupBox.appendChild(h4El);
      }
      if (isMinimal) {
        h4El.style.display = 'none';
      } else {
        h4El.style.display = 'block';
        h4El.textContent = title;
        h4El.style.cssText = "display:block; color:#101010; font-size:24px; font-weight:700; margin-bottom:10px;";
      }
      
      let pEl = popupBox.querySelector('p');
      if (!pEl) {
        pEl = document.createElement('p');
        popupBox.appendChild(pEl);
      }
      pEl.textContent = message;
      if (isMinimal) {
        pEl.style.cssText = "display:block; white-space:pre-wrap; color:#282c3f; font-size:15px; font-weight:600; margin: 10px 0;";
      } else {
        pEl.style.cssText = "display:block; white-space:pre-wrap; color:#484747; font-size:16px; margin-bottom:25px;";
      }

      let btnContainer = popupBox.querySelector('.popup-buttons');
      if (!btnContainer) {
        btnContainer = document.createElement('div');
        btnContainer.className = 'popup-buttons';
        popupBox.appendChild(btnContainer);
      }
      if (isMinimal) {
        btnContainer.style.display = 'none';
      } else {
        btnContainer.style.display = 'flex';
      }
      
      let okBtn = btnContainer.querySelector('#popup-ok');
      if (!okBtn) {
        okBtn = document.createElement('button');
        okBtn.id = 'popup-ok';
        okBtn.className = 'common_btn';
        btnContainer.appendChild(okBtn);
      }
      okBtn.textContent = 'OK';
      okBtn.style.cssText = "padding:10px 30px; font-size:16px; background:#ff7c08; color:white; border:none; cursor:pointer;";
      
      const closePopup = () => {
        if (popup._autoCloseTimeout) {
          clearTimeout(popup._autoCloseTimeout);
          popup._autoCloseTimeout = null;
        }
        popup.classList.remove('show');
        // Restore styles after transition
        setTimeout(() => {
          popupBox.style.padding = '';
          popupBox.style.maxWidth = '';
          popupBox.style.borderRadius = '';
          popupBox.style.border = '';
          if (iconContainer) iconContainer.style.display = '';
          if (h4El) h4El.style.display = '';
          if (pEl) pEl.style.cssText = '';
          if (btnContainer) btnContainer.style.display = '';
          if (closeBtn) closeBtn.style.display = '';
        }, 300);
      };

      okBtn.onclick = closePopup;

      let closeBtn = popupBox.querySelector('#popup-close');
      if (!closeBtn) {
        closeBtn = document.createElement('button');
        closeBtn.className = 'popup-close-btn';
        closeBtn.id = 'popup-close';
        closeBtn.innerHTML = '&times;';
        popupBox.prepend(closeBtn);
      }
      if (isMinimal) {
        closeBtn.style.display = 'none';
      } else {
        closeBtn.style.display = 'flex';
        closeBtn.onclick = closePopup;
      }

      // Also allow clicking outside to close
      popup.onclick = function (e) {
        if (e.target === popup) {
          closePopup();
        }
      };

      if (isMinimal) {
        popupBox.style.padding = '16px 24px';
        popupBox.style.maxWidth = '300px';
        popupBox.style.borderRadius = '8px';
        popupBox.style.border = '1px solid rgba(255, 124, 8, 0.2)';
      } else {
        popupBox.style.padding = '30px';
        popupBox.style.maxWidth = '400px';
        popupBox.style.borderRadius = '12px';
        popupBox.style.border = 'none';
      }

      popup.classList.add('show');

      if (options.autoClose) {
        const duration = typeof options.autoClose === 'number' ? options.autoClose : 2000;
        if (popup._autoCloseTimeout) {
          clearTimeout(popup._autoCloseTimeout);
        }
        popup._autoCloseTimeout = setTimeout(closePopup, duration);
      }

    } catch (err) {
      console.error("Error in showCustomAlert initialization:", err);
      alert(message);
    }
  };

  // Global Confirm Function
  window.showCustomConfirm = function (message, onConfirm, confirmText = 'OK', cancelText = 'Cancel') {
    const popup = document.getElementById('custom-popup');
    if (!popup) {
        if (confirm(message)) onConfirm();
        return;
    }
    
    try {
      const icon = popup.querySelector('.popup-icon i') || popup.querySelector('.popup-icon svg') || popup.querySelector('.popup-icon');
      const titleEl = popup.querySelector('h4');
      const msgEl = popup.querySelector('p');
      const okBtn = document.getElementById('popup-ok');
      const cancelBtn = document.getElementById('popup-cancel');

      // Ensure close button exists
      let closeBtn = popup.querySelector('#popup-close');
      if (!closeBtn) {
        closeBtn = document.createElement('button');
        closeBtn.className = 'popup-close-btn';
        closeBtn.id = 'popup-close';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.innerHTML = '&times;';
        const popupBox = popup.querySelector('.popup-box');
        if (popupBox) popupBox.prepend(closeBtn);
      }

      if (titleEl) titleEl.textContent = 'Please Confirm';
      if (msgEl) {
        msgEl.textContent = message;
        msgEl.style.whiteSpace = 'pre-wrap';
      }
      if (okBtn) okBtn.textContent = confirmText;
      if (cancelBtn) {
        cancelBtn.textContent = cancelText;
        cancelBtn.style.display = 'inline-block';
      }

      if (icon) {
        if (icon.tagName.toLowerCase() === 'i') {
          icon.className = 'fas fa-question-circle confirm';
        } else if (icon.tagName.toLowerCase() === 'svg') {
          icon.setAttribute('class', 'svg-inline--fa fa-question-circle confirm');
        }
      }

      // Handle Confirm
      if (okBtn) {
        const newOkBtn = okBtn.cloneNode(true);
        okBtn.parentNode.replaceChild(newOkBtn, okBtn);
        newOkBtn.addEventListener('click', function () {
          popup.classList.remove('show');
          if (onConfirm) onConfirm();
        });
      }

      // Handle Cancel
      if (cancelBtn) {
        const newCancelBtn = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        newCancelBtn.addEventListener('click', function () {
          popup.classList.remove('show');
        });
      }

      // Handle Close
      if (closeBtn) {
        closeBtn.onclick = function () {
          popup.classList.remove('show');
        };
      }

      // Close on backdrop click
      popup.onclick = function (e) {
        if (e.target === popup) {
          popup.classList.remove('show');
        }
      };

    } catch (err) {
      console.error("Error in showCustomConfirm initialization:", err);
    }

    popup.classList.add('show');
  };

  // Close search on escape key
  $(document).keyup(function (e) {
    if (e.key === "Escape") {
      const searchContainer = document.getElementById('header-search-container');
      if (searchContainer && searchContainer.classList.contains('active')) {
        toggleSearch();
      }
    }
  });

  // Handle Search Input
  $(document).on('input', '#header-search-input', function () {
    const query = $(this).val();
    if (typeof window.filterItems === 'function') {
      window.filterItems(query);

      // If on index.html, scroll to products
      const productList = document.getElementById('main-product-list');
      if (productList && query.length > 0) {
        productList.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });

  /* ----------------------------- */

  // Function to filter menu items based on search query
  window.filterItems = function (query) {
    query = query.toLowerCase().trim();
    let foundItems = false;

    // Define keywords and their matching items
    const keywords = {
      'chicken': ['chicken curry cuts', 'chicken boneless cuts', 'chicken legs cuts', 'chicken breast cuts'],
      'curry': ['chicken curry cuts', 'mutton curry cuts'],
      'boneless': ['chicken boneless cuts'],
      'legs': ['chicken legs cuts'],
      'breast': ['chicken breast cuts'],
      'mutton': ['mutton curry cuts'],
      'egg': ['fresh big eggs', 'local duck eggs'],
      'eggs': ['fresh big eggs', 'local duck eggs']
    };

    // Get all menu items, category cards, and premium product cards
    const menuItems = document.querySelectorAll('.menu_item, .menu_swiggy_card, .modern-product-card');

    menuItems.forEach(function (item) {
      const titleEl = item.querySelector('.title') || item.querySelector('.menu_swiggy_title') || item.querySelector('.product-title');
      if (!titleEl) return;

      const title = titleEl.textContent.toLowerCase();
      let shouldShow = false;

      // Direct text match in title
      if (title.includes(query) || query === "") {
        shouldShow = true;
      }

      // Check for keyword-based matches
      if (!shouldShow) {
        const searchTerms = query.split(' ');
        for (const term of searchTerms) {
          if (keywords[term]) {
            const relatedItems = keywords[term];
            for (const relatedItem of relatedItems) {
              if (title.includes(relatedItem)) {
                shouldShow = true;
                break;
              }
            }
          }
          if (shouldShow) break;
        }
      }

      if (shouldShow) {
        item.style.display = 'block';
        foundItems = true;
      } else {
        item.style.display = 'none';
      }
    });

    // Handle "No Results" message
    const noResultsMsg = document.getElementById('no_results_message');
    if (noResultsMsg) {
      noResultsMsg.style.display = foundItems ? 'none' : 'block';
    }
  };

  /* ----------------------------- */

  //======menu fix js======
  if ($(".menu_fix").length > 0) {
    $(window).scroll(function () {
      var scrolling = $(this).scrollTop();

      if (scrolling > 163) {
        $(".menu_fix").addClass("sticky_menu");
      } else {
        $(".menu_fix").removeClass("sticky_menu");
      }
    });
  }

  //======nice select js======
  if ($("select").length > 0) {
    $("select").niceSelect();
  }

  //======BANNER SLIDER======
  if ($(".banner_slider").length > 0) {
    $(".banner_slider").slick({
      slidesToShow: 1,
      slidesToScroll: 1,
      autoplay: true,
      autoplaySpeed: 3000,
      dots: true,
      arrows: false,
    });
  }

  //======MOBILE MENU BUTTON======
  $(".navbar-toggler").on("click", function () {
    $(".navbar-toggler").toggleClass("show");
  });

  //======VENOBOX JS======
  if ($(".venobox").length > 0) {
    $(".venobox").venobox();
  }

  //======SCROLL BUTTON======
  if ($(".scroll_btn").length > 0) {
    $(window).scroll(function () {
      var scrolling = $(this).scrollTop();

      if (scrolling > 300) {
        $(".scroll_btn").fadeIn();
      } else {
        $(".scroll_btn").fadeOut();
      }
    });

    $(".scroll_btn").on("click", function () {
      $("html, body").animate(
        {
          scrollTop: 0,
        },
        600
      );
    });
  }

  //======PRODUCT SLIDER======
  if ($(".product_slider").length > 0) {
    $(".product_slider").slick({
      slidesToShow: 4,
      slidesToScroll: 1,
      autoplay: true,
      autoplaySpeed: 3000,
      dots: false,
      arrows: true,
      nextArrow: '<i class="fas fa-chevron-right nextArrow"></i>',
      prevArrow: '<i class="fas fa-chevron-left prevArrow"></i>',

      responsive: [
        {
          breakpoint: 1200,
          settings: {
            slidesToShow: 3,
          },
        },
        {
          breakpoint: 992,
          settings: {
            slidesToShow: 2,
          },
        },
        {
          breakpoint: 768,
          settings: {
            slidesToShow: 1,
          },
        },
        {
          breakpoint: 576,
          settings: {
            slidesToShow: 1,
          },
        },
      ],
    });
  }

  //======TEAM SLIDER======
  if ($(".team_slider").length > 0) {
    $(".team_slider").slick({
      slidesToShow: 4,
      slidesToScroll: 1,
      autoplay: true,
      autoplaySpeed: 3000,
      dots: false,
      arrows: true,
      nextArrow: '<i class="fas fa-chevron-right nextArrow"></i>',
      prevArrow: '<i class="fas fa-chevron-left prevArrow"></i>',

      responsive: [
        {
          breakpoint: 1200,
          settings: {
            slidesToShow: 3,
          },
        },
        {
          breakpoint: 992,
          settings: {
            slidesToShow: 2,
          },
        },
        {
          breakpoint: 768,
          settings: {
            slidesToShow: 2,
          },
        },
        {
          breakpoint: 576,
          settings: {
            slidesToShow: 1,
          },
        },
      ],
    });
  }

  //======TESTIMONIAL SLIDER======
  if ($(".testi_slider").length > 0) {
    $(".testi_slider").slick({
      slidesToShow: 2,
      slidesToScroll: 1,
      autoplay: true,
      autoplaySpeed: 3000,
      dots: false,
      arrows: true,
      nextArrow: '<i class="fas fa-chevron-right nextArrow"></i>',
      prevArrow: '<i class="fas fa-chevron-left prevArrow"></i>',

      responsive: [
        {
          breakpoint: 1200,
          settings: {
            slidesToShow: 2,
          },
        },
        {
          breakpoint: 992,
          settings: {
            slidesToShow: 2,
          },
        },
        {
          breakpoint: 768,
          settings: {
            slidesToShow: 1,
          },
        },
        {
          breakpoint: 576,
          settings: {
            slidesToShow: 1,
          },
        },
      ],
    });
  }

  //======BLOG SLIDER======
  if ($(".blog_slider").length > 0) {
    $(".blog_slider").slick({
      slidesToShow: 3,
      slidesToScroll: 1,
      autoplay: true,
      autoplaySpeed: 3000,
      dots: false,
      arrows: true,
      nextArrow: '<i class="fas fa-chevron-right nextArrow"></i>',
      prevArrow: '<i class="fas fa-chevron-left prevArrow"></i>',

      responsive: [
        {
          breakpoint: 1200,
          settings: {
            slidesToShow: 3,
          },
        },
        {
          breakpoint: 992,
          settings: {
            slidesToShow: 2,
          },
        },
        {
          breakpoint: 768,
          settings: {
            slidesToShow: 1,
          },
        },
        {
          breakpoint: 576,
          settings: {
            slidesToShow: 1,
          },
        },
      ],
    });
  }

  //======MOBILE MENU BUTTON======
  $(".navbar-toggler").on("click", function () {
    $(".navbar-toggler").toggleClass("show");
  });

  //======EXZOOM JS======
  if ($("#exzoom").length > 0) {
    $("#exzoom").exzoom({
      navWidth: 60,
      navHeight: 60,
      navItemNum: 5,
      navItemMargin: 7,
      navBorder: 1,
      autoPlay: true,
      autoPlayTimeout: 2000,
    });
  }

  //======ISOTOPE JS======
  var $grid = $(".grid").isotope({});

  $(".menu_filter button").on("click", function () {
    $(".menu_filter button").removeClass("active");
    $(this).addClass("active");

    var filterValue = $(this).attr("data-filter");
    $grid.isotope({
      filter: filterValue,
    });
  });

  //======STICKY SIDEBAR JS======
  if ($("#sticky_sidebar").length > 0) {
    $("#sticky_sidebar").stick_in_parent();
  }

  /* --- HOMEPAGE SPECIFIC: Premium Category Filter --- */
  $('.category-tab').on('click', function () {
    const filterValue = $(this).attr('data-filter');

    // Update active tab state
    $('.category-tab').removeClass('active');
    $(this).addClass('active');

    // Reset search query visually when switching categories (optional but good UX)
    // $('#header-search-input').val('');

    // Filter products
    let visibleCount = 0;
    $('.modern-product-card').each(function () {
      const itemCategory = $(this).attr('data-category');

      let isMatch = (filterValue === '*' || itemCategory === filterValue);

      // Special case for "eggs" category
      if (filterValue === 'eggs' && itemCategory && itemCategory.startsWith('eggs')) {
        isMatch = true;
      }

      if (isMatch) {
        $(this).fadeIn(300);
        visibleCount++;
      } else {
        $(this).fadeOut(300);
      }
    });

    // Handle "Coming Soon" placeholder
    setTimeout(() => {
      const placeholder = document.getElementById('coming-soon-placeholder');
      if (placeholder) {
        if (visibleCount === 0) {
          $(placeholder).fadeIn(300);
        } else {
          $(placeholder).fadeOut(300);
        }
      }
    }, 300);
  });

  /* --- PRODUCT CARD SIZE SELECTION --- */
  $(document).on('click', '.size-pill', function (e) {
    e.preventDefault();
    e.stopPropagation();

    const $btn = $(this);
    const $card = $btn.closest('.modern-product-card');
    const size = $btn.data('size');
    const unitPrice = parseFloat($btn.data('price'));
    const mrpPrice = parseFloat($btn.data('mrp')) || unitPrice;

    // Default to 1 if qty-selector is removed
    const $qtyValue = $card.find('.qty-value');
    const qty = $qtyValue.length > 0 ? (parseInt($qtyValue.text()) || 1) : 1;

    // Update active state
    $card.find('.size-pill').removeClass('active');
    $btn.addClass('active');

    // Update description for Fresh Chicken Curry Cut based on size
    const $descEl = $card.find('.product-desc-sm');
    const productName = $card.find('.product-title').text().trim().toLowerCase();
    
    if (productName.includes('curry cut') && !productName.includes('mutton')) {
      if (size === '220g') {
        $descEl.text("Juicy bone-in mixed pieces for curry (no leg piece)");
      } else if (size === '500g') {
        $descEl.text("Juicy bone-in mixed pieces for curry (1 leg piece)");
      } else if (size === '1000g' || size === '1kg') {
        $descEl.text("Juicy bone-in mixed pieces for curry (2 leg pieces)");
      } else {
        const originalDesc = $descEl.data('original-desc') || "Juicy bone-in mixed pieces for curry.";
        $descEl.text(originalDesc);
      }
    } else {
      const originalDesc = $descEl.data('original-desc') || $descEl.text();
      $descEl.text(originalDesc);
    }

    // Update price display (unit price * quantity)
    const $priceEl = $card.find('.product-price');

    if (mrpPrice > unitPrice) {
      $priceEl.html(`₹${(unitPrice * qty).toFixed(0)} <del style="font-size:14px;color:#999;">₹${(mrpPrice * qty).toFixed(0)}</del>`);
    } else {
      $priceEl.text('₹' + (unitPrice * qty).toFixed(0));
    }
  });

  /* --- PRODUCT CARD QUANTITY SELECTION --- */
  $(document).on('click', '.qty-btn', function (e) {
    e.preventDefault();
    e.stopPropagation();

    const $btn = $(this);
    const $card = $btn.closest('.modern-product-card');
    const $qtyValue = $card.find('.qty-value');
    let currentQty = parseInt($qtyValue.text());

    if ($btn.hasClass('qty-plus')) {
      currentQty++;
    } else if ($btn.hasClass('qty-minus') && currentQty > 1) {
      currentQty--;
    }

    $qtyValue.text(currentQty);

    // Update price display based on active size pill
    const $activeSizePill = $card.find('.size-pill.active');
    if ($activeSizePill.length > 0) {
      const unitPrice = parseFloat($activeSizePill.data('price'));
      const mrpPrice = parseFloat($activeSizePill.data('mrp')) || unitPrice;
      const $priceEl = $card.find('.product-price');

      if (mrpPrice > unitPrice) {
        $priceEl.html(`₹${(unitPrice * currentQty).toFixed(0)} <del style="font-size:14px;color:#999;">₹${(mrpPrice * currentQty).toFixed(0)}</del>`);
      } else {
        $priceEl.text('₹' + (unitPrice * currentQty).toFixed(0));
      }
    }
  });

  /* --- PRODUCT IMAGE GALLERY LOGIC --- */
  $(document).on('click', '.thumbnail-item', function () {
    const newSrc = $(this).find('img').attr('src');
    const $gallery = $(this).closest('.custom-image-gallery');

    // Update main image source
    $gallery.find('#main-product-image').attr('src', newSrc);

    // Update active thumbnail state
    $gallery.find('.thumbnail-item').removeClass('active');
    $(this).addClass('active');
  });
});
