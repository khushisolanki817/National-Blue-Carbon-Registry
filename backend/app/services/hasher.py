import hashlib
import json

def generate_plot_hash(plot_name: str, species: str, tree_count: int, coordinates: list) -> str:
    """
    Generates a deterministic SHA-256 fingerprint.
    If database data alters even slightly, verification fails.
    """
    serialized = f"{plot_name}_{species}_{tree_count}_{json.dumps(coordinates, sort_keys=True)}"
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()