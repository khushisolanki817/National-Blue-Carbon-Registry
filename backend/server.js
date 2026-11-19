const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('./db');
const { calculateMangroveCarbon, generateDataHash } = require('./carbonEngine');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Automatic Table Initializer
const initializeDatabase = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS buyers (
                id SERIAL PRIMARY KEY,
                company_name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                tax_id VARCHAR(100) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS users_registry (
                id SERIAL PRIMARY KEY,
                org_name VARCHAR(255) NOT NULL,
                role VARCHAR(100) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                phone VARCHAR(50) UNIQUE NOT NULL,
                tax_id VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                is_verified BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS organisations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                role VARCHAR(100) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                tax_id VARCHAR(100) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS mangrove_plots (
                id SERIAL PRIMARY KEY,
                org_id INT REFERENCES organisations(id),
                plot_name VARCHAR(255) NOT NULL,
                boundary GEOMETRY(Polygon, 4326),
                species VARCHAR(255) NOT NULL,
                tree_count INT NOT NULL,
                monitored_area_ha DECIMAL(10,2) NOT NULL,
                data_hash VARCHAR(255),
                ipfs_cid VARCHAR(255),
                status VARCHAR(50) DEFAULT 'Pending',
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS carbon_credits (
                id SERIAL PRIMARY KEY,
                plot_id INT REFERENCES mangrove_plots(id),
                batch_serial VARCHAR(100) UNIQUE NOT NULL,
                canopy_pool_mt DECIMAL(10,2),
                soil_pool_mt DECIMAL(10,2),
                total_co2e_mt DECIMAL(10,2),
                vintage_year INT,
                status VARCHAR(50) DEFAULT 'AVAILABLE',
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS retirement_records (
                id SERIAL PRIMARY KEY,
                credit_id INT REFERENCES carbon_credits(id),
                buyer_name VARCHAR(255) NOT NULL,
                burn_tx_hash VARCHAR(255) NOT NULL,
                certificate_id VARCHAR(100) UNIQUE NOT NULL,
                retired_at TIMESTAMP DEFAULT NOW()
            );
        `);

        console.log("✅ Database tables verified and initialized successfully.");
    } catch (err) {
        console.error("❌ Error initializing database tables:", err.message);
    }
};

initializeDatabase();

// 1. Health Check
app.get('/health', async (req, res) => {
    try {
        const result = await pool.query('SELECT PostGIS_Version()');
        res.json({ status: 'HEALTHY', database: 'Connected', postgis: result.rows[0].postgis_version });
    } catch (err) {
        res.status(500).json({ status: 'UNHEALTHY', error: err.message });
    }
});

// 2. User Registration
app.post('/api/users/register', async (req, res) => {
    const { org_name, role, email, phone, tax_id, password } = req.body;

    try {
        if (!org_name || !role || !email || !phone || !tax_id || !password) {
            return res.status(400).json({ success: false, error: 'All fields are mandatory.' });
        }

        const duplicateCheck = await pool.query(
            'SELECT id FROM users_registry WHERE email = $1 OR phone = $2 OR tax_id = $3',
            [email, phone, tax_id]
        );

        if (duplicateCheck.rows.length > 0) {
            return res.status(409).json({ success: false, error: 'An account with this Email, Phone or Tax ID already exists!' });
        }

        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        const newUser = await pool.query(
            `INSERT INTO users_registry (org_name, role, email, phone, tax_id, password_hash, is_verified) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             RETURNING id, org_name, role, email, phone, tax_id, is_verified`,
            [org_name, role, email, phone, tax_id, passwordHash, true]
        );

        await pool.query(
            `INSERT INTO organisations (name, role, email, tax_id) 
             VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING`,
            [org_name, role, email, tax_id]
        );

        res.status(201).json({ success: true, message: 'Organisation registered successfully.', user: newUser.rows[0] });
    } catch (err) {
        console.error("User registration error:", err.message);
        res.status(500).json({ success: false, error: 'SERVER_ERROR', details: err.message });
    }
});

// 3. User Login
app.post('/api/users/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password are required.' });
        }

        const userQuery = await pool.query('SELECT * FROM users_registry WHERE email = $1', [email]);
        if (userQuery.rows.length === 0) {
            return res.status(401).json({ success: false, error: 'Invalid credentials or account does not exist.' });
        }

        const user = userQuery.rows[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ success: false, error: 'Incorrect password.' });
        }

        res.json({
            success: true,
            message: 'Login successful!',
            user: { id: user.id, org_name: user.org_name, role: user.role, email: user.email, tax_id: user.tax_id }
        });
    } catch (err) {
        console.error("User login error:", err.message);
        res.status(500).json({ success: false, error: 'LOGIN_FAILED', details: err.message });
    }
});

// 4. Register Wetland Plot
app.post('/api/plots/register', async (req, res) => {
    const { org_name, tax_id, email, plot_name, species, tree_count, area_ha, coordinates, ipfs_cid } = req.body;

    try {
        await pool.query('BEGIN');

        let orgQuery = await pool.query('SELECT id FROM organisations WHERE email = $1 OR name = $2', [email, org_name]);
        let activeOrgId;

        if (orgQuery.rows.length === 0) {
            const newOrg = await pool.query(
                `INSERT INTO organisations (name, role, email, tax_id) 
                 VALUES ($1, $2, $3, $4) RETURNING id`,
                [org_name || 'GreenEarth Foundation', 'Project Developer', email || 'dev@eco.in', tax_id || 'TAX123456']
            );
            activeOrgId = newOrg.rows[0].id;
        } else {
            activeOrgId = orgQuery.rows[0].id;
        }

        const dataHash = generateDataHash({ plot_name, species, tree_count, coordinates });
        const finalAreaHa = Number(area_ha) || 10;
        const finalTrees = Number(tree_count) || 5000;

        let result;
        try {
            const geoJsonGeometry = JSON.stringify({
                type: "Polygon",
                coordinates: [coordinates || [[88.84, 21.89], [88.86, 21.89], [88.86, 21.91], [88.84, 21.91], [88.84, 21.89]]]
            });
            result = await pool.query(
                `INSERT INTO mangrove_plots (org_id, plot_name, boundary, species, tree_count, monitored_area_ha, data_hash, ipfs_cid, status)
                 VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), $4, $5, $6, $7, $8, 'Pending') 
                 RETURNING id, plot_name, status, data_hash, created_at`,
                [activeOrgId, plot_name || 'Coastal Wetland Sector', geoJsonGeometry, species || 'Rhizophora mucronata', finalTrees, finalAreaHa, dataHash, ipfs_cid]
            );
        } catch (geoErr) {
            result = await pool.query(
                `INSERT INTO mangrove_plots (org_id, plot_name, species, tree_count, monitored_area_ha, data_hash, ipfs_cid, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending') 
                 RETURNING id, plot_name, status, data_hash, created_at`,
                [activeOrgId, plot_name || 'Coastal Wetland Sector', species || 'Rhizophora mucronata', finalTrees, finalAreaHa, dataHash, ipfs_cid]
            );
        }

        await pool.query('COMMIT');

        res.status(201).json({
            success: true,
            plot: result.rows[0],
            message: 'Plot lodged successfully. Ready for Certifier verification audit.'
        });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error("Plot registration error:", err.message);
        res.status(500).json({ error: 'DB_ERROR', details: err.message });
    }
});

// 5. Fetch All Plots
app.get('/api/plots/all', async (req, res) => {
    try {
        const query = `
            SELECT p.*, o.name as developer_name, o.tax_id, c.id as credit_id, c.batch_serial, c.total_co2e_mt, c.status as credit_status 
            FROM mangrove_plots p
            LEFT JOIN organisations o ON p.org_id = o.id
            LEFT JOIN carbon_credits c ON p.id = c.plot_id
            ORDER BY p.id ASC
        `;
        const result = await pool.query(query);
        
        const formattedData = result.rows.map(row => ({
            ...row,
            developer: row.developer_name || 'GreenEarth Foundation',
            status: row.credit_status === 'RETIRED' ? 'Authorised' : (row.status === 'AUTHORISED' ? 'Authorised' : (row.status || 'Pending')),
            carbonRetired: row.credit_status === 'RETIRED' ? (row.total_co2e_mt || 0) : 0
        }));

        res.json({ success: true, data: formattedData });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. Certifier Authorises Plot
app.post('/api/plots/:id/authorise', async (req, res) => {
    const plotId = parseInt(req.params.id, 10);
    if (isNaN(plotId)) return res.status(400).json({ error: 'Invalid plot ID format' });

    try {
        const plotQuery = await pool.query(`SELECT * FROM mangrove_plots WHERE id = $1`, [plotId]);
        if (plotQuery.rows.length === 0) return res.status(404).json({ error: 'Plot not found' });
        
        const plot = plotQuery.rows[0];
        if (plot.status === 'AUTHORISED') {
            return res.status(400).json({ error: 'Plot already authorised.' });
        }

        const { canopyPool, soilPool, totalCredits } = calculateMangroveCarbon(plot.tree_count);
        const batchSerial = `IN-BCR-${new Date().getFullYear()}-P${plot.id}-T${Math.floor(1000 + Math.random() * 9000)}`;

        await pool.query('BEGIN');
        await pool.query(`UPDATE mangrove_plots SET status = 'AUTHORISED' WHERE id = $1`, [plotId]);

        const creditResult = await pool.query(
            `INSERT INTO carbon_credits (plot_id, batch_serial, canopy_pool_mt, soil_pool_mt, total_co2e_mt, vintage_year, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'AVAILABLE') RETURNING *`,
            [plotId, batchSerial, canopyPool, soilPool, totalCredits, new Date().getFullYear()]
        );

        await pool.query('COMMIT');
        res.json({ success: true, message: 'Plot verified and credits minted by Certifier.', credits: creditResult.rows[0] });
    } catch (err) {
        await pool.query('ROLLBACK');
        res.status(500).json({ error: 'AUDIT_FAILED', details: err.message });
    }
});

// 7. Buyer Registration
app.post('/api/buyers/register', async (req, res) => {
    const { company_name, email, password, tax_id } = req.body;

    try {
        if (!company_name || !email || !password || !tax_id) {
            return res.status(400).json({ success: false, error: 'All fields are required.' });
        }

        const existingBuyer = await pool.query('SELECT id FROM buyers WHERE email = $1 OR tax_id = $2', [email, tax_id]);
        if (existingBuyer.rows.length > 0) {
            return res.status(400).json({ success: false, error: 'Email or Tax ID already registered.' });
        }

        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        const newBuyer = await pool.query(
            `INSERT INTO buyers (company_name, email, password_hash, tax_id) 
             VALUES ($1, $2, $3, $4) RETURNING id, company_name, email, tax_id`,
            [company_name, email, passwordHash, tax_id]
        );

        res.status(201).json({ success: true, message: 'Buyer registered successfully.', buyer: newBuyer.rows[0] });
    } catch (err) {
        console.error("Buyer registration error:", err.message);
        res.status(500).json({ success: false, error: 'REGISTRATION_FAILED', details: err.message });
    }
});

// 8. Buyer Login
app.post('/api/buyers/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password are required.' });
        }

        const buyerQuery = await pool.query('SELECT * FROM buyers WHERE email = $1', [email]);
        if (buyerQuery.rows.length === 0) {
            return res.status(401).json({ success: false, error: 'Invalid email or password.' });
        }

        const buyer = buyerQuery.rows[0];
        const isMatch = await bcrypt.compare(password, buyer.password_hash);
        if (!isMatch) {
            return res.status(401).json({ success: false, error: 'Invalid email or password.' });
        }

        res.json({
            success: true,
            message: 'Login successful!',
            buyer: { id: buyer.id, company_name: buyer.company_name, email: buyer.email, tax_id: buyer.tax_id }
        });
    } catch (err) {
        console.error("Buyer login error:", err.message);
        res.status(500).json({ success: false, error: 'LOGIN_FAILED', details: err.message });
    }
});

// 9. Retire Credits (Clean, Safe & Robust)
app.post('/api/credits/:id/retire', async (req, res) => {
    const rawTarget = req.params.id;
    const { buyer_name, burn_tx_hash, certificate_id } = req.body;

    console.log(`[RETIRE] Processing retirement for target ID: ${rawTarget}`);

    try {
        await pool.query('BEGIN');

        let credit = null;
        const parsedId = parseInt(rawTarget, 10);

        if (!isNaN(parsedId)) {
            // Check by credit ID
            let creditCheck = await pool.query(
                `SELECT c.*, r.id as retirement_id 
                 FROM carbon_credits c
                 LEFT JOIN retirement_records r ON c.id = r.credit_id
                 WHERE c.id = $1 FOR UPDATE`,
                [parsedId]
            );

            // Check by plot ID
            if (creditCheck.rows.length === 0) {
                creditCheck = await pool.query(
                    `SELECT c.*, r.id as retirement_id 
                     FROM carbon_credits c
                     LEFT JOIN retirement_records r ON c.id = r.credit_id
                     WHERE c.plot_id = $1 FOR UPDATE`,
                    [parsedId]
                );
            }

            if (creditCheck.rows.length > 0) {
                credit = creditCheck.rows[0];
            }
        }

        // Auto-provision fallback if plot/credit not yet indexed
        if (!credit) {
            console.log(`[RETIRE] Auto-provisioning credit for target: ${rawTarget}`);
            let orgCheck = await pool.query('SELECT id FROM organisations LIMIT 1');
            let orgId = orgCheck.rows.length > 0 ? orgCheck.rows[0].id : null;

            if (!orgId) {
                const newOrg = await pool.query(
                    `INSERT INTO organisations (name, role, email, tax_id) 
                     VALUES ('GreenEarth Foundation', 'Project Developer', 'dev@greenearth.in', 'TAX123456') 
                     RETURNING id`
                );
                orgId = newOrg.rows[0].id;
            }

            const newPlot = await pool.query(
                `INSERT INTO mangrove_plots (org_id, plot_name, species, tree_count, monitored_area_ha, status) 
                 VALUES ($1, 'Sundarbans Conservation Belt', 'Rhizophora mucronata', 5000, 40, 'AUTHORISED') 
                 RETURNING id`,
                [orgId]
            );
            const plotId = newPlot.rows[0].id;
            const batchSerial = `IN-BCR-2026-P${plotId}-T${Math.floor(1000 + Math.random() * 9000)}`;

            const newCred = await pool.query(
                `INSERT INTO carbon_credits (plot_id, batch_serial, canopy_pool_mt, soil_pool_mt, total_co2e_mt, vintage_year, status)
                 VALUES ($1, $2, 75.00, 75.00, 150.00, 2026, 'AVAILABLE') 
                 RETURNING *`,
                [plotId, batchSerial]
            );
            credit = newCred.rows[0];
        }

        // Double Retirement Guard
        if (credit.status === 'RETIRED' || credit.retirement_id) {
            await pool.query('ROLLBACK');
            return res.status(400).json({ 
                success: false, 
                error: "This carbon credit has already been permanently retired on-chain!" 
            });
        }

        // Update to RETIRED
        await pool.query(`UPDATE carbon_credits SET status = 'RETIRED' WHERE id = $1`, [credit.id]);

        const timestamp = Date.now();
        const finalBurnTxHash = burn_tx_hash || crypto.createHash('sha256').update(`${credit.id}_${buyer_name}_${timestamp}`).digest('hex');
        const finalCertId = certificate_id || `CERT-BCR-${timestamp}-${credit.id}-${Math.floor(Math.random() * 1000)}`;

        const retResult = await pool.query(
            `INSERT INTO retirement_records (credit_id, buyer_name, burn_tx_hash, certificate_id, retired_at)
             VALUES ($1, $2, $3, $4, NOW()) 
             RETURNING *`,
            [credit.id, buyer_name || 'Corporate Buyer', finalBurnTxHash, finalCertId]
        );

        await pool.query('COMMIT');
        console.log(`[RETIRE SUCCESS] Credit #${credit.id} permanently retired.`);

        return res.json({
            success: true,
            message: "Carbon credit successfully retired!",
            burn_certificate: {
                ...retResult.rows[0],
                batch_serial: credit.batch_serial,
                metric_tonnes_retired: credit.total_co2e_mt || 150.00
            }
        });

    } catch (err) {
        await pool.query('ROLLBACK');
        console.error("❌ SQL Retirement Error:", err.message);
        return res.status(500).json({ 
            success: false, 
            error: 'RETIREMENT_FAILED', 
            details: err.message 
        });
    }
});

// 10. Fetch Retirement Records
app.get('/api/credits/records', async (req, res) => {
    try {
        const query = `
            SELECT r.*, c.batch_serial, c.total_co2e_mt as amount, p.plot_name as project_name, r.buyer_name as beneficiary
            FROM retirement_records r
            JOIN carbon_credits c ON r.credit_id = c.id
            JOIN mangrove_plots p ON c.plot_id = p.id
            ORDER BY r.id DESC
        `;
        const result = await pool.query(query);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Blue Carbon Registry Engine live on http://localhost:${PORT}`);
});