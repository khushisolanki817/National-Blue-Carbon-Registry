-- 1. PostGIS Extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Organisations Table
CREATE TABLE IF NOT EXISTS organisations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    tax_id VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Mangrove Plots Table (PostGIS Polygon)
CREATE TABLE IF NOT EXISTS mangrove_plots (
    id SERIAL PRIMARY KEY,
    org_id INT REFERENCES organisations(id) ON DELETE CASCADE,
    plot_name VARCHAR(255) NOT NULL,
    boundary GEOMETRY(Polygon, 4326) NOT NULL,
    species VARCHAR(120) NOT NULL,
    tree_count INT NOT NULL CHECK (tree_count > 0),
    monitored_area_ha NUMERIC(10, 2) NOT NULL,
    data_hash VARCHAR(64) NOT NULL,
    ipfs_cid VARCHAR(255),
    status VARCHAR(50) DEFAULT 'Pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mangrove_plots_boundary ON mangrove_plots USING GIST(boundary);

-- 4. Carbon Credits Table
CREATE TABLE IF NOT EXISTS carbon_credits (
    id SERIAL PRIMARY KEY,
    plot_id INT REFERENCES mangrove_plots(id) ON DELETE CASCADE,
    batch_serial VARCHAR(100) UNIQUE NOT NULL,
    canopy_pool_mt NUMERIC(10, 2) NOT NULL,
    soil_pool_mt NUMERIC(10, 2) NOT NULL,
    total_co2e_mt NUMERIC(10, 2) NOT NULL,
    vintage_year INT NOT NULL,
    status VARCHAR(50) DEFAULT 'AVAILABLE',
    onchain_tx_hash VARCHAR(66),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Retirement Records Table
CREATE TABLE IF NOT EXISTS retirement_records (
    id SERIAL PRIMARY KEY,
    credit_id INT REFERENCES carbon_credits(id) ON DELETE CASCADE,
    buyer_name VARCHAR(255) NOT NULL,
    burn_tx_hash VARCHAR(66) NOT NULL,
    certificate_id VARCHAR(100) UNIQUE NOT NULL,
    retired_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Default developer organisation for testing
INSERT INTO organisations (id, name, role, tax_id, email)
VALUES (1, 'GreenEarth Foundation', 'Project Developer', 'TAX123456', 'contact@greenearth.org')
ON CONFLICT (tax_id) DO NOTHING;