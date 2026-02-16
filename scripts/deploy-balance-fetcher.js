const hre = require("hardhat");

/**
 * Deployment Script for MineBalanceFetcher Contract
 */

async function main() {
    console.log("🚀 Starting MineBalanceFetcher Deployment...\n");

    const [deployer] = await hre.ethers.getSigners();
    console.log("📍 Deploying from account:", deployer.address);
    console.log("💰 Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString(), "wei\n");

    // Contract parameters
    const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955"; // BSC Mainnet USDT
    const MINE_CONTRACT_ADDRESS = process.env.MINE_CONTRACT_ADDRESS || "0x..."; // Update with deployed Mine address

    if (!MINE_CONTRACT_ADDRESS || MINE_CONTRACT_ADDRESS === "0x...") {
        console.error("❌ Error: MINE_CONTRACT_ADDRESS not set in .env");
        console.log("Please deploy Mine contract first and update .env file");
        process.exit(1);
    }

    console.log("📝 Contract Parameters:");
    console.log("  - USDT Token:", USDT_ADDRESS);
    console.log("  - Mine Contract:", MINE_CONTRACT_ADDRESS);
    console.log();

    // Deploy MineBalanceFetcher
    console.log("⏳ Deploying MineBalanceFetcher...");
    const MineBalanceFetcher = await hre.ethers.getContractFactory("MineBalanceFetcher");
    const balanceFetcher = await MineBalanceFetcher.deploy(USDT_ADDRESS, MINE_CONTRACT_ADDRESS);

    await balanceFetcher.waitForDeployment();
    const balanceFetcherAddress = await balanceFetcher.getAddress();

    console.log("✅ MineBalanceFetcher deployed to:", balanceFetcherAddress);
    console.log();

    // Verify deployment
    console.log("🔍 Verifying deployment...");
    const stats = await balanceFetcher.getStats();
    console.log("  - Registered Users:", stats[0].toString());
    console.log("  - USDT Token:", stats[2]);
    console.log("  - Mine Contract:", stats[3]);
    console.log();

    console.log("⚠️  IMPORTANT: Update your .env file with:");
    console.log(`  BALANCE_FETCHER_ADDRESS=${balanceFetcherAddress}`);
    console.log();

    console.log("✅ Deployment complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    });
