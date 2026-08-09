const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Conexión a MongoDB Atlas
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:juan2073@cluster0.mongodb.net/appmenu?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Conectado Exitosamente'))
  .catch(err => console.error('Error al conectar a MongoDB:', err));

// Esquema de Menú
const MenuSchema = new mongoose.Schema({
  local: { type: String, required: true },
  categoria: String,
  nombre: String,
  precio: Number,
  fechaVencimiento: Date
});

const Menu = mongoose.model('Menu', MenuSchema);

// Esquema de Pedidos (Cocina / Garzón)
const PedidoSchema = new mongoose.Schema({
  local: { type: String, required: true },
  mesa: String,
  items: Array,
  estado: { type: String, default: 'pendiente' },
  fecha: { type: Date, default: Date.now }
});

const Pedido = mongoose.model('Pedido', PedidoSchema);

// --- RUTAS DE LA API ---

// 1. Obtener la lista de todos los locales/clientes registrados en MongoDB
app.get('/api/locales', async (req, res) => {
  try {
    const locales = await Menu.distinct('local');
    res.json(locales);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener clientes desde MongoDB' });
  }
});

// 2. Obtener el menú de un local
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

// 3. Crear plato o inicializar cliente
app.post('/api/menu', async (req, res) => {
  try {
    const nuevoPlato = new Menu(req.body);
    await nuevoPlato.save();
    res.status(201).json(nuevoPlato);
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar producto' });
  }
});

// 4. Eliminar plato
app.delete('/api/menu/:id', async (req, res) => {
  try {
    await Menu.findByIdAndDelete(req.params.id);
    res.json({ mensaje: 'Producto eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// 5. Pedidos - Obtener por local
app.get('/api/pedidos', async (req, res) => {
  try {
    const { local } = req.query;
    const filtro = local ? { local } : {};
    const pedidos = await Pedido.find(filtro).sort({ fecha: -1 });
    res.json(pedidos);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener pedidos' });
  }
});

// 6. Pedidos - Crear pedido
app.post('/api/pedidos', async (req, res) => {
  try {
    const nuevoPedido = new Pedido(req.body);
    await nuevoPedido.save();
    res.status(201).json(nuevoPedido);
  } catch (err) {
    res.status(500).json({ error: 'Error al crear el pedido' });
  }
});

// 7. Pedidos - Cambiar estado
app.put('/api/pedidos/:id', async (req, res) => {
  try {
    const { estado } = req.body;
    const pedidoActualizado = await Pedido.findByIdAndUpdate(req.params.id, { estado }, { new: true });
    res.json(pedidoActualizado);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar pedido' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor escuchando en el puerto ${PORT}`));
