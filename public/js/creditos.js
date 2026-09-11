(async () => {
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  try {
    const [creditos, productos] = await Promise.all([
      fetch('/img/fotos/creditos.json').then((r) => r.json()),
      fetch('/api/productos').then((r) => r.json()),
    ]);
    const nombreDe = Object.fromEntries(productos.map((p) => [p.sku, p.nombre]));

    const filas = Object.values(creditos)
      .sort((a, b) => (nombreDe[a.sku] || '').localeCompare(nombreDe[b.sku] || ''))
      .map((c) => {
        const libre = /CC0|PDM|PROPIA/i.test(c.licencia);
        const propia = /PROPIA/i.test(c.licencia);
        return `<tr>
          <td>${esc(nombreDe[c.sku] || c.sku)}</td>
          <td>${propia ? 'Fotografía propia' : (c.fuente
            ? `<a href="${esc(c.fuente)}" target="_blank" rel="noopener">${esc(c.titulo || 'Ver original')}</a>`
            : esc(c.titulo))}</td>
          <td>${esc(c.autor)}</td>
          <td><span class="lic ${libre ? 'lic-libre' : 'lic-atrib'}">${esc(c.licencia.trim())}</span></td>
        </tr>`;
      }).join('');

    document.getElementById('filas').innerHTML = filas
      || '<tr><td colspan="4">Todavía no se han descargado fotografías.</td></tr>';
  } catch {
    document.getElementById('filas').innerHTML =
      '<tr><td colspan="4">No se pudieron cargar los créditos.</td></tr>';
  }
})();
