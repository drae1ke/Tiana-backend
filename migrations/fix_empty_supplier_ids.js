/**
 * Migration: Fix products with empty supplierId (convert to null)
 * 
 * Problem: Some products have empty strings ("") for supplierId, which causes
 * ObjectId casting errors when trying to populate the supplier reference.
 * 
 * Solution: Convert all empty supplierId values to null
 */

const mongoose = require('mongoose');
const Product = require('../models/Product');
require('dotenv').config();

async function runMigration() {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/agrovet');
    console.log('✓ Connected to database');

    // Find and update products with empty supplierId
    const result = await Product.updateMany(
      { supplierId: '' },
      { $set: { supplierId: null } }
    );

    console.log(`✓ Migration complete`);
    console.log(`  - Matched: ${result.matchedCount} documents`);
    console.log(`  - Modified: ${result.modifiedCount} documents`);

    // Verify the fix
    const remaining = await Product.countDocuments({ supplierId: '' });
    console.log(`✓ Verification: ${remaining} products still have empty supplierId`);

    if (remaining === 0) {
      console.log('✓ All products fixed successfully!');
    }

    process.exit(0);
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    process.exit(1);
  }
}

// Run the migration
runMigration();
