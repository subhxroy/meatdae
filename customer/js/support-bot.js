import { auth, db } from "./firebase-config.js";
import { doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { PRODUCTS_METADATA } from "./products-metadata.js";

const QA_DATA = [
    {
        questions: ["how fresh is the chicken", "freshness", "is it fresh", "fresh"],
        answer: "Same-day cut, never frozen. Full refund if the concern is genuine."
    },
    {
        questions: ["how is your quality better", "quality better", "better quality"],
        answer: "We handpick the healthiest birds from each batch and deliver them fresh; the rest are supplied to other business areas."
    },
    {
        questions: ["is your chicken broiler or local", "broiler or local", "broiler", "local"],
        answer: "We use carefully selected, healthy broiler chickens."
    },
    {
        questions: ["what if the chicken isn’t fresh", "not fresh", "not good", "quality issue"],
        answer: "We provide a refund after inspection."
    },
    {
        questions: ["why does delivery take up to 90 minutes", "90 minutes", "delivery time", "long time", "wait"],
        answer: "Orders are freshly prepared, cleaned, and packed after confirmation."
    },
    {
        questions: ["what’s in a 500g curry cut", "500g pieces", "500g content"],
        answer: "500g Pack: Juicy bone-in mixed pieces for curry (includes 1 leg piece)."
    },
    {
        questions: ["what’s in a 1kg curry cut", "1kg pieces", "1kg content"],
        answer: "1000g (1kg) Pack: Juicy bone-in mixed pieces for curry (includes 2 leg pieces)."
    },
    {
        questions: ["what’s in a 220g curry cut", "220g pieces", "220g content", "solo pack"],
        answer: "220g Pack: Juicy bone-in mixed pieces for curry (note: this pack does not include a leg piece)."
    },
    {
        questions: ["do you sell frozen chicken", "frozen chicken", "frozen", "cold storage"],
        answer: "No, only fresh chicken."
    },
    {
        questions: ["what if eggs are broken or spoiled", "broken eggs", "spoiled eggs", "egg replacement"],
        answer: "Contact us immediately for a quick resolution."
    },
    {
        questions: ["do you use preservatives or chemicals", "preservatives", "chemicals", "natural"],
        answer: "No, only natural fresh chicken."
    },
    {
        questions: ["why does the chicken feel chilled sometimes", "chilled", "cold chicken"],
        answer: "Light chilling is used to maintain freshness and hygiene; it is never frozen."
    },
    {
        questions: ["is the chicken halal", "halal"],
        answer: "No, it is not halal."
    },
    {
        questions: ["how do you decide pricing", "pricing", "cost", "market rate"],
        answer: "Prices follow current market rates."
    },
    {
        questions: ["what is the white substance on chicken", "white substance", "white stuff", "white mark"],
        answer: "It is natural fat or protein—completely safe and it also enhances taste."
    },
    {
        questions: ["how many pieces in 1kg biryani cut", "1kg biryani", "biryani pieces"],
        answer: "Around 13 pieces."
    },
    {
        questions: ["how many pieces in 500g leg cut", "500g leg", "leg pieces"],
        answer: "About 4–6 pieces."
    },
    {
        questions: ["do you deliver on sundays", "sunday delivery", "holiday delivery"],
        answer: "Yes, we deliver 7 days a week from 8 AM to 8 PM."
    },
    {
        questions: ["is delivery free", "delivery charge", "shipping cost"],
        answer: "Delivery is free for orders above ₹350. Otherwise, a standard charge of ₹11–20 applies depending on your location."
    },
    {
        questions: ["can i cancel my order", "cancellation", "cancel order"],
        answer: "You can cancel your order anytime before it is marked as 'OUT_FOR_DELIVERY'. Please contact our support for assistance."
    },
    {
        questions: ["bulk orders", "wholesale", "party", "catering"],
        answer: "We support bulk orders for parties and events. Please contact us 24 hours in advance at +91 70025 68330."
    },
    {
        questions: ["how should i store the chicken and eggs", "storage", "store", "shelf life"],
        answer: "Keep the chicken in the fridge (0–4°C) and use within 24–48 hours, or freeze it to store longer. Eggs are best kept in their carton inside the chiller."
    }
];

const DEFAULT_ANSWER = "I'm sorry, I'm having a bit of trouble connecting to my brain right now. Please try again in a moment or call our support at +91 70025 68330.";

// Rate Limiting Config
const RATE_LIMIT_MS = 60000; // 1 minute
const MAX_MESSAGES_PER_PERIOD = 5;


// Dynamically generate quick questions from the first trigger of each QA_DATA entry
const QUICK_QUESTIONS = QA_DATA.map(item => {
    const q = item.questions[0];
    // Capitalize first letter for UI consistency
    return q.charAt(0).toUpperCase() + q.slice(1) + (q.endsWith('?') ? '' : '?');
});


function scrollToBottom(force = false) {
    const chatBody = document.getElementById('chat-body');
    if (!chatBody) return;

    const isAtBottom = (chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight) < 100;

    if (force || isAtBottom) {
        chatBody.scrollTo({
            top: chatBody.scrollHeight,
            behavior: 'smooth'
        });
    }
}

function appendMessage(text, isUser = false) {
    const chatBody = document.getElementById('chat-body');
    if (!chatBody) return;

    const row = document.createElement('div');
    row.className = `chat-message-row ${isUser ? 'user' : 'bot'}`;

    if (!isUser) {
        const avatar = document.createElement('div');
        avatar.className = 'bot-avatar animated fadeInUp';
        avatar.innerHTML = '<i class="fas fa-utensils"></i>';
        row.appendChild(avatar);
    }

    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${isUser ? 'user-message' : 'bot-message shadow-sm'} animated fadeIn`;
    // Supports multi-line and basic formatting
    msgDiv.innerHTML = text.replace(/\n/g, '<br>');
    row.appendChild(msgDiv);

    chatBody.appendChild(row);
    scrollToBottom(isUser);
}


function renderQuickActions() {
    const chatBody = document.getElementById('chat-body');
    if (!chatBody) return;

    // Remove old ones
    const existing = chatBody.querySelector('.quick-actions-section');
    if (existing) existing.remove();

    const section = document.createElement('div');
    section.className = 'quick-actions-section animated fadeInUp';

    const title = document.createElement('h7');
    title.textContent = 'QUICK ACTIONS';
    section.appendChild(title);

    const questionsContainer = document.createElement('div');
    questionsContainer.className = 'suggested-questions';

    QUICK_QUESTIONS.forEach(q => {
        const chip = document.createElement('div');
        chip.className = 'suggested-chip';
        chip.textContent = q;
        chip.onclick = () => window.sendMessage(q);
        questionsContainer.appendChild(chip);
    });

    section.appendChild(questionsContainer);
    chatBody.appendChild(section);
    scrollToBottom();
}



window.toggleChat = function () {
    const chatModal = document.getElementById('support-chat-modal');
    if (chatModal) {
        const isHidden = chatModal.style.display === 'none' || chatModal.style.display === '';
        chatModal.style.display = isHidden ? 'flex' : 'none';

        // Prevent background scrolling when chat is open
        document.body.style.overflow = isHidden ? 'hidden' : '';

        if (!isHidden) {
            // Close menu if open when closing chat
            const menu = document.getElementById('chat-menu-dropdown');
            if (menu) menu.remove();
        }

        if (isHidden) {
            document.getElementById('chat-input').focus();
            const chatBody = document.getElementById('chat-body');

            if (chatBody && !chatBody.querySelector('.date-separator')) {
                initChat();
            }
        }
    }
};

// Context fetching moved below for better organization

async function initChat() {
    const chatBody = document.getElementById('chat-body');
    if (!chatBody) return;

    chatBody.innerHTML = '';

    // Add Today Separator
    const dateSep = document.createElement('div');
    dateSep.className = 'date-separator';
    dateSep.innerHTML = '<span>TODAY</span>';
    chatBody.appendChild(dateSep);

    const { userData } = await getContextData();
    const name = userData.name || userData.displayName || "there";

    // Initial Welcome Flow
    setTimeout(() => {
        appendMessage(`Hello ${name}! 🍗 I'm the MeatDae assistant. I'm here to help you get the freshest meat in town! How can I help you today?`, false);

        setTimeout(() => {
            renderQuickActions();
        }, 600);
    }, 400);
}



window.toggleChatMenu = function () {
    const header = document.querySelector('.chat-header');
    let menu = document.getElementById('chat-menu-dropdown');

    if (menu) {
        menu.remove();
        return;
    }

    menu = document.createElement('div');
    menu.id = 'chat-menu-dropdown';
    menu.className = 'chat-menu-dropdown animated fadeIn';
    menu.innerHTML = `
        <div class="menu-item" onclick="clearChat()"><i class="fas fa-trash-alt"></i> Clear Chat</div>
        <div class="menu-item" onclick="window.location.href='tel:+917002568330'"><i class="fas fa-phone-alt"></i> Call Support</div>
    `;

    document.getElementById('support-chat-modal').appendChild(menu);

    // Close menu when clicking outside
    const closeMenu = (e) => {
        if (!menu.contains(e.target) && !e.target.closest('.chat-menu')) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 10);
};

window.clearChat = function () {
    const chatBody = document.getElementById('chat-body');
    if (chatBody) {
        chatBody.innerHTML = '';
        initChat();
    }
    const menu = document.getElementById('chat-menu-dropdown');
    if (menu) menu.remove();
};

/**
 * Rate Limiter Logic
 * Prevents API abuse by tracking timestamps in localStorage
 */
async function getContextData() {
    const user = auth.currentUser;
    let userData = { name: "Guest" };
    let cartItems = [];
    let inventory = {};

    try {
        // Fetch inventory for pricing
        const invSnap = await getDocs(collection(db, "inventory"));
        invSnap.forEach(doc => {
            inventory[doc.id.toLowerCase().trim()] = doc.data();
        });

        if (user) {
            const userRef = doc(db, "users", user.uid);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
                userData = userSnap.data();
            }

            const cartRef = collection(db, "carts", user.uid, "items");
            const cartSnap = await getDocs(cartRef);
            cartItems = cartSnap.docs.map(doc => doc.data());
        } else {
            cartItems = JSON.parse(localStorage.getItem('guestCart') || '[]');
        }
    } catch (error) {
        console.error("Error fetching context for bot:", error);
    }

    return { userData, cartItems, inventory };
}

window.sendMessage = async function (directText = null) {
    const input = document.getElementById('chat-input');
    const text = directText || input.value.trim();
    if (!text) return;

    // Remove quick actions on user interaction
    const existingActions = document.querySelector('.quick-actions-section');
    if (existingActions) existingActions.remove();

    appendMessage(text, true);
    if (!directText) input.value = '';

    // Show Typing indicator
    const chatBody = document.getElementById('chat-body');
    const typingRow = document.createElement('div');
    typingRow.className = 'chat-message-row bot';
    typingRow.id = 'bot-typing-indicator';
    typingRow.innerHTML = `
        <div class="bot-avatar"><i class="fas fa-utensils"></i></div>
        <div class="typing-indicator animated pulse infinite">Typing...</div>
    `;
    chatBody.appendChild(typingRow);
    scrollToBottom(true);

    try {
        const aiResponse = await callGeminiAPI(text);
        removeTyping();

        // Parse Actions
        let cleanResponse = aiResponse;
        const actionMatch = aiResponse.match(/\[ACTION:\s*([A-Z_]+)\s*(.*?)\]/);

        if (actionMatch) {
            const actionType = actionMatch[1];
            const actionDataRaw = actionMatch[2].trim();
            cleanResponse = aiResponse.replace(actionMatch[0], '').trim();

            appendMessage(cleanResponse, false);
            handleBotAction(actionType, actionDataRaw);
        } else {
            appendMessage(aiResponse, false);
        }

    } catch (error) {
        console.error("Gemini API Error:", error);
        removeTyping();
        const localResponse = getLocalResponse(text);
        appendMessage(localResponse || DEFAULT_ANSWER, false);
    }

    postResponseActions();
};

async function handleBotAction(type, dataRaw) {
    console.log("[BotAction]", type, dataRaw);
    try {
        if (type === 'ADD_TO_CART') {
            const data = JSON.parse(dataRaw);
            const { userData, inventory } = await getContextData();

            // Find product in metadata for images/etc.
            const productMeta = PRODUCTS_METADATA[data.id];
            const invData = inventory[productMeta?.name?.toLowerCase().trim()];

            if (productMeta && invData) {
                const size = data.size || "500g";
                const isLarge = size.includes('1kg') || size.includes('1000g') || size.includes('60');
                const price = isLarge ? (invData.price_large || invData.price_small) : invData.price_small;
                const mrp = isLarge ? (invData.mrp_large || invData.mrp_small || price) : (invData.mrp_small || price);

                if (window.addToCart) {
                    await window.addToCart(productMeta.name, price, mrp, size, productMeta.images[0], 1);
                    appendMessage(`✅ Done! I've added **${productMeta.name} (${size})** to your cart. Anything else you're craving?`, false);
                }
            } else {
                appendMessage("Oops! I couldn't find that exact product in my kitchen. Could you please specify which one you'd like?", false);
            }
        } else if (type === 'GO_TO_CHECKOUT') {
            appendMessage("Taking you to the checkout counter! 🏃💨", false);
            setTimeout(() => window.location.href = 'cart_view.html', 1500);
        }
    } catch (e) {
        console.error("Action error:", e);
    }
}

function removeTyping() {
    const el = document.getElementById('bot-typing-indicator');
    if (el) el.remove();
}

function postResponseActions() {
    setTimeout(() => {
        renderQuickActions();
    }, 1000);
}

async function callGeminiAPI(userQuery) {
    const { userData, cartItems } = await getContextData();
    const productsContext = Object.values(PRODUCTS_METADATA).map(p => `- ${p.name}: ${p.shortDescription}`).join('\n');
    const cartContext = cartItems.length > 0
        ? cartItems.map(i => `${i.quantity}x ${i.name} (${i.weight})`).join(', ')
        : "Empty";

    const systemPrompt = `You are the official MeatDae AI Assistant. 
    MeatDae delivers premium, fresh (never frozen) chicken, eggs, and mutton in Cachar (Silchar area).
    
    TONE: Super friendly, witty, and HUMOROUS. Use meat puns (e.g., "Nice to MEAT you!", "You're RARE!"). 
    Keep it energetic and brand-aligned 🍗🥩🔥.
    
    USER INFO:
    - Name: ${userData.name || "Customer"}
    - Email: ${userData.email || "Not logged in"}
    - Current Cart: ${cartContext}
    
    AVAILABLE PRODUCTS:
    ${productsContext}
    
    CORE BUSINESS FACTS (Never hallucinate these):
    1. FRESHNESS: Same-day cut, delivered fresh. Never frozen.
    2. HALAL: IMPORTANT - MeatDae NOT halal. Always state this clearly if asked.
    3. PREP TIME: Delivery can take up to 90 mins because we cut and clean ONLY after order confirmation.
    4. PRICING: Market-linked, live in the app.
    5. DELIVERY: Free on orders above ₹350. Standard charge ₹11-15 otherwise.
    6. LOCATION: Based in New Market, Silchar, Cachar.
    
    ORDERING FLOW:
    If a user wants to order, guide them:
    1. Ask for the product name.
    2. Ask for weight/size. For Fresh Chicken Curry Cut, we have:
       - 220g: Juicy bone-in mixed pieces (no leg piece).
       - 500g: Juicy bone-in mixed pieces (1 leg piece).
       - 1000g (1kg): Juicy bone-in mixed pieces (2 leg pieces).
    3. Confirm delivery details.
    
    If you want to trigger an action, end your message with: [ACTION: ADD_TO_CART { "id": "product-id", "size": "500g" }] 
    or [ACTION: GO_TO_CHECKOUT].
    
    TASK: Answer the user's question with a dash of humor. Be helpful and personal.
    
    User Question: ${userQuery}`;

    // Use local emulator if running locally, otherwise use production Cloud Function.
    // If the local emulator is not running, gracefully fall back to production.
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const LOCAL_URL = 'http://127.0.0.1:5001/meatdae-2nd/us-central1/askGeminiBot';
    const PROD_URL = 'https://us-central1-meatdae-2nd.cloudfunctions.net/askGeminiBot';

    let response;
    let fallbackToProd = false;

    if (isLocal) {
        try {
            console.log("[SupportBot] Attempting to connect to local emulator...");
            response = await fetch(LOCAL_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ systemPrompt })
            });
        } catch (err) {
            console.warn("[SupportBot] Local emulator is not running. Falling back to production Cloud Function...", err);
            fallbackToProd = true;
        }
    }

    if (!response || fallbackToProd) {
        response = await fetch(PROD_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ systemPrompt })
        });
    }

    if (!response.ok) {
        const errorData = await response.json();
        console.error("Gemini API Full Error response:", errorData);
        throw new Error(errorData.error?.message || "API call failed");
    }

    const data = await response.json();
    if (data.reply) {
        return data.reply;
    }
    throw new Error("Invalid response format from Gemini");
}


// Internal health check for confidence
function getLocalConfidence(userMessage) {
    const lowerMessage = userMessage.toLowerCase().trim();
    let highestScore = 0;
    for (const item of QA_DATA) {
        for (const questionTemplate of item.questions) {
            const template = questionTemplate.toLowerCase().trim();
            if (lowerMessage === template) return 100;
            if (lowerMessage.includes(template)) {
                highestScore = Math.max(highestScore, 60);
            }
        }
    }
    return highestScore;
}


function getLocalResponse(userMessage) {
    const lowerMessage = userMessage.toLowerCase().trim();
    if (!lowerMessage) return DEFAULT_ANSWER;

    let bestMatch = null;
    let highestScore = 0;

    for (const item of QA_DATA) {
        for (const questionTemplate of item.questions) {
            const template = questionTemplate.toLowerCase().trim();
            let currentScore = 0;

            // 1. Exact Match (Highest Priority)
            if (lowerMessage === template) {
                currentScore = 100;
            }
            // 2. Full Template Phrase contained in message
            else if (lowerMessage.includes(template)) {
                currentScore = 50 + template.length;
            }
            // 3. Individual Keyword overlap
            else {
                const templateKeywords = template.split(/\s+/).filter(k => k.length > 2);
                if (templateKeywords.length > 0) {
                    let matchCount = 0;
                    templateKeywords.forEach(kw => {
                        if (lowerMessage.includes(kw)) matchCount++;
                    });

                    // Score based on density
                    currentScore = (matchCount / templateKeywords.length) * 10;

                    // Bonus for multiple word matches
                    if (matchCount > 1) currentScore += 5;
                }
            }

            if (currentScore > highestScore) {
                highestScore = currentScore;
                bestMatch = item.answer;
            }
        }
    }

    // Threshold to prevent random word hits
    if (highestScore < 3) return DEFAULT_ANSWER;

    return bestMatch || DEFAULT_ANSWER;
}

function setupEventListeners() {
    const input = document.getElementById('chat-input');
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') window.sendMessage();
        });
    }

    // Close chat on ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const chatModal = document.getElementById('support-chat-modal');
            if (chatModal && chatModal.style.display !== 'none' && chatModal.style.display !== '') {
                window.toggleChat();
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', setupEventListeners);
window.addEventListener('componentsLoaded', setupEventListeners);


