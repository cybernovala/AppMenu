const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Conexión a MongoDB Atlas
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:juan2073@cluster0.mongodb.net/appmenu?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Conectado Exitosamente'))
  .catch(err => console.error('❌ Error al conectar a MongoDB:', err));

// Esquema de Menú (Donde se registran los locales)
const MenuSchema = new mongoose.Schema({
  local: { type: String, required: true, index: true },
  categoria: { type: String, default: 'General' },
  nombre: { type: String, default: 'Producto Inicial' },
  precio: { type: Number, default: 0 },
  fechaVencimiento: { type: Date }
}, { timestamps: true });

const Menu = mongoose.model('Menu', MenuSchema);

// --- RUTAS API ---

// 1. OBTENER LISTA DE TODOS LOS CLIENTES REGISTRADOS EN MONGO
app.get('/api/locales', async (req, res) => {
  try {
    // Obtiene únicamente los nombres de 'local' únicos que no sean nulos
    const locales = await Menu.distinct('local', { local: { $ne: null, $exists: true } });
    
    // Si no existen locales, devuelve arreglo vacío
    res.json(locales || []);
  } catch (err) {
    console.error("Error consultando locales en Mongo:", err);
    res.status(500).json({ error: 'Error al obtener los clientes de MongoDB' });
  }
});

// 2. OBTENER MENÚ DE UN LOCAL
app.get('/api/menu', async (req, res) => {
  try {
    const { local } = req.query;
    const filtro = local ? { local } : {};
    const platos = await Menu.find(filtro);
    res.json(platos);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener el menú' });
  }
});

// 3. CREAR NUEVO CLIENTE / PRODUCTO
app.post('/api/menu', async (req, res) => {
  try {
    const nuevoPlato = new Menu(req.body);
    await nuevoPlato.save();
    res.status(201).json(nuevoPlato);
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar en MongoDB' });
  }
});

// 4. ELIMINAR PRODUCTO
app.delete('/api/menu/:id', async (req, res) => {
  try {
    await Menu.findByIdAndDelete(req.params.id);
    res.json({ mensaje: 'Producto eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`));
