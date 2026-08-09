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

// --- 2. CONEXIÓN A MONGO DB ---
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

// Esquema para la colección de menú ('menus')
const MenuSchema = new mongoose.Schema({
  local: { type: String, required: true, index: true },
  categoria: { type: String, default: 'General' },
  nombre: { type: String, default: 'Producto Inicial' },
  precio: { type: Number, default: 0 },
  fechaVencimiento: { type: Date }
}, { strict: false, timestamps: true });

const Local = mongoose.models.Local || mongoose.model('Local', LocalSchema, 'locals');
const Menu = mongoose.models.Menu || mongoose.model('Menu', MenuSchema, 'menus');

// --- 4. RUTAS API ---

// 1. OBTENER LISTA DE CLIENTES DESDE LA COLECCIÓN 'locals' (Y RESPALDO EN 'menus')
app.get('/api/locales', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(200).json([]);
    }

    // A. Consultar la colección 'locals'
    const docsLocals = await Local.find({}).lean();
    
    // Extraer identificadores de los documentos guardados en 'locals'
    let listaLocales = docsLocals.map(doc => {
      return doc.local || doc.slug || doc.id || doc.nombre || null;
    }).filter(Boolean);

    // B. Respaldo: Si la colección 'locals' estuviera vacía, buscar distintivos en 'menus'
    if (listaLocales.length === 0) {
      const distinctMenus = await Menu.distinct('local');
      listaLocales = (distinctMenus || []).filter(item => item && item !== 'default');
    }

    // Eliminar duplicados
    const localesUnicos = [...new Set(listaLocales)];

    return res.status(200).json(localesUnicos);
  } catch (err) {
    console.error("❌ Error en GET /api/locales:", err.message);
    return res.status(200).json([]);
  }
});

// 2. OBTENER MENÚ DE UN LOCAL
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

// 3. REGISTRAR CLIENTE TANTO EN 'locals' COMO EN 'menus'
app.post('/api/menu', async (req, res) => {
  try {
    const { local, fechaVencimiento, nombre, precio, categoria } = req.body;

    // Guardar en la colección 'locals'
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

    // Guardar producto en la colección 'menus'
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

// 4. ELIMINAR PRODUCTO
app.delete('/api/menu/:id', async (req, res) => {
  try {
    await Menu.findByIdAndDelete(req.params.id);
    return res.status(200).json({ mensaje: 'Producto eliminado correctamente' });
  } catch (err) {
    console.error("❌ Error en DELETE /api/menu:", err.message);
    return res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// Ruta de diagnóstico
app.get('/', (req, res) => {
  res.send('🚀 API AppMenu lista y vinculada a la colección locals.');
});

// --- 5. PUERTO Y ARRANQUE ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
});
