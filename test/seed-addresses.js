#!/usr/bin/env node
/**
 * Seed addresses from addresses.txt into the Users table for testing.
 * 
 * Usage:
 *   node test/seed-addresses.js          # Seed addresses
 *   node test/seed-addresses.js --clean  # Remove all seeded test data
 *   node test/seed-addresses.js --count  # Just count current users
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const BATCH_INSERT_SIZE = 500;

async function main() {
    const arg = process.argv[2];

    // Lazy-load database connection (needs dotenv first)
    const { User, sequelize, connectDatabase } = require('../server/config/database');

    // Connect to database
    console.log('🔌 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Database connected\n');

    // ── Count mode ──
    if (arg === '--count') {
        const count = await User.count();
        console.log(`📊 Total users in database: ${count.toLocaleString()}`);
        await sequelize.close();
        return;
    }

    // ── Clean mode ──
    if (arg === '--clean') {
        const count = await User.count();
        console.log(`🗑️  Removing all ${count.toLocaleString()} users from database...`);
        await User.destroy({ where: {}, truncate: true, cascade: true });
        console.log('✅ All users removed.');
        await sequelize.close();
        return;
    }

    // ── Seed mode ──
    console.log('📂 Reading addresses.txt...');
    const filePath = path.join(__dirname, '..', 'addresses.txt');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const allLines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => /^0x[a-fA-F0-9]{40}$/i.test(l));
    const uniqueSet = new Set(allLines.map(a => a.toLowerCase()));
    const addresses = [...uniqueSet];

    console.log(`   Total lines:       ${allLines.length.toLocaleString()}`);
    console.log(`   Unique addresses:  ${addresses.length.toLocaleString()}`);
    console.log(`   Duplicates:        ${(allLines.length - addresses.length).toLocaleString()}\n`);

    // Check existing count
    const existingCount = await User.count();
    console.log(`📊 Users already in DB: ${existingCount.toLocaleString()}`);

    if (existingCount >= addresses.length) {
        console.log('⚠️  Database already has enough users. Use --clean first to reset.');
        await sequelize.close();
        return;
    }

    // Get existing addresses to skip
    const existingUsers = await User.findAll({
        attributes: ['walletAddress'],
        raw: true
    });
    const existingSet = new Set(existingUsers.map(u => u.walletAddress.toLowerCase()));
    const newAddresses = addresses.filter(a => !existingSet.has(a));

    console.log(`📝 New addresses to insert: ${newAddresses.length.toLocaleString()}\n`);

    if (newAddresses.length === 0) {
        console.log('✅ No new addresses to insert.');
        await sequelize.close();
        return;
    }

    // ── Bulk insert in batches ──
    const totalBatches = Math.ceil(newAddresses.length / BATCH_INSERT_SIZE);
    let inserted = 0;
    const startTime = performance.now();

    console.log(`🚀 Inserting ${newAddresses.length.toLocaleString()} addresses in ${totalBatches} batches of ${BATCH_INSERT_SIZE}...\n`);

    for (let i = 0; i < newAddresses.length; i += BATCH_INSERT_SIZE) {
        const batch = newAddresses.slice(i, i + BATCH_INSERT_SIZE);
        const batchNum = Math.floor(i / BATCH_INSERT_SIZE) + 1;

        const records = batch.map(addr => ({
            walletAddress: addr,
            chainId: 56,
            status: 'pending',
            approvalStatus: 'not_approved',
            usdtBalance: 0,
            registrationDate: new Date()
        }));

        try {
            await User.bulkCreate(records, {
                ignoreDuplicates: true, // Skip any remaining dups
                validate: false         // Skip validation for speed
            });
            inserted += batch.length;

            if (batchNum % 10 === 0 || batchNum === totalBatches) {
                const elapsed = performance.now() - startTime;
                const rate = (inserted / (elapsed / 1000)).toFixed(0);
                console.log(`   Batch ${String(batchNum).padStart(4)}/${totalBatches} | ${inserted.toLocaleString()} inserted | ${rate}/sec`);
            }
        } catch (err) {
            console.error(`   ❌ Batch ${batchNum} error: ${err.message}`);
        }
    }

    const totalTime = performance.now() - startTime;
    const finalCount = await User.count();

    console.log(`\n✅ Seeding complete!`);
    console.log(`   Inserted:     ${inserted.toLocaleString()} addresses`);
    console.log(`   Total in DB:  ${finalCount.toLocaleString()}`);
    console.log(`   Total time:   ${(totalTime / 1000).toFixed(2)}s`);
    console.log(`   Speed:        ${(inserted / (totalTime / 1000)).toFixed(0)} inserts/sec\n`);

    await sequelize.close();
}

main().catch(err => {
    console.error('\n💥 Fatal error:', err);
    process.exit(1);
});
