fetch('/api/productos').then((r) => r.json()).then((productos) => {
  document.getElementById('hoja').innerHTML = productos.map((p) => `
    <div class="ficha">
      <img src="${p.imagen}" alt="${p.nombre}" loading="lazy">
      <div><strong>${p.nombre}</strong><span>${p.sku} · ${p.categoria}</span></div>
    </div>`).join('');
});
