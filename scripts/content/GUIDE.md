# Guía del contenido SEO por producto (formato BESTLED)

Cada producto publicado (salvo los 7 BESTLED, que tienen su ficha editorial) lleva un
archivo `src/data/catalog/content/<jumpseller_id>.json` con el texto de su ficha en el
mismo formato que las BESTLED: descripción con subtítulos, beneficios clave, casos de
uso, información de instalación y preguntas frecuentes. Las especificaciones técnicas
no van aquí: la ficha ya las muestra agrupadas desde Jumpseller.

## Fuente única: los datos de Jumpseller

Los datos del producto están en `reports/content/facts/<jumpseller_id>.json`
(`npm run content -- export`). **Todo dato del producto sale de ahí.** No se inventa
nada: ni cifras, ni certificaciones, ni normas, ni marcas de componentes, ni garantía,
ni compatibilidades (dimming, sensores, fotocelda, control remoto), ni accesorios
incluidos, ni vida útil, ni equivalencias, ni porcentajes de ahorro.

- Si un dato no está, no se menciona (ni "aprox.", ni "hasta", ni "según modelo").
- Se puede usar conocimiento general de iluminación para **explicar** lo que sí está:
  qué significa IP65 o IK08, qué es el CRI, para qué sirve una base E27, qué ambientes
  piden luz cálida o fría, qué se ilumina típicamente con un proyector de esa potencia.
  Eso es contexto, no una promesa del producto: frases como "un grado IP66 protege contra
  polvo y chorros de agua", no "certificado para…".
- Si los datos se contradicen (p. ej. "Potencia 150W" y "Consumo 15W" en una ampolleta
  de 15W equivalente a 150W), se usa solo lo inequívoco o se omite, y se informa al final.
- Si el alcance de un valor es ambiguo (¿14,4W por metro o por rollo? ¿corriente de
  entrada a qué tensión?), se omite: un dato mal leído puede llevar a comprar mal.
- Si el producto no trae tabla de especificaciones y todo está en el texto promocional
  (`electricos`, `construccion` y `componentes` vacíos), se extraen solo los hechos
  verificables y se descartan los superlativos ("el más eficiente del mercado", "se paga sola").

### Contexto general: sí y no

Sí (explica sin prometer nada del producto):
- "Un grado IP66 protege contra polvo y chorros de agua."
- "Los paneles de 60x60 calzan en la modulación del cielo americano."
- "La canastilla de anclaje se deja embebida en el poyo de hormigón."
- "Una cinta de 12V se conecta a una fuente de poder de 12V."

No (es una promesa del producto que los datos no respaldan):
- "Incluye dimmer", "compatible con sensor", "trae control remoto", "funciona con 24V".
- "Ideal para licitaciones" o "cumple la norma X" si la norma no está en los datos.
- "Reemplaza a un halógeno de 50W" si la equivalencia no está en los datos.

Toda cifra con unidad que no esté en los datos se rechaza, **aunque sea de conocimiento
general** (220V de la red chilena, 200 °C de la clase T3, 24V): se escribe sin la cifra
("la red eléctrica domiciliaria", "cintas de otra tensión").
- `npm run content -- check <id>` rechaza cualquier cifra con unidad (W, lm, K, V, Hz,
  h, años, mm, cm, m, kg, °, %, A), certificación (SEC, CE, RoHS, UL, DS1, ATEX, IEC…),
  grado IP/IK o marca de componentes que no esté en los datos.

## Datos de eLIGHTS que sí se pueden usar

- eLIGHTS.cl: iluminación LED profesional, industrial y solar, para empresas y personas en Chile.
- Despacho a todo Chile en **hasta 2 días hábiles**, contados desde que el pago está
  confirmado. Es el plazo de despacho, no de llegada: en regiones, es el plazo para entregar
  el pedido al transportista (u operador logístico), y a eso se suma el tiempo de viaje, que
  se informa en la cotización antes de pagar. No se promete que el pedido llega o se recibe
  en 2 días hábiles (tampoco "el despacho a cualquier región toma o se hace en 2 días
  hábiles", "el despacho alcanza todo el país en…" ni "enviamos a cualquier región en…", que se
  leen como plazo de llegada), ni se habla de camiones, flota o reparto propio (no está
  confirmado). Para regiones se dice "regiones" ("si va a regiones"), no "una región", que
  también incluye a Santiago. El plazo se escribe en cifra: "hasta 2 días hábiles". La oración
  del plazo no lleva dos o más ";": lo de regiones va en una oración aparte.
  (Nunca "mismo día", "24/48 horas" ni "inmediato".)
- La compra es por pedido o cotización: el equipo comercial responde con la cotización
  formal. Atiende a empresas, instaladores eléctricos, constructoras, arquitectos,
  municipios y licitaciones. Se emite factura.
- Asesoría técnica por WhatsApp o en ventas@elights.cl.
- Servicio de estudio lumínico DIALux (sin decir que es gratis) e instalación en la Región
  Metropolitana (servicio aparte). Mencionarlos solo cuando aportan (proyectos, alumbrado,
  canchas, bodegas), no en todas las fichas.

## Prohibido

Stock o disponibilidad ("Consultar disponibilidad" es el texto del sitio), precios,
ofertas o descuentos, "gratis", plazos de entrega distintos de "hasta 2 días hábiles",
la llegada del pedido en 2 días hábiles (es el plazo de despacho), camiones o flota propia,
"líder"/"número uno", comparaciones con otras marcas o tiendas, URLs, HTML, emojis,
mayúsculas sostenidas, signos de exclamación en serie.

## D.S. N°1/2022 (contaminación lumínica)

Lo verifican `src/data/catalog/ds1.ts` y `npm run content -- check`. Ningún producto con
contenido SEO tiene certificado D.S. N°1 documentado (solo las 7 BESTLED, que usan su ficha
editorial), aunque Jumpseller diga "DS1" en su tabla.

- Nunca "certificado/certificación DS1", "cumple el D.S. N°1", "versiones DS1", "marcadas
  como DS1", "sellos SEC y DS1" ni "aprobación de contaminación lumínica". Se ofrece asesoría:
  "¿Necesitas el D.S. N°1/2022? Te asesoramos: escríbenos a ventas@elights.cl".
- La norma se escribe "D.S. N°1/2022", nunca la sigla "DS1". El D.S. N°43 está derogado desde
  el 19-10-2024: no se cita.
- Una oración que nombra la norma (o la contaminación lumínica) no lleva "certificado",
  "certificación", "cumple", "apto" ni "sello": la explicación general ("el cumplimiento se
  acredita con el certificado de cada luminaria") va en otra oración.
- También cuentan como afirmación "apta para Áreas de Protección Especial", "certificada para
  cielos oscuros", "cumple la normativa lumínica" o "cumple el Decreto 1".
- "2200K, 1% de luz azul" se puede escribir como dato del producto (decisión del dueño), pero
  nunca en una ficha de canchas, estadios o gimnasios: ahí la norma fija una temperatura de
  color máxima según la clase del recinto (I, II o III) y el apagado entre las 00:00 y las
  07:00, salvo eventos autorizados.
- El "% de luz azul" no va en el mismo bloque que nombra la norma: ni en la respuesta a una
  pregunta sobre el D.S. N°1/2022, ni en una sección cuyo subtítulo la nombra, ni en el mismo
  beneficio. El 1 % y el 7 % son los límites del decreto, y juntos se leen como "cumple". El
  dato va en su propia sección o pregunta, y la norma, con la asesoría, en otra.
- Las preguntas no son de cumplimiento ("¿Sirve para…?", "¿Cumple…?", "¿Qué versión pido si
  debo cumplir…?"): se escribe "¿Qué hago si mi proyecto debe cumplir el D.S. N°1/2022?" y se
  responde con la asesoría por correo.
- En canchas, la respuesta sobre la norma no ofrece versiones por temperatura de color: según
  la skill normativa-ds1-elights, la fría de 6000K o 6500K queda sobre el tope de cualquier
  clase (la Tabla 4 del decreto está como imagen, así que el tope en Kelvin no se escribe en la
  web). Se pide el uso y la clase del recinto y se asesora. Una cancha o un galpón techado sin muros sigue siendo alumbrado
  exterior (art. 3 a): se escribe "exteriores, incluidos los techados sin muros", nunca "al
  aire libre", y la luz fría queda para "interiores cerrados, con muros".
- Fechas verificadas: alumbrado exterior nuevo, desde el 19 de octubre de 2026 en todo Chile;
  en las Áreas de Protección Especial, desde el 19 de octubre de 2024. "Nuevo" es el de
  proyectos adjudicados o iniciados desde esa fecha (art. 3 z y aa); lo anterior cumple al
  recambio. No escribir "recambio total al 2029".

## Formato del archivo

```json
{
  "metaTitle": "Proyector LED Antivandálico 100W IP66 | eLIGHTS",
  "metaDescription": "…",
  "description": "Párrafo de entrada…\n\n**Subtítulo**\n\nPárrafo…\n\n**Otro subtítulo**\n\nPárrafo…\n\n- punto\n- punto",
  "keyBenefits": ["…"],
  "useCases": ["…"],
  "installationInfo": "…",
  "faq": [{ "question": "¿…?", "answer": "…" }]
}
```

- **metaTitle** (30–65 caracteres): nombre comercial claro, sin mayúsculas sostenidas,
  con la potencia o el dato que lo distingue, terminado en ` | eLIGHTS`.
- **metaDescription** (110–160): qué es, 2–3 datos clave y una invitación concreta
  ("Cotiza con despacho a todo Chile").
- **description** (1.200–5.000 caracteres; ideal 1.800–3.000): un párrafo de entrada
  (qué es, para qué sirve, sus datos principales), luego 2–5 secciones, cada una con su
  subtítulo en una línea sola `**Subtítulo**` y uno o dos párrafos. Una lista va sola en
  su bloque y cada línea empieza con `- `. Negritas `**así**` dentro del texto, con
  moderación. Separar bloques con una línea en blanco (`\n\n`).
  Subtítulos útiles: rendimiento lumínico, construcción y protección, instalación,
  aplicaciones, compra y despacho. Que respondan a lo que busca quien compra ese producto.
- **keyBenefits** (4–8, de 15–160 caracteres): cada uno ligado a un dato real
  ("IP66 e IK08: soporta lluvia, polvo e impactos en exteriores").
- **useCases** (3–8, de hasta 90 caracteres): lugares o proyectos concretos.
- **installationInfo** (opcional, 100–1.800): solo si los datos traen montaje, altura o
  distancia de instalación, instalación, dimensiones de empotrado, base/casquillo o
  conexión. Las dimensiones del producto por sí solas no bastan. Mismo formato que la
  descripción.
- **faq** (3–6): preguntas reales de quien compra (`¿…?`), respuestas de 80–800
  caracteres basadas en los datos. Garantía solo si los datos la traen. Puede haber una
  sobre despacho o cotización (con los datos de eLIGHTS de arriba).

## Al escribir cerca de las reglas

- "Entrega" o "despacho" junto a horas o días se lee como plazo de entrega: para la
  luz o la batería, usar "ofrece 410 lm" o "autonomía de 3 horas".
- Cada problema que muestra `check` es real: se corrige el texto, no se busca otra forma
  de escribir la misma cifra.

## Estilo

- Español de Chile, profesional y directo; tuteo moderado ("tu proyecto") o impersonal.
- Útil antes que promocional: que quien lee pueda decidir si le sirve.
- Productos casi iguales (misma familia en otra potencia o color): cada ficha con sus
  propias cifras y redacción propia. No copiar párrafos entre fichas: Google castiga el
  contenido duplicado. El cierre comercial también varía.
- Nombres de producto en mayúscula inicial ("Proyector LED Antivandálico 100W"), no como
  en Jumpseller ("PROYECTOR LED ANTIVANDÁLICO 100W").
