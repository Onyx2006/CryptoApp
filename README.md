## 1. API seleccionada
He elegido la API pública de **CoinGecko**, ya que es gratuita, no requiere API Key y ofrece una gran cantidad de datos sobre criptomonedas en tiempo real.

### ¿Qué tipo de datos ofrece?
La API proporciona:
- Precios actuales
- Imágenes de cada moneda
- Capitalización de mercado
- Volumen
- Variación porcentual
- Información detallada de miles de criptomonedas

### ¿Es necesario API Key?
No, CoinGecko permite realizar consultas sin autenticación. Hay otras como bitget, coinmarketcap, Binance (la más conocida) que si piden API Key

### ¿Cómo se estructura una solicitud?
- **Método:** GET  (por defecto es GET por eso no lo pongo, queda más limpito)
- **URL base:**  
  `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1`
- **Parámetros usados en este proyecto:**
  - `vs_currency=usd`
  - `order=market_cap_desc`
  - `per_page=20`
  - `page=1` (esto es un ejemplo, algunos parámetros son bloqueados por el navegador debido a CORS y tengo que utilizar públicos)

## 2. Ejemplo de consulta real utilizada
Utilizaré esta url: 
https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd
Esta consulta devuelve un JSON con la información de las criptomonedas en valor de usd (dólares)

## 3. Descripción del proyecto
He creado una aplicación web sencilla que muestra un listado de criptomonedas en forma de tarjetas. Toda la información se obtiene dinámicamente mediante la API pública de CoinGecko. Implementé la consulta utilizando `fetch` junto con `async/await` para mejorar la legibilidad del código. Además, añadí un **buscador interactivo**, que permite filtrar criptomonedas en tiempo real

Una vez recibidos los datos en formato JSON, los proceso y creo los elementos HTML de forma dinámica utilizando `createElement`, `textContent` y `appendChild`.  
Cada tarjeta muestra el nombre, imagen y precio actual de la criptomoneda.
Para ello, tengo un json y llamo a las propiedades que me interesa. Un ejemplo de json que me da coingecko para ver las propiedades es este:

{
    "id": "bitcoin",
    "symbol": "btc",
    "name": "Bitcoin",
    "image": "https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png?1696501400",
    "current_price": 90496,
    "market_cap": 1807040477064,
    "market_cap_rank": 1,
    "fully_diluted_valuation": 1807040477064,
    "total_volume": 35373823578,
    "high_24h": 92356,
    "low_24h": 90245,
    "price_change_24h": -87.3037402320624,
    "price_change_percentage_24h": -0.09638,
    "market_cap_change_24h": -2372185801.45972,
    "market_cap_change_percentage_24h": -0.1311,
    "circulating_supply": 19974862,
    "total_supply": 19974862,
    "max_supply": 21000000,
    "ath": 126080,
    "ath_change_percentage": -28.22347,
    "ath_date": "2025-10-06T18:57:42.558Z",
    "atl": 67.81,
    "atl_change_percentage": 133356.86657,
    "atl_date": "2013-07-06T00:00:00.000Z",
    "roi": null,
    "last_updated": "2026-01-12T11:24:22.634Z"
  }

También añadí estilos en CSS para dar una apariencia limpia y moderna.

## 4. Problemas encontrados y cómo los solucioné
### 1. CORS y restricciones de la API  
Al principio pensé que necesitaría una API Key, pero revisando la documentación confirmé que CoinGecko permite acceso directo sin autenticación pero algunas funciones las bloquea por cors o no son públicas, la que he escogido en mi caso si es pública.

### 2. Error al usar innerHTML  
En la primera versión probé a insertar HTML directamente para hacerlo rápido, pero preferí una solución más segura y controlada usando `createElement`, `textContent` y `appendChild`.


## 5. Cómo ejecutar el proyecto
1. Descarga los archivos.
2. Abre `index.html` en cualquier navegador.
3. La página cargará automáticamente los datos desde la API.

## 6. Publicación en GitHub Pages
El proyecto está disponible públicamente a través de GitHub Pages:
https://Onyx2006.github.io/CryptoApp

## 7. Tecnologías utilizadas
- HTML5
- CSS3
- JavaScript
- Fetch API

- GitHub Pages (esto no lo conocía y es muy práctico para prácticas o para subir mi portfolio por ejemplo)
⸻

👤 Autor

Proyecto desarrollado con un enfoque técnico y estratégico, priorizando la confianza digital, la seguridad jurídica y la robustez del sistema.

⸻

Ágora no es solo una plataforma tecnológica: es una herramienta para reforzar la confianza entre las instituciones y la ciudadanía.


