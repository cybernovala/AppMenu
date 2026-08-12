const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());
app.use(express.json());

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:juan2073@cluster0.w3kjxzs.mongodb.net/appmenu?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 5000
})
  .then(() => console.log('✅ MongoDB Conectado Exitosamente'))
  .catch(err => console.error('❌ Error crítico al conectar a MongoDB:', err.message));

// Transporter para envio de correos
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'tucorreo@gmail.com',
    pass: process.env.EMAIL_PASS || 'tuapppassword'
  }
});

async function enviarCorreoPassword(destino, localNombre, password) {
  try {
    if (!process.env.EMAIL_USER) {
      console.log(`[SIMULACIÓN EMAIL] Para: ${destino} | Local: ${localNombre} | Clave: ${password}`);
      return;
    }
    await transporter.sendMail({
      from: '"AppMenu System" <' + (process.env.EMAIL_USER || 'no-reply@appmenu.com') + '>',
      to: destino,
      subject: `Clave de Acceso - ${localNombre}`,
      html: `
        <h3>Configuración de Credenciales - AppMenu</h3>
        <p>Se han configurado/actualizado las credenciales para tu local: <b>${localNombre}</b>.</p>
        <p>Tu contraseña para ingresar al panel de gestión (Menú e Historial) es: <b>${password}</b></p>
      `
    });
  } catch (e) {
    console.error("Error al enviar email:", e.message);
  }
}

// ESQUEMAS Y MODELOS
const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});
const Counter = mongoose.models.Counter || mongoose.model('Counter', CounterSchema);

const LocalSchema = new mongoose.Schema({
  id: Number,
  local: String,
  nombre: String,
  rut: String,
  correo: String,
  password: String,
  activo: { type: Boolean, default: true },
  fechaCreacion: { type: String, default: () => new Date().toISOString() },
  fechaVencimiento: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
  menu: Array
}, { strict: false, timestamps: true });

const Local = mongoose.models.Local || mongoose.model('Local', LocalSchema, 'locals');

const PedidoSchema = new mongoose.Schema({
  local: String,
  mesa: String,
  items: Array,
  total: Number,
  estado: { type: String, default: 'pendiente' },
  fecha: { type: Date, default: Date.now }
}, { strict: false, timestamps: true });

const Pedido = mongoose.models.Pedido || mongoose.model('Pedido', PedidoSchema, 'pedidos');

const HistorialSchema = new mongoose.Schema({
  id: String,
  local: String,
  mesa: String,
  items: Array,
  total: Number,
  estado: { type: String, default: 'entregado' },
  hora: String,
  rutGarzon: String,
  horaEntrega: String,
  fechaEntrega: String
}, { strict: false, timestamps: true });

const Historial = mongoose.models.Historial || mongoose.model('Historial', HistorialSchema, 'historials');

async function getNextSequenceValue(sequenceName) {
  const sequenceDocument = await Counter.findByIdAndUpdate(
    sequenceName,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return sequenceDocument.seq;
}

function buildLocalFilter(queryVal) {
  if (!queryVal) return {};
  const trimmed = String(queryVal).toLowerCase().trim();
  const numVal = Number(trimmed);
  const filter = [
    { local: trimmed },
    { nombre: new RegExp(`^${trimmed}$`, 'i') }
  ];
  if (!isNaN(numVal)) {
    filter.push({ id: numVal });
  }
  return { $or: filter };
}

const verificarLicencia = async (req, res, next) => {
  try {
    const localQuery = (req.query.local || req.body.local || req.params.local || req.params.id || '').toLowerCase().trim();
    if (!localQuery) return next();
    const doc = await Local.findOne(buildLocalFilter(localQuery)).lean();
    if (!doc) {
      return res.status(404).json({ error: 'Local no registrado en base de datos.' });
    }
    if (doc.activo === false) {
      return res.status(403).json({ 
        error: 'LICENCIA_BLOQUEADA', 
        mensaje: 'El restaurante se encuentra desactivado por el administrador.' 
      });
    }
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Error interno al validar la licencia.' });
  }
};

// RUTAS API

app.get('/api/licencia', async (req, res) => {
  try {
    const localQuery = (req.query.local || '').toLowerCase().trim();
    if (!localQuery) return res.status(400).json({ error: 'Debe especificar el local' });

    const doc = await Local.findOne(buildLocalFilter(localQuery)).lean();
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    return res.status(200).json({
      id: doc.id,
      local: doc.local || String(doc.id),
      nombre: doc.nombre || doc.local,
      rut: doc.rut || '',
      correo: doc.correo || '',
      tienePassword: Boolean(doc.password),
      activo: doc.activo !== false,
      fechaCreacion: doc.fechaCreacion,
      fechaVencimiento: doc.fechaVencimiento
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al consultar estado de licencia' });
  }
});

app.get('/api/locales', async (req, res) => {
  try {
    const docs = await Local.find({}).sort({ id: 1 }).lean();
    const locales = docs.map(d => ({
      _id: d._id,
      id: d.id,
      localId: (d.local || String(d.id || '')).toLowerCase().trim(),
      nombre: d.nombre || d.local,
      rut: d.rut || '',
      correo: d.correo || '',
      password: d.password || '',
      activo: d.activo !== false,
      fechaCreacion: d.fechaCreacion,
      fechaVencimiento: d.fechaVencimiento
    }));
    return res.status(200).json(locales);
  } catch (err) {
    return res.status(500).json([]);
  }
});

// Validación de contraseña
app.post('/api/locales/auth', async (req, res) => {
  try {
    const { local, password } = req.body;
    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    if (!doc.password || doc.password === password) {
      return res.status(200).json({ ok: true, mensaje: 'Autenticación exitosa' });
    }
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al validar contraseña' });
  }
});

// Alta Demo / Darse de alta
app.post('/api/alta-demo', async (req, res) => {
  try {
    const { nombre, rut, correo, password } = req.body;

    if (!nombre || !rut || !correo || !password) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    const localSlug = nombre.toLowerCase().trim().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
    let docExistente = await Local.findOne(buildLocalFilter(localSlug));
    if (docExistente) {
      return res.status(400).json({ error: 'El nombre del local ya está en uso' });
    }

    const siguienteId = await getNextSequenceValue('local_id');
    const ahora = new Date();
    const fechaVencimiento = new Date(ahora.getTime() + (30 * 24 * 60 * 60 * 1000));

    const nuevoLocal = new Local({
      id: siguienteId,
      local: localSlug,
      nombre: nombre.trim(),
      rut: rut.trim(),
      correo: correo.trim().toLowerCase(),
      password: password.trim(),
      activo: true,
      fechaCreacion: ahora.toISOString(),
      fechaVencimiento: fechaVencimiento,
      menu: []
    });

    await nuevoLocal.save();
    enviarCorreoPassword(nuevoLocal.correo, nuevoLocal.nombre, nuevoLocal.password);

    return res.status(201).json({
      mensaje: 'Local dado de alta correctamente',
      id: nuevoLocal.id,
      local: nuevoLocal.local
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error interno al registrar el local' });
  }
});

app.post('/api/superadmin/enviar-password', async (req, res) => {
  try {
    const { localId } = req.body;
    const doc = await Local.findOne(buildLocalFilter(localId));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });
    if (!doc.correo) return res.status(400).json({ error: 'El local no tiene correo asignado' });

    await enviarCorreoPassword(doc.correo, doc.nombre, doc.password || 'Sin clave asignada');
    return res.status(200).json({ mensaje: 'Correo enviado correctamente' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al enviar clave' });
  }
});

app.post('/api/locales', async (req, res) => {
  try {
    const { nombre, password, rut, correo } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre del restaurante es obligatorio' });

    const localSlug = nombre.toLowerCase().trim().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
    let docExistente = await Local.findOne(buildLocalFilter(localSlug));
    if (docExistente) return res.status(400).json({ error: 'El local ya se encuentra registrado' });

    const siguienteId = await getNextSequenceValue('local_id');
    const ahora = new Date();
    const fechaVencimiento = new Date(ahora.getTime() + (30 * 24 * 60 * 60 * 1000));

    const nuevoLocal = new Local({
      id: siguienteId,
      local: localSlug,
      nombre: nombre.trim(),
      rut: rut || '',
      correo: correo || '',
      password: password || '123',
      activo: true,
      fechaCreacion: ahora.toISOString(),
      fechaVencimiento: fechaVencimiento,
      menu: []
    });

    await nuevoLocal.save();
    if (nuevoLocal.correo) enviarCorreoPassword(nuevoLocal.correo, nuevoLocal.nombre, nuevoLocal.password);

    return res.status(201).json({
      mensaje: 'Restaurante creado con éxito',
      id: nuevoLocal.id,
      local: nuevoLocal.local,
      nombre: nuevoLocal.nombre
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al crear el restaurante' });
  }
});

app.patch('/api/locales/:id/licencia', async (req, res) => {
  try {
    const localQuery = req.params.id.toLowerCase().trim();
    const { activo, fechaVencimiento } = req.body;
    const updateFields = {};
    if (typeof activo === 'boolean') updateFields.activo = activo;
    if (fechaVencimiento) updateFields.fechaVencimiento = new Date(fechaVencimiento);

    const doc = await Local.findOneAndUpdate(
      buildLocalFilter(localQuery),
      { $set: updateFields },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    return res.status(200).json({ mensaje: 'Actualizado con éxito' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al actualizar licencia' });
  }
});

// RUTAS MENÚ
app.get('/api/menu', verificarLicencia, async (req, res) => {
  try {
    const { local, modo } = req.query;
    if (!local) return res.status(200).json([]);
    const doc = await Local.findOne(buildLocalFilter(local)).lean();
    if (!doc || !doc.menu) return res.status(200).json([]);

    if (modo === 'estructurado') return res.status(200).json(doc.menu || []);

    let productosPlanos = [];
    if (Array.isArray(doc.menu)) {
      doc.menu.forEach(c => {
        if (c.productos && Array.isArray(c.productos)) {
          c.productos.forEach(p => {
            productosPlanos.push({ categoria: c.categoria, nombre: p.nombre, precio: p.precio });
          });
        }
      });
    }
    return res.status(200).json(productosPlanos);
  } catch (err) {
    return res.status(500).json([]);
  }
});

app.post('/api/menu/categoria', verificarLicencia, async (req, res) => {
  try {
    const { local, categoria } = req.body;
    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });
    if (!Array.isArray(doc.menu)) doc.menu = [];

    if (doc.menu.some(c => c.categoria.toLowerCase() === categoria.trim().toLowerCase())) {
      return res.status(400).json({ error: 'La categoría ya existe' });
    }

    doc.menu.push({ categoria: categoria.trim(), productos: [] });
    doc.markModified('menu');
    await doc.save();
    return res.status(201).json({ mensaje: 'Categoría creada' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al crear la categoría' });
  }
});

app.delete('/api/menu/categoria', verificarLicencia, async (req, res) => {
  try {
    const { local, categoria } = req.query;
    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc || !doc.menu) return res.status(404).json({ error: 'Local no encontrado' });

    doc.menu = doc.menu.filter(c => c.categoria.toLowerCase() !== categoria.trim().toLowerCase());
    doc.markModified('menu');
    await doc.save();
    return res.status(200).json({ mensaje: 'Categoría eliminada' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al eliminar categoría' });
  }
});

app.post('/api/menu', verificarLicencia, async (req, res) => {
  try {
    const { local, categoria, nombre, precio } = req.body;
    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });
    if (!Array.isArray(doc.menu)) doc.menu = [];

    let catObj = doc.menu.find(c => c.categoria.toLowerCase() === categoria.toLowerCase().trim());
    if (!catObj) {
      catObj = { categoria: categoria.trim(), productos: [] };
      doc.menu.push(catObj);
    }
    catObj.productos.push({ nombre: nombre.trim(), precio: Number(precio) || 0 });
    doc.markModified('menu');
    await doc.save();
    return res.status(200).json({ mensaje: 'Producto guardado' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al agregar producto' });
  }
});

app.put('/api/menu/edit', verificarLicencia, async (req, res) => {
  try {
    const { local, categoriaOriginal, indexOriginal, nuevoNombre, nuevoPrecio, nuevaCategoria } = req.body;
    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc || !doc.menu) return res.status(404).json({ error: 'Local no encontrado' });

    let catObj = doc.menu.find(c => c.categoria === categoriaOriginal);
    if (!catObj || !catObj.productos || catObj.productos[indexOriginal] === undefined) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const prodActualizado = { nombre: nuevoNombre.trim(), precio: Number(nuevoPrecio) || 0 };

    if (nuevaCategoria && nuevaCategoria !== categoriaOriginal) {
      catObj.productos.splice(indexOriginal, 1);
      let nuevaCatObj = doc.menu.find(c => c.categoria === nuevaCategoria);
      if (!nuevaCatObj) {
        nuevaCatObj = { categoria: nuevaCategoria, productos: [] };
        doc.menu.push(nuevaCatObj);
      }
      nuevaCatObj.productos.push(prodActualizado);
    } else {
      catObj.productos[indexOriginal] = prodActualizado;
    }

    doc.markModified('menu');
    await doc.save();
    return res.status(200).json({ mensaje: 'Producto actualizado' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

app.delete('/api/menu/del', verificarLicencia, async (req, res) => {
  try {
    const { local, categoria, index } = req.query;
    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc || !doc.menu) return res.status(404).json({ error: 'Local no encontrado' });

    let catObj = doc.menu.find(c => c.categoria === categoria);
    if (catObj && catObj.productos) {
      catObj.productos.splice(Number(index), 1);
      doc.markModified('menu');
      await doc.save();
    }
    return res.status(200).json({ mensaje: 'Producto eliminado' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// RUTAS PEDIDOS E HISTORIAL
app.get('/api/pedidos', verificarLicencia, async (req, res) => {
  try {
    const { local } = req.query;
    let query = local ? { local: local.toLowerCase().trim() } : {};
    const pedidos = await Pedido.find(query).sort({ fecha: -1 }).lean();
    return res.status(200).json(pedidos);
  } catch (err) {
    return res.status(500).json([]);
  }
});

app.post('/api/pedidos', verificarLicencia, async (req, res) => {
  try {
    const { local, mesa, items, total, estado, fecha } = req.body;
    const nuevoPedido = new Pedido({
      local: (local || 'mongo').toLowerCase().trim(),
      mesa: String(mesa || '1'),
      items,
      total: Number(total) || 0,
      estado: estado || 'pendiente',
      fecha: fecha ? new Date(fecha) : new Date()
    });
    await nuevoPedido.save();
    return res.status(201).json({ mensaje: 'Pedido registrado', id: nuevoPedido._id });
  } catch (err) {
    return res.status(500).json({ error: 'Error al procesar pedido' });
  }
});

app.delete('/api/pedidos/:id', async (req, res) => {
  try {
    await Pedido.findByIdAndDelete(req.params.id);
    return res.status(200).json({ mensaje: 'Pedido eliminado' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al eliminar pedido' });
  }
});

app.post('/api/historials', verificarLicencia, async (req, res) => {
  try {
    const data = req.body;
    const nuevoRegistro = new Historial({
      id: data.id || String(Date.now()),
      local: (data.local || 'mongo').toLowerCase().trim(),
      mesa: String(data.mesa || '1'),
      items: data.items || [],
      total: Number(data.total) || 0,
      estado: 'entregado',
      hora: data.hora,
      rutGarzon: data.rutGarzon,
      horaEntrega: data.horaEntrega,
      fechaEntrega: data.fechaEntrega
    });
    await nuevoRegistro.save();
    return res.status(201).json({ mensaje: 'Historial guardado' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al registrar historial' });
  }
});

app.get('/api/historials', verificarLicencia, async (req, res) => {
  try {
    const { local } = req.query;
    let query = local ? { local: local.toLowerCase().trim() } : {};
    const historial = await Historial.find(query).sort({ createdAt: -1 }).lean();
    return res.status(200).json(historial);
  } catch (err) {
    return res.status(500).json([]);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));
