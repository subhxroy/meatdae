// seed_database.js
// Standalone Node.js script to seed the Firestore database for meatdae-2nd.
// Uses firebase-admin SDK dependencies from the functions folder for ease of execution.

const fs = require('fs');
const path = require('path');

// Add functions/node_modules to resolve dependencies without root installation
module.paths.push(path.join(__dirname, 'functions', 'node_modules'));

const admin = require('firebase-admin');

// 1. Authentication and Initialization
let serviceAccountPath = null;

try {
    // Find service account JSON file dynamically in the root directory
    const filesInRoot = fs.readdirSync(__dirname);
    const serviceAccountFile = filesInRoot.find(file => 
        file.includes('-firebase-adminsdk-') && file.endsWith('.json')
    );

    if (serviceAccountFile) {
        serviceAccountPath = path.join(__dirname, serviceAccountFile);
    }
} catch (e) {
    console.warn('[INFO] Error scanning root directory for service account keys:', e.message);
}

if (!serviceAccountPath) {
    const possiblePaths = [
        path.join(__dirname, 'service-account.json'),
        path.join(__dirname, 'functions', 'service-account.json')
    ];
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            serviceAccountPath = p;
            break;
        }
    }
}

if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
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
        price_small: 169,
        mrp_small: 180,
        small: true,
        price_large: 338,
        mrp_large: 352,
        large: true,
        price_solo: 99,
        mrp_solo: 110,
        solo: true,
        category: "chicken"
    },
    {
        name: "Fresh Chicken Boneless",
        price_small: 209,
        mrp_small: 230,
        small: true,
        price_large: 418,
        mrp_large: 430,
        large: true,
        price_solo: 99,
        mrp_solo: 110,
        solo: true,
        category: "chicken"
    },
    {
        name: "Fresh Chicken Drumstick (Leg Piece)",
        price_small: 219,
        mrp_small: 240,
        small: true,
        price_large: 438,
        mrp_large: 350,
        large: true,
        price_solo: 124,
        mrp_solo: 135,
        solo: true,
        category: "chicken"
    },
    {
        name: "Fresh Chicken Breast",
        price_small: 219,
        mrp_small: 240,
        small: true,
        price_large: 438,
        mrp_large: 450,
        large: true,
        price_solo: 0,
        mrp_solo: 0,
        solo: true,
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
        price_solo: 0,
        mrp_solo: 0,
        solo: true,
        category: "chicken"
    },
    {
        name: "Fresh Big Eggs",
        price_small: 245, // 30 eggs
        mrp_small: 255,
        small: true,
        price_large: 0, // 60 eggs
        mrp_large: 460,
        large: true,
        category: "eggs"
    },
    {
        name: "Fresh Local Duck Eggs",
        price_small: 235, // 15 eggs
        mrp_small: 255,
        small: true,
        price_large: 470, // 30 eggs
        mrp_large: 490,
        large: true,
        category: "eggs"
    },
    {
        name: "Fresh Chicken Biriyani Cut",
        price_small: 175,
        mrp_small: 190,
        small: true,
        price_large: 349,
        mrp_large: 360,
        large: true,
        price_solo: 0,
        mrp_solo: 0,
        solo: true,
        category: "chicken"
    },
    {
        name: "Fresh Chicken Mince (Keema)",
        price_small: 219,
        mrp_small: 230,
        small: true,
        price_large: 438,
        mrp_large: 450,
        large: true,
        price_solo: 109,
        mrp_solo: 145,
        solo: true,
        category: "chicken"
    },
    {
        name: "Fresh Chicken Wings",
        price_small: 189,
        mrp_small: 200,
        small: true,
        price_large: 378,
        mrp_large: 390,
        large: true,
        price_solo: 99,
        mrp_solo: 0,
        solo: true,
        category: "chicken"
    },
    {
        name: "Pure Mutton Curry Cut",
        price_small: 0,
        mrp_small: 600,
        small: true,
        price_large: 0,
        mrp_large: 1200,
        large: true,
        price_solo: 0,
        mrp_solo: 0,
        solo: true,
        category: "mutton"
    }
];

const cartAddons = {
    big_eggs_price: 89,
    local_duck_eggs_price: 165,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
};

async function seed() {
    console.log('[INFO] Seeding database...');

    // 0. Clean up old product names to avoid duplicates in Firestore
    const oldProductNames = [
        "Fresh Chicken Legs Cut",
        "Fresh Chicken Legs Cuts",
        "Fresh Chicken Breast Cuts",
        "Fresh Chicken Boneless Cut",
        "Fresh Chicken Boneless Cuts",
        "Fresh Chicken Boneless Keema",
        "Fresh Chicken Curry Cuts",
        "Pure Mutton Curry Cuts",
        "Fresh Chicken Biriyani Cuts"
    ];
    for (const name of oldProductNames) {
        try {
            const docRef = db.collection('inventory').doc(name);
            await docRef.delete();
            console.log(`[SUCCESS] Deleted old product: ${name}`);
        } catch (e) {
            console.warn(`[WARN] Failed to delete old product ${name}:`, e.message);
        }
    }

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
