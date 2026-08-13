const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// --- 1. CONFIGURACIÓN CORS Y MIDDLEWARE ---
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());
app.use(express.json());

// --- 2. CONEXIÓN A MONGO DB ATLAS ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:juan2073@cluster0.w3kjxzs.mongodb.net/appmenu?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 5000
})
  .then(() => console.log('✅ MongoDB Conectado Exitosamente'))
  .catch(err => console.error('❌ Error crítico al conectar a MongoDB:', err.message));

// --- 3. ESQUEMAS Y MODELOS ---

const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});
const Counter = mongoose.models.Counter || mongoose.model('Counter', CounterSchema);

const ConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  mensajeGlobal: { type: String, default: '' }
}, { timestamps: true });
const Config = mongoose.models.Config || mongoose.model('Config', ConfigSchema, 'configs');

const LocalSchema = new mongoose.Schema({
  id: Number,
  local: String,
  nombre: String,
  password: String,
  rut: String,
  correo: String,
  altaRegistrada: { type: Boolean, default: false },
  activo: { type: Boolean, default: true },
  mensaje: { type: String, default: '' },
  fechaCreacion: { type: String, default: () => new Date().toISOString() },
  fechaVencimiento: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
  menu: Array
}, { strict: false, timestamps: true });

const Local = mongoose.models.Local || mongoose.model('Local', LocalSchema, 'locals');

const PedidoSchema = new mongoose.Schema({
  local: String,
  mesa: String,
  items: Array,
  total: Number,
  estado: { type: String, default: 'pendiente' },
  fecha: { type: Date, default: Date.now }
}, { strict: false, timestamps: true });

const Pedido = mongoose.models.Pedido || mongoose.model('Pedido', PedidoSchema, 'pedidos');

const HistorialSchema = new mongoose.Schema({
  id: String,
  local: String,
  mesa: String,
  items: Array,
  total: Number,
  estado: { type: String, default: 'entregado' },
  hora: String,
  rutGarzon: String,
  horaEntrega: String,
  fechaEntrega: String
}, { strict: false, timestamps: true });

const Historial = mongoose.models.Historial || mongoose.model('Historial', HistorialSchema, 'historials');

async function getNextSequenceValue(sequenceName) {
  const sequenceDocument = await Counter.findByIdAndUpdate(
    sequenceName,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return sequenceDocument.seq;
}

function buildLocalFilter(queryVal) {
  if (!queryVal) return {};
  const trimmed = String(queryVal).toLowerCase().trim();
  const numVal = Number(trimmed);
  const filter = [
    { local: trimmed },
    { nombre: new RegExp(`^${trimmed}$`, 'i') }
  ];
  if (!isNaN(numVal)) {
    filter.push({ id: numVal });
  }
  return { $or: filter };
}

// --- 4. MIDDLEWARE DE VERIFICACIÓN DE LICENCIA ---
const verificarLicencia = async (req, res, next) => {
  try {
    const localQuery = (req.query.local || req.body.local || req.params.local || req.params.id || '').toLowerCase().trim();
    if (!localQuery) return next();

    const doc = await Local.findOne(buildLocalFilter(localQuery)).lean();
    if (!doc) {
      return res.status(404).json({ error: 'Local no registrado en base de datos.' });
    }

    if (doc.activo === false) {
      return res.status(403).json({ 
        error: 'LICENCIA_BLOQUEADA', 
        mensaje: 'El restaurante se encuentra desactivado por el administrador.' 
      });
    }

    next();
  } catch (err) {
    console.error("❌ Error en middleware verificarLicencia:", err.message);
    return res.status(500).json({ error: 'Error interno al validar la licencia.' });
  }
};

// --- 5. RUTAS DE MENSAJES Y LICENCIAS ---

// Obtener avisos (Global + Individual del Local)
app.get('/api/mensajes', async (req, res) => {
  try {
    const localQuery = (req.query.local || '').toLowerCase().trim();
    const conf = await Config.findOne({ key: 'global' }).lean();
    const mensajeGlobal = conf ? conf.mensajeGlobal || '' : '';

    let mensajeLocal = '';
    if (localQuery) {
      const doc = await Local.findOne(buildLocalFilter(localQuery)).lean();
      if (doc && doc.mensaje) mensajeLocal = doc.mensaje;
    }

    return res.status(200).json({ mensajeGlobal, mensajeLocal });
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener mensajes' });
  }
});

// Guardar mensaje global para todos los clientes
app.post('/api/superadmin/mensaje-global', async (req, res) => {
  try {
    const { mensaje } = req.body;
    await Config.findOneAndUpdate(
      { key: 'global' },
      { mensajeGlobal: mensaje || '' },
      { upsert: true, new: true }
    );
    return res.status(200).json({ mensaje: 'Mensaje global actualizado correctamente' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al guardar mensaje global' });
  }
});

// Guardar mensaje específico para un local
app.patch('/api/locales/:id/mensaje', async (req, res) => {
  try {
    const localQuery = req.params.id.toLowerCase().trim();
    const { mensaje } = req.body;

    const doc = await Local.findOneAndUpdate(
      buildLocalFilter(localQuery),
      { $set: { mensaje: mensaje || '' } },
      { new: true }
    );

    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    return res.status(200).json({ mensaje: 'Mensaje del local actualizado con éxito', mensajeLocal: doc.mensaje });
  } catch (err) {
    return res.status(500).json({ error: 'Error al actualizar mensaje del local' });
  }
});

app.get('/api/licencia', async (req, res) => {
  try {
    const localQuery = (req.query.local || '').toLowerCase().trim();
    if (!localQuery) return res.status(400).json({ error: 'Debe especificar el local' });

    const doc = await Local.findOne(buildLocalFilter(localQuery)).lean();

    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    return res.status(200).json({
      id: doc.id,
      local: doc.local || String(doc.id),
      nombre: doc.nombre || doc.local,
      activo: doc.activo !== false,
      altaRegistrada: !!doc.altaRegistrada,
      mensaje: doc.mensaje || '',
      fechaCreacion: doc.fechaCreacion,
      fechaVencimiento: doc.fechaVencimiento
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al consultar estado de licencia' });
  }
});

app.get('/api/locales', async (req, res) => {
  try {
    const docs = await Local.find({}).sort({ id: 1 }).lean();
    if (!docs) return res.status(200).json([]);

    const locales = docs.map(d => ({
      _id: d._id,
      id: d.id,
      localId: (d.local || String(d.id || '')).toLowerCase().trim(),
      nombre: d.nombre || d.local,
      rut: d.rut || '',
      correo: d.correo || '',
      password: d.password || '',
      altaRegistrada: !!d.altaRegistrada,
      activo: d.activo !== false,
      mensaje: d.mensaje || '',
      fechaCreacion: d.fechaCreacion,
      fechaVencimiento: d.fechaVencimiento
    }));

    return res.status(200).json(locales);
  } catch (err) {
    return res.status(500).json([]);
  }
});

app.post('/api/locales', async (req, res) => {
  try {
    const { nombre, password, rut, correo, altaRegistrada } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre del restaurante es obligatorio' });

    const localSlug = nombre.toLowerCase().trim().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');

    let docExistente = await Local.findOne(buildLocalFilter(localSlug));
    if (docExistente) return res.status(400).json({ error: 'El local ya se encuentra registrado' });

    const siguienteId = await getNextSequenceValue('local_id');
    const ahora = new Date();
    const fechaVencimiento = new Date(ahora.getTime() + (30 * 24 * 60 * 60 * 1000));

    const nuevoLocal = new Local({
      id: siguienteId,
      local: localSlug,
      nombre: nombre.trim(),
      password: password || '1234',
      rut: rut ? rut.trim() : '',
      correo: correo ? correo.trim().toLowerCase() : '',
      altaRegistrada: !!altaRegistrada,
      activo: true,
      mensaje: '',
      fechaCreacion: ahora.toISOString(),
      fechaVencimiento: fechaVencimiento,
      menu: []
    });

    await nuevoLocal.save();

    return res.status(201).json({
      mensaje: 'Restaurante creado con éxito',
      id: nuevoLocal.id,
      local: nuevoLocal.local,
      nombre: nuevoLocal.nombre,
      activo: nuevoLocal.activo,
      fechaCreacion: nuevoLocal.fechaCreacion,
      fechaVencimiento: nuevoLocal.fechaVencimiento
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al crear el restaurante' });
  }
});

app.post('/api/locales/alta', async (req, res) => {
  try {
    const { nombre, rut, correo, password } = req.body;
    if (!nombre || !rut || !correo || !password) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    const localSlug = nombre.toLowerCase().trim().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
    let doc = await Local.findOne(buildLocalFilter(localSlug));

    if (doc) {
      doc.rut = rut.trim();
      doc.correo = correo.trim().toLowerCase();
      doc.password = password.trim();
      doc.altaRegistrada = true;
      await doc.save();
      return res.status(200).json({ mensaje: 'Alta realizada con éxito', local: doc.local });
    }

    const siguienteId = await getNextSequenceValue('local_id');
    const ahora = new Date();
    const fechaVencimiento = new Date(ahora.getTime() + (30 * 24 * 60 * 60 * 1000));

    doc = new Local({
      id: siguienteId,
      local: localSlug,
      nombre: nombre.trim(),
      rut: rut.trim(),
      correo: correo.trim().toLowerCase(),
      password: password.trim(),
      altaRegistrada: true,
      activo: true,
      mensaje: '',
      fechaCreacion: ahora.toISOString(),
      fechaVencimiento: fechaVencimiento,
      menu: []
    });

    await doc.save();
    return res.status(201).json({ mensaje: 'Alta creada con éxito', local: doc.local });
  } catch (err) {
    return res.status(500).json({ error: 'Error al procesar el alta' });
  }
});

app.post('/api/locales/login', async (req, res) => {
  try {
    const { local, password } = req.body;
    if (!local || !password) return res.status(400).json({ error: 'Datos incompletos' });

    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    if (!doc.password || doc.password === password.trim()) {
      return res.status(200).json({ ok: true, mensaje: 'Acceso concedido' });
    } else {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Error al autenticar' });
  }
});

app.post('/api/locales/reenviar-clave', async (req, res) => {
  try {
    const { local } = req.body;
    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    return res.status(200).json({
      mensaje: `Contraseña del local "${doc.nombre}": ${doc.password || '1234'}\nCorreo ingresado: ${doc.correo || 'Sin correo'}`,
      clave: doc.password || '1234',
      correo: doc.correo || 'Sin correo',
      nombre: doc.nombre
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al reenviar contraseña' });
  }
});

app.patch('/api/locales/:id/licencia', async (req, res) => {
  try {
    const localQuery = req.params.id.toLowerCase().trim();
    const { activo, fechaVencimiento } = req.body;

    const updateFields = {};
    if (typeof activo === 'boolean') updateFields.activo = activo;
    if (fechaVencimiento) updateFields.fechaVencimiento = new Date(fechaVencimiento);

    const doc = await Local.findOneAndUpdate(
      buildLocalFilter(localQuery),
      { $set: updateFields },
      { new: true }
    );

    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    return res.status(200).json({
      mensaje: 'Estado del local actualizado con éxito',
      id: doc.id,
      localId: doc.local,
      activo: doc.activo,
      fechaVencimiento: doc.fechaVencimiento
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al actualizar licencia' });
  }
});

// --- RUTAS DEL MENÚ ---
app.get('/api/menu', verificarLicencia, async (req, res) => {
  try {
    const { local, modo } = req.query;
    if (!local) return res.status(200).json([]);

    const doc = await Local.findOne(buildLocalFilter(local)).lean();
    if (!doc || !doc.menu) return res.status(200).json([]);

    return res.status(200).json(doc.menu);
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener menú' });
  }
});

// RUTAS PEDIDOS
app.get('/api/pedidos', verificarLicencia, async (req, res) => {
  try {
    const { local } = req.query;
    if (!local) return res.status(200).json([]);

    const pedidos = await Pedido.find({ local: local.toLowerCase().trim() }).sort({ fecha: -1 }).lean();
    return res.status(200).json(pedidos);
  } catch (err) {
    return res.status(500).json({ error: 'Error al consultar pedidos' });
  }
});

app.post('/api/pedidos', verificarLicencia, async (req, res) => {
  try {
    const nuevoPedido = new Pedido(req.body);
    await nuevoPedido.save();
    return res.status(201).json(nuevoPedido);
  } catch (err) {
    return res.status(500).json({ error: 'Error al crear pedido' });
  }
});

app.delete('/api/pedidos/:id', async (req, res) => {
  try {
    await Pedido.findByIdAndDelete(req.params.id);
    return res.status(200).json({ mensaje: 'Pedido eliminado de cocina' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al borrar pedido' });
  }
});

// RUTAS HISTORIAL
app.get('/api/historials', async (req, res) => {
  try {
    const { local } = req.query;
    let filter = {};
    if (local) filter = { local: local.toLowerCase().trim() };
    const historial = await Historial.find(filter).sort({ createdAt: -1 }).lean();
    return res.status(200).json(historial);
  } catch (err) {
    return res.status(500).json([]);
  }
});

app.post('/api/historials', async (req, res) => {
  try {
    const nuevoHistorial = new Historial(req.body);
    await nuevoHistorial.save();
    return res.status(201).json(nuevoHistorial);
  } catch (err) {
    return res.status(500).json({ error: 'Error al guardar en historial' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`));
