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
  nombreCliente: { type: String, default: null }, // Para cliente general sin mesa
  items: Array,
  total: { type: Number, default: 0 },
  estado: { type: String, default: 'pendiente' },
  rutGarzon: { type: String, default: null },
  pagado: { type: Boolean, default: false }, // Estado de Pago en Caja
  prioridadOrden: { type: Number, default: 0 }, // Timestamp para ordenar fila virtual
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
      fechaCreacion: l.fechaCreacion,
      fechaVencimiento: l.fechaVencimiento,
      anuncio: l.anuncio || "ok"
    }));
    res.json(localesFormateados);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener locales' });
  }
});

// 5. GESTIÓN DE MENÚ POR LOCAL
app.get('/api/menu', async (req, res) => {
  try {
    const localId = (req.query.local || '').trim().toLowerCase();
    if (!localId) return res.status(400).json({ error: 'Parámetro local requerido' });

    const reg = await Local.findOne({ local: localId });
    if (!reg) return res.json([]);

    res.json(reg.menu || []);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener menú' });
  }
});

app.post('/api/menu/categoria', async (req, res) => {
  try {
    const { local, categoria } = req.body;
    if (!local || !categoria) return res.status(400).json({ error: 'Datos incompletos' });

    const localId = local.trim().toLowerCase();
    const reg = await Local.findOne({ local: localId });

    if (!reg) {
      const nuevoLocal = new Local({
        local: localId,
        nombre: localId.toUpperCase(),
        menu: [{ categoria, productos: [] }]
      });
      await nuevoLocal.save();
    } else {
      reg.menu = reg.menu || [];
      const existe = reg.menu.find(c => c.categoria.toLowerCase() === categoria.toLowerCase());
      if (!existe) {
        reg.menu.push({ categoria, productos: [] });
        await reg.save();
      }
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear categoría' });
  }
});

app.delete('/api/menu/categoria', async (req, res) => {
  try {
    const localId = (req.query.local || '').trim().toLowerCase();
    const categoria = req.query.categoria;

    if (!localId || !categoria) return res.status(400).json({ error: 'Datos incompletos' });

    const reg = await Local.findOne({ local: localId });
    if (reg) {
      reg.menu = (reg.menu || []).filter(c => c.categoria !== categoria);
      await reg.save();
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar categoría' });
  }
});

app.post('/api/menu', async (req, res) => {
  try {
    const { local, categoria, nombre, precio } = req.body;
    if (!local || !categoria || !nombre || precio === undefined) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    const localId = local.trim().toLowerCase();
    const reg = await Local.findOne({ local: localId });

    if (reg) {
      reg.menu = reg.menu || [];
      const catObj = reg.menu.find(c => c.categoria === categoria);

      if (catObj) {
        catObj.productos = catObj.productos || [];
        catObj.productos.push({ nombre, precio: Number(precio) });
        await reg.save();
      }
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al agregar producto' });
  }
});

app.delete('/api/menu/del', async (req, res) => {
  try {
    const localId = (req.query.local || '').trim().toLowerCase();
    const categoria = req.query.categoria;
    const index = parseInt(req.query.index);

    const reg = await Local.findOne({ local: localId });
    if (reg) {
      const catObj = (reg.menu || []).find(c => c.categoria === categoria);
      if (catObj && catObj.productos && catObj.productos[index] !== undefined) {
        catObj.productos.splice(index, 1);
        await reg.save();
      }
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

app.put('/api/menu/edit', async (req, res) => {
  try {
    const { local, categoriaOriginal, indexOriginal, nuevoNombre, nuevoPrecio } = req.body;
    const localId = (local || '').trim().toLowerCase();

    const reg = await Local.findOne({ local: localId });
    if (reg) {
      const catObj = (reg.menu || []).find(c => c.categoria === categoriaOriginal);
      if (catObj && catObj.productos && catObj.productos[indexOriginal]) {
        catObj.productos[indexOriginal].nombre = nuevoNombre;
        catObj.productos[indexOriginal].precio = Number(nuevoPrecio);
        await reg.save();
      }
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al editar producto' });
  }
});

// 6. GESTIÓN DE PEDIDOS Y CAJA
app.get('/api/pedidos', async (req, res) => {
  try {
    const localId = (req.query.local || '').trim().toLowerCase();
    if (!localId) return res.status(400).json({ error: 'Parámetro local requerido' });

    const pedidos = await Pedido.find({ local: localId }).sort({ createdAt: 1 });
    res.json(pedidos);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar pedidos' });
  }
});

app.post('/api/pedidos', async (req, res) => {
  try {
    const { local, mesa, nombreCliente, items, total } = req.body;
    if (!local || !mesa || !items || items.length === 0) {
      return res.status(400).json({ error: 'Datos de pedido incompletos' });
    }

    const nuevoPedido = new Pedido({
      local: local.trim().toLowerCase(),
      mesa: String(mesa),
      nombreCliente: nombreCliente || null,
      items,
      total: Number(total) || 0,
      pagado: false,
      prioridadOrden: 0
    });

    await nuevoPedido.save();
    res.json({ ok: true, pedido: nuevoPedido });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear pedido' });
  }
});

// RUTA CAJA: MARCAR PEDIDO COMO PAGADO Y PRIORIZAR
app.put('/api/pedidos/:id/marcar-pagado', async (req, res) => {
  try {
    const pedido = await Pedido.findById(req.params.id);
    if (!pedido) {
      return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });
    }

    pedido.pagado = true;
    pedido.prioridadOrden = Date.now(); // Marca temporal de prioridad en la fila virtual
    await pedido.save();

    res.json({ ok: true, mensaje: 'Pedido marcado como pagado y priorizado' });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Error al actualizar pago en caja' });
  }
});

app.put('/api/pedidos/:id/asignar-garzon', async (req, res) => {
  try {
    const { rutGarzon } = req.body;
    if (!rutGarzon) return res.status(400).json({ ok: false, error: 'RUT de garzón requerido' });

    const pedido = await Pedido.findById(req.params.id);
    if (!pedido) return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });

    if (pedido.rutGarzon && pedido.rutGarzon !== rutGarzon) {
      return res.status(409).json({ ok: false, error: 'El pedido ya fue asignado a otro garzón.' });
    }

    pedido.rutGarzon = rutGarzon;
    await pedido.save();

    res.json({ ok: true, mensaje: 'Pedido asignado correctamente' });
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

// 7. GESTIÓN DE HISTORIAL Y MÉTRICAS
app.get('/api/historials', async (req, res) => {
  try {
    const localId = (req.query.local || '').trim().toLowerCase();
    if (!localId) return res.status(400).json({ error: 'Parámetro local requerido' });

    const registros = await Historial.find({ local: localId }).sort({ createdAt: -1 });
    res.json(registros);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar historial' });
  }
});

app.post('/api/historials', async (req, res) => {
  try {
    const nuevoRegistro = new Historial(req.body);
    await nuevoRegistro.save();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar registro en historial' });
  }
});

// 8. GESTIÓN DE AVISOS Y MENSAJES DEL SISTEMA
app.get('/api/avisos', async (req, res) => {
  try {
    const localId = (req.query.local || '').trim().toLowerCase();
    const avisos = await Aviso.find({
      $or: [{ destinatario: 'todos' }, { destinatario: localId }]
    }).sort({ fecha: -1 });

    res.json(avisos);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar avisos' });
  }
});

app.post('/api/avisos/responder', async (req, res) => {
  try {
    const { local, avisoId, respuesta } = req.body;
    const aviso = await Aviso.findById(avisoId);

    if (aviso) {
      aviso.respuestas = aviso.respuestas || [];
      aviso.respuestas.push({
        local: (local || '').trim().toLowerCase(),
        texto: respuesta,
        fecha: new Date()
      });
      await aviso.save();
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al registrar respuesta de aviso' });
  }
});

// INICIAR SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor backend escuchando en puerto ${PORT}`);
});