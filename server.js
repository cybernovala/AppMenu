const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());

// --- CONEXIÓN A MONGODB ATLAS ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:password@cluster.mongodb.net/appmenu?retryWrites=true&w=w-majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ Conectado exitosamente a MongoDB Atlas"))
  .catch(err => console.error("❌ Error de conexión a MongoDB:", err));

// --- MODELO DE MONGOOSE PARA EL MENÚ ---
const ProductoSchema = new mongoose.Schema({
  local: { type: String, required: true, default: 'mongo' },
  categoria: { type: String, required: true, default: 'General' },
  nombre: { type: String, required: true },
  precio: { type: Number, required: true }
}, { timestamps: true });

const Producto = mongoose.model('Producto', ProductoSchema);


// --- BASE DE DATOS EN MEMORIA PARA PEDIDOS DE COCINA ---
let pedidosMemoria = [];


// ==========================================
// 1. RUTAS DE MENÚ Y CARTA (MONGODB)
// ==========================================

// Obtener todos los productos de un local
app.get('/api/menu', async (req, res) => {
  try {
    const local = req.query.local || 'mongo';
    const productos = await Producto.find({ local });
    res.json(productos);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener el menú" });
  }
});

// Guardar un nuevo producto
app.post('/api/menu', async (req, res) => {
  try {
    const { local, categoria, nombre, precio } = req.body;
    
    if (!nombre || !precio) {
      return res.status(400).json({ error: "Faltan nombre o precio" });
    }

    const nuevoProducto = new Producto({
      local: local || 'mongo',
      categoria: categoria || 'General',
      nombre,
      precio: Number(precio)
    });

    await nuevoProducto.save();
    res.status(201).json({ mensaje: "Producto guardado con éxito", producto: nuevoProducto });
  } catch (error) {
    res.status(500).json({ error: "Error al guardar el producto" });
  }
});

// Eliminar un producto según categoría e índice
app.delete('/api/menu/del', async (req, res) => {
  try {
    const local = req.query.local || 'mongo';
    const categoria = req.query.categoria;
    const index = parseInt(req.query.index);

    if (isNaN(index) || !categoria) {
      return res.status(400).json({ error: "Parámetros inválidos" });
    }

    // Buscar los productos de esa categoría
    const productosCat = await Producto.find({ local, categoria });

    if (index >= 0 && index < productosCat.length) {
      const productoAEliminar = productosCat[index];
      await Producto.findByIdAndDelete(productoAEliminar._id);
      return res.json({ mensaje: "Producto eliminado correctamente" });
    } else {
      return res.status(404).json({ error: "Producto no encontrado en esa posición" });
    }
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar el producto" });
  }
});


// ==========================================
// 2. RUTAS DE PEDIDOS EN TIEMPO REAL (COCINA)
// ==========================================

// Enviar nuevo pedido desde la app/celular del cliente
app.post('/api/pedidos', (req, res) => {
  try {
    const { local, mesa, items, total } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "El pedido está vacío" });
    }

    const nuevoPedido = {
      _id: Date.now().toString(),
      local: local || 'mongo',
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

// Obtener la lista de pedidos activos para el panel de Cocina
app.get('/api/pedidos', (req, res) => {
  const local = req.query.local || 'mongo';
  const pedidosLocal = pedidosMemoria.filter(p => p.local === local);
  return res.status(200).json(pedidosLocal);
});

// Marcar un pedido como despachado/completado en Cocina
app.delete('/api/pedidos/:id', (req, res) => {
  const { id } = req.params;
  pedidosMemoria = pedidosMemoria.filter(p => p._id !== id);
  return res.status(200).json({ mensaje: 'Pedido despachado y removido de la cocina' });
});


// --- RUTA BASE DE PRUEBA ---
app.get('/', (req, res) => {
  res.send('🚀 Servidor del Menú Digital activo y funcionando correctamente.');
});

// --- INICIAR SERVIDOR ---
app.listen(PORT, () => {
  console.log(`🔥 Servidor corriendo en el puerto ${PORT}`);
});
