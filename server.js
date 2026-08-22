const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Brevo = require('@getbrevo/brevo');
const crypto = require('crypto');

const app = express();

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
    
    // --- AUTO-INICIALIZAR CONTRASEÑA ADMIN EN MONGO DB ---
    try {
      const configExistente = await ConfigGlobal.findOne({ tipo: 'superadmin' });
      if (!configExistente) {
        await ConfigGlobal.create({
          tipo: 'superadmin',
          password: '@Juan20737373'
        });
        console.log('🔑 Credencial SuperAdmin creada con éxito en MongoDB.');
      } else if (configExistente.password !== '@Juan20737373') {
        configExistente.password = '@Juan20737373';
        await configExistente.save();
        console.log('🔑 Credencial SuperAdmin actualizada en MongoDB.');
      }
    } catch (err) {
      console.error('🔴 Error al inicializar credencial en MongoDB:', err);
    }
  })
  .catch((err) => console.error('🔴 Error de conexión a MongoDB:', err));

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
  fecha: { type: Date, default: Date.now }
}, { collection: 'pedidos', timestamps: true });

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

const Historial = mongoose.model('Historial', historialSchema);

const cajaSchema = new mongoose.Schema({
  local: { type: String, required: true },
  numero: { type: Number, required: true },
  rutCajera: { type: String, default: null },
  abierto: { type: Boolean, default: false },
  horaApertura: { type: Date, default: null },
  horaCierre: { type: Date, default: null }
}, { collection: 'cajas', timestamps: true });

const Caja = mongoose.model('Caja', cajaSchema);

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

// Helper para validar token de sesión
function verificarAutenticacion(req, res, next) {
  const token = req.headers['authorization'];
  if (!token || !sesionesActivas.has(token)) {
    return res.status(401).json({ ok: false, error: 'Sesión no válida o expirada' });
  }
  req.usuarioSesion = sesionesActivas.get(token);
  next();
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
app.post('/api/admin/login', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ ok: false, error: 'Debe ingresar una contraseña' });

    const configAdmin = await ConfigGlobal.findOne({ tipo: 'superadmin' });
    
    if (!configAdmin) {
      return res.status(500).json({ ok: false, error: 'Configuración de Administrador no encontrada' });
    }

    if (password === configAdmin.password) {
      const token = crypto.randomBytes(32).toString('hex');
      sesionesActivas.set(token, { tipo: 'superadmin', fecha: new Date() });
      return res.json({ ok: true, mensaje: 'Acceso concedido como Administrador General', token });
    } else {
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
app.get('/api/locales', async (req, res) => {
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
app.post('/api/locales/demo', async (req, res) => {
  try {
    const { local, nombre, rut, correo, fechaCreacion, fechaVencimiento } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es requerido' });

    const localSlug = (local || nombre).toLowerCase().replace(/[^a-z0-9]/g, '');
    let reg = await Local.findOne({ local: localSlug });

    const ahora = fechaCreacion ? new Date(fechaCreacion) : new Date();
    const venc = fechaVencimiento ? new Date(fechaVencimiento) : new Date(ahora.getTime() + (30 * 24 * 60 * 60 * 1000));

    if (reg) {
      reg.nombre = nombre;
      reg.activo = true;
      reg.fechaCreacion = ahora;
      reg.fechaVencimiento = venc;
      await reg.save();
    } else {
      reg = new Local({
        id: Date.now(),
        local: localSlug,
        nombre: nombre.trim(),
        rut: rut || 'DEMO-30DIAS',
        correo: correo || 'demo@appmenu.cl',
        password: '123',
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
app.post('/api/locales/login', async (req, res) => {
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

    const passwordValida = reg.password || '123';
    if (password === passwordValida) {
      const token = crypto.randomBytes(32).toString('hex');
      sesionesActivas.set(token, { tipo: 'local', local: reg.local, fecha: new Date() });
      return res.json({ ok: true, mensaje: 'Acceso autorizado', token, local: reg.local });
    } else {
      return res.status(401).json({ ok: false, error: 'Contraseña incorrecta' });
    }
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Error al validar contraseña del local' });
  }
});

// AVISOS
app.get('/api/avisos', async (req, res) => {
  try {
    const localId = (req.query.local || '').toLowerCase().trim();
    const avisos = await Aviso.find({
      $or: [{ destinatario: 'todos' }, { destinatario: localId }]
    }).sort({ fecha: -1 });

    res.json(avisos);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener avisos' });
  }
});

app.post('/api/avisos/responder', async (req, res) => {
  try {
    const { local, avisoId, respuesta } = req.body;
    if (!local || !avisoId || !respuesta) {
      return res.status(400).json({ error: 'Faltan datos requeridos' });
    }

    const aviso = await Aviso.findById(avisoId);
    if (!aviso) return res.status(404).json({ error: 'Aviso no encontrado' });

    aviso.respuestas.push({ local, texto: respuesta, fecha: new Date() });
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

app.post('/api/menu/categoria', async (req, res) => {
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

app.delete('/api/menu/categoria', async (req, res) => {
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

app.post('/api/menu', async (req, res) => {
  try {
    const { local, categoria, nombre, precio } = req.body;
    const localId = (local || '').toLowerCase().trim();

    const reg = await Local.findOne({ local: localId });
    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });

    const catObj = (reg.menu || []).find(c => c.categoria === categoria);
    if (catObj) {
      if (!catObj.productos) catObj.productos = [];
      catObj.productos.push({ nombre, precio: Number(precio) });
      reg.markModified('menu');
      await reg.save();
    }

    res.json({ ok: true, menu: reg.menu });
  } catch (error) {
    res.status(500).json({ error: 'Error al agregar producto' });
  }
});

app.delete('/api/menu/del', async (req, res) => {
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

app.put('/api/menu/edit', async (req, res) => {
  try {
    const { local, categoriaOriginal, indexOriginal, nuevoNombre, nuevoPrecio } = req.body;
    const localId = (local || '').toLowerCase().trim();

    const reg = await Local.findOne({ local: localId });
    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });

    const catObj = (reg.menu || []).find(c => c.categoria === categoriaOriginal);
    if (catObj && catObj.productos && catObj.productos[indexOriginal] !== undefined) {
      catObj.productos[indexOriginal] = {
        nombre: nuevoNombre,
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

app.post('/api/pedidos', async (req, res) => {
  try {
    const { local, mesa, nombreCliente, items, total } = req.body;
    const localId = (local || '').toLowerCase().trim();

    const nuevoPedido = new Pedido({
      local: localId,
      mesa: mesa || 'GENERAL',
      nombreCliente: nombreCliente || null,
      items: items || [],
      total: Number(total) || 0,
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

    if (rutCajera) {
      const cajaActiva = await Caja.findOne({
        local: pedido.local,
        abierto: true,
        rutCajera: String(rutCajera).trim()
      });

      if (!cajaActiva) {
        return res.status(403).json({ ok: false, error: '⛔ No tienes ninguna caja abierta con ese RUT. Debes abrir tu caja antes de cobrar.' });
      }
    }

    pedido.pagado = true;
    pedido.prioridadPriorizada = Date.now();
    await pedido.save();

    res.json({ ok: true, pedido });
  } catch (error) {
    res.status(500).json({ error: 'Error al marcar pago' });
  }
});

app.put('/api/pedidos/:id/asignar-garzon', async (req, res) => {
  try {
    const { rutGarzon } = req.body;
    const pedido = await Pedido.findById(req.params.id);

    if (!pedido) return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });

    if (pedido.rutGarzon && pedido.rutGarzon !== rutGarzon) {
      return res.status(409).json({ ok: false, error: 'El pedido ya se encuentra atendido por otro garzón.' });
    }

    pedido.rutGarzon = rutGarzon;
    await pedido.save();

    res.json({ ok: true, pedido });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Error al asignar garzón' });
  }
});

app.delete('/api/pedidos/:id', async (req, res) => {
  try {
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

    let caja = await Caja.findOne({ local: localId, numero: num });
    if (!caja) caja = await Caja.create({ local: localId, numero: num });

    if (caja.abierto && caja.rutCajera && caja.rutCajera !== rutLimpio) {
      return res.status(409).json({ ok: false, error: `⛔ IMPOSIBLE ABRIR: La Caja N° ${num} está abierta por otro RUT (${caja.rutCajera}).` });
    }

    caja.abierto = true;
    caja.rutCajera = rutLimpio;
    caja.horaApertura = new Date();
    caja.horaCierre = null;
    await caja.save();

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
    const caja = await Caja.findOne({ local: localId, numero: num });

    if (!caja) return res.status(404).json({ ok: false, error: 'Caja no encontrada' });

    if (!caja.abierto) {
      return res.status(400).json({ ok: false, error: 'La caja ya se encuentra cerrada.' });
    }

    if (caja.rutCajera && caja.rutCajera !== rutLimpio) {
      return res.status(409).json({ ok: false, error: `⛔ SOLO EL TITULAR: La Caja N° ${num} la abrió el RUT ${caja.rutCajera}. Solo ese RUT puede cerrarla.` });
    }

    caja.abierto = false;
    caja.rutCajera = null;
    caja.horaCierre = new Date();
    await caja.save();

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
    const registro = new Historial(req.body);
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