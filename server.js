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
  fechaVencimiento: { type: String, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() },
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

// --- 4. RUTAS DE LA API DE LOCALES Y LICENCIAS ---

// 4.1 Obtener lista completa de locales con sus estados de licencia (SuperAdmin)
app.get('/api/locales', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(200).json([]);

    const docs = await Local.find({}).lean();
    
    // Si no existen documentos todavía, retornar arreglo vacío
    if (!docs || docs.length === 0) return res.status(200).json([]);

    const localesNormalizados = docs.map(d => {
      const idFinal = d.local || d.id || d.slug || d.nombre;
      return {
        localId: idFinal ? idFinal.toLowerCase().trim() : 'desconocido',
        nombre: d.nombre || idFinal,
        activo: d.activo !== false, // Por defecto true si no está definido
        fechaVencimiento: d.fechaVencimiento || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      };
    }).filter(d => d.localId !== 'desconocido');

    // Filtrar duplicados dejando la última versión registrada
    const unicosMap = new Map();
    localesNormalizados.forEach(item => unicosMap.set(item.localId, item));

    return res.status(200).json(Array.from(unicosMap.values()));
  } catch (err) {
    console.error("❌ Error en GET /api/locales:", err.message);
    return res.status(500).json([]);
  }
});

// 4.2 Obtener la licencia y estado de un local específico
app.get('/api/locales/:id', async (req, res) => {
  try {
    const localQuery = req.params.id.toLowerCase().trim();
    const doc = await Local.findOne({ $or: [{ id: localQuery }, { local: localQuery }] }).lean();

    if (!doc) {
      return res.status(404).json({ error: 'Local no encontrado' });
    }

    return res.status(200).json({
      localId: doc.local || doc.id,
      nombre: doc.nombre || doc.local || doc.id,
      activo: doc.activo !== false,
      fechaVencimiento: doc.fechaVencimiento || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });
  } catch (err) {
    console.error("❌ Error en GET /api/locales/:id:", err.message);
    return res.status(500).json({ error: 'Error del servidor' });
  }
});

// 4.3 Actualizar estado de licencia o renovar (SuperAdmin)
app.patch('/api/locales/:id/licencia', async (req, res) => {
  try {
    const localQuery = req.params.id.toLowerCase().trim();
    const { activo, fechaVencimiento } = req.body;

    const updateFields = {};
    if (typeof activo === 'boolean') updateFields.activo = activo;
    if (fechaVencimiento) updateFields.fechaVencimiento = fechaVencimiento;

    const doc = await Local.findOneAndUpdate(
      { $or: [{ id: localQuery }, { local: localQuery }] },
      { $set: updateFields },
      { new: true, upsert: true }
    );

    return res.status(200).json({
      mensaje: 'Licencia actualizada correctamente',
      localId: doc.local || doc.id,
      activo: doc.activo,
      fechaVencimiento: doc.fechaVencimiento
    });
  } catch (err) {
    console.error("❌ Error en PATCH /api/locales/:id/licencia:", err.message);
    return res.status(500).json({ error: 'Error al actualizar la licencia' });
  }
});

// --- 5. RUTAS DEL MENÚ ---

// Obtener el menú aplanado de un local
app.get('/api/menu', async (req, res) => {
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

// Agregar producto al menú
app.post('/api/menu', async (req, res) => {
  try {
    const { local, categoria, nombre, precio, fechaVencimiento } = req.body;
    if (!local || !categoria || !nombre) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    const localQuery = local.toLowerCase().trim();
    let doc = await Local.findOne({ $or: [{ id: localQuery }, { local: localQuery }] });

    if (!doc) {
      const fVenc = fechaVencimiento || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      doc = new Local({
        id: localQuery,
        local: localQuery,
        nombre: local,
        activo: true,
        fechaCreacion: new Date().toISOString(),
        fechaVencimiento: fVenc,
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

// Editar un producto
app.put('/api/menu/edit', async (req, res) => {
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

// Eliminar producto
app.delete('/api/menu/del', async (req, res) => {
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

// --- 6. RUTAS DE PEDIDOS Y COMANDAS ---

app.get('/api/pedidos', async (req, res) => {
  try {
    const { local } = req.query;
    let query = {};
    if (local) {
      query.local = local.toLowerCase().trim();
    }

    const pedidos = await Pedido.find(query).sort({ fecha: -1 }).lean();

    const pedidosFormateados = pedidos.map(pedido => {
      if (Array.isArray(pedido.items)) {
        pedido.items = pedido.items.map(item => {
          let nombreFinal = item.nombre || '';
          if (item.categoria && !nombreFinal.toLowerCase().startsWith(item.categoria.toLowerCase())) {
            nombreFinal = `${item.categoria} ${nombreFinal}`;
          }
          return { ...item, nombre: nombreFinal };
        });
      }
      return pedido;
    });

    return res.status(200).json(pedidosFormateados);
  } catch (err) {
    console.error("❌ Error en GET /api/pedidos:", err.message);
    return res.status(500).json([]);
  }
});

app.post('/api/pedidos', async (req, res) => {
  try {
    const { local, mesa, items, total, estado, fecha } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'El pedido no contiene productos válidos' });
    }

    const itemsFormateados = items.map(item => {
      let nombreFinal = item.nombre || '';
      if (item.categoria && !nombreFinal.toLowerCase().startsWith(item.categoria.toLowerCase())) {
        nombreFinal = `${item.categoria} ${nombreFinal}`;
      }
      return { ...item, nombre: nombreFinal };
    });

    const nuevoPedido = new Pedido({
      local: (local || 'mongo').toLowerCase().trim(),
      mesa: String(mesa || '1'),
      items: itemsFormateados,
      total: Number(total) || 0,
      estado: estado || 'pendiente',
      fecha: fecha ? new Date(fecha) : new Date()
    });

    await nuevoPedido.save();
    return res.status(201).json({ mensaje: 'Pedido recibido y registrado en MongoDB con éxito', id: nuevoPedido._id });
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

// --- 7. RUTAS DE HISTORIAL DE ENTREGAS ---

app.post('/api/historials', async (req, res) => {
  try {
    const data = req.body;
    const ahora = new Date();
    const fechaActual = ahora.toISOString().split('T')[0];
    const horaActual = ahora.toLocaleTimeString('es-CL', { hour12: false });

    const nuevoRegistro = new Historial({
      id: data.id || String(Date.now()),
      local: (data.local || 'mongo').toLowerCase().trim(),
      mesa: String(data.mesa || '1'),
      items: data.items || [],
      total: Number(data.total) || 0,
      estado: data.estado || 'entregado',
      hora: data.hora || horaActual,
      rutGarzon: data.rutGarzon || '12022962-1',
      horaEntrega: data.horaEntrega || horaActual,
      fechaEntrega: data.fechaEntrega || fechaActual
    });

    const guardado = await nuevoRegistro.save();

    return res.status(201).json({ 
      mensaje: 'Entrega guardada exitosamente en el historial', 
      id: guardado._id 
    });
  } catch (err) {
    console.error("❌ Error en POST /api/historials:", err.message);
    return res.status(500).json({ error: 'Error interno al guardar historial' });
  }
});

app.get('/api/historials', async (req, res) => {
  try {
    const { local } = req.query;
    let query = {};

    if (local && local !== 'default' && local !== 'all') {
      query.local = local.toLowerCase().trim();
    }

    const registros = await Historial.find(query).sort({ createdAt: -1 }).lean();
    return res.status(200).json(registros);
  } catch (err) {
    console.error("❌ Error en GET /api/historials:", err.message);
    return res.status(500).json([]);
  }
});

app.get('/', (req, res) => {
  res.send('🚀 API AppMenu funcionando con gestión de licencias, menú, pedidos e historial.');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`);
});
