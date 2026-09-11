/**
 * Envase 3D del hero, en canvas.
 *
 * Por qué canvas y no CSS 3D: la primera versión eran 20 caras rotadas con un
 * `brightness` fijo por cara. Como la cara gira, su sombra giraba con ella —
 * el resultado parecía un poste de barbería. La luz de verdad se queda quieta.
 *
 * Acá el cilindro se dibuja columna por columna con mapeado de textura:
 *
 *   nx = (x - cx) / R            posición horizontal normalizada, en [-1, 1]
 *   θ  = asin(nx)                ángulo de la superficie visible en esa columna
 *   u  = (θ / 2π + giro) mod 1   coordenada de la etiqueta que toca ahí
 *
 * De ahí salen dos cosas gratis y correctas: la etiqueta se comprime hacia los
 * bordes como en un cilindro real, y la iluminación se aplica DESPUÉS, en
 * coordenadas de pantalla, así que no gira nunca.
 *
 * Y como la tienda no vende solo polvos, el hero recorre la gama completa:
 * tónico, crema, hierba, esencia y superalimento.
 */
(() => {
  'use strict';

  const lienzo = document.getElementById('frasco3d');
  if (!lienzo) return;

  const ctx = lienzo.getContext('2d');
  const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ANCHO = 420;
  const ALTO = 540;
  const CX = ANCHO / 2;
  const TEX_W = 360;          // una vuelta completa del envase, en píxeles
  const TEX_H = 300;

  // --------------------------------------------------------------- la gama
  const GAMA = [
    {
      familia: 'Tónico',
      nombre: 'HERCAMPURI',
      sub: 'Sierra central',
      pie: 'Tónico depurativo · Frasco 250 ml',
      r: 74, alto: 250, cuerpo: '#3f6b45', liquido: '#2c4d35',
      etiqueta: '#f7efe0', tinta: '#26402c', tapa: '#1d2a20', forma: 'botella',
    },
    {
      familia: 'Crema',
      nombre: 'ROSA MOSQUETA',
      sub: 'Cusco',
      pie: 'Crema regeneradora · Pote 60 g',
      r: 98, alto: 156, cuerpo: '#e8d3c4', liquido: '#d8916d',
      etiqueta: '#fffaf4', tinta: '#8a4c33', tapa: '#b26a48', forma: 'pote',
    },
    {
      familia: 'Hierba',
      nombre: 'MUÑA',
      sub: 'Cusco · 3 400 m',
      pie: 'Hierba seca a la sombra · Bolsa 60 g',
      r: 86, alto: 232, cuerpo: '#8aa85e', liquido: '#5c7a3e',
      etiqueta: '#f4f7e8', tinta: '#3f5527', tapa: '#455a28', forma: 'frasco',
    },
    {
      familia: 'Esencia',
      nombre: 'COPAIBA',
      sub: 'Iquitos, Loreto',
      pie: 'Óleo-resina puro · Gotero 30 ml',
      r: 62, alto: 200, cuerpo: '#7d3c0e', liquido: '#4a2007',
      etiqueta: '#f6e6cf', tinta: '#6b3410', tapa: '#2a1408', forma: 'gotero',
    },
    {
      familia: 'Superalimento',
      nombre: 'MACA NEGRA',
      sub: 'Junín · 4 100 m',
      pie: 'Molida en piedra · Bolsa 250 g',
      r: 92, alto: 236, cuerpo: '#e0a03c', liquido: '#a2661a',
      etiqueta: '#fdf6e6', tinta: '#7a4d12', tapa: '#4a3010', forma: 'frasco',
    },
  ];

  // ------------------------------------------------------ textura del envase
  /**
   * Dibuja una vuelta completa del envase, dos veces seguidas.
   * Duplicarla evita tener que partir el muestreo cuando la etiqueta cruza
   * el punto de costura: siempre hay textura contigua a la derecha.
   */
  function crearTextura(p) {
    const t = document.createElement('canvas');
    t.width = TEX_W * 2;
    t.height = TEX_H;
    const c = t.getContext('2d');

    for (let vuelta = 0; vuelta < 2; vuelta++) {
      const dx = vuelta * TEX_W;

      // Cuerpo: el vidrio, más claro arriba donde entra la luz del ambiente.
      const cuerpo = c.createLinearGradient(0, 0, 0, TEX_H);
      cuerpo.addColorStop(0, p.cuerpo);
      cuerpo.addColorStop(0.16, p.cuerpo);
      cuerpo.addColorStop(0.18, p.liquido);
      cuerpo.addColorStop(1, p.liquido);
      c.fillStyle = cuerpo;
      c.fillRect(dx, 0, TEX_W, TEX_H);

      // Línea del contenido: el borde donde empieza el líquido o el polvo.
      c.fillStyle = 'rgba(255,255,255,.14)';
      c.fillRect(dx, TEX_H * 0.17, TEX_W, 3);

      // Etiqueta: no da la vuelta entera, como una etiqueta de papel real.
      const eX = dx + TEX_W * 0.08;
      const eW = TEX_W * 0.72;
      const eY = TEX_H * 0.33;
      const eH = TEX_H * 0.42;
      c.fillStyle = p.etiqueta;
      c.fillRect(eX, eY, eW, eH);

      // Sombra del canto del papel, arriba y abajo.
      c.fillStyle = 'rgba(0,0,0,.13)';
      c.fillRect(eX, eY, eW, 2);
      c.fillRect(eX, eY + eH - 2, eW, 2);

      const centro = eX + eW / 2;
      c.textAlign = 'center';

      c.fillStyle = p.tinta;
      c.font = '600 11px "Segoe UI", system-ui, sans-serif';
      c.globalAlpha = 0.72;
      c.fillText(p.familia.toUpperCase(), centro, eY + 27);
      c.globalAlpha = 1;

      // El nombre se encoge si es largo, para que nunca desborde la etiqueta.
      let cuerpoTipo = 27;
      do {
        c.font = `800 ${cuerpoTipo}px "Segoe UI", system-ui, sans-serif`;
        if (c.measureText(p.nombre).width <= eW - 34) break;
        cuerpoTipo -= 1;
      } while (cuerpoTipo > 13);
      c.fillText(p.nombre, centro, eY + 62);

      c.fillStyle = p.tinta;
      c.globalAlpha = 0.5;
      c.fillRect(centro - 22, eY + 74, 44, 2);
      c.globalAlpha = 0.78;
      c.font = '500 11px "Segoe UI", system-ui, sans-serif';
      c.fillText(p.sub, centro, eY + 96);
      c.globalAlpha = 1;
    }
    return t;
  }

  // ----------------------------------------------------------------- dibujo
  function dibujarCilindro(p, textura, giro) {
    const R = p.r;
    const alto = p.alto;
    const yTop = (ALTO - alto) / 2 + 34;
    const ry = R * 0.24;                        // achatamiento de las elipses

    ctx.save();

    // Silueta: rectángulo con el fondo redondeado. Recorta todo lo demás.
    ctx.beginPath();
    ctx.moveTo(CX - R, yTop);
    ctx.lineTo(CX - R, yTop + alto);
    ctx.ellipse(CX, yTop + alto, R, ry, 0, Math.PI, 0, true);
    ctx.lineTo(CX + R, yTop);
    ctx.closePath();
    ctx.clip();

    // Columna por columna: acá ocurre el mapeado.
    for (let x = -R; x < R; x++) {
      const nx = Math.max(-1, Math.min(1, (x + 0.5) / R));
      const theta = Math.asin(nx);
      let u = (theta / (2 * Math.PI) + giro) % 1;
      if (u < 0) u += 1;

      // Ancho de textura que cae en esta columna: hacia los bordes, muchos
      // píxeles de etiqueta se comprimen en uno solo de pantalla.
      const dTheta = 1 / (R * Math.max(0.08, Math.sqrt(1 - nx * nx)));
      const sw = Math.max(1, (dTheta / (2 * Math.PI)) * TEX_W);

      ctx.drawImage(textura, u * TEX_W, 0, sw, TEX_H, CX + x, yTop, 1.02, alto);
    }

    // ---- Iluminación, en coordenadas de PANTALLA: no gira con el envase.
    const sombra = ctx.createLinearGradient(CX - R, 0, CX + R, 0);
    sombra.addColorStop(0.00, 'rgba(0,0,0,.72)');
    sombra.addColorStop(0.12, 'rgba(0,0,0,.30)');
    sombra.addColorStop(0.30, 'rgba(0,0,0,0)');
    sombra.addColorStop(0.62, 'rgba(0,0,0,.10)');
    sombra.addColorStop(0.86, 'rgba(0,0,0,.45)');
    sombra.addColorStop(1.00, 'rgba(0,0,0,.78)');
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = sombra;
    ctx.fillRect(CX - R, yTop - 4, R * 2, alto + ry * 2 + 8);

    // Brillo especular: la franja de luz del vidrio.
    const brillo = ctx.createLinearGradient(CX - R, 0, CX + R, 0);
    brillo.addColorStop(0.00, 'rgba(255,255,255,0)');
    brillo.addColorStop(0.16, 'rgba(255,255,255,.30)');
    brillo.addColorStop(0.24, 'rgba(255,255,255,.52)');
    brillo.addColorStop(0.32, 'rgba(255,255,255,.12)');
    brillo.addColorStop(0.46, 'rgba(255,255,255,0)');
    brillo.addColorStop(0.90, 'rgba(255,255,255,.10)');
    brillo.addColorStop(1.00, 'rgba(255,255,255,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = brillo;
    ctx.fillRect(CX - R, yTop - 4, R * 2, alto + ry * 2 + 8);

    // Oscurecido inferior: el envase se apoya en la sombra.
    const pie = ctx.createLinearGradient(0, yTop + alto - 46, 0, yTop + alto + ry);
    pie.addColorStop(0, 'rgba(0,0,0,0)');
    pie.addColorStop(1, 'rgba(0,0,0,.5)');
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = pie;
    ctx.fillRect(CX - R, yTop + alto - 46, R * 2, ry + 46);

    ctx.restore();
    return { yTop, ry, R };
  }

  function dibujarBoca(p, g) {
    const { yTop, ry, R } = g;

    // Elipse superior: el borde del envase visto desde arriba.
    const boca = ctx.createLinearGradient(CX - R, 0, CX + R, 0);
    boca.addColorStop(0, '#0f0c09');
    boca.addColorStop(0.35, p.tapa);
    boca.addColorStop(1, '#0b0907');
    ctx.beginPath();
    ctx.ellipse(CX, yTop, R, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = boca;
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(CX, yTop, R * 0.82, ry * 0.78, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  /** Cada familia se reconoce por su tapa antes que por su etiqueta. */
  function dibujarTapa(p, g) {
    const { yTop, ry, R } = g;
    const tapaGrad = (x0, x1) => {
      const gr = ctx.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(0, '#0d0a07');
      gr.addColorStop(0.32, p.tapa);
      gr.addColorStop(0.52, '#0f0c09');
      gr.addColorStop(1, '#080605');
      return gr;
    };

    if (p.forma === 'pote') {
      // Crema: tapa ancha y baja, del mismo diámetro que el pote.
      const h = 30;
      ctx.fillStyle = tapaGrad(CX - R, CX + R);
      ctx.fillRect(CX - R, yTop - h, R * 2, h + ry);
      ctx.beginPath();
      ctx.ellipse(CX, yTop - h, R, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#2c2018';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(CX, yTop - h, R * 0.7, ry * 0.66, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,.13)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      return;
    }

    // Cuello + tapa. El gotero lo lleva más alto y estrecho.
    const esGotero = p.forma === 'gotero';
    const rc = R * (esGotero ? 0.34 : 0.44);       // radio del cuello
    const hc = esGotero ? 30 : 22;                 // alto del cuello
    const rt = rc * (esGotero ? 1.25 : 1.16);      // radio de la tapa
    const ht = esGotero ? 40 : 30;

    ctx.fillStyle = tapaGrad(CX - rc, CX + rc);
    ctx.fillRect(CX - rc, yTop - hc, rc * 2, hc + 6);

    ctx.fillStyle = tapaGrad(CX - rt, CX + rt);
    ctx.fillRect(CX - rt, yTop - hc - ht, rt * 2, ht);

    ctx.beginPath();
    ctx.ellipse(CX, yTop - hc - ht, rt, rt * 0.26, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#241a12';
    ctx.fill();

    // Estrías de la tapa a rosca.
    ctx.strokeStyle = 'rgba(0,0,0,.32)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 7; i++) {
      const x = CX - rt + (rt * 2 * i) / 7;
      ctx.beginPath();
      ctx.moveTo(x, yTop - hc - ht + 5);
      ctx.lineTo(x, yTop - hc - 4);
      ctx.stroke();
    }
  }

  function dibujarSombraPiso(p, g) {
    const { yTop, ry, R } = g;
    const y = yTop + p.alto + ry * 0.7;
    const s = ctx.createRadialGradient(CX, y, 0, CX, y, R * 1.7);
    s.addColorStop(0, 'rgba(0,0,0,.55)');
    s.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(CX, y);
    ctx.scale(1, 0.2);
    ctx.translate(-CX, -y);
    ctx.beginPath();
    ctx.arc(CX, y, R * 1.7, 0, Math.PI * 2);
    ctx.fillStyle = s;
    ctx.fill();
    ctx.restore();
  }

  // ----------------------------------------------------------------- ciclo
  const texturas = GAMA.map(crearTextura);
  let indice = 0;
  let giro = 0;
  let opacidad = 1;
  let cambiando = 0;        // -1 saliendo, +1 entrando, 0 estable
  let ultimoCambio = performance.now();
  const DURACION = 5600;    // cuánto se queda cada producto
  const FUNDIDO = 480;

  const nombreEl = document.getElementById('frasco-nombre');
  const pieEl = document.getElementById('frasco-pie');
  const puntos = [...document.querySelectorAll('#frasco-puntos button')];

  function escribirPie() {
    const p = GAMA[indice];
    if (nombreEl) nombreEl.textContent = p.nombre;
    if (pieEl) pieEl.textContent = p.pie;
    puntos.forEach((b, i) => b.classList.toggle('activo', i === indice));
  }

  function irA(i, inmediato = false) {
    if (i === indice) return;
    if (inmediato || quieto) {
      indice = i; opacidad = 1; cambiando = 0;
      escribirPie();
      requestAnimationFrame(cuadro);       // el bucle está parado: un cuadro más
      return;
    }
    cambiando = -1;
    pendiente = i;
    ultimoCambio = performance.now();
  }
  let pendiente = null;

  puntos.forEach((b, i) => { b.onclick = () => irA(i); });

  function ajustarTamano() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    lienzo.width = ANCHO * dpr;
    lienzo.height = ALTO * dpr;
    lienzo.style.width = ANCHO + 'px';
    lienzo.style.height = ALTO + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function cuadro(ahora) {
    if (!quieto) giro = (giro + 0.0016) % 1;

    // Transición entre productos.
    if (cambiando === -1) {
      opacidad = Math.max(0, 1 - (ahora - ultimoCambio) / FUNDIDO);
      if (opacidad === 0) {
        indice = pendiente !== null ? pendiente : (indice + 1) % GAMA.length;
        pendiente = null;
        escribirPie();
        cambiando = 1;
        ultimoCambio = ahora;
      }
    } else if (cambiando === 1) {
      opacidad = Math.min(1, (ahora - ultimoCambio) / FUNDIDO);
      if (opacidad === 1) { cambiando = 0; ultimoCambio = ahora; }
    } else if (!quieto && ahora - ultimoCambio > DURACION) {
      cambiando = -1;
      ultimoCambio = ahora;
    }

    ctx.clearRect(0, 0, ANCHO, ALTO);
    ctx.globalAlpha = opacidad;
    ctx.globalCompositeOperation = 'source-over';

    const actual = GAMA[indice];
    dibujarSombraPiso(actual, { yTop: (ALTO - actual.alto) / 2 + 34, ry: actual.r * 0.24, R: actual.r });
    const g = dibujarCilindro(actual, texturas[indice], giro);
    ctx.globalCompositeOperation = 'source-over';
    dibujarBoca(actual, g);
    dibujarTapa(actual, g);

    ctx.globalAlpha = 1;

    // Con movimiento reducido no hay nada que animar: dibujamos una vez y
    // paramos. Volver a pedir cuadros sería gastar batería sin motivo.
    if (quieto && cambiando === 0) return;
    requestAnimationFrame(cuadro);
  }

  ajustarTamano();
  addEventListener('resize', ajustarTamano);
  escribirPie();
  requestAnimationFrame(cuadro);
})();
