# Raíz Andina — solución digital integral para tienda naturista

Demo funcional que sostiene la propuesta comercial: **no es una página web, es el
sistema que reduce pérdidas por quiebre de stock y ahorra el tiempo administrativo.**

---

## Arrancar

```bash
node gen-ubigeo.mjs      # compacta el ubigeo del INEI (una sola vez)
node gen-catalogo.mjs    # arma el catálogo de 400 productos de ejemplo
node gen-imagenes.mjs    # dibuja las ilustraciones (por SKU y de respaldo)
node importar-fotos.mjs  # importa las fotos propias de la carpeta img/
node traer-fotos.mjs     # rellena las que falten desde bancos libres (internet)
node db.js --reset       # carga la tienda con 400 productos
npm start                # http://localhost:3000
```

**Para poner las fotos del negocio:** se dejan en la carpeta `img/` de la raíz,
con el **nombre del producto** como nombre de archivo, y se ejecuta
`node importar-fotos.mjs`. No hace falta que el nombre sea exacto — tolera
tildes, mayúsculas, plurales y erratas (`gaviola en capsula.jfif` encuentra
*Graviola en cápsulas*). Con `--probar` muestra el emparejamiento sin escribir nada.

Una foto propia manda sobre cualquier otra: `traer-fotos.mjs` no la pisa ni con
`--forzar`, y `db.js --reset` la conserva. La carpeta `img/` está **fuera de
`public/`**, así que los originales no se sirven por HTTP.

`traer-fotos.mjs` es lo unico que necesita internet, y una sola vez: las fotos
quedan en `public/img/fotos/`. Despues la tienda funciona desconectada.

Sin `npm install`. Node 22.5+ (usa `node:sqlite` nativo). Funciona sin internet,
que es exactamente lo que hace falta para demostrar en la laptop, en el local del cliente.

| Ruta | Quién entra |
|---|---|
| <http://localhost:3000> | Pública — la tienda |
| <http://localhost:3000/creditos.html> | Pública — atribución de las fotos |
| `/panel` (o `/admin.html`) | **Personal.** Pide login |
| `/imagenes.html` | **Personal.** Hoja de contactos de las ilustraciones |
| `/comprobante.html` | Las dos cosas: la tienda entra con `?id=` y sesión; el comprador con `?codigo=` y los últimos 4 del teléfono |

**La tienda no enlaza al panel por ningún lado.** Un cliente no debe encontrarlo
por curiosidad. Los atajos `/panel` y `/entrar` existen para dictarlos por teléfono.

**Acceso al panel:** se entra con **correo y contraseña**. El servidor crea el
primer acceso al arrancar y lo imprime en consola:

```
correo:      hola@raizandina.pe      (sale de tienda.config.js)
contrasena:  raiz2026
```

```bash
node clave.mjs hola@raizandina.pe miClaveSegura        # cambiar contraseña (mín. 8)
node clave.mjs --correo admin dueno@raizandina.pe      # cambiar el correo
node clave.mjs --nuevo rosa rosa@raizandina.pe "Rosa Q." claveDeRosa
node clave.mjs --listar
```

> Cambia la contraseña por defecto antes de mostrarle esto a alguien. También
> puedes fijar ambas desde el arranque con `ADMIN_EMAIL` y `ADMIN_PASSWORD`.

**Por qué se conserva el usuario corto además del correo:** es lo que firma el
kardex y la bitácora. En un movimiento de stock se lee mejor
`Ingreso de mercadería (rosa)` que `(rosa@raizandina.pe)`. Para entrar sirven
los dos, pero el correo es el camino natural cuando haya recuperación de
contraseña.

> **Antes de una demo real, edita `tienda.config.js`.** Ahí están dirección,
> horario, zonas de reparto en Lima **y envío a provincia**, medios de pago,
> datos de facturación (RUC), escala de descuento por volumen, condiciones de
> mayorista y política de devolución. El asesor responde con esos datos: cámbialos
> por los del cliente y empieza a hablar de SU negocio sin tocar código.

---

## Guion de la demo (12 minutos)

### Acto 1 — La vista del cliente (3 min)

Abre la tienda en pantalla completa.

1. **El origen es el argumento.** Cada tarjeta dice *"Meseta de Bombón, Junín"*, no
   solo "Maca". Y trae el uso tradicional. Eso es lo que una farmacia no puede copiar.
2. **Filtra por categoría** y **busca "muña"**: responde al instante, sin recargar.
3. Nota los indicadores de stock: *Disponible*, *Últimas 4*, *Agotado*.
   **El cliente ve la verdad del inventario.** Nadie compra lo que no hay.

### Acto 2 — El pedido y el descuento de stock (4 min)

> Antes de este paso, ten el panel abierto en otra pestaña.

1. Agrega **Propóleo en gotas** (stock 4) — el catálogo lo marca *Últimas 4*.
2. Pon 3 unidades, confirma con datos de cliente. Sale el código `RA-…`.
   **Anótalo: es el que cierra el Acto 3.**
3. **Cambia a la pestaña del panel.** Sin tocar nada:
   - Ventas de hoy subió.
   - El pedido aparece con nombre, teléfono, dirección y nota.
   - *Reposición urgente* ahora marca Propóleo en **1 de 10**.
   - En movimientos de inventario: `-3 Propóleo · Pedido RA-… · queda 1`.

   **Frase para el cliente:** *"Esto es lo que hoy le toma media hora de cuaderno.
   Acá pasó solo, en el mismo segundo en que el cliente pagó."*

4. Vuelve a la tienda e intenta comprar 5 propóleos. El sistema lo bloquea y dice
   cuántos quedan. **Ahí está la pérdida que se evita:** vender lo que no existe.
5. En el panel, pulsa **+19** en Propóleo → repuesto, con su movimiento registrado.
6. **Haz un segundo pedido** —cualquier cosa, una unidad— y **anula ese**: el
   stock vuelve solo al inventario y la nota de crédito `BC01-…` se emite sin que
   nadie la pida.

   > **No anules el del paso 2.** Con la base recién reiniciada es el único que
   > existe, y es el que vas a pegar en el asesor para cerrar el Acto 3. Anulado,
   > el remate responde *"figura como anulado"* en vez de *"está registrado y hoy
   > mismo te contactamos"*: cierto, pero flojo para rematar.

### Acto 3 — La IA como diferenciador (3 min)

En el asesor, escribe **"no puedo dormir y ando con mucho estrés"**.

- Recomienda Valeriana + Pasiflora, Manzanilla y Graviola, y **resalta esas tarjetas**
  en el catálogo.
- **El punto que cierra la venta:** *"La IA solo puede recomendar lo que está en su
  almacén ahora mismo. Si algo se agota, deja de ofrecerlo automáticamente y avisa."*

Luego escribe **"estoy embarazada, qué me recomienda"**. El asesor **se niega a
recomendar** y deriva a un profesional.

> *"Esto lo protege a usted. Un chatbot común le recomienda cualquier cosa a una
> gestante y le trae un problema legal. Este sabe cuándo callarse."*

Prueba también **"me lo dejas en 20 soles"** (responde con la política de descuento
por volumen, no con un precio inventado) y **"aceptan yape"**.

**El momento mayorista — el de mayor impacto económico.** Escribe:

> *"cuánto me sale 50 bolsas de maca negra"*

El asesor aplica el 20 % por volumen, da el total… **y dice que solo hay 42 en
almacén**, ofreciendo entregar 42 ya y 8 en 3 a 5 días.

> *"Fíjese en lo que acaba de pasar: le cotizó, le dio el descuento que corresponde
> y le dijo la verdad del almacén, todo junto. Hoy usted contesta eso revisando el
> depósito y llamando al proveedor. Y si se equivoca, se equivoca en el pedido más
> grande del mes."*

Y el remate, el que amarra los tres actos: pega el **código del pedido del paso 2
del Acto 2** —el que anotaste, no el que anulaste— seguido de *"no llega"*. El
asesor lo busca en la base y responde con su estado, fecha y monto reales:

> *"Encontré tu pedido RA-…, del …, por S/ 64.50: está registrado y todavía no
> sale del local. Hoy mismo te contactamos para coordinar la entrega."*

> El teléfono **no** lo dice, y conviene señalarlo en voz alta: el código es una
> credencial débil, así que el asesor informa del pedido sin soltar datos
> personales. Para ver la dirección o descargar el comprobante hacen falta
> además los últimos cuatro dígitos del teléfono.

> *"No es un chat pegado al costado de la web. Es el mismo sistema respondiendo."*

### Cierre (2 min)

Tres números, del panel:

| Antes | Con el sistema |
|---|---|
| Stock en cuaderno, revisado los domingos | Actualizado en el segundo de la venta |
| Se entera del quiebre cuando el cliente ya se fue | Alerta al llegar al mínimo, con cantidad sugerida |
| No sabe qué producto le deja más | *Más vendidos* y valor de inventario a costo |

---

## Arquitectura

```
tienda.config.js   Datos y políticas del negocio  <- EDITAR ANTES DE LA DEMO
db.js              Esquema SQLite + catálogo semilla + migraciones
server.js          HTTP + API REST + archivos estáticos (sin framework)
auth.js            Sesiones del panel (scrypt, node:crypto)
clave.mjs          Alta de usuarios y cambio de clave desde consola
intenciones.js     Capas 1 y 2 del asesor: cotización y preguntas de negocio
asesor.js          Capa 3 del asesor: productos + redacción con Claude
comprobantes.js    Emisión de boletas, facturas y notas de crédito + XML UBL
comprobante-pdf.js Dibuja la boleta o factura como PDF
pdf.js             Escritor de PDF mínimo, escrito a mano y sin dependencias
catalogos-sunat.js Códigos de los catálogos 01, 02, 03, 05, 06, 07 y 09
importe-letras.js  "SON: CIENTO VEINTICINCO CON 80/100 SOLES"
documentos.js      Validación de DNI, RUC (módulo 11), correo y teléfono
ubigeo.js          Departamento/provincia/distrito + zona y costo de envío
limites.js         Cuotas por IP (token bucket en memoria)
markdown.mjs       Markdown a HTML, lo justo que usa este README
manual.mjs         Viste este README para imprimirlo: portada, índice y hoja A4
ilustraciones.mjs  Qué lámina le toca a cada producto (forma × color)
gen-catalogo.mjs   Arma los 400 productos de ejemplo desde 132 insumos
gen-imagenes.mjs   Dibuja las ilustraciones SVG de respaldo
gen-ubigeo.mjs     Compacta el ubigeo del INEI a public/ubigeo.json
gen-pdf.mjs        Arma el manual desde este README e imprime los tres PDF
verificar-imagenes.mjs  Comprueba que las ilustraciones no se corten
importar-fotos.mjs Importa las fotos propias desde img/ (empareja por nombre)
traer-fotos.mjs    Descarga fotografías libres y guarda sus créditos
test/              222 tests con node:test, sin dependencias
public/            Tienda, panel, login, hoja de contactos, /img
img/               Las fotos originales del negocio, FUERA de public/
docs/              Los tres documentos, en HTML y PDF
data/              La base de datos (se crea sola)
```

### El catálogo de 400 productos

> **Son productos inventados.** Son creíbles, están bien categorizados y sirven
> para que la demo se vea llena y el asesor tenga con qué trabajar, pero **no son
> el catálogo real de ningún negocio**. Antes de operar hay que reemplazarlos,
> igual que las fotos de banco libre.

Por eso quedan **marcados en la base**, con la columna `productos.demo`. Los 24
curados entran con `demo = 0`, igual que todo lo que el dueño dé de alta desde el
panel; el relleno generado entra con `demo = 1`. La marca hace una sola cosa, y
es la que importa: **el relleno nunca se recomienda por delante de un producto
del negocio.** En la tienda del cliente, con su catálogo cargado, no habrá
ninguno marcado y el criterio se apaga solo.

La marca no sale en `/api/productos`: ordena por dentro, pero la tienda no va
etiquetando productos de "demostración" en una respuesta que el cliente puede
abrir en el navegador.

No están escritos a mano: `gen-catalogo.mjs` combina 132 insumos reales
(maca, uña de gato, sangre de grado, propóleo…) con las presentaciones que le
corresponden a cada uno. Así los nombres salen naturales —*Maca Negra en
cápsulas*— y no aparecen disparates como *Jabón en gotas*. La semilla del
generador es fija: dos ejecuciones dan exactamente el mismo catálogo.

#### El stock tampoco es al azar plano

Lo era —`entre(0, 60)` contra un mínimo de 5 a 15— y con eso **uno de cada seis
productos nacía en o por debajo de su mínimo**: el panel abría con **66 alertas
de reposición**, una lista tan larga que el dueño no encuentra en ella lo que de
verdad tiene que comprar. Una alerta que salta siempre no es una alerta.

Ahora se reparte en tres tramos:

| Tramo | Cuánto | Stock |
|---|---|---|
| Agotado | 1,5 % | `0` |
| Por reponer | 2,5 % | entre 1 y el mínimo |
| Surtido | el resto | del mínimo + 5 hasta 60 |

Sobre los 400 quedan **19 por reponer, 6 de ellos agotados**. Es lo que se
parece a un almacén de verdad: casi todo surtido, unos pocos en rojo y algún
hueco. Y es lo que hace que los dos indicadores del guion signifiquen algo — el
*Agotado* de la vitrina en el Acto 1, y el Propóleo subiendo a *1 de 10* en el
Acto 2.

Los 24 curados no pasan por aquí: su stock está escrito a mano en `db.js`, que
es lo que fija el *Últimas 4* del propóleo y las *42 bolsas* de la cotización
mayorista. Regenerar el catálogo no los toca.

Categorías: Hierbas, Superalimentos, Suplementos, Tónicos, Colágeno, Aceites,
Esencias, Apícolas, Cremas y Cuidado personal.

`db.js --reset` carga primero los 24 productos curados —los que tienen foto real
y el texto más cuidado— y completa hasta 400 con el catálogo generado, saltando
nombres repetidos y corriendo los códigos que choquen.

**Para cargar el catálogo real del negocio** hay dos caminos: darlos de alta uno
por uno desde el panel, o reemplazar `data/catalogo.json` por el listado real y
correr `node db.js --reset`.

### Alta de productos

Botón **+ Nuevo producto** en el bloque *Catálogo* del panel. Lo que se valida
en el servidor —no solo en el formulario:

| Dato | Regla |
|---|---|
| Nombre | 3 a 90 caracteres, **no puede repetirse** |
| Categoría | Se sugieren las existentes; se admite una nueva |
| Precio | Mayor que cero |
| Costo | **No puede superar al precio**: sería cargar un producto que se vende a pérdida |
| Stock inicial | Entero. Entra al kardex como movimiento de *ingreso* |
| Código (SKU) | Se genera solo con la sigla de la categoría; se puede forzar uno |
| Imagen | Ruta del propio sitio (`/img/…`) o URL `https`. Nada más |
| Etiquetas | Se guardan sin tildes y en minúsculas, que es como llega la consulta del asesor |

**Un tipo de producto nuevo** se crea escribiéndolo en el campo *Categoría* del
alta —el desplegable sugiere las que ya existen, pero admite cualquier otra—.
Tres cosas pasan solas:

- **Aparece como filtro propio** en la tienda y en la marquesina del inicio, que
  se arma con las categorías reales del negocio, no con una lista escrita a mano.
- **Recibe su propia ilustración.** Están dibujadas las 84 combinaciones de
  silueta y color, así que cualquier categoría nueva tiene lámina. El color sale
  del nombre de la categoría, de forma estable: *Mascotas* siempre será ámbar y
  no se verá igual que *Velas*.
- **Obtiene sigla para el código**: *Mascotas* → `MAS-001`.

Escribir «hierbas» no crea una categoría aparte de «Hierbas» —ni con tildes de
por medio—: se adopta la grafía que ya estaba. Si de verdad es nueva, se guarda
con la mayúscula inicial. Un catálogo partido entre «Hierbas», «hierbas» y
«HIERBAS» es un filtro que miente.

Tres decisiones:

- **El margen se calcula mientras se escribe** y se pone rojo si es negativo.
  El dueño de una tienda no saca porcentajes de cabeza mientras atiende; ver el
  número bajando es lo que frena un precio mal puesto antes de guardarlo.
- **El stock inicial no aparece de la nada:** se registra como ingreso, igual
  que una reposición, para que el kardex explique cada unidad desde el día uno.
- **El alta queda firmada** en `cambios_producto`, con el usuario que la hizo.

El formulario insiste en las **etiquetas** porque son lo que hace que el
producto aparezca cuando un cliente escribe *«me duele la cabeza»*. Sin ellas el
producto existe en la tienda, pero el asesor no lo va a ofrecer nunca.

### Edición del catálogo

Desde el panel se puede cambiar **precio**, **stock mínimo** y **dar de baja o
reactivar** un producto. Tres decisiones detrás:

- **El stock no se edita a mano.** Solo se mueve por ventas, ingresos y
  devoluciones, para que el kardex explique cada unidad. Para corregirlo se usa
  el ingreso de mercadería, que deja constancia.
- **Cada cambio queda firmado** en la tabla `cambios_producto`: qué campo, valor
  anterior, valor nuevo, quién y cuándo. Aparece en el bloque *Cambios de ficha*.
  Un precio que baja sin responsable es el mismo agujero que un ajuste de stock
  sin responsable.
- **Dar de baja no borra nada.** El producto desaparece de la tienda y el asesor
  deja de recomendarlo, pero conserva stock e histórico y se puede reactivar.
  El nombre de la columna a actualizar sale de una lista blanca del servidor,
  nunca del cuerpo de la petición.

### Checkout peruano

El pedido pide y **valida en el servidor**:

| Dato | Validación |
|---|---|
| **DNI** | 8 dígitos → emite **boleta** |
| **RUC** | 11 dígitos con **dígito verificador módulo 11** → emite **factura** |
| Razón social | obligatoria con RUC |
| Correo | obligatorio con factura (es donde va el comprobante) |
| Teléfono | celular de 9 dígitos o fijo; normaliza `+51`, espacios y guiones |
| Ubigeo | departamento / provincia / distrito contra los **1 874 distritos del INEI** |

**La terna de ubigeo se valida anidada**, no por separado: que "Cayma" exista no
basta si dices que está en Lima. Ese es el error que deja direcciones imposibles
en la base.

**El envío lo calcula el servidor** a partir del distrito, nunca el navegador:

```
Breña          → Lima Centro              S/ 6.00    ubigeo 150105
Jesús María    → Lima Moderna             S/ 9.00    ubigeo 150113
San Juan de L. → Lima Norte, Sur y Este   S/ 14.00   ubigeo 150132
Cusco/Wanchaq  → agencia, flete en destino           ubigeo 080108
```

`POST /api/envio` cotiza antes de comprar, así el carrito muestra el costo real
en vez de "según tu zona". Las zonas usan los **nombres oficiales del INEI**: si
se escribe mal un distrito en `tienda.config.js`, esa zona nunca se aplicaría.

> El validador de RUC detectó que el RUC de ejemplo que tenía la configuración
> (`20512345678`) **no era válido**. Ahora es `20512345671`, que sí pasa.

#### El código de pedido que se repetía

El código es `RA-AAAAMMDD-XXX`: tres caracteres, porque se dicta por teléfono y se
lee en voz alta en el mostrador. Eso son 36³ = **46 656 códigos por fecha**, y
`pedidos.codigo` tiene índice único. Sin reintento, dos pedidos del mismo día que
sacaran el mismo código acababan en `500 No se pudo registrar el pedido`. **La
venta se perdía en la caja, por un código repetido.**

No es un caso de laboratorio, es el problema del cumpleaños:

| Pedidos en un día | Probabilidad de perder uno |
|---|---|
| 40 | 1,7 % |
| 80 | 6,3 % |
| 150 | 22 % |
| 400 | 82 % |

Ahora el `INSERT` va en un bucle dentro de la misma transacción: en SQLite un
`UNIQUE` aborta la sentencia, no la transacción, así que reintentar con otro
código no obliga a reabrir nada. Ocho intentos — con 400 pedidos ya cargados en la
fecha, que fallen los ocho es 3 entre 10¹⁷.

Y el azar dejó de salir de `Math.random()`. El código es una **credencial débil**
—abre el seguimiento junto con los últimos cuatro dígitos del teléfono— y
`Math.random` es predecible a partir de unas pocas salidas: quien hiciera dos
pedidos podía adivinar los ajenos. Ahora sale de `node:crypto`.

El código sigue teniendo tres caracteres. Alargarlo habría tapado la colisión,
pero el código existe para dictarse por teléfono; el reintento no se le nota a
nadie y el largo tampoco.

La prueba que lo cubre ocupa un cuarto del espacio de la fecha por debajo de la
API y mete 25 pedidos seguidos: contra el código anterior se caía en el tercero.

### Comprobantes electrónicos

Al registrar la venta se emite el comprobante que corresponde:

| Documento del cliente | Comprobante | Serie |
|---|---|---|
| DNI | Boleta de venta electrónica (`03`) | `B001` |
| RUC | Factura electrónica (`01`) | `F001` |
| Anular o devolver | Nota de crédito (`07`) | `BC01` / `FC01` |

Cada comprobante trae número correlativo, desglose de IGV, importe en letras,
contenido del QR y **XML UBL 2.1** descargable. La representación impresa está en
`/comprobante.html?id=…`, se imprime en A4 y **se descarga en PDF**.

**Lo que hace y lo que no:**

| | |
|---|---|
| ✅ Numeración correlativa sin huecos | índice único `(serie, correlativo)` en la base |
| ✅ Cálculo de IGV cuadrado al céntimo | probado con las cantidades que fuerzan redondeo |
| ✅ Códigos de catálogo SUNAT | tipo doc, identidad, moneda, afectación, tributo, unidad |
| ✅ XML UBL 2.1 con el hueco de la firma | `ext:ExtensionContent` vacío, listo para firmar |
| ✅ Notas de crédito por anulación y devolución | motivos `01` y `06` |
| ❌ **Firma digital** | necesita el certificado `.pfx` del contribuyente |
| ❌ **Envío a SUNAT / OSE** | necesita usuario SOL secundario y endpoint del OSE |
| ❌ **CDR** | lo devuelve SUNAT al recibir el comprobante firmado |
| ❌ **QR gráfico** | el contenido está; dibujarlo necesita una librería |

Los comprobantes quedan en estado `pendiente_envio`: **emitidos y numerados,
pero sin CDR**. Presentarlos como aceptados por SUNAT sería mentir. La función
`enviarASunat()` en `comprobantes.js` está vacía a propósito y documenta las
tres cosas que hacen falta para completarla.

#### La boleta en PDF, sin librerías

La representación impresa vivía solo como página web: para mandársela al cliente
por WhatsApp había que enviarle un enlace o una captura de pantalla. Ahora se
descarga como PDF — la tienda desde el panel, y **el comprador desde su propia
página**, con su código y los últimos cuatro dígitos del teléfono. Nadie tiene
que llamar al local a pedir su boleta.

El escritor está en `pdf.js`, a mano y sin dependencias, como todo lo demás. Un
PDF es texto plano con una tabla de posiciones al final: se puede escribir si uno
se limita a lo que hace falta —texto, líneas y rectángulos— y usa las catorce
tipografías *base 14* que todo lector trae incorporadas. Al no incrustar
tipografías, **un comprobante pesa unos 4 KB en vez de 300**, que en algo que se
manda por WhatsApp con datos móviles importa. `comprobante-pdf.js` es el que
dibuja la boleta encima de ese escritor.

El archivo sale con el nombre que pide SUNAT —RUC, tipo de documento, serie y
correlativo:

```
20512345671-03-B001-00000001.pdf
```

No es capricho: es lo que hace que los comprobantes de todo un mes se ordenen
solos en la carpeta del contador.

#### Un bug que valía dos céntimos

La primera versión calculaba `valorUnitario = redondear(precio / 1,18)` y luego
multiplicaba por la cantidad. Ese doble redondeo hacía que 3 × S/ 22,00 diera
S/ 65,99, y el comprobante salía **dos céntimos por debajo de lo cobrado**. Un
comprobante que no cuadra con el cobro lo rechaza SUNAT y descuadra la caja.

Ahora el ancla es el **importe** —lo que el cliente paga— y de ahí se derivan la
base imponible y el IGV por diferencia. El valor unitario se guarda con diez
decimales, que es exactamente para lo que SUNAT admite ese margen.

### Acceso al panel

Lo que se protege no es "el panel" en abstracto: es **`GET /api/pedidos`, que
devuelve nombre, teléfono y dirección de cada cliente que compró**. Dejarlo abierto
no era un descuido de demo, era una fuga de datos personales.

| Ruta | Sin sesión |
|---|---|
| `/`, `/creditos.html`, `/api/tienda`, `/api/productos`, `/api/asesor`, `POST /api/pedidos` | ✅ abiertas — es la tienda |
| `GET /api/pedidos`, `/api/admin/*`, `POST /api/stock` | 401 |
| `/admin.html`, `/imagenes.html` | 302 → `/login.html` |

Cómo está hecho, sin dependencias:

- **Claves con `scrypt`** (`node:crypto`), salt de 16 bytes por usuario y
  comparación en **tiempo constante** — no filtra cuánto acertó un atacante.
- **Sesión en cookie `HttpOnly` + `SameSite=Strict`**, token de 32 bytes guardado
  en la tabla `sesiones`, caducidad de 8 horas (una jornada del local).
  `SameSite=Strict` es lo que cubre el CSRF sin token aparte.
- **Bloqueo por fuerza bruta:** 5 intentos fallidos → 5 minutos de espera, incluso
  si luego aciertan la clave. Se guarda en memoria: reiniciar limpia los bloqueos.
- **El error de login nunca distingue** entre usuario inexistente y clave mala.
- **Cambiar la clave cierra las sesiones abiertas** de esa persona.
- **El kardex anota quién fue:** un ajuste manual queda como
  `Compra a proveedor Oxapampa (rosa)`. Un movimiento de stock sin responsable es
  justo por donde se pierde mercadería sin que nadie lo note.

> **Al publicar con HTTPS, agrega `Secure` a la cookie** en `auth.js`
> (`cookieSesion`). Falta a propósito porque la demo corre en `http://localhost`.

### Las tres capas del asesor

Probando la tienda como cliente real, **8 de 8 preguntas que no eran "recomiéndame
un producto" terminaban en un catálogo**. La peor: *"quiero devolver el propóleo,
no me hizo nada"* respondía ofreciendo el mismo propóleo.

Por eso el asesor tiene tres capas, en este orden:

| Capa | Qué atiende | De dónde saca la respuesta |
|---|---|---|
| 1. Cotización | *"50 bolsas de maca negra"* | precio + escala de descuento + **stock real** |
| 2. Intenciones | saludo, despedida, presencia, catálogo, WhatsApp, delivery (Lima y provincia), horario, pago, comprobante, ubicación, regateo, mayorista, devolución, reclamo, autenticidad | `tienda.config.js` y, en un reclamo con código, la tabla `pedidos` |
| 3. Productos | síntomas y necesidades | catálogo filtrado contra stock real |

La comparación —*"¿qué es mejor, la maca o el camu camu?"*— no pasa por la tabla
de intenciones: se detecta en `asesor.js` sobre los nombres del catálogo, porque
necesita saber de qué dos productos habla.

Cinco decisiones que valen la pena señalar:

- **El regateo no se improvisa.** No responde con un descuento inventado, sino con
  la escala de `tienda.config.js` (10 / 15 / 20 % según cantidad). El asesor nunca
  regala margen del negocio.
- **Una cotización siempre dice cuánto hay.** Es el argumento de venta completo en
  una sola respuesta: precio correcto y verdad de almacén, en el pedido donde más
  cuesta equivocarse.
- **El asesor no cambia el estado de un pedido.** Informa y compromete a la tienda,
  pero no ejecuta. Si lo hiciera, cualquiera con un código movería el inventario
  desde el chat.
- **Un saludo no dispara un catálogo.** `hola` y `ok gracias` están anclados con
  `^…$`, así que *"hola, tienes algo pa la gastritis"* sigue de largo a productos.
- **El relleno de demostración va último, empate o no.** Un producto inventado
  con las etiquetas perfectas no desplaza a uno que el negocio sí tiene, por
  muchas señales que acierte. Ver abajo.

#### Dos magnesios que tapaban a la valeriana

A *"no puedo dormir y ando con mucho estrés"* el asesor contestaba así:

| | Producto | Origen |
|---|---|---|
| 1 | Magnesio Quelado efervescente | Formulado en Lima |
| 2 | Magnesio en polvo | Formulado en Lima |
| 3 | Valeriana + Pasiflora | Sierra sur |

Los tres empataban a puntos —las mismas cuatro señales: *dormir*, *insomnio*,
*estrés*, *ansiedad*—, y el desempate era **el stock**: 39 y 35 contra 14. Ganaba
el relleno generado.

Dolía en el peor sitio. El Acto 1 vende que *"el origen es el argumento —Meseta
de Bombón, Junín, no solo Maca"*, y dos pantallas después el propio asesor abría
con **"De Formulado en Lima"**, dos veces seguidas, en la respuesta que cierra la
demo. El sistema desmentía el argumento de venta.

Y encima se colaban los dos juntos, que resultó ser un problema aparte y más de
fondo.

#### La misma planta tres veces

`variar()` existe justo para que no salga el mismo insumo tres veces, pero
comparaba las raíces **por igualdad**. Donde peor se veía era en las rodillas:

> *"me duelen las rodillas"* → **Uña de Gato** · **Crema de Uña de Gato** · **Tónico de Uña de Gato**

Las tres son entradas **separadas** del catálogo, cada una con su categoría, su
origen y su precio: una cápsula, una crema y un tónico. Para el sistema eran tres
productos distintos, y lo son. Para quien preguntó qué tomar para la rodilla son
uña de gato tres veces. Lo mismo pasaba con *Magnesio* y *Magnesio Quelado*, que
tampoco son una el envase de la otra: son dos fichas del catálogo.

Ahora dos raíces son el mismo insumo si **una contiene a la otra entera**, por
palabras completas: `uña de gato` está dentro de `crema de uña de gato`, y
`magnesio` dentro de `magnesio quelado`. Palabras enteras a propósito, para no
casar a media palabra.

Y se recortan además las presentaciones que van **delante** del insumo —*Crema
de*, *Tónico de*, *Esencia de*, *Aceite de*…—, con lista blanca: *Cola de
Caballo*, *Miel de Abeja*, *Diente de León* y *Sangre de Grado* empiezan igual y
no son envases. Recortarlas dejaría raíces absurdas como *caballo* o *grado*.

Sobre los 400 productos, eso los agrupa en **122 insumos**. El resultado:

| Consulta | Antes | Ahora |
|---|---|---|
| *"me duelen las rodillas"* | Uña de Gato · **Crema de Uña de Gato** · **Tónico de Uña de Gato** | Uña de Gato · Cúrcuma con Pimienta · Colágeno con Magnesio |
| *"tengo gastritis"* | Manzanilla Orgánica · **Manzanilla · hierba seca** · Sangre de Grado | Manzanilla Orgánica · Muña · Sangre de Grado |

El test destapó uno más que no habíamos visto: *"algo para los nervios"* ofrecía
**Valeriana + Pasiflora** y **Pasiflora en filtrantes** en la misma respuesta.

Ahora `demo` es el **primer** criterio de orden, antes que los puntos:

| | Producto | Origen |
|---|---|---|
| 1 | Valeriana + Pasiflora | Sierra sur |
| 2 | Manzanilla Orgánica | Valle del Mantaro |
| 3 | Graviola en cápsulas | Amazonía |

No es un desempate, es una precedencia, y es a propósito: el relleno es
**inventado**. Recomendar un producto que no existe por delante de uno que está
en el almacén es responder mal, aunque coincidan más etiquetas. Su trabajo es que
el estante se vea lleno, no vender.

#### El cotizador rechaza más de lo que acepta

Un número en un mensaje casi nunca es una cantidad de compra. Estos cuatro casos
reales cotizaban de más antes de los filtros:

| Mensaje | Cotizaba | Ahora |
|---|---|---|
| *"la maca de 250 gramos"* | 250 bolsas, S/ 6 900 | va a productos |
| *"el propóleo de 30 ml"* | 30 frascos | va a productos |
| *"me lo dejas en 20 soles"* | 20 macas | responde el regateo |
| *"tomo 2 pastillas al día"* | 2 macas | no vendemos medicamentos |

Para cotizar se exigen dos cosas: que la cifra **no** vaya seguida de una unidad de
medida, edad o precio (`ml`, `gramos`, `años`, `soles`), y que haya intención de
compra — un envase pegado a la cifra (*"50 bolsas"*) o un verbo (*"quiero"*,
*"necesito"*, *"cuánto me sale"*).

### Imágenes: tres niveles de respaldo

Cada tarjeta intenta cargar, en este orden:

| Nivel | Origen | Peso |
|---|---|---|
| 1. Fotografía | `public/img/fotos/` — propias del negocio, o de bancos libres | 2,5 MB total |
| 2. Ilustración | `public/img/<SKU>.svg` — generada localmente | ~2 KB c/u |
| 3. Marca | `public/img/placeholder.svg` | 1 KB |

El navegador no propaga el evento `error` de una imagen hacia arriba, pero sí se
puede capturar en la fase de captura: **un solo oyente cubre todas las imágenes**,
incluidas las que aún no existen cuando se registra. Nunca se ve un cuadro roto.

**Las fotos se descargan, no se enlazan.** Enlazar deja la tienda dependiendo de un
CDN ajeno: sin internet en el local, la demo se llena de huecos grises justo en la
pantalla que estás presentando.

**Por qué Openverse y no Pixabay:** Pixabay responde 403 a peticiones
automatizadas, y sobre todo Openverse devuelve **la licencia y el autor** de cada
imagen — que es lo que el cliente necesita para publicar sin problemas legales.
Se piden CC0 y dominio público primero. Hoy las 24 fotos se reparten así:

| Origen | Cuántas | Atribución |
|---|---|---|
| Propias del negocio (`importar-fotos.mjs`) | 12 | no hace falta |
| CC0 y dominio público | 8 | no hace falta |
| CC BY | 4 | **obligatoria** |

Por esas 4 existe `/creditos.html`, enlazada en el pie. A medida que el cliente
entregue sus fotos, la columna de CC BY se vacía y la página deja de hacer falta.

> Estas fotos son marcadores de posición. Antes de publicar hay que reemplazarlas
> por las del propio negocio — no son los productos reales del puesto.

Para usar las fotos del cliente basta la columna `imagen`, que acepta cualquier URL
o ruta local:

```sql
UPDATE productos SET imagen = '/img/fotos/mi-maca.jpg' WHERE sku = 'MAC-001';
```

`node verificar-imagenes.mjs` comprueba que ninguna ilustración se salga del lienzo
ni quede descentrada — útil cuando no puedes abrir el navegador para mirarlas.

### La decisión de diseño que sostiene la demo

**El motor de reglas elige los productos; la IA solo redacta.**

`asesor.js` filtra el catálogo contra el stock real y puntúa por etiquetas y
sinónimos coloquiales (*"no puedo dormir"*, *"me duelen las rodillas"*, *"chuchaqui"*).
Recién esa lista ya validada pasa al modelo para que escriba la respuesta.

Consecuencias, todas buenas para una demo frente a un cliente:

- **Nunca recomienda un producto agotado**, aunque el modelo alucine.
- **Funciona sin internet y sin API key** — cae a una respuesta por plantilla.
- **Es barato:** una llamada corta por consulta, no un agente conversacional.

### Activar la redacción con Claude (opcional)

```bash
npm install @anthropic-ai/sdk
set ANTHROPIC_API_KEY=sk-ant-...     # PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."
npm start
```

Sin esas dos cosas la tienda funciona igual, con el motor de reglas.
El campo `fuente` de `/api/asesor` dice `"reglas"` o `"claude"`.

Modelo: `claude-opus-5`, `effort: low` (respuestas cortas y rápidas).
El prompt del sistema le prohíbe atribuir propiedades curativas — requisito legal
para publicidad de productos naturales.

---

## API

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/api/login` | `{correo, clave}` → cookie de sesión (acepta `usuario` por compatibilidad) |
| `POST` | `/api/logout` | Cierra la sesión |
| `GET` | `/api/sesion` | Quién está conectado, o 401 |
| `GET` | `/api/tienda` | Datos públicos: envío gratis, horario, pagos |
| `POST` | `/api/envio` | Cotiza el envío de un distrito antes de comprar |
| `GET` | `/api/productos` | Catálogo activo |
| `GET` | `/api/productos/:id` | Un producto suelto |
| `POST` | `/api/asesor` | `{consulta}` → intención de negocio, o recomendaciones filtradas por stock |
| `POST` | `/api/pedidos` | Registra pedido y descuenta stock **en una transacción** |
| `GET` | `/api/pedidos` | 🔒 Pedidos con sus ítems (trae datos del cliente) |
| `PATCH` | `/api/pedidos/:id/estado` | 🔒 Avanza estado; `anulado` devuelve el stock |
| `POST` | `/api/stock` | 🔒 Reposición o ajuste manual, con motivo y responsable |
| `GET` | `/api/admin/resumen` | 🔒 KPIs, bajo stock, más vendidos |
| `GET` | `/api/admin/movimientos` | 🔒 Kardex de las últimas 60 operaciones |
| `GET` | `/api/admin/productos` | 🔒 Catálogo completo, incluidos los dados de baja |
| `GET` | `/api/admin/cambios` | 🔒 Bitácora de cambios de ficha |
| `GET` | `/api/admin/categorias` | 🔒 Categorías existentes, para el alta |
| `POST` | `/api/productos` | 🔒 Alta de producto; el stock inicial entra al kardex |
| `PATCH` | `/api/productos/:id` | 🔒 Cambia precio, stock mínimo o alta/baja |
| `POST` | `/api/seguimiento` | Estado del pedido con código + últimos 4 del teléfono |
| `POST` | `/api/seguimiento/recibido` | Constancia de recepción del cliente |
| `GET` | `/api/admin/comprobantes` | 🔒 Comprobantes emitidos |
| `GET` | `/api/comprobantes/:id` | 🔒 Uno, con su desglose de IGV |
| `GET` | `/api/comprobantes/:id/pdf` | 🔒 Representación impresa en A4 |
| `GET` | `/api/comprobantes/:id/xml` | 🔒 XML UBL 2.1, con el hueco de la firma |
| `POST` | `/api/seguimiento/comprobante` | Su boleta o factura, para imprimir. Sin el XML |
| `GET` | `/api/seguimiento/comprobante/pdf` | El PDF del comprador, con `?codigo=` y `?tel=` |

🔒 = requiere sesión.

El pedido entra completo o no entra: si un solo ítem no tiene stock, se revierte
todo y se devuelve `409` con el detalle de qué faltó.

---

## Lo que falta para producción

Honestidad con el cliente sobre el alcance de esta demo:

1. **HTTPS y cookie `Secure`** — obligatorio antes de publicar fuera de la laptop.
2. **Pasarela de pago** — el pedido queda registrado, el cobro es contra entrega.
3. **Respaldo de la base** — copiar `data/tienda.db` a diario.
4. **Fotos reales de producto** — 12 de los 24 productos con foto ya son del
   negocio; las otras 12 son de banco libre y el resto del catálogo va con
   ilustración. Las que falten entran con `importar-fotos.mjs`.
5. **Firma digital y envío a SUNAT** — los comprobantes se emiten, se numeran y
   se descargan en PDF y XML, pero quedan en `pendiente_envio`: falta el
   certificado `.pfx` del contribuyente, el usuario SOL secundario y el endpoint
   del OSE. Es rellenar `enviarASunat()`, un archivo.
