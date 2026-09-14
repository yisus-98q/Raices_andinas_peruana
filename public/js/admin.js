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

  /**
   * Venta a granel, igual que en la tienda.
   *
   * El precio de ficha es por 100 g y el stock cuenta gramos. Las fórmulas
   * viven aquí y no repartidas por cada plantilla: un precio calculado de dos
   * maneras distintas en dos pantallas es cómo se termina cobrando mal.
   */
  const BASE_GRANEL = 100;
  const esGranel = (p) => p?.unidad === 'gramo';
  const importe = (p, cant) => (esGranel(p) ? p.precio * cant / BASE_GRANEL : p.precio * cant);
  const costoDe = (p, cant) => (esGranel(p) ? (p.costo || 0) * cant / BASE_GRANEL : (p.costo || 0) * cant);
  const enPeso = (g) => (g >= 1000 && g % 1000 === 0 ? `${g / 1000} kg` : `${g} g`);
  /** Cuánto hay, dicho en su unidad. */
  const existencia = (p) => (esGranel(p) ? enPeso(p.stock) : String(p.stock));
  /** Y cómo se dice su precio. */
  const precioPor = (p) => (esGranel(p) ? `${soles(p.precio)} / ${enPeso(BASE_GRANEL)}` : soles(p.precio));

  let ultimosPedidos = [];
  let ultimosProductos = [];
  let ultimosComprobantes = [];
  let filtro = '';
  let filtroProducto = '';
  let verBajas = false;
  let filtroCliente = '';
  /**
   * Quien esta mirando. El servidor ya corta por su cuenta —ocultar botones no
   * es seguridad—, pero un panel lleno de controles que devuelven 403 se siente
   * roto. Esto es cortesia, no cerradura.
   */
  let esDueno = true;
  /**
   * El motorizado. Entra al mismo panel, pero lo suyo son dos cosas: la lista
   * de lo que tiene que llevar y el botón de entregado. Todo lo demás se le
   * quita de la vista, y el servidor además se lo niega si lo pide a mano.
   */
  let esReparto = false;

  /**
   * Qué bloques ve cada rol.
   *
   * En una tabla y no escondiendo bloques sueltos por ahí: así se lee de un
   * vistazo quién ve qué, y agregar una sección obliga a decidir de quién es en
   * vez de que aparezca para todos por olvido.
   *
   *  - La **dueña** ve todo: es su negocio.
   *  - La **vendedora** ve lo que necesita para atender a quien tiene delante:
   *    cobrar, ver los pedidos del día, saber qué se mueve y quién es el
   *    cliente que entró. Nada de lo que se administra desde atrás.
   *  - El **reparto** ve su ruta. Su teléfono sale a la calle todos los días.
   *
   * null es «todo». Esconder no protege nada —el servidor es el que corta—,
   * pero un panel que ofrece diez sitios a quien solo usa cuatro esconde los
   * cuatro que importan entre los otros seis.
   */
  const BLOQUES_POR_ROL = {
    admin: null,
    // Sin `bloque-resumen`: la caja del día, la ganancia y el valor del
    // inventario son las tres cifras que resumen el negocio, y el negocio es
    // de la dueña. La vendedora entra directo a vender.
    vendedor: ['bloque-mostrador', 'bloque-pedidos', 'bloque-top', 'bloque-clientes'],
    reparto: ['bloque-pedidos'],
  };

  /** Todos los bloques del panel, para saber cuáles apagar. */
  const TODOS_LOS_BLOQUES = () =>
    [...document.querySelectorAll('.bloque')].map((b) => b.id).filter(Boolean);

  /**
   * Las cuatro áreas del panel, y qué bloque vive en cada una.
   *
   * Doce bloques uno debajo de otro obligaban a bajar buscando. Ahora se ve un
   * área por vez, entera en la pantalla, y se cambia por la barra del costado.
   * No son categorías de software: son las preguntas con las que alguien abre
   * el panel.
   *
   *   1. RESUMEN     — cómo va el día. Es la principal: es a lo que se entra.
   *   2. VENDER HOY  — lo que está pasando ahora: cobrar, despachar, el papel
   *                    del cliente que llama preguntando por su boleta.
   *   3. INVENTARIO  — qué hay, qué falta y por qué cambió.
   *   4. EL NEGOCIO  — cómo viene la cosa, y que exista una copia.
   *
   * La lista de ids está aquí y no leída del DOM a propósito: agregar una
   * sección obliga a decidir en qué área vive, en vez de que quede invisible
   * por olvido.
   */
  const AREAS = [
    { id: 'area-resumen', nombre: 'Resumen', hace: 'Cómo va el día',
      bloques: ['bloque-resumen'] },
    { id: 'area-vender', nombre: 'Vender hoy', hace: 'Cobrar y despachar',
      bloques: ['bloque-mostrador', 'bloque-pedidos', 'bloque-comprobantes'] },
    { id: 'area-inventario', nombre: 'Inventario', hace: 'Qué hay y qué falta',
      bloques: ['bloque-stock', 'bloque-movimientos', 'bloque-cambios', 'bloque-catalogo'] },
    { id: 'area-negocio', nombre: 'El negocio', hace: 'Cómo viene la cosa',
      bloques: ['bloque-calendario', 'bloque-clientes', 'bloque-top', 'bloque-respaldo'] },
  ];

  /** Un área sin ningún bloque visible para este rol no se ofrece. */
  const areaTieneAlgo = (a) => a.bloques.some((b) => $(b) && !$(b).hidden);

  // El resumen es la principal. Quien no lo tenga —la vendedora, el reparto—
  // cae en la primera que sí tenga, y de eso se encarga `mostrarArea`.
  let areaActiva = 'area-resumen';

  function mostrarArea(id) {
    const conAlgo = AREAS.filter(areaTieneAlgo);
    if (!conAlgo.length) return;
    if (!conAlgo.some((a) => a.id === id)) id = conAlgo[0].id;
    areaActiva = id;

    for (const a of AREAS) {
      if ($(a.id)) $(a.id).hidden = a.id !== id;
    }
    pintarAreas();
  }

  /**
   * La barra del costado. Se pinta según lo que el rol pueda ver, así que a la
   * vendedora le salen las suyas y nunca una sección vacía.
   */
  function pintarAreas() {
    const conAlgo = AREAS.filter(areaTieneAlgo);
    const caja = $('areas');
    if (!caja) return;
    // Con una sola área no hay nada que elegir: la barra sobra.
    caja.hidden = conAlgo.length < 2;
    pintar('areas', conAlgo.map((a) => `
      <button class="area-tab${a.id === areaActiva ? ' activa' : ''}"
              data-area="${a.id}" aria-current="${a.id === areaActiva}">
        <strong>${a.nombre}</strong>
        <span>${a.hace}</span>
      </button>`).join(''));
  }

  /**
   * El recorrido del pedido, de un toque por paso.
   *
   * Son los mismos tres pasos que el comprador ve encenderse en su página de
   * seguimiento —«En preparación», «En camino», «Entregado»—, y por eso el
   * botón dice adónde va: quien pulsa sabe exactamente qué le acaba de
   * aparecer al otro en el teléfono.
   *
   * Lo usan los tres roles. Nació para el motorizado, pero la pregunta que
   * resuelve —«¿este en qué va, y qué sigue?»— es la misma en el mostrador con
   * el cliente delante, y era absurdo que el panel la contestara de dos formas
   * distintas según quién mirara.
   */
  const PASO_PEDIDO = {
    pendiente: 'preparando',
    preparando: 'enviado',
    enviado: 'entregado',
  };
  /**
   * Lo que el comprador va a leer en su seguimiento cuando se pulse.
   *
   * El botón no dice «marcar X»: dice en qué estado está el pedido AHORA y,
   * debajo, adónde lo manda el toque. En la puerta de un cliente la pregunta
   * que se hace el motorizado es «¿este cuál era?», y la respuesta tiene que
   * estar en el mismo sitio que se pulsa.
   */
  const SIGUIENTE_PEDIDO = {
    preparando: 'en preparación',
    enviado: 'en camino',
    entregado: 'entregado',
  };
  /**
   * El carrito del mostrador: id del producto -> cuantas unidades.
   *
   * Vive fuera de `cargar()` porque el panel se refresca solo cada 15 s, y una
   * venta a medias no puede borrarse mientras el cliente espera el vuelto.
   */
  const carrito = new Map();
  let buscaMostrador = '';
  /**
   * Ficha que se esta editando, o `null` si el dialogo es un alta. El mismo
   * formulario sirve para las dos cosas: son los mismos catorce campos, y
   * mantener dos formularios gemelos garantiza que un dia se les pida algo
   * distinto por error.
   */
  let editando = null;
  // Mes que se esta mirando en el calendario y documento del cliente abierto.
  // Viven fuera de `cargar()` porque el panel se refresca solo cada 15 s: si se
  // guardaran dentro, mirar agosto o el historial de alguien duraria hasta el
  // siguiente refresco.
  let mesVisto = null;
  let clienteAbierto = null;
  let ultimosClientes = [];
  let historial = {};

  let temporizador;
  function avisar(texto) {
    const t = $('toast');
    t.textContent = texto;
    t.classList.add('visible');
    clearTimeout(temporizador);
    temporizador = setTimeout(() => t.classList.remove('visible'), 2600);
  }

  // El evento `error` de una imagen no burbujea, pero sí se captura. Un solo
  // oyente cubre todas, incluidas las que aún no existen. Sustituye a los
  // atributos onerror en línea, que la CSP estricta bloquea.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG' || img.dataset.respaldo !== '1') return;
    delete img.dataset.respaldo;
    img.src = '/img/placeholder.svg';
  }, true);

  const horaCorta = (iso) => (iso || '').slice(11, 16);
  const soloFecha = (iso) => (iso || '').slice(0, 10);

  /**
   * Repinta solo si el contenido cambió, y conserva el scroll.
   *
   * El panel se refresca cada 15 s. Como `lista-pedidos` ES el contenedor con
   * scroll, reemplazar su innerHTML lo devolvía arriba: el dueño leía el pedido
   * número 15 y a los quince segundos saltaba al principio. Comparar el HTML
   * antes de escribirlo elimina además el parpadeo cuando no pasó nada.
   */
  function pintar(id, html) {
    const el = $(id);
    if (el.dataset.firma === html) return;

    // Si el dueño está escribiendo dentro de este bloque —un precio, una
    // cantidad— repintarlo le borraría lo tecleado. Se deja para después:
    // el refresco vuelve en 15 s, y en cuanto salga del campo se actualiza.
    const foco = document.activeElement;
    if (foco && foco !== document.body && el.contains(foco)
        && (foco.tagName === 'INPUT' || foco.tagName === 'TEXTAREA')) {
      el.dataset.pendiente = html;
      return;
    }

    const y = el.scrollTop;
    el.innerHTML = html;
    el.dataset.firma = html;
    delete el.dataset.pendiente;
    el.scrollTop = y;
  }

  // Al soltar el campo se aplica el repintado que quedó pendiente.
  document.addEventListener('focusout', (e) => {
    const bloque = e.target.closest?.('[data-pendiente]');
    if (!bloque) return;
    setTimeout(() => {
      if (bloque.contains(document.activeElement)) return;   // saltó a otro campo
      const html = bloque.dataset.pendiente;
      if (html === undefined) return;
      bloque.innerHTML = html;
      bloque.dataset.firma = html;
      delete bloque.dataset.pendiente;
    }, 0);
  });

  const alLogin = () =>
    location.replace('/login.html?volver=' + encodeURIComponent(location.pathname));

  /** Si la sesión venció mientras el panel estaba abierto, al login. */
  async function pedir(ruta) {
    const r = await fetch(ruta);
    if (r.status === 401) { alLogin(); throw new Error('sin sesión'); }
    return r.json();
  }

  async function cargar() {
    try {
      // La bitacora de fichas y el respaldo son del dueño: al mostrador le
      // responderian 403. No se piden en vez de pedirlos y descartar la
      // respuesta — pedir lo que se sabe prohibido llena el registro del
      // servidor de 403 que no son un intento de nada.
      // No se pide lo que se sabe prohibido: llena el registro del servidor de
      // 403 que no son un intento de nada, y esconde los que sí lo serían. Cada
      // rol pide exactamente lo que su panel va a pintar.
      const delPuesto = (ruta, vacio) => (esReparto ? vacio : pedir(ruta));
      const soloDuena = (ruta, vacio) => (esDueno ? pedir(ruta) : vacio);

      const [resumen, pedidos, movimientos, productos, comprobantes,
        cal, clientes, cambios, resp] = await Promise.all([
        delPuesto('/api/admin/resumen', null),
        pedir('/api/pedidos'),
        soloDuena('/api/admin/movimientos', []),
        delPuesto('/api/admin/productos', []),
        pedir('/api/admin/comprobantes'),
        soloDuena('/api/admin/calendario' + (mesVisto ? '?mes=' + mesVisto : ''), null),
        delPuesto('/api/admin/clientes', []),
        esDueno ? pedir('/api/admin/cambios') : [],
        esDueno ? pedir('/api/admin/respaldos') : null,
      ]);
      ultimosPedidos = pedidos;
      ultimosProductos = productos;
      // Los comprobantes se guardan porque cada pedido enlaza al suyo.
      ultimosComprobantes = comprobantes;
      if (resumen) {
        pintarTop(resumen.top_productos);
        if (esDueno) {
          pintarKpis(resumen);
          pintarStock(resumen.bajo_stock);
        }
      }
      pintarPedidos();
      pintarComprobantes(comprobantes);
      if (!esReparto) {
        pintarProductos();
        ultimosClientes = clientes;
        pintarClientes();
      }
      if (esDueno) {
        pintarMovimientos(movimientos);
        pintarCambios(cambios);
        pintarCalendario(cal);
      }
      if (resp) pintarRespaldo(resp);
      pintarMostrador();
      $('hora').textContent = new Date().toLocaleTimeString('es-PE',
        { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      if (e.message !== 'sin sesión') avisar('No se pudo conectar con el servidor');
    }
  }

  async function identificar() {
    try {
      const s = await pedir('/api/sesion');
      esDueno = s.rol === 'admin';
      esReparto = s.rol === 'reparto';

      const papel = esDueno ? '' : esReparto ? ' · reparto' : ' · mostrador';
      $('quien').textContent = s.nombre + papel;

      if (!esDueno) {
        // El respaldo y el alta de fichas son del dueño. Se quitan del todo en
        // vez de dejarlos deshabilitados: un boton apagado invita a preguntar
        // por que, y la respuesta no le sirve a quien esta atendiendo.
        $('bloque-respaldo').hidden = true;
        $('abrir-alta').hidden = true;
      }

      const suyos = BLOQUES_POR_ROL[s.rol];
      if (suyos) {
        for (const id of TODOS_LOS_BLOQUES()) {
          if (!suyos.includes(id) && $(id)) $(id).hidden = true;
        }
      }

      if (esReparto) {
        // Los indicadores de arriba son la caja del día, la ganancia y el valor
        // del inventario: las tres cifras que resumen el negocio. El reparto
        // lleva este panel abierto en la calle, en un teléfono que se presta y
        // se pierde.
        $('kpis').hidden = true;
        // Y el bloque que le queda se llama por lo que es para él. Un panel con
        // un solo bloque titulado «Pedidos recientes» parece un panel roto.
        const titulo = document.querySelector('#bloque-pedidos h2');
        if (titulo) titulo.textContent = 'Mi ruta de hoy';
      }

      // Con los bloques del rol ya decididos se sabe qué áreas quedan en pie.
      mostrarArea(areaActiva);
    } catch { /* pedir() ya redirigió */ }
  }

  // --------------------------------------------------------------------- KPI
  function pintarKpis(r) {
    const tarjetas = [
      {
        etiqueta: 'Ventas de hoy', valor: soles(r.ventas_hoy),
        // Los dos canales, separados: es lo que permite comprobar que el
        // stock cuadra. Si vendio 3 en el local y 2 por la web, el inventario
        // tuvo que bajar 5.
        nota: `${soles(r.ventas_local_hoy)} en el local · ${soles(r.ventas_web_hoy)} por la web`,
      },
      // La ganancia del dia solo le llega al dueño. Al mostrador, la cola.
      r.ganancia_hoy === undefined
        ? { etiqueta: 'Por atender', valor: r.pedidos_pendientes, nota: 'pendientes y en preparación' }
        : {
          etiqueta: 'Ganancia de hoy', valor: soles(r.ganancia_hoy),
          nota: `${r.pedidos_pendientes} pedido(s) por atender`,
        },
      /**
       * La alarma de reposición solo para quien puede apagarla.
       *
       * A la vendedora se le quitó el bloque de reposición, así que la tarjeta
       * le quedaría avisando de diecinueve productos por acabarse sin ningún
       * sitio adonde ir a resolverlo. Una alarma que no se puede atender se
       * aprende a ignorar, y con ella se ignoran las demás.
       */
      ...(esDueno ? [{
        etiqueta: 'Reposición urgente', valor: r.bajo_stock.length,
        nota: r.agotados ? `${r.agotados} ya agotado(s)` : 'ninguno agotado aún',
        alerta: r.bajo_stock.length > 0,
      }] : []),
      // El valor del inventario esta calculado a costo: es el costo del
      // catalogo entero en una cifra. Para el mostrador la tarjeta cuenta las
      // unidades, que es lo que necesita para saber si hay que reponer.
      r.valor_inventario === undefined
        ? {
          etiqueta: 'Unidades en tienda',
          valor: r.unidades_inventario.toLocaleString('es-PE'),
          nota: 'sumando todo el catálogo',
        }
        : {
          etiqueta: 'Valor del inventario', valor: soles(r.valor_inventario),
          nota: `${r.unidades_inventario} unidades a costo`,
        },
    ];
    pintar('kpis', tarjetas.map((t) => `
      <div class="kpi${t.alerta ? ' alerta' : ''}">
        <div class="kpi-etiqueta">${t.etiqueta}</div>
        <div class="kpi-valor">${t.valor}</div>
        <div class="kpi-nota">${t.nota}</div>
      </div>`).join(''));
  }

  // ---------------------------------------------------------------- pedidos
  /** Busca en código, nombre, teléfono y dirección. */
  function coincide(p, q) {
    if (!q) return true;
    return [p.codigo, p.cliente_nombre, p.razon_social, p.num_doc, p.cliente_tel,
      p.cliente_email, p.cliente_dir, p.distrito, p.provincia, p.departamento,
      p.estado, p.tipo_comprobante].join(' ').toLowerCase().includes(q);
  }

  /**
   * El comprobante de ESE cliente, abrible desde su pedido.
   *
   * Antes el pedido solo decía «boleta» y había que ir a buscarla al bloque de
   * comprobantes. Cuando alguien llama porque no le llegó su boleta, lo que se
   * necesita es abrirla desde el pedido que se está mirando. El número sale de
   * la lista de comprobantes que el panel ya trae: no hace falta pedir nada más.
   */
  /**
   * El comprobante del pedido, como boton y no como etiqueta.
   *
   * Antes era un chip con el numero y nada mas: habia que saber que se podia
   * hacer clic. Lo que el mostrador necesita de un pedido es **entregarle el
   * papel al cliente**, asi que dice que documento es y su numero, y lleva a
   * verlo para imprimirlo.
   *
   * Una sola cosa, no dos. Tenia al lado un boton de PDF, y entre «ver» y
   * «descargar» hay que pararse a elegir cada vez para acabar en el mismo
   * papel. La pagina del comprobante ya imprime.
   */
  function comprobanteDe(p) {
    const tipo = p.tipo_comprobante === 'factura' ? 'Factura' : 'Boleta';
    const cmp = ultimosComprobantes.find((c) => c.pedido_id === p.id);

    // Sin comprobante emitido no hay nada que ofrecer. Se dice, en vez de
    // dejar un boton que no lleva a ninguna parte.
    if (!cmp) {
      return `<span class="cmp-pendiente">${tipo} sin emitir</span>`;
    }

    return `
      <span class="cmp-grupo">
        <a class="cmp-boton" href="/comprobante.html?id=${cmp.id}"
           title="Ver e imprimir la ${tipo.toLowerCase()} de ${escapar(p.cliente_nombre)}">
          <span class="cmp-tipo">${tipo}</span>
          <span class="cmp-numero">${escapar(cmp.numero)}</span>
        </a>
      </span>`;
  }

  /**
   * El pie de la ficha del pedido. El mismo para los tres roles.
   *
   * Dos controles en columnas iguales: mover el pedido y sacar su papel. Son
   * las dos cosas que se hacen con un pedido y ninguna manda sobre la otra, así
   * que ninguna es más ancha — con anchos distintos, la mayor se lee como «la
   * importante» y la otra se pulsa por error.
   *
   * El estado ES el botón. Antes eran dos cosas separadas —una pastilla que
   * informaba y un botón al lado que actuaba— y la pregunta que uno trae a un
   * pedido es una sola: «¿en qué va y qué sigue?». Ahora la respuesta está en
   * el mismo sitio que se pulsa.
   *
   * Lo que deshace —anular, registrar devolución— va debajo y en otro peso.
   * Repone stock y emite nota de crédito: no es «el otro botón», es la
   * excepción, y ponerla del mismo tamaño que avanzar es cómo se pulsa una
   * queriendo la otra. El reparto directamente no la tiene.
   */
  function pieDePedido(p, deshacer = []) {
    const paso = PASO_PEDIDO[p.estado];
    const estado = `<span class="paso-ahora"><i></i>${p.estado}</span>`;

    const avance = paso
      ? `<button class="paso-reparto e-${p.estado}" data-estado="${paso}" data-id="${p.id}">
           ${estado}
           <span class="paso-siguiente">tocar: ${SIGUIENTE_PEDIDO[paso]}</span>
         </button>`
      : `<span class="paso-reparto paso-cerrado e-${p.estado}">
           ${estado}
           <span class="paso-siguiente">${
             p.estado === 'entregado' ? 'entrega cerrada' : 'sin más pasos'}</span>
         </span>`;

    return `
      <div class="pedido-reparto">
        ${avance}
        <div class="comprobante-reparto">${comprobanteDe(p)}</div>
      </div>
      ${deshacer.length ? `<div class="pedido-deshacer">${deshacer.join('')}</div>` : ''}`;
  }

  function pintarPedidos() {
    const q = filtro.trim().toLowerCase();
    const lista = ultimosPedidos.filter((p) => coincide(p, q));

    $('conteo-pedidos').textContent = !ultimosPedidos.length ? ''
      : q ? `${lista.length} de ${ultimosPedidos.length}`
      : `${ultimosPedidos.length} en total`;

    if (!ultimosPedidos.length) {
      return pintar('lista-pedidos',
        '<div class="vacio">Aún no hay pedidos. Genera uno desde la tienda.</div>');
    }
    if (!lista.length) {
      return pintar('lista-pedidos',
        `<div class="vacio">Ningún pedido coincide con “${escapar(filtro)}”.</div>`);
    }

    pintar('lista-pedidos', lista.map((p) => {
      const items = p.items.map((i) => `${i.cantidad} × ${escapar(i.nombre)}`).join(' · ');

      /**
       * Lo que deshace una venta. Solo el puesto, nunca el reparto.
       *
       * Un pedido entregado todavía admite devolución: la política da 7 días.
       * Antes el botón se ocultaba y el dueño no podía procesarla.
       */
      const deshacer = [];
      if (!esReparto) {
        if (p.estado === 'entregado') {
          deshacer.push(`<button class="mini mini-peligro" data-estado="devuelto" data-id="${p.id}">Registrar devolución</button>`);
        } else if (p.estado !== 'anulado' && p.estado !== 'devuelto') {
          deshacer.push(`<button class="mini mini-peligro" data-estado="anulado" data-id="${p.id}">Anular y devolver stock</button>`);
        }
      }

      return `
      <div class="pedido">
        <div class="pedido-fila">
          <span class="pedido-codigo">${escapar(p.codigo)}</span>
          ${p.canal === 'mostrador' ? '<span class="canal">en el local</span>' : ''}
          ${p.canal !== 'mostrador' && p.modo_entrega === 'recojo'
            ? '<span class="canal canal-recojo">pasa a recoger</span>' : ''}
          <span class="pedido-total">${soles(p.total)}</span>
        </div>
        <div class="pedido-meta">
          <b>${escapar(p.razon_social || p.cliente_nombre)}</b>
          ${p.num_doc ? `· ${escapar(p.tipo_doc)} ${escapar(p.num_doc)}` : ''}
          · ${escapar(p.cliente_tel)}
          ${p.cliente_email ? `<br>${escapar(p.cliente_email)}` : ''}
          ${p.modo_entrega === 'recojo'
            ? '<br><b>Lo recoge en el local</b>'
            : `<br>${escapar(p.cliente_dir)}` + (p.distrito
              ? `<br><b>${escapar(p.distrito)}</b>, ${escapar(p.provincia)}, ${escapar(p.departamento)}`
              : '')}
          ${p.referencia ? `<br><i>Ref: ${escapar(p.referencia)}</i>` : ''}
          <br>${soloFecha(p.creado_en)} ${horaCorta(p.creado_en)}
          ${p.costo_envio > 0 ? ` · envío ${soles(p.costo_envio)}` : ''}
          ${p.nota ? '<br><b>Nota:</b> ' + escapar(p.nota) : ''}
        </div>
        <div class="pedido-items">${items}</div>

        <!-- El pie: en qué va el pedido y el papel del cliente. Va al final y
             en grande: arriba compite con el código y el total. -->
        ${pieDePedido(p, deshacer)}
      </div>`;
    }).join(''));
  }

  // ------------------------------------------------------------------ stock
  function pintarStock(bajos) {
    if (!bajos.length) {
      return pintar('lista-stock',
        '<div class="vacio">Todo el inventario está sobre el mínimo.</div>');
    }
    pintar('lista-stock', bajos.map((p) => {
      const ratio = p.stock_min ? Math.min(p.stock / p.stock_min, 1) : 1;
      const clase = ratio >= 0.7 ? 'lleno' : ratio >= 0.35 ? 'medio' : '';
      return `
      <div class="fila-stock">
        <div class="emoji">
          <img src="${escapar(p.imagen || '/img/placeholder.svg')}" alt="" data-respaldo="1">
        </div>
        <div class="info">
          <strong>${escapar(p.nombre)}</strong>
          <span>${existencia(p)} en stock · mínimo ${
            esGranel(p) ? enPeso(p.stock_min) : p.stock_min}</span>
          <div class="barra"><i class="${clase}" style="width:${Math.round(ratio * 100)}%"></i></div>
        </div>
        <div class="reponer">
          <input type="number" value="${p.sugerido}" min="1" max="99999"
                 step="${esGranel(p) ? 50 : 1}"
                 data-cantidad="${p.id}" aria-label="${
                   esGranel(p) ? 'Gramos a ingresar' : 'Cantidad a ingresar'}">
          <button class="mini" data-reponer="${p.id}">Ingresar${esGranel(p) ? ' g' : ''}</button>
        </div>
      </div>`;
    }).join(''));
  }

  function pintarTop(top) {
    if (!top.length) {
      return pintar('lista-top',
        '<tr><td class="kpi-nota">Sin ventas registradas todavía.</td></tr>');
    }
    pintar('lista-top', top.map((t) =>
      `<tr><td>${escapar(t.nombre)}</td><td>${t.unidades} u · ${soles(t.monto)}</td></tr>`).join(''));
  }

  function pintarMovimientos(movs) {
    if (!movs.length) {
      return pintar('lista-movimientos',
        '<div class="vacio">Sin movimientos registrados.</div>');
    }
    pintar('lista-movimientos', movs.map((m) => `
      <div class="mov">
        <div class="mov-signo ${m.cantidad < 0 ? 'mov-baja' : 'mov-alta'}">
          ${m.cantidad > 0 ? '+' : ''}${m.cantidad}
        </div>
        <div class="mov-info">
          ${escapar(m.nombre)}
          <span>${escapar(m.motivo)} · queda ${m.stock_final} · ${horaCorta(m.creado_en)}</span>
        </div>
      </div>`).join(''));
  }

  // ---------------------------------------------------------------- catálogo
  // Con un catálogo de cientos de productos no se pintan todas las filas: cada
  // una lleva dos campos editables, y nadie recorre 400 a mano. Se muestran las
  // primeras y el buscador hace el resto.
  const TOPE_FILAS = 60;

  function pintarProductos() {
    // Si hay un precio a medio editar o el alta está abierta, no se repinta:
    // el refresco automático borraría lo que el dueño está escribiendo.
    if (document.querySelector('.guardar:not([disabled])') || $('dlg-alta').open) return;

    const q = filtroProducto.trim().toLowerCase();
    const lista = ultimosProductos.filter((p) => {
      if (!verBajas && !p.activo) return false;
      if (!q) return true;
      return (p.nombre + ' ' + p.sku + ' ' + p.categoria + ' ' + p.origen)
        .toLowerCase().includes(q);
    });

    const bajas = ultimosProductos.filter((p) => !p.activo).length;
    $('conteo-productos').textContent = q
      ? `${lista.length} de ${ultimosProductos.length}`
      : `${lista.length} activo(s)${bajas ? ` · ${bajas} de baja` : ''}`;

    if (!lista.length) {
      return pintar('lista-productos',
        '<div class="vacio">Ningún producto coincide con la búsqueda.</div>');
    }

    const recortada = lista.length > TOPE_FILAS;
    const pie = recortada
      ? `<div class="mas-productos">Mostrando ${TOPE_FILAS} de ${lista.length}.
         Usa el buscador para llegar al que necesitas.</div>`
      : '';

    pintar('lista-productos', `
      <div class="fila-prod cabecera-prod">
        <span></span><span>Producto</span><span>Precio</span>
        <span>Stock mín.</span><span>Stock</span><span></span>
      </div>` + lista.slice(0, TOPE_FILAS).map((p) => {
      // El servidor no manda `costo` al mostrador, asi que aqui no hay nada
      // que ocultar: simplemente no esta.
      const margen = esDueno && p.precio > 0 && Number.isFinite(p.costo)
        ? Math.round(((p.precio - p.costo) / p.precio) * 100) : null;
      return `
      <div class="fila-prod${p.activo ? '' : ' de-baja'}" data-prod="${p.id}">
        <div class="prod-foto">
          <img src="${escapar(p.imagen || '/img/placeholder.svg')}" alt="" data-respaldo="1">
        </div>
        <div class="prod-info">
          <strong>${escapar(p.nombre)}</strong>
          <span>${escapar(p.sku)} · ${escapar(p.categoria)}${
            // Lo que se vende por peso se marca: sin esto, «9.40» y «30» se
            // leen como nueve soles la bolsa y treinta bolsas, cuando son
            // nueve soles los cien gramos y treinta gramos en el estante.
            esGranel(p) ? ' · <b class="etq-granel">a granel</b>' : ''}${
            margen === null ? '' : ` · costo ${soles(p.costo)} · margen ${margen}%`}</span>
        </div>
        <div class="prod-campo">
          <span class="prefijo">S/</span>
          <input type="number" step="0.10" min="0.1" max="99999"
                 value="${p.precio.toFixed(2)}"
                 ${esDueno ? `data-campo="precio" data-id="${p.id}"` : 'readonly'}
                 aria-label="Precio de ${escapar(p.nombre)}${esGranel(p) ? ', por 100 gramos' : ''}">
          ${esGranel(p) ? '<span class="sufijo">/100 g</span>' : ''}
        </div>
        <div class="prod-campo">
          <input type="number" step="1" min="0" max="9999"
                 value="${p.stock_min}" data-campo="stock_min" data-id="${p.id}"
                 aria-label="Stock mínimo de ${escapar(p.nombre)}">
        </div>
        <div class="prod-stock ${p.stock <= p.stock_min ? 'bajo' : ''}">${existencia(p)}</div>
        <div class="prod-acciones">
          <button class="mini guardar" data-guardar="${p.id}" disabled>Guardar</button>
          ${esDueno ? `<button class="mini" data-editar="${p.id}">Editar</button>` : ''}
          ${esDueno ? `
          <button class="mini ${p.activo ? 'mini-peligro' : ''}"
                  data-activo="${p.id}" data-valor="${p.activo ? 0 : 1}">
            ${p.activo ? 'Dar de baja' : 'Reactivar'}
          </button>` : ''}
        </div>
      </div>`;
    }).join('') + pie);
  }

  const TIPO_CMP = { '01': 'Factura', '03': 'Boleta', '07': 'N. crédito', '08': 'N. débito' };

  function pintarComprobantes(lista) {
    $('conteo-comprobantes').textContent = lista.length ? `${lista.length} emitidos` : '';
    if (!lista.length) {
      return pintar('lista-comprobantes',
        '<div class="vacio">Aún no se emitió ningún comprobante.</div>');
    }
    pintar('lista-comprobantes', lista.map((c) => `
      <a class="cmp" href="/comprobante.html?id=${c.id}">
        <div class="cmp-info">
          <strong>${escapar(c.numero)}</strong>
          <span>${TIPO_CMP[c.tipo_doc] || c.tipo_doc} · ${escapar(c.cliente)}
            ${c.ref ? `· sobre ${escapar(c.ref)}` : ''}</span>
        </div>
        <div class="cmp-derecha">
          <span class="cmp-total">${soles(c.total)}</span>
          <span class="cmp-estado">${c.estado === 'pendiente_envio' ? 'sin enviar' : escapar(c.estado)}</span>
        </div>
      </a>`).join(''));
  }

  // ------------------------------------------------------ venta en el local
  /**
   * La tienda vende por dos canales y los dos descuentan del MISMO stock: la
   * web y el mostrador. Hasta ahora el sistema solo sabia registrar la venta
   * que entraba por la web, asi que lo que se vendia de frente —que es casi
   * todo— no bajaba del inventario y el stock del panel era mentira a media
   * mañana.
   *
   * Al buscar se muestra el stock de cada producto, porque la pregunta del
   * mostrador no es «cuanto cuesta» sino «¿me queda?».
   */
  const TOPE_RESULTADOS = 6;

  function pintarMostrador() {
    pintarResultados();
    pintarCarrito();
  }

  function pintarResultados() {
    if (!buscaMostrador) return pintar('mos-resultados', '');

    const q = buscaMostrador.toLowerCase();
    const hallados = ultimosProductos
      .filter((p) => p.activo === 1
        && `${p.nombre} ${p.sku}`.toLowerCase().includes(q))
      .slice(0, TOPE_RESULTADOS);

    if (!hallados.length) {
      return pintar('mos-resultados',
        `<div class="vacio">Nada con «${escapar(buscaMostrador)}» en el catálogo.</div>`);
    }

    pintar('mos-resultados', hallados.map((p) => {
      const enCarrito = carrito.get(p.id) || 0;
      const libre = p.stock - enCarrito;
      // Agotado no se puede vender, y se dice en vez de dejar el boton muerto.
      const clase = libre <= 0 ? 'sin-stock' : (p.stock <= p.stock_min ? 'poco-stock' : '');
      return `
      <div class="mos-fila ${clase}">
        <div class="mos-info">
          <strong>${escapar(p.nombre)}</strong>
          <span>${escapar(p.sku)} · ${escapar(p.presentacion || '')}</span>
        </div>
        <div class="mos-stock">${libre <= 0 ? 'agotado' : `quedan ${libre}`}</div>
        <div class="mos-precio">${soles(p.precio)}</div>
        <button class="mini" data-sumar="${p.id}" ${libre <= 0 ? 'disabled' : ''}>Agregar</button>
      </div>`;
    }).join(''));
  }

  function pintarCarrito() {
    if (!carrito.size) {
      return pintar('mos-carrito',
        '<div class="mos-vacio">Busca un producto y agrégalo para empezar la venta.</div>');
    }

    const lineas = [...carrito].map(([id, cant]) => {
      const p = ultimosProductos.find((x) => x.id === id);
      return p && { p, cant, subtotal: +(importe(p, cant)).toFixed(2) };
    }).filter(Boolean);

    const total = +lineas.reduce((t, l) => t + l.subtotal, 0).toFixed(2);
    // El costo solo llega al dueño, asi que la ganancia solo se calcula para
    // el. El mostrador cobra igual: simplemente no ve cuanto se gano.
    const conCosto = esDueno && lineas.every((l) => Number.isFinite(l.p.costo));
    const ganancia = conCosto
      ? +lineas.reduce((g, l) => g + importe(l.p, l.cant) - costoDe(l.p, l.cant), 0).toFixed(2)
      : null;

    pintar('mos-carrito', `
      <div class="mos-lineas">
        ${lineas.map((l) => `
          <div class="mos-linea">
            <div class="mos-info">
              <strong>${escapar(l.p.nombre)}</strong>
              <span>${soles(l.p.precio)} c/u · quedan ${l.p.stock - l.cant}</span>
            </div>
            <div class="mos-cant">
              <button class="mini" data-restar="${l.p.id}" aria-label="Quitar uno">−</button>
              <span>${l.cant}</span>
              <button class="mini" data-sumar="${l.p.id}"
                      ${l.cant >= l.p.stock ? 'disabled' : ''} aria-label="Agregar uno">+</button>
            </div>
            <div class="mos-subtotal">${soles(l.subtotal)}</div>
            <button class="mini mini-peligro" data-sacar="${l.p.id}"
                    aria-label="Sacar del carrito">×</button>
          </div>`).join('')}
      </div>

      <div class="mos-total">
        <span>Total</span><strong>${soles(total)}</strong>
      </div>
      ${ganancia === null ? '' : `
      <div class="mos-ganancia"><span>Ganancia de esta venta</span>
        <strong>${soles(ganancia)}</strong></div>`}

      <div class="mos-cliente">
        <div class="mos-campos">
          <input id="mos-nombre" placeholder="Nombre (opcional)" maxlength="120"
                 aria-label="Nombre del cliente">
          <input id="mos-doc" placeholder="DNI o RUC (opcional)" maxlength="11"
                 inputmode="numeric" aria-label="Documento del cliente">
          <input id="mos-tel" placeholder="Teléfono (opcional)" maxlength="15"
                 inputmode="tel" aria-label="Teléfono del cliente">
        </div>
        <p class="mos-nota">Sin documento sale boleta a nombre del mostrador. Con
          RUC sale factura y hace falta la razón social.</p>
        <input id="mos-razon" placeholder="Razón social (solo con RUC)" maxlength="120"
               aria-label="Razón social" hidden>
      </div>

      <div class="aviso aviso-error" id="mos-error" hidden></div>
      <button class="btn btn-primario btn-bloque" id="mos-cobrar">
        Cobrar ${soles(total)} y emitir comprobante
      </button>`);
  }

  /** Suma respetando el stock: el carrito nunca puede prometer lo que no hay. */
  function sumar(id) {
    const p = ultimosProductos.find((x) => x.id === id);
    if (!p) return;
    const cant = (carrito.get(id) || 0) + 1;
    if (cant > p.stock) {
      return avisar(`De ${p.nombre} solo quedan ${p.stock}`);
    }
    carrito.set(id, cant);
    pintarMostrador();
  }

  function restar(id) {
    const cant = (carrito.get(id) || 0) - 1;
    if (cant <= 0) carrito.delete(id);
    else carrito.set(id, cant);
    pintarMostrador();
  }

  async function cobrar() {
    const b = $('mos-cobrar');
    const err = $('mos-error');
    err.hidden = true;
    b.disabled = true;
    b.textContent = 'Cobrando…';

    const cuerpo = {
      items: [...carrito].map(([id, cantidad]) => ({ id, cantidad })),
      cliente: {
        nombre: $('mos-nombre').value.trim(),
        num_doc: $('mos-doc').value.trim(),
        // El tipo se deduce del largo: 8 digitos es DNI, 11 es RUC. En el
        // mostrador nadie va a elegir de una lista con el cliente esperando.
        tipo_doc: $('mos-doc').value.trim().length === 11 ? 'RUC' : 'DNI',
        razon_social: $('mos-razon').value.trim(),
        telefono: $('mos-tel').value.trim(),
      },
    };

    try {
      const r = await fetch('/api/mostrador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      const j = await r.json();
      if (!r.ok) {
        // Un faltante se explica producto por producto: en el mostrador hay
        // que poder decirle al cliente «de ese me queda uno».
        err.textContent = j.faltantes?.length
          ? `${j.error} ${j.faltantes.map((f) => `${f.nombre}: quedan ${f.disponible}`).join('; ')}`
          : j.error;
        err.hidden = false;
        return;
      }
      carrito.clear();
      avisar(`Venta ${j.venta.codigo} · ${soles(j.venta.total)}`
        + (j.venta.numeroComprobante ? ` · ${j.venta.numeroComprobante}` : '')
        + (j.venta.ganancia === undefined ? '' : ` · ganancia ${soles(j.venta.ganancia)}`));
      for (const a of j.alertas || []) {
        avisar(`${a.nombre} quedó en ${a.stock} (mínimo ${a.stock_min})`);
      }
      buscaMostrador = '';
      $('mos-buscar').value = '';
      await cargar();
    } catch {
      err.textContent = 'No se pudo cobrar: sin conexión con el servidor.';
      err.hidden = false;
    } finally {
      b.disabled = false;
      pintarCarrito();
    }
  }



  // ----------------------------------------------------------- respaldo
  const kb = (b) => `${Math.round(b / 1024).toLocaleString('es-PE')} KB`;

  /**
   * Estado del respaldo, a la vista y sin tener que buscarlo. Un respaldo que
   * hay que ir a comprobar es un respaldo que nadie comprueba: se avisa aqui
   * cuando el del dia no esta, y cuando esta en el mismo disco que la base.
   */
  function pintarRespaldo(r) {
    const u = r.ultimo;
    const hoy = new Date().toISOString().slice(0, 10);
    // Comparar contra la fecha local, no la del servidor: el panel puede estar
    // abierto en otra maquina.
    const d = new Date();
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const alDia = Boolean(u) && (u.fecha === local || u.fecha === hoy);

    $('bloque-respaldo').classList.toggle('bloque-alerta', !alDia);

    const aviso = !u
      ? '<div class="resp-aviso grave">Todavía no hay ningún respaldo. Pulsa «Respaldar ahora».</div>'
      : !alDia
        ? `<div class="resp-aviso grave">El último respaldo es del ${escapar(u.fecha)}.
             Hoy no se ha hecho ninguno.</div>`
        : `<div class="resp-aviso bien">Al día. Último: ${escapar(u.fecha)} · ${kb(u.bytes)}</div>`;

    // Una copia en el mismo disco salva de un borrado por error, no de que se
    // lleven la laptop. Decirlo es la diferencia entre estar respaldado y
    // creerlo.
    const fuera = r.fuera_del_disco
      ? '<div class="resp-nota">Se guarda fuera de este disco. Correcto.</div>'
      : `<div class="resp-aviso tibio">Está en el mismo disco que la base. Ante un robo
           o una avería se perdería con ella. Hay que apuntar el respaldo a un
           pendrive o disco externo.</div>`;

    pintar('respaldo', `
      ${aviso}
      ${fuera}
      <div class="resp-nota">Carpeta: <code>${escapar(r.carpeta)}</code></div>
      ${r.respaldos.length ? `
        <div class="resp-lista">
          ${r.respaldos.slice(0, 7).map((x) => `
            <div class="resp-fila">
              <span>${escapar(x.fecha)}</span>
              <span class="resp-peso">${kb(x.bytes)}</span>
            </div>`).join('')}
        </div>
        <div class="resp-nota">${r.respaldos.length} copia(s) · se guardan las
          últimas ${r.se_guardan}</div>` : ''}`);
  }

  async function respaldarAhora() {
    const b = $('btn-respaldar');
    b.disabled = true;
    b.textContent = 'Respaldando…';
    try {
      const r = await fetch('/api/admin/respaldos', { method: 'POST' });
      const j = await r.json();
      avisar(r.ok ? `Respaldo hecho: ${j.archivo} (${kb(j.bytes)})`
        : `No se pudo respaldar: ${j.error}`);
    } catch {
      avisar('No se pudo respaldar: sin conexión con el servidor');
    } finally {
      b.disabled = false;
      b.textContent = 'Respaldar ahora';
      cargar();
    }
  }

  // ------------------------------------------------- calendario de ventas
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
  const DIAS_SEMANA = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

  const hoyISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  /**
   * Rejilla del mes con lo vendido cada dia. La intensidad del fondo es
   * relativa al mejor dia del propio mes, no a una escala fija: un mes flojo
   * se sigue leyendo, y no hace falta saber cuanto es "mucho" para ver donde
   * estuvo el movimiento.
   */
  function pintarCalendario(cal) {
    mesVisto = cal.mes;
    const [anio, num] = cal.mes.split('-').map(Number);
    $('mes-nombre').textContent = `${MESES[num - 1]} ${anio}`;

    // La semana peruana empieza en lunes; getDay() devuelve 0 para domingo.
    const columna = (semana) => (semana + 6) % 7;
    const huecos = columna(cal.dias[0].semana);
    const techo = cal.mejor_dia ? cal.mejor_dia.total : 0;
    const hoy = hoyISO();

    const celdas = cal.dias.map((d) => {
      // 0.10 de piso para que un dia con venta minima no se vea igual que uno
      // en blanco: lo que importa es distinguir "vendio algo" de "no vendio".
      const fuerza = d.total > 0 && techo > 0 ? 0.10 + 0.60 * (d.total / techo) : 0;
      const clases = ['dia-cal'];
      if (d.total > 0) clases.push('vendio');
      if (d.fecha === hoy) clases.push('es-hoy');
      if (cal.mejor_dia && d.fecha === cal.mejor_dia.fecha && cal.dias_con_venta > 1) clases.push('mejor');
      const titulo = d.total > 0
        ? `${d.fecha} · ${d.pedidos} pedido(s) · ${soles(d.total)}`
        : `${d.fecha} · sin ventas`;
      return `<div class="${clases.join(' ')}" title="${titulo}"
        style="--fuerza:${fuerza.toFixed(3)}">
        <span class="dia-num">${d.dia}</span>
        <span class="dia-monto">${d.total > 0 ? soles(d.total).replace('S/ ', '') : ''}</span>
      </div>`;
    });

    pintar('calendario', `
      <div class="cal-rejilla">
        ${DIAS_SEMANA.map((n) => `<div class="dia-cabeza">${n}</div>`).join('')}
        ${'<div class="dia-cal vacia"></div>'.repeat(huecos)}
        ${celdas.join('')}
      </div>
      <div class="cal-pie">
        ${cal.dias_con_venta
          ? `<span><strong>${soles(cal.total_mes)}</strong> en ${cal.pedidos_mes} pedido(s),
             repartidos en ${cal.dias_con_venta} día(s)</span>`
          : '<span>Este mes todavía no registra ventas.</span>'}
        ${cal.mejor_dia
          ? `<span class="cal-mejor">Mejor día: ${Number(cal.mejor_dia.fecha.slice(8))} de
             ${MESES[num - 1]}, ${soles(cal.mejor_dia.total)}</span>`
          : ''}
      </div>`);
  }

  /** Corre el mes visto. `null` en `mesVisto` vuelve a significar "el actual". */
  function moverMes(paso) {
    const [anio, num] = (mesVisto || hoyISO().slice(0, 7)).split('-').map(Number);
    const d = new Date(anio, num - 1 + paso, 1);
    mesVisto = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return cargar();
  }

  // ----------------------------------------------------- historial de cliente
  /**
   * Quienes compran, ordenados por lo que han gastado. Al tocar uno se pide su
   * historial y se despliega debajo: un cliente con doce compras no cabe en la
   * lista, y el dueno casi siempre quiere ver el de uno solo — el que tiene al
   * teléfono en ese momento.
   */
  function pintarClientes() {
    const lista = filtroCliente
      ? ultimosClientes.filter((c) => [c.nombre, c.num_doc, c.telefono, c.razon_social]
        .join(' ').toLowerCase().includes(filtroCliente))
      : ultimosClientes;

    $('conteo-clientes').textContent = ultimosClientes.length
      ? (filtroCliente ? `${lista.length} de ${ultimosClientes.length}` : `${ultimosClientes.length} en total`)
      : '';

    if (!ultimosClientes.length) {
      return pintar('lista-clientes',
        '<div class="vacio">Todavía no hay clientes. Cada pedido registra uno.</div>');
    }
    if (!lista.length) {
      return pintar('lista-clientes',
        `<div class="vacio">Ningún cliente coincide con «${escapar(filtroCliente)}».</div>`);
    }

    pintar('lista-clientes', lista.map((c) => {
      const abierto = clienteAbierto === c.num_doc;
      const repite = c.pedidos > 1;
      return `
      <div class="cliente${abierto ? ' abierto' : ''}">
        <button class="cliente-cabeza" data-doc="${escapar(c.num_doc)}"
                aria-expanded="${abierto}">
          <div class="cliente-info">
            <strong>${escapar(c.razon_social || c.nombre)}</strong>
            <span>${escapar(c.tipo_doc)} ${escapar(c.num_doc)} · ${escapar(c.telefono)}</span>
          </div>
          <div class="cliente-derecha">
            <span class="cliente-gastado">${soles(c.gastado)}</span>
            <span class="cliente-veces${repite ? ' repite' : ''}">
              ${c.pedidos} ${c.pedidos === 1 ? 'compra' : 'compras'}</span>
          </div>
        </button>
        ${abierto ? pintarHistorial(c) : ''}
      </div>`;
    }).join(''));
  }

  function pintarHistorial(c) {
    const h = historial[c.num_doc];
    if (!h) return '<div class="cliente-cuerpo"><span class="cargando">Cargando…</span></div>';
    return `<div class="cliente-cuerpo">
      <div class="cliente-resumen">
        Cliente desde el ${escapar(c.primera)} · última compra el ${escapar(c.ultima)}
      </div>
      ${h.map((p) => `
        <div class="hist${['anulado', 'devuelto'].includes(p.estado) ? ' hist-nulo' : ''}">
          <div class="hist-cabeza">
            <a href="/comprobante.html?id=${p.id}" class="hist-codigo">${escapar(p.codigo)}</a>
            <span class="hist-fecha">${escapar(String(p.creado_en).slice(0, 16))}</span>
            <span class="hist-total">${soles(p.total)}</span>
          </div>
          <div class="hist-items">
            ${p.items.map((i) => `${i.cantidad} × ${escapar(i.nombre)}`).join(' · ')}
          </div>
          ${['anulado', 'devuelto'].includes(p.estado)
            ? `<div class="hist-estado">${escapar(p.estado)}</div>` : ''}
        </div>`).join('')}
    </div>`;
  }

  /** Despliega un cliente. El historial se pide una vez y se guarda. */
  async function abrirCliente(doc) {
    if (clienteAbierto === doc) { clienteAbierto = null; pintarClientes(); return; }
    clienteAbierto = doc;
    pintarClientes();
    if (!historial[doc]) {
      try {
        historial[doc] = await pedir('/api/admin/clientes?doc=' + encodeURIComponent(doc));
      } catch (e) {
        if (e.message !== 'sin sesión') avisar('No se pudo traer el historial');
        clienteAbierto = null;
      }
      pintarClientes();
    }
  }

  function pintarCambios(cambios) {
    const bloque = $('bloque-cambios');
    if (!cambios.length) { bloque.hidden = true; return; }
    bloque.hidden = false;

    const ETIQUETA = { precio: 'Precio', stock_min: 'Mínimo', activo: 'Estado' };
    const valor = (campo, v) => campo === 'precio' ? soles(v)
      : campo === 'activo' ? (v === '1' ? 'activo' : 'de baja') : v;

    pintar('lista-cambios', cambios.map((c) => `
      <div class="mov">
        <div class="mov-info">
          <strong>${escapar(c.nombre)}</strong>
          <span>${ETIQUETA[c.campo] || c.campo}:
            ${escapar(valor(c.campo, c.antes))} → <b>${escapar(valor(c.campo, c.despues))}</b>
            · ${escapar(c.usuario)} · ${soloFecha(c.creado_en)} ${horaCorta(c.creado_en)}</span>
        </div>
      </div>`).join(''));
  }

  /** Habilita "Guardar" solo cuando el valor de verdad cambió. */
  function revisarFila(id) {
    const fila = document.querySelector(`[data-prod="${id}"]`);
    const producto = ultimosProductos.find((p) => p.id === Number(id));
    if (!fila || !producto) return;
    const precio = fila.querySelector('[data-campo="precio"]');
    const minimo = fila.querySelector('[data-campo="stock_min"]');
    const cambio = Number(precio.value) !== producto.precio
      || Number(minimo.value) !== producto.stock_min;
    fila.querySelector('.guardar').disabled = !cambio;
    fila.classList.toggle('editando', cambio);
  }

  async function guardarProducto(id) {
    const fila = document.querySelector(`[data-prod="${id}"]`);
    const precio = Number(fila.querySelector('[data-campo="precio"]').value);
    const stock_min = Number(fila.querySelector('[data-campo="stock_min"]').value);

    if (!(precio > 0)) return avisar('El precio tiene que ser mayor que cero');
    if (!Number.isInteger(stock_min) || stock_min < 0) {
      return avisar('El stock mínimo tiene que ser un número entero');
    }

    const boton = fila.querySelector('.guardar');
    boton.disabled = true;
    const r = await fetch(`/api/productos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ precio, stock_min }),
    });
    if (r.status === 401) return alLogin();
    const datos = await r.json();
    avisar(r.ok
      ? (datos.sin_cambios ? 'Sin cambios' : `${datos.producto.nombre}: ${datos.cambios.join(' y ')} actualizado`)
      : datos.error);
    return cargar();
  }

  // --------------------------------------------------------- QR de la tienda
  /**
   * La hoja para el stand de la feria.
   *
   * En una feria nadie teclea una dirección web mirando un cartel: o hay algo
   * que apuntar con la cámara, o la visita se pierde ahí mismo. Es el puente
   * entre el puesto físico —donde está la conversación que vende— y el catálogo
   * que sigue abierto cuando la feria cierra.
   *
   * Sale a página completa y en blanco y negro a propósito: se imprime en
   * cualquier impresora y se pega en el stand.
   */
  function imprimirQr() {
    const url = location.origin;
    // A la tienda y no a la portada: quien escanea en la feria ya está frente al
    // puesto y conoce la historia. Viene a ver qué hay.
    const tienda = url + '/tienda';
    const v = window.open('', '_blank');
    if (!v) return avisar('El navegador bloqueó la ventana de impresión');

    v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
      <title>QR de la tienda — Raíz Andina</title>
      <style>
        @page { size: A4; margin: 18mm; }
        body {
          font: 16px/1.5 "Segoe UI", system-ui, sans-serif; color: #1c2a22;
          margin: 0; text-align: center;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          min-height: 90vh;
        }
        img.marca { width: 120px; height: auto; margin-bottom: 10px; }
        h1 { font-size: 34px; margin: 0 0 6px; letter-spacing: -.02em; }
        .bajada { font-size: 17px; color: #5f6f64; margin: 0 0 30px; }
        .qr { width: 320px; height: 320px; }
        .qr img { width: 100%; height: 100%; }
        .url {
          margin-top: 24px; font-family: ui-monospace, Consolas, monospace;
          font-size: 18px; color: #2a6b46; word-break: break-all;
        }
        .pie { margin-top: 28px; font-size: 14px; color: #5f6f64; }
        @media print { .noprint { display: none } }
      </style></head><body>
      <img class="marca" src="${url}/img/marca/logotipo.png" alt="Raíz Andina">
      <h1>Mira todo el catálogo</h1>
      <p class="bajada">Apunta con la cámara de tu celular</p>
      <div class="qr"><img src="${url}/api/qr?d=${encodeURIComponent(tienda)}" alt="Código QR de la tienda"></div>
      <div class="url">${tienda.replace(/^https?:\/\//, '')}</div>
      <p class="pie">Pide por aquí a cualquier hora y recógelo en el puesto.</p>
      </body></html>`);
    v.document.close();
    v.focus();
    // Se espera a que el QR y la marca hayan bajado: imprimir antes deja la
    // hoja con los huecos en blanco, que es el único fallo que no se ve en
    // pantalla y sí en el papel.
    setTimeout(() => v.print(), 900);
  }

  // ------------------------------------------------------------ ruta del día
  /**
   * Hoja para el repartidor: los pedidos que hay que salir a entregar.
   * Sin esto había que dictarle las direcciones por teléfono una por una.
   */
  function imprimirRuta() {
    // Lo que el cliente pasa a recoger NO entra en la ruta: mandarlo con el
    // repartidor a la dirección del propio local es un viaje en falso, y además
    // dejaría al pedido fuera del puesto justo cuando su dueño llega a buscarlo.
    const salen = ultimosPedidos.filter((p) => p.modo_entrega !== 'recojo'
      && (p.estado === 'pendiente' || p.estado === 'preparando' || p.estado === 'enviado'));

    if (!salen.length) return avisar('No hay pedidos por entregar');

    const hoy = new Date().toLocaleDateString('es-PE',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const filas = salen.map((p, i) => `
      <tr>
        <td class="n">${i + 1}</td>
        <td>
          <strong>${escapar(p.cliente_nombre)}</strong><br>
          ${escapar(p.cliente_dir)}<br>
          ${p.distrito ? `<strong>${escapar(p.distrito)}</strong><br>` : ''}
          ${p.referencia ? `<em>Ref: ${escapar(p.referencia)}</em><br>` : ''}
          <span class="tel">${escapar(p.cliente_tel)}</span>
          ${p.nota ? `<br><em>${escapar(p.nota)}</em>` : ''}
        </td>
        <td>${p.items.map((i2) => `${i2.cantidad} × ${escapar(i2.nombre)}`).join('<br>')}</td>
        <td class="der"><strong>${soles(p.total)}</strong><br>
          <span class="cod">${escapar(p.codigo)}</span></td>
        <td class="firma"></td>
      </tr>`).join('');

    const total = salen.reduce((s, p) => s + p.total, 0);

    const doc = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
      <title>Ruta de entrega — ${hoy}</title>
      <style>
        @page { size: A4; margin: 14mm; }
        body { font: 12px/1.45 "Segoe UI", system-ui, sans-serif; color: #111; margin: 0; }
        h1 { font-size: 19px; margin: 0 0 3px; }
        .sub { color: #666; font-size: 12px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; font-size: 10px; letter-spacing: .1em; text-transform: uppercase;
             color: #666; border-bottom: 2px solid #111; padding: 0 8px 6px 0; }
        td { border-bottom: 1px solid #ddd; padding: 10px 8px 10px 0; vertical-align: top; }
        .n { width: 22px; color: #999; font-weight: 700; }
        .der { text-align: right; white-space: nowrap; }
        .firma { width: 92px; border-left: 1px dashed #bbb; }
        .tel { color: #444; }
        .cod { font-family: Consolas, monospace; font-size: 10px; color: #777; }
        em { color: #b4462a; font-style: normal; font-size: 11px; }
        tfoot td { border: none; padding-top: 12px; font-size: 13px; }
        @media print { .noprint { display: none } }
      </style></head><body>
      <h1>Ruta de entrega</h1>
      <div class="sub">Raíz Andina · ${hoy} · ${salen.length} entrega(s)</div>
      <table>
        <thead><tr><th></th><th>Cliente y dirección</th><th>Productos</th>
          <th class="der">Cobrar</th><th>Firma</th></tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr><td></td><td colspan="2"><strong>Total a cobrar</strong></td>
          <td class="der"><strong>${soles(total)}</strong></td><td></td></tr></tfoot>
      </table>
      </body></html>`;

    const v = window.open('', '_blank');
    if (!v) return avisar('El navegador bloqueó la ventana de impresión');
    v.document.write(doc);
    v.document.close();
    v.focus();
    setTimeout(() => v.print(), 350);
  }

  // -------------------------------------------------------------- acciones
  document.addEventListener('click', async (e) => {
    const btnEstado = e.target.closest('[data-estado]');
    if (btnEstado) {
      const { id, estado } = btnEstado.dataset;
      const preguntas = {
        anulado: '¿Anular el pedido y devolver los productos al inventario?',
        devuelto: '¿Registrar la devolución? Los productos vuelven al inventario.',
      };
      if (preguntas[estado] && !confirm(preguntas[estado])) return;
      btnEstado.disabled = true;
      const r = await fetch(`/api/pedidos/${id}/estado`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado }),
      });
      if (r.status === 401) return alLogin();
      const datos = await r.json();
      avisar(r.ok ? `Pedido ${datos.codigo}: ${estado}` : datos.error);
      return cargar();
    }

    const btnGuardar = e.target.closest('[data-guardar]');
    if (btnGuardar) return guardarProducto(btnGuardar.dataset.guardar);

    const btnEditar = e.target.closest('[data-editar]');
    if (btnEditar) {
      // La ficha se toma de lo ya cargado y no se vuelve a pedir: el panel se
      // refresca cada 15 s, asi que es de hace segundos.
      const p = ultimosProductos.find((x) => x.id === Number(btnEditar.dataset.editar));
      if (p) return abrirFicha(p);
      return avisar('No encuentro esa ficha; actualiza el panel');
    }

    const btnActivo = e.target.closest('[data-activo]');
    if (btnActivo) {
      const id = btnActivo.dataset.activo;
      const valor = Number(btnActivo.dataset.valor);
      const p = ultimosProductos.find((x) => x.id === Number(id));
      if (!valor && !confirm(
        `¿Dar de baja "${p?.nombre}"? Deja de aparecer en la tienda y el asesor ` +
        'no lo recomienda. El stock y el histórico se conservan.')) return;
      btnActivo.disabled = true;
      const r = await fetch(`/api/productos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo: valor }),
      });
      if (r.status === 401) return alLogin();
      const datos = await r.json();
      avisar(r.ok
        ? `${datos.producto.nombre}: ${valor ? 'reactivado' : 'dado de baja'}`
        : datos.error);
      return cargar();
    }

    const btnReponer = e.target.closest('[data-reponer]');
    if (btnReponer) {
      const id = Number(btnReponer.dataset.reponer);
      const campo = document.querySelector(`[data-cantidad="${id}"]`);
      const cantidad = Number(campo?.value);
      // El proveedor trae lo que trae, no la cantidad "sugerida".
      if (!Number.isInteger(cantidad) || cantidad < 1) {
        return avisar('Escribe cuántas unidades llegaron');
      }
      btnReponer.disabled = true;
      const r = await fetch('/api/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ producto_id: id, cantidad, motivo: 'Ingreso de mercadería' }),
      });
      if (r.status === 401) return alLogin();
      const datos = await r.json();
      avisar(r.ok ? `${datos.nombre}: ahora ${datos.stock} unidades` : datos.error);
      return cargar();
    }
  });

  // Enter confirma: en el ingreso de mercadería y en la edición de ficha.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.target.dataset.cantidad) {
      e.preventDefault();
      return document.querySelector(`[data-reponer="${e.target.dataset.cantidad}"]`)?.click();
    }
    if (e.target.dataset.campo) {
      e.preventDefault();
      return guardarProducto(e.target.dataset.id);
    }
  });

  // Mientras el dueño escribe un precio, el refresco automático no debe
  // borrarle lo que está tecleando.
  document.addEventListener('input', (e) => {
    if (e.target.dataset.campo) revisarFila(e.target.dataset.id);
  });

  let retardo;
  $('buscar-pedido').oninput = (e) => {
    clearTimeout(retardo);
    retardo = setTimeout(() => { filtro = e.target.value; pintarPedidos(); }, 160);
  };

  let retardoProd;
  $('buscar-producto').oninput = (e) => {
    clearTimeout(retardoProd);
    retardoProd = setTimeout(() => { filtroProducto = e.target.value; pintarProductos(); }, 160);
  };

  $('ver-bajas').onchange = (e) => { verBajas = e.target.checked; pintarProductos(); };

  let retardoCli;
  $('buscar-cliente').oninput = (e) => {
    clearTimeout(retardoCli);
    retardoCli = setTimeout(() => {
      filtroCliente = e.target.value.trim().toLowerCase();
      pintarClientes();
    }, 160);
  };

  // Delegado: la lista se vuelve a pintar cada 15 s y unos onclick puestos a
  // mano se perderian en cada repintado.
  $('lista-clientes').addEventListener('click', (e) => {
    const cabeza = e.target.closest('.cliente-cabeza');
    if (cabeza) return abrirCliente(cabeza.dataset.doc);
  });

  let retardoMos;
  $('mos-buscar').oninput = (e) => {
    clearTimeout(retardoMos);
    retardoMos = setTimeout(() => {
      buscaMostrador = e.target.value.trim();
      pintarResultados();
    }, 140);
  };

  // Delegado en la seccion entera: resultados y carrito se repintan en cada
  // cambio y unos onclick puestos a mano se perderian.
  $('bloque-mostrador').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sumar],[data-restar],[data-sacar],#mos-cobrar');
    if (!b) return;
    if (b.dataset.sumar) return sumar(Number(b.dataset.sumar));
    if (b.dataset.restar) return restar(Number(b.dataset.restar));
    if (b.dataset.sacar) { carrito.delete(Number(b.dataset.sacar)); return pintarMostrador(); }
    if (b.id === 'mos-cobrar') return cobrar();
  });

  // La razon social aparece sola al escribir un RUC: son 11 digitos, y pedirla
  // siempre estorba en una venta de S/ 9.
  $('bloque-mostrador').addEventListener('input', (e) => {
    if (e.target.id !== 'mos-doc') return;
    const razon = $('mos-razon');
    if (razon) razon.hidden = e.target.value.trim().length !== 11;
  });


  $('btn-respaldar').onclick = respaldarAhora;

  $('mes-antes').onclick = () => moverMes(-1);
  $('mes-despues').onclick = () => moverMes(1);

  $('btn-refrescar').onclick = cargar;
  $('areas').onclick = (e) => {
    const b = e.target.closest('[data-area]');
    if (b) mostrarArea(b.dataset.area);
  };

  $('btn-qr').onclick = imprimirQr;
  $('btn-ruta').onclick = imprimirRuta;
  $('btn-salir').onclick = async () => {
    await fetch('/api/logout', { method: 'POST' });
    location.replace('/login.html');
  };


  // ------------------------------------------------------------ alta de ficha
  // El <dialog> nativo se encarga del foco y del Escape. Aquí solo queda lo que
  // el navegador no puede saber: qué categorías existen ya, cuánto margen deja
  // el precio que se está escribiendo, y qué contesta el servidor.

  const dlg = $('dlg-alta');

  /**
   * Abre el dialogo. Sin `producto` es un alta; con `producto`, una edicion de
   * esa ficha.
   *
   * Dos campos se apagan al editar y esta la razon en el servidor: el SKU es la
   * identidad del producto en el kardex y en los comprobantes ya emitidos, y el
   * stock solo se mueve por ventas, ingresos y ajustes — nunca a dedo.
   */
  async function abrirFicha(producto = null) {
    editando = producto;
    $('forma-alta').reset();
    $('alta-error').hidden = true;

    $('dlg-titulo').textContent = producto ? `Editar ${producto.nombre}` : 'Nuevo producto';
    $('guardar-alta').textContent = producto ? 'Guardar cambios' : 'Guardar producto';

    for (const el of document.querySelectorAll('[data-solo-alta]')) {
      el.disabled = Boolean(producto);
      el.closest('.campo')?.classList.toggle('campo-apagado', Boolean(producto));
    }

    if (producto) {
      for (const [campo, valor] of Object.entries({
        nombre: producto.nombre, categoria: producto.categoria,
        presentacion: producto.presentacion, precio: producto.precio,
        costo: producto.costo, origen: producto.origen,
        beneficios: producto.beneficios, etiquetas: producto.etiquetas,
        descripcion: producto.descripcion, uso_tradicional: producto.uso_tradicional,
        imagen: producto.imagen, sku: producto.sku, stock: producto.stock,
      })) {
        const el = document.querySelector(`[name="${campo}"]`);
        if (el) el.value = valor ?? '';
      }
    }

    calcularMargen();

    // Las categorías se piden al abrir, no al cargar el panel: así incluyen la
    // que se acaba de crear en el alta anterior.
    try {
      const cats = await pedir('/api/admin/categorias');
      $('cats').innerHTML = cats
        .map((c) => `<option value="${escapar(c.categoria)}">`).join('');
    } catch { /* sin sugerencias se puede escribir igual */ }

    dlg.showModal();
    $('a-nombre').focus();
  }

  /**
   * Margen en vivo. El dueño de una tienda no calcula porcentajes de cabeza
   * mientras atiende; ver el número ponerse rojo es lo que evita cargar un
   * producto que se vende a pérdida.
   */
  function calcularMargen() {
    const precio = Number($('a-precio').value);
    const costo = Number($('a-costo').value);
    const salida = $('a-margen');
    salida.classList.remove('flojo', 'perdida');

    if (!precio || !Number.isFinite(precio) || !Number.isFinite(costo) || !costo) {
      salida.textContent = '—';
      return;
    }
    const pct = Math.round(((precio - costo) / precio) * 100);
    salida.textContent = pct + '%';
    if (pct < 0) salida.classList.add('perdida');
    else if (pct < 20) salida.classList.add('flojo');
  }

  async function guardarFicha(e) {
    e.preventDefault();
    const error = $('alta-error');
    error.hidden = true;

    const datos = Object.fromEntries(new FormData($('forma-alta')).entries());
    const boton = $('guardar-alta');
    const anterior = boton.textContent;
    boton.disabled = true;
    boton.textContent = 'Guardando…';

    // Editando se mandan SOLO los campos que cambiaron: cada cambio queda
    // firmado en la bitacora, y mandarlos todos llenaria el historial de
    // «precio: 27.40 -> 27.40» cada vez que alguien abre la ficha a mirar.
    const cambiados = editando
      ? Object.fromEntries(Object.entries(datos).filter(([k, v]) => {
        if (k === 'sku' || k === 'stock') return false;
        const antes = editando[k] ?? '';
        return String(v) !== String(antes)
          && !(Number.isFinite(Number(antes)) && Number(v) === Number(antes));
      }))
      : datos;

    if (editando && !Object.keys(cambiados).length) {
      dlg.close();
      return avisar('No cambiaste nada');
    }

    try {
      const r = await fetch(editando ? `/api/productos/${editando.id}` : '/api/productos', {
        method: editando ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cambiados),
      });
      if (r.status === 401) return alLogin();
      const d = await r.json();
      if (!r.ok) {
        error.textContent = d.error || 'No se pudo guardar el producto.';
        error.hidden = false;
        // Llevar el foco al campo que el servidor señaló ahorra buscarlo en un
        // formulario largo.
        const campo = d.campo && document.querySelector(`[name="${d.campo}"]`);
        if (campo) { campo.focus(); campo.scrollIntoView({ block: 'center' }); }
        return;
      }
      dlg.close();
      avisar(editando
        ? `${d.producto.nombre} actualizado (${d.cambios.join(', ')})`
        : `${d.producto.nombre} dado de alta como ${d.producto.sku}`);
      filtroProducto = d.producto.sku;
      $('buscar-producto').value = d.producto.sku;
      await cargar();
    } catch {
      error.textContent = 'No se pudo conectar. Revisa la conexión e intenta de nuevo.';
      error.hidden = false;
    } finally {
      boton.disabled = false;
      boton.textContent = anterior;
    }
  }

  /**
   * Elegir la foto del producto de la galería del teléfono o del disco.
   *
   * Antes había que escribir a mano la ruta de un archivo que alguien tenía que
   * haber dejado antes en el servidor, por consola. Para una tienda que se
   * administra desde el celular del mostrador eso era, en la práctica, no poder
   * poner fotos.
   *
   * El campo de ruta sigue ahí debajo: sirve para reutilizar una foto que ya
   * está subida sin volver a subirla. Lo que se elige aquí simplemente lo
   * rellena, así que la ficha se sigue guardando de una sola manera.
   */
  function mostrarFoto(ruta) {
    const vista = $('a-foto-vista');
    $('a-imagen').value = ruta || '';
    vista.hidden = !ruta;
    if (ruta) $('a-foto-img').src = ruta;
  }

  $('a-foto').onchange = async (e) => {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    const estado = $('a-foto-estado');

    // Se avisa acá y no solo en el servidor: subir 8 MB por datos móviles para
    // que lo rechacen al llegar es el peor sitio donde enterarse.
    if (archivo.size > 4 * 1024 * 1024) {
      estado.textContent = `Pesa ${(archivo.size / 1048576).toFixed(1)} MB. El máximo son 4.`;
      estado.className = 'foto-estado foto-mal';
      e.target.value = '';
      return;
    }

    estado.textContent = 'Subiendo…';
    estado.className = 'foto-estado';
    try {
      const r = await fetch('/api/fotos', {
        method: 'POST',
        headers: { 'Content-Type': archivo.type || 'application/octet-stream' },
        body: archivo,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'No se pudo subir');

      mostrarFoto(d.ruta);
      estado.textContent = `Lista · ${Math.round(d.peso / 1024)} KB`;
      estado.className = 'foto-estado foto-bien';
    } catch (err) {
      estado.textContent = err.message;
      estado.className = 'foto-estado foto-mal';
    } finally {
      // Se limpia para que elegir DOS VECES el mismo archivo vuelva a disparar
      // el evento: sin esto, corregir una foto mal recortada y volver a
      // elegirla no hacía nada.
      e.target.value = '';
    }
  };

  $('a-foto-quitar').onclick = () => {
    mostrarFoto('');
    $('a-foto-estado').textContent = 'JPG, PNG o WEBP · hasta 4 MB';
    $('a-foto-estado').className = 'foto-estado';
  };

  // Al abrir la ficha de un producto que ya tiene foto, se ve la que tiene.
  $('a-imagen').oninput = () => mostrarFoto($('a-imagen').value.trim());

  $('abrir-alta').onclick = () => abrirFicha();
  $('cerrar-alta').onclick = () => dlg.close();
  $('cancelar-alta').onclick = () => dlg.close();
  $('forma-alta').onsubmit = guardarFicha;
  $('a-precio').oninput = calcularMargen;
  $('a-costo').oninput = calcularMargen;

  // Primero quien es, despues los datos: si se lanzan a la vez, el primer
  // pintado puede salir con los controles del dueño y corregirse un instante
  // despues. Un panel que parpadea permisos se ve inseguro, aunque el servidor
  // este cortando bien.
  identificar().then(cargar);

  // No refrescamos si la pestaña no está a la vista: no tiene sentido consultar
  // al servidor mientras el dueño atiende en el mostrador.
  let reloj = setInterval(cargar, 15000);
  document.addEventListener('visibilitychange', () => {
    clearInterval(reloj);
    if (!document.hidden) { cargar(); reloj = setInterval(cargar, 15000); }
  });
})();
