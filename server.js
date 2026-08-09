const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// --- 1. CONFIGURACIÓN DE CORS COMPLETA Y GLOBAL ---
app.use(cors({
  origin: '*', // Permite peticiones desde GitHub Pages (o cualquier origen)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Habilitar pre-flight para todas las rutas
app.options('*', cors());

app.use(express.json());

// --- 2. CONEXIÓN A MONGO DB ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:juan2073@cluster0.mongodb.net/appmenu?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Conectado Exitosamente'))
  .catch(err => console.error('❌ Error crítico al conectar a MongoDB:', err));

// --- 3. ESQUEMA Y MODELO ---
const MenuSchema = new mongoose.Schema({
  local: { type: String, required: true, index: true },
  categoria: { type: String, default: 'General' },
  nombre: { type: String, default: 'Producto Inicial' },
  precio: { type: Number, default: 0 },
  fechaVencimiento: { type: Date }
}, { timestamps: true });

// Evita duplicar o redefinir el modelo si Node se reinicia
const Menu = mongoose.models.Menu || mongoose.model('Menu', MenuSchema);

// --- 4. RUTAS API DE LOCALES / CLIENTES ---

// Endpoint para obtener todos los clientes creados
app.get('/api/locales', async (req, res) => {
  try {
    // Si la conexión a Mongo no está lista, responder con arreglo vacío en lugar de crash 500
    if (mongoose.connection.readyState !== 1) {
      console.warn("⚠️ MongoDB aún no está completamente conectado.");
      return res.status(200).json([]);
    }

    // Obtener valores únicos del campo 'local'
    const locales = await Menu.distinct('local');
    const filtrados = (locales || []).filter(item => item && item !== 'default');
    
    return res.status(200).json(filtrados);
  } catch (err) {
    console.error("❌ Error en GET /api/locales:", err.message);
    // Devuelve 200 con un arreglo vacío para evitar bloquar el JS del frontend
    return res.status(200).json([]);
  }
});

// Endpoint para obtener platos/menú
app.get('/api/menu', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(200).json([]);
    }

    const { local } = req.query;
    const filtro = local ? { local } : {};
    const platos = await Menu.find(filtro);
    return res.status(200).json(platos || []);
  } catch (err) {
    console.error("❌ Error en GET /api/menu:", err.message);
    return res.status(200).json([]);
  }
});

// Endpoint para crear platos o nuevos locales
app.post('/api/menu', async (req, res) => {
  try {
    const nuevoPlato = new Menu(req.body);
    await nuevoPlato.save();
    return res.status(201).json(nuevoPlato);
  } catch (err) {
    console.error("❌ Error en POST /api/menu:", err.message);
    return res.status(500).json({ error: 'Error al guardar en MongoDB', detalle: err.message });
  }
});

// Endpoint para eliminar un producto
app.delete('/api/menu/:id', async (req, res) => {
  try {
    await Menu.findByIdAndDelete(req.params.id);
    return res.status(200).json({ mensaje: 'Producto eliminado correctamente' });
  } catch (err) {
    console.error("❌ Error en DELETE /api/menu:", err.message);
    return res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// Ruta base de diagnóstico
app.get('/', (req, res) => {
  res.send('🚀 API AppMenu funcionando correctamente.');
});

// --- 5. INICIALIZACIÓN DEL SERVIDOR ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
