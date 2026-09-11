/**
 * Movimiento del landing: partículas, revelados por scroll, contadores
 * y micro-interacciones. El envase 3D del hero está en frasco.js.
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

  // El envase 3D vive en js/frasco.js: se dibuja en canvas, no en CSS.

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

  // --------------------------------------------- revelado al hacer scroll
  const observador = new IntersectionObserver((entradas) => {
    for (const e of entradas) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('visto');
      observador.unobserve(e.target);          // una sola vez: no parpadea
    }
  }, { threshold: 0.16, rootMargin: '0px 0px -60px 0px' });

  $$('.revelar').forEach((el) => observador.observe(el));

  /** Las tarjetas del catálogo nacen después: hay que observarlas al vuelo. */
  window.revelarNuevos = (elementos) => elementos.forEach((el) => {
    el.classList.add('revelar');
    observador.observe(el);
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

    const palabras = [...p.querySelectorAll('.palabra')];
    if (quieto) { palabras.forEach((w) => w.classList.add('viva')); return; }

    // El avance se ata al scroll: el texto se "enciende" mientras bajas.
    let pendiente = false;
    const actualizar = () => {
      pendiente = false;
      const caja = p.getBoundingClientRect();
      const recorrido = innerHeight * 0.62;
      const avance = (recorrido - caja.top) / (caja.height + recorrido * 0.5);
      const cuantas = Math.round(Math.max(0, Math.min(1, avance)) * palabras.length);
      palabras.forEach((w, i) => w.classList.toggle('viva', i < cuantas));
    };
    addEventListener('scroll', () => {
      if (!pendiente) { pendiente = true; requestAnimationFrame(actualizar); }
    }, { passive: true });
    actualizar();
  })();

  // ---------------------------------------------------------- contadores
  (() => {
    const vistos = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        if (!e.isIntersecting) continue;
        const el = e.target;
        vistos.unobserve(el);
        const sufijo = el.dataset.sufijo || '';
        if (quieto) {
          el.textContent = Number(el.dataset.contar).toLocaleString('es-PE') + sufijo;
          el.dataset.contado = '1';
          continue;
        }

        const inicio = performance.now();
        const dura = 1300;
        const paso = (ahora) => {
          // La meta se relee cada cuadro: si el catálogo carga a mitad de la
          // animación y trae otro número, el contador se reencamina solo.
          const meta = Number(el.dataset.contar) || 0;
          const t = Math.min(1, (ahora - inicio) / dura);
          const suave = 1 - Math.pow(1 - t, 3);          // easeOutCubic
          el.textContent = Math.round(meta * suave).toLocaleString('es-PE') + sufijo;
          if (t < 1) requestAnimationFrame(paso);
          else el.dataset.contado = '1';
        };
        requestAnimationFrame(paso);
      }
    }, { threshold: 0.5 });

    $$('[data-contar]').forEach((el) => vistos.observe(el));
  })();

  // ------------------------------------------------------- nav al hacer scroll
  (() => {
    const nav = document.getElementById('nav');
    if (!nav) return;
    let pendiente = false;
    addEventListener('scroll', () => {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(() => {
        pendiente = false;
        nav.classList.toggle('encogida', scrollY > 40);
      });
    }, { passive: true });
  })();

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
