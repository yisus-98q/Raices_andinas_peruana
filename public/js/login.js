(() => {
  const $ = (id) => document.getElementById(id);
  const destino = new URLSearchParams(location.search).get('volver') || '/admin.html';

  // Si ya hay sesión válida, no tiene sentido mostrar el formulario.
  fetch('/api/sesion').then((r) => { if (r.ok) location.replace(destino); });

  $('forma').onsubmit = async (e) => {
    e.preventDefault();
    const boton = $('entrar');
    const error = $('error');
    error.hidden = true;
    boton.disabled = true;
    boton.textContent = 'Entrando…';

    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo: $('usuario').value, clave: $('clave').value }),
      });
      const datos = await r.json();
      if (!r.ok) throw new Error(datos.error || 'No se pudo entrar.');
      location.replace(destino);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      $('clave').value = '';
      $('clave').focus();
    } finally {
      boton.disabled = false;
      boton.textContent = 'Entrar';
    }
  };
})();
