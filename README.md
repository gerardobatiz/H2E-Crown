# iSolve Dashboard — H2E / Crown City Trading

## ¿Qué es?

Dashboard web local que consume en tiempo real las 6 APIs del sistema **iSolve Produce** de Crown City Trading. Permite visualizar ventas, gastos, inventario, ajustes y el estado financiero consolidado de la operación de H2E Mexico SA de CV, sin necesidad de acceder directamente al portal de Crown City.

---

## Módulos

| Tab | API fuente | Filtro |
|---|---|---|
| 🚢 Sales / Ship Date | `GrwNetSalesByShipDateAPI` | Rango de fechas |
| 📋 Sales / Post Date | `GrwSalesByPostDateAPI` | Rango de fechas |
| 💸 Expenses | `GrwExpensesAPI` | Rango de fechas + Concepto |
| 📦 Inventory | `GrwInventoryAPI` | Fecha de corte |
| 🔧 Adj / Post Date | `GrwAdjByPostDateAPI` | Rango de fechas |
| ⏳ Pending Adj | `GrwGrwPendingAdjByLotAPI` | Sin filtro |
| 📊 GWR Statement | Todas las anteriores | Temporada (ej. 2025/2026) |

---

## GWR Statement

El módulo más importante. Consolida las 6 APIs en un solo estado financiero con tres secciones:

- **Packages** — Recibido, Facturado, Enviado, Piso de bodega
- **Sales** — Facturación MTD/STD, Ajustes, Net Sales, Ajustes Pendientes
- **Expenses** — Desglose por concepto (Commission, Liquidation, Seed, etc.)
- **Balance** — Net Sales menos Gastos, mes y temporada

Selecciona la temporada con el selector desplegable (carga automáticamente las temporadas disponibles desde la API).

> Campos pendientes de nuevas APIs: Sent to Repack, Received from Repack, Dumped, Pending Cash Receipts.

---

## Arquitectura

```
Browser  ──→  Express (localhost:3000)  ──→  iSolve API (crowncity.isolveproduce.net)
                     ↑
              Proxy con Basic Auth
              (h2e : Solvegbe0281)
```

El servidor actúa como **proxy** para evitar bloqueos CORS y mantener las credenciales fuera del navegador. Todas las peticiones llevan el header `Authorization: Basic ...` en base64.

---

## Cómo ejecutar

```bash
cd "C:\Users\OFFICE DEPOT\iSolve-Dashboard"
node server.js
```

Abre **http://localhost:3000** en el navegador.

> Mantén la ventana de consola negra abierta — es el servidor. Si la cierras, el dashboard deja de funcionar.

---

## Funciones de las tablas

- **Ordenar** — click en cualquier columna
- **Buscar** — caja de texto filtra en tiempo real
- **Export CSV** — descarga los datos actuales con fecha en el nombre
- **Auto-refresh** — toggle para refrescar cada 5 minutos automáticamente
