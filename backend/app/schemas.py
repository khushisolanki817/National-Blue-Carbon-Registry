from pydantic import BaseModel, Field
from typing import List, Optional

class PlotLodgeSchema(BaseModel):
    org_id: int = 1
    plot_name: str
    species: str
    tree_count: int = Field(gt=0, description="Trees must be greater than 0")
    area_ha: Optional[float] = 10.0
    coordinates: List[List[float]] # [[lng, lat], [lng, lat], ...]
    ipfs_cid: Optional[str] = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"

class RetireCreditSchema(BaseModel):
    buyer_name: str