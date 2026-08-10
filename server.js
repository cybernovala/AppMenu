const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// --- 1. CONFIGURACIÓN CORS ---
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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
  fechaCreacion: String,
  fechaVencimiento: String,
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

// --- 4. RUTAS DE LA API ---

// 4.1 Obtener lista de todos los locales (Para SuperAdmin)
app.get('/api/locales', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(200).json([]);

    const docs = await Local.find({}).lean();
    const locales = docs.map(d => d.id || d.local || d.slug || d.nombre).filter(Boolean);
    const unicos = [...new Set(locales)];

    return res.status(200).json(unicos);
  } catch (err) {
    console.error("❌ Error en GET /api/locales:", err.message);
    return res.status(200).json([]);
  }
});

// 4.2 Obtener el menú aplanado de un local específico
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

// 4.3 Agregar un producto al arreglo `menu` en MongoDB
app.post('/api/menu', async (req, res) => {
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
        fechaCreacion: new Date().toISOString().split('T')[0],
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

// 4.4 Editar un producto dentro de la estructura anidada
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

// 4.5 Eliminar un producto del arreglo en MongoDB
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

/* ==========================================
   5. RUTAS DE PEDIDOS Y COMANDAS (/api/pedidos)
========================================== */

// 5.1 Obtener todos los pedidos activos de un local (Formateado para Cocina)
app.get('/api/pedidos', async (req, res) => {
  try {
    const { local } = req.query;
    let query = {};
    if (local) {
      query.local = local.toLowerCase().trim();
    }

    const pedidos = await Pedido.find(query).sort({ fecha: -1 }).lean();

    // Formatear los ítems para asegurar que incluyan la Categoría en el Nombre
    const pedidosFormateados = pedidos.map(pedido => {
      if (Array.isArray(pedido.items)) {
        pedido.items = pedido.items.map(item => {
          let nombreFinal = item.nombre || '';
          
          // Si tiene categoría y el nombre no empieza ya con esa categoría, la anteponemos
          if (item.categoria && !nombreFinal.toLowerCase().startsWith(item.categoria.toLowerCase())) {
            nombreFinal = `${item.categoria} ${nombreFinal}`;
          }

          return {
            ...item,
            nombre: nombreFinal
          };
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

// 5.2 Registrar un nuevo pedido enviado por el cliente
app.post('/api/pedidos', async (req, res) => {
  try {
    const { local, mesa, items, total, estado, fecha } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'El pedido no contiene productos válidos' });
    }

    // Asegurar formato Categoria + Nombre al guardar
    const itemsFormateados = items.map(item => {
      let nombreFinal = item.nombre || '';
      if (item.categoria && !nombreFinal.toLowerCase().startsWith(item.categoria.toLowerCase())) {
        nombreFinal = `${item.categoria} ${nombreFinal}`;
      }
      return {
        ...item,
        nombre: nombreFinal
      };
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

// 5.3 Eliminar / Despachar un pedido completado en cocina
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

// Ruta raíz
app.get('/', (req, res) => {
  res.send('🚀 API AppMenu funcionando con estructura MongoDB real y soporte de pedidos.');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`);
});
