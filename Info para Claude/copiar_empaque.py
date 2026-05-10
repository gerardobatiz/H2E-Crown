import shutil
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright

# Copiar archivo de empaque
origen = r"C:\Users\OFFICE DEPOT\OneDrive\Personal GBE\H2E\BCS\Empaque\Formato de Empaque 2E 25-26 (Saladette).xlsm"
destino = r"C:\Users\OFFICE DEPOT\OneDrive\Documentos\GitHub\H2E-Crown\Info para Claude\Reportes\Empaque\Formato de Empaque 2E 25-26 (Saladette).xlsm"
shutil.copy2(origen, destino)

# Descargar PDF de iSolve
fecha = (datetime.now() - timedelta(days=1)).strftime("%m/%d/%Y")
pdf_destino = r"C:\Users\OFFICE DEPOT\OneDrive\Documentos\GitHub\H2E-Crown\Info para Claude\Reportes\Grower Transactions.pdf"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    
    # Login
    page.goto("https://crowncity.isolveproduce.net/default.aspx")
    page.fill("#txtLoginID", "h2e")
    page.fill("#txtPassword", "Solvegbe0281")
    page.click("input[type='submit']")
    page.wait_for_load_state()
    
    # Ir al reporte
    page.goto("https://crowncity.isolveproduce.net/GrwTrans.aspx?DefaultPage=ON&PM=on")
    page.wait_for_load_state()
    
    # Guardar como PDF
    page.pdf(path=pdf_destino)
    browser.close()

print("Listo")