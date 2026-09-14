(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  /**
   * Formato de moneda peruano: separador de miles y dos decimales.
   * Defensivo a proposito — antes un NaN se colaba hasta la pantalla como
   * "S/ NaN", que en un carrito destruye la confianza del comprador.
   */
  const soles = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return 'S/ —';
    return 'S/ ' + v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const escapar = (t) => String(t).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Iconos dibujados, no emoji: el emoji lo pinta el sistema operativo y cada
  // uno lo dibuja distinto. En una marca eso se nota y se ve improvisado.
  const ICONO = {
    lupa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>',
    bolsa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M6 8h12l-1.2 12H7.2Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
    visto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5 11 16l6-7"/></svg>',
  };

  // Cadena de respaldo de imagen: foto → ilustración del producto → marca.
  // El evento `error` no burbujea, pero sí se puede capturar en la fase de
  // captura. Un solo oyente cubre todas las imágenes, incluidas las que aún
  // no existen cuando esto se registra.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG') return;
    const cola = (img.dataset.respaldos || '').split(',').filter(Boolean);
    if (!cola.length) return;
    img.dataset.respaldos = cola.slice(1).join(',');   // consume un nivel
    img.src = cola[0];
  }, true);

  /** src + la cola de respaldos, lista para volcar en el atributo. */
  const imagenDe = (p) => p.imagen
    ? { src: p.imagen, respaldos: `/img/${p.sku}.svg,/img/placeholder.svg` }
    : { src: `/img/${p.sku}.svg`, respaldos: '/img/placeholder.svg' };

  const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /**
   * Este script lo cargan la portada y la tienda.
   *
   * La tienda tiene la grilla, el asesor y el carrito. La portada no vende:
   * usa el catálogo solo para contar productos en el hero y nombrar las
   * categorías de la marquesina, y el globo del carrito para avisar que hay algo
   * esperando. Cada pieza se pinta si su sitio existe en la página.
   */
  const ES_TIENDA = !!$('grilla');

  let catalogo = [];
  let filtro = 'Todos';
  let busqueda = '';
  let carrito = cargarCarrito();
  let etapa = 'carrito'; // carrito | datos | exito
  let ultimoPedido = null;

  // -------------------------------------------------------------- persistencia
  function cargarCarrito() {
    try {
      const guardado = JSON.parse(localStorage.getItem('ra_carrito') || '[]');
      return Array.isArray(guardado) ? guardado : [];
    } catch { return []; }
  }
  function guardarCarrito() {
    try { localStorage.setItem('ra_carrito', JSON.stringify(carrito)); } catch { /* modo privado */ }
  }

  // --------------------------------------------------------------------- toast
  let temporizador;
  function avisar(texto) {
    const t = $('toast');
    if (!t) return;
    t.textContent = texto;
    t.classList.add('visible');
    clearTimeout(temporizador);
    temporizador = setTimeout(() => t.classList.remove('visible'), 2600);
  }

  // ------------------------------------------------------------------ catalogo
  async function cargarCatalogo() {
    try {
      const r = await fetch('/api/productos');
      catalogo = await r.json();
      // El contador del hero lee `data-contar` en cada cuadro; si ya terminó,
      // le escribimos el número directamente.
      const contador = $('dato-productos');
      if (contador) {
        contador.dataset.contar = catalogo.length;
        if (contador.dataset.contado) contador.textContent = catalogo.length;
      }
      pintarFiltros();
      pintarGrilla();
      pintarCategorias();
      // El globo necesita el catálogo para saber qué se vende por peso: antes de
      // cargarlo contaba los gramos como piezas.
      refrescarCuenta();
    } catch {
      if ($('grilla')) {
        $('grilla').innerHTML = '<p class="vacio">No pudimos cargar el catálogo. Revisa que el servidor esté encendido.</p>';
      }
    }
  }

  function pintarFiltros() {
    const propias = [...new Set(catalogo.map((p) => p.categoria))];
    const cats = ['Todos', ...propias];
    if ($('filtros')) {
      $('filtros').innerHTML = cats.map((c) =>
        `<button class="filtro${c === filtro ? ' activo' : ''}" data-cat="${escapar(c)}">${escapar(c)}</button>`
      ).join('');
    }

    // La marquesina del inicio lista las categorías: si se escribe a mano, en
    // cuanto el dueño crea una nueva desde el panel queda mintiendo. El HTML
    // trae unas fijas como respaldo para quien llegue sin JS; aquí se
    // reemplazan por las que el negocio tiene de verdad.
    const pista = $('marquesina');
    if (pista && propias.length) {
      const tira = propias.map((c) => `<span>${escapar(c)}</span>`).join('');
      pista.innerHTML = tira + tira;   // duplicada, para que el bucle no deje hueco
    }
  }

  function visibles() {
    const q = busqueda.toLowerCase().trim();
    return catalogo.filter((p) => {
      if (filtro !== 'Todos' && p.categoria !== filtro) return false;
      if (!q) return true;
      // `beneficios` entra en la búsqueda a propósito: mucha gente no busca
      // "manzanilla", busca "para dormir".
      return (p.nombre + ' ' + p.etiquetas + ' ' + p.origen + ' '
        + p.descripcion + ' ' + (p.beneficios || ''))
        .toLowerCase().includes(q);
    });
  }

  /** Con RUC la venta es factura; con DNI, boleta. Lo decide el servidor. */
  const esComprobanteFactura = (p) => p.comprobante === 'factura';

  // El catálogo pasó de dos docenas a cientos de productos. Pintarlos todos
  // deja cientos de tarjetas con imagen en el DOM y el celular se arrastra;
  // se muestran por tandas y el resto llega con el botón o al filtrar.
  const TANDA = 48;
  let mostrando = TANDA;

  function pintarGrilla(resaltar = []) {
    if (!ES_TIENDA) return;
    const lista = visibles();
    $('conteo-catalogo').textContent = lista.length === catalogo.length
      ? `${catalogo.length} productos, cada uno con su origen y su historia`
      : `${lista.length} de ${catalogo.length} productos`;

    if (!lista.length) {
      $('grilla').innerHTML =
        `<p class="vacio"><span class="vacio-icono">${ICONO.lupa}</span>No encontramos productos con ese criterio.</p>`;
      return;
    }

    // Un producto resaltado por el asesor tiene que verse, aunque esté más allá
    // del corte: si no, el consejo lleva a una grilla donde no aparece nada.
    if (resaltar.length) {
      const ultimo = Math.max(...resaltar.map((id) => lista.findIndex((p) => p.id === id)));
      if (ultimo >= mostrando) mostrando = ultimo + 1;
    }

    $('grilla').innerHTML = lista.slice(0, mostrando).map((p) => {
      const agotado = p.stock <= 0;
      const bajo = !agotado && p.stock <= p.stock_min;
      const nota = agotado
        ? '<span class="stock-nota stock-cero">Agotado</span>'
        : bajo
          // «Últimas 3» no se puede decir de algo que se pesa: quedan 300 g.
          ? `<span class="stock-nota stock-bajo">${esGranel(p) ? 'Quedan ' + enPeso(p.stock) : 'Últimas ' + p.stock}</span>`
          : '<span class="stock-nota stock-ok">Disponible</span>';
      return `
      <article class="tarjeta${resaltar.includes(p.id) ? ' resaltada' : ''}" data-id="${p.id}">
        <div class="tarjeta-figura">
          <span class="tarjeta-cat">${escapar(p.categoria)}</span>
          <img src="${escapar(imagenDe(p).src)}" data-respaldos="${imagenDe(p).respaldos}"
               alt="${escapar(p.nombre)}" loading="lazy">
        </div>
        <div class="tarjeta-cuerpo">
          <h3>${escapar(p.nombre)}</h3>
          <div class="tarjeta-origen">${escapar(p.origen)}</div>
          ${p.beneficios ? `<p class="tarjeta-para">${escapar(p.beneficios)}</p>` : ''}
          <p class="tarjeta-desc">${escapar(p.descripcion)}</p>
          <p class="tarjeta-tradicion">${escapar(p.uso_tradicional)}</p>
          <div class="tarjeta-pie">
            <div class="precio">${soles(p.precio)}<small>${
              esGranel(p) ? 'por ' + enPeso(BASE_GRANEL) : escapar(p.presentacion)}</small></div>
            ${nota}
          </div>
          <button class="btn btn-primario btn-bloque agregar" data-id="${p.id}" ${agotado ? 'disabled' : ''}>
            ${agotado ? 'Sin stock' : 'Agregar'}
          </button>
        </div>
      </article>`;
    }).join('') + (lista.length > mostrando ? `
      <div class="ver-mas">
        <p>Mostrando ${mostrando} de ${lista.length} productos</p>
        <button class="btn btn-claro" id="btn-ver-mas">Ver más productos</button>
      </div>` : '');

    // Las tarjetas nacen después de que el landing registró sus animaciones,
    // así que hay que darlas de alta para que entren con el mismo revelado.
    if (window.revelarNuevos) {
      window.revelarNuevos([...$('grilla').querySelectorAll('.tarjeta')]);
    }
  }

  // ---------------------------------------------------------------- granel
  /**
   * Lo que se vende por peso.
   *
   * En el mostrador se cotiza por 100 g —«la muña está a nueve soles los cien
   * gramos»— pero se despacha por gramo: la clienta pide 100, un cuarto, o
   * «para el mes». El sistema cuenta gramos en todos lados; los 100 g son solo
   * la forma de decir el precio.
   */
  const BASE_GRANEL = 100;
  const esGranel = (p) => p?.unidad === 'gramo';

  /** Los pesos que se ofrecen de un toque. Los fija la ficha del producto. */
  const PESOS_POR_DEFECTO = [50, 100, 250, 500, 1000];
  const pesosDe = (p) => {
    const suyos = String(p.presentaciones || '').split(',')
      .map((n) => Number(n.trim())).filter((n) => Number.isInteger(n) && n > 0);
    return (suyos.length ? suyos : PESOS_POR_DEFECTO).filter((g) => g <= p.stock);
  };

  /** El peso con el que entra al carrito: el primero que quepa en el stock. */
  const pesoInicial = (p) => pesosDe(p)[0] || Math.min(BASE_GRANEL, p.stock);

  /** «1 kg», «250 g» — el kilo se dice kilo, no «1000 g». */
  const enPeso = (g) => (g >= 1000 && g % 1000 === 0 ? `${g / 1000} kg` : `${g} g`);

  /** Lo que cuesta esa cantidad. Es la única fórmula del precio en la tienda. */
  const importe = (p, cant) => (esGranel(p) ? p.precio * cant / BASE_GRANEL : p.precio * cant);

  /** Cómo se dice el precio en la ficha y en el carrito. */
  const precioPor = (p) => (esGranel(p)
    ? `${soles(p.precio)} por ${enPeso(BASE_GRANEL)}`
    : `${soles(p.precio)} c/u`);

  /** Y cuánto queda, en su unidad. */
  const existencia = (p) => (esGranel(p) ? enPeso(p.stock) : `${p.stock}`);

  // -------------------------------------------------------------------- carrito
  function agregar(id, boton) {
    const p = catalogo.find((x) => x.id === id);
    if (!p) return;

    /**
     * Agotado entre medias.
     *
     * La grilla se repinta cada vez que el catálogo se refresca, así que ahí el
     * botón ya sale deshabilitado y este caso no llega. Las fichas del asesor,
     * en cambio, se pintan una sola vez con la respuesta y nadie las vuelve a
     * tocar: su «Agregar» puede seguir ofreciendo algo que se acabó mientras el
     * cliente leía. El clic no hacía nada y sin explicación — la lectura obvia
     * desde el otro lado es que la página está trabada, y se vuelve a pulsar.
     *
     * Se avisa y además se corrige el botón, que es lo que la ficha vieja no
     * puede hacer sola.
     */
    if (p.stock <= 0) {
      if (boton) { boton.disabled = true; boton.textContent = 'Sin stock'; }
      return avisar(`${p.nombre} se acabó. Lo reponemos pronto.`);
    }
    // Lo que se pesa entra con su primera presentación, no con «1»: nadie
    // compra un gramo de muña, y obligar a subir de a uno hasta 100 sería
    // ridículo. Lo que se cuenta por unidades sigue entrando de a uno.
    const paso = esGranel(p) ? pesoInicial(p) : 1;
    const linea = carrito.find((l) => l.id === id);
    const actual = linea ? linea.cantidad : 0;
    if (actual + paso > p.stock) {
      return avisar(`Solo quedan ${existencia(p)} de ${p.nombre}`);
    }
    if (linea) linea.cantidad += paso;
    else carrito.push({ id, cantidad: paso });
    guardarCarrito();
    refrescarCuenta(true);
    if (boton) volarAlCarrito(boton);
    avisar(`${p.nombre} agregado`);
  }

  /**
   * Cantidades de un toque.
   *
   * El + y el − sirven para corregir, no para comprar: llevarse 5 de algo
   * costaba cuatro pulsaciones sobre un boton de 28 px, y en el telefono eso es
   * donde se abandona el carrito. Los atajos ponen las cantidades que de verdad
   * se piden a un solo toque, y de paso dejan ver en que cantidad va la linea
   * sin leer el numero chico entre los dos botones.
   *
   * 10 esta en la lista porque es el primer escalon de regateo del negocio
   * (ver politicas.regateo en tienda.config.js): el mayorista lo encuentra.
   */
  const ATAJOS = [1, 2, 3, 4, 5, 10];

  /**
   * Los atajos que caben en el stock, mas la cantidad actual si no esta.
   *
   * Para lo que se pesa no son cantidades sino presentaciones —100 g, un
   * cuarto, medio kilo— y salen de la ficha del producto. Es lo mismo que hace
   * la dueña cuando dice «¿cien o un cuarto?»: ofrecer los pesos de siempre,
   * sin cerrar la puerta a que le pidan 170.
   */
  function atajosDe(l) {
    const nums = esGranel(l.prod)
      ? pesosDe(l.prod)
      : ATAJOS.filter((n) => n <= l.prod.stock);
    if (!nums.includes(l.cantidad) && l.cantidad <= l.prod.stock) nums.push(l.cantidad);
    return [...new Set(nums)].sort((a, b) => a - b);
  }

  function fijar(id, n) {
    const linea = carrito.find((l) => l.id === id);
    if (!linea || linea.cantidad === n) return;
    const p = catalogo.find((x) => x.id === id);
    if (!Number.isInteger(n) || n < 1) return;
    if (p && n > p.stock) return avisar(`Solo quedan ${existencia(p)}`);
    linea.cantidad = n;
    guardarCarrito();
    refrescarCuenta();
    pintarPanel();
  }

  function cambiar(id, delta) {
    const linea = carrito.find((l) => l.id === id);
    if (!linea) return;
    const p = catalogo.find((x) => x.id === id);
    // El − y el + mueven de a 50 g en lo que se pesa: de a un gramo harían
    // falta cincuenta toques para subir de 100 a 150.
    const paso = esGranel(p) ? 50 : 1;
    const nueva = linea.cantidad + delta * paso;
    if (nueva < 1) return quitar(id);
    if (p && nueva > p.stock) return avisar(`Solo quedan ${existencia(p)}`);
    linea.cantidad = nueva;
    guardarCarrito();
    refrescarCuenta();
    pintarPanel();
  }

  /** Se colapsa la fila antes de repintar: si desaparece de golpe, el cliente
      no alcanza a ver cuál quitó y duda de si borró lo correcto. */
  function quitar(id) {
    const fila = document.querySelector(`[data-linea="${id}"]`);
    const borrar = () => {
      carrito = carrito.filter((l) => l.id !== id);
      guardarCarrito();
      refrescarCuenta();
      pintarPanel();
    };
    if (!fila || quieto) return borrar();

    fila.animate([
      { opacity: 1, transform: 'translateX(0)', maxHeight: fila.offsetHeight + 'px' },
      { opacity: 0, transform: 'translateX(28px)', maxHeight: '0px', paddingTop: 0, paddingBottom: 0 },
    ], { duration: 260, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' })
      .addEventListener('finish', borrar);
  }

  const lineasDetalladas = () => carrito
    .map((l) => ({ ...l, prod: catalogo.find((p) => p.id === l.id) }))
    .filter((l) => l.prod);

  const total = () => lineasDetalladas().reduce((s, l) => s + importe(l.prod, l.cantidad), 0);

  function refrescarCuenta(latir = false) {
    const globo = $('cuenta-carrito');
    if (!globo) return;
    // Lo que se pesa cuenta como uno: 250 g de muña es una cosa en la bolsa, y
    // sumado en gramos el globo decía «99+» con un solo producto.
    const n = carrito.reduce((s, l) => {
      const p = catalogo.find((x) => x.id === l.id);
      return s + (esGranel(p) ? 1 : l.cantidad);
    }, 0);

    // Con el carrito vacío el globo desaparece. Un "0" permanente en la esquina
    // se lee como un error de la página, no como información.
    globo.textContent = n > 99 ? '99+' : n;
    globo.hidden = n === 0;

    if (!latir || quieto || n === 0) return;
    globo.classList.remove('late');
    void globo.offsetWidth;              // reinicia la animación CSS
    globo.classList.add('late');
  }

  // ------------------------------------------------------------- envío gratis
  // El umbral sale de tienda.config.js vía /api/tienda: si el dueño lo cambia,
  // el carrito lo refleja sin tocar código.
  let TIENDA = { delivery: { gratisDesde: 0 } };
  fetch('/api/tienda')
    .then((r) => r.json())
    .then((t) => { TIENDA = t; pintarContacto(t); pintarInformacion(t); })
    .catch(() => {});

  /**
   * El pie se llena desde tienda.config.js.
   * Antes el teléfono estaba escrito a mano en el HTML: al cambiarlo en la
   * configuración, el pie seguía mostrando el viejo. Un dato de contacto
   * equivocado en la web es peor que no tenerlo.
   */
  function pintarContacto(t) {
    const solo = (n) => String(n || '').replace(/\D/g, '');
    const internacional = (t.pais || '') + solo(t.telefono);

    const tel = $('pie-tel');
    if (tel && t.telefono) { tel.textContent = t.telefono; tel.href = 'tel:+' + internacional; }

    const wa = $('pie-whatsapp');
    if (wa && t.whatsapp) {
      wa.href = 'https://wa.me/' + (t.pais || '') + solo(t.whatsapp)
        + '?text=' + encodeURIComponent('Hola, quiero hacer un pedido');
    }

    const mail = $('pie-email');
    if (mail && t.email) { mail.textContent = t.email; mail.href = 'mailto:' + t.email; }

    if ($('pie-direccion') && t.direccion) {
      $('pie-direccion').textContent = t.direccion;
    }
    if ($('pie-horario') && t.horario) $('pie-horario').textContent = t.horario;
    if ($('pie-abierto')) {
      $('pie-abierto').textContent = t.abierto ? 'Abierto ahora' : 'Cerrado ahora';
      $('pie-abierto').style.color = t.abierto ? 'var(--verde)' : 'var(--crema-suave)';
    }
  }

  // ------------------------------------------------------------- la portada
  /**
   * Qué encontrarás: una tarjeta por categoría, sacada del catálogo real.
   *
   * Con cuántos productos tiene, de cuántos lugares salen y tres ejemplos. La
   * más surtida va primero: es la que mejor dice qué clase de puesto es. Cada
   * tarjeta abre la tienda con esa categoría ya elegida.
   */
  function pintarCategorias() {
    const caja = $('lista-categorias');
    if (!caja || !catalogo.length) return;

    const grupos = new Map();
    for (const p of catalogo) {
      if (!grupos.has(p.categoria)) grupos.set(p.categoria, []);
      grupos.get(p.categoria).push(p);
    }
    const orden = [...grupos].sort((a, b) => b[1].length - a[1].length);

    caja.innerHTML = orden.map(([cat, prods]) => {
      const origenes = new Set(prods.map((p) => p.origen).filter(Boolean)).size;
      const ejemplos = prods.slice(0, 3).map((p) => escapar(p.nombre)).join(' · ');
      return `
      <a class="tierra puerta categoria" href="/tienda?cat=${encodeURIComponent(cat)}#catalogo">
        <span class="tierra-num">${prods.length}</span>
        <h3>${escapar(cat)}</h3>
        <div class="altura">${prods.length} producto${prods.length === 1 ? '' : 's'}${
          origenes > 1 ? ` · ${origenes} orígenes` : ''}</div>
        <p>${ejemplos}</p>
        <div class="tierra-productos"><b>Ver ${escapar(cat.toLowerCase())} →</b></div>
      </a>`;
    }).join('');

    if ($('categorias-bajada')) {
      $('categorias-bajada').textContent =
        `${catalogo.length} productos en ${orden.length} categorías, cada uno con el lugar del que salió.`;
    }
    if (window.revelarNuevos) window.revelarNuevos([...caja.children]);
  }

  /** «Yape, Plin o efectivo»: la lista como se dice, no como se programa. */
  const enLista = (xs, y = 'o') => (xs.length < 2 ? xs.join('')
    : `${xs.slice(0, -1).join(', ')} ${y} ${xs[xs.length - 1]}`);
  const conMayuscula = (t) => String(t || '').replace(/^./, (c) => c.toUpperCase());

  /**
   * Envíos, pagos, devoluciones y mayoristas, con las cifras de la
   * configuración. El HTML trae el mismo texto escrito como respaldo; aquí se
   * reemplaza por el vigente, que es el mismo con el que cobra el carrito.
   */
  function pintarInformacion(t) {
    const poner = (clave, texto) => {
      const el = document.querySelector(`[data-info="${clave}"]`);
      if (el && texto) el.textContent = texto;
    };
    const medios = t.pago?.medios || [];
    const d = t.delivery || {};
    const pol = t.politicas || {};

    if (medios.length) {
      poner('medios', `${conMayuscula(enLista(medios))}.${t.pago.tarjeta ? '' : ' Sin tarjeta.'}`);
      poner('pagos', `Con ${enLista(medios)}.${t.pago.tarjeta ? '' : ' Por ahora no aceptamos tarjeta.'}`);
    }
    if (d.gratisDesde) poner('gratis', `En Lima el envío es gratis en compras desde ${soles(d.gratisDesde)}.`);
    if (pol.garantiaOrigen) poner('garantia', pol.garantiaOrigen);
    if (pol.devolucion) {
      poner('devolucion', `Tienes ${pol.devolucion.diasPlazo} días. ${pol.devolucion.nota || ''}`.trim());
    }
    poner('provincias', d.provincias
      ? `Sí, enviamos a agencia por ${enLista(d.provincias.agencias, 'u')}, en ${d.provincias.plazo}. ${conMayuscula(d.provincias.quienPaga)}.`
      : 'Por ahora solo hacemos envíos dentro de Lima y Callao.');
    if (pol.mayorista && pol.escalones?.length) {
      const escala = enLista(pol.escalones.map((e) => `${e.porcentaje} % desde ${e.desde} unidades`), 'y');
      poner('mayor', `Sí, desde ${pol.mayorista.desde} unidades del mismo producto. Hay descuento por volumen: ${escala}. `
        + 'Se coordina por WhatsApp o preguntándole al asesor, no en el carrito.');
    }

    const zonas = $('zonas');
    if (zonas && d.zonas) {
      const tarjeta = (titulo, dato, texto) => `
        <article class="tierra zona">
          <h3>${escapar(titulo)}</h3>
          <div class="altura">${escapar(dato)}</div>
          <p>${escapar(texto)}</p>
        </article>`;
      zonas.innerHTML = [
        d.recojoEnTienda ? tarjeta('Recojo en el puesto', 'Sin costo · ' + (t.horario || ''),
          [t.direccion, t.referencia].filter(Boolean).join(', ') + '.') : '',
        ...d.zonas.map((z) => tarjeta(z.nombre, `${soles(z.costo)} · ${z.horas}`,
          z.distritos.length ? z.distritos.join(', ') + '.' : 'El resto de Lima Metropolitana y Callao.')),
        d.provincias ? tarjeta('Provincias', `Por agencia · ${d.provincias.plazo}`,
          `${enLista(d.provincias.agencias, 'u')}. ${conMayuscula(d.provincias.quienPaga)}.`) : '',
      ].join('');
      if (window.revelarNuevos) window.revelarNuevos([...zonas.children]);
    }

    if ($('cierre-texto') && t.direccion) {
      $('cierre-texto').textContent = `${t.direccion}${t.referencia ? ', ' + t.referencia : ''}. `
        + `Abrimos de ${t.horario}${t.domingo ? '; ' + t.domingo : ''}. `
        + 'Pregunta por lo que necesites: si no lo tenemos, te lo decimos.';
    }
    const wa = $('cierre-whatsapp');
    if (wa) {
      if (t.whatsapp) {
        wa.href = 'https://wa.me/' + (t.pais || '') + String(t.whatsapp).replace(/\D/g, '')
          + '?text=' + encodeURIComponent('Hola, tengo una consulta');
      } else wa.hidden = true;
    }
  }

  function costoEnvio(subtotal) {
    const umbral = TIENDA.delivery?.gratisDesde || 0;
    if (umbral && subtotal >= umbral) return { monto: 0, texto: 'Gratis' };
    return { monto: 0, texto: 'Según tu zona' };
  }

  /** Barra de avance hacia el envío gratis. Es la palanca que sube el ticket. */
  function barraEnvio(subtotal) {
    const umbral = TIENDA.delivery?.gratisDesde || 0;
    if (!umbral) return '';
    if (subtotal >= umbral) {
      return `<div class="envio-aviso logrado">
        ${ICONO.visto}<span>¡Listo! Tu envío va <strong>gratis</strong>.</span></div>`;
    }
    const falta = umbral - subtotal;
    const pct = Math.min(100, Math.round((subtotal / umbral) * 100));
    return `<div class="envio-aviso">
      <span>Te faltan <strong>${soles(falta)}</strong> para el envío gratis</span>
      <div class="envio-barra"><i style="width:${pct}%"></i></div>
    </div>`;
  }

  // -------------------------------------------------------- vuelo al carrito
  /** La foto del producto viaja hasta el carrito. Confirma la acción sin toast. */
  function volarAlCarrito(boton) {
    if (quieto) return;
    // Sirve para las tarjetas del catálogo y para las fichas del asesor.
    const contenedor = boton.closest('.tarjeta, .ficha-asesor');
    const origen = contenedor?.querySelector('img');
    const destino = $('btn-carrito');
    if (!origen || !destino) return;

    const a = origen.getBoundingClientRect();
    const b = destino.getBoundingClientRect();
    const clon = origen.cloneNode();
    clon.className = 'vuela';
    Object.assign(clon.style, {
      left: a.left + 'px', top: a.top + 'px',
      width: a.width + 'px', height: a.height + 'px',
    });
    document.body.appendChild(clon);

    const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
    const dy = (b.top + b.height / 2) - (a.top + a.height / 2);

    // Arco: sube antes de caer al carrito. Un movimiento recto se ve mecánico.
    clon.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1, borderRadius: '16px' },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.5 - 70}px) scale(.5)`, opacity: .95, offset: .55 },
      { transform: `translate(${dx}px, ${dy}px) scale(.12)`, opacity: 0, borderRadius: '50%' },
    ], { duration: 720, easing: 'cubic-bezier(.42,0,.28,1)' })
      .addEventListener('finish', () => clon.remove());
  }

  function abrirPanel() { $('velo').hidden = false; $('panel-carrito').hidden = false; pintarPanel(); }
  function cerrarPanel() {
    $('velo').hidden = true; $('panel-carrito').hidden = true;
    if (etapa === 'exito') { etapa = 'carrito'; ultimoPedido = null; }
  }

  function pintarPanel() {
    const cuerpo = $('cuerpo-carrito');
    const pie = $('pie-carrito');

    if (etapa === 'exito' && ultimoPedido) {
      cuerpo.innerHTML = `
        <div class="exito">
          <span class="exito-icono">${ICONO.visto}</span>
          <h3>¡Pedido registrado!</h3>
          <p>${ultimoPedido.modoEntrega === 'recojo'
            ? 'Pásalo a recoger por el local cuando quieras.'
            : 'Te llamamos para coordinar la entrega.'}</p>
          <div class="codigo">${escapar(ultimoPedido.codigo)}</div>
          <p><strong>${esComprobanteFactura(ultimoPedido) ? 'Factura' : 'Boleta'}
             ${escapar(ultimoPedido.numeroComprobante || '')}</strong>
             por <strong>${soles(ultimoPedido.total)}</strong></p>
          <p>${escapar(ultimoPedido.entrega || '')} · ${escapar(ultimoPedido.plazo || '')}</p>
          <p style="margin-top:14px;font-size:13px">
            Guarda tu código: con él y los últimos 4 dígitos de tu teléfono
            puedes seguir tu pedido cuando quieras.
          </p>
          <div class="exito-acciones">
            ${ultimoPedido.numeroComprobante ? `
              <a class="btn btn-primario"
                 href="/comprobante.html?codigo=${encodeURIComponent(ultimoPedido.codigo)}&tel=${encodeURIComponent(ultimoPedido.tel4 || '')}">
                Ver mi ${esComprobanteFactura(ultimoPedido) ? 'factura' : 'boleta'}
              </a>` : ''}
            <a class="btn btn-fantasma"
               href="/mi-pedido.html?codigo=${encodeURIComponent(ultimoPedido.codigo)}">
              Seguir mi pedido →
            </a>
          </div>
        </div>`;
      pie.innerHTML = '<button class="btn btn-secundario btn-bloque" id="btn-seguir">Seguir comprando</button>';
      $('btn-seguir').onclick = cerrarPanel;
      return;
    }

    const lineas = lineasDetalladas();
    if (!lineas.length) {
      cuerpo.innerHTML = `<div class="vacio"><span class="vacio-icono">${ICONO.bolsa}</span>Tu carrito está vacío.<br>Agrega productos del catálogo.</div>`;
      pie.innerHTML = '';
      return;
    }

    if (etapa === 'carrito') {
      cuerpo.innerHTML = barraEnvio(total()) + lineas.map((l) => {
        const img = imagenDe(l.prod);
        const tope = l.cantidad >= l.prod.stock;
        return `
        <div class="linea" data-linea="${l.id}">
          <div class="linea-icono">
            <img src="${escapar(img.src)}" data-respaldos="${img.respaldos}" alt="">
          </div>
          <div class="linea-info">
            <strong>${escapar(l.prod.nombre)}</strong>
            <span>${esGranel(l.prod)
              ? precioPor(l.prod)
              : escapar(l.prod.presentacion) + ' · ' + precioPor(l.prod)}</span>
            <div class="atajos" role="group" aria-label="Cantidad de ${escapar(l.prod.nombre)}">
              ${atajosDe(l).map((n) => `<button class="atajo${n === l.cantidad ? ' activo' : ''}"
                 data-fijar="${l.id}" data-n="${n}"
                 aria-pressed="${n === l.cantidad}">${esGranel(l.prod) ? enPeso(n) : n}</button>`).join('')}
            </div>
            <div class="contador">
              <button data-menos="${l.id}" aria-label="Quitar">−</button>
              ${esGranel(l.prod)
                // Cantidad libre: el que pide 170 g existe, y con solo botones
                // no tenía forma de pedirlo. El campo es la puerta de atrás de
                // las presentaciones, no su reemplazo.
                ? `<span class="cant-libre">
                     <input type="number" data-gramos="${l.id}" value="${l.cantidad}"
                            min="1" max="${l.prod.stock}" step="10"
                            aria-label="Gramos de ${escapar(l.prod.nombre)}"><i>g</i>
                   </span>`
                : `<span data-cant="${l.id}">${l.cantidad}</span>`}
              <button data-mas="${l.id}" aria-label="Agregar" ${tope ? 'disabled' : ''}>+</button>
              ${tope ? '<em class="tope">máximo en stock</em>' : ''}
            </div>
          </div>
          <div class="linea-derecha">
            <div class="linea-total">${soles(importe(l.prod, l.cantidad))}</div>
            <button class="quitar" data-quitar="${l.id}" aria-label="Eliminar">Eliminar</button>
          </div>
        </div>`;
      }).join('');

      const envio = costoEnvio(total());
      const t = total() + envio.monto;
      const pct = TIENDA.igv?.porcentaje ?? 0;

      // En Perú el precio de catálogo ya incluye IGV, así que el desglose se
      // calcula hacia atrás: base = total / (1 + tasa). Mostrarlo no cambia lo
      // que paga el cliente, pero es lo que un comprobante tiene que reflejar.
      const base = pct ? t / (1 + pct / 100) : t;
      const igv = t - base;

      pie.innerHTML = `
        <div class="resumen">
          <div class="resumen-fila"><span>Subtotal</span><span>${soles(total())}</span></div>
          <div class="resumen-fila"><span>Envío</span><span>${envio.texto}</span></div>
          ${pct ? `
          <div class="resumen-fila resumen-fino"><span>Op. gravada</span><span>${soles(base)}</span></div>
          <div class="resumen-fila resumen-fino"><span>IGV ${pct}%</span><span>${soles(igv)}</span></div>` : ''}
          <div class="resumen-fila resumen-total">
            <span>Total</span><span class="precio">${soles(t)}</span>
          </div>
        </div>
        <button class="btn btn-primario btn-bloque" id="btn-datos">Continuar con el pedido</button>
        <p class="pie-nota">Pago contra entrega o por Yape al recibir.</p>`;
      $('btn-datos').onclick = () => { etapa = 'datos'; pintarPanel(); };
      return;
    }

    // etapa === 'datos'
    cuerpo.innerHTML = `
      <div class="aviso aviso-error" id="error-forma" hidden></div>

      <div class="grupo-campos">
        <h4>¿A nombre de quién va el comprobante?</h4>
        <div class="pestanas" id="tipo-doc">
          <button type="button" class="pestana activo" data-doc="DNI">Boleta · DNI</button>
          <button type="button" class="pestana" data-doc="RUC">Factura · RUC</button>
        </div>

        <div class="campo"><label for="f-nombre" id="lbl-nombre">Nombre y apellido</label>
          <input id="f-nombre" autocomplete="name" placeholder="María Quispe" maxlength="120"></div>

        <div class="campo"><label for="f-doc" id="lbl-doc">DNI</label>
          <input id="f-doc" inputmode="numeric" maxlength="11" placeholder="8 dígitos"></div>

        <div class="campo" id="campo-razon" hidden>
          <label for="f-razon">Razón social</label>
          <input id="f-razon" placeholder="Comercial Los Andes S.A.C." maxlength="120"></div>

        <div class="campo"><label for="f-tel">Celular</label>
          <input id="f-tel" inputmode="tel" autocomplete="tel" placeholder="9XX XXX XXX" maxlength="15"></div>

        <div class="campo"><label for="f-email" id="lbl-email">Correo (opcional)</label>
          <input id="f-email" type="email" inputmode="email" autocomplete="email"
                 placeholder="para enviarte el comprobante" maxlength="120"></div>
      </div>

      <div class="grupo-campos">
        <h4>${hayRecojo() ? '¿Cómo lo recibes?' : '¿Dónde te lo dejamos?'}</h4>
        ${hayRecojo() ? `
        <div class="pestanas" id="modo-entrega">
          <button type="button" class="pestana activo" data-modo="recojo">Local</button>
          <button type="button" class="pestana" data-modo="envio">Domicilio</button>
        </div>` : ''}

        <div class="aviso-local" id="aviso-local" hidden></div>

        <!-- Todo lo que solo tiene sentido si el pedido sale a la calle. Con
             recojo se esconde entero: preguntarle el distrito a quien va a
             pasar por el puesto es pedirle datos para nada. -->
        <div id="campos-envio">
          <div class="campo-doble">
            <div class="campo"><label for="f-dep">Departamento</label>
              <select id="f-dep"><option value="">Elige…</option></select></div>
            <div class="campo"><label for="f-prov">Provincia</label>
              <select id="f-prov" disabled><option value="">—</option></select></div>
          </div>
          <div class="campo"><label for="f-dist">Distrito</label>
            <select id="f-dist" disabled><option value="">—</option></select></div>

          <div class="campo"><label for="f-dir">Dirección</label>
            <input id="f-dir" autocomplete="street-address" placeholder="Av. Los Álamos 234, dpto. 302" maxlength="200"></div>
          <div class="campo"><label for="f-ref">Referencia (opcional)</label>
            <input id="f-ref" placeholder="Frente al parque, portón verde" maxlength="200"></div>

          <div class="envio-aviso" id="envio-calculado" hidden></div>
        </div>

        <!-- La nota vale en los dos casos: "paso después de las 5" es tan útil
             como "dejar con el portero". -->
        <div class="campo"><label for="f-nota">Nota para el pedido (opcional)</label>
          <textarea id="f-nota" placeholder="Ej: dejar con el portero" maxlength="300"></textarea></div>
      </div>

      <div class="resumen" id="resumen-final"></div>`;

    pie.innerHTML = `
      <button class="btn btn-primario btn-bloque" id="btn-confirmar">Confirmar pedido</button>
      <button class="btn btn-secundario btn-bloque" style="margin-top:8px" id="btn-volver">Volver al carrito</button>`;

    $('btn-volver').onclick = () => { etapa = 'carrito'; pintarPanel(); };
    $('btn-confirmar').onclick = confirmar;
    aplicarModoEntrega();
    prepararFormulario();
  }

  // ------------------------------------------------------- checkout peruano
  let UBIGEO = null;
  let envioActual = null;

  /** El ubigeo se descarga una sola vez, al abrir el checkout. */
  async function cargarUbigeo() {
    if (UBIGEO) return UBIGEO;
    try {
      UBIGEO = await (await fetch('/ubigeo.json')).json();
    } catch { UBIGEO = {}; }
    return UBIGEO;
  }

  function opciones(select, valores, vacio) {
    select.innerHTML = `<option value="">${vacio}</option>` +
      valores.map((v) => `<option value="${escapar(v)}">${escapar(v)}</option>`).join('');
    select.disabled = valores.length === 0;
  }

  async function prepararFormulario() {
    const datos = await cargarUbigeo();
    if (!$('f-dep')) return;   // el usuario cerró el panel mientras cargaba

    const deps = Object.values(datos)
      .map(([nombre], i) => ({ nombre, clave: Object.keys(datos)[i] }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    opciones($('f-dep'), deps.map((d) => d.nombre), 'Elige…');

    $('f-dep').onchange = () => {
      const dep = Object.values(datos).find(([n]) => n === $('f-dep').value);
      opciones($('f-prov'), dep ? dep[1].map((p) => p[0]) : [], dep ? 'Elige…' : '—');
      opciones($('f-dist'), [], '—');
      cotizarEnvio();
    };
    $('f-prov').onchange = () => {
      const dep = Object.values(datos).find(([n]) => n === $('f-dep').value);
      const prov = dep?.[1].find((p) => p[0] === $('f-prov').value);
      opciones($('f-dist'), prov ? prov[1] : [], prov ? 'Elige…' : '—');
      cotizarEnvio();
    };
    $('f-dist').onchange = cotizarEnvio;

    // Cambiar entre boleta y factura reetiqueta el formulario: es el mismo
    // campo, pero "DNI" y "RUC" no piden lo mismo ni tienen el mismo largo.
    $('tipo-doc').onclick = (e) => {
      const b = e.target.closest('[data-doc]');
      if (!b) return;
      const esRuc = b.dataset.doc === 'RUC';
      [...$('tipo-doc').children].forEach((x) => x.classList.toggle('activo', x === b));
      $('lbl-doc').textContent = esRuc ? 'RUC' : 'DNI';
      $('f-doc').placeholder = esRuc ? '11 dígitos' : '8 dígitos';
      $('f-doc').maxLength = esRuc ? 11 : 8;
      $('f-doc').value = '';
      $('campo-razon').hidden = !esRuc;
      $('lbl-nombre').textContent = esRuc ? 'Nombre de contacto' : 'Nombre y apellido';
      $('lbl-email').textContent = esRuc ? 'Correo' : 'Correo (opcional)';
    };

    if ($('modo-entrega')) {
      $('modo-entrega').onclick = (e) => {
        const b = e.target.closest('[data-modo]');
        if (!b) return;
        [...$('modo-entrega').children].forEach((x) => x.classList.toggle('activo', x === b));
        aplicarModoEntrega();
      };
    }

    // Solo dígitos en el documento: evita el 90 % de los errores de tipeo.
    $('f-doc').oninput = (e) => { e.target.value = e.target.value.replace(/\D/g, ''); };

    pintarResumenFinal();
  }

  const tipoDoc = () => $('tipo-doc')?.querySelector('.activo')?.dataset.doc || 'DNI';

  /** Lo ofrece la tienda, no el carrito: sale de tienda.config.js. */
  const hayRecojo = () => !!TIENDA.delivery?.recojoEnTienda;

  /**
   * El recojo viene marcado de entrada.
   *
   * El negocio es un puesto de mercado y la mayoría de sus clientes compra a
   * unas cuadras: arrancar en «Domicilio» les hacía llenar cuatro campos y
   * pagar flete para algo que iban a ir a buscar igual. El que sí quiere
   * reparto lo cambia de un toque y recupera el formulario entero.
   *
   * El `|| 'envio'` no es el defecto: es el caso en que la tienda NO ofrece
   * recojo y no hay selector que leer. Ahí lo único posible es el envío.
   */
  const modoEntrega = () => $('modo-entrega')?.querySelector('.activo')?.dataset.modo || 'envio';

  /**
   * Muestra u oculta la mitad del formulario que es del reparto, y en su lugar
   * pone donde queda el local. Al que recoge hay que decirle adonde ir y a que
   * hora: sin eso, «recojo en el local» es una casilla que no informa nada.
   */
  function aplicarModoEntrega() {
    const recojo = modoEntrega() === 'recojo';

    if ($('campos-envio')) $('campos-envio').hidden = recojo;

    const caja = $('aviso-local');
    if (caja) {
      caja.hidden = !recojo;
      caja.innerHTML = recojo ? `
        <strong>Pasa por el local y te lo entregamos</strong>
        <span>${escapar(TIENDA.direccion || '')}${
          TIENDA.referencia ? ' — ' + escapar(TIENDA.referencia) : ''}</span>
        <span>${escapar(TIENDA.horario || '')} · sin costo de envío</span>` : '';
    }

    pintarResumenFinal();
  }

  /** Pregunta al servidor cuánto cuesta el envío a ese distrito. */
  async function cotizarEnvio() {
    const dep = $('f-dep')?.value, prov = $('f-prov')?.value, dist = $('f-dist')?.value;
    const caja = $('envio-calculado');
    if (!caja) return;

    if (!dep || !prov || !dist) {
      envioActual = null; caja.hidden = true; pintarResumenFinal(); return;
    }

    try {
      const r = await fetch('/api/envio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ departamento: dep, provincia: prov, distrito: dist, subtotal: total() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);

      envioActual = d;
      caja.hidden = false;
      caja.className = 'envio-aviso' + (d.gratis ? ' logrado' : '');
      caja.innerHTML = d.tipo === 'provincia'
        ? `<span><strong>${escapar(d.zona)}</strong> — envío por agencia, ${escapar(d.plazo)}.
           ${escapar(d.nota)}.</span>`
        : `<span><strong>${escapar(d.zona)}</strong> — ${d.gratis ? 'envío gratis' : soles(d.costo)},
           ${escapar(d.plazo)}.</span>` +
          (d.faltaParaGratis > 0
            ? `<div class="envio-barra"><i style="width:${Math.min(100, Math.round(total() / (total() + d.faltaParaGratis) * 100))}%"></i></div>`
            : '');
    } catch {
      envioActual = null; caja.hidden = true;
    }
    pintarResumenFinal();
  }

  function pintarResumenFinal() {
    const caja = $('resumen-final');
    if (!caja) return;
    const recojo = modoEntrega() === 'recojo';
    const envio = recojo || !envioActual || envioActual.costo === null ? 0 : envioActual.costo;
    const t = total() + envio;
    const pct = TIENDA.igv?.porcentaje ?? 0;
    const base = pct ? t / (1 + pct / 100) : t;

    caja.innerHTML = `
      <div class="resumen-fila"><span>Subtotal</span><span>${soles(total())}</span></div>
      <div class="resumen-fila"><span>Envío</span><span>${
        recojo ? 'lo recoges tú'
          : !envioActual ? 'elige tu distrito'
          : envioActual.costo === null ? 'en la agencia'
          : envioActual.gratis ? 'Gratis' : soles(envioActual.costo)}</span></div>
      ${pct ? `
      <div class="resumen-fila resumen-fino"><span>Op. gravada</span><span>${soles(base)}</span></div>
      <div class="resumen-fila resumen-fino"><span>IGV ${pct}%</span><span>${soles(t - base)}</span></div>` : ''}
      <div class="resumen-fila resumen-total">
        <span>${tipoDoc() === 'RUC' ? 'Total (factura)' : 'Total (boleta)'}</span>
        <span class="precio">${soles(t)}</span>
      </div>`;
  }

  async function confirmar() {
    const err = $('error-forma');
    const boton = $('btn-confirmar');
    err.hidden = true;
    boton.disabled = true;
    boton.textContent = 'Registrando…';

    try {
      const r = await fetch('/api/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente: {
            nombre: $('f-nombre').value,
            telefono: $('f-tel').value,
            direccion: $('f-dir').value,
            // Datos peruanos. El servidor los revalida: esto es solo lo que
            // se envía, no lo que se da por bueno.
            tipo_doc: tipoDoc(),
            num_doc: $('f-doc').value,
            razon_social: $('f-razon').value,
            email: $('f-email').value,
            departamento: $('f-dep').value,
            provincia: $('f-prov').value,
            distrito: $('f-dist').value,
            referencia: $('f-ref').value,
          },
          nota: $('f-nota').value,
          entrega: modoEntrega(),
          items: carrito,
        }),
      });
      const datos = await r.json();

      if (!r.ok) {
        let mensaje = datos.error || 'No pudimos registrar el pedido.';
        if (datos.faltantes) {
          mensaje += ' ' + datos.faltantes
            .map((f) => `${f.nombre}: pediste ${f.pedido}, quedan ${f.disponible}`)
            .join('. ');
          await cargarCatalogo();
        }
        err.textContent = mensaje;
        err.hidden = false;
        return;
      }

      ultimoPedido = datos.pedido;
      // Los últimos cuatro dígitos del teléfono que acaba de escribir son la
      // otra mitad de la llave de su pedido. Guardarlos aquí le evita volver a
      // teclearlos para abrir su propia boleta.
      ultimoPedido.tel4 = $('f-tel').value.replace(/\D/g, '').slice(-4);
      etapa = 'exito';
      carrito = [];
      guardarCarrito();
      refrescarCuenta();
      await cargarCatalogo();
      pintarPanel();
    } catch {
      err.textContent = 'Se perdió la conexión con la tienda. Intenta otra vez.';
      err.hidden = false;
    } finally {
      boton.disabled = false;
      boton.textContent = 'Confirmar pedido';
    }
  }

  // --------------------------------------------------------------------- asesor
  async function consultarAsesor(texto) {
    const caja = $('respuesta-asesor');
    const boton = $('btn-asesor');
    caja.hidden = false;
    $('burbuja').textContent = 'Revisando el inventario…';
    $('fuente-asesor').textContent = '';
    $('fichas-asesor').innerHTML = '';
    boton.disabled = true;

    try {
      const r = await fetch('/api/asesor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consulta: texto }),
      });
      const datos = await r.json();
      $('burbuja').textContent = datos.mensaje || datos.error;

      const recomendados = datos.recomendaciones || [];
      const ids = recomendados.map((x) => x.id);

      // Las fichas van dentro de la respuesta. Antes había que bajar al catálogo
      // a buscar lo recomendado: la venta se enfriaba en el camino.
      $('fichas-asesor').innerHTML = recomendados.map((p) => {
        const img = imagenDe(p);
        const completo = catalogo.find((x) => x.id === p.id) || p;
        const agotado = completo.stock <= 0;
        return `
        <article class="ficha-asesor">
          <img src="${escapar(img.src)}" data-respaldos="${img.respaldos}" alt="${escapar(p.nombre)}">
          <div class="ficha-cuerpo">
            <strong>${escapar(p.nombre)}</strong>
            <span class="ficha-origen">${escapar(p.origen)}</span>
            <div class="ficha-pie">
              <span class="ficha-precio">${soles(p.precio)}</span>
              <button class="btn btn-primario btn-chico agregar" data-id="${p.id}" ${agotado ? 'disabled' : ''}>
                ${agotado ? 'Sin stock' : 'Agregar'}
              </button>
            </div>
          </div>
        </article>`;
      }).join('');

      $('fuente-asesor').textContent = ids.length
        ? `Verificado contra el stock de hoy · ${ids.length} disponible(s)`
        : 'Verificado contra el stock de hoy';

      pintarGrilla(ids);
    } catch {
      $('burbuja').textContent = 'No pudimos consultar en este momento. Intenta de nuevo.';
      $('fichas-asesor').innerHTML = '';
    } finally {
      boton.disabled = false;
    }
  }

  // ---------------------------------------------------------------- cableado
  document.addEventListener('click', (e) => {
    const agregarBtn = e.target.closest('.agregar');
    if (agregarBtn) return agregar(Number(agregarBtn.dataset.id), agregarBtn);

    if (e.target.closest('#btn-ver-mas')) {
      mostrando += TANDA;
      pintarGrilla();
      return;
    }

    const filtroBtn = e.target.closest('.filtro');
    if (filtroBtn) {
      filtro = filtroBtn.dataset.cat;
      mostrando = TANDA;             // otra categoría empieza desde arriba
      pintarFiltros();
      pintarGrilla();
      return;
    }

    const sug = e.target.closest('.sugerencia');
    if (sug) {
      $('consulta').value = sug.textContent;
      return consultarAsesor(sug.textContent);
    }

    const atajo = e.target.closest('[data-fijar]');
    if (atajo) return fijar(Number(atajo.dataset.fijar), Number(atajo.dataset.n));

    // El campo de gramos no dispara «click»; se atiende por separado más abajo.

    if (e.target.dataset.mas) return cambiar(Number(e.target.dataset.mas), 1);
    if (e.target.dataset.menos) return cambiar(Number(e.target.dataset.menos), -1);
    if (e.target.dataset.quitar) return quitar(Number(e.target.dataset.quitar));
  });

  /**
   * La cantidad escrita a mano, en gramos.
   *
   * Se aplica al salir del campo y con Enter, no en cada tecla: repintando a
   * cada pulsación, escribir «250» reordenaría la lista tres veces y el campo
   * perdería el foco a mitad del número.
   */
  document.addEventListener('change', (e) => {
    const campo = e.target.closest('[data-gramos]');
    if (!campo) return;
    fijar(Number(campo.dataset.gramos), Math.round(Number(campo.value)));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.closest('[data-gramos]')) e.target.blur();
  });

  if ($('panel-carrito')) {
    $('btn-carrito').onclick = abrirPanel;
    $('cerrar-carrito').onclick = cerrarPanel;
    $('velo').onclick = cerrarPanel;
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarPanel(); });
  }

  if ($('forma-asesor')) {
    $('forma-asesor').onsubmit = (e) => {
      e.preventDefault();
      const texto = $('consulta').value.trim();
      if (texto) consultarAsesor(texto);
    };
  }

  const buscar = $('buscar');
  if (buscar) {
    let debounce;
    buscar.oninput = (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { busqueda = e.target.value; mostrando = TANDA; pintarGrilla(); }, 180);
    };
  }

  // La tienda puede abrir ya filtrada: ?q= busca, ?cat= elige la categoría. Es
  // como llegan las tarjetas de «Qué encontrarás» de la portada. Una categoría
  // que no exista simplemente no encuentra nada y el botón «Todos» la deshace.
  if (ES_TIENDA) {
    const params = new URLSearchParams(location.search);
    const q = params.get('q');
    if (q && buscar) { buscar.value = q; busqueda = q; }
    if (params.get('cat')) filtro = params.get('cat');
  }

  refrescarCuenta();
  cargarCatalogo();
})();
