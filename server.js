const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const ARCHIVO_PEDIDOS = path.join(__dirname, 'pedidos.json');

const obtenerPedidos = () => {
  if (!fs.existsSync(ARCHIVO_PEDIDOS)) return [];
  const data = fs.readFileSync(ARCHIVO_PEDIDOS, 'utf-8');
  return data ? JSON.parse(data) : [];
};

const guardarPedidos = (pedidos) => {
  fs.writeFileSync(ARCHIVO_PEDIDOS, JSON.stringify(pedidos, null, 2));
};

app.get('/api/pedidos', (req, res) => {
  res.json(obtenerPedidos());
});

app.post('/api/pedidos', (req, res) => {
  const { mesa, items, total } = req.body;
  if (!mesa || !items || items.length === 0) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  const pedidos = obtenerPedidos();
  const nuevoPedido = {
    id: Date.now(),
    mesa,
    items,
    total,
    estado: 'Pendiente',
    hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
  };

  pedidos.push(nuevoPedido);
  guardarPedidos(pedidos);

  res.status(201).json({ mensaje: 'Pedido recibido', pedido: nuevoPedido });
});

app.patch('/api/pedidos/:id', (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  
  let pedidos = obtenerPedidos();
  const index = pedidos.findIndex(p => p.id == id);
  
  if (index !== -1) {
    if (estado === 'Eliminar') {
      pedidos.splice(index, 1);
    } else {
      pedidos[index].estado = estado;
    }
    guardarPedidos(pedidos);
    return res.json({ mensaje: 'Pedido actualizado' });
  }
  
  res.status(404).json({ error: 'Pedido no encontrado' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));