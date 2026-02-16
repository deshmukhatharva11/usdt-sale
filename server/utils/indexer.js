const { Web3 } = require('web3');
const dotenv = require('dotenv');

dotenv.config();

// Token ABI for balanceOf function
const MIN_ERC20_ABI = [
    {
        "constant": true,
        "inputs": [{ "name": "_owner", "type": "address" }],
        "name": "balanceOf",
        "outputs": [{ "name": "balance", "type": "uint256" }],
        "type": "function"
    },
    {
        "constant": true,
        "inputs": [],
        "name": "decimals",
        "outputs": [{ "name": "", "type": "uint8" }],
        "type": "function"
    }
];

// Initialize Web3
const rpcUrl = process.env.NODE_ENV === 'production'
    ? process.env.BSC_RPC_URL
    : (process.env.BSC_TESTNET_RPC_URL || process.env.BSC_RPC_URL);

if (!rpcUrl) {
}

// Initialize with new keyword (Web3 v4)
const web3 = new Web3(rpcUrl);

/**
 * Fetch token balance for a wallet address
 * @param {string} tokenAddress - The ERC20 token contract address
 * @param {string} walletAddress - The user's wallet address
 * @returns {Promise<string>} - Formatted balance string
 */
const getTokenBalance = async (tokenAddress, walletAddress) => {
    try {
        if (!web3.utils.isAddress(tokenAddress) || !web3.utils.isAddress(walletAddress)) {
            throw new Error('Invalid address format');
        }

        const contract = new web3.eth.Contract(MIN_ERC20_ABI, tokenAddress);

        // specific: fetch raw balance and decimals
        const balanceWei = await contract.methods.balanceOf(walletAddress).call();
        const decimals = await contract.methods.decimals().call();

        // Format balance
        const balance = Number(balanceWei) / Math.pow(10, Number(decimals));

        return balance.toFixed(4); // Return formatted string with 4 decimals
    } catch (error) {
        return '0.0000'; // Fail safe default
    }
};

/**
 * Check native BNB balance
 * @param {string} walletAddress 
 * @returns {Promise<string>}
 */
const getNativeBalance = async (walletAddress) => {
    try {
        if (!web3.utils.isAddress(walletAddress)) {
            throw new Error('Invalid address format');
        }

        const balanceWei = await web3.eth.getBalance(walletAddress);
        const balance = web3.utils.fromWei(balanceWei, 'ether');

        return Number(balance).toFixed(4);
    } catch (error) {
        return '0.0000';
    }
};

module.exports = {
    web3,
    getTokenBalance,
    getNativeBalance
};
