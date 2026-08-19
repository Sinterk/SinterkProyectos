// Lista fija de tipos de hallazgo del levantamiento preventivo. Vive acá
// (en vez de solo en PuntoCard) porque Administración también la necesita
// para mostrar el editor de "Corrección por hallazgo" en el mismo orden —
// una sola fuente evita que las dos listas se desalineen.
export const HALLAZGOS: string[] = [
  'Altura de cable Cruce de calles "4,5 mts"',
  'Atenuación fuera de norma sin afectar servicio',
  'CTO sin potencia y sin clientes',
  'Mufa en el suelo',
  'Cámara sin tapa',
  'Cámara Abierta / Sin soldar',
  'Mufa o cable colgando en cruce de calle',
  'Mufa en mal estado',
  'Gestión ante quien corresponda por el Estado Postes/ postación dañada',
  'Baja distancia a Red BT/AT',
  'Bajada Lateral sin fleje',
  'CTO con tapa abierta o sin tapa',
  'Falla en estructura o sellos de cámara',
  'Bandeja de Emergencia / Mufa sin Cúpula',
  'Altura Cable Vano sin riesgo',
  'Vano sobrecargado',
  'Rotulado de Mufas, cables, gabinetes, DC',
  'Rotulado de CTO',
  'Entrada sin sello cable / Mufa',
  'Falta cruceta o Cruceta Dañada',
  'Falta Planimetria',
  'CTO en condición insegura o no autorizada',
]
