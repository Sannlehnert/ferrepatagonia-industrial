const medidas = (valores, unidad) => valores.map(valor => `${valor} ${unidad}`);
const mm = valores => medidas(valores, 'mm');
const talles = 'XS S M L XL 2XL 3XL 4XL 5XL'.split(' ').map(talle => `talle ${talle}`);
const calzado = medidas([38, 39, 40, 41, 42, 43, 44, 45, 46], 'AR');
const colores = ['blanco', 'amarillo', 'naranja', 'rojo', 'azul', 'verde', 'gris', 'negro', 'celeste'];
const paquetes = [5, 10, 15, 20, 25, 40, 50, 75, 100].map(n => `pack de ${n} unidades`);
const roscas = 'M3 M4 M5 M6 M8 M10 M12 M14 M16'.split(' ');
const litros = medidas([1, 2, 3, 4, 5, 8, 10, 15, 20], 'L');
const conjuntos = medidas([5, 6, 7, 8, 9, 10, 12, 15, 18], 'piezas');
const largos = medidas([5, 10, 15, 20, 25, 30, 50, 75, 100], 'm');
const anchos = mm([12, 15, 18, 20, 24, 30, 36, 48, 50]);
const discos = mm([75, 100, 115, 125, 150, 180, 200, 230, 250]);
const granos = [40, 60, 80, 100, 120, 150, 180, 220, 240].map(n => `grano ${n}`);
const concentrados = medidas([100, 150, 200, 250, 300, 400, 500, 600, 750], 'ml');
const secciones = medidas([0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16], 'mm²');
const cajas = ['4 × 4', '5 × 5', '6 × 6', '7 × 7', '8 × 8', '10 × 10', '12 × 12', '15 × 15', '20 × 20'].map(x => `${x} cm`);
const puntos = ['1', '2', '3', '4', '5', '6', '8', '10', '12'].map(n => `con ${n} posiciones`);
const conteos = (valores, etiqueta) => valores.map(n => `${etiqueta} ${n}`);
const senales = ['Salida', 'No fumar', 'Piso mojado', 'Acceso restringido', 'Botiquín', 'Extintor', 'Punto de reunión', 'Mantener despejado', 'Solo personal autorizado'];
const cintas = ['roja y blanca', 'amarilla y negra', 'blanca', 'amarilla', 'roja', 'azul', 'verde', 'naranja', 'negra'];
const tubos = ['3 × 5', '4 × 6', '5 × 8', '6 × 8', '6 × 10', '8 × 10', '8 × 12', '10 × 12', '12 × 16'].map(x => `${x} mm interior × exterior`);

// [Clave estable, categoría, familia, modelos]. Cada modelo declara su atributo,
// descripción de uso y precio inicial en centavos. El incremento es opcional.
module.exports = [
  ['MAN', 'Herramientas E2E', 'Herramientas manuales', [
    ['llave-combinada', 'Llave combinada', mm([6, 8, 9, 10, 11, 12, 13, 17, 19]), 'Llave con boca fija y estrella para tornillería hexagonal.', 250, 38],
    ['destornillador-plano', 'Destornillador plano', mm([2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 8]), 'Punta de hoja plana para tornillos ranurados.', 230, 25],
    ['prensa-c', 'Prensa manual tipo C', mm([25, 40, 50, 65, 75, 100, 125, 150, 200]), 'Prensa de tornillo para sujetar piezas sobre el banco. La medida indica la apertura.', 500, 105],
    ['limas', 'Juego de limas para metal', conjuntos, 'Surtido de limas para repasar cantos y ajustar piezas metálicas.', 760, 100],
  ]],
  ['ELE', 'Herramientas E2E', 'Herramientas eléctricas', [
    ['taladro', 'Taladro percutor con cable', medidas([500, 550, 600, 650, 700, 750, 800, 850, 900], 'W'), 'Taladro con modo rotación y percusión, para utilizar con mechas compatibles.', 4200, 460],
    ['amoladora', 'Amoladora angular con cable', medidas([600, 650, 700, 750, 800, 850, 900, 1000, 1200], 'W'), 'Herramienta para discos compatibles de corte y desbaste.', 3800, 480],
    ['caladora', 'Sierra caladora con cable', medidas([350, 400, 450, 500, 550, 600, 650, 700, 750], 'W'), 'Sierra de hoja alternativa para recortes rectos o curvos según la hoja elegida.', 3600, 460],
    ['lijadora', 'Lijadora orbital con cable', medidas([150, 180, 200, 220, 240, 260, 280, 300, 350], 'W'), 'Lijadora para terminación de superficies planas con abrasivo compatible.', 2700, 300],
  ]],
  ['NEU', 'Neumática', 'Herramientas neumáticas', [
    ['manguera-pu', 'Manguera neumática recta de poliuretano', tubos, 'Tramo de 10 m para conexiones de aire. Elegir racores por diámetro exterior.', 750, 120],
    ['manguera-pe', 'Tubo de polietileno para aire', tubos, 'Rollo de 10 m para tendidos de aire con racores compatibles.', 600, 80],
    ['sopladora', 'Pistola sopladora con boquilla extendida', mm([25, 50, 75, 100, 150, 200, 250, 300, 450]), 'Pistola manual para dirigir aire a cavidades. La medida corresponde a la boquilla.', 450, 75],
    ['manifold', 'Distribuidor neumático de aluminio', conteos([2, 3, 4, 5, 6, 8, 10, 12, 16], 'salidas'), 'Bloque para derivar una línea de aire a varias salidas roscadas.', 950, 180],
  ]],
  ['CAS', 'Protección personal', 'Cascos de seguridad', [
    ['casco-ala', 'Casco industrial de ala completa', colores, 'Modelo de ala alrededor de la copa. El color identifica la variante del catálogo.', 1050],
    ['casco-visera', 'Casco industrial con visera frontal', colores, 'Modelo de visera frontal y copa lisa para dotación de trabajo.', 790],
    ['casco-corto', 'Casco industrial de visera corta', colores, 'Modelo con visera frontal corta para la selección de dotación.', 830],
    ['casco-ranuras', 'Casco industrial con ranuras laterales', colores, 'Casco con ranuras para acoples compatibles según la ficha del proveedor.', 910],
  ]],
  ['CHA', 'Ropa y calzado de trabajo', 'Chalecos reflectivos', [
    ['chaleco-naranja', 'Chaleco reflectivo naranja con cierre', talles, 'Chaleco naranja con bandas visibles y cierre frontal.', 510],
    ['chaleco-amarillo', 'Chaleco reflectivo amarillo con cierre', talles, 'Chaleco amarillo con bandas visibles y apertura mediante cierre.', 510],
    ['chaleco-malla', 'Chaleco reflectivo naranja de malla', talles, 'Confección de malla naranja con bandas reflectivas.', 470],
    ['chaleco-bolsillo', 'Chaleco reflectivo amarillo con bolsillos', talles, 'Modelo amarillo con bolsillos frontales para artículos livianos.', 680],
  ]],
  ['GUA', 'Protección personal', 'Guantes de trabajo', [
    ['guante-nitrilo', 'Guante tejido con palma de nitrilo', talles, 'Guante de soporte tejido con recubrimiento en palma. Presentación por par.', 320],
    ['guante-descarne', 'Guante de cuero descarne de puño largo', talles, 'Guante de cuero con puño extendido. Presentación por par.', 710],
    ['guante-pvc', 'Guante de PVC con puño recto', talles, 'Guante con exterior de PVC y puño recto. Presentación por par.', 520],
    ['guante-algodon', 'Guante de algodón tejido', talles, 'Guante tejido de algodón, sin recubrimiento de palma. Presentación por par.', 155],
  ]],
  ['OCU', 'Protección personal', 'Protección ocular', [
    ['lente-transparente', 'Anteojo envolvente de lente transparente', paquetes, 'Anteojo de lente incoloro y patillas laterales.', 750, 430],
    ['lente-gris', 'Anteojo envolvente de lente gris', paquetes, 'Anteojo de lente tintado gris y patillas laterales.', 890, 490],
    ['antiparra-banda', 'Antiparra transparente con banda elástica', paquetes, 'Antiparra con banda alrededor de la cabeza. La presentación indica unidades completas.', 1200, 630],
    ['sobrelente', 'Anteojo transparente para usar sobre lentes', paquetes, 'Montura amplia para superponer sobre anteojos de uso personal, según el calce.', 1250, 680],
  ]],
  ['AUD', 'Protección personal', 'Protección auditiva', [
    ['tapon-espuma', 'Tapón auditivo de espuma sin cordón', paquetes, 'Tapones de espuma en envases individuales. Cada unidad contiene un par.', 150, 70],
    ['tapon-cordon', 'Tapón auditivo de espuma con cordón', paquetes, 'Pares de tapones de espuma unidos mediante cordón.', 210, 110],
    ['tapon-aletas', 'Tapón auditivo con aletas y cordón', paquetes, 'Pares de tapones con aletas, unidos por un cordón.', 460, 245],
    ['orejera', 'Orejera de copa con diadema', colores, 'Modelo con copas y diadema. La variante indica el color exterior.', 1190],
  ]],
  ['RES', 'Protección personal', 'Protección respiratoria', [
    ['mascarilla-plana', 'Mascarilla plegable con elásticos de cabeza', paquetes, 'Pieza facial plegable con sujeción a la cabeza. La ficha del proveedor define su uso.', 380, 240],
    ['mascarilla-copa', 'Mascarilla moldeada tipo copa', paquetes, 'Pieza facial de cuerpo moldeado. La presentación indica unidades individuales.', 440, 250],
    ['prefiltro', 'Repuesto de prefiltro circular', paquetes, 'Repuesto circular. Comprobar sistema, encastre y ficha antes de seleccionarlo.', 720, 450],
    ['retenedor', 'Retenedor de prefiltro circular', paquetes, 'Portaprefiltro circular para encastres compatibles. Incluye solo los retenedores.', 540, 325],
  ]],
  ['CAL', 'Ropa y calzado de trabajo', 'Calzado de seguridad', [
    ['botin', 'Botín de trabajo de cuero negro con puntera', calzado, 'Botín de caña corta, cordones y exterior de cuero negro.', 3400],
    ['borcegui', 'Borceguí de trabajo marrón con puntera', calzado, 'Calzado marrón con cordones y caña alta.', 4550],
    ['zapato', 'Zapato de trabajo bajo con puntera', calzado, 'Zapato cerrado de perfil bajo y ajuste por cordones.', 3290],
    ['bota-pvc', 'Bota de trabajo de PVC con puntera', calzado, 'Bota negra de caña alta de PVC, sin cordones.', 2900],
  ]],
  ['ROP', 'Ropa y calzado de trabajo', 'Ropa de trabajo', [
    ['pantalon', 'Pantalón de trabajo azul con bolsillos cargo', talles, 'Pantalón azul con bolsillos laterales en las piernas.', 1800],
    ['camisa', 'Camisa de trabajo de algodón manga larga', talles, 'Camisa abotonada de algodón con manga larga.', 1600],
    ['mameluco', 'Mameluco de trabajo de gabardina', talles, 'Prenda enteriza de gabardina con cierre frontal.', 2750],
    ['campera', 'Campera de trabajo con forro', talles, 'Campera con forro interior y cierre frontal.', 3300],
  ]],
  ['ALT', 'Protección personal', 'Arnés y protección en altura', [
    ['bolso-arnes', 'Bolso para guardar arnés', litros, 'Bolso para traslado y guardado del equipo. La variante indica volumen nominal.', 560, 180],
    ['protector-cinta', 'Funda para cinta de arnés', mm([150, 180, 200, 220, 250, 280, 300, 320, 350]), 'Accesorio para cubrir un tramo de cinta. Elegir por largo y consultar compatibilidad.', 270, 32],
    ['etiqueta-arnes', 'Etiqueta de identificación para inventario de arneses', paquetes, 'Etiquetas para inventario externo del equipo, con espacio para código interno.', 160, 70],
    ['arnes', 'Arnés de cuerpo completo', ['S/M', 'L/XL', '2XL/3XL'].flatMap(talle => ['negro', 'azul', 'rojo'].map(color => `talle ${talle} ${color}`)), 'Variante de catálogo por talle y color. Para una aplicación concreta, consultar documentación del proveedor.', 4990],
  ]],
  ['CON', 'Señalización y balizamiento', 'Conos y balizamiento', [
    ['cono-naranja', 'Cono de señalización naranja', medidas([18, 23, 25, 35, 45, 50, 60, 70, 90], 'cm'), 'Cono de base cuadrada para delimitación. La medida corresponde a la altura.', 350, 145],
    ['cadena', 'Cadena de balizamiento plástica', largos, 'Cadena para demarcación entre postes o soportes. La medida indica longitud.', 480, 250],
    ['barra-conos', 'Barra de enlace para conos', medidas([0.6, 0.75, 0.9, 1, 1.2, 1.5, 1.8, 2, 2.5], 'm'), 'Barra para enlazar conos con punta de tamaño compatible.', 550, 145],
    ['poste', 'Poste de delimitación con base', colores, 'Poste para sectorización con base incluida. El color corresponde al cuerpo.', 1240],
  ]],
  ['CIN', 'Señalización y balizamiento', 'Cintas de seguridad', [
    ['cinta-delimitar', 'Cinta para delimitar sectores', cintas, 'Rollo de 100 m de cinta sin adhesivo. La variante describe el color o combinación.', 540],
    ['cinta-piso', 'Cinta adhesiva para demarcación de pisos', cintas, 'Rollo de 25 m para demarcación visual de pisos, según la superficie.', 780],
    ['cinta-visual', 'Cinta adhesiva reflectiva de señalización', anchos, 'Rollo de 5 m para identificación visual. La variante indica el ancho.', 430, 85],
    ['cinta-texto', 'Cinta impresa de delimitación amarilla y negra', largos, 'Cinta sin adhesivo en amarillo y negro, con leyenda de precaución.', 200, 75],
  ]],
  ['SEN', 'Señalización y balizamiento', 'Señalización industrial', [
    ['cartel-pvc', 'Cartel de PVC 20 × 30 cm', senales, 'Placa de PVC con mensaje impreso para identificación de sectores.', 610],
    ['cartel-aluminio', 'Cartel de aluminio 30 × 40 cm', senales, 'Placa metálica con leyenda impresa, para fijación en superficie compatible.', 1140],
    ['cartel-vinilo', 'Cartel autoadhesivo 15 × 20 cm', senales, 'Señal impresa en película adhesiva para aplicar sobre superficie lisa.', 355],
    ['cartel-acrilico', 'Placa acrílica 15 × 25 cm', senales, 'Placa rígida con texto visible, para señalización interior.', 820],
  ]],
  ['TOR', 'Fijaciones E2E', 'Tornillos, tuercas y arandelas', [
    ['tornillo-hex', 'Tornillo cabeza hexagonal de acero', roscas, 'Bolsa de 25 tornillos métricos de 40 mm de largo. La variante indica la rosca.', 280, 65],
    ['tuerca', 'Tuerca hexagonal de acero', roscas, 'Bolsa de 50 tuercas de rosca métrica para pernos compatibles.', 210, 65],
    ['arandela-plana', 'Arandela plana zincada', roscas, 'Bolsa de 100 arandelas para tornillería métrica del diámetro indicado.', 190, 42],
    ['arandela-grower', 'Arandela elástica partida de acero', roscas, 'Bolsa de 50 arandelas partidas. La variante indica el tornillo correspondiente.', 180, 43],
  ]],
  ['FIJ', 'Fijaciones E2E', 'Fijaciones y anclajes', [
    ['tarugo-nylon', 'Tarugo de nailon', mm([4, 5, 6, 7, 8, 10, 12, 14, 16]), 'Bolsa de 25 tarugos. Elegir el diámetro según perforación y fijación.', 160, 43],
    ['varilla', 'Varilla roscada zincada de 1 m', roscas, 'Varilla de rosca métrica continua, vendida por unidad.', 150, 80],
    ['anclaje', 'Anclaje metálico de expansión', 'M6 M8 M10 M12 M14 M16 M18 M20 M24'.split(' '), 'Anclaje unitario con cuerpo metálico para montaje en sustrato compatible.', 170, 62],
    ['abrazadera', 'Abrazadera de montaje para caño', mm([12, 15, 16, 20, 22, 25, 28, 32, 40]), 'Abrazadera para sujeción de caños por diámetro exterior. Pack de 10.', 340, 50],
  ]],
  ['CAB', 'Electricidad e iluminación', 'Cables eléctricos', [
    ['cable-negro', 'Cable unipolar negro en rollo de 25 m', secciones, 'Conductor unipolar negro. La variante indica la sección nominal.', 630, 410],
    ['cable-azul', 'Cable unipolar azul en rollo de 25 m', secciones, 'Conductor unipolar azul. La variante indica la sección nominal.', 630, 410],
    ['cable-marron', 'Cable unipolar marrón en rollo de 25 m', secciones, 'Conductor unipolar marrón. La variante indica la sección nominal.', 630, 410],
    ['cable-bipolar', 'Cable bipolar negro en rollo de 10 m', secciones, 'Cable con dos conductores. La medida corresponde a la sección nominal por conductor.', 840, 490],
  ]],
  ['MAT', 'Electricidad e iluminación', 'Interruptores y materiales eléctricos', [
    ['interruptor', 'Interruptor modular unipolar blanco', paquetes, 'Módulo blanco de accionamiento manual. Elegir bastidor compatible.', 850, 520],
    ['caja-embutir', 'Caja de paso para embutir', cajas, 'Caja para canalización embutida. La medida corresponde al frente.', 195, 60],
    ['caja-superficie', 'Caja de paso de superficie con tapa', cajas, 'Caja con tapa para montaje de superficie. La medida corresponde al frente.', 240, 65],
    ['bornera', 'Bornera de tornillo para montaje', puntos, 'Regleta de conexiones por tornillo. La variante indica la cantidad de posiciones.', 160, 64],
  ]],
  ['ILU', 'Electricidad e iluminación', 'Iluminación de trabajo', [
    ['reflector', 'Reflector LED con soporte', medidas([10, 15, 20, 30, 40, 50, 70, 100, 150], 'W'), 'Reflector con soporte para montaje. La variante indica potencia nominal.', 690, 430],
    ['lampara-e27', 'Lámpara LED rosca E27 luz fría', medidas([5, 6, 7, 8, 9, 10, 12, 15, 18], 'W'), 'Lámpara de rosca E27 con luz fría.', 180, 45],
    ['regleta-led', 'Regleta LED lineal', medidas([20, 30, 40, 45, 60, 75, 90, 120, 150], 'cm'), 'Luminaria lineal de montaje sobre superficie. Medida de punta a punta.', 510, 230],
    ['portalamparas', 'Portalámparas E27 de superficie', paquetes, 'Base para montar una lámpara de rosca E27 sobre superficie compatible.', 430, 300],
  ]],
  ['OBR', 'Construcción y consumibles', 'Materiales de construcción', [
    ['malla', 'Malla de fibra de vidrio para juntas', mm([48, 50, 60, 75, 80, 90, 100, 125, 150]), 'Rollo de 20 m de malla para tratamiento de juntas. Selección por ancho.', 380, 60],
    ['perfil', 'Perfil angular de aluminio de 1 m', medidas(['10 × 10', '12 × 12', '15 × 15', '20 × 20', '25 × 25', '30 × 30', '35 × 35', '40 × 40', '50 × 50'], 'mm'), 'Perfil en L de un metro. La variante indica el ancho de las alas.', 290, 85],
    ['espaciador', 'Separador en cruz para cerámica', mm([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8]), 'Bolsa de 100 separadores para mantener la junta del ancho indicado.', 135, 20],
    ['malla-obra', 'Malla plástica para revoco', medidas([0.3, 0.4, 0.5, 0.6, 0.75, 0.8, 0.9, 1, 1.2], 'm de ancho'), 'Rollo de 10 m de malla plástica para aplicaciones de obra compatibles.', 510, 125],
  ]],
  ['ADH', 'Construcción y consumibles', 'Adhesivos y selladores', [
    ['cola', 'Cola vinílica para madera', concentrados, 'Adhesivo vinílico en envase individual para uniones de madera compatibles.', 240, 65],
    ['sellador', 'Sellador acrílico blanco', ['1', '2', '3', '4', '6', '8', '10', '12', '24'].map(n => `caja de ${n} cartuchos`), 'Cartuchos de 300 ml de sellador acrílico blanco para juntas compatibles.', 330, 250],
    ['contacto', 'Adhesivo de contacto', concentrados, 'Adhesivo para aplicación sobre superficies compatibles, según su ficha.', 360, 95],
    ['cinta-doble', 'Cinta de montaje doble faz', anchos, 'Rollo de 5 m con adhesivo en ambas caras. La medida indica el ancho.', 220, 55],
  ]],
  ['ABR', 'Herramientas E2E', 'Discos de corte y abrasivos', [
    ['disco-metal', 'Disco de corte para metal', mm([75, 100, 115, 125, 150, 180, 230, 300, 355]), 'Disco de corte unitario. Elegir diámetro y compatibilidad con la herramienta.', 160, 70],
    ['lija-madera', 'Hoja de lija para madera 230 × 280 mm', granos, 'Hoja individual para lijado manual. La variante indica el grano.', 95],
    ['lija-agua', 'Hoja de lija al agua 230 × 280 mm', [120, 180, 220, 240, 320, 400, 600, 800, 1000].map(n => `grano ${n}`), 'Hoja individual de lija al agua. La variante indica el grano.', 105],
    ['disco-lija', 'Disco de lija con respaldo adhesivo', discos, 'Disco abrasivo grano 120 para plato compatible. La variante indica diámetro.', 140, 28],
  ]],
  ['MEC', 'Herramientas E2E', 'Brocas, mechas y accesorios', [
    ['mecha-hss', 'Mecha HSS para metal', mm([2, 2.5, 3, 3.5, 4, 5, 6, 8, 10]), 'Mecha helicoidal de vástago cilíndrico, vendida por unidad.', 110, 34],
    ['mecha-madera', 'Mecha de tres puntas para madera', mm([3, 4, 5, 6, 7, 8, 10, 12, 14]), 'Mecha con punta central para posicionar la perforación en madera.', 130, 45],
    ['mecha-mamposteria', 'Mecha cilíndrica para mampostería', mm([4, 5, 6, 7, 8, 9, 10, 12, 14]), 'Mecha para mampostería con vástago cilíndrico y diámetro nominal indicado.', 135, 41],
    ['copa', 'Sierra copa bimetálica', mm([19, 22, 25, 29, 32, 38, 44, 51, 64]), 'Copa bimetálica sin eje portacopa. La variante indica diámetro de corte.', 470, 90],
  ]],
  ['SUM', 'Construcción y consumibles', 'Consumibles industriales', [
    ['precinto', 'Precinto negro de nailon', mm([80, 100, 120, 150, 180, 200, 250, 300, 370]), 'Bolsa de 100 precintos para ordenar conjuntos. La medida indica largo.', 180, 65],
    ['trapo', 'Paño de algodón para taller 40 × 40 cm', paquetes, 'Paños para tareas de limpieza y retiro de residuos superficiales.', 340, 270],
    ['cepillo', 'Cepillo manual de alambre de acero', paquetes, 'Cepillo con mango para repasar superficies metálicas compatibles.', 760, 530],
    ['film', 'Film de embalaje transparente en rollo', mm([50, 75, 100, 125, 150, 200, 250, 300, 500]), 'Rollo de película estirable de 100 m. La variante indica el ancho.', 250, 95],
  ]],
];
