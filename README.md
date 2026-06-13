# MeatDae - Meat Delivery Web Application

MeatDae is a full-stack, logistics-enabled meat delivery platform designed with a mini Swiggy/Blinkit architecture. The project is structured to support customers, delivery riders, store managers, and system administrators through specialized portal views.

---

## 🏗️ Architecture & Directory Structure

The repository is organized into three major components:

*   **`customer/`**: The customer-facing web portal. Contains the homepage, product categories, detailed product views, shopping cart management, interactive MapTiler-based checkout maps, Razorpay/COD payment portals, and live order tracking.
*   **`staff/`**: The backend operational portal. Houses distinct sub-interfaces for:
    *   *Store Manager / Admin*: Full CRM/CMS analytics, ledger tracking, coupon management, and order staging.
    *   *Order Preparer*: Real-time order packaging checklists.
    *   *Delivery Rider*: Navigation routes, active delivery logs, and Cash on Delivery (COD) settlement.
*   **`functions/`**: Firebase Cloud Functions (Node.js v20) providing serverless API endpoints (such as Gemini-powered customer support bot, notifications, and mail services).
*   **`server.js`**: A lightweight local development server to serve the frontend portals concurrently.
*   **`seed_database.js`**: A database utility to seed the initial categories, products, and inventory stock inside Google Cloud Firestore.

---

## 🛠️ Technology Stack

*   **Frontend**: HTML5, Vanilla CSS3 (with premium transitions and responsiveness), Vanilla JavaScript.
*   **Backend & Serverless**: Firebase Cloud Functions (Node.js).
*   **Database**: Google Cloud Firestore (Security governed by `firestore.rules`).
*   **Authentication**: Firebase Auth (email/password & phone verification integration).
*   **Geospatial / Maps**: MapTiler SDK & Google Maps APIs.
*   **Local Routing & Log Server**: Express-based Node HTTP server.

---

## 🚀 Setup & Local Execution

Follow these steps to set up and run the MeatDae application locally:

### 1. Prerequisites
Ensure you have the following installed on your machine:
*   [Node.js](https://nodejs.org/) (version 18 or 20 recommended)
*   [Firebase CLI](https://firebase.google.com/docs/cli) (`npm install -g firebase-tools`)

### 2. Configure Firebase Environment
To connect the web portals to your Firebase project:
1.  Obtain your Firebase client configuration object from the Firebase Console.
2.  Update the Firebase configuration inside:
    *   [`customer/js/firebase-config.js`](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/customer/js/firebase-config.js)
    *   [`staff/js/firebase-config.js`](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/staff/js/firebase-config.js)
3.  Set up your MapTiler API key inside the corresponding layout scripts (`checkout_map.js`, `order_track.js`, etc.).

### 3. Initialize Cloud Functions
Navigate to the functions folder and install backend dependencies:
```bash
cd functions
npm install
```

### 4. Database Seeding
To populate Firestore with default products, category trees, and initial stocks:
1.  Download your Firebase service account private key JSON.
2.  Place it in the root directory and name it `meatdae-2nd-firebase-adminsdk-fbsvc-342bee6d2c.json` (or customize the path inside [`seed_database.js`](file:///c:/Users/Subhankar%20Roy/Downloads/MeatDae_New/seed_database.js)).
3.  Run the database seeder:
    ```bash
    node seed_database.js
    ```

### 5. Launch the Development Server
Start the local Express server from the root of the project:
```bash
node server.js
```
The server will boot on port `8888`:
*   **Customer Portal**: [http://localhost:8888/customer/index.html](http://localhost:8888/customer/index.html)
*   **Staff/Rider Portal**: [http://localhost:8888/staff/index.html](http://localhost:8888/staff/index.html)

---

## 🔒 Security & Credentials Note

> [!IMPORTANT]
> To prevent security leaks, all sensitive keys and local configs are excluded from the version control system.
> The root and function-level `.gitignore` files are pre-configured to ignore:
> *   `meatdae-2nd-firebase-adminsdk-fbsvc-342bee6d2c.json` (Service Account Keys)
> *   `.env` and `.env.local` files
> *   `node_modules/` folders
> *   Debug logs (`firebase-debug.log`, etc.)
> 
> Always make sure you do not bypass these ignore rules when committing changes.
