const crypto = require('crypto');

// IPCC Tier-2 Biomass Formula (Dual Pool: 50% Canopy + 50% Soil)
function calculateMangroveCarbon(treeCount) {
    // 0.025 MT Biomass per mature mangrove tree per year
    const dryBiomassMT = treeCount * 0.025; 
    
    // Carbon fraction of dry biomass = ~47% (IPCC default)
    const carbonStockMT = dryBiomassMT * 0.47;
    
    // Total CO2 Equivalent = Carbon * (44 / 12)
    const co2Equivalent = carbonStockMT * (44 / 12);
    
    // Dual Pool allocation: 50% Canopy Pool + 50% Soil Pool
    const canopyPool = parseFloat((co2Equivalent * 0.50).toFixed(2));
    const soilPool = parseFloat((co2Equivalent * 0.50).toFixed(2));
    const totalCredits = parseFloat((canopyPool + soilPool).toFixed(2));

    return { canopyPool, soilPool, totalCredits };
}

// Cryptographic Checksum for project verification
function generateDataHash(payload) {
    const serialized = `\({payload.plot_name}_\){payload.species}_\({payload.tree_count}_\){JSON.stringify(payload.coordinates)}`;
    return crypto.createHash('sha256').update(serialized).digest('hex');
}

module.exports = { calculateMangroveCarbon, generateDataHash };