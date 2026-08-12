const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// --- 1. CONFIGURACIÓN CORS ---
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());
app.use(express.json());

// --- 2. CONEXIÓN A MONGO DB ATLAS ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:juan2073@cluster0.w3kjxzs.mongodb.net/appmenu?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Conectado Exitosamente'))
  .catch(err => console.error('❌ Error crítico al conectar a MongoDB:', err));

// --- 3. ESQUEMAS Y MODELOS ---

// Esquema de Locales
const LocalSchema = new mongoose.Schema({
  id: String,
  local: String,
  nombre: String,
  password: String,
  activo: { type: Boolean, default: true },
  fechaCreacion: { type: String, default: () => new Date().toISOString() },
  fechaVencimiento: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
  menu: Array
}, { strict: false, timestamps: true });

const Local = mongoose.models.Local || mongoose.model('Local', LocalSchema, 'locals');

// Esquema de Pedidos / Comandas
const PedidoSchema = new mongoose.Schema({
  local: String,
  mesa: String,
  items: Array,
  total: Number,
  estado: { type: String, default: 'pendiente' },
  fecha: { type: Date, default: Date.now }
}, { strict: false, timestamps: true });

const Pedido = mongoose.models.Pedido || mongoose.model('Pedido', PedidoSchema, 'pedidos');

// Esquema de Historial de Entregas
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


// --- 4. MIDDLEWARE DE VERIFICACIÓN DE LICENCIA Y BLOQUEO ---
const verificarLicencia = async (req, res, next) => {
  try {
    const localQuery = (req.query.local || req.body.local || req.params.local || req.params.id || '').toLowerCase().trim();

    if (!localQuery) return next();

    const doc = await Local.findOne({ $or: [{ id: localQuery }, { local: localQuery }] }).lean();

    if (!doc) {
      return res.status(404).json({ error: 'Local no registrado en base de datos.' });
    }

    // Validar estado de activación en MongoDB
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


// --- 5. RUTAS DE ESTADO DE LICENCIA Y SUPERADMIN ---

// Endpoint directo de consulta de licencia
app.get('/api/licencia', async (req, res) => {
  try {
    const localQuery = (req.query.local || '').toLowerCase().trim();
    if (!localQuery) return res.status(400).json({ error: 'Debe especificar el local' });

    const doc = await Local.findOne({ $or: [{ id: localQuery }, { local: localQuery }] }).lean();

    if (!doc) {
      return res.status(404).json({ error: 'Local no encontrado' });
    }

    const estaActivo = doc.activo !== false;

    return res.status(200).json({
      local: doc.local || doc.id,
      nombre: doc.nombre || doc.local || doc.id,
      activo: estaActivo,
      fechaVencimiento: doc.fechaVencimiento
    });
  } catch (err) {
    console.error("❌ Error en GET /api/licencia:", err.message);
    return res.status(500).json({ error: 'Error al consultar estado de licencia' });
  }
});

// Obtener todos los locales (SuperAdmin)
app.get('/api/locales', async (req, res) => {
  try {
    const docs = await Local.find({}).lean();
    if (!docs) return res.status(200).json([]);

    const locales = docs.map(d => ({
      _id: d._id,
      localId: (d.local || d.id || '').toLowerCase().trim(),
      nombre: d.nombre || d.local || d.id,
      activo: d.activo !== false,
      fechaVencimiento: d.fechaVencimiento
    })).filter(d => d.localId !== '');

    return res.status(200).json(locales);
  } catch (err) {
    console.error("❌ Error en GET /api/locales:", err.message);
    return res.status(500).json([]);
  }
});

// Actualizar estado de activo/inactivo o fecha de vencimiento (SuperAdmin)
app.patch('/api/locales/:id/licencia', async (req, res) => {
  try {
    const localQuery = req.params.id.toLowerCase().trim();
    const { activo, fechaVencimiento } = req.body;

    const updateFields = {};
    if (typeof activo === 'boolean') updateFields.activo = activo;
    if (fechaVencimiento) updateFields.fechaVencimiento = new Date(fechaVencimiento);

    const doc = await Local.findOneAndUpdate(
      { $or: [{ id: localQuery }, { local: localQuery }] },
      { $set: updateFields },
      { new: true, upsert: true }
    );

    return res.status(200).json({
      mensaje: 'Estado del local actualizado en MongoDB con éxito',
      localId: doc.local || doc.id,
      activo: doc.activo,
      fechaVencimiento: doc.fechaVencimiento
    });
  } catch (err) {
    console.error("❌ Error en PATCH /api/locales/:id/licencia:", err.message);
    return res.status(500).json({ error: 'Error al actualizar licencia' });
  }
});


// --- 6. RUTAS DEL MENÚ (PROTEGIDAS) ---

app.get('/api/menu', verificarLicencia, async (req, res) => {
  try {
    const { local } = req.query;
    if (!local) return res.status(200).json([]);

    const localQuery = local.toLowerCase().trim();
    const doc = await Local.findOne({ $or: [{ id: localQuery }, { local: localQuery }] }).lean();

    if (!doc || !doc.menu) return res.status(200).json([]);

    let listaProductos = [];
    doc.menu.forEach((catObj) => {
      const categoriaNombre = catObj.categoria || 'General';
      if (Array.isArray(catObj.productos)) {
        catObj.productos.forEach((prod, index) => {
          listaProductos.push({
            _id: `${categoriaNombre}||${index}`,
            nombre: prod.nombre,
            precio: prod.precio,
            categoria: categoriaNombre
          });
        });
      }
    });

    return res.status(200).json(listaProductos);
  } catch (err) {
    console.error("❌ Error en GET /api/menu:", err.message);
    return res.status(500).json([]);
  }
});

app.post('/api/menu', verificarLicencia, async (req, res) => {
  try {
    const { local, categoria, nombre, precio } = req.body;
    if (!local || !categoria || !nombre) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    const localQuery = local.toLowerCase().trim();
    let doc = await Local.findOne({ $or: [{ id: localQuery }, { local: localQuery }] });

    if (!doc) {
      doc = new Local({
        id: localQuery,
        local: localQuery,
        nombre: local,
        activo: true,
        fechaCreacion: new Date().toISOString(),
        fechaVencimiento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        menu: []
      });
    }

    if (!Array.isArray(doc.menu)) doc.menu = [];

    let catExistente = doc.menu.find(c => c.categoria === categoria);
    if (!catExistente) {
      catExistente = { categoria: categoria, productos: [] };
      doc.menu.push(catExistente);
    }

    if (!Array.isArray(catExistente.productos)) catExistente.productos = [];

    catExistente.productos.push({
      nombre: nombre,
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
    
    const localQuery = local.toLowerCase().trim();
    const doc = await Local.findOne({ $or: [{ id: localQuery }, { local: localQuery }] });
    if (!doc || !doc.menu) return res.status(404).json({ error: 'Local no encontrado' });

    let catObj = doc.menu.find(c => c.categoria === categoriaOriginal);
    if (!catObj || !catObj.productos[indexOriginal]) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    if (nuevaCategoria && nuevaCategoria !== categoriaOriginal) {
      catObj.productos.splice(indexOriginal, 1);
      if (catObj.productos.length === 0) {
        doc.menu = doc.menu.filter(c => c.categoria !== categoriaOriginal);
      }

      let nuevaCatObj = doc.menu.find(c => c.categoria === nuevaCategoria);
      if (!nuevaCatObj) {
        nuevaCatObj = { categoria: nuevaCategoria, productos: [] };
        doc.menu.push(nuevaCatObj);
      }
      nuevaCatObj.productos.push({ nombre: nuevoNombre, precio: Number(nuevoPrecio) || 0 });
    } else {
      catObj.productos[indexOriginal] = {
        nombre: nuevoNombre,
        precio: Number(nuevoPrecio) || 0
      };
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

    const localQuery = (local || '').toLowerCase().trim();
    const doc = await Local.findOne({ $or: [{ id: localQuery }, { local: localQuery }] });
    if (!doc || !doc.menu) return res.status(404).json({ error: 'Local no encontrado' });

    let catObj = doc.menu.find(c => c.categoria === categoria);
    if (catObj && catObj.productos) {
      catObj.productos.splice(Number(index), 1);

      if (catObj.productos.length === 0) {
        doc.menu = doc.menu.filter(c => c.categoria !== categoria);
      }

      doc.markModified('menu');
      await doc.save();
    }

    return res.status(200).json({ mensaje: 'Producto eliminado correctamente' });
  } catch (err) {
    console.error("❌ Error en DELETE /api/menu/del:", err.message);
    return res.status(500).json({ error: 'Error al eliminar producto' });
  }
});


// --- 7. RUTAS DE PEDIDOS Y COMANDAS (PROTEGIDAS) ---

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


// --- 8. RUTAS DE HISTORIAL DE ENTREGAS (PROTEGIDAS) ---

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

// Puertos de inicialización
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
});
