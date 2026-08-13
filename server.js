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

const ConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String, default: '' }
}, { timestamps: true });
const Config = mongoose.models.Config || mongoose.model('Config', ConfigSchema);

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
  mensajeIndividual: { type: String, default: '' },
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

// --- 5. RUTAS DE MENSAJES Y ANUNCIOS SUPERADMIN ---

app.post('/api/superadmin/mensaje-global', async (req, res) => {
  try {
    const { mensaje } = req.body;
    await Config.findOneAndUpdate(
      { key: 'mensajeSuperadmin' },
      { value: mensaje || '' },
      { upsert: true, new: true }
    );
    return res.status(200).json({ ok: true, mensaje: 'Mensaje masivo guardado correctamente' });
  } catch (err) {
    console.error("❌ Error en mensaje global:", err.message);
    return res.status(500).json({ error: 'Error al guardar mensaje global' });
  }
});

app.post('/api/superadmin/mensaje-local', async (req, res) => {
  try {
    const { local, mensaje } = req.body;
    if (!local) return res.status(400).json({ error: 'Falta especificar el local' });

    const doc = await Local.findOneAndUpdate(
      buildLocalFilter(local),
      { $set: { mensajeIndividual: mensaje || '' } },
      { new: true }
    );

    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    return res.status(200).json({ ok: true, mensaje: 'Mensaje de local guardado correctamente' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al guardar mensaje del local' });
  }
});

app.get('/api/mensajes/avisos', async (req, res) => {
  try {
    const localQuery = (req.query.local || '').toLowerCase().trim();
    let configDoc = await Config.findOne({ key: 'mensajeSuperadmin' }).lean();
    let mensajeGlobal = configDoc ? configDoc.value : '';

    let mensajeLocal = '';
    if (localQuery) {
      let docLocal = await Local.findOne(buildLocalFilter(localQuery)).lean();
      if (docLocal && docLocal.mensajeIndividual) {
        mensajeLocal = docLocal.mensajeIndividual;
      }
    }

    return res.status(200).json({
      mensajeGlobal: mensajeGlobal || '',
      mensajeLocal: mensajeLocal || ''
    });
  } catch (err) {
    return res.status(500).json({ mensajeGlobal: '', mensajeLocal: '' });
  }
});

// --- 6. RUTAS DE LICENCIA Y SUPERADMIN ---

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
      fechaVencimiento: doc.fechaVencimiento,
      mensajeIndividual: doc.mensajeIndividual || ''
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

    let configDoc = await Config.findOne({ key: 'mensajeSuperadmin' }).lean();
    let globalMsg = configDoc ? configDoc.value : '';

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
      fechaVencimiento: d.fechaVencimiento,
      mensajeIndividual: d.mensajeIndividual || ''
    }));

    return res.status(200).json({
      locales: locales,
      mensajeGlobal: globalMsg
    });
  } catch (err) {
    console.error("❌ Error en GET /api/locales:", err.message);
    return res.status(500).json({ locales: [], mensajeGlobal: '' });
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
      mensajeIndividual: '',
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
      mensajeIndividual: '',
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

// --- 7. RUTAS DEL MENÚ Y CATEGORÍAS ---

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
    if (!local || !categoria) return res.status(400).json({ error: 'Falta local o categoría' });

    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    let menu = doc.menu || [];
    const existe = menu.some(c => c.categoria.toLowerCase() === categoria.trim().toLowerCase());
    if (existe) return res.status(400).json({ error: 'La categoría ya existe' });

    menu.push({ categoria: categoria.trim(), productos: [] });
    doc.menu = menu;
    doc.markModified('menu');
    await doc.save();

    return res.status(200).json({ mensaje: 'Categoría creada', menu: doc.menu });
  } catch (err) {
    return res.status(500).json({ error: 'Error al crear categoría' });
  }
});

app.delete('/api/menu/categoria', verificarLicencia, async (req, res) => {
  try {
    const { local, categoria } = req.query;
    if (!local || !categoria) return res.status(400).json({ error: 'Falta local o categoría' });

    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    doc.menu = (doc.menu || []).filter(c => c.categoria.toLowerCase() !== categoria.trim().toLowerCase());
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
    if (!local || !categoria || !nombre) return res.status(400).json({ error: 'Datos incompletos' });

    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    let menu = doc.menu || [];
    let catObj = menu.find(c => c.categoria.toLowerCase() === categoria.trim().toLowerCase());

    if (!catObj) {
      catObj = { categoria: categoria.trim(), productos: [] };
      menu.push(catObj);
    }

    catObj.productos.push({
      nombre: nombre.trim(),
      precio: Number(precio) || 0
    });

    doc.menu = menu;
    doc.markModified('menu');
    await doc.save();

    return res.status(200).json({ mensaje: 'Producto agregado', menu: doc.menu });
  } catch (err) {
    return res.status(500).json({ error: 'Error al agregar producto' });
  }
});

app.delete('/api/menu/del', verificarLicencia, async (req, res) => {
  try {
    const { local, categoria, index } = req.query;
    if (!local || !categoria || index === undefined) return res.status(400).json({ error: 'Datos incompletos' });

    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    let menu = doc.menu || [];
    let catObj = menu.find(c => c.categoria.toLowerCase() === categoria.trim().toLowerCase());

    if (catObj && catObj.productos) {
      catObj.productos.splice(Number(index), 1);
      doc.menu = menu;
      doc.markModified('menu');
      await doc.save();
    }

    return res.status(200).json({ mensaje: 'Producto eliminado' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

app.put('/api/menu/edit', verificarLicencia, async (req, res) => {
  try {
    const { local, categoriaOriginal, indexOriginal, nuevoNombre, nuevoPrecio, nuevaCategoria } = req.body;
    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    let menu = doc.menu || [];
    let catObj = menu.find(c => c.categoria.toLowerCase() === categoriaOriginal.trim().toLowerCase());

    if (catObj && catObj.productos && catObj.productos[indexOriginal]) {
      const prod = catObj.productos.splice(indexOriginal, 1)[0];
      prod.nombre = nuevoNombre.trim();
      prod.precio = Number(nuevoPrecio) || 0;

      const catDestinoNombre = nuevaCategoria ? nuevaCategoria.trim() : categoriaOriginal.trim();
      let catDestino = menu.find(c => c.categoria.toLowerCase() === catDestinoNombre.toLowerCase());

      if (!catDestino) {
        catDestino = { categoria: catDestinoNombre, productos: [] };
        menu.push(catDestino);
      }

      catDestino.productos.push(prod);
      doc.menu = menu;
      doc.markModified('menu');
      await doc.save();
    }

    return res.status(200).json({ mensaje: 'Producto editado' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al editar producto' });
  }
});

// --- 8. RUTAS DE PEDIDOS Y HISTORIAL ---

app.get('/api/pedidos', verificarLicencia, async (req, res) => {
  try {
    const { local } = req.query;
    if (!local) return res.status(200).json([]);

    const docLocal = await Local.findOne(buildLocalFilter(local)).lean();
    if (!docLocal) return res.status(200).json([]);

    const filter = {
      $or: [
        { local: docLocal.local },
        { local: String(docLocal.id) }
      ]
    };

    const pedidos = await Pedido.find(filter).sort({ createdAt: -1 }).lean();
    return res.status(200).json(pedidos);
  } catch (err) {
    return res.status(500).json([]);
  }
});

app.post('/api/pedidos', verificarLicencia, async (req, res) => {
  try {
    const { local, mesa, items, total } = req.body;
    if (!local) return res.status(400).json({ error: 'Falta local' });

    const nuevoPedido = new Pedido({
      local: String(local).toLowerCase().trim(),
      mesa: String(mesa || '1'),
      items: Array.isArray(items) ? items : [],
      total: Number(total) || 0,
      estado: 'pendiente',
      fecha: new Date()
    });

    await nuevoPedido.save();
    return res.status(201).json({ mensaje: 'Pedido recibido', id: nuevoPedido._id });
  } catch (err) {
    return res.status(500).json({ error: 'Error al procesar el pedido' });
  }
});

app.delete('/api/pedidos/:id', verificarLicencia, async (req, res) => {
  try {
    await Pedido.findByIdAndDelete(req.params.id);
    return res.status(200).json({ mensaje: 'Pedido eliminado' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al eliminar pedido' });
  }
});

app.get('/api/historials', verificarLicencia, async (req, res) => {
  try {
    const { local } = req.query;
    if (!local) return res.status(200).json([]);

    const docLocal = await Local.findOne(buildLocalFilter(local)).lean();
    if (!docLocal) return res.status(200).json([]);

    const filter = {
      $or: [
        { local: docLocal.local },
        { local: String(docLocal.id) }
      ]
    };

    const historial = await Historial.find(filter).sort({ createdAt: -1 }).lean();
    return res.status(200).json(historial);
  } catch (err) {
    return res.status(500).json([]);
  }
});

app.post('/api/historials', verificarLicencia, async (req, res) => {
  try {
    const { id, local, mesa, items, total, estado, hora, rutGarzon, horaEntrega, fechaEntrega } = req.body;

    const nuevoHistorial = new Historial({
      id: id || String(Date.now()),
      local: String(local).toLowerCase().trim(),
      mesa: String(mesa || '1'),
      items: Array.isArray(items) ? items : [],
      total: Number(total) || 0,
      estado: estado || 'entregado',
      hora: hora || '',
      rutGarzon: rutGarzon || '',
      horaEntrega: horaEntrega || hora || '',
      fechaEntrega: fechaEntrega || new Date().toISOString().split('T')[0]
    });

    await nuevoHistorial.save();
    return res.status(201).json({ mensaje: 'Registro de historial guardado' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al guardar historial' });
  }
});

// --- 9. INICIO DEL SERVIDOR ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor AppMenu corriendo en puerto ${PORT}`);
});
