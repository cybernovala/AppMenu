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

// --- 5. RUTAS DE LICENCIA Y SUPERADMIN ---

app.get('/api/licencia', async (req, res) => {
  try {
    const localQuery = (req.query.local || '').toLowerCase().trim();
    if (!localQuery) return res.status(400).json({ error: 'Debe especificar el local' });

    const doc = await Local.findOne(buildLocalFilter(localQuery)).lean();

    if (!doc) {
      return res.status(404).json({ error: 'Local no encontrado' });
    }

    const estaActivo = doc.activo !== false;

    return res.status(200).json({
      id: doc.id,
      local: doc.local || String(doc.id),
      nombre: doc.nombre || doc.local,
      activo: estaActivo,
      altaRegistrada: !!doc.altaRegistrada,
      fechaCreacion: doc.fechaCreacion,
      fechaVencimiento: doc.fechaVencimiento
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
      password: doc.password || 'Sin contraseña asignada'
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

    return res.status(200).json({
      mensaje: `Contraseña del local "${doc.nombre}": ${doc.password || '1234'}`
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

// --- 6. RUTAS DEL MENÚ Y CATEGORÍAS ---

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
      doc.menu.forEach(c => {
        if (c.productos && Array.isArray(c.productos)) {
          c.productos.forEach(p => {
            productosPlanos.push({
              categoria: c.categoria,
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
    if (!local || !categoria) {
      return res.status(400).json({ error: 'El nombre de la categoría y local son obligatorios' });
    }

    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    if (!Array.isArray(doc.menu)) doc.menu = [];

    let existeCat = doc.menu.some(c => c.categoria.toLowerCase() === categoria.trim().toLowerCase());
    if (existeCat) {
      return res.status(400).json({ error: 'La categoría ya existe' });
    }

    doc.menu.push({ categoria: categoria.trim(), productos: [] });
    doc.markModified('menu');
    await doc.save();

    return res.status(201).json({ mensaje: 'Categoría creada con éxito', menu: doc.menu });
  } catch (err) {
    console.error("❌ Error en POST /api/menu/categoria:", err.message);
    return res.status(500).json({ error: 'Error al crear la categoría' });
  }
});

app.delete('/api/menu/categoria', verificarLicencia, async (req, res) => {
  try {
    const { local, categoria } = req.query;
    if (!local || !categoria) return res.status(400).json({ error: 'Parámetros faltantes' });

    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc || !doc.menu) return res.status(404).json({ error: 'Local no encontrado' });

    doc.menu = doc.menu.filter(c => c.categoria.toLowerCase() !== categoria.trim().toLowerCase());
    doc.markModified('menu');
    await doc.save();

    return res.status(200).json({ mensaje: 'Categoría eliminada correctamente' });
  } catch (err) {
    console.error("❌ Error en DELETE /api/menu/categoria:", err.message);
    return res.status(500).json({ error: 'Error al eliminar categoría' });
  }
});

app.post('/api/menu', verificarLicencia, async (req, res) => {
  try {
    const { local, categoria, nombre, precio } = req.body;
    if (!local || !categoria || !nombre) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    const doc = await Local.findOne(buildLocalFilter(local));

    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });
    if (!Array.isArray(doc.menu)) doc.menu = [];

    let catObj = doc.menu.find(c => c.categoria.toLowerCase() === categoria.toLowerCase().trim());
    if (!catObj) {
      catObj = { categoria: categoria.trim(), productos: [] };
      doc.menu.push(catObj);
    }

    if (!Array.isArray(catObj.productos)) catObj.productos = [];

    catObj.productos.push({
      nombre: nombre.trim(),
      precio: Number(precio) || 0
    });

    doc.markModified('menu');
    await doc.save();

    return res.status(200).json({ mensaje: 'Producto guardado con éxito' });
  } catch (err) {
    console.error("❌ Error en POST /api/menu:", err.message);
    return res.status(500).json({ error: 'Error al agregar producto' });
  }
});

app.put('/api/menu/edit', verificarLicencia, async (req, res) => {
  try {
    const { local, categoriaOriginal, indexOriginal, nuevoNombre, nuevoPrecio, nuevaCategoria } = req.body;

    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc || !doc.menu) return res.status(404).json({ error: 'Local no encontrado' });

    let catObj = doc.menu.find(c => c.categoria === categoriaOriginal);
    if (!catObj || !catObj.productos || catObj.productos[indexOriginal] === undefined) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const productoActualizado = {
      nombre: nuevoNombre.trim(),
      precio: Number(nuevoPrecio) || 0
    };

    if (nuevaCategoria && nuevaCategoria !== categoriaOriginal) {
      catObj.productos.splice(indexOriginal, 1);

      let nuevaCatObj = doc.menu.find(c => c.categoria === nuevaCategoria);
      if (!nuevaCatObj) {
        nuevaCatObj = { categoria: nuevaCategoria, productos: [] };
        doc.menu.push(nuevaCatObj);
      }
      nuevaCatObj.productos.push(productoActualizado);
    } else {
      catObj.productos[indexOriginal] = productoActualizado;
    }

    doc.markModified('menu');
    await doc.save();

    return res.status(200).json({ mensaje: 'Producto actualizado con éxito' });
  } catch (err) {
    console.error("❌ Error en PUT /api/menu/edit:", err.message);
    return res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

app.delete('/api/menu/del', verificarLicencia, async (req, res) => {
  try {
    const { local, categoria, index } = req.query;

    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc || !doc.menu) return res.status(404).json({ error: 'Local no encontrado' });

    let catObj = doc.menu.find(c => c.categoria === categoria);
    if (catObj && catObj.productos) {
      catObj.productos.splice(Number(index), 1);
      doc.markModified('menu');
      await doc.save();
    }

    return res.status(200).json({ mensaje: 'Producto eliminado correctamente' });
  } catch (err) {
    console.error("❌ Error en DELETE /api/menu/del:", err.message);
    return res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// --- 7. RUTAS DE PEDIDOS Y COMANDAS ---

app.get('/api/pedidos', verificarLicencia, async (req, res) => {
  try {
    const { local } = req.query;
    let query = {};
    if (local) query.local = local.toLowerCase().trim();

    const pedidos = await Pedido.find(query).sort({ fecha: -1 }).lean();
    return res.status(200).json(pedidos);
  } catch (err) {
    console.error("❌ Error en GET /api/pedidos:", err.message);
    return res.status(500).json([]);
  }
});

app.post('/api/pedidos', verificarLicencia, async (req, res) => {
  try {
    const { local, mesa, items, total, estado, fecha } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'El pedido no contiene productos válidos' });
    }

    const nuevoPedido = new Pedido({
      local: (local || 'mongo').toLowerCase().trim(),
      mesa: String(mesa || '1'),
      items,
      total: Number(total) || 0,
      estado: estado || 'pendiente',
      fecha: fecha ? new Date(fecha) : new Date()
    });

    await nuevoPedido.save();
    return res.status(201).json({ mensaje: 'Pedido registrado con éxito', id: nuevoPedido._id });
  } catch (err) {
    console.error("❌ Error en POST /api/pedidos:", err.message);
    return res.status(500).json({ error: 'Error interno al procesar el pedido' });
  }
});

app.delete('/api/pedidos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await Pedido.findByIdAndDelete(id);
    return res.status(200).json({ mensaje: 'Pedido completado y eliminado' });
  } catch (err) {
    console.error("❌ Error en DELETE /api/pedidos/:id:", err.message);
    return res.status(500).json({ error: 'Error al eliminar el pedido' });
  }
});

// --- 8. RUTAS DE HISTORIAL DE ENTREGAS ---

app.post('/api/historials', verificarLicencia, async (req, res) => {
  try {
    const data = req.body;

    const nuevoRegistro = new Historial({
      id: data.id || String(Date.now()),
      local: (data.local || 'mongo').toLowerCase().trim(),
      mesa: String(data.mesa || '1'),
      items: data.items || [],
      total: Number(data.total) || 0,
      estado: 'entregado',
      hora: data.hora,
      rutGarzon: data.rutGarzon,
      horaEntrega: data.horaEntrega,
      fechaEntrega: data.fechaEntrega
    });

    await nuevoRegistro.save();
    return res.status(201).json({ mensaje: 'Historial guardado exitosamente' });
  } catch (err) {
    console.error("❌ Error en POST /api/historials:", err.message);
    return res.status(500).json({ error: 'Error al registrar historial' });
  }
});

app.get('/api/historials', verificarLicencia, async (req, res) => {
  try {
    const { local } = req.query;
    let query = {};
    if (local) query.local = local.toLowerCase().trim();

    const historial = await Historial.find(query).sort({ createdAt: -1 }).lean();
    return res.status(200).json(historial);
  } catch (err) {
    console.error("❌ Error en GET /api/historials:", err.message);
    return res.status(500).json([]);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
});
