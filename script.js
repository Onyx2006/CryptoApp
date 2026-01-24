let controllerActual = null;
const contenedor = document.getElementById("crypto-container");
const buscador = document.getElementById("searchInput");

//Snipper, me mola
function mostrarLoader() {
    contenedor.innerHTML = "<p class='loader'>Cargando resultados...</p>";
}


async function cargarCriptomonedas(busqueda = "") {

    // Aborta si existe
    if (controllerActual) {
        controllerActual.abort();
    }

    // Crea controllador
    controllerActual = new AbortController();
    const { signal } = controllerActual;

    const url ="https://api.coingecko.com/api/v3/coins/markets" + "?vs_currency=usd&order=market_cap_desc&per_page=50&page=1";

    mostrarLoader();

    try {
        const respuesta = await fetch(url, { signal });

        if (!respuesta.ok) {
            throw new Error("Error en la respuesta del servidor");
        }

        const datos = await respuesta.json();

        const filtradas = datos.filter(crypto =>
            crypto.name.toLowerCase().includes(busqueda.toLowerCase())
        );

        mostrarCriptomonedas(filtradas);

    } catch (error) {
        if (error.name === "AbortError") {
            console.warn("Petición cancelada");
        } else {
            mostrarError("No se pudieron cargar los datos");
            console.error(error);
        }
    }
}


function mostrarCriptomonedas(lista) {
    contenedor.innerHTML = "";

    if (lista.length === 0) {
        contenedor.innerHTML = "<p>No se encontraron resultados</p>";
        return;
    }

    lista.forEach(crypto => {
        const card = document.createElement("div");
        card.classList.add("card");

        const img = document.createElement("img");
        img.src = crypto.image;
        img.alt = crypto.name;

        const nombre = document.createElement("h3");
        nombre.textContent = crypto.name;

        const precio = document.createElement("p");
        precio.textContent = `${crypto.current_price} USD`;

        card.append(img, nombre, precio);
        contenedor.appendChild(card);
    });
}

function mostrarError(mensaje) {
    contenedor.innerHTML = `<p class="error">${mensaje}</p>`;
}

function activarBuscador() {
    buscador.addEventListener("input", (e) => {
        const texto = e.target.value;
        cargarCriptomonedas(texto);
    });
}

activarBuscador();
cargarCriptomonedas();