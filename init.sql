-- USDTSALE - Database Initialization Script
-- This script runs automatically on first PostgreSQL container startup.
-- Sequelize handles table creation and migration via sync({ alter: true }).

-- Create the database (if not already created by POSTGRES_DB env var)
SELECT 'CREATE DATABASE usdt_sale'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'usdt_sale')\gexec

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE usdt_sale TO postgres;

-- Connect to the usdt_sale database
\c usdt_sale

-- Enable useful extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";

-- Log success
DO $$
BEGIN
    RAISE NOTICE '✅ USDTSALE database initialized successfully!';
END $$;
