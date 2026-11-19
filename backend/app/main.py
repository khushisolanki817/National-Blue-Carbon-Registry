from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.db import AsyncSessionLocal
from app.routes import projects, certifiers, retirements

app = FastAPI(
    title="National Blue Carbon Registry Engine",
    description="ISO 14064 & Article 6 compliant Digital MRV + Blockchain Carbon Registry",
    version="1.0.0"
)

# React Frontend ke liye CORS allow
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Sabhi API Routes include karein
app.include_router(projects.router)
app.include_router(certifiers.router)
app.include_router(retirements.router)

@app.get("/health")
async def health_check():
    async with AsyncSessionLocal() as session:
        try:
            res = await session.execute(text("SELECT PostGIS_Version()"))
            version = res.scalar()
            return {
                "status": "HEALTHY",
                "database": "Connected",
                "postgis_version": version
            }
        except Exception as e:
            return {"status": "UNHEALTHY", "error": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=5000, reload=True)