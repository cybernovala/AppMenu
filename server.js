const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// --- 1. CONFIGURACIÓN CORS Y MIDDLEWARE ---
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());
app.use(express.json());

// --- 2. CONEXIÓN A MONGO DB ATLAS ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:juan2073@cluster0.w3kjxzs.mongodb.net/appmenu?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 5000
})
  .then(() => console.log('✅ MongoDB Conectado Exitosamente'))
  .catch(err => console.error('❌ Error crítico al conectar a MongoDB:', err.message));

// --- 3. ESQUEMAS Y MODELOS ---

const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});
const Counter = mongoose.models.Counter || mongoose.model('Counter', CounterSchema);

const LocalSchema = new mongoose.Schema({
  id: Number,
  local: String,
  nombre: String,
  password: String,
  rut: String,
  correo: String,
  altaRegistrada: { type: Boolean, default: false },
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

// --- 4. MIDDLEWARE DE VERIFICACIÓN DE LICENCIA ---
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
    console.error("❌ Error en middleware verificarLicencia:", err.message);
    return res.status(500).json({ error: 'Error interno al validar la licencia.' });
  }
};

// --- 5. RUTAS DE LICENCIA Y SUPERADMIN ---

app.get('/api/licencia', async (req, res) => {
  try {
    const localQuery = (req.query.local || '').toLowerCase().trim();
    if (!localQuery) return res.status(400).json({ error: 'Debe especificar el local' });

    const doc = await Local.findOne(buildLocalFilter(localQuery)).lean();

    if (!doc) {
      return res.status(404).json({ error: 'Local no encontrado' });
    }

    const estaActivo = doc.activo !== false;

    return res.status(200).json({
      id: doc.id,
      local: doc.local || String(doc.id),
      nombre: doc.nombre || doc.local,
      activo: estaActivo,
      altaRegistrada: !!doc.altaRegistrada,
      fechaCreacion: doc.fechaCreacion,
      fechaVencimiento: doc.fechaVencimiento
    });
  } catch (err) {
    console.error("❌ Error en GET /api/licencia:", err.message);
    return res.status(500).json({ error: 'Error al consultar estado de licencia' });
  }
});

app.get('/api/locales', async (req, res) => {
  try {
    const docs = await Local.find({}).sort({ id: 1 }).lean();
    if (!docs) return res.status(200).json([]);

    const locales = docs.map(d => ({
      _id: d._id,
      id: d.id,
      localId: (d.local || String(d.id || '')).toLowerCase().trim(),
      nombre: d.nombre || d.local,
      rut: d.rut || '',
      correo: d.correo || '',
      password: d.password || '',
      altaRegistrada: !!d.altaRegistrada,
      activo: d.activo !== false,
      fechaCreacion: d.fechaCreacion,
      fechaVencimiento: d.fechaVencimiento
    }));

    return res.status(200).json(locales);
  } catch (err) {
    console.error("❌ Error en GET /api/locales:", err.message);
    return res.status(500).json([]);
  }
});

app.post('/api/locales', async (req, res) => {
  try {
    const { nombre, password, rut, correo, altaRegistrada } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: 'El nombre del restaurante es obligatorio' });
    }

    const localSlug = nombre.toLowerCase().trim().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');

    let docExistente = await Local.findOne(buildLocalFilter(localSlug));
    if (docExistente) {
      return res.status(400).json({ error: 'El local ya se encuentra registrado' });
    }

    const siguienteId = await getNextSequenceValue('local_id');
    const ahora = new Date();
    const fechaVencimiento = new Date(ahora.getTime() + (30 * 24 * 60 * 60 * 1000));

    const nuevoLocal = new Local({
      id: siguienteId,
      local: localSlug,
      nombre: nombre.trim(),
      password: password || '1234',
      rut: rut ? rut.trim() : '',
      correo: correo ? correo.trim().toLowerCase() : '',
      altaRegistrada: !!altaRegistrada,
      activo: true,
      fechaCreacion: ahora.toISOString(),
      fechaVencimiento: fechaVencimiento,
      menu: []
    });

    await nuevoLocal.save();

    return res.status(201).json({
      mensaje: 'Restaurante creado con éxito',
      id: nuevoLocal.id,
      local: nuevoLocal.local,
      nombre: nuevoLocal.nombre,
      activo: nuevoLocal.activo,
      fechaCreacion: nuevoLocal.fechaCreacion,
      fechaVencimiento: nuevoLocal.fechaVencimiento
    });
  } catch (err) {
    console.error("❌ Error en POST /api/locales:", err.message);
    return res.status(500).json({ error: 'Error al crear el restaurante' });
  }
});

app.post('/api/locales/alta', async (req, res) => {
  try {
    const { nombre, rut, correo, password } = req.body;
    if (!nombre || !rut || !correo || !password) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    const localSlug = nombre.toLowerCase().trim().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
    let doc = await Local.findOne(buildLocalFilter(localSlug));

    if (doc) {
      doc.rut = rut.trim();
      doc.correo = correo.trim().toLowerCase();
      doc.password = password.trim();
      doc.altaRegistrada = true;
      await doc.save();
      return res.status(200).json({ mensaje: 'Alta realizada con éxito', local: doc.local });
    }

    const siguienteId = await getNextSequenceValue('local_id');
    const ahora = new Date();
    const fechaVencimiento = new Date(ahora.getTime() + (30 * 24 * 60 * 60 * 1000));

    doc = new Local({
      id: siguienteId,
      local: localSlug,
      nombre: nombre.trim(),
      rut: rut.trim(),
      correo: correo.trim().toLowerCase(),
      password: password.trim(),
      altaRegistrada: true,
      activo: true,
      fechaCreacion: ahora.toISOString(),
      fechaVencimiento: fechaVencimiento,
      menu: []
    });

    await doc.save();
    return res.status(201).json({ mensaje: 'Alta creada con éxito', local: doc.local });
  } catch (err) {
    console.error("❌ Error en POST /api/locales/alta:", err.message);
    return res.status(500).json({ error: 'Error al procesar el alta' });
  }
});

app.post('/api/locales/recuperar', async (req, res) => {
  try {
    const { correo, local } = req.body;
    if (!correo) return res.status(400).json({ error: 'El correo es obligatorio' });

    let filter = { correo: correo.trim().toLowerCase() };
    if (local) filter = { $and: [buildLocalFilter(local), { correo: correo.trim().toLowerCase() }] };

    const doc = await Local.findOne(filter);
    if (!doc) {
      return res.status(404).json({ error: 'No se encontró una cuenta asociada a este correo' });
    }

    return res.status(200).json({
      mensaje: 'Recuperación de clave',
      password: doc.password || 'Sin contraseña asignada',
      correo: doc.correo || correo
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al recuperar contraseña' });
  }
});

app.post('/api/locales/login', async (req, res) => {
  try {
    const { local, password } = req.body;
    if (!local || !password) return res.status(400).json({ error: 'Datos incompletos' });

    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    if (!doc.password || doc.password === password.trim()) {
      return res.status(200).json({ ok: true, mensaje: 'Acceso concedido' });
    } else {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Error al autenticar' });
  }
});

app.post('/api/locales/reenviar-clave', async (req, res) => {
  try {
    const { local } = req.body;
    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    const clave = doc.password || '1234';
    const correo = doc.correo || 'Sin correo registrado';

    return res.status(200).json({
      mensaje: `Contraseña del local "${doc.nombre}": ${clave}\nCorreo ingresado: ${correo}`,
      clave: clave,
      correo: correo,
      nombre: doc.nombre
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al reenviar contraseña' });
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

    if (!doc) {
      return res.status(404).json({ error: 'Local no encontrado' });
    }

    return res.status(200).json({
      mensaje: 'Estado del local actualizado en MongoDB con éxito',
      id: doc.id,
      localId: doc.local,
      activo: doc.activo,
      fechaVencimiento: doc.fechaVencimiento
    });
  } catch (err) {
    console.error("❌ Error en PATCH /api/locales/:id/licencia:", err.message);
    return res.status(500).json({ error: 'Error al actualizar licencia' });
  }
});

// --- 6. RUTAS DEL MENÚ Y CATEGORÍAS ---

app.get('/api/menu', verificarLicencia, async (req, res) => {
  try {
    const { local, modo } = req.query;
    if (!local) return res.status(200).json([]);

    const doc = await Local.findOne(buildLocalFilter(local)).lean();
    if (!doc || !doc.menu) return res.status(200).json([]);

    if (modo === 'estructurado') {
      return res.status(200).json(doc.menu || []);
    }

    let productosPlanos = [];
    if (Array.isArray(doc.menu)) {
      doc.menu.forEach(c => {
        if (c.productos && Array.isArray(c.productos)) {
          c.productos.forEach(p => {
            productosPlanos.push({
              categoria: c.categoria,
              nombre: p.nombre,
              precio: p.precio
            });
          });
        }
      });
    }

    return res.status(200).json(productosPlanos);
  } catch (err) {
    console.error("❌ Error en GET /api/menu:", err.message);
    return res.status(500).json([]);
  }
});

app.post('/api/menu/categoria', verificarLicencia, async (req, res) => {
  try {
    const { local, categoria } = req.body;
    if (!local || !categoria) {
      return res.status(400).json({ error: 'El nombre de la categoría y local son obligatorios' });
    }

    let doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) {
      const siguienteId = await getNextSequenceValue('local_id');
      const localSlug = local.toLowerCase().trim().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
      doc = new Local({
        id: siguienteId,
        local: localSlug,
        nombre: local.toUpperCase(),
        menu: []
      });
    }

    if (!Array.isArray(doc.menu)) doc.menu = [];

    const existeCat = doc.menu.find(c => c.categoria.toLowerCase() === categoria.trim().toLowerCase());
    if (existeCat) {
      return res.status(400).json({ error: 'La categoría ya existe' });
    }

    doc.menu.push({ categoria: categoria.trim(), productos: [] });
    doc.markModified('menu');
    await doc.save();

    return res.status(201).json({ mensaje: 'Categoría agregada', menu: doc.menu });
  } catch (err) {
    return res.status(500).json({ error: 'Error al agregar categoría' });
  }
});

app.delete('/api/menu/categoria', verificarLicencia, async (req, res) => {
  try {
    const { local, categoria } = req.query;
    if (!local || !categoria) return res.status(400).json({ error: 'Faltan parámetros' });

    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc || !Array.isArray(doc.menu)) return res.status(404).json({ error: 'Local o menú no encontrado' });

    doc.menu = doc.menu.filter(c => c.categoria.toLowerCase() !== categoria.toLowerCase().trim());
    doc.markModified('menu');
    await doc.save();

    return res.status(200).json({ mensaje: 'Categoría eliminada', menu: doc.menu });
  } catch (err) {
    return res.status(500).json({ error: 'Error al eliminar categoría' });
  }
});

app.post('/api/menu', verificarLicencia, async (req, res) => {
  try {
    const { local, categoria, nombre, precio } = req.body;
    if (!local || !categoria || !nombre || precio === undefined) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    if (!Array.isArray(doc.menu)) doc.menu = [];

    let catObj = doc.menu.find(c => c.categoria.toLowerCase() === categoria.trim().toLowerCase());
    if (!catObj) {
      catObj = { categoria: categoria.trim(), productos: [] };
      doc.menu.push(catObj);
    }

    catObj.productos.push({ nombre: nombre.trim(), precio: Number(precio) });
    doc.markModified('menu');
    await doc.save();

    return res.status(201).json({ mensaje: 'Producto agregado exitosamente' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al agregar producto' });
  }
});

app.delete('/api/menu/del', verificarLicencia, async (req, res) => {
  try {
    const { local, categoria, index } = req.query;
    if (!local || !categoria || index === undefined) return res.status(400).json({ error: 'Faltan parámetros' });

    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc || !Array.isArray(doc.menu)) return res.status(404).json({ error: 'Local no encontrado' });

    const catObj = doc.menu.find(c => c.categoria.toLowerCase() === categoria.toLowerCase().trim());
    if (catObj && Array.isArray(catObj.productos)) {
      const idx = Number(index);
      if (idx >= 0 && idx < catObj.productos.length) {
        catObj.productos.splice(idx, 1);
        doc.markModified('menu');
        await doc.save();
        return res.status(200).json({ mensaje: 'Producto eliminado' });
      }
    }
    return res.status(400).json({ error: 'Índice de producto no válido' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

app.put('/api/menu/edit', verificarLicencia, async (req, res) => {
  try {
    const { local, categoriaOriginal, indexOriginal, nuevoNombre, nuevoPrecio, nuevaCategoria } = req.body;

    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc || !Array.isArray(doc.menu)) return res.status(404).json({ error: 'Local no encontrado' });

    const catOrigObj = doc.menu.find(c => c.categoria.toLowerCase() === categoriaOriginal.toLowerCase().trim());
    if (!catOrigObj || !Array.isArray(catOrigObj.productos)) return res.status(404).json({ error: 'Categoría no encontrada' });

    const idx = Number(indexOriginal);
    if (idx < 0 || idx >= catOrigObj.productos.length) return res.status(400).json({ error: 'Producto no existe' });

    catOrigObj.productos.splice(idx, 1);

    const targetCat = nuevaCategoria ? nuevaCategoria.trim() : categoriaOriginal.trim();
    let catDestino = doc.menu.find(c => c.categoria.toLowerCase() === targetCat.toLowerCase());
    if (!catDestino) {
      catDestino = { categoria: targetCat, productos: [] };
      doc.menu.push(catDestino);
    }

    catDestino.productos.push({
      nombre: nuevoNombre.trim(),
      precio: Number(nuevoPrecio)
    });

    doc.markModified('menu');
    await doc.save();

    return res.status(200).json({ mensaje: 'Producto editado con éxito' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al editar producto' });
  }
});

// --- 7. RUTAS DE PEDIDOS Y HISTORIAL ---

app.get('/api/pedidos', verificarLicencia, async (req, res) => {
  try {
    const { local } = req.query;
    if (!local) return res.status(200).json([]);

    const localSlug = local.toLowerCase().trim();
    const pedidos = await Pedido.find({
      local: new RegExp(`^${localSlug}$`, 'i'),
      estado: { $ne: 'entregado' }
    }).sort({ createdAt: -1 }).lean();

    return res.status(200).json(pedidos);
  } catch (err) {
    return res.status(500).json([]);
  }
});

app.post('/api/pedidos', verificarLicencia, async (req, res) => {
  try {
    const { local, mesa, items, total } = req.body;
    if (!local || !items || items.length === 0) {
      return res.status(400).json({ error: 'Información de pedido incompleta' });
    }

    const nuevoPedido = new Pedido({
      local: local.toLowerCase().trim(),
      mesa: String(mesa || '1'),
      items: items,
      total: Number(total || 0),
      estado: 'pendiente',
      fecha: new Date()
    });

    await nuevoPedido.save();
    return res.status(201).json({ mensaje: 'Pedido registrado', pedido: nuevoPedido });
  } catch (err) {
    return res.status(500).json({ error: 'Error al registrar pedido' });
  }
});

app.delete('/api/pedidos/:id', async (req, res) => {
  try {
    await Pedido.findByIdAndDelete(req.params.id);
    return res.status(200).json({ mensaje: 'Pedido eliminado o procesado' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al eliminar pedido' });
  }
});

app.get('/api/historials', verificarLicencia, async (req, res) => {
  try {
    const { local } = req.query;
    if (!local) return res.status(200).json([]);

    const localSlug = local.toLowerCase().trim();
    const lista = await Historial.find({
      local: new RegExp(`^${localSlug}$`, 'i')
    }).sort({ createdAt: -1 }).lean();

    return res.status(200).json(lista);
  } catch (err) {
    return res.status(500).json([]);
  }
});

app.post('/api/historials', verificarLicencia, async (req, res) => {
  try {
    const { local, mesa, items, total, hora, rutGarzon, horaEntrega, fechaEntrega } = req.body;

    const nuevoHist = new Historial({
      id: new Date().getTime().toString(),
      local: (local || '').toLowerCase().trim(),
      mesa: String(mesa || '1'),
      items: items || [],
      total: Number(total || 0),
      estado: 'entregado',
      hora: hora || horaEntrega,
      rutGarzon: rutGarzon || 'S/RUT',
      horaEntrega: horaEntrega || hora,
      fechaEntrega: fechaEntrega || new Date().toISOString().split('T')[0]
    });

    await nuevoHist.save();
    return res.status(201).json({ mensaje: 'Registrado en historial', historial: nuevoHist });
  } catch (err) {
    return res.status(500).json({ error: 'Error al guardar en historial' });
  }
});

// --- 8. PUERTO DE ARRANQUE ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor AppMenu corriendo en puerto ${PORT}`);
});
