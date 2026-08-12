const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();

// --- 1. CONFIGURACIÓN CORS Y MIDDLEWARE ---
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());
app.use(express.json());

// --- 2. CONFIGURACIÓN DE ENVÍO DE CORREOS (NODEMAILER) ---
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '465'),
  secure: process.env.EMAIL_SECURE !== 'false', // true para puerto 465, false para otros
  auth: {
    user: process.env.EMAIL_USER || 'tu_correo@gmail.com',
    pass: process.env.EMAIL_PASS || 'tu_contraseña_de_aplicacion'
  }
});

async function enviarCorreo(destino, asunto, mensajeHtml) {
  try {
    const info = await transporter.sendMail({
      from: `"AppMenu Digital" <${process.env.EMAIL_USER || 'no-reply@appmenu.com'}>`,
      to: destino,
      subject: asunto,
      html: mensajeHtml
    });
    console.log("📧 Correo enviado con éxito:", info.messageId);
    return true;
  } catch (err) {
    console.error("❌ Error enviando correo:", err.message);
    return false;
  }
}

// --- 3. CONEXIÓN A MONGO DB ATLAS ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:juan2073@cluster0.w3kjxzs.mongodb.net/appmenu?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 5000
})
  .then(() => console.log('✅ MongoDB Conectado Exitosamente'))
  .catch(err => console.error('❌ Error crítico al conectar a MongoDB:', err.message));

// --- 4. ESQUEMAS Y MODELOS ---

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

// --- 5. MIDDLEWARE DE VERIFICACIÓN DE LICENCIA ---
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

// --- 6. RUTAS DE LICENCIA, ALTA Y SUPERADMIN ---

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

// --- RUTA DAR DE ALTA NEGOCIO CON ENVÍO DE CORREO ---
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
    } else {
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
    }

    // Plantilla de Correo de Confirmación de Alta
    const htmlCorreo = `
      <div style="font-family: Arial, sans-serif; background-color: #08070d; color: #ffffff; padding: 20px; border-radius: 10px;">
        <h2 style="color: #ffee00;">🎉 ¡Registro Exitoso en AppMenu!</h2>
        <p>Hola, tu negocio <strong>${doc.nombre}</strong> ha sido dado de alta correctamente en el sistema.</p>
        <hr style="border: 1px solid #ff007f;">
        <h3>🔑 Tus Credenciales de Acceso:</h3>
        <ul>
          <li><strong>Restaurante / Local:</strong> ${doc.nombre}</li>
          <li><strong>RUT Empresa:</strong> ${doc.rut}</li>
          <li><strong>Correo Registrado:</strong> ${doc.correo}</li>
          <li><strong>Contraseña de Administración:</strong> ${doc.password}</li>
        </ul>
        <br>
        <p style="font-size: 12px; color: #a0a0b0;">Guarda este correo para no perder tu acceso de administración.</p>
      </div>
    `;

    // Envío del correo en segundo plano
    enviarCorreo(doc.correo, `✅ Alta Exitosa de tu Negocio - ${doc.nombre}`, htmlCorreo);

    return res.status(200).json({ mensaje: 'Alta realizada con éxito y correo de notificación enviado', local: doc.local });
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

    const htmlCorreo = `
      <div style="font-family: Arial, sans-serif; background-color: #08070d; color: #ffffff; padding: 20px; border-radius: 10px;">
        <h2 style="color: #ffee00;">🔑 Recuperación de Clave - AppMenu</h2>
        <p>Has solicitado la contraseña para el negocio: <strong>${doc.nombre}</strong></p>
        <div style="background-color: #16161e; padding: 15px; border: 1px solid #ff5500; border-radius: 8px; margin: 15px 0;">
          <p style="font-size: 18px; margin: 0;">Tu contraseña actual es: <strong style="color: #00ff66;">${doc.password}</strong></p>
        </div>
      </div>
    `;

    enviarCorreo(doc.correo, `🔐 Recuperación de Clave - ${doc.nombre}`, htmlCorreo);

    return res.status(200).json({
      mensaje: 'Recuperación de clave enviada al correo registrado.',
      password: doc.password || 'Sin contraseña asignada'
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

// --- RUTA SUPERADMIN REENVIAR CLAVE POR CORREO ---
app.post('/api/locales/reenviar-clave', async (req, res) => {
  try {
    const { local } = req.body;
    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    if (!doc.correo) {
      return res.status(400).json({ error: `El local "${doc.nombre}" no tiene un correo electrónico registrado.` });
    }

    const htmlCorreo = `
      <div style="font-family: Arial, sans-serif; background-color: #08070d; color: #ffffff; padding: 20px; border-radius: 10px;">
        <h2 style="color: #00d2ff;">📩 Recordatorio de Contraseña - SuperAdmin</h2>
        <p>El administrador ha solicitado reenviarte las credenciales de tu local <strong>${doc.nombre}</strong>.</p>
        <div style="background-color: #16161e; padding: 15px; border: 1px solid #00d2ff; border-radius: 8px; margin: 15px 0;">
          <p style="margin: 5px 0;"><strong>Local:</strong> ${doc.nombre}</p>
          <p style="margin: 5px 0;"><strong>Contraseña:</strong> <span style="color: #ffee00; font-weight: bold; font-size: 16px;">${doc.password || '1234'}</span></p>
        </div>
      </div>
    `;

    const enviado = await enviarCorreo(doc.correo, `🔐 Credenciales de Acceso - ${doc.nombre}`, htmlCorreo);

    if (enviado) {
      return res.status(200).json({
        mensaje: `Contraseña reenviada con éxito al correo: ${doc.correo}`
      });
    } else {
      return res.status(500).json({
        error: `No se pudo enviar el correo a ${doc.correo}. Revisa la configuración SMTP.`
      });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Error interno al reenviar contraseña' });
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
    if (!local || !categoria) {
      return res.status(400).json({ error: 'El nombre de la categoría y local son obligatorios' });
    }

    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });

    if (!Array.isArray(doc.menu)) doc.menu = [];

    let existeCat = doc.menu.some(c => c.categoria.toLowerCase() === categoria.trim().toLowerCase());
    if (existeCat) {
      return res.status(400).json({ error: 'La categoría ya existe' });
    }

    doc.menu.push({ categoria: categoria.trim(), productos: [] });
    doc.markModified('menu');
    await doc.save();

    return res.status(201).json({ mensaje: 'Categoría creada con éxito', menu: doc.menu });
  } catch (err) {
    console.error("❌ Error en POST /api/menu/categoria:", err.message);
    return res.status(500).json({ error: 'Error al crear la categoría' });
  }
});

app.delete('/api/menu/categoria', verificarLicencia, async (req, res) => {
  try {
    const { local, categoria } = req.query;
    if (!local || !categoria) return res.status(400).json({ error: 'Parámetros faltantes' });

    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc || !doc.menu) return res.status(404).json({ error: 'Local no encontrado' });

    doc.menu = doc.menu.filter(c => c.categoria.toLowerCase() !== categoria.trim().toLowerCase());
    doc.markModified('menu');
    await doc.save();

    return res.status(200).json({ mensaje: 'Categoría eliminada correctamente' });
  } catch (err) {
    console.error("❌ Error en DELETE /api/menu/categoria:", err.message);
    return res.status(500).json({ error: 'Error al eliminar categoría' });
  }
});

app.post('/api/menu', verificarLicencia, async (req, res) => {
  try {
    const { local, categoria, nombre, precio } = req.body;
    if (!local || !categoria || !nombre) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    const doc = await Local.findOne(buildLocalFilter(local));

    if (!doc) return res.status(404).json({ error: 'Local no encontrado' });
    if (!Array.isArray(doc.menu)) doc.menu = [];

    let catObj = doc.menu.find(c => c.categoria.toLowerCase() === categoria.toLowerCase().trim());
    if (!catObj) {
      catObj = { categoria: categoria.trim(), productos: [] };
      doc.menu.push(catObj);
    }

    if (!Array.isArray(catObj.productos)) catObj.productos = [];

    catObj.productos.push({
      nombre: nombre.trim(),
      precio: Number(precio) || 0
    });

    doc.markModified('menu');
    await doc.save();

    return res.status(200).json({ mensaje: 'Producto guardado con éxito' });
  } catch (err) {
    console.error("❌ Error en POST /api/menu:", err.message);
    return res.status(500).json({ error: 'Error al agregar producto' });
  }
});

app.put('/api/menu/edit', verificarLicencia, async (req, res) => {
  try {
    const { local, categoriaOriginal, indexOriginal, nuevoNombre, nuevoPrecio, nuevaCategoria } = req.body;
    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc || !doc.menu) return res.status(404).json({ error: 'Local o menú no encontrado' });

    let catObj = doc.menu.find(c => c.categoria.toLowerCase() === categoriaOriginal.toLowerCase().trim());
    if (!catObj || !catObj.productos || !catObj.productos[indexOriginal]) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const prodOriginal = catObj.productos.splice(indexOriginal, 1)[0];
    prodOriginal.nombre = nuevoNombre ? nuevoNombre.trim() : prodOriginal.nombre;
    prodOriginal.precio = nuevoPrecio !== undefined ? Number(nuevoPrecio) : prodOriginal.precio;

    const nombreCatDestino = nuevaCategoria ? nuevaCategoria.trim() : categoriaOriginal;
    let catDestino = doc.menu.find(c => c.categoria.toLowerCase() === nombreCatDestino.toLowerCase());

    if (!catDestino) {
      catDestino = { categoria: nombreCatDestino, productos: [] };
      doc.menu.push(catDestino);
    }

    catDestino.productos.push(prodOriginal);
    doc.menu = doc.menu.filter(c => c.productos.length > 0 || c.categoria === nombreCatDestino);

    doc.markModified('menu');
    await doc.save();

    return res.status(200).json({ mensaje: 'Producto actualizado con éxito' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al editar producto' });
  }
});

app.delete('/api/menu/del', verificarLicencia, async (req, res) => {
  try {
    const { local, categoria, index } = req.query;
    const doc = await Local.findOne(buildLocalFilter(local));
    if (!doc || !doc.menu) return res.status(404).json({ error: 'Local o menú no encontrado' });

    let catObj = doc.menu.find(c => c.categoria.toLowerCase() === categoria.toLowerCase().trim());
    if (catObj && catObj.productos) {
      catObj.productos.splice(Number(index), 1);
      doc.markModified('menu');
      await doc.save();
    }

    return res.status(200).json({ mensaje: 'Producto eliminado correctamente' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// --- 8. RUTAS DE PEDIDOS Y HISTORIAL ---

app.get('/api/pedidos', verificarLicencia, async (req, res) => {
  try {
    const { local } = req.query;
    if (!local) return res.status(200).json([]);

    const filter = buildLocalFilter(local);
    const pedidos = await Pedido.find(filter).sort({ createdAt: -1 }).lean();
    return res.status(200).json(pedidos);
  } catch (err) {
    return res.status(500).json([]);
  }
});

app.post('/api/pedidos', verificarLicencia, async (req, res) => {
  try {
    const { local, mesa, items, total, estado, fecha } = req.body;
    const nuevoPedido = new Pedido({
      local: local ? String(local).toLowerCase().trim() : '',
      mesa: String(mesa || '1'),
      items: Array.isArray(items) ? items : [],
      total: Number(total || 0),
      estado: estado || 'pendiente',
      fecha: fecha ? new Date(fecha) : new Date()
    });

    await nuevoPedido.save();
    return res.status(201).json(nuevoPedido);
  } catch (err) {
    return res.status(500).json({ error: 'Error al guardar el pedido' });
  }
});

app.delete('/api/pedidos/:id', verificarLicencia, async (req, res) => {
  try {
    await Pedido.findByIdAndDelete(req.params.id);
    return res.status(200).json({ mensaje: 'Pedido eliminado correctamente' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al eliminar pedido' });
  }
});

app.get('/api/historials', verificarLicencia, async (req, res) => {
  try {
    const { local } = req.query;
    if (!local) return res.status(200).json([]);

    const filter = buildLocalFilter(local);
    const historial = await Historial.find(filter).sort({ createdAt: -1 }).lean();
    return res.status(200).json(historial);
  } catch (err) {
    return res.status(500).json([]);
  }
});

app.post('/api/historials', verificarLicencia, async (req, res) => {
  try {
    const { local, mesa, items, total, estado, hora, rutGarzon, horaEntrega, fechaEntrega } = req.body;
    const nuevoHistorial = new Historial({
      id: new mongoose.Types.ObjectId().toString(),
      local: local ? String(local).toLowerCase().trim() : '',
      mesa: String(mesa || '1'),
      items: Array.isArray(items) ? items : [],
      total: Number(total || 0),
      estado: estado || 'entregado',
      hora: hora || '',
      rutGarzon: rutGarzon || '',
      horaEntrega: horaEntrega || '',
      fechaEntrega: fechaEntrega || ''
    });

    await nuevoHistorial.save();
    return res.status(201).json(nuevoHistorial);
  } catch (err) {
    return res.status(500).json({ error: 'Error al guardar en el historial' });
  }
});

// --- 9. ARRANCAR EL SERVIDOR ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor backend escuchando en el puerto ${PORT}`);
});
