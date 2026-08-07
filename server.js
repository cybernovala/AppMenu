const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Función para obtener/crear la carpeta de datos de un cliente
const getLocalFolder = (localId) => {
  const idLimpio = (localId || 'default').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const dir = path.join(__dirname, 'datos_locales', idLimpio);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

const obtenerDatos = (archivoPath, porDefecto) => {
  if (!fs.existsSync(archivoPath)) return porDefecto;
  const data = fs.readFileSync(archivoPath, 'utf-8');
  return data ? JSON.parse(data) : porDefecto;
};

const guardarDatos = (archivoPath, datos) => {
  fs.writeFileSync(archivoPath, JSON.stringify(datos, null, 2));
};

// ================= API PEDIDOS =================
app.get('/api/pedidos', (req, res) => {
  const local = req.query.local || 'default';
  const folder = getLocalFolder(local);
  res.json(obtenerDatos(path.join(folder, 'pedidos.json'), []));
});

app.post('/api/pedidos', (req, res) => {
  const { local, mesa, items, total } = req.body;
  if (!mesa || !items || items.length === 0) {
    return res.status(400).json({ error: 'Faltan datos en el pedido' });
  }

  const folder = getLocalFolder(local);
  const archivoPedidos = path.join(folder, 'pedidos.json');
  const pedidos = obtenerDatos(archivoPedidos, []);

  const nuevoPedido = {
    id: Date.now(),
    mesa,
    items,
    total,
    estado: 'Pendiente',
    hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
  };

  pedidos.push(nuevoPedido);
  guardarDatos(archivoPedidos, pedidos);
  res.status(201).json({ mensaje: 'Pedido recibido', pedido: nuevoPedido });
});

app.patch('/api/pedidos/:id', (req, res) => {
  const { id } = req.params;
  const { local, estado } = req.body;
  const folder = getLocalFolder(local);
  const archivoPedidos = path.join(folder, 'pedidos.json');
  let pedidos = obtenerDatos(archivoPedidos, []);
  
  const index = pedidos.findIndex(p => p.id == id);
  if (index !== -1) {
    if (estado === 'Eliminar') {
      pedidos.splice(index, 1);
    } else {
      pedidos[index].estado = estado;
    }
    guardarDatos(archivoPedidos, pedidos);
    return res.json({ mensaje: 'Pedido actualizado' });
  }
  res.status(404).json({ error: 'Pedido no encontrado' });
});

// ================= API MENÚ =================
app.get('/api/menu', (req, res) => {
  const local = req.query.local || 'default';
  const folder = getLocalFolder(local);
  const menuPorDefecto = [
    {
      categoria: "Completos",
      productos: [
        { id: "1", nombre: "Completo Italiano", precio: 2990 }
      ]
    }
  ];
  res.json(obtenerDatos(path.join(folder, 'menu.json'), menuPorDefecto));
});

app.post('/api/menu', (req, res) => {
  const { local, password, menu } = req.body;
  if (password !== 'admin123') {
    return res.status(401).json({ error: 'Clave incorrecta' });
  }

  const folder = getLocalFolder(local);
  guardarDatos(path.join(folder, 'menu.json'), menu);
  res.json({ mensaje: 'Menú guardado con éxito' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));