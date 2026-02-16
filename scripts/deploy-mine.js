const hre = require("hardhat");

/**
 * Deployment Script for Mine Contract with UUPS Proxy
 * 
 * This script deploys the Mine contract using UUPS upgradeable pattern
 */

async function main() {
    console.log("🚀 Starting Mine Contract Deployment...\n");

    const [deployer] = await hre.ethers.getSigners();
    console.log("📍 Deploying from account:", deployer.address);
    console.log("💰 Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString(), "wei\n");

    // Contract parameters
    const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955"; // BSC Mainnet USDT
    const VAULT_ADDRESS = deployer.address; // Or specify a different vault address

    console.log("📝 Contract Parameters:");
    console.log("  - USDT Token:", USDT_ADDRESS);
    console.log("  - Vault Address:", VAULT_ADDRESS);
    console.log("  - Owner:", deployer.address);
    console.log();

    // Deploy Mine contract
    console.log("⏳ Deploying Mine contract...");
    const Mine = await hre.ethers.getContractFactory("Mine");

    const mine = await hre.upgrades.deployProxy(
        Mine,
        [deployer.address, USDT_ADDRESS, VAULT_ADDRESS],
        {
            initializer: 'initialize',
            kind: 'uups'
        }
    );

    await mine.waitForDeployment();
    const mineAddress = await mine.getAddress();

    console.log("✅ Mine contract deployed to:", mineAddress);
    console.log();

    // Verify deployment
    console.log("🔍 Verifying deployment...");
    const owner = await mine.owner();
    console.log("  - Contract Owner:", owner);
    console.log("  - Max Transfer Amount:", (await mine.maxTransferAmount()).toString());
    console.log();

    console.log("📋 Summary:");
    console.log("  - Mine Contract:", mineAddress);
    console.log("  - Implementation can be found via proxy admin");
    console.log();

    console.log("⚠️  IMPORTANT: Update your .env file with:");
    console.log(`  MINE_CONTRACT_ADDRESS=${mineAddress}`);
    console.log();

    console.log("✅ Deployment complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    });
