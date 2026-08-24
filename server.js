const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Brevo = require('@getbrevo/brevo');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const app = express();
// Necesario detrás de proxies (Render) para que req.ip refleje la IP real del cliente
app.set('trust proxy', 1);

// --- MIDDLEWARES ---
app.use(cors());
app.use(express.json());

// Almacenamiento en memoria de sesiones activas (Token -> Local/Admin)
const sesionesActivas = new Map();

// --- CONFIGURACIÓN DE BREVO ---
const apiInstance = new Brevo.TransactionalEmailsApi();
if (process.env.BREVO_API_KEY) {
  apiInstance.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
}

// --- CONEXIÓN A MONGODB ATLAS ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/appmenu';

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('🟢 Conectado exitosamente a MongoDB');
    
    // --- CONTRASEÑA SUPERADMIN ---
    // Se toma de la variable de entorno SUPERADMIN_PASSWORD. Nunca se sobreescribe
    // la clave guardada en Mongo salvo que esa variable esté definida y sea distinta.
    try {
      const configExistente = await ConfigGlobal.findOne({ tipo: 'superadmin' });

      if (!configExistente) {
        // Primera instalación: usa SUPERADMIN_PASSWORD del entorno o genera una provisional aleatoria
        const inicial = process.env.SUPERADMIN_PASSWORD || crypto.randomBytes(6).toString('hex');
        await ConfigGlobal.create({
          tipo: 'superadmin',
          password: await bcrypt.hash(inicial, 10)
        });
        console.log('🔑 Credencial SuperAdmin creada con éxito en MongoDB.');
        if (!process.env.SUPERADMIN_PASSWORD) {
          console.log('⚠️ Contraseña SuperAdmin provisional: ' + inicial + ' (defina SUPERADMIN_PASSWORD en las variables de entorno)');
        }
      } else if (process.env.SUPERADMIN_PASSWORD) {
        const almacenada = configExistente.password;
        const coincide = esHashBcrypt(almacenada)
          ? await bcrypt.compare(process.env.SUPERADMIN_PASSWORD, almacenada)
          : process.env.SUPERADMIN_PASSWORD === almacenada;

        if (!coincide || !esHashBcrypt(almacenada)) {
          configExistente.password = await bcrypt.hash(process.env.SUPERADMIN_PASSWORD, 10);
          await configExistente.save();
          console.log('🔑 Credencial SuperAdmin actualizada desde variable de entorno.');
        }
      }
    } catch (err) {
      console.error('🔴 Error al inicializar credencial en MongoDB:', err);
    }

    // Purga inicial del historial antiguo y luego una vez al día
    await purgarHistorialAntiguo();
  })
  .catch((err) => console.error('🔴 Error de conexión a MongoDB:', err));

// --- PURGA AUTOMÁTICA DEL HISTORIAL (>12 MESES) ---
const RETENCION_HISTORIAL_MS = 365 * 24 * 60 * 60 * 1000;

async function purgarHistorialAntiguo() {
  try {
    const limite = new Date(Date.now() - RETENCION_HISTORIAL_MS);
    const resultado = await Historial.deleteMany({ createdAt: { $lt: limite } });
    if (resultado.deletedCount > 0) {
      console.log(`🧹 Historial: ${resultado.deletedCount} registro(s) con más de 12 meses eliminados.`);
    }
  } catch (error) {
    console.error('Error al purgar el historial antiguo:', error.message);
  }
}

setInterval(purgarHistorialAntiguo, 24 * 60 * 60 * 1000).unref();

// --- ESQUEMAS Y MODELOS DE MONGOOSE ---

const configGlobalSchema = new mongoose.Schema({
  tipo: { type: String, required: true, unique: true },
  password: { type: String, required: true }
}, { collection: 'configglobals' });

const ConfigGlobal = mongoose.model('ConfigGlobal', configGlobalSchema);

const localSchema = new mongoose.Schema({
  id: Number,
  local: { type: String, required: true, unique: true },
  nombre: { type: String, required: true },
  rut: String,
  correo: String,
  password: { type: String, default: '123' },
  activo: { type: Boolean, default: true },
  fechaCreacion: Date,
  fechaVencimiento: Date,
  menu: Array,
  anuncio: { type: String, default: "ok" }
}, { collection: 'locales' });
// Búsqueda de locales por nombre en /api/locales/verificar
localSchema.index({ nombre: 1 });

const Local = mongoose.model('Local', localSchema);

const respuestaAvisoSchema = new mongoose.Schema({
  local: { type: String, required: true },
  texto: { type: String, required: true },
  fecha: { type: Date, default: Date.now }
});

const avisoSchema = new mongoose.Schema({
  destinatario: { type: String, default: 'todos' },
  asunto: { type: String, default: 'Aviso del Sistema' },
  texto: { type: String, required: true },
  fecha: { type: Date, default: Date.now },
  respuestas: [respuestaAvisoSchema]
}, { collection: 'avisos' });
// Listado de avisos por destinatario ordenado por fecha
avisoSchema.index({ destinatario: 1, fecha: -1 });

const Aviso = mongoose.model('Aviso', avisoSchema);

const pedidoSchema = new mongoose.Schema({
  local: { type: String, required: true },
  mesa: { type: String, required: true },
  nombreCliente: { type: String, default: null },
  items: Array,
  total: { type: Number, default: 0 },
  estado: { type: String, default: 'pendiente' },
  rutGarzon: { type: String, default: null },
  pagado: { type: Boolean, default: false },
  prioridadPriorizada: { type: Number, default: 0 },
  rutCajeroPago: { type: String, default: null },
  numeroCajaPago: { type: Number, default: null },
  fecha: { type: Date, default: Date.now }
}, { collection: 'pedidos', timestamps: true });
// Panel de pedidos: siempre se consulta por local
pedidoSchema.index({ local: 1, fecha: -1 });

const Pedido = mongoose.model('Pedido', pedidoSchema);

const historialSchema = new mongoose.Schema({
  id: String,
  local: { type: String, required: true },
  mesa: String,
  nombreCliente: { type: String, default: null },
  items: Array,
  total: Number,
  estado: { type: String, default: 'entregado' },
  hora: String,
  rutGarzon: String,
  horaEntrega: String,
  fechaEntrega: String
}, { collection: 'historials', timestamps: true });
// Historial: consulta por local, del más reciente al más antiguo
historialSchema.index({ local: 1, createdAt: -1 });

const Historial = mongoose.model('Historial', historialSchema);

const cajaSchema = new mongoose.Schema({
  local: { type: String, required: true },
  numero: { type: Number, required: true },
  rutCajera: { type: String, default: null },
  abierto: { type: Boolean, default: false },
  horaApertura: { type: Date, default: null },
  horaCierre: { type: Date, default: null }
}, { collection: 'cajas', timestamps: true });
// Evita duplicados de una misma caja por carrera de peticiones simultáneas
cajaSchema.index({ local: 1, numero: 1 }, { unique: true });

const Caja = mongoose.model('Caja', cajaSchema);

// Tokens de un solo uso para "establecer nueva contraseña" (enlace del correo)
const resetPasswordSchema = new mongoose.Schema({
  local: { type: String, required: true },
  tokenHash: { type: String, required: true },
  expira: { type: Date, required: true }
}, { collection: 'resetpasswords' });
// Mongo elimina solos los documentos una vez pasada su fecha de expiración
resetPasswordSchema.index({ expira: 1 }, { expireAfterSeconds: 0 });
resetPasswordSchema.index({ local: 1 });

const ResetPassword = mongoose.model('ResetPassword', resetPasswordSchema);

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

// Limpia texto ingresado por usuarios para prevenir XSS y desbordes de longitud
function limpiarTexto(texto, maxLen = 120) {
  if (typeof texto !== 'string') return null;
  const limpio = texto.replace(/[<>"'`]/g, '').replace(/\s+/g, ' ').trim();
  return limpio ? limpio.slice(0, maxLen) : null;
}

// Detecta si una contraseña almacenada ya está hasheada con bcrypt
function esHashBcrypt(texto) {
  return typeof texto === 'string' && texto.startsWith('$2');
}

// --- ENVÍO DE CORREOS TRANSACCIONALES (BREVO) ---
const REMITENTE_CORREO = process.env.REMITENTE_CORREO || 'appmenu26@gmail.com';
// Frontend donde vive index.html (para los enlaces dentro de los correos)
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://appmenu-990c3.web.app';

function escaparHtmlCorreo(texto) {
  return String(texto).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Devuelve true si el correo partió; nunca lanza (los envíos son best-effort)
async function enviarCorreo(destinatario, asunto, html) {
  if (!process.env.BREVO_API_KEY) {
    console.log(`⚠️ BREVO_API_KEY no definida: correo NO enviado a ${destinatario} (${asunto})`);
    return false;
  }
  try {
    const api = new Brevo.TransactionalEmailsApi();
    api.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
    await api.sendTransacEmail({
      sender: { name: 'AppMenu', email: REMITENTE_CORREO },
      to: [{ email: destinatario }],
      subject: asunto,
      htmlContent: html
    });
    console.log(`📧 Correo enviado a ${destinatario}: ${asunto}`);
    return true;
  } catch (error) {
    console.error('Error al enviar correo con Brevo:', error.response?.text || error.message);
    return false;
  }
}

// Sanitiza el arreglo de ítems de un pedido (cantidad/precio acotados, nombre limpio)
function limpiarItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 50).map(i => ({
    nombre: limpiarTexto(i && i.nombre, 60) || 'Producto',
    precio: Number(i && i.precio) || 0,
    cantidad: Math.max(1, Math.min(99, Number(i && i.cantidad) || 1))
  }));
}

// Helper para validar token de sesión (con expiración automática a las 12 h)
const DURACION_SESION_MS = 12 * 60 * 60 * 1000;

function obtenerSesion(token) {
  if (!token) return null;
  const sesion = sesionesActivas.get(token);
  if (!sesion) return null;
  if (Date.now() - new Date(sesion.fecha).getTime() > DURACION_SESION_MS) {
    sesionesActivas.delete(token);
    return null;
  }
  return sesion;
}

function verificarAutenticacion(req, res, next) {
  const sesion = obtenerSesion(req.headers['authorization']);
  if (!sesion) {
    return res.status(401).json({ ok: false, error: 'Sesión no válida o expirada' });
  }
  req.usuarioSesion = sesion;
  next();
}

// Solo Administrador General (demo.html, mensajes.html)
function requerirSuperAdmin(req, res, next) {
  const sesion = obtenerSesion(req.headers['authorization']);
  if (!sesion || sesion.tipo !== 'superadmin') {
    return res.status(401).json({ ok: false, error: '🔒 Acceso exclusivo del Administrador General. Ingrese la contraseña SuperAdmin.' });
  }
  req.usuarioSesion = sesion;
  next();
}

// Sesión de local válida (panel admin: mutaciones de menú). El SuperAdmin también pasa.
function requerirSesionLocal(req, res, next) {
  const sesion = obtenerSesion(req.headers['authorization']);
  if (!sesion || (sesion.tipo !== 'local' && sesion.tipo !== 'superadmin')) {
    return res.status(401).json({ ok: false, error: '🔒 Sesión no válida. Ingrese la contraseña del local.' });
  }

  // Un local nunca puede operar sobre otro local
  const localPedido = ((req.body && req.body.local) || (req.query && req.query.local) || '').toLowerCase().trim();
  if (sesion.tipo === 'local' && localPedido && sesion.local !== localPedido) {
    return res.status(403).json({ ok: false, error: '⛔ Este token no corresponde a ese local.' });
  }

  req.usuarioSesion = sesion;
  next();
}

// --- RATE LIMIT ANTI FUERZA BRUTA PARA LOGINS ---
// Máximo de intentos fallidos por IP dentro de la ventana; al superarlos, bloqueo temporal
const MAX_INTENTOS_LOGIN = 5;
const VENTANA_LOGIN_MS = 10 * 60 * 1000;   // ventana de 10 minutos
const BLOQUEO_LOGIN_MS = 10 * 60 * 1000;   // bloqueo de 10 minutos
const intentosFallidos = new Map(); // ip -> { intentos, primerIntento, bloqueadoHasta }

function obtenerIpCliente(req) {
  return (req.ip || req.socket?.remoteAddress || 'desconocida').toString();
}

// Limpia entradas viejas del Map para que no crezca indefinidamente
setInterval(() => {
  const ahora = Date.now();
  for (const [ip, r] of intentosFallidos) {
    if (ahora - r.primerIntento > VENTANA_LOGIN_MS && (!r.bloqueadoHasta || r.bloqueadoHasta < ahora)) {
      intentosFallidos.delete(ip);
    }
  }
}, VENTANA_LOGIN_MS).unref();

function limiteLogin(req, res, next) {
  const ip = obtenerIpCliente(req);
  const registro = intentosFallidos.get(ip);
  if (registro && registro.bloqueadoHasta > Date.now()) {
    const segundos = Math.ceil((registro.bloqueadoHasta - Date.now()) / 1000);
    return res.status(429).json({
      ok: false,
      error: `⛔ Demasiados intentos fallidos. Espera ${segundos} segundos e inténtalo de nuevo.`
    });
  }
  next();
}

function registrarFalloLogin(req) {
  const ip = obtenerIpCliente(req);
  const ahora = Date.now();
  let r = intentosFallidos.get(ip);
  if (!r || ahora - r.primerIntento > VENTANA_LOGIN_MS) {
    r = { intentos: 0, primerIntento: ahora, bloqueadoHasta: 0 };
  }
  r.intentos += 1;
  if (r.intentos >= MAX_INTENTOS_LOGIN) {
    r.bloqueadoHasta = ahora + BLOQUEO_LOGIN_MS;
  }
  intentosFallidos.set(ip, r);
}

function limpiarFallosLogin(req) {
  intentosFallidos.delete(obtenerIpCliente(req));
}

// --- RATE LIMIT GENERAL PARA ACCIONES PÚBLICAS FRECUENTES ---
const contadoresPeticiones = new Map(); // ip -> { count, ventanaInicio }

function limitePeticiones(maxPorVentana, ventanaMs = 60 * 1000) {
  const limpieza = setInterval(() => {
    const ahora = Date.now();
    for (const [ip, r] of contadoresPeticiones) {
      if (ahora - r.ventanaInicio > ventanaMs * 2) contadoresPeticiones.delete(ip);
    }
  }, 5 * 60 * 1000);
  limpieza.unref();

  return (req, res, next) => {
    const ip = obtenerIpCliente(req);
    const ahora = Date.now();
    let r = contadoresPeticiones.get(ip);
    if (!r || ahora - r.ventanaInicio > ventanaMs) {
      r = { count: 0, ventanaInicio: ahora };
    }
    r.count += 1;
    contadoresPeticiones.set(ip, r);

    if (r.count > maxPorVentana) {
      return res.status(429).json({
        ok: false,
        error: '⛔ Demasiadas peticiones seguidas. Espera un momento e inténtalo de nuevo.'
      });
    }
    next();
  };
}

// --- RUTAS DE LA API ---

// VERIFICAR ESTADO DE SESIÓN
app.post('/api/auth/verificar-sesion', (req, res) => {
  const { token, local } = req.body;
  if (!token || !sesionesActivas.has(token)) {
    return res.status(401).json({ ok: false, autenticado: false });
  }
  const sesion = sesionesActivas.get(token);
  if (sesion.tipo !== 'superadmin' && sesion.local !== (local || '').toLowerCase().trim()) {
    return res.status(403).json({ ok: false, autenticado: false, error: 'Acceso no autorizado para este local' });
  }
  res.json({ ok: true, autenticado: true, sesion });
});

// 1. LOGIN DE ADMINISTRADOR GENERAL
app.post('/api/admin/login', limiteLogin, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ ok: false, error: 'Debe ingresar una contraseña' });

    const configAdmin = await ConfigGlobal.findOne({ tipo: 'superadmin' });
    
    if (!configAdmin) {
      return res.status(500).json({ ok: false, error: 'Configuración de Administrador no encontrada' });
    }

    const almacenada = configAdmin.password;
    const coincide = esHashBcrypt(almacenada)
      ? await bcrypt.compare(password, almacenada)
      : password === almacenada;

    if (coincide) {
      // Migración automática: si estaba en texto plano, la convierte a hash
      if (!esHashBcrypt(almacenada)) {
        configAdmin.password = await bcrypt.hash(password, 10);
        await configAdmin.save();
      }

      limpiarFallosLogin(req);
      const token = crypto.randomBytes(32).toString('hex');
      sesionesActivas.set(token, { tipo: 'superadmin', fecha: new Date() });
      return res.json({ ok: true, mensaje: 'Acceso concedido como Administrador General', token });
    } else {
      registrarFalloLogin(req);
      return res.status(401).json({ ok: false, error: 'Contraseña incorrecta' });
    }
  } catch (error) {
    console.error("Error en login admin:", error);
    res.status(500).json({ ok: false, error: 'Error al consultar la base de datos' });
  }
});

// 2. VERIFICAR SI UN LOCAL EXISTE
app.get('/api/locales/verificar/:busqueda', async (req, res) => {
  try {
    const busquedaLimpia = req.params.busqueda.trim();
    const slugBusqueda = busquedaLimpia.toLowerCase().replace(/[^a-z0-9]/g, '');
    const regexBusqueda = new RegExp(`^${escapeRegex(busquedaLimpia)}$`, 'i');

    const reg = await Local.findOne({
      $or: [
        { local: busquedaLimpia },
        { local: slugBusqueda },
        { nombre: { $regex: regexBusqueda } }
      ]
    });

    if (reg) {
      return res.json({ existe: true, local: reg.local, nombre: reg.nombre });
    } else {
      return res.status(404).json({ existe: false, error: 'Local no encontrado' });
    }
  } catch (error) {
    console.error("Error al verificar local:", error);
    res.status(500).json({ existe: false, error: 'Error al verificar el local' });
  }
});

// 3. CONSULTAR LICENCIA Y ESTADO DE LOCAL
app.get('/api/licencia', async (req, res) => {
  try {
    const localId = (req.query.local || '').trim().toLowerCase();
    if (!localId) return res.status(400).json({ error: 'Parámetro local requerido' });

    const reg = await Local.findOne({ local: localId });
    if (!reg) {
      return res.json({ activo: true, nombre: localId, altaRegistrada: false, diasRestantes: 30 });
    }

    const ahoraServidor = new Date();
    let fechaVenc = reg.fechaVencimiento ? new Date(reg.fechaVencimiento) : new Date(ahoraServidor.getTime() + (30 * 24 * 60 * 60 * 1000));
    let estadoActivo = reg.activo;

    if (ahoraServidor >= fechaVenc) {
      estadoActivo = false;
      if (reg.activo !== false) {
        reg.activo = false;
        await reg.save();
      }
    }

    const diferenciaMs = fechaVenc.getTime() - ahoraServidor.getTime();
    const diasRestantes = Math.max(0, Math.ceil(diferenciaMs / (1000 * 60 * 60 * 24)));
    const esAltaOficial = Boolean(reg.rut && reg.rut !== 'DEMO-30DIAS' && reg.rut !== 'SIN-RUT');

    return res.json({
      activo: estadoActivo,
      nombre: reg.nombre,
      fechaCreacion: reg.fechaCreacion,
      fechaVencimiento: reg.fechaVencimiento,
      diasRestantes: diasRestantes,
      servidorAhora: ahoraServidor,
      anuncio: reg.anuncio || "ok",
      altaRegistrada: esAltaOficial
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar licencia' });
  }
});

// 4. OBTENER TODOS LOS LOCALES (ADMIN GENERAL)
app.get('/api/locales', requerirSuperAdmin, async (req, res) => {
  try {
    const locales = await Local.find().sort({ fechaCreacion: -1 });
    const localesFormateados = locales.map(l => ({
      _id: l._id,
      id: l.id,
      localId: l.local,
      local: l.local,
      nombre: l.nombre,
      rut: l.rut,
      correo: l.correo,
      activo: l.activo,
      anuncio: l.anuncio || "ok",
      fechaCreacion: l.fechaCreacion,
      fechaVencimiento: l.fechaVencimiento
    }));
    res.json(localesFormateados);
  } catch (error) {
    res.status(500).json({ error: 'Error interno en el servidor' });
  }
});

// CREAR/REGISTRAR DEMO
app.post('/api/locales/demo', requerirSuperAdmin, async (req, res) => {
  try {
    const { local, rut, correo, fechaCreacion, fechaVencimiento } = req.body;
    const nombreLimpio = limpiarTexto(nombre, 60);
    if (!nombreLimpio) return res.status(400).json({ error: 'El nombre es requerido' });

    const localSlug = (local || nombreLimpio).toLowerCase().replace(/[^a-z0-9]/g, '');
    let reg = await Local.findOne({ local: localSlug });

    const ahora = fechaCreacion ? new Date(fechaCreacion) : new Date();
    const venc = fechaVencimiento ? new Date(fechaVencimiento) : new Date(ahora.getTime() + (30 * 24 * 60 * 60 * 1000));

    if (reg) {
      reg.nombre = nombreLimpio;
      reg.activo = true;
      reg.fechaCreacion = ahora;
      reg.fechaVencimiento = venc;
      await reg.save();
    } else {
      reg = new Local({
        id: Date.now(),
        local: localSlug,
        nombre: nombreLimpio,
        rut: rut || 'DEMO-30DIAS',
        correo: correo || 'demo@appmenu.cl',
        password: await bcrypt.hash('123', 10),
        activo: true,
        fechaCreacion: ahora,
        fechaVencimiento: venc,
        menu: [],
        anuncio: "ok"
      });
      await reg.save();
    }

    const token = crypto.randomBytes(32).toString('hex');
    sesionesActivas.set(token, { tipo: 'local', local: reg.local, fecha: new Date() });

    res.status(201).json({ ok: true, local: reg, token });
  } catch (error) {
    console.error("Error al crear demo:", error);
    res.status(500).json({ error: 'Error al registrar demo' });
  }
});

// LOGIN LOCAL / VERIFICACIÓN DE CONTRASEÑA
// 5. BLOQUEAR / ACTIVAR UN LOCAL
app.put('/api/locales/estado', requerirSuperAdmin, async (req, res) => {
  try {
    const { local, activo } = req.body;
    const localId = (local || '').toLowerCase().trim();

    if (!localId || typeof activo !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'Local y estado requeridos' });
    }

    const reg = await Local.findOne({ local: localId });
    if (!reg) {
      return res.status(404).json({ ok: false, error: 'Local no encontrado' });
    }

    reg.activo = activo;
    await reg.save();

    res.json({ ok: true, mensaje: `Local ${localId} ${activo ? 'activado' : 'bloqueado'}` });
  } catch (error) {
    console.error("Error al cambiar estado del local:", error);
    res.status(500).json({ ok: false, error: 'Error al actualizar estado del local' });
  }
});

// 6. RENOVAR LICENCIA (+N DÍAS)
app.put('/api/locales/renovar', requerirSuperAdmin, async (req, res) => {
  try {
    const { local, dias } = req.body;
    const localId = (local || '').toLowerCase().trim();
    const diasNum = parseInt(dias, 10);

    if (!localId || !diasNum || diasNum <= 0) {
      return res.status(400).json({ ok: false, error: 'Local y cantidad de días requeridos' });
    }

    const reg = await Local.findOne({ local: localId });
    if (!reg) {
      return res.status(404).json({ ok: false, error: 'Local no encontrado' });
    }

    // Se suma desde la fecha de vencimiento si aún no vence; si ya venció, desde hoy
    const ahoraServidor = new Date();
    let base = reg.fechaVencimiento ? new Date(reg.fechaVencimiento) : new Date(ahoraServidor);
    if (base < ahoraServidor) base = new Date(ahoraServidor);
    base.setTime(base.getTime() + (diasNum * 24 * 60 * 60 * 1000));

    reg.fechaVencimiento = base.toISOString();
    // Renovar implica reactivar el acceso (estuviera bloqueado por vencimiento o manualmente)
    if (!reg.activo) reg.activo = true;
    await reg.save();

    res.json({ ok: true, mensaje: `Licencia de ${localId} renovada por ${diasNum} días`, fechaVencimiento: reg.fechaVencimiento });
  } catch (error) {
    console.error("Error al renovar licencia:", error);
    res.status(500).json({ ok: false, error: 'Error al renovar la licencia' });
  }
});

app.post('/api/locales/login', limiteLogin, async (req, res) => {
  try {
    const { local, password } = req.body;
    const localId = (local || '').toLowerCase().trim();

    if (!localId || !password) {
      return res.status(400).json({ ok: false, error: 'Local y contraseña requeridos' });
    }

    const reg = await Local.findOne({ local: localId });
    if (!reg) {
      return res.status(404).json({ ok: false, error: 'Local no encontrado' });
    }

    const almacenada = reg.password || '123';
    const coincide = esHashBcrypt(almacenada)
      ? await bcrypt.compare(password, almacenada)
      : password === almacenada;

    if (coincide) {
      // Migración automática de texto plano a hash en el primer login
      if (!esHashBcrypt(almacenada)) {
        reg.password = await bcrypt.hash(password, 10);
        await reg.save();
      }

      limpiarFallosLogin(req);
      const token = crypto.randomBytes(32).toString('hex');
      sesionesActivas.set(token, { tipo: 'local', local: reg.local, fecha: new Date() });
      return res.json({ ok: true, mensaje: 'Acceso autorizado', token, local: reg.local });
    } else {
      registrarFalloLogin(req);
      return res.status(401).json({ ok: false, error: 'Contraseña incorrecta' });
    }
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Error al validar contraseña del local' });
  }
});

// ALTA DE LOCAL (auto-registro público desde index.html)
app.post('/api/locales/alta', limiteLogin, async (req, res) => {
  try {
    const b = req.body || {};
    const nombre = limpiarTexto(b.nombre, 40);
    const rut = limpiarTexto(b.rut, 15);
    const correo = limpiarTexto(b.correo, 60);
    const password = typeof b.password === 'string' ? b.password.trim() : '';
    // La licencia la fija SIEMPRE el servidor: se ignora cualquier fecha enviada por el cliente
    const fechaVencimiento = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    if (!nombre || !rut || !correo || !password) {
      return res.status(400).json({ ok: false, error: 'Faltan datos obligatorios para registrar el local.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
      return res.status(400).json({ ok: false, error: 'El correo ingresado no es válido.' });
    }
    if (password.length < 4 || password.length > 40) {
      return res.status(400).json({ ok: false, error: 'La contraseña debe tener entre 4 y 40 caracteres.' });
    }

    const slug = nombre.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!slug) {
      return res.status(400).json({ ok: false, error: 'El nombre del local no es válido.' });
    }

    // Evitar duplicados (nombre, RUT y correo son identificadores únicos del sistema)
    const existenteNombre = await Local.findOne({ $or: [{ local: slug }, { nombre }] });
    if (existenteNombre) {
      return res.status(409).json({ ok: false, error: `El local "${nombre}" ya se encuentra registrado.` });
    }
    const existenteRut = await Local.findOne({ rut });
    if (existenteRut) {
      return res.status(409).json({ ok: false, error: 'Ese RUT ya tiene un local registrado.' });
    }
    const existenteCorreo = await Local.findOne({ correo: correo.toLowerCase() });
    if (existenteCorreo) {
      return res.status(409).json({ ok: false, error: 'Ya existe un local registrado con ese correo.' });
    }

    const nuevoLocal = new Local({
      id: Date.now(),
      local: slug,
      nombre,
      rut,
      correo: correo.toLowerCase(),
      password: await bcrypt.hash(password, 10),
      activo: true,
      fechaCreacion: new Date(),
      fechaVencimiento: fechaVencimiento.toISOString(),
      menu: [],
      anuncio: 'ok'
    });
    await nuevoLocal.save();

    // Correo de bienvenida (best-effort: si falla no bloquea el registro)
    await enviarCorreo(
      correo.toLowerCase(),
      '🎉 Bienvenido a AppMenu',
      `<h2>¡Hola ${escaparHtmlCorreo(nombre)}!</h2>
       <p>Tu local fue registrado con éxito en <b>AppMenu</b>.</p>
       <ul>
         <li><b>Nombre del local:</b> ${escaparHtmlCorreo(nombre)}</li>
         <li><b>ID de acceso:</b> ${slug}</li>
         <li><b>Licencia de prueba:</b> 30 días</li>
       </ul>
       <p>Inicia sesión con tu contraseña desde la página principal.</p>`
    );

    // Sesión automática para entrar directo al panel
    const token = crypto.randomBytes(32).toString('hex');
    sesionesActivas.set(token, { tipo: 'local', local: slug, fecha: new Date() });

    res.status(201).json({
      ok: true,
      mensaje: 'Local registrado con éxito',
      token,
      local: slug
    });
  } catch (error) {
    console.error('Error al dar de alta el local:', error);
    res.status(500).json({ ok: false, error: 'Error al registrar el local' });
  }
});

// RECUPERAR CONTRASEÑA DE LOCAL (envía enlace de un solo uso al correo registrado)
// Por seguridad la respuesta es SIEMPRE idéntica: no revela si el local existe
// ni muestra el correo del dueño (evita enumeración y phishing dirigido).
const MENSAJE_RECUPERACION = '📩 Si tu local está registrado, enviamos un enlace para establecer una nueva contraseña al correo vinculado. Revisa también tu carpeta de spam.';

app.post('/api/locales/recuperar-password', limiteLogin, async (req, res) => {
  try {
    const busqueda = limpiarTexto(req.body ? req.body.local : null, 60);
    if (!busqueda) {
      return res.status(400).json({ ok: false, error: 'Ingresa el nombre o ID de tu local.' });
    }

    const slugBusqueda = busqueda.toLowerCase().replace(/[^a-z0-9]/g, '');
    const regexBusqueda = new RegExp(`^${escapeRegex(busqueda)}$`, 'i');
    const reg = await Local.findOne({
      $or: [
        { local: busqueda },
        { local: slugBusqueda },
        { nombre: { $regex: regexBusqueda } }
      ]
    });

    if (reg && reg.correo) {
      // Token de un solo uso válido por 30 minutos (se guarda hasheado en Mongo)
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      await ResetPassword.deleteMany({ local: reg.local });
      await ResetPassword.create({
        local: reg.local,
        tokenHash,
        expira: new Date(Date.now() + 30 * 60 * 1000)
      });

      const enlace = `${FRONTEND_URL}/index.html?recuperar=${token}&local=${encodeURIComponent(reg.local)}`;

      await enviarCorreo(
        reg.correo,
        '🔑 AppMenu - Establecer nueva contraseña',
        `<h2>Hola ${escaparHtmlCorreo(reg.nombre || reg.local)}</h2>
         <p>Recibimos una solicitud para establecer una nueva contraseña de tu local <b>${escaparHtmlCorreo(reg.nombre || reg.local)}</b> en AppMenu.</p>
         <p style="margin:24px 0;">
           <a href="${enlace}" style="background:#00d2ff;color:#0a0e17;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">ESTABLECER NUEVA CONTRASEÑA</a>
         </p>
         <p>O copia este enlace en tu navegador:</p>
         <p style="word-break:break-all;font-size:12px;color:#555;">${enlace}</p>
         <p><b>El enlace es válido por 30 minutos y solo puede usarse una vez.</b></p>
         <p>Si no solicitaste este cambio, ignora este correo.</p>`
      );
    }

    res.json({ ok: true, mensaje: MENSAJE_RECUPERACION });
  } catch (error) {
    console.error('Error al recuperar contraseña:', error);
    res.status(500).json({ ok: false, error: 'Error al procesar la recuperación' });
  }
});

// ESTABLECER NUEVA CONTRASEÑA CON TOKEN DEL CORREO
app.post('/api/locales/reset-password', limiteLogin, async (req, res) => {
  try {
    const b = req.body || {};
    const localId = limpiarTexto(b.local, 60);
    const token = typeof b.token === 'string' ? b.token.trim() : '';
    const nuevaPassword = typeof b.nuevaPassword === 'string' ? b.nuevaPassword.trim() : '';

    if (!localId || !token || !nuevaPassword) {
      return res.status(400).json({ ok: false, error: 'Faltan datos para establecer la nueva contraseña.' });
    }
    if (nuevaPassword.length < 4 || nuevaPassword.length > 40) {
      return res.status(400).json({ ok: false, error: 'La contraseña debe tener entre 4 y 40 caracteres.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const reset = await ResetPassword.findOne({
      local: localId,
      tokenHash,
      expira: { $gt: new Date() }
    });

    if (!reset) {
      return res.status(400).json({ ok: false, error: '⛔ El enlace no es válido o ya expiró. Solicita uno nuevo desde "¿Olvidaste tu contraseña?".' });
    }

    const reg = await Local.findOne({ local: localId });
    if (!reg) {
      return res.status(404).json({ ok: false, error: 'Local no encontrado.' });
    }

    reg.password = await bcrypt.hash(nuevaPassword, 10);
    await reg.save();

    // El token es de un solo uso: se eliminan todos los pendientes del local
    await ResetPassword.deleteMany({ local: localId });

    console.log(`🔑 Contraseña actualizada vía enlace de recuperación: ${localId}`);
    res.json({ ok: true, mensaje: '✅ Contraseña actualizada con éxito. Ya puedes iniciar sesión con ella.' });
  } catch (error) {
    console.error('Error al establecer nueva contraseña:', error);
    res.status(500).json({ ok: false, error: 'Error al actualizar la contraseña' });
  }
});

// AVISOS
app.get('/api/avisos', async (req, res) => {
  try {
    const localId = (req.query.local || '').toLowerCase().trim();
    // Sin parámetro local (SuperAdmin) se devuelven todos; con local, los suyos + globales
    const filtro = localId
      ? { $or: [{ destinatario: 'todos' }, { destinatario: localId }] }
      : {};
    const avisos = await Aviso.find(filtro).sort({ fecha: -1 });

    res.json(avisos);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener avisos' });
  }
});

app.post('/api/avisos', requerirSuperAdmin, async (req, res) => {
  try {
    const { destinatario, asunto, texto } = req.body;
    const textoLimpio = limpiarTexto(texto, 500);

    if (!textoLimpio) {
      return res.status(400).json({ error: 'El texto del mensaje es requerido' });
    }

    const nuevoAviso = new Aviso({
      destinatario: (destinatario && destinatario.trim()) ? destinatario.toLowerCase().trim().slice(0, 40) : 'todos',
      asunto: limpiarTexto(asunto, 80) || 'Aviso del Sistema',
      texto: textoLimpio,
      fecha: new Date(),
      respuestas: []
    });

    await nuevoAviso.save();

    res.status(201).json({ ok: true, mensaje: 'Aviso publicado con éxito', aviso: nuevoAviso });
  } catch (error) {
    console.error("Error al publicar aviso:", error);
    res.status(500).json({ error: 'Error al publicar el aviso' });
  }
});

app.delete('/api/avisos/:id', requerirSuperAdmin, async (req, res) => {
  try {
    const eliminado = await Aviso.findByIdAndDelete(req.params.id);
    if (!eliminado) {
      return res.status(404).json({ error: 'Aviso no encontrado' });
    }

    res.json({ ok: true, mensaje: 'Aviso eliminado con éxito' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar el aviso' });
  }
});

app.post('/api/avisos/responder', async (req, res) => {
  try {
    const { local, avisoId, respuesta } = req.body;
    const respuestaLimpia = limpiarTexto(respuesta, 300);

    if (!local || !avisoId || !respuestaLimpia) {
      return res.status(400).json({ error: 'Faltan datos requeridos' });
    }

    const aviso = await Aviso.findById(avisoId);
    if (!aviso) return res.status(404).json({ error: 'Aviso no encontrado' });

    aviso.respuestas.push({
      local: String(local).toLowerCase().trim().slice(0, 40),
      texto: respuestaLimpia,
      fecha: new Date()
    });
    await aviso.save();

    res.json({ ok: true, mensaje: 'Respuesta guardada con éxito' });
  } catch (error) {
    res.status(500).json({ error: 'Error al responder el aviso' });
  }
});

// GESTIÓN DE MENÚ
app.get('/api/menu', async (req, res) => {
  try {
    const localId = (req.query.local || '').toLowerCase().trim();
    const reg = await Local.findOne({ local: localId });
    res.json(reg ? (reg.menu || []) : []);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener el menú' });
  }
});

app.post('/api/menu/categoria', requerirSesionLocal, async (req, res) => {
  try {
    const { local, categoria } = req.body;
    const localId = (local || '').toLowerCase().trim();

    const reg = await Local.findOne({ local: localId });
    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });

    if (!reg.menu) reg.menu = [];
    const existe = reg.menu.some(c => c.categoria.toLowerCase() === categoria.toLowerCase());

    if (!existe) {
      reg.menu.push({ categoria, productos: [] });
      await reg.save();
    }

    res.json({ ok: true, menu: reg.menu });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear la categoría' });
  }
});

app.delete('/api/menu/categoria', requerirSesionLocal, async (req, res) => {
  try {
    const localId = (req.query.local || '').toLowerCase().trim();
    const categoria = req.query.categoria;

    const reg = await Local.findOne({ local: localId });
    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });

    reg.menu = (reg.menu || []).filter(c => c.categoria !== categoria);
    await reg.save();

    res.json({ ok: true, menu: reg.menu });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar la categoría' });
  }
});

app.post('/api/menu', requerirSesionLocal, async (req, res) => {
  try {
    const { local, categoria, nombre, precio } = req.body;
    const localId = (local || '').toLowerCase().trim();

    const reg = await Local.findOne({ local: localId });
    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });

    const catObj = (reg.menu || []).find(c => c.categoria === categoria);
    if (catObj) {
      if (!catObj.productos) catObj.productos = [];
      catObj.productos.push({ nombre: limpiarTexto(nombre, 60) || 'Producto', precio: Number(precio) });
      reg.markModified('menu');
      await reg.save();
    }

    res.json({ ok: true, menu: reg.menu });
  } catch (error) {
    res.status(500).json({ error: 'Error al agregar producto' });
  }
});

app.delete('/api/menu/del', requerirSesionLocal, async (req, res) => {
  try {
    const localId = (req.query.local || '').toLowerCase().trim();
    const categoria = req.query.categoria;
    const index = parseInt(req.query.index);

    const reg = await Local.findOne({ local: localId });
    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });

    const catObj = (reg.menu || []).find(c => c.categoria === categoria);
    if (catObj && catObj.productos && catObj.productos[index] !== undefined) {
      catObj.productos.splice(index, 1);
      reg.markModified('menu');
      await reg.save();
    }

    res.json({ ok: true, menu: reg.menu });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

app.put('/api/menu/edit', requerirSesionLocal, async (req, res) => {
  try {
    const { local, categoriaOriginal, indexOriginal, nuevoNombre, nuevoPrecio } = req.body;
    const localId = (local || '').toLowerCase().trim();

    const reg = await Local.findOne({ local: localId });
    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });

    const catObj = (reg.menu || []).find(c => c.categoria === categoriaOriginal);
    if (catObj && catObj.productos && catObj.productos[indexOriginal] !== undefined) {
      catObj.productos[indexOriginal] = {
        nombre: limpiarTexto(nuevoNombre, 60) || 'Producto',
        precio: Number(nuevoPrecio)
      };
      reg.markModified('menu');
      await reg.save();
    }

    res.json({ ok: true, menu: reg.menu });
  } catch (error) {
    res.status(500).json({ error: 'Error al editar producto' });
  }
});

// GESTIÓN DE PEDIDOS
app.get('/api/pedidos', async (req, res) => {
  try {
    const localId = (req.query.local || '').toLowerCase().trim();
    const pedidos = await Pedido.find({ local: localId }).sort({ createdAt: 1 });
    res.json(pedidos);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar pedidos' });
  }
});

// NUEVO PEDIDO (rate limit: evita inundación de pedidos falsos desde una misma IP)
app.post('/api/pedidos', limitePeticiones(8), async (req, res) => {
  try {
    const { local, mesa, nombreCliente, items, total } = req.body;
    const localId = (local || '').toLowerCase().trim();

    const nuevoPedido = new Pedido({
      local: localId,
      mesa: limpiarTexto(mesa, 10) || 'GENERAL',
      nombreCliente: limpiarTexto(nombreCliente, 40),
      items: limpiarItems(items),
      total: Math.max(0, Number(total) || 0),
      pagado: false,
      prioridadPriorizada: 0
    });

    await nuevoPedido.save();
    res.status(201).json({ ok: true, pedido: nuevoPedido });
  } catch (error) {
    res.status(500).json({ error: 'Error al registrar pedido' });
  }
});

// MARCAR PEDIDO COMO PAGADO Y PRIORIZAR (requiere caja abierta por el RUT que cobra)
app.put('/api/pedidos/:id/pagar', async (req, res) => {
  try {
    const pedido = await Pedido.findById(req.params.id);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

    const rutCajera = req.body ? req.body.rutCajera : null;

    let cajaActiva = null;

    if (rutCajera) {
      cajaActiva = await Caja.findOne({
        local: pedido.local,
        abierto: true,
        rutCajera: String(rutCajera).trim()
      });

      if (!cajaActiva) {
        return res.status(403).json({ ok: false, error: '⛔ No tienes ninguna caja abierta con ese RUT. Debes abrir tu caja antes de cobrar.' });
      }
    }

    // Actualización atómica solo si aún no está pagado (protege contra doble clic)
    const cambios = { pagado: true, prioridadPriorizada: Date.now() };
    if (cajaActiva) {
      cambios.rutCajeroPago = String(rutCajera).trim();
      cambios.numeroCajaPago = cajaActiva.numero;
    }

    const actualizado = await Pedido.findOneAndUpdate(
      { _id: req.params.id, pagado: false },
      { $set: cambios },
      { new: true }
    );

    if (!actualizado) {
      const existente = await Pedido.findById(req.params.id);
      if (!existente) return res.status(404).json({ error: 'Pedido no encontrado' });
      // Ya estaba pagado (reintento de red): respuesta idempotente
      return res.json({ ok: true, pedido: existente });
    }

    res.json({ ok: true, pedido: actualizado });
  } catch (error) {
    res.status(500).json({ error: 'Error al marcar pago' });
  }
});

app.put('/api/pedidos/:id/asignar-garzon', async (req, res) => {
  try {
    const { rutGarzon } = req.body;

    // Actualización atómica: solo gana el primer garzón que llegue
    const pedido = await Pedido.findOneAndUpdate(
      { _id: req.params.id, $or: [{ rutGarzon: null }, { rutGarzon: '' }, { rutGarzon: rutGarzon }] },
      { rutGarzon },
      { new: true }
    );

    if (!pedido) {
      const existente = await Pedido.findById(req.params.id);
      if (!existente) return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });
      return res.status(409).json({ ok: false, error: `El pedido ya se encuentra atendido por otro garzón (${existente.rutGarzon}).` });
    }

    res.json({ ok: true, pedido });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Error al asignar garzón' });
  }
});

app.delete('/api/pedidos/:id', async (req, res) => {
  try {
    // Solo se permite borrar pedidos del local que lo solicita (evita borrados cruzados)
    const localPedido = (req.query.local || '').toLowerCase().trim();
    if (!localPedido) {
      return res.status(400).json({ ok: false, error: 'Parámetro local requerido' });
    }

    const pedido = await Pedido.findById(req.params.id);
    if (!pedido) {
      return res.json({ ok: true });
    }

    if (pedido.local !== localPedido) {
      return res.status(403).json({ ok: false, error: '⛔ Este pedido no pertenece a ese local.' });
    }

    await Pedido.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar pedido' });
  }
});

// CAJAS (SESIONES DE CAJERA - MÁXIMO 5 POR LOCAL)
app.get('/api/cajas', async (req, res) => {
  try {
    const localId = (req.query.local || '').toLowerCase().trim();
    if (!localId) return res.status(400).json({ error: 'Parámetro local requerido' });

    let lista = await Caja.find({ local: localId }).sort({ numero: 1 });

    // Auto-inicializar las 5 cajas del local la primera vez
    const faltantes = [];
    for (let n = 1; n <= 5; n++) {
      if (!lista.some(c => c.numero === n)) faltantes.push({ local: localId, numero: n });
    }
    if (faltantes.length > 0) {
      await Caja.insertMany(faltantes);
      lista = await Caja.find({ local: localId }).sort({ numero: 1 });
    }

    res.json(lista.slice(0, 5));
  } catch (error) {
    console.error("Error al consultar cajas:", error);
    res.status(500).json({ error: 'Error al consultar cajas' });
  }
});

// ABRIR CAJA (bloqueo por RUT, igual que Control Garzón)
app.post('/api/cajas/abrir', async (req, res) => {
  try {
    const { local, numero, rut } = req.body;
    const localId = (local || '').toLowerCase().trim();
    const num = Number(numero);

    if (!localId || !num || num < 1 || num > 5 || !rut || !rut.trim()) {
      return res.status(400).json({ ok: false, error: 'Datos incompletos para abrir la caja (local, número 1-5 y RUT del cajero/a).' });
    }

    const rutLimpio = rut.trim();

    // Un mismo RUT no puede tener dos cajas abiertas a la vez
    const yaAbiertaPorRut = await Caja.findOne({ local: localId, abierto: true, rutCajera: rutLimpio });
    if (yaAbiertaPorRut && yaAbiertaPorRut.numero !== num) {
      return res.status(409).json({ ok: false, error: `⛔ Ya tienes la Caja N° ${yaAbiertaPorRut.numero} abierta con este RUT. Ciérrala antes de abrir otra.` });
    }

    // Reclamo atómico: solo gana quien encuentre la caja libre o abierta por su mismo RUT
    const cambiosApertura = { abierto: true, rutCajera: rutLimpio, horaApertura: new Date(), horaCierre: null };
    const filtroLibre = { local: localId, numero: num, $or: [{ abierto: false }, { abierto: true, rutCajera: rutLimpio }] };

    let caja = await Caja.findOneAndUpdate(filtroLibre, { $set: cambiosApertura }, { new: true });

    if (!caja) {
      const existente = await Caja.findOne({ local: localId, numero: num });

      if (existente) {
        return res.status(409).json({ ok: false, error: `⛔ IMPOSIBLE ABRIR: La Caja N° ${num} está abierta por otro RUT (${existente.rutCajera}).` });
      }

      // No existía: crearla (si otra petición la creó a la vez, el índice único lo evita y se reintenta)
      try {
        await Caja.create({ local: localId, numero: num });
      } catch (e) {
        // Carrera de creación: continuar con el reintento del reclamo
      }
      caja = await Caja.findOneAndUpdate(filtroLibre, { $set: cambiosApertura }, { new: true });

      if (!caja) {
        return res.status(409).json({ ok: false, error: `⛔ IMPOSIBLE ABRIR: La Caja N° ${num} está abierta por otro RUT.` });
      }
    }

    res.json({ ok: true, caja });
  } catch (error) {
    console.error("Error al abrir caja:", error);
    res.status(500).json({ ok: false, error: 'Error al abrir la caja' });
  }
});

// CERRAR CAJA (solo el RUT que la abrió)
app.post('/api/cajas/cerrar', async (req, res) => {
  try {
    const { local, numero, rut } = req.body;
    const localId = (local || '').toLowerCase().trim();
    const num = Number(numero);

    if (!localId || !num || !rut || !rut.trim()) {
      return res.status(400).json({ ok: false, error: 'Datos incompletos para cerrar la caja (local, número y RUT del cajero/a).' });
    }

    const rutLimpio = rut.trim();

    // Cierre atómico: solo el titular puede cerrar y solo si sigue abierta
    const caja = await Caja.findOneAndUpdate(
      { local: localId, numero: num, abierto: true, $or: [{ rutCajera: rutLimpio }, { rutCajera: null }] },
      { $set: { abierto: false, rutCajera: null, horaCierre: new Date() } },
      { new: true }
    );

    if (!caja) {
      const existente = await Caja.findOne({ local: localId, numero: num });
      if (!existente) return res.status(404).json({ ok: false, error: 'Caja no encontrada' });
      if (!existente.abierto) return res.status(400).json({ ok: false, error: 'La caja ya se encuentra cerrada.' });
      return res.status(409).json({ ok: false, error: `⛔ SOLO EL TITULAR: La Caja N° ${num} la abrió el RUT ${existente.rutCajera}. Solo ese RUT puede cerrarla.` });
    }

    res.json({ ok: true, caja });
  } catch (error) {
    console.error("Error al cerrar caja:", error);
    res.status(500).json({ ok: false, error: 'Error al cerrar la caja' });
  }
});

// HISTORIAL
app.get('/api/historials', async (req, res) => {
  try {
    const localId = (req.query.local || '').toLowerCase().trim();
    const historial = await Historial.find({ local: localId }).sort({ createdAt: -1 });
    res.json(historial);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar historial' });
  }
});

app.post('/api/historials', async (req, res) => {
  try {
    const b = req.body || {};
    const registro = new Historial({
      id: typeof b.id === 'string' ? b.id.slice(0, 60) : undefined,
      local: (b.local || '').toLowerCase().trim(),
      mesa: limpiarTexto(b.mesa, 10),
      nombreCliente: limpiarTexto(b.nombreCliente, 40),
      items: limpiarItems(b.items),
      total: Math.max(0, Number(b.total) || 0),
      estado: 'entregado',
      hora: limpiarTexto(b.hora, 15),
      rutGarzon: limpiarTexto(b.rutGarzon, 15),
      horaEntrega: limpiarTexto(b.horaEntrega, 15),
      fechaEntrega: limpiarTexto(b.fechaEntrega, 12)
    });
    await registro.save();
    res.status(201).json({ ok: true, registro });
  } catch (error) {
    res.status(500).json({ error: 'Error al registrar historial' });
  }
});

// PUERTO Y ARRANQUE DEL SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`);
});