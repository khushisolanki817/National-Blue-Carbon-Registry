import numpy as np

def calculate_mangrove_carbon(tree_count: int) -> dict:
    """
    IPCC Tier-2 Dual-Pool Sequestration Calculation:
    - 50% Canopy Biomass Pool
    - 50% Sediment Soil Organic Carbon (SOC) Pool
    """
    if tree_count <= 0:
        return {"canopy_pool": 0.0, "soil_pool": 0.0, "total_credits": 0.0}

    # 0.025 MT Biomass per mature mangrove tree / year
    dry_biomass_mt = tree_count * 0.025
    
    # Carbon fraction of dry biomass = ~47% (IPCC standard)
    carbon_stock_mt = dry_biomass_mt * 0.47
    
    # CO2 Equivalent = Carbon * (44 / 12)
    co2_equivalent = carbon_stock_mt * (44.0 / 12.0)
    
    # Dual-Pool Allocation (50% Canopy + 50% Soil)
    canopy_pool = float(np.round(co2_equivalent * 0.50, 2))
    soil_pool = float(np.round(co2_equivalent * 0.50, 2))
    total_credits = float(np.round(canopy_pool + soil_pool, 2))

    return {
        "canopy_pool": canopy_pool,
        "soil_pool": soil_pool,
        "total_credits": total_credits
    }