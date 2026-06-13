const puppeteer = require('puppeteer');

(async () => {
    console.log("Starting browser...");
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    
    // Capture console logs from the browser
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', error => console.log('PAGE ERROR:', error.message));

    console.log("Navigating to sign_in.html...");
    await page.goto('http://localhost:8888/customer/sign_in.html', { waitUntil: 'domcontentloaded' });

    console.log("Filling in phone number...");
    await page.waitForSelector('#phone-number');
    await page.type('#phone-number', '9876543210');

    console.log("Clicking Send OTP...");
    await page.click('#send-otp-btn');

    console.log("Waiting 5 seconds for OTP request to fail...");
    await new Promise(r => setTimeout(r, 5000));
    
    console.log("Forcing showCustomAlert to see if it works...");
    await page.evaluate(() => {
        if (window.showCustomAlert) {
            window.showCustomAlert('Test Error Msg', 'Test Title', 'error');
        } else {
            console.log("window.showCustomAlert is undefined!");
        }
    });

    console.log("Waiting 1 second after force alert...");
    await new Promise(r => setTimeout(r, 1000));

    console.log("Checking popup content...");
    const popupData = await page.evaluate(() => {
        const popup = document.getElementById('custom-popup');
        if (!popup) return 'No #custom-popup found in DOM';
        
        const isVisible = popup.classList.contains('show') || window.getComputedStyle(popup).display !== 'none';
        const rect = popup.getBoundingClientRect();
        
        return {
            isVisible: isVisible,
            rect: rect,
            classList: Array.from(popup.classList),
            html: popup.outerHTML
        };
    });

    console.log("POPUP DATA:", JSON.stringify(popupData, null, 2));

    await browser.close();
})();
