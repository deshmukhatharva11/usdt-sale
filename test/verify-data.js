const { User, sequelize } = require('../server/config/database');
const { Op } = require('sequelize');

async function verifyData() {
    try {
        console.log('🔌 Connecting to DB...');
        await sequelize.authenticate();

        // 1. Check Total Users
        const total = await User.count();
        console.log(`📊 Total Users: ${total.toLocaleString()}`);

        // 2. Check Users with Balance > 0
        const withBalance = await User.count({
            where: {
                usdtBalance: { [Op.gt]: 0 }
            }
        });
        console.log(`💰 Users with Balance > 0: ${withBalance.toLocaleString()}`);

        // 3. Check Top 10 Users (Sorting Verification)
        const topUsers = await User.findAll({
            attributes: ['walletAddress', 'usdtBalance'],
            order: [['usdtBalance', 'DESC']],
            limit: 10,
            raw: true
        });

        console.log('\n🏆 Top 10 Users by Balance (DB Sort Check):');
        console.table(topUsers);

        // 4. Check for logic gaps
        if (topUsers.length > 0) {
            const first = parseFloat(topUsers[0].usdtBalance);
            const last = parseFloat(topUsers[topUsers.length - 1].usdtBalance);
            if (first < last) {
                console.error('❌ SORTING ERROR: First user has less balance than last user in top 10!');
            } else {
                console.log('✅ Sorting is correct (Descending Order)');
            }
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await sequelize.close();
    }
}

verifyData();
