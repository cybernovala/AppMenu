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

// SE AÑADE EL CAMPO nombreCliente A LOS PEDIDOS
const pedidoSchema = new mongoose.Schema({
  local: { type: String, required: true },
  mesa: { type: String, required: true },
  nombreCliente: { type: String, default: null },
  items: Array,
  total: { type: Number, default: 0 },
  estado: { type: String, default: 'pendiente' },
  rutGarzon: { type: String, default: null },
  fecha: { type: Date, default: Date.now }
}, { collection: 'pedidos', timestamps: true });

const Pedido = mongoose.model('Pedido', pedidoSchema);

// SE AÑADE EL CAMPO nombreCliente AL HISTORIAL
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

// OBTENER MENÚ
app.get('/api/menu', async (req, res) => {
  try {
    const localId = (req.query.local || '').trim().toLowerCase();
    const reg = await Local.findOne({ local: localId });
    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });
    res.json(reg.menu || []);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener menú' });
  }
});

// GUARDAR / AGREGAR PRODUCTO AL MENÚ
app.post('/api/menu', async (req, res) => {
  try {
    const { local, categoria, nombre, precio } = req.body;
    const localId = (local || '').toLowerCase().trim();
    const reg = await Local.findOne({ local: localId });

    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });

    let menu = reg.menu || [];
    let catObj = menu.find(c => c.categoria === categoria);

    if (catObj) {
      if (!catObj.productos) catObj.productos = [];
      catObj.productos.push({ nombre, precio: Number(precio) });
    } else {
      menu.push({
        categoria,
        productos: [{ nombre, precio: Number(precio) }]
      });
    }

    reg.menu = menu;
    reg.markModified('menu');
    await reg.save();

    res.json({ ok: true, menu: reg.menu });
  } catch (error) {
    res.status(500).json({ error: 'Error al agregar producto' });
  }
});

// CREAR CATEGORÍA
app.post('/api/menu/categoria', async (req, res) => {
  try {
    const { local, categoria } = req.body;
    const localId = (local || '').toLowerCase().trim();
    const reg = await Local.findOne({ local: localId });

    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });

    let menu = reg.menu || [];
    if (!menu.find(c => c.categoria === categoria)) {
      menu.push({ categoria, productos: [] });
      reg.menu = menu;
      reg.markModified('menu');
      await reg.save();
    }

    res.json({ ok: true, menu: reg.menu });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear categoría' });
  }
});

// ELIMINAR CATEGORÍA
app.delete('/api/menu/categoria', async (req, res) => {
  try {
    const localId = (req.query.local || '').toLowerCase().trim();
    const categoria = req.query.categoria;
    const reg = await Local.findOne({ local: localId });

    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });

    reg.menu = (reg.menu || []).filter(c => c.categoria !== categoria);
    reg.markModified('menu');
    await reg.save();

    res.json({ ok: true, menu: reg.menu });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar categoría' });
  }
});

// ELIMINAR PRODUCTO
app.delete('/api/menu/del', async (req, res) => {
  try {
    const localId = (req.query.local || '').toLowerCase().trim();
    const categoria = req.query.categoria;
    const index = parseInt(req.query.index);

    const reg = await Local.findOne({ local: localId });
    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });

    let catObj = (reg.menu || []).find(c => c.categoria === categoria);
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

// EDITAR PRODUCTO
app.put('/api/menu/edit', async (req, res) => {
  try {
    const { local, categoriaOriginal, indexOriginal, nuevoNombre, nuevoPrecio } = req.body;
    const localId = (local || '').toLowerCase().trim();

    const reg = await Local.findOne({ local: localId });
    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });

    let catObj = (reg.menu || []).find(c => c.categoria === categoriaOriginal);
    if (catObj && catObj.productos && catObj.productos[indexOriginal]) {
      catObj.productos[indexOriginal].nombre = nuevoNombre;
      catObj.productos[indexOriginal].precio = Number(nuevoPrecio);
      reg.markModified('menu');
      await reg.save();
    }

    res.json({ ok: true, menu: reg.menu });
  } catch (error) {
    res.status(500).json({ error: 'Error al editar producto' });
  }
});

// REGISTRAR NUEVO PEDIDO (MESA O CLIENTE GENERAL)
app.post('/api/pedidos', async (req, res) => {
  try {
    const { local, mesa, nombreCliente, items, total } = req.body;
    const localId = (local || '').toLowerCase().trim();

    const nuevoPedido = new Pedido({
      local: localId,
      mesa: mesa || '1',
      nombreCliente: nombreCliente || null,
      items: items || [],
      total: Number(total) || 0
    });

    await nuevoPedido.save();
    res.status(201).json({ ok: true, pedido: nuevoPedido });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar pedido' });
  }
});

// CONSULTAR PEDIDOS
app.get('/api/pedidos', async (req, res) => {
  try {
    const localId = (req.query.local || '').toLowerCase().trim();
    const pedidos = await Pedido.find({ local: localId }).sort({ createdAt: 1 });
    res.json(pedidos);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener pedidos' });
  }
});

// ELIMINAR / CANCELAR PEDIDO
app.delete('/api/pedidos/:id', async (req, res) => {
  try {
    await Pedido.findByIdAndDelete(req.params.id);
    res.json({ ok: true, mensaje: 'Pedido eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar pedido' });
  }
});

// ASIGNAR GARZÓN A PEDIDO
app.put('/api/pedidos/:id/asignar-garzon', async (req, res) => {
  try {
    const { rutGarzon } = req.body;
    const pedido = await Pedido.findById(req.params.id);

    if (!pedido) return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });

    if (pedido.rutGarzon && pedido.rutGarzon !== rutGarzon) {
      return res.status(409).json({ ok: false, error: 'Este pedido ya fue asignado a otro garzón.' });
    }

    pedido.rutGarzon = rutGarzon;
    await pedido.save();

    res.json({ ok: true, pedido });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Error al asignar garzón' });
  }
});

// REGISTRAR EN HISTORIAL
app.post('/api/historials', async (req, res) => {
  try {
    const { id, local, mesa, nombreCliente, items, total, estado, hora, rutGarzon, horaEntrega, fechaEntrega } = req.body;
    const localId = (local || '').toLowerCase().trim();

    const reg = new Historial({
      id,
      local: localId,
      mesa,
      nombreCliente: nombreCliente || null,
      items,
      total,
      estado: estado || 'entregado',
      hora,
      rutGarzon,
      horaEntrega,
      fechaEntrega
    });

    await reg.save();
    res.status(201).json({ ok: true, historial: reg });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar en historial' });
  }
});

// OBTENER HISTORIAL
app.get('/api/historials', async (req, res) => {
  try {
    const localId = (req.query.local || '').toLowerCase().trim();
    const historial = await Historial.find({ local: localId }).sort({ createdAt: -1 });
    res.json(historial);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// CONSULTAR AVISOS DEL SISTEMA
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

// RESPONDER AVISO DEL SISTEMA
app.post('/api/avisos/responder', async (req, res) => {
  try {
    const { local, avisoId, respuesta } = req.body;
    const aviso = await Aviso.findById(avisoId);

    if (!aviso) return res.status(404).json({ error: 'Aviso no encontrado' });

    aviso.respuestas.push({
      local: local.toLowerCase().trim(),
      texto: respuesta,
      fecha: new Date()
    });

    await aviso.save();
    res.json({ ok: true, aviso });
  } catch (error) {
    res.status(500).json({ error: 'Error al responder aviso' });
  }
});

// PUERTO Y ARRANQUE DEL SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`);
});