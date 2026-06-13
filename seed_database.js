// seed_database.js
// Standalone Node.js script to seed the Firestore database for meatdae-2nd.
// Uses firebase-admin SDK dependencies from the functions folder for ease of execution.

const fs = require('fs');
const path = require('path');

// Add functions/node_modules to resolve dependencies without root installation
module.paths.push(path.join(__dirname, 'functions', 'node_modules'));

const admin = require('firebase-admin');

// 1. Authentication and Initialization
let serviceAccountPath = path.join(__dirname, 'meatdae-2nd-firebase-adminsdk-fbsvc-342bee6d2c.json');
if (!fs.existsSync(serviceAccountPath)) {
    serviceAccountPath = path.join(__dirname, 'service-account.json');
}
if (!fs.existsSync(serviceAccountPath)) {
    serviceAccountPath = path.join(__dirname, 'functions', 'service-account.json');
}

if (fs.existsSync(serviceAccountPath)) {
    console.log(`[INFO] Found service account key at ${serviceAccountPath}. Initializing cert credential...`);
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} else {
    console.log('[INFO] No service-account.json found. Initializing default app credentials...');
    try {
        admin.initializeApp({
            projectId: 'meatdae-2nd'
        });
    } catch (e) {
        console.error('[ERROR] Failed to initialize Firebase Admin SDK. Please download a service-account.json key from the Firebase Console (Project Settings > Service Accounts), name it "service-account.json", place it in the root directory, and try again.');
        process.exit(1);
    }
}

const db = admin.firestore();

// 2. Data Definition
const standardInventory = [
    {
        name: "Fresh Chicken Curry Cut",
        price_small: 140,
        mrp_small: 170,
        small: true,
        price_large: 260,
        mrp_large: 310,
        large: true,
        price_solo: 70,
        mrp_solo: 90,
        solo: true,
        category: "chicken"
    },
    {
        name: "Fresh Chicken Boneless Cut",
        price_small: 180,
        mrp_small: 220,
        small: true,
        price_large: 340,
        mrp_large: 400,
        large: true,
        category: "chicken"
    },
    {
        name: "Fresh Chicken Legs Cut",
        price_small: 160,
        mrp_small: 190,
        small: true,
        price_large: 300,
        mrp_large: 350,
        large: true,
        category: "chicken"
    },
    {
        name: "Fresh Chicken Breast Cuts",
        price_small: 170,
        mrp_small: 200,
        small: true,
        price_large: 320,
        mrp_large: 380,
        large: true,
        category: "chicken"
    },
    {
        name: "Fresh Clean Gizzard Liver",
        price_small: 90,
        mrp_small: 110,
        small: true,
        price_large: 170,
        mrp_large: 200,
        large: true,
        category: "chicken"
    },
    {
        name: "Fresh Big Eggs",
        price_small: 210, // 30 eggs
        mrp_small: 240,
        small: true,
        price_large: 400, // 60 eggs
        mrp_large: 460,
        large: true,
        category: "eggs"
    },
    {
        name: "Fresh Local Duck Eggs",
        price_small: 150, // 15 eggs
        mrp_small: 180,
        small: true,
        price_large: 280, // 30 eggs
        mrp_large: 330,
        large: true,
        category: "eggs"
    },
    {
        name: "Fresh Chicken Biriyani Cuts",
        price_small: 150,
        mrp_small: 180,
        small: true,
        price_large: 280,
        mrp_large: 330,
        large: true,
        category: "chicken"
    },
    {
        name: "Fresh Chicken Boneless Keema",
        price_small: 190,
        mrp_small: 230,
        small: true,
        price_large: 360,
        mrp_large: 420,
        large: true,
        category: "chicken"
    },
    {
        name: "Fresh Chicken Wings",
        price_small: 130,
        mrp_small: 160,
        small: true,
        price_large: 240,
        mrp_large: 290,
        large: true,
        category: "chicken"
    },
    {
        name: "Pure Mutton Curry Cuts",
        price_small: 390,
        mrp_small: 450,
        small: true,
        price_large: 760,
        mrp_large: 850,
        large: true,
        category: "mutton"
    }
];

const cartAddons = {
    big_eggs_price: 75,
    local_duck_eggs_price: 110,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
};

async function seed() {
    console.log('[INFO] Seeding database...');

    // 1. Seed Inventory
    for (const item of standardInventory) {
        const docRef = db.collection('inventory').doc(item.name);
        await docRef.set({
            ...item,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        console.log(`[SUCCESS] Seeded product: ${item.name}`);
    }

    // 2. Seed Cart Addons
    const addonsRef = db.collection('inventory').doc('cart_addons');
    await addonsRef.set(cartAddons, { merge: true });
    console.log('[SUCCESS] Seeded cart addons');

    // 3. Seed Order Counter
    const counterRef = db.collection('metadata').doc('order_counter');
    const counterDoc = await counterRef.get();
    if (!counterDoc.exists) {
        await counterRef.set({ count: 1000 });
        console.log('[SUCCESS] Seeded order counter with starting value 1000');
    } else {
        console.log(`[INFO] Order counter already exists with count: ${counterDoc.data().count}`);
    }

    console.log('[SUCCESS] Database seeding completed successfully!');
}

seed().catch(err => {
    console.error('[ERROR] Seeding failed:', err);
    process.exit(1);
});
