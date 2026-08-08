const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// ------------------- CONEXIÓN A MONGODB ATLAS -------------------
const MONGO_URI = "mongodb+srv://admin:juan2073@cluster0.w3kjxzs.mongodb.net/appmenu?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Conectado con éxito a MongoDB Atlas'))
  .catch(err => console.error('❌ Error de conexión a MongoDB:', err));

// ------------------- MODELOS DE DATOS (ESQUEMAS) -------------------

// 1. Esquema de Locales (Sustituye a db[local])
const LocalSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  fechaCreacion: { type: String, required: true },
  fechaVencimiento: { type: String, required: true },
  menu: { type: Array, default: [] }
});

// 2. Esquema de Pedidos Activos
const PedidoSchema = new mongoose.Schema({
  id: { type: Number, required: true },
  local: { type: String, required: true },
  mesa: { type: String, required: true },
  items: { type: Array, required: true },
  total: { type: Number, required: true },
  estado: { type: String, default: 'pendiente' },
  hora: { type: String, required: true }
});

// 3. Esquema del Historial de Entregas (Garzones)
const HistorialSchema = new mongoose.Schema({
  id: { type: Number, required: true },
  local: { type: String, required: true },
  mesa: { type: String, required: true },
  items: { type: Array, required: true },
  total: { type: Number, required: true },
  estado: { type: String, required: true },
  hora: { type: String, required: true },
  rutGarzon: { type: String, required: true },
  horaEntrega: { type: String, required: true },
  fechaEntrega: { type: String, required: true }
});

const Local = mongoose.model('Local', LocalSchema);
const Pedido = mongoose.model('Pedido', PedidoSchema);
const Historial = mongoose.model('Historial', HistorialSchema);

// ------------------- RUTAS DE MENÚ Y PEDIDOS -------------------

app.get('/api/menu', async (req, res) => {
  try {
    const { local } = req.query;
    const localData = await Local.findOne({ id: local });
    res.json(localData ? localData.menu || [] : []);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener el menú' });
  }
});

app.post('/api/menu', async (req, res) => {
  try {
    const { local, password, menu } = req.body;
    const localDoc = await Local.findOne({ id: local });

    if (!localDoc) return res.status(404).json({ error: 'El restaurante no existe.' });
    if (localDoc.password !== password) return res.status(403).json({ error: 'Contraseña incorrecta.' });

    localDoc.menu = menu;
    await localDoc.save();
    res.json({ mensaje: 'Menú actualizado correctamente.' });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar el menú' });
  }
});

app.post('/api/pedidos', async (req, res) => {
  try {
    const { local, mesa, items, total } = req.body;
    const localDoc = await Local.findOne({ id: local });

    if (localDoc && localDoc.fechaVencimiento) {
      const hoy = new Date();
      const vencimiento = new Date(localDoc.fechaVencimiento);
      if (hoy > vencimiento) {
        return res.status(402).json({ error: 'El servicio de este restaurante se encuentra suspendido por mantenimiento.' });
      }
    }

    const nuevoPedido = new Pedido({
      id: Date.now(),
      local,
      mesa,
      items,
      total,
      estado: 'pendiente',
      hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
    });

    await nuevoPedido.save();
    res.json({ mensaje: 'Pedido recibido', pedido: nuevoPedido });
  } catch (err) {
    res.status(500).json({ error: 'Error al registrar el pedido' });
  }
});

app.get('/api/pedidos', async (req, res) => {
  try {
    const { local } = req.query;
    const pedidos = await Pedido.find({ local }).sort({ id: -1 });
    res.json(pedidos);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener los pedidos' });
  }
});

// ------------------- RUTAS PARA EL GARZÓN Y HISTORIAL -------------------

app.get('/api/pedidos/garzon', async (req, res) => {
  try {
    const { local } = req.query;
    const pedidos = await Pedido.find({ local }).sort({ id: -1 });
    res.json(pedidos);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener pedidos para el garzón' });
  }
});

app.post('/api/pedidos/entregar', async (req, res) => {
  try {
    const { local, id, rutGarzon } = req.body;
    if (!rutGarzon) return res.status(400).json({ error: 'El RUT o ID del garzón es obligatorio' });

    // Buscar y eliminar de pedidos pendientes
    const pedidoEntregado = await Pedido.findOneAndDelete({ local, id });

    if (pedidoEntregado) {
      // Registrar en el historial permanente
      const nuevoHistorial = new Historial({
        id: pedidoEntregado.id,
        local: pedidoEntregado.local,
        mesa: pedidoEntregado.mesa,
        items: pedidoEntregado.items,
        total: pedidoEntregado.total,
        estado: pedidoEntregado.estado,
        hora: pedidoEntregado.hora,
        rutGarzon,
        horaEntrega: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
        fechaEntrega: new Date().toISOString().split('T')[0]
      });

      await nuevoHistorial.save();
      return res.json({ mensaje: 'Pedido entregado en mesa y registrado en historial', pedido: pedidoEntregado });
    }

    res.status(404).json({ error: 'Pedido no encontrado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al procesar la entrega' });
  }
});

app.get('/api/garzon/historial', async (req, res) => {
  try {
    const { local, rutGarzon } = req.query;
    const filtro = { local };
    if (rutGarzon) filtro.rutGarzon = rutGarzon;

    const historial = await Historial.find(filtro);
    res.json(historial);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener el historial' });
  }
});

// ------------------- RUTAS DE SUSCRIPCIÓN Y SUPERADMIN -------------------

app.get('/api/superadmin/locales', async (req, res) => {
  try {
    const { clave } = req.query;
    if (clave !== 'superadmin123') return res.status(403).json({ error: 'Clave Maestra incorrecta' });

    const locales = await Local.find();
    const listaLocales = locales.map(doc => {
      const hoy = new Date();
      const fechaVenc = new Date(doc.fechaVencimiento || hoy);
      const diffTiempo = fechaVenc - hoy;
      const diasRestantes = Math.ceil(diffTiempo / (1000 * 60 * 60 * 24));

      return {
        id: doc.id,
        fechaCreacion: doc.fechaCreacion || 'N/A',
        fechaVencimiento: doc.fechaVencimiento || 'N/A',
        diasRestantes,
        activo: diasRestantes >= 0,
        totalProductosMenu: (doc.menu || []).reduce((acc, cat) => acc + (cat.productos ? cat.productos.length : 0), 0)
      };
    });

    res.json(listaLocales);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener los locales' });
  }
});

app.post('/api/superadmin/crear-local', async (req, res) => {
  try {
    const { claveSuperAdmin, local, passwordCliente } = req.body;
    if (claveSuperAdmin !== 'superadmin123') return res.status(403).json({ error: 'Clave Maestra incorrecta' });

    const existe = await Local.findOne({ id: local });
    if (existe) return res.status(400).json({ error: 'El restaurante ya existe' });

    const hoy = new Date();
    const vencimiento = new Date();
    vencimiento.setDate(hoy.getDate() + 30);

    const nuevoLocal = new Local({
      id: local,
      password: passwordCliente,
      fechaCreacion: hoy.toISOString().split('T')[0],
      fechaVencimiento: vencimiento.toISOString().split('T')[0],
      menu: []
    });

    await nuevoLocal.save();
    res.json({ mensaje: 'Restaurante creado con éxito', fechaVencimiento: nuevoLocal.fechaVencimiento });
  } catch (err) {
    res.status(500).json({ error: 'Error al crear el restaurante' });
  }
});

app.post('/api/superadmin/renovar-pago', async (req, res) => {
  try {
    const { claveSuperAdmin, local } = req.body;
    if (claveSuperAdmin !== 'superadmin123') return res.status(403).json({ error: 'Clave Maestra incorrecta' });

    const localDoc = await Local.findOne({ id: local });
    if (!localDoc) return res.status(404).json({ error: 'Local no encontrado' });

    const hoy = new Date();
    let fechaBase = new Date(localDoc.fechaVencimiento);

    if (isNaN(fechaBase.getTime()) || fechaBase < hoy) {
      fechaBase = new Date();
    }

    fechaBase.setDate(fechaBase.getDate() + 30);
    localDoc.fechaVencimiento = fechaBase.toISOString().split('T')[0];

    await localDoc.save();
    res.json({ mensaje: 'Pago registrado con éxito', nuevaFecha: localDoc.fechaVencimiento });
  } catch (err) {
    res.status(500).json({ error: 'Error al renovar pago' });
  }
});

app.get('/api/superadmin/backup', async (req, res) => {
  try {
    const { clave } = req.query;
    if (clave !== 'superadmin123') return res.status(403).json({ error: 'Clave Maestra incorrecta' });

    const locales = await Local.find();
    const backupData = {};
    locales.forEach(l => {
      backupData[l.id] = {
        password: l.password,
        fechaCreacion: l.fechaCreacion,
        fechaVencimiento: l.fechaVencimiento,
        menu: l.menu
      };
    });

    res.json(backupData);
  } catch (err) {
    res.status(500).json({ error: 'Error al generar backup' });
  }
});

app.post('/api/superadmin/restore', async (req, res) => {
  try {
    const { clave, backupData } = req.body;
    if (clave !== 'superadmin123') return res.status(403).json({ error: 'Clave Maestra incorrecta' });

    for (const key of Object.keys(backupData)) {
      await Local.findOneAndUpdate(
        { id: key },
        {
          password: backupData[key].password,
          fechaCreacion: backupData[key].fechaCreacion,
          fechaVencimiento: backupData[key].fechaVencimiento,
          menu: backupData[key].menu
        },
        { upsert: true, new: true }
      );
    }

    res.json({ mensaje: 'Base de datos restaurada correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al restaurar la base de datos' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor iniciado en puerto ${PORT}`));