// ─────────────────────────────────────────────────────────────────────────────
// MANUAL DE USO — SOHO Retail OS
//
// Este es el "cerebro" del asistente de ayuda (la burbuja de chat). El asistente
// responde SOLO con lo que está acá. Cuando agregamos o cambiamos una función del
// sistema, hay que ACTUALIZAR este archivo para que la ayuda quede al día.
//
// Tono: simple, para alguien que recién arranca. Español rioplatense (vos).
// ─────────────────────────────────────────────────────────────────────────────

export const MANUAL = `
# QUÉ ES EL SISTEMA
SOHO Retail OS es el sistema interno de gestión de la dietética. Sirve para:
comprar mercadería de forma inteligente, recibir facturas de proveedores, controlar
fechas de vencimiento, imprimir etiquetas de precio, mover stock entre los locales,
armar promociones y fraccionar productos a granel.
Hay dos locales: SOHO 1 y SOHO 2. El stock de cada producto lo maneja Dux (el ERP);
el sistema le agrega arriba las fechas de vencimiento, las compras y las etiquetas.

# CÓMO MOVERSE
A la izquierda está el menú. Las secciones son:
- Stock: Compras, Sin proveedor, Vencimientos.
- Operaciones: Recepciones, Transferencias, Reposición, Promociones, Tareas, Reconciliación.
- Góndola: Precios & Etiquetas.
- Producción: Fraccionamiento, Ubicaciones.

# BUSCADORES (en todas las pantallas)
Los buscadores son tolerantes: podés escribir varias palabras sueltas, en cualquier
orden y sin tildes. Por ejemplo "gel ultra tech" encuentra "ENERGY GEL ... ULTRATECH".
No hace falta escribir el nombre exacto ni completo.

# COMPRAS (Comprador inteligente)
Para qué sirve: te dice qué conviene comprar y cuánto, producto por producto, mirando
las ventas, el stock actual y la cobertura.
Cómo se usa:
1. Arriba ves tarjetas (KPIs): urgentes, sin stock, inversión sugerida y unidades.
2. Filtrás por proveedor, categoría, cobertura o búsqueda.
3. Cada fila muestra la velocidad de venta y la cantidad sugerida a pedir.
4. Al lado del nombre hay una etiqueta ABC (A = los que más facturan, B intermedios,
   C los de menor venta). Es solo informativa.
5. Para exportar el pedido: botón "PDF" (orden de compra como la de Dux, una hoja por
   proveedor) o "CSV". Sirve para mandárselo al proveedor.
Tip: si un proveedor tiene configurado un "día de pedido" que cae hoy, aparece un aviso
arriba ("Pedidos a realizar hoy").
La cantidad sugerida tiene en cuenta la frecuencia con la que le comprás a ese proveedor,
el lead time (cuánto tarda en llegar) y un margen de seguridad. Productos sin ventas en
los últimos 90 días sugieren 0.

# COMPRAS / PROVEEDORES (configuración)
Para qué sirve: ajustar cómo el sistema calcula el pedido de cada proveedor.
Por proveedor podés setear:
- Tipo: "Global" (un pedido total) o "Sucursal" (separa SOHO 1 y SOHO 2).
- MOQ (pedido mínimo), Múltiplo (de a cuánto se pide), Lead time (días que tarda),
  Frecuencia (cada cuántos días le comprás) y Día de pedido (L a D).
- IVA por defecto del proveedor.
También está el panel "Sin configurar": muestra nombres de proveedores que vienen de Dux
y todavía no tienen config. Podés "Asociar" (vincular a uno existente) o "Crear nuevo".
Botón "Sincronizar desde Dux" trae los proveedores nuevos.

# SIN PROVEEDOR
Lista de productos que todavía no tienen proveedor asignado. Le asignás el proveedor a
cada uno para que después aparezcan en Compras.

# VENCIMIENTOS
Para qué sirve: controlar las fechas de vencimiento (FEFO = primero el que vence antes).
Tiene dos solapas:
- "Con fecha cargada": productos que ya tienen vencimiento. Cada uno tiene un estado por
  color: vencido, crítico (vence en menos de 7 días), alerta (menos de 15/30),
  próximo (menos de 90) y ok.
- "Pendientes de carga": productos con stock pero sin fecha cargada.
Botones: "Carga rápida" (con pistola lectora) y "Nueva recepción".
Importante: las fechas las cargás vos; el stock lo baja Dux solo. Cuando se vende o se da
de baja en Dux, el sistema descuenta del lote más viejo automáticamente, y si llega a 0
el vencimiento desaparece de la lista.

# VENCIMIENTOS / CARGA RÁPIDA (pistola lectora)
Para qué sirve: cargar vencimientos rápido escaneando productos.
Cómo se usa:
1. Hacé clic en el campo de código y escaneá el producto con la pistola (o escribí el SKU,
   el código de barras o parte del nombre).
2. Si encuentra el producto, elegís la sucursal, la fecha de vencimiento y la cantidad.
3. Apretás Enter en cada campo para pasar al siguiente; Enter en la cantidad guarda.
4. Abajo se va armando el historial de lo que cargaste en esta sesión.
Tip: si escaneás algo y no aparece, fijate que el código esté bien o probá buscando por
nombre.

# VENCIMIENTOS / BAJA
Sirve para dar de baja vencimientos (por ejemplo, mercadería vencida que se descarta).

# VENCIMIENTOS / AUDITORÍA FEFO
Para qué sirve: diagnosticar problemas del FEFO en tiempo real. Tiene 3 solapas:
- "Drift": productos donde la cantidad cargada en vencimientos no coincide con el stock de
  Dux. Se separa en dos tipos:
  - "Sobre-conteo": hay más vencimientos cargados que stock. Suele ser una edición manual
    posterior a una baja, o un caso raro donde el descuento FEFO no corrió.
  - "Sin cargar": hay stock en Dux pero no se cargó ninguna fecha de vencimiento todavía.
- "Vencidos con stock": productos con fecha pasada pero stock > 0 en Dux. Casi siempre es
  mercadería tirada/regalada por estar vencida que nadie descargó en Dux. Hay que
  descargarla en Dux para que el FEFO refleje la realidad.
- "Historial": cada cambio de cada vencimiento (alta, modificación, baja) queda
  registrado automáticamente. Sirve para investigar cuándo y cómo se modificó algo
  (ej: por qué un lote viejo apareció con cantidad nueva).
Cada fila tiene "Historial" para saltar directo a los cambios de ese producto.

# RECEPCIONES
Lista de las recepciones de mercadería que se fueron haciendo, con su estado.
Botón "Nueva recepción".

# RECEPCIONES / NUEVA RECEPCIÓN DESDE FACTURA
Para qué sirve: cargar la mercadería que llega de un proveedor a partir de su factura.
Cómo se usa (resumen):
1. Pegás el texto de la factura del proveedor (o subís el PDF) y elegís la sucursal destino.
2. El sistema lee los productos. Los mapeás a los productos del sistema: el match es manual
   con búsqueda por nombre (el sistema aprende los que ya asociaste antes).
3. Cargás la cantidad recibida real y la(s) fecha(s) de vencimiento de cada ítem
   (podés agregar más de una fecha por ítem con "+ otro vencimiento").
4. Productos a granel: un ítem del proveedor (ej "Quinoa 25kg") se mapea a uno o varios
   productos finales fraccionados. Después aparecen en Fraccionamiento.
5. El IVA es editable (21% o 10,5%) y se aprende por proveedor.
6. Si cambia la descripción de un producto respecto de antes, aparece un ⚠️ (no bloquea).
7. Confirmás: se crean los vencimientos, se avisa a Dux y, si cambiaron precios, podés
   descargar un Excel para subir a Dux.
Para una guía paso a paso más detallada está la sección "Instrucciones".

# RECONCILIACIÓN
Para qué sirve: comparar el stock que dice Dux contra los vencimientos cargados, producto
por producto. Te muestra el estado: ok, sin carga (hay stock pero falta cargar fecha),
faltante o exceso. Sirve para detectar qué falta cargar.

# REPOSICIÓN
Para qué sirve: te dice qué reponer y de dónde, usando una cascada. Primero intenta mover
stock de un depósito al local, después entre locales, y recién si no alcanza sugiere
comprar. KPIs clicables: comprar / trasladar / redistribuir / ok.

# TRANSFERENCIAS
Para qué sirve: registrar el movimiento de mercadería entre sucursales/depósitos.

# PRECIOS & ETIQUETAS
Para qué sirve: imprimir las etiquetas de precio de góndola (5 x 3 cm, 36 por hoja A4).
Tiene dos solapas:
SOLAPA "ETIQUETAS":
1. Elegís la sucursal (SOHO 1 o SOHO 2) y buscás los productos.
2. Hacés clic en una etiqueta para seleccionarla (se marca en azul).
3. Botón "Seleccionar todos" marca todos los que estás viendo según la búsqueda (sirve
   para no ir uno por uno).
4. Botón "Imprimir": si no seleccionaste nada, imprime todos los visibles; si seleccionaste,
   imprime solo esos. Te dice cuántas hojas son.
SOLAPA "AUMENTOS":
Acá aparecen los productos a los que les cambió el precio (los detecta el sync de Dux).
Para imprimir esas etiquetas de forma rápida:
1. Botón "Seleccionar sin ver" marca de una todos los aumentos nuevos.
   (También está "Todos", "Limpiar" y el casillero del encabezado para marcar/desmarcar todo.)
2. Botón "Imprimir N etiquetas" imprime las etiquetas de los aumentos seleccionados, con el
   precio nuevo. No depende del stock.
3. "Marcar vistos" deja de mostrarlos como nuevos. "Excel" exporta la lista de aumentos.
Flujo recomendado para muchas etiquetas de aumentos: Aumentos → "Seleccionar sin ver" → "Imprimir".

# PROMOCIONES
Para qué sirve: armar promociones, sobre todo para mover productos que están por vencer o
que rotan poco.
- Solapa "Sugerencias": el sistema propone promos cruzando vencimientos con ventas
  (por ejemplo 2x1 para lo que vence pronto, % de descuento para alerta/próximo, destacar
  los de baja rotación). Con un clic la guardás.
- Solapa "Guardadas": ves las promos y vas cambiando su estado.
Los estados van en orden: propuesta → preaprobada → impacta compras → stock recibido →
activa → finalizada (o descartada).

# FRACCIONAMIENTO
Para qué sirve: partir un producto a granel en los productos finales que se venden.
Cómo se usa:
1. Elegís el producto de origen (a granel) y los kilos que vas a fraccionar.
2. Agregás los derivados (producto final, cantidad, gramos por unidad, destino).
3. El sistema calcula la merma en tiempo real (lo que sobra/se pierde).
4. Guardás. Abajo queda el historial de los últimos fraccionamientos.
Nota: el costo de los productos a granel se guarda siempre por kilo; el precio de venta es
por unidad fraccionada.

# UBICACIONES
Para qué sirve: saber en qué cajón/caja está cada producto en el depósito.
Cómo se usa: ves una grilla de cajones por sector. Hacés clic en un cajón para buscar y
asignar (o cambiar) el producto. También podés crear cajones nuevos con su código y sector.
El buscador de arriba resalta en qué cajón está un producto.

# TAREAS
Para qué sirve: llevar tareas pendientes del equipo.

# PREGUNTAS FRECUENTES
- "Escaneé un producto y no aparece": revisá que el código esté bien o buscá por nombre
  (con palabras sueltas). Si igual no está, puede que no esté cargado en Dux todavía.
- "El stock no coincide": el stock lo manda Dux. El sistema no lo cambia. Si algo no cierra,
  avisá para revisar el origen del dato; no borres ni modifiques nada.
- "Cargué un vencimiento de más / mal": se puede ajustar desde Vencimientos o dar de baja.
- "No me deja copiar el texto del PDF de la factura": el PDF está escaneado como imagen;
  avisá a Adrian.
- "Apareció un error de Dux al confirmar una recepción": la recepción se guardó igual en el
  sistema; faltó registrarla en Dux. Avisá a Adrian y, mientras tanto, cargala en Dux como
  siempre.
- Ante cualquier duda o algo que parezca un error, NO borres ni cambies datos: avisá a Adrian
  con una foto de la pantalla.
`.trim()
