import os, sys
from datetime import datetime

BASE     = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(BASE, "descarga.log")
DESTINO  = os.path.join(BASE, "Ventas CBE-H2E 2.xlsx")

ONEDRIVE_URL = (
    "https://onedrive.live.com/:x:/g/personal/E64C979621066DEB"
    "/IQAh6yOlOYu6T5yYDDOq85GRATGj1iZr2eY2LypQMKRSzN0"
    "?resid=E64C979621066DEB!sa523eb218b394fba9c980c33aaf39191"
    "&ithint=file%2Cxlsx&e=jYKFAU&migratedtospo=true"
    "&redeem=aHR0cHM6Ly8xZHJ2Lm1zL3gvYy9lNjRjOTc5NjIxMD"
    "&download=1"
)

def log(msg):
    line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")

try:
    import requests
except ImportError:
    log("ERROR: modulo requests no encontrado. Ejecuta: pip install requests")
    sys.exit(1)

log("Descargando Ventas CBE-H2E desde OneDrive...")
try:
    r = requests.get(ONEDRIVE_URL, allow_redirects=True, timeout=30)
except Exception as e:
    log(f"ERROR de conexion: {e}")
    sys.exit(1)

ct    = r.headers.get("Content-Type", "")
es_ok = any(x in ct for x in ("spreadsheet", "octet-stream", "zip", "excel")) or r.content[:2] == b"PK"

if r.status_code == 200 and es_ok:
    with open(DESTINO, "wb") as f:
        f.write(r.content)
    kb = len(r.content) // 1024
    log(f"OK {kb} KB guardados en {os.path.basename(DESTINO)}")
else:
    log(f"ERROR HTTP {r.status_code}  Content-Type: {ct}")
    if b"<!DOCTYPE" in r.content[:200] or b"<html" in r.content[:200].lower():
        log("OneDrive devolvio HTML. Actualiza el link en el script.")
    sys.exit(1)
