const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Base de datos en memoria para el menú (Puedes adaptar con JSON o MongoDB más adelante)
let menus = {
  "default": [
    {
      categoria: "Entradas",
      productos: [
        { nombre: "Empanadas de Pino", precio: 2500 },
        { nombre: "Papas Fry Neon", precio: 3800 }
      ]
    },
    {
      categoria: "Hamburguesas",
      productos: [
        { nombre: "Burger Cyber", precio: 6900 },
        { nombre: "Burger Doble Queso", precio: 7500 }
      ]
    },
    {
      categoria: "Bebidas",
      productos: [
        { nombre: "Coca Cola 350ml", precio: 1500 },
        { nombre: "Jugo Natural", precio: 2200 }
      ]
    }
  ]
};

// Pedidos temporales agrupados por local
let pedidosTemp = {};

// GET: Obtener el menú de un local
app.get('/api/menu', (req, res) => {
  const local = req.query.local || 'default';
  if (!menus[local]) {
    menus[local] = menus['default']; // Asigna menú por defecto si no existe
  }
  res.json(menus[local]);
});

// POST: Guardar/Actualizar el menú desde el Administrador
app.post('/api/menu', (req, res) => {
  const { local, menu } = req.body;
  if (!local || !menu) return res.status(400).json({ error: 'Faltan parámetros' });
  menus[local] = menu;
  res.json({ mensaje: 'Menú guardado correctamente' });
});

// GET: Obtener los pedidos activos de un local (Para la Cocina)
app.get('/api/pedidos', (req, res) => {
  const local = req.query.local || 'default';
  res.json(pedidosTemp[local] || []);
});

// POST: Enviar un nuevo pedido desde el Cliente (Celular)
app.post('/api/pedidos', (req, res) => {
  const { local, mesa, items, total } = req.body;
  if (!local || !mesa || !items || items.length === 0) {
    return res.status(400).json({ error: 'Datos de pedido inválidos' });
  }

  if (!pedidosTemp[local]) pedidosTemp[local] = [];

  const nuevoPedido = {
    id: Date.now(),
    mesa: mesa,
    items: items,
    total: total,
    hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
    estado: 'en_preparacion' // 'en_preparacion', 'listo'
  };

  pedidosTemp[local].push(nuevoPedido);
  res.json({ mensaje: 'Pedido recibido', pedido: nuevoPedido });
});

// GET: Obtener pedidos para la vista del Garzón
app.get('/api/pedidos/garzon', (req, res) => {
  const local = req.query.local || 'default';
  res.json(pedidosTemp[local] || []);
});

// POST: Cambiar estado o eliminar pedido al ser entregado en mesa
app.post('/api/pedidos/entregar', (req, res) => {
  const { local, id } = req.body;
  if (!pedidosTemp[local]) return res.status(404).json({ error: 'No hay pedidos activos' });

  const index = pedidosTemp[local].findIndex(p => p.id === id);
  if (index !== -1) {
    pedidosTemp[local].splice(index, 1); // Lo borra de la lista activa (cocina y garzón)
    return res.json({ mensaje: 'Pedido entregado en mesa y eliminado de cocina' });
  }
  res.status(404).json({ error: 'Pedido no encontrado' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});