# PVC Meta Blockchain Registration System

Blockchain-based user registration system with smart contract approval, database persistence, and admin panel.

## Features

- ✅ Web3 wallet connection (MetaMask)
- ✅ ERC20 token smart contract approval
- ✅ User registration on blockchain and database
- ✅ Admin panel for managing approval addresses
- ✅ Secure JWT authentication
- ✅ Rate limiting and security features
- ✅ MongoDB database with proper indexing

## Prerequisites

- Node.js v16 or higher
- MongoDB (local or Atlas)
- MetaMask browser extension
- BNB for gas fees (testnet or mainnet)

## Installation

1. **Install Dependencies**
```bash
npm install
```

2. **Configure Environment**
```bash
# Copy the example env file
cp .env.example .env

# Edit .env and configure:
# - MongoDB connection string
# - Admin credentials
# - Other settings
```

3. **Initialize Database**
```bash
node server/init-db.js
```

## Smart Contract Deployment

1. **Compile Contract**
```bash
npm run compile
```

2. **Deploy to BSC Testnet**
```bash
# Make sure you have testnet BNB
# Get from: https://testnet.binance.org/faucet-smart
npm run deploy:testnet
```

3. **Update Environment**
```bash
# Add the deployed contract address to .env
SMART_CONTRACT_ADDRESS=0x...your_contract_address...
```

4. **Re-initialize Database**
```bash
# This will add the contract address to the database
node server/init-db.js
```

## Running the Application

1. **Start Backend Server**
```bash
npm start

# Or for development with auto-reload
npm run dev
```

2. **Open Frontend**
```bash
# Open index.html in a browser
# Or use a local server like Live Server in VS Code
```

3. **Access Admin Panel**
```bash
# Navigate to admin/admin.html
# Login with credentials from .env
# Default: admin / changeme123
```

## Project Structure

```
PVC/
├── contracts/
│   ├── PVCToken.sol           # ERC20 smart contract
│   ├── deploy.js              # Deployment script
│   └── PVCToken.abi.json      # Contract ABI
├── server/
│   ├── config/
│   │   └── database.js        # MongoDB schemas
│   ├── middleware/
│   │   └── auth.middleware.js # JWT authentication
│   ├── routes/
│   │   ├── user.routes.js     # User API endpoints
│   │   └── admin.routes.js    # Admin API endpoints
│   ├── server.js              # Express server
│   └── init-db.js             # Database initialization
├── admin/
│   ├── admin.html             # Admin login page
│   ├── admin-dashboard.html   # Admin dashboard
│   ├── admin.css              # Admin panel styles
│   └── admin.js               # Admin panel logic
├── index.html                 # Main landing page
├── hardhat.config.js          # Hardhat configuration
├── package.json               # Dependencies
└── .env.example               # Environment template
```

## API Endpoints

### User Endpoints
- `POST /api/users/register` - Register new user
- `POST /api/users/approve` - Record approval transaction
- `GET /api/users/:address` - Get user status
- `GET /api/config/contract-address` - Get contract address

### Admin Endpoints (Protected)
- `POST /api/admin/login` - Admin login
- `GET /api/admin/approvals` - List approval addresses
- `POST /api/admin/approvals` - Add approval address
- `PUT /api/admin/approvals/:id` - Update approval address
- `DELETE /api/admin/approvals/:id` - Delete approval address
- `GET /api/admin/stats` - Dashboard statistics

## Usage Flow

### User Registration
1. User clicks "Register & Connect Wallet"
2. MetaMask prompts for wallet connection
3. System switches to BSC network if needed
4. Frontend fetches smart contract address from API
5. User approves token spending (smart contract interaction)
6. Transaction is broadcast to blockchain
7. Frontend sends registration data to backend
8. Backend stores user data in MongoDB
9. User receives confirmation

### Admin Panel
1. Admin navigates to admin/admin.html
2. Logs in with credentials
3. Views dashboard with statistics
4. Manages approval addresses:
   - View all addresses
   - Add new addresses
   - Edit existing addresses
   - Activate/deactivate addresses
   - Delete addresses

## Security Features

- ✅ JWT token authentication with expiration
- ✅ Password hashing with bcrypt
- ✅ Rate limiting on all endpoints
- ✅ Input validation and sanitization
- ✅ CORS protection
- ✅ Helmet security headers
- ✅ MongoDB injection prevention
- ✅ No hardcoded sensitive values

## Database Schema

### Users Collection
- `walletAddress` (indexed, unique)
- `approvalTxHash`
- `chainId`
- `status` (pending/confirmed/failed)
- `registrationDate`
- `createdAt`, `updatedAt`

### ApprovalAddresses Collection
- `contractAddress` (indexed, unique)
- `description`
- `chainId`
- `isActive` (indexed)
- `addedBy`
- `createdAt`, `updatedAt`

### AdminUsers Collection
- `username` (indexed, unique)
- `passwordHash`
- `email`
- `role`
- `lastLogin`
- `isActive`

## Troubleshooting

### MongoDB Connection Issues
```bash
# Check if MongoDB is running
mongod --version

# For MongoDB Atlas, verify connection string in .env
```

### MetaMask Issues
- Ensure MetaMask is installed and unlocked
- Switch to BSC network manually if auto-switch fails
- Check you have BNB for gas fees

### Contract Deployment Issues
- Verify PRIVATE_KEY in .env (without 0x prefix)
- Ensure sufficient BNB balance
- Check network connectivity

## Development

### Testing
```bash
# Run Hardhat tests
npm test
```

### Compile Contracts
```bash
npm run compile
```

## License

MIT

## Support

For issues or questions, please open an issue in the repository.
