const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// --- CONEXIÓN A MONGO DB ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/restaurantes_db';

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ Conectado exitosamente a MongoDB'))
  .catch(err => console.error('❌ Error al conectar a MongoDB:', err));

// --- ESQUEMAS MONGO DB ---

// Schema para Locales / Licencias
const LocalSchema = new mongoose.Schema({
  nombre: { type: String, required: true, unique: true, lowercase: true, trim: true },
  activo: { type: Boolean, default: true },
  fechaVencimiento: { type: Date, default: () => new Date(+new Date() + 30*24*60*60*1000) } // 30 días por defecto
}, { timestamps: true });

// Schema para Productos del Menú
const MenuSchema = new mongoose.Schema({
  local: { type: String, required: true, lowercase: true, trim: true },
  categoria: { type: String, required: true, trim: true },
  nombre: { type: String, required: true, trim: true },
  precio: { type: Number, required: true }
}, { timestamps: true });

// Schema para Pedidos
const PedidoSchema = new mongoose.Schema({
  local: { type: String, required: true, lowercase: true, trim: true },
  mesa: { type: String, required: true },
  items: Array,
  total: { type: Number, required: true },
  estado: { type: String, default: 'pendiente' }, // 'pendiente' o 'entregado'
  fecha: { type: Date, default: Date.now }
}, { timestamps: true });

// Schema para Historial
const HistorialSchema = new mongoose.Schema({
  local: { type: String, required: true, lowercase: true, trim: true },
  mesa: { type: String, required: true },
  items: Array,
  total: { type: Number, required: true },
  rutGarzon: { type: String, required: true },
  horaEntrega: String,
  fechaEntrega: String
}, { timestamps: true });

const Local = mongoose.model('Local', LocalSchema);
const Menu = mongoose.model('Menu', MenuSchema);
const Pedido = mongoose.model('Pedido', PedidoSchema);
const Historial = mongoose.model('Historial', HistorialSchema);

// --- RUTAS API ---

// 1. Obtener o consultar estado de Licencia y Bloqueo
app.get('/api/licencia', async (req, res) => {
  try {
    const localNombre = (req.query.local || 'default').toLowerCase().trim();
    let local = await Local.findOne({ nombre: localNombre });
    
    if (!local) {
      local = await Local.create({ nombre: localNombre, activo: true });
    }

    res.json({
      local: local.nombre,
      activo: local.activo,
      bloqueado: !local.activo,
      fechaVencimiento: local.fechaVencimiento
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Rutas Superadmin: Obtener todos los locales y alternar estado (Activar / Desactivar)
app.get('/api/superadmin/locales', async (req, res) => {
  try {
    const locales = await Local.find().sort({ createdAt: -1 });
    res.json(locales);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/superadmin/locales/toggle', async (req, res) => {
  try {
    const { local, activo } = req.body;
    const localNombre = String(local).toLowerCase().trim();
    
    const localActualizado = await Local.findOneAndUpdate(
      { nombre: localNombre },
      { activo: Boolean(activo) },
      { new: true, upsert: true }
    );

    res.json({ success: true, local: localActualizado });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Menú - Middleware interno para verificar actividad
async function verificarLocalActivo(localNombre) {
  const local = await Local.findOne({ nombre: localNombre.toLowerCase().trim() });
  return !local || local.activo; // Si no existe o está activo retorna true
}

app.get('/api/menu', async (req, res) => {
  try {
    const local = (req.query.local || 'default').toLowerCase().trim();
    const activo = await verificarLocalActivo(local);
    if (!activo) {
      return res.status(403).json({ error: 'El restaurante se encuentra desactivado.' });
    }

    const items = await Menu.find({ local });
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/menu', async (req, res) => {
  try {
    const { local, categoria, nombre, precio } = req.body;
    const nuevoProducto = await Menu.create({ local: local.toLowerCase().trim(), categoria, nombre, precio });
    res.status(201).json(nuevoProducto);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/menu/del', async (req, res) => {
  try {
    const { local, categoria, index } = req.query;
    const items = await Menu.find({ local: local.toLowerCase().trim(), categoria });
    if (items[index]) {
      await Menu.findByIdAndDelete(items[index]._id);
      return res.json({ success: true });
    }
    res.status(404).json({ error: 'Producto no encontrado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/menu/edit', async (req, res) => {
  try {
    const { local, categoriaOriginal, indexOriginal, nuevoNombre, nuevoPrecio, nuevaCategoria } = req.body;
    const items = await Menu.find({ local: local.toLowerCase().trim(), categoria: categoriaOriginal });
    if (items[indexOriginal]) {
      const prod = items[indexOriginal];
      prod.nombre = nuevoNombre;
      prod.precio = nuevoPrecio;
      prod.categoria = nuevaCategoria;
      await prod.save();
      return res.json({ success: true });
    }
    res.status(404).json({ error: 'Producto no encontrado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Pedidos
app.get('/api/pedidos', async (req, res) => {
  try {
    const local = (req.query.local || 'default').toLowerCase().trim();
    const activo = await verificarLocalActivo(local);
    if (!activo) return res.status(403).json({ error: 'Restaurante desactivado.' });

    const pedidos = await Pedido.find({ local });
    res.json(pedidos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/pedidos', async (req, res) => {
  try {
    const { local, mesa, items, total } = req.body;
    const localNombre = String(local).toLowerCase().trim();
    const activo = await verificarLocalActivo(localNombre);
    if (!activo) return res.status(403).json({ error: 'Restaurante desactivado.' });

    const nuevoPedido = await Pedido.create({ local: localNombre, mesa, items, total });
    res.status(201).json(nuevoPedido);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/pedidos/:id', async (req, res) => {
  try {
    await Pedido.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Historial
app.get('/api/historials', async (req, res) => {
  try {
    const local = (req.query.local || 'default').toLowerCase().trim();
    const registros = await Historial.find({ local }).sort({ createdAt: -1 });
    res.json(registros);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/historials', async (req, res) => {
  try {
    const { local, mesa, items, total, rutGarzon, horaEntrega, fechaEntrega } = req.body;
    const nuevoReg = await Historial.create({
      local: String(local).toLowerCase().trim(),
      mesa, items, total, rutGarzon, horaEntrega, fechaEntrega
    });
    res.status(201).json(nuevoReg);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
