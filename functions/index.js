const functions = require("firebase-functions");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();

function getTransporter() {
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
    const { systemPrompt } = req.body;
    
    if (!systemPrompt) {
      res.status(400).json({ error: { message: "Missing systemPrompt in request body." } });
      return;
    }

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
