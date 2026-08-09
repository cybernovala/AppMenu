const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// --- 1. CONFIGURACIÓN CORS AMIGABLE ---
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

// Esquema para la colección de clientes/locales ('locals')
const LocalSchema = new mongoose.Schema({
  nombre: String,
  local: String,
  id: String,
  slug: String,
  fechaVencimiento: Date
}, { strict: false, timestamps: true });

// Esquema para la colección de productos ('menus')
const MenuSchema = new mongoose.Schema({
  local: { type: String, required: true, index: true },
  categoria: { type: String, default: 'General' },
  nombre: { type: String, default: 'Producto Inicial' },
  precio: { type: Number, default: 0 },
  fechaVencimiento: { type: Date }
}, { strict: false, timestamps: true });

const Local = mongoose.models.Local || mongoose.model('Local', LocalSchema, 'locals');
const Menu = mongoose.models.Menu || mongoose.model('Menu', MenuSchema, 'menus');

// --- 4. RUTAS DE LA API ---

// 4.1 Obtener todos los clientes (Consulta la colección 'locals' y 'menus')
app.get('/api/locales', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(200).json([]);
    }

    // A. Consultar colección 'locals'
    const docsLocals = await Local.find({}).lean();
    let listaLocales = docsLocals.map(doc => {
      return doc.local || doc.slug || doc.id || doc.nombre || null;
    }).filter(Boolean);

    // B. Respaldo: Si 'locals' no da resultados, buscar en 'menus'
    if (listaLocales.length === 0) {
      const distinctMenus = await Menu.distinct('local');
      listaLocales = (distinctMenus || []).filter(item => item && item !== 'default');
    }

    // Normalizar y quitar duplicados
    const localesUnicos = [...new Set(listaLocales)];

    return res.status(200).json(localesUnicos);
  } catch (err) {
    console.error("❌ Error en GET /api/locales:", err.message);
    return res.status(200).json([]);
  }
});

// 4.2 Obtener los productos/menú de un cliente específico
app.get('/api/menu', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(200).json([]);
    }

    const { local } = req.query;
    const filtro = local ? { local } : {};
    const platos = await Menu.find(filtro).lean();
    return res.status(200).json(platos || []);
  } catch (err) {
    console.error("❌ Error en GET /api/menu:", err.message);
    return res.status(200).json([]);
  }
});

// 4.3 Crear nuevo producto o registrar nuevo local
app.post('/api/menu', async (req, res) => {
  try {
    const { local, fechaVencimiento, nombre, precio, categoria } = req.body;

    // Registrar en colección 'locals' para que aparezca en SuperAdmin
    if (local) {
      await Local.updateOne(
        { local: local },
        { 
          $set: { 
            local: local, 
            nombre: local,
            fechaVencimiento: fechaVencimiento ? new Date(fechaVencimiento) : null 
          } 
        },
        { upsert: true }
      );
    }

    // Guardar el producto en la colección 'menus'
    const nuevoPlato = new Menu({
      local: local || 'default',
      categoria: categoria || 'General',
      nombre: nombre || 'Producto Inicial',
      precio: precio || 1000,
      fechaVencimiento: fechaVencimiento ? new Date(fechaVencimiento) : null
    });

    await nuevoPlato.save();
    return res.status(201).json(nuevoPlato);

  } catch (err) {
    console.error("❌ Error en POST /api/menu:", err.message);
    return res.status(500).json({ error: 'Error al guardar en MongoDB', detalle: err.message });
  }
});

// 4.4 Editar/Actualizar un producto existente
app.put('/api/menu/:id', async (req, res) => {
  try {
    const productoActualizado = await Menu.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    return res.status(200).json(productoActualizado);
  } catch (err) {
    console.error("❌ Error en PUT /api/menu:", err.message);
    return res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

// 4.5 Eliminar un producto
app.delete('/api/menu/:id', async (req, res) => {
  try {
    await Menu.findByIdAndDelete(req.params.id);
    return res.status(200).json({ mensaje: 'Producto eliminado correctamente' });
  } catch (err) {
    console.error("❌ Error en DELETE /api/menu:", err.message);
    return res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// Ruta base
app.get('/', (req, res) => {
  res.send('🚀 API AppMenu ejecutándose perfectamente.');
});

// --- 5. ARRANQUE DEL SERVIDOR ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
});
