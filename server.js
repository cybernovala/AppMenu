const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

// Middlewares
app.use(cors());
app.use(express.json());

// --- CONEXIÓN A MONGODB ATLAS ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:password@cluster.mongodb.net/appmenu?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ Conectado exitosamente a MongoDB Atlas"))
  .catch(err => console.error("❌ Error de conexión a MongoDB:", err));

// --- MODELO DE MONGOOSE PARA PRODUCTOS ---
const ProductoSchema = new mongoose.Schema({
  local: { type: String, required: true, default: 'mongo', lowercase: true, trim: true },
  categoria: { type: String, required: true, default: 'General', trim: true },
  nombre: { type: String, required: true, trim: true },
  precio: { type: Number, required: true }
}, { timestamps: true });

const Producto = mongoose.model('Producto', ProductoSchema);

// --- BASE DE DATOS EN MEMORIA PARA PEDIDOS DE COCINA ---
let pedidosMemoria = [];

// ==========================================
// 1. RUTAS DE MENÚ Y CARTA (MONGODB)
// ==========================================

// Obtener productos de un local
app.get('/api/menu', async (req, res) => {
  try {
    const local = (req.query.local || 'mongo').toLowerCase().trim();
    const productos = await Producto.find({ local }).sort({ createdAt: 1 });
    res.json(productos);
  } catch (error) {
    console.error("❌ Error al obtener menú:", error);
    res.status(500).json({ error: "Error al obtener el menú desde la base de datos" });
  }
});

// Guardar un nuevo producto
app.post('/api/menu', async (req, res) => {
  try {
    const { local, categoria, nombre, precio } = req.body;
    
    if (!nombre || precio === undefined || precio === null) {
      return res.status(400).json({ error: "Faltan campos obligatorios: nombre o precio" });
    }

    const nuevoProducto = new Producto({
      local: (local || 'mongo').toLowerCase().trim(),
      categoria: categoria ? categoria.trim() : 'General',
      nombre: nombre.trim(),
      precio: Number(precio)
    });

    await nuevoProducto.save();
    res.status(201).json({ mensaje: "Producto guardado con éxito", producto: nuevoProducto });
  } catch (error) {
    console.error("❌ Error al guardar producto:", error);
    res.status(500).json({ error: "Error interno al guardar el producto" });
  }
});

// Eliminar producto por ID de MongoDB
app.delete('/api/menu/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await Producto.findByIdAndDelete(id);
    res.json({ mensaje: "Producto eliminado correctamente" });
  } catch (error) {
    console.error("❌ Error al eliminar producto:", error);
    res.status(500).json({ error: "Error al eliminar el producto" });
  }
});

// ==========================================
// 2. RUTAS DE PEDIDOS EN TIEMPO REAL (COCINA)
// ==========================================

// Crear pedido desde el cliente
app.post('/api/pedidos', (req, res) => {
  try {
    const { local, mesa, items, total } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "El pedido está vacío" });
    }

    const nuevoPedido = {
      _id: Date.now().toString(),
      local: (local || 'mongo').toLowerCase().trim(),
      mesa: mesa || '1',
      items: items || [],
      total: total || 0,
      hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
    };

    pedidosMemoria.push(nuevoPedido);
    console.log(`📩 Pedido recibido - Mesa ${nuevoPedido.mesa} ($${nuevoPedido.total})`);

    return res.status(200).json({ mensaje: 'Pedido recibido en cocina exitosamente', pedido: nuevoPedido });
  } catch (error) {
    return res.status(500).json({ error: "Error al procesar el pedido" });
  }
});

// Obtener lista de pedidos activos para Cocina
app.get('/api/pedidos', (req, res) => {
  const local = (req.query.local || 'mongo').toLowerCase().trim();
  const pedidosLocal = pedidosMemoria.filter(p => p.local === local);
  return res.status(200).json(pedidosLocal);
});

// Despachar / eliminar pedido de la cocina
app.delete('/api/pedidos/:id', (req, res) => {
  const { id } = req.params;
  pedidosMemoria = pedidosMemoria.filter(p => p._id !== id);
  return res.status(200).json({ mensaje: 'Pedido despachado y removido de la cocina' });
});

// --- RUTA RAIZ DE SALUD Y PRUEBA ---
app.get('/', (req, res) => {
  res.send('🚀 Servidor del Menú Digital activo y listo.');
});

// --- INICIO DEL SERVIDOR ---
app.listen(PORT, () => {
  console.log(`🔥 Servidor corriendo en el puerto ${PORT}`);
});
