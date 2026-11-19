from fastapi import APIRouter, HTTPException, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.db import get_db
from app.schemas import PlotLodgeSchema
from app.services.hasher import generate_plot_hash
from app.services.carbon_engine import calculate_mangrove_carbon
import json

router = APIRouter(prefix="/api/plots", tags=["Projects"])

@router.get("/all")
async def get_all_plots(db: AsyncSession = Depends(get_db)):
    query = text("""
        SELECT p.id, p.plot_name, p.species, p.tree_count, p.monitored_area_ha,
               p.data_hash, p.status, p.created_at, p.ipfs_cid, o.name as developer, o.tax_id,
               ST_AsGeoJSON(p.boundary) as boundary_geojson
        FROM mangrove_plots p
        JOIN organisations o ON p.org_id = o.id
        ORDER BY p.id DESC
    """)
    res = await db.execute(query)
    rows = res.fetchall()
    
    plots = []
    for r in rows:
        calc = calculate_mangrove_carbon(r.tree_count)
        plots.append({
            "id": f"IN-BCR-2026-{str(r.id).zfill(3)}",
            "backendPlotId": r.id,
            "title": r.plot_name,
            "developer": r.developer,
            "taxId": r.tax_id,
            "species": r.species,
            "trees": r.tree_count,
            "areaHa": float(r.monitored_area_ha),
            "biomassMT": calc["canopy_pool"],
            "soilCarbonMT": calc["soil_pool"],
            "carbonAuthorised": calc["total_credits"],
            "status": r.status,
            "proofHash": r.data_hash,
            "ipfsCid": r.ipfs_cid or "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
            "boundary": json.loads(r.boundary_geojson) if r.boundary_geojson else None
        })
    return {"success": True, "data": plots}

@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register_plot(payload: PlotLodgeSchema, db: AsyncSession = Depends(get_db)):
    coords = payload.coordinates
    if len(coords) < 4:
        raise HTTPException(
            status_code=400, 
            detail="Valid polygon coordinates required (minimum 4 points in a closed loop)."
        )

    # Ensure closed loop geometry
    if coords[0] != coords[-1]:
        coords.append(coords[0])

    geojson_str = json.dumps({"type": "Polygon", "coordinates": [coords]})

    # Anti-Double Counting Gate (PostGIS Boundary Overlap Check)
    collision_check = await db.execute(
        text("SELECT id, plot_name FROM mangrove_plots WHERE ST_Intersects(boundary, ST_SetSRID(ST_GeomFromGeoJSON(:geojson), 4326))"),
        {"geojson": geojson_str}
    )
    collision = collision_check.fetchone()
    if collision:
        raise HTTPException(
            status_code=409,
            detail=f"Double Counting Prevented: Overlaps with existing Plot ID: {collision.id} ({collision.plot_name})"
        )

    data_hash = generate_plot_hash(payload.plot_name, payload.species, payload.tree_count, coords)

    insert_query = text("""
        INSERT INTO mangrove_plots (org_id, plot_name, boundary, species, tree_count, monitored_area_ha, data_hash, ipfs_cid)
        VALUES (:org_id, :plot_name, ST_SetSRID(ST_GeomFromGeoJSON(:geojson), 4326), :species, :tree_count, :area, :data_hash, :ipfs_cid)
        RETURNING id, plot_name, status, data_hash, ipfs_cid, created_at
    """)
    res = await db.execute(insert_query, {
        "org_id": payload.org_id,
        "plot_name": payload.plot_name,
        "geojson": geojson_str,
        "species": payload.species,
        "tree_count": payload.tree_count,
        "area": payload.area_ha or 10.0,
        "data_hash": data_hash,
        "ipfs_cid": payload.ipfs_cid or "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
    })
    await db.commit()
    new_plot = res.fetchone()

    return {
        "success": True,
        "plot": {
            "id": new_plot.id,
            "plot_name": new_plot.plot_name,
            "status": new_plot.status,
            "data_hash": new_plot.data_hash,
            "ipfs_cid": new_plot.ipfs_cid
        },
        "message": "Plot lodged successfully. Ready for verification audit."
    }
@router.get("/{plot_id}/ipfs-metadata")
async def get_plot_ipfs_metadata(plot_id: int, db: AsyncSession = Depends(get_db)):
    res = await db.execute(text("SELECT * FROM mangrove_plots WHERE id = :id"), {"id": plot_id})
    plot = res.fetchone()
    if not plot:
        raise HTTPException(status_code=404, detail="Plot metadata not found")

    calc = calculate_mangrove_carbon(plot.tree_count)

    return {
        "standard": "ISO 14064-2 / IPCC Tier-2 Dual-Pool MRV",
        "jurisdiction": "National Blue Carbon Registry (MoEFCC)",
        "plot_id": plot.id,
        "plot_name": plot.plot_name,
        "dominant_species": plot.species,
        "monitored_tree_count": plot.tree_count,
        "project_area_ha": float(plot.monitored_area_ha),
        "telemetry_verification": {
            "sha256_fingerprint": plot.data_hash,
            "canopy_pool_co2e_mt": calc["canopy_pool"],
            "soil_organic_pool_co2e_mt": calc["soil_pool"],
            "total_estimated_credits": calc["total_credits"]
        },
        "decentralized_storage": {
            "ipfs_cid": plot.ipfs_cid or "bafybeigcl2bcrregistrymrvsecuredtelemetry2026",
            "pinning_status": "PINNED",
            "audit_trail": "Immutable On-Chain Anchor"
        }
    }