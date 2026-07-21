const functions = require("firebase-functions");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

// Load local .env file manually to override stale GCP environment variables
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split(/\r?\n/).forEach(line => {
    const parts = line.split("=");
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join("=").trim().replace(/^["']|["']$/g, "");
      if (key) {
        process.env[key] = val;
      }
    }
  });
}

admin.initializeApp();

function getTransporter() {
  console.log("SMTP Config: User =", process.env.GMAIL_USER, "| Pass Length =", process.env.GMAIL_APP_PASSWORD ? process.env.GMAIL_APP_PASSWORD.length : 0);
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

exports.sendNewOrderEmail = functions.firestore
  .document("orders/{orderId}")
  .onCreate(async (snap, context) => {
    // Force redeploy to update environment variables - 2026-07-18
    const order = snap.data();
    const orderId = context.params.orderId;

    // Generate items table
    let itemsHtml = "";
    if (order.items && order.items.length > 0) {
      itemsHtml = `
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <thead>
            <tr style="background: #f8f9fa; border-bottom: 2px solid #ff7c08;">
              <th style="padding: 10px; text-align: left;">Item</th>
              <th style="padding: 10px; text-align: right;">Qty</th>
              <th style="padding: 10px; text-align: right;">Price</th>
            </tr>
          </thead>
          <tbody>
      `;
      order.items.forEach((item) => {
        itemsHtml += `
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px;">${item.name} <br><small style="color: #666;">${item.weight || ""}</small></td>
            <td style="padding: 10px; text-align: right;">${item.quantity}</td>
            <td style="padding: 10px; text-align: right;">₹${item.price}</td>
          </tr>
        `;
      });
      itemsHtml += `</tbody></table>`;
    }

    const mailOptions = {
      from: `MeatDae <${process.env.GMAIL_USER}>`,
      to: process.env.ADMIN_EMAIL || "contact.meatdae@gmail.com",
      subject: `New Order Received: ${order.orderId || orderId}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #ff7c08;">New Order Received</h2>
          <p><strong>Order ID:</strong> ${order.orderId || orderId}</p>
          <p><strong>Customer:</strong> ${order.customerName || "N/A"}</p>
          <p><strong>Phone:</strong> ${order.customerPhone || "N/A"}</p>
          <p><strong>Address:</strong> ${order.deliveryInfo?.address || order.address || "N/A"}</p>
          
          ${itemsHtml}
          
          <div style="text-align: right; font-size: 18px; font-weight: bold; color: #ff7c08; margin-bottom: 20px;">
            Total: ₹${order.totalAmount || order.total || "N/A"}
          </div>

          <p><strong>Status:</strong> <span style="background: #ffeee0; color: #ff7c08; padding: 4px 8px; border-radius: 4px; font-weight: bold;">${order.status || "PENDING_APPROVAL"}</span></p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <a href="https://admin.meatdae.com/admin_dashboard.html" style="background: #ff7c08; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">View in Dashboard</a>
        </div>
      `,
    };

    try {
      await getTransporter().sendMail(mailOptions);
      console.log("Admin email sent for order:", orderId);
    } catch (err) {
      console.error("Email send error:", err);
    }
  });

exports.sendStatusUpdateEmail = functions.firestore
  .document("orders/{orderId}")
  .onUpdate(async (change, context) => {
    // Force redeploy to update environment variables - 2026-07-18
    const before = change.before.data();
    const after = change.after.data();
    const orderId = context.params.orderId;

    // Only send email if status has changed
    if (before.status === after.status) return null;

    const customerEmail = after.customerEmail || after.userEmail;
    if (!customerEmail) {
      console.log("No customer email found for order:", orderId);
      return null;
    }

    let statusMessage = "";
    let subject = "";
    const status = after.status;

    switch (status) {
      case "PREPARING":
        subject = `Order Accepted: Your meat is being prepared! 🍖`;
        statusMessage = "Your order has been accepted and we are carefully preparing your fresh cuts.";
        break;
      case "OUT_FOR_DELIVERY":
        subject = `Out for Delivery: Your Order #${after.orderId || orderId} is on the way! 🛵`;
        statusMessage = "Great news! Your order is out for delivery and will reach you shortly.";
        break;
      case "DELIVERED":
        subject = `Order Delivered! Hope you enjoy your meal 😋`;
        statusMessage = "Your order has been successfully delivered. Please rate your experience!";
        break;
      case "CANCELLED":
        subject = `Order Cancelled: #${after.orderId || orderId}`;
        statusMessage = "We are sorry to inform you that your order has been cancelled. Any refund due will be processed shortly.";
        break;
      default:
        return null;
    }

    const mailOptions = {
      from: `MeatDae <${process.env.GMAIL_USER}>`,
      to: customerEmail,
      subject: subject,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #ff7c08;">MeatDae Order Update</h2>
          <p>Hi ${after.customerName || "Customer"},</p>
          <p style="font-size: 16px; line-height: 1.5; color: #333;">${statusMessage}</p>
          
          <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0;"><strong>Order ID:</strong> ${after.orderId || orderId}</p>
            <p style="margin: 5px 0 0 0;"><strong>Status:</strong> <span style="color: #ff7c08; font-weight: bold;">${status}</span></p>
          </div>

          <p>Thank you for choosing MeatDae for your fresh meat needs!</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <div style="text-align: center;">
            <a href="https://meatdae.com/my_orders.html" style="background: #ff7c08; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">Track My Order</a>
          </div>
        </div>
      `,
    };

    try {
      await getTransporter().sendMail(mailOptions);
      console.log(`Status update email (${status}) sent to:`, customerEmail);
    } catch (err) {
      console.error("Status update email error:", err);
    }

    return null;
  });


 // ── NEW: Send review notification email to admin ──────────────────────────────
exports.sendReviewEmail = functions.firestore
  .document("reviewEmails/{docId}")
  .onCreate(async (snap, context) => {
    // Force redeploy to update environment variables - 2026-07-18
    const review = snap.data();
    const rating = review.rating || 0;
    const stars = "★".repeat(rating) + "☆".repeat(Math.max(0, 5 - rating));

    const emailHtml = `
      <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6;">
        <div style="background: linear-gradient(135deg, #ff7c08 0%, #ff9e44 100%); padding: 30px; border-radius: 15px 15px 0 0; text-align: center;">
          <h1 style="color: #fff; margin: 0; font-size: 24px;">New Feedback Received! ⭐</h1>
          <p style="color: rgba(255, 255, 255, 0.9); margin-top: 5px; font-size: 14px;">Review for Order ${review.orderId || "N/A"}</p>
        </div>
        
        <div style="background: #fff; padding: 30px; border: 1px solid #eee; border-top: none; border-radius: 0 0 15px 15px; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
          <!-- Star Rating Card -->
          <div style="background: #fff8f4; border: 1px solid #ffe0cc; border-radius: 12px; padding: 25px; text-align: center; margin-bottom: 25px;">
            <div style="font-size: 42px; color: #ffb300; margin-bottom: 5px; letter-spacing: 5px;">${stars}</div>
            <div style="font-size: 20px; font-weight: 700; color: #ff7c08;">${rating} Out of 5 Stars</div>
          </div>

          <!-- Comment Section -->
          <div style="margin-bottom: 30px;">
            <h3 style="font-size: 16px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 5px;">Customer Comment</h3>
            <div style="font-size: 16px; font-style: italic; color: #444; background: #fafafa; padding: 15px; border-radius: 8px; border-left: 4px solid #ff7c08;">
              "${review.comment || "The customer did not leave a written comment."}"
            </div>
          </div>

          <!-- Customer Details Table -->
          <h3 style="font-size: 16px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 5px;">Customer Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 10px 0; color: #777; width: 130px;">Name</td>
              <td style="padding: 10px 0; font-weight: 600;">${review.customerName || "N/A"}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; color: #777;">Email</td>
              <td style="padding: 10px 0;"><a href="mailto:${review.customerEmail}" style="color: #ff7c08; text-decoration: none;">${review.customerEmail || "N/A"}</a></td>
            </tr>
            <tr>
              <td style="padding: 10px 0; color: #777;">Phone</td>
              <td style="padding: 10px 0;">${review.customerPhone || "N/A"}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; color: #777;">Order Number</td>
              <td style="padding: 10px 0; font-family: monospace; font-weight: bold;">${review.orderId || "N/A"}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; color: #777;">User ID</td>
              <td style="padding: 10px 0; font-size: 11px; color: #999;">${review.userId || "N/A"}</td>
            </tr>
          </table>

          <div style="margin-top: 30px; text-align: center; font-size: 12px; color: #bbb;">
            <p>This review was automatically sent from the MeatDae feedback system.</p>
          </div>
        </div>
      </div>
    `;

    const mailOptions = {
      from: `MeatDae Feedback <${process.env.GMAIL_USER}>`,
      to: process.env.ADMIN_EMAIL || "contact.meatdae@gmail.com",
      subject: `⭐ New Review: ${rating}/5 from ${review.customerName || "Customer"}`,
      html: emailHtml,
    };

    try {
      await getTransporter().sendMail(mailOptions);
      console.log("[sendReviewEmail] Success: Admin email sent for order:", review.orderId);
    } catch (err) {
      console.error("[sendReviewEmail] Error sending email:", err);
    }
    return null;
  });

// ===============================================
// AI Support Bot Endpoint
// ===============================================
exports.askGeminiBot = functions
  .https
  .onRequest(async (req, res) => {
  // Set CORS headers for all domains
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const rawApiKey = process.env.GEMINI_API_KEY;
  const apiKey = rawApiKey ? rawApiKey.replace(/^["']|["']$/g, "") : null;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set in environment variables");
    res.status(500).json({ error: { message: "AI Assistant is currently unavailable due to server configuration." } });
    return;
  }

  try {
    const { userName, userEmail, cartContext, productsContext, userQuery } = req.body;
    
    if (!userQuery) {
      res.status(400).json({ error: { message: "Missing userQuery in request body." } });
      return;
    }

    const systemInstructions = `You are the official MeatDae AI Assistant. 
    MeatDae delivers premium, fresh (never frozen) chicken, eggs, and mutton in Cachar (Silchar area).
    
    TONE: Super friendly, witty, and HUMOROUS. Use meat puns (e.g., "Nice to MEAT you!", "You're RARE!"). 
    Keep it energetic and brand-aligned 🍗🥩🔥.
    
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
    
    TASK: Answer the user's question with a dash of humor. Be helpful and personal. Only answer questions related to MeatDae's services, meats, eggs, menu, operating hours, and ordering flow. If the user asks general or unrelated questions, decline to answer politely with a meat pun.`;

    const systemPrompt = `${systemInstructions}

    USER INFO:
    - Name: ${userName || "Customer"}
    - Email: ${userEmail || "Not logged in"}
    - Current Cart: ${cartContext || "Empty"}
    
    AVAILABLE PRODUCTS:
    ${productsContext || "N/A"}
    
    User Question: ${userQuery}`;

    const MODEL_ID = "gemini-1.5-flash";
    const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent?key=${apiKey}`;

    const response = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }] }]
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error("Gemini API Error:", data);
      res.status(500).json({ error: { message: data.error?.message || "Gemini API call failed" } });
      return;
    }
    
    if (data.candidates && data.candidates[0].content.parts[0].text) {
      res.status(200).json({ reply: data.candidates[0].content.parts[0].text });
    } else {
      res.status(500).json({ error: { message: "Invalid response format from Gemini" } });
    }
  } catch (error) {
    console.error("askGeminiBot execution error:", error);
    res.status(500).json({ error: { message: "Internal Server Error" } });
  }
});

// ===============================================
// Secure Order Placement & Payment Verification
// ===============================================
exports.placeOrderSecure = functions.https.onCall(async (data, context) => {
  // Force redeploy - 2026-07-15 11:42 PM
  // 1. Authenticate user
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be logged in to place an order.");
  }
  const uid = context.auth.uid;
  const { deliveryDetails, items, couponCode, paymentMethod, paymentId } = data;

  if (!deliveryDetails || !items || !Array.isArray(items) || items.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "Missing required order parameters.");
  }

  // 2. Fetch inventory and validate prices/stock
  const db = admin.firestore();
  const inventorySnap = await db.collection("inventory").get();
  const inventory = {};
  inventorySnap.forEach(doc => {
    inventory[doc.id.toLowerCase().trim()] = { id: doc.id, ...doc.data() };
  });

  let calculatedSubtotal = 0;
  const itemsForOrder = [];

  // Normalize helper
  const normalize = (name) => name.toLowerCase().trim().replace(/-/g, ' ').replace(/\s+/g, ' ');

  for (const item of items) {
    const normName = normalize(item.name).replace(/ cuts?$/i, '');
    let product = inventory[normName];
    if (!product) {
      // Check if it's a custom addon item and map to base product to avoid "not found in inventory" error
      if (normName.includes("pack") && (normName.includes("big eggs") || normName.includes("duck eggs"))) {
        const targetKey = normName.includes("big") ? "fresh big eggs" : "fresh local duck eggs";
        product = inventory[targetKey];
      }
    }

    if (!product) {
      // search fallback
      for (const key in inventory) {
        if (key.replace(/ cuts?$/i, '') === normName) {
          product = inventory[key];
          break;
        }
      }
    }

    if (!product) {
      throw new functions.https.HttpsError("not-found", `Item "${item.name}" not found in inventory.`);
    }

    // Check stock
    const cleanWeight = (item.weight || "").toLowerCase().replace(/\s+/g, '');
    let isOut = false;
    let price = 0;
    let mrp = 0;

    let isLarge = false;
    let isSmall = false;
    let isSolo = false;

    if (cleanWeight.includes('500g') || cleanWeight.includes('500gram')) isSmall = true;
    if (cleanWeight.includes('1kg') || cleanWeight.includes('1000g') || cleanWeight.includes('kilogram') || cleanWeight.includes('1000gram')) isLarge = true;
    if (cleanWeight.includes('220g') || cleanWeight.includes('220gram') || cleanWeight.includes('200g') || cleanWeight.includes('200gram') || cleanWeight.includes('legpiece') || cleanWeight.includes('legpieces') || cleanWeight.includes('solo')) isSolo = true;

    // Eggs - Big
    if (cleanWeight.includes('30eggs') && item.name.toLowerCase().includes('big')) isSmall = true;
    if (cleanWeight.includes('60eggs') && item.name.toLowerCase().includes('big')) isLarge = true;

    // Eggs - Duck
    if (cleanWeight.includes('15eggs') && item.name.toLowerCase().includes('duck')) isSmall = true;
    if (cleanWeight.includes('30eggs') && item.name.toLowerCase().includes('duck')) isLarge = true;

    if (isLarge) {
      if (product.large === false) isOut = true;
      price = Number(product.price_large || product.price || 0);
      mrp = Number(product.mrp_large || product.mrp || price);
    } else if (isSmall) {
      if (product.small === false) isOut = true;
      price = Number(product.price_small || product.price || 0);
      mrp = Number(product.mrp_small || product.mrp || price);
    } else {
      if (product.solo === false) isOut = true;
      price = Number(product.price_solo || product.price || 0);
      mrp = Number(product.mrp_solo || product.mrp || price);
    }

    // Check custom addon items if present
    if (normName.includes("pack") && (normName.includes("big eggs") || normName.includes("duck eggs"))) {
      const addons = inventory["cart_addons"];
      if (addons) {
        const isBig = normName.includes("big");
        price = isBig ? Number(addons.big_eggs_price || 0) : Number(addons.local_duck_eggs_price || 0);
        mrp = price;
        isOut = false;
      }
    }

    if (isOut) {
      throw new functions.https.HttpsError("failed-precondition", `Item "${item.name}" (${item.weight || 'Standard'}) is out of stock.`);
    }

    calculatedSubtotal += price * item.quantity;
    itemsForOrder.push({
      name: product.id || item.name,
      price: price,
      mrp: mrp,
      quantity: item.quantity,
      image: item.image || product.image || "",
      weight: item.weight || ""
    });
  }

  // 3. Validate Delivery Charge
  let deliveryCharge = 11; // Standard
  const pincode = deliveryDetails.pincode;
  const pincodesWith15Charge = ["788003", "788009", "788015", "788002"];
  if (pincodesWith15Charge.includes(pincode)) {
    deliveryCharge = 15;
  }
  const deliveryPricesByAddress = [
    { price: 15, keywords: ["meherpur", "mhrpur", "mehepur", "meherfur"] },
    { price: 15, keywords: ["rongpur", "rongpr", "rangpur"] },
    { price: 17, keywords: ["bagatpur", "bogotpur", "bakatpur", "bhagatpur", "bhagotpur", "bhakatpr", "bhogotpur", "bhakatpur", "bakapur"] },
    { price: 15, keywords: ["tarapur", "trapur", "tarfur", "tarpur"] },
    { price: 15, keywords: ["itkola", "itkhola", "etkhola", "itkala"] },
    { price: 17, keywords: ["kathal road", "kathol rd", "katal road", "kathal rd", "kathal rd ta"] },
    { price: 15, keywords: ["malugram", "malgram", "mallugram"] },
    { price: 20, keywords: ["suncity", "sunsity"] },
    { price: 17, keywords: ["ghaniwala", "ganiwala", "ghoniala", "ghoniwala"] },
    { price: 15, keywords: ["national highway", "national hw", "nh road", "nh bypass"] },
    { price: 15, keywords: ["2nd link road", "second link road", "2 link road", "2nd link rd", "2 link rd"] },
    { price: 20, keywords: ["green heals", "green hill", "green hills"] },
    { price: 20, keywords: ["valley hospital", "vally hospital"] },
    { price: 20, keywords: ["beltola"] },
    { price: 20, keywords: ["grace well"] },
    { price: 17, keywords: ["peshkar road", "peshkar lane", "peskar lane", "peshkar 17"] },
    { price: 17, keywords: ["maruti suzuki", "maruti suzuki 17"] },
    { price: 20, keywords: ["shibalik", "shibalik park", "shivalik", "shivalik park", "sivalik", "sivalik park"] },
    { price: 18, keywords: ["masimpur", "mashimpur", "masimpr", "mashimpr"] },
    { price: 18, keywords: ["tupkhana", "tupkana", "topkhana"] },
    { price: 20, keywords: ["silcoorie", "silcoori", "silcuri", "silcory"] },
    { price: 20, keywords: ["ghungoor", "gungoor", "ghungur", "gungur"] },
    { price: 25, keywords: ["udharbond", "udorbon", "udarbond", "udorband", "udarband"] },
    { price: 25, keywords: ["srikona", "shrikona", "srikuna"] },
    { price: 20, keywords: ["kabuganj", "kabuganj market"] }
  ];
  const addressText = (deliveryDetails.address || "").toLowerCase();
  let maxPriceDetected = 0;
  deliveryPricesByAddress.forEach(item => {
    const isMatched = item.keywords.some(kw => addressText.includes(kw));
    if (isMatched && item.price > maxPriceDetected) {
      maxPriceDetected = item.price;
    }
  });
  if (maxPriceDetected > 0) {
    deliveryCharge = maxPriceDetected;
  }

  // 3b. Extra delivery charge for 200g items and 2 leg piece solo packs (+₹7)
  let hasExtraChargeItem = items.some(item => {
    const weight = item.weight || "";
    const cleanWeight = weight.toLowerCase().replace(/\s+/g, '');
    return cleanWeight.includes('200g') || cleanWeight.includes('legpiece');
  });
  if (hasExtraChargeItem && deliveryCharge > 0) {
    deliveryCharge += 7;
  }

  // 3c. Final free delivery check (Orders >= ₹350)
  if (calculatedSubtotal >= 350) {
    deliveryCharge = 0;
  }


  // 4. Validate Coupon Discount
  let discountAmount = 0;
  if (couponCode && couponCode !== "None") {
    const code = couponCode.toUpperCase().trim();
    const coupons = { 'AQUALITY': 0.02, 'PLUSQUALITY': 0.02, 'APLUS': 0.02, 'HAPPY': 0.02, 'THANKS': 0.02, 'SAHIL': 0.02, 'MEAT10': 0.10 };
    if (coupons[code]) {
      discountAmount = calculatedSubtotal * coupons[code];
      if (discountAmount < 4) discountAmount = 4;
    }
  }

  const isOnlinePayment = paymentMethod.toLowerCase().includes('online');
  const onlineFee = isOnlinePayment ? 11 : 0;
  const finalTotal = calculatedSubtotal + deliveryCharge - discountAmount + onlineFee;

  // 5. Verify Razorpay Payment if online
  let paymentStatus = isOnlinePayment ? "Pending" : "Unpaid";
  if (isOnlinePayment) {
    if (!paymentId) {
      throw new functions.https.HttpsError("invalid-argument", "Payment ID is required for online payments.");
    }

    const keyId = process.env.RAZORPAY_KEY_ID || "rzp_live_TG5jXz4jsRuo3B";
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    
    if (keySecret) {
      try {
        const authHeader = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
        const response = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
          headers: { "Authorization": `Basic ${authHeader}` }
        });
        const paymentData = await response.json();
        
        if (!response.ok || (paymentData.status !== "captured" && paymentData.status !== "authorized")) {
          throw new functions.https.HttpsError("payment-required", "Razorpay payment verification failed.");
        }

        // Verify payment amount matches (Razorpay amount is in paise)
        const paidAmount = Number(paymentData.amount) / 100;
        if (Math.abs(paidAmount - finalTotal) > 5) { // allow 5 rupee threshold for rounding/fees
          throw new functions.https.HttpsError("payment-required", `Payment amount mismatch. Paid: ₹${paidAmount}, Expected: ₹${finalTotal}`);
        }
        paymentStatus = "Paid";
      } catch (err) {
        // Re-throw intentional HttpsErrors (e.g. payment status failed, amount mismatch)
        // so the correct error message reaches the client.
        if (err instanceof functions.https.HttpsError) {
          throw err;
        }
        // Only wrap unexpected runtime errors (network failure, JSON parse, etc.)
        console.error("Razorpay verification unexpected error:", err);
        throw new functions.https.HttpsError("internal", "Error verifying payment with Razorpay: " + (err.message || "Unknown"));
      }
    } else {
      console.warn("RAZORPAY_KEY_SECRET is not set. Skipping signature verification.");
      paymentStatus = "Paid";
    }
  }

  // 6. Write Order to Firestore in a Transaction
  let formattedOrderId;
  await db.runTransaction(async (transaction) => {
    const counterRef = db.collection("metadata").doc("order_counter");
    const counterDoc = await transaction.get(counterRef);

    let newCount = 1;
    if (counterDoc.exists) {
      newCount = counterDoc.data().count + 1;
      transaction.update(counterRef, { count: newCount });
    } else {
      transaction.set(counterRef, { count: newCount });
    }

    formattedOrderId = "#" + newCount.toString().padStart(4, "0");

    let deliveryLocation = data.deliveryLocation || null;
    const orderData = {
      orderId: formattedOrderId,
      userId: uid,
      customerName: deliveryDetails.name || '',
      customerEmail: deliveryDetails.email || '',
      customerPhone: deliveryDetails.phone || '',
      deliveryInfo: deliveryDetails,
      items: itemsForOrder,
      totalAmount: finalTotal,
      deliveryCharge: deliveryCharge,
      discountAmount: discountAmount,
      couponCode: couponCode || null,
      onlineFee: onlineFee,
      paymentMethod: paymentMethod,
      paymentStatus: paymentStatus,
      paymentId: paymentId || null,
      status: "PENDING_APPROVAL",
      riderId: null,
      riderLocation: null,
      deliveryLocation: deliveryLocation,
      specialInstructions: deliveryDetails.orderNotes || "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtLocal: new Date().toISOString()
    };

    const orderRef = db.collection("orders").doc(formattedOrderId);
    transaction.set(orderRef, orderData);
  });

  return { success: true, orderId: formattedOrderId };
});

// ===============================================
// Server-Side Firestore Trigger: Admin Notifications
// ===============================================
exports.createAdminNotification = functions.firestore
  .document("orders/{orderId}")
  .onCreate(async (snap, context) => {
    const order = snap.data();
    const orderId = context.params.orderId;
    const db = admin.firestore();

    const itemsSummary = (order.items || []).map(item => `${item.name} (${item.weight || 'Std'}) x${item.quantity}`).join(', ');

    try {
      await db.collection("admin_notifications").add({
        title: `New Order ${order.orderId || orderId}`,
        body: `Customer: ${order.customerName || 'N/A'} (${order.customerPhone || 'N/A'})\nAddress: ${order.deliveryInfo?.address || 'N/A'}, Pincode: ${order.deliveryInfo?.pincode || 'N/A'}\nItems: ${itemsSummary}\nTotal: ₹${order.totalAmount || '0'} (${order.paymentMethod || 'COD'})`,
        orderId: order.orderId || orderId,
        customerName: order.customerName || '',
        customerPhone: order.customerPhone || '',
        customerAddress: order.deliveryInfo?.address || '',
        itemsSummary: itemsSummary,
        totalAmount: order.totalAmount || 0,
        paymentMethod: order.paymentMethod || '',
        type: "NEW_ORDER",
        read: false,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log("Admin notification created securely on server for order:", orderId);
    } catch (err) {
      console.error("Error creating admin notification trigger:", err);
    }
  });
