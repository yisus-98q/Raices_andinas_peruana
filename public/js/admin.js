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

  const SIGUIENTE = {
    pendiente: 'preparando',
    preparando: 'enviado',
    enviado: 'entregado',
  };
  const VERBO = {
    preparando: 'Marcar en preparación',
    enviado: 'Marcar enviado',
    entregado: 'Marcar entregado',
  };

  let ultimosPedidos = [];
  let ultimosProductos = [];
  let ultimosComprobantes = [];
  let filtro = '';
  let filtroProducto = '';
  let verBajas = false;
  let filtroCliente = '';
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
      const [resumen, pedidos, movimientos, productos, cambios, comprobantes,
        cal, clientes] = await Promise.all([
        pedir('/api/admin/resumen'),
        pedir('/api/pedidos'),
        pedir('/api/admin/movimientos'),
        pedir('/api/admin/productos'),
        pedir('/api/admin/cambios'),
        pedir('/api/admin/comprobantes'),
        pedir('/api/admin/calendario' + (mesVisto ? '?mes=' + mesVisto : '')),
        pedir('/api/admin/clientes'),
      ]);
      ultimosPedidos = pedidos;
      ultimosProductos = productos;
      // Los comprobantes se guardan porque cada pedido enlaza al suyo.
      ultimosComprobantes = comprobantes;
      pintarKpis(resumen);
      pintarStock(resumen.bajo_stock);
      pintarTop(resumen.top_productos);
      pintarPedidos();
      pintarMovimientos(movimientos);
      pintarProductos();
      pintarCambios(cambios);
      pintarComprobantes(comprobantes);
      pintarCalendario(cal);
      ultimosClientes = clientes;
      pintarClientes();
      $('hora').textContent = new Date().toLocaleTimeString('es-PE',
        { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      if (e.message !== 'sin sesión') avisar('No se pudo conectar con el servidor');
    }
  }

  async function identificar() {
    try {
      const s = await pedir('/api/sesion');
      $('quien').textContent = s.nombre;
    } catch { /* pedir() ya redirigió */ }
  }

  // --------------------------------------------------------------------- KPI
  function pintarKpis(r) {
    const tarjetas = [
      { etiqueta: 'Ventas de hoy', valor: soles(r.ventas_hoy), nota: `${r.pedidos_hoy} pedido(s)` },
      { etiqueta: 'Por atender', valor: r.pedidos_pendientes, nota: 'pendientes y en preparación' },
      {
        etiqueta: 'Reposición urgente', valor: r.bajo_stock.length,
        nota: r.agotados ? `${r.agotados} ya agotado(s)` : 'ninguno agotado aún',
        alerta: r.bajo_stock.length > 0,
      },
      {
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
  function comprobanteDe(p) {
    const tipo = p.tipo_comprobante === 'factura' ? 'factura' : 'boleta';
    const cmp = ultimosComprobantes.find((c) => c.pedido_id === p.id);
    if (!cmp) return `<span class="comprobante c-${tipo}">${tipo} pendiente</span>`;
    return `<a class="comprobante c-${tipo} enlace-cmp"
               href="/comprobante.html?id=${cmp.id}"
               title="Ver e imprimir la ${tipo} de ${escapar(p.cliente_nombre)}"
            >${escapar(cmp.numero)}</a>`;
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
      const siguiente = SIGUIENTE[p.estado];
      const items = p.items.map((i) => `${i.cantidad} × ${escapar(i.nombre)}`).join(' · ');

      // Un pedido entregado todavía admite devolución: la política da 7 días.
      // Antes el botón se ocultaba y el dueño no podía procesarla.
      const acciones = [];
      if (siguiente) {
        acciones.push(`<button class="mini" data-estado="${siguiente}" data-id="${p.id}">${VERBO[siguiente]}</button>`);
      }
      if (p.estado === 'entregado') {
        acciones.push(`<button class="mini mini-peligro" data-estado="devuelto" data-id="${p.id}">Registrar devolución</button>`);
      } else if (p.estado !== 'anulado' && p.estado !== 'devuelto') {
        acciones.push(`<button class="mini mini-peligro" data-estado="anulado" data-id="${p.id}">Anular y devolver stock</button>`);
      }

      return `
      <div class="pedido">
        <div class="pedido-fila">
          <span class="pedido-codigo">${escapar(p.codigo)}</span>
          <span class="estado e-${p.estado}">${p.estado}</span>
          ${comprobanteDe(p)}
          <span class="pedido-total">${soles(p.total)}</span>
        </div>
        <div class="pedido-meta">
          <b>${escapar(p.razon_social || p.cliente_nombre)}</b>
          ${p.num_doc ? `· ${escapar(p.tipo_doc)} ${escapar(p.num_doc)}` : ''}
          · ${escapar(p.cliente_tel)}
          ${p.cliente_email ? `<br>${escapar(p.cliente_email)}` : ''}
          <br>${escapar(p.cliente_dir)}
          ${p.distrito ? `<br><b>${escapar(p.distrito)}</b>, ${escapar(p.provincia)}, ${escapar(p.departamento)}` : ''}
          ${p.referencia ? `<br><i>Ref: ${escapar(p.referencia)}</i>` : ''}
          <br>${soloFecha(p.creado_en)} ${horaCorta(p.creado_en)}
          ${p.costo_envio > 0 ? ` · envío ${soles(p.costo_envio)}` : ''}
          ${p.nota ? '<br><b>Nota:</b> ' + escapar(p.nota) : ''}
        </div>
        <div class="pedido-items">${items}</div>
        <div class="acciones-pedido">${acciones.join('')}</div>
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
          <span>${p.stock} en stock · mínimo ${p.stock_min}</span>
          <div class="barra"><i class="${clase}" style="width:${Math.round(ratio * 100)}%"></i></div>
        </div>
        <div class="reponer">
          <input type="number" value="${p.sugerido}" min="1" max="9999"
                 data-cantidad="${p.id}" aria-label="Cantidad a ingresar">
          <button class="mini" data-reponer="${p.id}">Ingresar</button>
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
      const margen = p.precio > 0
        ? Math.round(((p.precio - p.costo) / p.precio) * 100) : 0;
      return `
      <div class="fila-prod${p.activo ? '' : ' de-baja'}" data-prod="${p.id}">
        <div class="prod-foto">
          <img src="${escapar(p.imagen || '/img/placeholder.svg')}" alt="" data-respaldo="1">
        </div>
        <div class="prod-info">
          <strong>${escapar(p.nombre)}</strong>
          <span>${escapar(p.sku)} · ${escapar(p.categoria)} · costo ${soles(p.costo)}
            · margen ${margen}%</span>
        </div>
        <div class="prod-campo">
          <span class="prefijo">S/</span>
          <input type="number" step="0.10" min="0.1" max="99999"
                 value="${p.precio.toFixed(2)}" data-campo="precio" data-id="${p.id}"
                 aria-label="Precio de ${escapar(p.nombre)}">
        </div>
        <div class="prod-campo">
          <input type="number" step="1" min="0" max="9999"
                 value="${p.stock_min}" data-campo="stock_min" data-id="${p.id}"
                 aria-label="Stock mínimo de ${escapar(p.nombre)}">
        </div>
        <div class="prod-stock ${p.stock <= p.stock_min ? 'bajo' : ''}">${p.stock}</div>
        <div class="prod-acciones">
          <button class="mini guardar" data-guardar="${p.id}" disabled>Guardar</button>
          <button class="mini ${p.activo ? 'mini-peligro' : ''}"
                  data-activo="${p.id}" data-valor="${p.activo ? 0 : 1}">
            ${p.activo ? 'Dar de baja' : 'Reactivar'}
          </button>
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

  // ------------------------------------------------------------ ruta del día
  /**
   * Hoja para el repartidor: los pedidos que hay que salir a entregar.
   * Sin esto había que dictarle las direcciones por teléfono una por una.
   */
  function imprimirRuta() {
    const salen = ultimosPedidos.filter(
      (p) => p.estado === 'pendiente' || p.estado === 'preparando' || p.estado === 'enviado');

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

  $('mes-antes').onclick = () => moverMes(-1);
  $('mes-despues').onclick = () => moverMes(1);

  $('btn-refrescar').onclick = cargar;
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

  async function abrirAlta() {
    $('forma-alta').reset();
    $('alta-error').hidden = true;
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

  async function guardarAlta(e) {
    e.preventDefault();
    const error = $('alta-error');
    error.hidden = true;

    const datos = Object.fromEntries(new FormData($('forma-alta')).entries());
    const boton = $('guardar-alta');
    boton.disabled = true;
    boton.textContent = 'Guardando…';

    try {
      const r = await fetch('/api/productos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datos),
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
      avisar(`${d.producto.nombre} dado de alta como ${d.producto.sku}`);
      filtroProducto = d.producto.sku;
      $('buscar-producto').value = d.producto.sku;
      await cargar();
    } catch {
      error.textContent = 'No se pudo conectar. Revisa la conexión e intenta de nuevo.';
      error.hidden = false;
    } finally {
      boton.disabled = false;
      boton.textContent = 'Guardar producto';
    }
  }

  $('abrir-alta').onclick = abrirAlta;
  $('cerrar-alta').onclick = () => dlg.close();
  $('cancelar-alta').onclick = () => dlg.close();
  $('forma-alta').onsubmit = guardarAlta;
  $('a-precio').oninput = calcularMargen;
  $('a-costo').oninput = calcularMargen;

  identificar();
  cargar();

  // No refrescamos si la pestaña no está a la vista: no tiene sentido consultar
  // al servidor mientras el dueño atiende en el mostrador.
  let reloj = setInterval(cargar, 15000);
  document.addEventListener('visibilitychange', () => {
    clearInterval(reloj);
    if (!document.hidden) { cargar(); reloj = setInterval(cargar, 15000); }
  });
})();
