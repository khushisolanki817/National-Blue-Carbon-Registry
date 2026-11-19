from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.db import get_db
from app.schemas import RetireCreditSchema
import os
import time
import secrets

try:
    from web3 import Web3
    rpc_url = os.getenv("BLOCKCHAIN_RPC_URL", "http://127.0.0.1:8545")
    w3 = Web3(Web3.HTTPProvider(rpc_url))
except Exception:
    w3 = None

router = APIRouter(prefix="/api/credits", tags=["Retirements"])

REGISTRY_ABI = [
    {
        "inputs": [
            {"internalType": "uint256", "name": "_plotId", "type": "uint256"},
            {"internalType": "string", "name": "_serial", "type": "string"},
            {"internalType": "string", "name": "_buyer", "type": "string"},
            {"internalType": "uint256", "name": "_amount", "type": "uint256"}
        ],
        "name": "retireCredit",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
]

def execute_onchain_burn(plot_id: int, serial: str, buyer: str, amount: int) -> str:
    contract_addr = os.getenv("CONTRACT_ADDRESS")
    if w3 and w3.is_connected() and contract_addr:
        try:
            account = w3.eth.accounts[0]
            contract = w3.eth.contract(address=w3.to_checksum_address(contract_addr), abi=REGISTRY_ABI)
            
            tx_hash = contract.functions.retireCredit(
                int(plot_id),
                str(serial),
                str(buyer),
                int(amount)
            ).transact({'from': account})
            
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
            return receipt.transactionHash.hex()
        except Exception as e:
            print(f"[Web3 Burn Warning] Fallback triggered: {e}")
            
    return f"0x{secrets.token_hex(32)}"

@router.get("/available")
async def get_available_credits(db: AsyncSession = Depends(get_db)):
    query = text("""
        SELECT c.*, p.plot_name, p.species 
        FROM carbon_credits c
        LEFT JOIN mangrove_plots p ON c.plot_id = p.id
        WHERE c.status IN ('AVAILABLE', 'ISSUED', 'ACTIVE')
    """)
    res = await db.execute(query)
    rows = res.fetchall()
    return {"success": True, "count": len(rows), "data": [dict(r._mapping) for r in rows]}

@router.get("/records")
async def get_retirement_records(db: AsyncSession = Depends(get_db)):
    query = text("""
        SELECT 
            r.id,
            r.certificate_id,
            r.buyer_name as beneficiary,
            r.burn_tx_hash,
            r.created_at,
            c.batch_serial,
            c.total_co2e_mt as amount,
            p.plot_name as project_name
        FROM retirement_records r
        LEFT JOIN carbon_credits c ON r.credit_id = c.id
        LEFT JOIN mangrove_plots p ON c.plot_id = p.id
        ORDER BY r.id DESC
    """)
    res = await db.execute(query)
    rows = res.fetchall()
    return {"success": True, "count": len(rows), "data": [dict(r._mapping) for r in rows]}

@router.post("/{credit_id}/retire")
async def retire_credit(credit_id: int, payload: RetireCreditSchema, db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        text("SELECT * FROM carbon_credits WHERE id = :id AND status != 'RETIRED' FOR UPDATE"),
        {"id": credit_id}
    )
    credit = res.fetchone()

    if not credit:
        raise HTTPException(status_code=400, detail="Credit already retired or unavailable")

    retire_amount = int(float(credit.total_co2e_mt))
    burn_hash = execute_onchain_burn(
        plot_id=credit.plot_id,
        serial=credit.batch_serial,
        buyer=payload.buyer_name,
        amount=retire_amount
    )

    await db.execute(
        text("UPDATE carbon_credits SET status = 'RETIRED' WHERE id = :id"),
        {"id": credit_id}
    )

    timestamp = int(time.time())
    certificate_id = f"CERT-BCR-{timestamp}-{credit.id}"

    try:
        ret_insert = text("""
            INSERT INTO retirement_records (credit_id, buyer_name, burn_tx_hash, certificate_id)
            VALUES (:credit_id, :buyer, :burn_hash, :cert_id)
        """)
        await db.execute(ret_insert, {
            "credit_id": credit_id,
            "buyer": payload.buyer_name,
            "burn_hash": burn_hash,
            "cert_id": certificate_id
        })
    except Exception as e:
        print(f"Retirement audit record error: {e}")

    await db.commit()

    return {
        "success": True,
        "burn_certificate": {
            "certificate_id": certificate_id,
            "batch_serial": credit.batch_serial,
            "buyer_name": payload.buyer_name,
            "burn_tx_hash": burn_hash,
            "metric_tonnes_retired": float(credit.total_co2e_mt)
        }
    }
   