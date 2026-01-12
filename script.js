let todasLasCriptos = [];

async function cargarCriptomonedas() {
    const url =
        "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd";

    try {
        const respuesta = await fetch(url); //A mi me mola más hacerlo con async y await, me aconstumbre a esto y me sale solo antes que .then y .then
        const datos = await respuesta.json();
        todasLasCriptos = datos;
        mostrarCriptomonedas(datos);
    } catch (error) {
        console.error("Error al cargar los datos:", error);
    }
}

function mostrarCriptomonedas(lista) {
    const contenedor = document.getElementById("crypto-container");

    contenedor.innerHTML = "";

    lista.forEach(crypto => {
        const card = document.createElement("div");
        card.classList.add("card");

        const img = document.createElement("img");
        img.src = crypto.image;
        img.alt = crypto.name;
        img.classList.add("crypto-img");

        const nombre = document.createElement("h3");
        nombre.textContent = crypto.name;

        const precio = document.createElement("p");
        precio.classList.add("price");
        precio.textContent = crypto.current_price + " USD";

        card.appendChild(img);
        card.appendChild(nombre);
        card.appendChild(precio);

        contenedor.appendChild(card);
        //No utilizo .innerHTML para evitar inyecciones, mejor createElement, textContent y appendChild
    });
}

function activarBuscador() {
    const buscador = document.getElementById("searchInput");

    buscador.addEventListener("input", () => {
        const texto = buscador.value.toLowerCase();

        const filtradas = todasLasCriptos.filter(crypto =>
            crypto.name.toLowerCase().includes(texto)
        );

        mostrarCriptomonedas(filtradas);
    });
}

cargarCriptomonedas();
activarBuscador();