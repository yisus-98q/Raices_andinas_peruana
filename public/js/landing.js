/**
 * Movimiento del landing: partículas, revelados por scroll, contadores
 * y micro-interacciones.
 *
 * Sin librerías a propósito. Lo que en el pedido original harían GSAP
 * ScrollTrigger y Framer Motion, acá lo hacen IntersectionObserver y
 * requestAnimationFrame: mismo resultado, cero build, funciona sin internet.
 * Ese último punto no es capricho — la demo corre en el local del cliente.
 */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;


  // ---------------------------------------------------------- partículas
  // Motas de polen subiendo. Se apagan si la pestaña no está visible.
  (() => {
    const lienzo = document.getElementById('particulas');
    if (!lienzo || quieto) return;
    const ctx = lienzo.getContext('2d');
    let ancho = 0, alto = 0, motas = [], animacion = null;

    const nueva = () => ({
      x: Math.random() * ancho,
      y: alto + Math.random() * alto,
      r: Math.random() * 2 + 0.7,
      vel: Math.random() * 0.34 + 0.12,
      fase: Math.random() * Math.PI * 2,
      vaiven: Math.random() * 0.5 + 0.2,
      alfa: Math.random() * 0.5 + 0.15,
    });

    function medir() {
      ancho = lienzo.width = innerWidth;
      alto = lienzo.height = innerHeight;
      const cuantas = Math.min(70, Math.round(innerWidth / 22));
      motas = Array.from({ length: cuantas }, nueva);
    }

    function pintar() {
      ctx.clearRect(0, 0, ancho, alto);
      for (const m of motas) {
        m.y -= m.vel;
        m.fase += 0.011;
        const x = m.x + Math.sin(m.fase) * m.vaiven * 22;
        if (m.y < -12) Object.assign(m, nueva(), { y: alto + 12 });
        ctx.beginPath();
        ctx.arc(x, m.y, m.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(240, 165, 44, ${m.alfa})`;
        ctx.fill();
      }
      animacion = requestAnimationFrame(pintar);
    }

    function arrancar() { if (!animacion) pintar(); }
    function parar() { cancelAnimationFrame(animacion); animacion = null; }

    medir();
    arrancar();
    addEventListener('resize', medir);
    document.addEventListener('visibilitychange', () =>
      document.hidden ? parar() : arrancar());
  })();

  // ------------------------------------------------------- luz que sigue
  (() => {
    const luz = document.getElementById('luz');
    if (!luz || quieto) return;
    addEventListener('pointermove', (e) => {
      luz.style.setProperty('--mx', (e.clientX / innerWidth * 100).toFixed(1) + '%');
      luz.style.setProperty('--my', (e.clientY / innerHeight * 100).toFixed(1) + '%');
    }, { passive: true });
  })();

  // ------------------------------------------------ nada cambia con el scroll
  /**
   * La página se ve igual en cualquier punto del recorrido.
   *
   * Antes cada sección entraba deslizándose al llegar a ella, las palabras del
   * manifiesto se encendían de a una, los contadores subían desde cero y la
   * barra se achicaba. Quien baja buscando el costo del envío ve cosas que se
   * mueven y aparecen tarde, y se lee como una página que todavía está
   * cargando. Todo queda en su estado final desde el primer cuadro.
   *
   * `revelarNuevos` se conserva porque app.js lo llama con las tarjetas que
   * pinta después: ahora solo las marca como ya vistas.
   */
  $$('.revelar').forEach((el) => el.classList.add('visto'));
  window.revelarNuevos = (elementos) => elementos.forEach((el) => {
    el.classList.add('revelar', 'visto');
  });

  // ------------------------------------------ manifiesto palabra por palabra
  (() => {
    const p = document.getElementById('manifiesto');
    if (!p) return;

    // Partimos el texto conservando qué palabras iban en <b> (las acentuadas).
    const trozos = [];
    for (const nodo of p.childNodes) {
      const acento = nodo.nodeName === 'B';
      const texto = nodo.textContent.trim();
      if (!texto) continue;
      for (const palabra of texto.split(/\s+/)) trozos.push({ palabra, acento });
    }
    p.innerHTML = trozos.map((t) =>
      `<span class="palabra${t.acento ? ' acento' : ''}">${t.palabra}</span>`).join(' ');

    // Todas encendidas de entrada: ya no se atan al scroll.
    p.querySelectorAll('.palabra').forEach((w) => w.classList.add('viva'));
  })();

  // ---------------------------------------------------------- contadores
  // La cifra final desde el principio. `contado` le avisa a app.js que puede
  // escribir el número del catálogo directo cuando llegue.
  $$('[data-contar]').forEach((el) => {
    el.textContent = Number(el.dataset.contar).toLocaleString('es-PE') + (el.dataset.sufijo || '');
    el.dataset.contado = '1';
  });

  // La barra de arriba nace ya en su forma compacta (clase `encogida` en el
  // HTML) y no cambia de alto ni de fondo al bajar.

  // ------------------------------------------------------- botón magnético
  (() => {
    const boton = document.getElementById('cta-magnetico');
    if (!boton || quieto) return;
    const FUERZA = 0.28;
    boton.addEventListener('pointermove', (e) => {
      const c = boton.getBoundingClientRect();
      const dx = e.clientX - (c.left + c.width / 2);
      const dy = e.clientY - (c.top + c.height / 2);
      boton.style.transform = `translate(${dx * FUERZA}px, ${dy * FUERZA}px)`;
    });
    boton.addEventListener('pointerleave', () => { boton.style.transform = ''; });
  })();

  // ------------------------------------------------------------ marquesina
  // Duplicamos el contenido para que el bucle del -50% no deje hueco.
  (() => {
    const pista = document.getElementById('marquesina');
    if (pista) pista.innerHTML += pista.innerHTML;
  })();
})();
