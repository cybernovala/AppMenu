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

const LocalSchema = new mongoose.Schema({
  id: Number,
  local: String,
  nombre: String,
  password: String,
  rut: String,
  correo: String,
  altaRegistrada: { type: Boolean, default: false },
  activo: { type: Boolean, default: true },
  mensajeIndividual: { type: String, default: '' },
  fechaCreacion: { type: String, default: () => new Date().toISOString() },
  fechaVencimiento: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
  menu: Array
}, { strict: false, timestamps: true });

const Local = mongoose.models.Local || mongoose.model('Local', LocalSchema, 'locals');

const MensajeGlobalSchema = new mongoose.Schema({
  _id: { type: String, default: 'global_config' },
  mensaje: { type: String, default: '' }
}, { timestamps: true });

const MensajeGlobal = mongoose.models.MensajeGlobal || mongoose.model('MensajeGlobal', MensajeGlobalSchema, 'mensajes_globales');

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

// --- 5. RUTAS DE MENSAJES DE ANUNCIO / BANNER ---

app.get('/api/mensajes/global', async (req, res) => {
  try {
    const doc = await MensajeGlobal.findById('global_config').lean();
    return res.status(200).json({ mensaje: doc ? doc.mensaje || '' : '' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al consultar mensaje global' });
  }
});

app.post('/api/mensajes/global', async (req, res) => {
  try {
    const { mensaje } = req.body;
    await MensajeGlobal.findByIdAndUpdate(
      'global_config',
      { mensaje: mensaje ? mensaje.trim() : '' },
      { upsert: true, new: true }
    );
    return res.status(200).json({ mensaje: 'Mensaje global actualizado correctamente' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al actualizar mensaje global' });
  }
});

app.post('/api/locales/:id/mensaje', async (req, res) => {
  try {
    const localQuery = req.params.id.toLowerCase().trim();
    const { mensaje } = req.body;

    const doc = await Local.findOneAndUpdate(
      buildLocalFilter(localQuery),
      { $set: { mensajeIndividual: mensaje ? mensaje.trim() : '' } },
      { new: true }
    );

    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    return res.status(200).json({ mensaje: 'Mensaje del local actualizado con éxito', mensajeIndividual: doc.mensajeIndividual });
  } catch (err) {
    return res.status(500).json({ error: 'Error al guardar el mensaje del local' });
  }
});

// --- 6. RUTAS DE LICENCIA Y SUPERADMIN ---

app.get('/api/licencia', async (req, res) => {
  try {
    const localQuery = (req.query.local || '').toLowerCase().trim();
    if (!localQuery) return res.status(400).json({ error: 'Debe especificar el local' });

    const doc = await Local.findOne(buildLocalFilter(localQuery)).lean();

    if (!doc) {
      return res.status(404).json({ error: 'Local no encontrado' });
    }

    const docGlobal = await MensajeGlobal.findById('global_config').lean();

    const estaActivo = doc.activo !== false;

    return res.status(200).json({
      id: doc.id,
      local: doc.local || String(doc.id),
      nombre: doc.nombre || doc.local,
      activo: estaActivo,
      altaRegistrada: !!doc.altaRegistrada,
      fechaCreacion: doc.fechaCreacion,
      fechaVencimiento: doc.fechaVencimiento,
      mensajeGlobal: docGlobal ? docGlobal.mensaje || '' : '',
      mensajeIndividual: doc.mensajeIndividual || ''
    });
  } catch (err) {
    console.error("❌ Error en GET /api/licencia:", err.message);
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
      mensajeIndividual: d.mensajeIndividual || '',
      fechaCreacion: d.fechaCreacion,
      fechaVencimiento: d.fechaVencimiento
    }));

    return res.status(200).json(locales);
  } catch (err) {
    console.error("❌ Error en GET /api/locales:", err.message);
    return res.status(500).json([]);
  }
});

app.post('/api/locales', async (req, res) => {
  try {
    const { nombre, password, rut, correo, altaRegistrada } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: 'El nombre del restaurante es obligatorio' });
    }

    const localSlug = nombre.toLowerCase().trim().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');

    let docExistente = await Local.findOne(buildLocalFilter(localSlug));
    if (docExistente) {
      return res.status(400).json({ error: 'El local ya se encuentra registrado' });
    }

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
      mensajeIndividual: '',
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
    console.error("❌ Error en POST /api/locales:", err.message);
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
      mensajeIndividual: '',
      fechaCreacion: ahora.toISOString(),
      fechaVencimiento: fechaVencimiento,
      menu: []
    });

    await doc.save();
    return res.status(201).json({ mensaje: 'Alta creada con éxito', local: doc.local });
  } catch (err) {
    console.error("❌ Error en POST /api/locales/alta:", err.message);
    return res.status(500).json({ error: 'Error al procesar el alta' });
  }
});

app.post('/api/locales/recuperar', async (req, res) => {
  try {
    const { correo, local } = req.body;
    if (!correo) return res.status(400).json({ error: 'El correo es obligatorio' });

    let filter = { correo: correo.trim().toLowerCase() };
    if (local) filter = { $and: [buildLocalFilter(local), { correo: correo.trim().toLowerCase() }] };

    const doc = await Local.findOne(filter);
    if (!doc) {
      return res.status(404).json({ error: 'No se encontró una cuenta asociada a este correo' });
    }

    return res.status(200).json({
      mensaje: 'Recuperación de clave',
      password: doc.password || 'Sin contraseña asignada',
      correo: doc.correo || correo
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al recuperar contraseña' });
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

    const clave = doc.password || '1234';
    const correo = doc.correo || 'Sin correo registrado';

    return res.status(200).json({
      mensaje: `Contraseña del local "${doc.nombre}": ${clave}\nCorreo ingresado: ${correo}`,
      clave: clave,
      correo: correo,
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

    if (!doc) {
      return res.status(404).json({ error: 'Local no encontrado' });
    }

    return res.status(200).json({
      mensaje: 'Estado del local actualizado en MongoDB con éxito',
      id: doc.id,
      localId: doc.local,
      activo: doc.activo,
      fechaVencimiento: doc.fechaVencimiento
    });
  } catch (err) {
    console.error("❌ Error en PATCH /api/locales/:id/licencia:", err.message);
    return res.status(500).json({ error: 'Error al actualizar licencia' });
  }
});

// --- 7. RUTAS DEL MENÚ Y CATEGORÍAS ---

app.get('/api/menu', verificarLicencia, async (req, res) => {
  try {
    const { local, modo } = req.query;
    if (!local) return res.status(200).json([]);

    const doc = await Local.findOne(buildLocalFilter(local)).lean();
    if (!doc || !doc.menu) return res.status(200).json([]);

    if (modo === 'estructurado') {
      return res.status(200).json(doc.menu || []);
    }

    let productosPlanos = [];
    if (Array.isArray(doc.menu)) {
      doc.menu.forEach(catObj => {
        if (catObj && Array.isArray(catObj.productos)) {
          catObj.productos.forEach(p => {
            productosPlanos.push({
              categoria: catObj.categoria,
              nombre: p.nombre,
              precio: p.precio
            });
          });
        }
      });
    }

    return res.status(200).json(productosPlanos);
  } catch (err) {
    console.error("❌ Error en GET /api/menu:", err.message);
    return res.status(500).json([]);
  }
});

app.post('/api/menu/categoria', verificarLicencia, async (req, res) => {
  try {
    const { local, categoria } = req.body;
    if (!local || !categoria) return res.status(400).json({ error: 'Local y categoría son requeridos' });

    let doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    if (!doc.menu) doc.menu = [];

    const existeCat = doc.menu.some(c => c.categoria.toLowerCase() === categoria.toLowerCase().trim());
    if (existeCat) {
      return res.status(400).json({ error: 'La categoría ya existe' });
    }

    doc.menu.push({ categoria: categoria.trim(), productos: [] });
    doc.markModified('menu');
    await doc.save();

    return res.status(201).json({ mensaje: 'Categoría agregada', menu: doc.menu });
  } catch (err) {
    return res.status(500).json({ error: 'Error al agregar categoría' });
  }
});

app.delete('/api/menu/categoria', verificarLicencia, async (req, res) => {
  try {
    const { local, categoria } = req.query;
    if (!local || !categoria) return res.status(400).json({ error: 'Faltan parámetros' });

    let doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    if (Array.isArray(doc.menu)) {
      doc.menu = doc.menu.filter(c => c.categoria.toLowerCase() !== categoria.toLowerCase().trim());
      doc.markModified('menu');
      await doc.save();
    }

    return res.status(200).json({ mensaje: 'Categoría eliminada' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al eliminar categoría' });
  }
});

app.post('/api/menu', verificarLicencia, async (req, res) => {
  try {
    const { local, categoria, nombre, precio } = req.body;
    if (!local || !categoria || !nombre) return res.status(400).json({ error: 'Faltan campos obligatorios' });

    let doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    if (!doc.menu) doc.menu = [];

    let catObj = doc.menu.find(c => c.categoria.toLowerCase() === categoria.toLowerCase().trim());
    if (!catObj) {
      catObj = { categoria: categoria.trim(), productos: [] };
      doc.menu.push(catObj);
    }

    catObj.productos.push({
      nombre: nombre.trim(),
      precio: Number(precio) || 0
    });

    doc.markModified('menu');
    await doc.save();

    return res.status(201).json({ mensaje: 'Producto agregado exitosamente' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al agregar producto' });
  }
});

app.delete('/api/menu/del', verificarLicencia, async (req, res) => {
  try {
    const { local, categoria, index } = req.query;
    let doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    const catObj = doc.menu.find(c => c.categoria.toLowerCase() === categoria.toLowerCase().trim());
    if (catObj && Array.isArray(catObj.productos)) {
      catObj.productos.splice(Number(index), 1);
      doc.markModified('menu');
      await doc.save();
    }

    return res.status(200).json({ mensaje: 'Producto eliminado' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

app.put('/api/menu/edit', verificarLicencia, async (req, res) => {
  try {
    const { local, categoriaOriginal, indexOriginal, nuevoNombre, nuevoPrecio, nuevaCategoria } = req.body;
    let doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    let catOrigObj = doc.menu.find(c => c.categoria.toLowerCase() === categoriaOriginal.toLowerCase().trim());
    if (!catOrigObj || !catOrigObj.productos[indexOriginal]) {
      return res.status(400).json({ error: 'Producto no encontrado' });
    }

    const prod = catOrigObj.productos.splice(indexOriginal, 1)[0];
    prod.nombre = nuevoNombre.trim();
    prod.precio = Number(nuevoPrecio) || 0;

    let targetCatObj = doc.menu.find(c => c.categoria.toLowerCase() === nuevaCategoria.toLowerCase().trim());
    if (!targetCatObj) {
      targetCatObj = { categoria: nuevaCategoria.trim(), productos: [] };
      doc.menu.push(targetCatObj);
    }

    targetCatObj.productos.push(prod);

    doc.menu = doc.menu.filter(c => c.productos.length > 0 || c.categoria.toLowerCase() === nuevaCategoria.toLowerCase().trim());

    doc.markModified('menu');
    await doc.save();

    return res.status(200).json({ mensaje: 'Producto actualizado' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al editar producto' });
  }
});

// --- 8. RUTAS DE PEDIDOS Y HISTORIAL ---

app.get('/api/pedidos', verificarLicencia, async (req, res) => {
  try {
    const { local } = req.query;
    if (!local) return res.status(200).json([]);

    const filter = buildLocalFilter(local);
    const docLocal = await Local.findOne(filter).lean();
    if (!docLocal) return res.status(200).json([]);

    const localSlug = docLocal.local || String(docLocal.id);
    const pedidos = await Pedido.find({
      $or: [
        { local: localSlug },
        { local: String(docLocal.id) },
        { local: docLocal.nombre }
      ]
    }).sort({ createdAt: -1 }).lean();

    return res.status(200).json(pedidos);
  } catch (err) {
    return res.status(500).json([]);
  }
});

app.post('/api/pedidos', verificarLicencia, async (req, res) => {
  try {
    const { local, mesa, items, total } = req.body;
    if (!local) return res.status(400).json({ error: 'Local es requerido' });

    const docLocal = await Local.findOne(buildLocalFilter(local)).lean();
    const localSlug = docLocal ? docLocal.local : local;

    const nuevoPedido = new Pedido({
      local: localSlug,
      mesa: String(mesa || '1'),
      items: items || [],
      total: Number(total) || 0,
      estado: 'pendiente',
      fecha: new Date()
    });

    await nuevoPedido.save();
    return res.status(201).json(nuevoPedido);
  } catch (err) {
    return res.status(500).json({ error: 'Error al registrar el pedido' });
  }
});

app.delete('/api/pedidos/:id', verificarLicencia, async (req, res) => {
  try {
    await Pedido.findByIdAndDelete(req.params.id);
    return res.status(200).json({ mensaje: 'Pedido removido de la lista activa' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al eliminar pedido' });
  }
});

app.get('/api/historials', verificarLicencia, async (req, res) => {
  try {
    const { local } = req.query;
    if (!local) return res.status(200).json([]);

    const docLocal = await Local.findOne(buildLocalFilter(local)).lean();
    if (!docLocal) return res.status(200).json([]);

    const localSlug = docLocal.local || String(docLocal.id);
    const historial = await Historial.find({
      $or: [
        { local: localSlug },
        { local: String(docLocal.id) },
        { local: docLocal.nombre }
      ]
    }).sort({ createdAt: -1 }).lean();

    return res.status(200).json(historial);
  } catch (err) {
    return res.status(500).json([]);
  }
});

app.post('/api/historials', verificarLicencia, async (req, res) => {
  try {
    const data = req.body;
    const docLocal = await Local.findOne(buildLocalFilter(data.local)).lean();
    if (docLocal) {
      data.local = docLocal.local;
    }

    const nuevoHistorial = new Historial(data);
    await nuevoHistorial.save();

    return res.status(201).json(nuevoHistorial);
  } catch (err) {
    return res.status(500).json({ error: 'Error al guardar en el historial' });
  }
});

// --- 9. INICIO DEL SERVIDOR ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor backend ejecutándose en el puerto ${PORT}`);
});
