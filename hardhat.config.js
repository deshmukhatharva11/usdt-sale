require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-ethers");
require("dotenv").config();

/**
 * Hardhat Configuration for BSC Deployment
 * 
 * Before deploying:
 * 1. Create a .env file with your private key and BSCScan API key
 * 2. Get BNB testnet tokens from: https://testnet.binance.org/faucet-smart
 * 3. Run: npx hardhat run contracts/deploy.js --network bsc_testnet
 */

module.exports = {
    solidity: {
        version: "0.8.19",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200
            }
        }
    },
    networks: {
        // BSC Testnet
        bsc_testnet: {
            url: "https://data-seed-prebsc-1-s1.binance.org:8545",
            chainId: 97,
            gasPrice: 20000000000,
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
        },
        // BSC Mainnet
        bsc_mainnet: {
            url: "https://bsc-dataseed1.binance.org",
            chainId: 56,
            gasPrice: 20000000000,
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
        },
        // Local Hardhat Network for testing
        hardhat: {
            chainId: 1337
        }
    },
    paths: {
        sources: "./contracts",
        tests: "./test",
        cache: "./cache",
        artifacts: "./artifacts"
    }
};
