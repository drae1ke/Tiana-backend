require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('../models/Admin');
const Supplier = require('../models/Supplier');
const Product = require('../models/Product');
const connectDB = require('../config/database');

const seed = async () => {
  await connectDB();

  try {
    // ── Admin ──────────────────────────────────────────────────────────────
    const adminExists = await Admin.findOne({ username: process.env.ADMIN_USERNAME || 'admin' });
    if (!adminExists) {
      await Admin.create({
        username: process.env.ADMIN_USERNAME || 'admin',
        email: process.env.ADMIN_EMAIL || 'admin@agrovet.com',
        password: process.env.ADMIN_PASSWORD || 'Admin@123',
        role: 'admin',
      });
      console.log('✅ Admin user created');
    } else {
      console.log('ℹ️  Admin already exists, skipping.');
    }

    // ── Suppliers ─────────────────────────────────────────────────────────
    const supplierCount = await Supplier.countDocuments();
    if (supplierCount === 0) {
      const suppliers = await Supplier.insertMany([
        {
          name: 'Kenya Seed Company',
          phone: '+254722000001',
          email: 'sales@kenyaseed.co.ke',
          address: 'Kitale, Kenya',
          isTrusted: true,
          autoOrderEnabled: true,
        },
        {
          name: 'Twiga Chemicals',
          phone: '+254722000002',
          email: 'orders@twigachemicals.co.ke',
          address: 'Nairobi, Kenya',
          isTrusted: true,
          autoOrderEnabled: true,
        },
        {
          name: 'Highchem EA Ltd',
          phone: '+254722000003',
          email: 'info@highchem.co.ke',
          address: 'Mombasa, Kenya',
          isTrusted: false,
          autoOrderEnabled: false,
        },
      ]);
      console.log(`✅ ${suppliers.length} suppliers created`);

      // ── Products ──────────────────────────────────────────────────────────
      const productCount = await Product.countDocuments();
      if (productCount === 0) {
        const [ksc, twiga, highchem] = suppliers;
        await Product.insertMany([
          {
            name: 'Maize Seeds - DK 777', nameSwahili: 'Mbegu za Mahindi - DK 777',
            category: 'seeds', sku: 'SEED-001', quantity: 50, minStockLevel: 20,
            buyingPrice: 350, sellingPrice: 450,
            expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            batchNumber: 'B2024-001', supplierId: ksc._id,
          },
          {
            name: 'Bean Seeds - Rose Coco', nameSwahili: 'Mbegu za Maharage - Rose Coco',
            category: 'seeds', sku: 'SEED-002', quantity: 8, minStockLevel: 15,
            buyingPrice: 200, sellingPrice: 280,
            expiryDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
            batchNumber: 'B2024-002', supplierId: ksc._id,
          },
          {
            name: 'Tomato Seeds - Cal J', nameSwahili: 'Mbegu za Nyanya - Cal J',
            category: 'seeds', sku: 'SEED-003', quantity: 30, minStockLevel: 10,
            buyingPrice: 150, sellingPrice: 220,
            expiryDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            batchNumber: 'B2024-003', supplierId: ksc._id,
          },
          {
            name: 'DAP Fertilizer 50kg', nameSwahili: 'Mbolea ya DAP 50kg',
            category: 'fertilizers', sku: 'FERT-001', quantity: 25, minStockLevel: 10,
            buyingPrice: 4500, sellingPrice: 5200, supplierId: twiga._id,
          },
          {
            name: 'CAN Fertilizer 50kg', nameSwahili: 'Mbolea ya CAN 50kg',
            category: 'fertilizers', sku: 'FERT-002', quantity: 5, minStockLevel: 10,
            buyingPrice: 3800, sellingPrice: 4500, supplierId: twiga._id,
          },
          {
            name: 'Thunder OD 145 SC', nameSwahili: 'Dawa ya Wadudu Thunder',
            category: 'pesticides', sku: 'PEST-001', quantity: 40, minStockLevel: 15,
            buyingPrice: 1200, sellingPrice: 1500,
            expiryDate: new Date(Date.now() + 730 * 24 * 60 * 60 * 1000),
            batchNumber: 'B2024-P01', supplierId: twiga._id,
          },
          {
            name: 'Duduthrin 1.75 EC', nameSwahili: 'Dawa ya Wadudu Duduthrin',
            category: 'pesticides', sku: 'PEST-002', quantity: 3, minStockLevel: 10,
            buyingPrice: 800, sellingPrice: 1100,
            expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            batchNumber: 'B2024-P02', supplierId: twiga._id,
          },
          {
            name: 'Albendazole 10% - 100ml', nameSwahili: 'Dawa ya Minyoo Albendazole',
            category: 'veterinary', sku: 'VET-001', quantity: 35, minStockLevel: 15,
            buyingPrice: 450, sellingPrice: 600,
            expiryDate: new Date(Date.now() + 545 * 24 * 60 * 60 * 1000),
            batchNumber: 'B2024-V01', supplierId: highchem._id,
          },
          {
            name: 'Knapsack Sprayer 16L', nameSwahili: 'Kipuliziaji cha Mgongoni 16L',
            category: 'tools', sku: 'TOOL-001', quantity: 12, minStockLevel: 5,
            buyingPrice: 3500, sellingPrice: 4500, supplierId: highchem._id,
          },
          {
            name: 'Garden Hoe', nameSwahili: 'Jembe la Bustani',
            category: 'tools', sku: 'TOOL-002', quantity: 2, minStockLevel: 8,
            buyingPrice: 350, sellingPrice: 500, supplierId: highchem._id,
          },
        ]);
        console.log('✅ Sample products created');
      }
    } else {
      console.log('ℹ️  Suppliers already exist, skipping products seed.');
    }

    console.log('\n🌿 Database seeded successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  Admin username: ${process.env.ADMIN_USERNAME || 'admin'}`);
    console.log(`  Admin password: ${process.env.ADMIN_PASSWORD || 'Admin@123'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } catch (error) {
    console.error('❌ Seeding error:', error.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

seed();