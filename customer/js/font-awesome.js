(function() {
    // Inject FontAwesome 6.7.2 CSS if not already present
    if (!document.querySelector('link[href*="font-awesome/6.7.2"]') && !document.querySelector('link[href*="cdnjs.cloudflare.com/ajax/libs/font-awesome"]')) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css';
        document.head.appendChild(link);
    }
})();
