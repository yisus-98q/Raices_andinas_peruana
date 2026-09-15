# Avisos por WhatsApp — guía técnica

Para la dueña del negocio y para quien lo instale. Cuenta qué hace hoy el
sistema, cómo automatizarlo y qué falta.

> **Precios y reglas de WhatsApp cambian seguido.** Las cifras de esta guía se
> revisaron en setiembre de 2026 contra las páginas oficiales enlazadas al
> final. Antes de contratar, míralas de nuevo.

---

## 1. Cómo funciona hoy

### Los tres avisos

| Evento | Cuándo se genera | A quién |
|---|---|---|
| `confirmado` | Al crear un pedido por la tienda web | Todo pedido que **no** es de mostrador |
| `en_camino` | Al pasar el pedido a **enviado** | Solo si sale por reparto (no recojo en el puesto) |
| `entregado` | Al pasar el pedido a **entregado** | Web, reparto o recojo |

Hay **un solo aviso por evento y por pedido**: marcar «enviado» dos veces no
manda dos mensajes. Cada aviso es una fila de la tabla `avisos_cliente`
(`server.js`), con el texto ya armado, el canal, el estado y quién lo mandó.

Un aviso **nunca frena el pedido**: el cambio de estado ya ocurrió. Si el envío
falla, queda registrado y se puede mandar a mano.

### Los dos modos

El modo se decide solo, según el `.env` (`whatsapp.js`, función `modo()`):

| | **Manual** (por defecto) | **API** |
|---|---|---|
| Se activa | Sin `WHATSAPP_TOKEN` o sin `WHATSAPP_PHONE_ID` | Con los dos definidos |
| Quién envía | Una persona, desde su WhatsApp | El servidor, por la Cloud API de Meta, **solo a quien marcó la casilla** del checkout |
| Cómo | El panel ofrece un enlace `wa.me` con el mensaje ya escrito; al tocarlo se abre el chat del cliente | Apenas ocurre el evento, sin que nadie toque nada; sin casilla, queda como botón manual |
| Cuenta de empresa | No hace falta | Sí (ver sección 3) |
| Costo | Ninguno | Por mensaje, según Meta (ver sección 2) |
| Internet en el servidor | No hace falta | Sí |

**Modo manual, paso a paso.** El aviso nace `pendiente`. El panel recibe, en
cada pedido, la lista de avisos con un `enlace` que abre
`https://wa.me/51XXXXXXXXX?text=…`. Quien lo envía toca el botón, manda el
mensaje desde su teléfono y el panel llama a `PATCH /api/avisos/:id`, que lo
marca `enviado_manual` con el usuario que lo mandó.

**Modo API, paso a paso.** El aviso nace `enviando` y el servidor llama a
`POST https://graph.facebook.com/v21.0/{WHATSAPP_PHONE_ID}/messages`. Si Meta
responde bien, pasa a `enviado` y en `detalle` queda el **id del mensaje** que
devuelve Meta (`wamid…`). Si falla, pasa a `error` con el motivo, y el panel
vuelve a ofrecer el enlace manual para mandarlo igual.

### El permiso del cliente

En el checkout hay una casilla, **sin marcar por defecto**: *«Quiero recibir por
WhatsApp la confirmación y el aviso cuando mi pedido salga y llegue.»* Se guarda
en `pedidos.acepta_whatsapp` (0 o 1), y solo un `true` de verdad la pone en 1:
una casilla que no se marcó no es permiso.

| | Marcó la casilla | No la marcó |
|---|---|---|
| **Modo api** | El servidor envía el aviso solo (`enviando` → `enviado` o `error`) | El aviso se crea igual, pero como **manual** `pendiente`: el panel muestra el botón y una persona decide si le escribe |
| **Modo manual** | Botón en el panel | Botón en el panel (nada cambia) |

Así el sistema **nunca escribe solo** a quien no lo pidió, que es lo que exige
Meta, y la tienda no pierde el aviso: sigue a un toque para quien atiende.

### Estados de un aviso

| Estado | Modo | Significa | ¿El panel ofrece el enlace manual? |
|---|---|---|---|
| `pendiente` | manual | Generado, nadie lo mandó todavía | Sí |
| `enviando` | api | El servidor lo está mandando | No |
| `enviado` | api | Meta lo aceptó. **No** confirma que llegó ni que se leyó (eso lo darían los webhooks, sección 4) | No |
| `error` | api | Meta lo rechazó o no hubo conexión; el motivo va en `detalle` | Sí |
| `enviado_manual` | manual | Alguien lo mandó desde el panel; `enviado_por` dice quién | No |

### Qué ve cada papel

| | Dueña (`admin`) y mostrador (`vendedor`) | Reparto (`reparto`) |
|---|---|---|
| Pedidos | Todos | Solo los que salen a reparto y están **asignados a él o sin asignar**; de lo cerrado, solo lo de hoy |
| Asignar repartidor | Sí: `PATCH /api/pedidos/:id/repartidor` | No |
| Lista de repartidores y modo de avisos | `GET /api/admin/repartidores` → `{ repartidores, avisos: 'manual' \| 'api' }` | No |
| Mover un pedido | Todos los estados | Solo preparando, enviado y entregado, **solo hacia adelante** (409 si retrocede) y **403** si el pedido lo lleva otro |
| Marcar un aviso manual como enviado | Sí | Solo de pedidos de su ruta (403 si no) |
| Botones de aviso en el panel | Los tres eventos | Solo **en camino** y **entregado**: la confirmación la manda el puesto |

Al marcar **enviado** un pedido sin asignar, el motorizado **se lo queda**: es
quien lo tiene en la mano, y así el aviso «en camino» dice quién va.

El recorrido completo del motorizado —salir, llamar, llegar, entregar
registrando cómo le pagaron y el efectivo que rinde al volver— está en el
README, sección **«Panel del repartidor»**.

### Cómo se ven los avisos en el panel

Cada pedido muestra sus avisos como pastillas (`public/js/admin.js`):

- **✓ enviado**: ya salió. Al pasar el mouse dice si lo mandó el sistema o quién
  lo mandó a mano.
- **enviando…**: el servidor lo está mandando por la API.
- **Avisar: …**: falta mandarlo. Abre el chat del cliente con el mensaje escrito.
- **Reintentar: …**: la API falló. Mismo botón, para mandarlo a mano.

Para no confundir al cliente, el panel ofrece **solo el aviso pendiente más
reciente** de cada pedido: si ya se generó «en camino», no ofrece mandar
«recibimos tu pedido» atrasado. En pedidos **anulados o devueltos** no ofrece
ninguno.

### Los textos

Se editan en `tienda.config.js` → `avisos.plantillas`, uno por evento. Variables
disponibles:

| Variable | Valor |
|---|---|
| `{nombre}` | Primer nombre del cliente |
| `{codigo}` | Código del pedido (`RA-…`) |
| `{total}` | Total, en soles |
| `{repartidor}` | Nombre del motorizado asignado, o «nuestro repartidor» |
| `{enlace}` | Seguimiento: `{URL_PUBLICA}/mi-pedido.html?codigo=…` |
| `{tienda}` | Nombre de la tienda |
| `{entrega}` | «Te lo llevamos a {distrito}» o «Lo recoges en el puesto: {dirección}» |

El enlace de seguimiento **pide además los últimos 4 dígitos del teléfono**:
reenviar el mensaje no expone el pedido de nadie.

### Variables del `.env`

| Variable | Obligatoria para API | Para qué |
|---|---|---|
| `WHATSAPP_TOKEN` | Sí | Token de acceso (sección 3) |
| `WHATSAPP_PHONE_ID` | Sí | Id del número emisor en Meta, **no** el número |
| `WHATSAPP_PLANTILLA_CONFIRMADO` | Recomendada | Nombre de la plantilla aprobada |
| `WHATSAPP_PLANTILLA_EN_CAMINO` | Recomendada | Ídem |
| `WHATSAPP_PLANTILLA_ENTREGADO` | Recomendada | Ídem |
| `WHATSAPP_IDIOMA` | No (por defecto `es`) | Código de idioma con que se aprobó la plantilla |
| `WHATSAPP_API_VERSION` | No (por defecto `v21.0`) | Versión de la Graph API |
| `WHATSAPP_API_URL` | No | Otro servidor compatible con el formato de Meta; lo usan los tests |
| `URL_PUBLICA` | Recomendada | Base del enlace de seguimiento. Sin ella se usa `sitio` de `tienda.config.js` |

> **Sin plantilla** el servidor manda **texto libre**, y Meta solo lo acepta
> dentro de las **24 horas** desde el último mensaje del cliente. Un pedido de
> la web no abre esa ventana: para escribirle primero hacen falta plantillas.

---

## 2. Opciones para automatizar

| | Quedarse en **wa.me manual** | **Meta Cloud API** directa | **Twilio** WhatsApp | **BSP** (360dialog, Gupshup u otro) |
|---|---|---|---|---|
| Qué es | Enlaces que abren el chat; envía una persona | La API oficial de Meta, sin intermediario | Twilio revende la API de Meta con su propia API | Proveedor oficial de Meta que da acceso y soporte |
| Funciona con el código actual | **Sí** (es el modo por defecto) | **Sí** (modo api) | **No**: otra API y otro formato de plantillas; hay que escribir un adaptador en `whatsapp.js` | 360dialog usa el mismo cuerpo que Meta pero otra URL y otra cabecera de clave: adaptador chico. Gupshup y otros: adaptador propio |
| Costo fijo | Ninguno | Ninguno | Ninguno | 360dialog: desde unos **€49 al mes por número**. Otros BSP: varía |
| Costo por mensaje | Ninguno | Tarifa de Meta por plantilla, según categoría y **país del destinatario** (Perú tiene tarifa propia) | Tarifa de Meta **+ US$ 0.005** por mensaje, enviado o recibido | 360dialog: tarifa de Meta sin recargo. Otros: consultar recargo |
| Trámite | Ninguno | Business Manager, número y plantillas | Lo mismo, guiado por Twilio | Lo mismo, guiado por el BSP |
| Soporte | — | Documentación y comunidad | Soporte de Twilio | Soporte del BSP, a veces en español |
| A favor | Cero costo, cero trámite, funciona sin internet en el servidor | Lo más barato automatizado; ya está implementado | Consola, logs y soporte maduros; útil si ya se usa Twilio para SMS | Acompañamiento local; bandeja o herramientas extra según el plan |
| En contra | Depende de que alguien toque el botón; no escala | El trámite con Meta lo hace uno mismo | Recargo por cada mensaje, también por los que responde el cliente; requiere código nuevo | Mensualidad fija; requiere código nuevo |

**Sobre la tarifa de Meta** (setiembre 2026): cobra **por mensaje** desde el
1 de julio de 2025. Los avisos de pedido son plantillas de categoría
**utility**, la más barata. Las plantillas utility que se entregan **dentro**
de una ventana de atención abierta —24 h desde que el cliente escribió— son
**gratis**, y los mensajes de servicio también. Desde abril de 2026 se puede
facturar en soles. La tarifa exacta de Perú está en la tabla de precios de
Meta.

**Recomendación para la tienda de un puesto:** empezar en **manual** —ya
funciona— y pasar a **Meta Cloud API directa** cuando el volumen de pedidos
haga pesado tocar el botón, porque no necesita código nuevo ni mensualidad.
Twilio o un BSP tienen sentido si se quiere soporte contratado, y cuestan un
adaptador en `whatsapp.js`.

---

## 3. Paso a paso con Meta Cloud API

> Los nombres de menús de Meta cambian con frecuencia. Si algo no aparece donde
> dice, búscalo por su nombre en la documentación oficial.

### 3.1 Cuenta y número

1. Crear o usar una cuenta en **Meta Business Suite / Business Manager**
   (business.facebook.com) a nombre del negocio. Conviene **verificar el
   negocio** (RUC y documentos): sube los límites de envío.
2. En **developers.facebook.com**, crear una **app** de tipo *Business* y
   agregarle el producto **WhatsApp**.
3. Registrar el **número emisor**. Tiene que poder recibir un SMS o una llamada
   para verificarse. Ojo: un número usado hoy en la app normal de WhatsApp
   puede quedar atado a la API; revisar en la documentación si la opción de
   usarlo en las dos a la vez está disponible para la cuenta, o usar un número
   dedicado.
4. En **WhatsApp → Configuración de la API**, anotar el **Phone number ID**
   (va en `WHATSAPP_PHONE_ID`). No es el número de teléfono.

### 3.2 Token permanente

El token temporal del panel de desarrolladores vence en horas: sirve para
probar, no para la tienda.

1. En Business Manager → **Configuración del negocio → Usuarios del sistema**,
   crear un usuario del sistema con rol de administrador.
2. Asignarle la **app** y la **cuenta de WhatsApp Business** como activos.
3. **Generar token** para esa app, con los permisos
   `whatsapp_business_messaging` y `whatsapp_business_management`, sin
   vencimiento.
4. Guardarlo en el `.env` como `WHATSAPP_TOKEN`. **Nunca** en el código, en
   git ni en un chat: con ese token cualquiera manda mensajes a nombre de la
   tienda.

### 3.3 Las tres plantillas

En **WhatsApp Manager → Plantillas de mensajes**, crear tres plantillas de
categoría **Utility**, idioma **español** (`es`). Las variables van como
`{{1}}`, `{{2}}`…

**Cada evento manda sus propios parámetros**, definidos en
`PARAMETROS_PLANTILLA` de `whatsapp.js`. Meta rechaza la llamada si la
**cantidad** de parámetros no coincide con la de la plantilla, así que cada
plantilla tiene que usar exactamente estas variables, con este número:

| Plantilla | `{{1}}` | `{{2}}` | `{{3}}` | `{{4}}` | `{{5}}` |
|---|---|---|---|---|---|
| confirmado | nombre | código | total | enlace | — |
| en camino | nombre | código | repartidor | enlace | total |
| entregado | nombre | código | — | — | — |

Si se cambia una plantilla —agregar o quitar una variable—, hay que cambiar
también su lista en `PARAMETROS_PLANTILLA`, y al revés. En los textos de abajo
las variables aparecen **en orden**, de `{{1}}` en adelante: así no hay dudas
en la revisión de Meta ni al leer la plantilla.

Textos sugeridos, basados en los de `tienda.config.js`, sin emojis de más ni
lenguaje promocional (Meta reclasifica como *marketing* lo que suena a venta):

**`pedido_confirmado`** — 4 variables
```
Hola {{1}}, recibimos tu pedido {{2}} por {{3}}.
Puedes seguirlo aquí: {{4}} (te pedirá los 4 últimos dígitos de tu teléfono).
Te escribimos cuando salga.
```

**`pedido_en_camino`** — 5 variables
```
Hola {{1}}, tu pedido {{2}} ya va en camino con {{3}}.
Míralo aquí: {{4}}
Si pagas contra entrega, ten a mano {{5}}.
```

**`pedido_entregado`** — 2 variables
```
Hola {{1}}, tu pedido {{2}} figura como entregado.
Si algo no llegó bien, respóndenos por aquí.
```

Meta pide un **ejemplo** para cada variable al enviar a revisión, en el mismo
orden de la tabla. Por ejemplo, para *en camino*: Rosa, RA-20260914-A1B,
Carlos, https://raizandina.pe/mi-pedido.html?codigo=RA-20260914-A1B, S/ 64.50.
La aprobación de plantillas utility suele tardar de minutos a un día.

Al aprobarse, poner sus nombres en el `.env`:

```
WHATSAPP_PLANTILLA_CONFIRMADO=pedido_confirmado
WHATSAPP_PLANTILLA_EN_CAMINO=pedido_en_camino
WHATSAPP_PLANTILLA_ENTREGADO=pedido_entregado
URL_PUBLICA=https://raizandina.pe
```

### 3.4 Probar con curl antes de encender la tienda

Con un número de prueba propio (formato internacional, sin `+`). Este prueba
*pedido confirmado*, que lleva **cuatro** parámetros:

```bash
curl -X POST "https://graph.facebook.com/v21.0/$WHATSAPP_PHONE_ID/messages" \
  -H "Authorization: Bearer $WHATSAPP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "to": "51987654321",
    "type": "template",
    "template": {
      "name": "pedido_confirmado",
      "language": { "code": "es" },
      "components": [{
        "type": "body",
        "parameters": [
          { "type": "text", "text": "Rosa" },
          { "type": "text", "text": "RA-20260914-A1B" },
          { "type": "text", "text": "S/ 64.50" },
          { "type": "text", "text": "https://raizandina.pe/mi-pedido.html?codigo=RA-20260914-A1B" }
        ]
      }]
    }
  }'
```

Una respuesta con `"messages": [{ "id": "wamid…" }]` quiere decir que Meta lo
aceptó. Un error con código de parámetros o de plantilla suele ser que la
cantidad de variables de la plantilla no coincide con `PARAMETROS_PLANTILLA`,
el orden, o el idioma. Para probar las otras dos, cambiar `name` y dejar
cinco parámetros (*en camino*) o dos (*entregado*), en el orden de la tabla.

Después, reiniciar el servidor: `GET /api/admin/repartidores` debe responder
`"avisos": "api"`. Hacer un pedido de prueba con ese mismo teléfono y revisar en
el panel que el aviso quede `enviado`.

---

## 4. Webhooks — no implementados

Hoy el servidor **manda** y se queda con la respuesta inmediata de Meta. No se
entera de lo que pasa después. Un webhook es la URL a la que Meta avisa.

### Qué aportarían

- **Estado real de cada aviso**: `sent` (salió), `delivered` (llegó al
  teléfono), `read` (lo leyó) o `failed` (con el motivo). Hoy `enviado` solo
  significa «Meta lo aceptó».
- **Respuestas del cliente**: «no estoy en casa», «¿a qué hora llega?». Hoy
  esos mensajes llegan al número de la tienda y el sistema no los ve.
- Abrir la **ventana de 24 h** con cada mensaje del cliente, dentro de la cual
  los avisos utility no se cobran.

### Cómo se verifican

1. **Alta del webhook (GET).** Al registrar la URL en la app, Meta llama con
   `hub.mode=subscribe`, `hub.verify_token` y `hub.challenge`. Si el token
   coincide con uno propio (por ejemplo `WHATSAPP_VERIFY_TOKEN`), se responde
   `200` con **el valor de `hub.challenge` crudo**, sin JSON.
2. **Cada notificación (POST)** trae la cabecera
   `X-Hub-Signature-256: sha256=<hex>`: un HMAC-SHA256 del **cuerpo crudo**
   con el **app secret** de la app (Configuración → Básica), que no es el
   verify token ni el token de acceso. Se recalcula con `node:crypto` sobre los
   bytes tal como llegaron —antes de parsear el JSON— y se compara con
   `timingSafeEqual`. Sin esto, cualquiera puede mandar estados falsos.
3. **HTTPS público.** Meta no llama a `localhost` ni a una IP de la red local:
   hace falta la tienda publicada con certificado. En la laptop de la demo no
   se puede.

### Dónde irían en este proyecto

- Ruta **`GET /api/whatsapp/webhook`** para la verificación y
  **`POST /api/whatsapp/webhook`** para las notificaciones, en `server.js`,
  **sin sesión** (las llama Meta) y fuera de las cuotas por IP normales.
- Para los estados: cada notificación trae `entry[].changes[].value.statuses[]`
  con el `id` del mensaje. **Ese id ya se guarda** en `avisos_cliente.detalle`
  cuando el envío sale bien, así que basta con buscar la fila por `detalle` y
  actualizar el estado: `delivered` y `read` como nuevos estados, y `failed`
  como `error` —que vuelve a ofrecer el botón manual—.
- Para las respuestas: `value.messages[]` con el teléfono del cliente. Lo
  razonable es mostrarlas en el pedido correspondiente del panel (buscando el
  último pedido de ese teléfono), no contestarlas solas.
- Responder `200` rápido y procesar después: si el webhook tarda, Meta
  reintenta y llegan duplicados.
- Variables nuevas: `WHATSAPP_VERIFY_TOKEN` y `WHATSAPP_APP_SECRET`.

---

## 5. Buenas prácticas

- **Consentimiento.** Escribirle a un cliente por WhatsApp exige que haya
  aceptado recibir mensajes. Ya está resuelto con la casilla del checkout (ver
  «El permiso del cliente»): el envío automático solo sale para quien la marcó.
  Al escribirle a mano a alguien que no la marcó, que sea para algo que espera
  —su pedido—, no para promociones: mandar a quien no aceptó genera bloqueos y
  reportes que bajan la calidad del número.
- **La ventana de 24 h.** Fuera de ella, solo plantillas aprobadas. El texto
  libre funciona únicamente si el cliente escribió en las últimas 24 horas.
- **Límites y calidad del número.** Un número nuevo empieza con un límite bajo
  de destinatarios por día que sube con el uso, la verificación del negocio y
  una buena **calificación de calidad**. Si muchos clientes bloquean o reportan
  los mensajes, Meta baja la calificación y puede limitar o pausar el número.
  Avisos cortos, esperados y solo de pedidos reales.
- **Nada sensible en el mensaje.** Ni DNI, ni dirección completa, ni detalle de
  productos de salud. El aviso lleva nombre, código, total y un enlace que pide
  los 4 dígitos del teléfono: así está hecho a propósito.
- **El token es una llave.** En `.env` y fuera de git; si se filtra, revocarlo
  en Business Manager y generar otro.
- **Sin internet.** En modo manual no pasa nada: el enlace `wa.me` lo abre el
  teléfono de quien envía, con sus datos móviles. En modo api, sin conexión el
  envío falla, el aviso queda en `error` y el panel ofrece el botón manual. La
  **demo en la laptop sigue en manual**: no hay que configurar nada para
  mostrarla.

---

## Fuentes

- Meta — [Precios de WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) (por mensaje desde el 1-jul-2025; utility dentro de la ventana de atención, gratis)
- Twilio — [WhatsApp Messaging Pricing](https://www.twilio.com/en-us/whatsapp/pricing) (US$ 0.005 por mensaje más la tarifa de Meta)
- 360dialog — [WhatsApp Business Platform Pricing](https://360dialog.com/pricing) (planes desde €49 al mes, sin recargo sobre Meta)
- Webhooks: verificación con `hub.challenge` y firma `X-Hub-Signature-256` — [Hookdeck, guía de webhooks de WhatsApp](https://hookdeck.com/webhooks/platforms/guide-to-whatsapp-webhooks-features-and-best-practices)
